import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import PharmaInvoice from "../Models/Invoice.js";
import Product from "../Models/Product.js";
import AuditLog from "../Models/AuditLog.js";
import IPDMedicineIssuance from "../Models/IPDMedicineIssuance.js";
import mongoose from "mongoose";
import pharmaService from "../../services/pharma.service.js";

export const getDashboardStats = async (req: PharmaRequest, res: Response) => {
  try {
    const pharmacyId = req.pharma?._id;

    if (!pharmacyId) {
      // Return empty stats instead of 404 for dashboard compatibility
      return res.json({
        success: true,
        data: {
          requestedRange: { totalRevenue: 0, totalInvoices: 0, itemsSold: 0 },
          thisMonth: { totalRevenue: 0, totalInvoices: 0, itemsSold: 0 },
          today: { totalRevenue: 0, totalInvoices: 0, itemsSold: 0 },
          lowStockCount: 0,
          outOfStockCount: 0,
          expiringSoonCount: 0,
          totalProducts: 0,
          recentInvoices: [],
          paymentBreakdown: {},
          topProducts: [],
          avgBillValue: 0,
        },
      });
    }

    const { range = "today", startDate, endDate } = req.query;

    // ✅ PERFORMANCE FIX: Use Promise.all to fetch stats and recent invoices in parallel
    const [stats, recentInvoices] = await Promise.all([
      pharmaService.getDashboardStats(pharmacyId.toString(), {
        range: range as string,
        startDate: startDate as string,
        endDate: endDate as string,
      }),
      // ✅ PERFORMANCE FIX: Use aggregation with $lookup instead of .populate()
      PharmaInvoice.aggregate([
        { $match: { pharmacy: pharmacyId } },
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "users", // Collection name for User model
            localField: "createdBy",
            foreignField: "_id",
            as: "createdByUser",
          },
        },
        {
          $project: {
            _id: 1,
            invoiceNo: 1,
            netPayable: 1,
            status: 1,
            createdAt: 1,
            createdBy: {
              _id: { $arrayElemAt: ["$createdByUser._id", 0] },
              name: { $arrayElemAt: ["$createdByUser.name", 0] },
            },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        requestedRange: {
          totalRevenue: stats.requestedSales,
          totalInvoices: stats.requestedInvoices,
          itemsSold: stats.requestedItemsSold || 0,
        },
        thisMonth: {
          totalRevenue: stats.monthlyRevenue,
          totalInvoices: stats.monthlyInvoices,
          itemsSold: stats.monthlyItemsSold,
        },
        today: {
          totalRevenue: stats.todaySales,
          totalInvoices: stats.todayInvoices,
          itemsSold: stats.todayItemsSold,
        },
        lowStockCount: stats.lowStockCount,
        outOfStockCount: stats.outOfStockCount,
        expiringSoonCount: stats.expiringSoonCount,
        totalProducts: stats.totalProducts,
        recentInvoices,
        paymentBreakdown: stats.paymentBreakdown,
        topProducts: stats.topProducts,
        leastSellingWithExpiry: stats.leastSellingWithExpiry || [],
        avgBillValue:
          stats.requestedInvoices > 0
            ? stats.requestedSales / stats.requestedInvoices
            : 0,
      },
    });
  } catch (error: any) {
    console.error("Pharma getDashboardStats error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getSalesReport = async (req: PharmaRequest, res: Response) => {
  try {
    const pharmacyId = req.pharma?._id;
    if (!pharmacyId) {
      return res.json({ success: true, data: [] });
    }
    const { startDate, endDate, groupBy } = req.query;

    let matchStage: any = { pharmacy: pharmacyId, status: "PAID" };

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = end;
      }
    }

    let groupByField: any = null;
    if (groupBy === "day") {
      groupByField = {
        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
      };
    } else if (groupBy === "month") {
      groupByField = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
    } else if (groupBy === "year") {
      groupByField = { $dateToString: { format: "%Y", date: "$createdAt" } };
    }

    const salesData = await PharmaInvoice.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupByField,
          totalSales: { $sum: "$netPayable" },
          totalInvoices: { $sum: 1 },
          totalTax: { $sum: "$taxTotal" },
          totalDiscount: { $sum: "$discountTotal" },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    res.json({
      success: true,
      data: salesData,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getInventoryReport = async (req: PharmaRequest, res: Response) => {
  try {
    const pharmacyId = req.pharma?._id;

    if (!pharmacyId) {
      return res.json({
        success: true,
        data: {
          summary: {
            totalProducts: 0,
            lowStockProducts: 0,
            outOfStockProducts: 0,
            totalStockValue: 0,
          },
          categoryBreakdown: [],
        },
      });
    }

    const [summary, categoryBreakdown] = await Promise.all([
      Product.aggregate([
        { $match: { pharmacy: pharmacyId, isActive: true } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            lowStockProducts: {
              $sum: { $cond: [{ $lte: ["$stock", "$minStock"] }, 1, 0] },
            },
            outOfStockProducts: {
              $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] },
            },
            totalStockValue: { $sum: { $multiply: ["$stock", "$mrp"] } },
          },
        },
      ]),
      Product.aggregate([
        { $match: { pharmacy: pharmacyId, isActive: true } },
        {
          $group: {
            _id: "$form",
            totalProducts: { $sum: 1 },
            totalStock: { $sum: "$stock" },
            totalValue: { $sum: { $multiply: ["$stock", "$mrp"] } },
          },
        },
        { $sort: { totalValue: -1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalProducts: summary[0]?.totalProducts || 0,
          lowStockProducts: summary[0]?.lowStockProducts || 0,
          outOfStockProducts: summary[0]?.outOfStockProducts || 0,
          totalStockValue: summary[0]?.totalStockValue || 0,
        },
        categoryBreakdown,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// New comprehensive analytics endpoint
export const getAnalyticsData = async (req: PharmaRequest, res: Response) => {
  try {
    const pharmacyId = req.pharma?._id;
    if (!pharmacyId) {
      return res.json({
        success: true,
        data: {
          totalRevenue: 0,
          totalInvoices: 0,
          totalItemsSold: 0,
          avgBillValue: 0,
          dailyRevenue: [],
          dailyInvoices: [],
          topProducts: [],
          paymentBreakdown: {},
          hourlyStats: [],
          revenueTrend: "neutral",
          revenueChange: "0%",
          transactionTrend: "neutral",
          transactionChange: "0%",
          itemsTrend: "neutral",
          itemsChange: "0%",
          avgOrderTrend: "neutral",
          avgOrderChange: "0%",
          dailyAvgInvoices: 0,
        },
      });
    }

    const { range = "30days", startDate, endDate } = req.query;

    // Calculate date range
    let dateFilter: any = {};
    const now = new Date();

    if (range === "7days") {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 7);
      dateFilter = { $gte: sevenDaysAgo, $lte: new Date() };
    } else if (range === "30days") {
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      dateFilter = { $gte: thirtyDaysAgo, $lte: now };
    } else if (range === "90days") {
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(now.getDate() - 90);
      dateFilter = { $gte: ninetyDaysAgo, $lte: now };
    } else if (range === "custom" && startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter = { $gte: start, $lte: end };
    }

    const matchStage: any = {
      pharmacy: pharmacyId,
      status: "PAID",
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
    };

    const ipdMatchStage: any = {
      pharmacy: pharmacyId,
      status: { $in: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"] },
      ...(Object.keys(dateFilter).length > 0 && { issuedAt: dateFilter }),
    };

    // Fetch analytics data in parallel
    const [
      totalStats,
      dailyRevenue,
      dailyInvoices,
      topProducts,
      paymentBreakdown,
      hourlyStats,
      ipdTotalStats,
      ipdDailyRevenue,
      ipdDailyInvoices,
      ipdTopProducts,
      ipdHourlyStats,
    ] = await Promise.all([
      // Total stats
      PharmaInvoice.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$netPayable" },
            totalInvoices: { $sum: 1 },
            totalItemsSold: { $sum: { $sum: "$items.qty" } },
            avgBillValue: { $avg: "$netPayable" },
          },
        },
      ]),

      // Daily revenue trend
      PharmaInvoice.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$netPayable" },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", revenue: 1 } },
      ]),

      // Daily invoice count
      PharmaInvoice.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", count: 1 } },
      ]),

      // Top products
      PharmaInvoice.aggregate([
        { $match: matchStage },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productName",
            quantitySold: { $sum: "$items.qty" },
            revenue: {
              $sum: { $multiply: ["$items.qty", "$items.unitRate"] },
            },
          },
        },
        {
          $project: {
            _id: 0,
            productName: "$_id",
            quantitySold: 1,
            revenue: 1,
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),

      // Payment method breakdown
      PharmaInvoice.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$mode",
            amount: { $sum: "$netPayable" },
          },
        },
        { $project: { _id: 0, method: "$_id", amount: 1 } },
      ]),

      // Hourly performance
      PharmaInvoice.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { $hour: "$createdAt" },
            transactions: { $sum: 1 },
            revenue: { $sum: "$netPayable" },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, hour: "$_id", transactions: 1, revenue: 1 } },
      ]),

      // IPD Total Stats
      IPDMedicineIssuance.aggregate([
        { $match: ipdMatchStage },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$totalAmount" },
            totalInvoices: { $sum: 1 },
            totalItemsSold: { $sum: { $sum: "$items.issuedQty" } },
            avgBillValue: { $avg: "$totalAmount" }, // For combined math later
          },
        },
      ]),

      // IPD Daily revenue trend
      IPDMedicineIssuance.aggregate([
        { $match: ipdMatchStage },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$issuedAt" } },
            revenue: { $sum: "$totalAmount" },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", revenue: 1 } },
      ]),

      // IPD Daily invoice count
      IPDMedicineIssuance.aggregate([
        { $match: ipdMatchStage },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$issuedAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", count: 1 } },
      ]),

      // IPD Top products
      IPDMedicineIssuance.aggregate([
        { $match: ipdMatchStage },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productName",
            quantitySold: { $sum: "$items.issuedQty" },
            revenue: { $sum: "$items.totalAmount" },
          },
        },
        {
          $project: {
            _id: 0,
            productName: "$_id",
            quantitySold: 1,
            revenue: 1,
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),

      // IPD Hourly performance
      IPDMedicineIssuance.aggregate([
        { $match: ipdMatchStage },
        {
          $group: {
            _id: { $hour: "$issuedAt" },
            transactions: { $sum: 1 },
            revenue: { $sum: "$totalAmount" },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, hour: "$_id", transactions: 1, revenue: 1 } },
      ]),
    ]);

    // Merge totals
    const opdStats = totalStats[0] || { totalRevenue: 0, totalInvoices: 0, totalItemsSold: 0 };
    const iStats = ipdTotalStats[0] || { totalRevenue: 0, totalInvoices: 0, totalItemsSold: 0 };
    
    const combinedTotalRevenue = opdStats.totalRevenue + iStats.totalRevenue;
    const combinedTotalInvoices = opdStats.totalInvoices + iStats.totalInvoices;
    const combinedTotalItemsSold = opdStats.totalItemsSold + iStats.totalItemsSold;
    const combinedAvgBillValue = combinedTotalInvoices > 0 ? combinedTotalRevenue / combinedTotalInvoices : 0;

    // Merge arrays by date/hour
    const mergeByDate = (arr1: any[], arr2: any[], valKey: string) => {
      const map = new Map();
      arr1.forEach(item => map.set(item.date, (map.get(item.date) || 0) + item[valKey]));
      arr2.forEach(item => map.set(item.date, (map.get(item.date) || 0) + item[valKey]));
      return Array.from(map.entries()).map(([date, val]) => ({ date, [valKey]: val })).sort((a, b) => a.date.localeCompare(b.date));
    };

    const combinedDailyRevenue = mergeByDate(dailyRevenue, ipdDailyRevenue, 'revenue');
    const combinedDailyInvoices = mergeByDate(dailyInvoices, ipdDailyInvoices, 'count');

    // Merge Hourly
    const combinedHourlyStatsMap = new Map();
    [...(hourlyStats || []), ...(ipdHourlyStats || [])].forEach(p => {
       if (combinedHourlyStatsMap.has(p.hour)) {
          const existing = combinedHourlyStatsMap.get(p.hour);
          combinedHourlyStatsMap.set(p.hour, {
             hour: p.hour,
             transactions: existing.transactions + p.transactions,
             revenue: existing.revenue + p.revenue
          });
       } else {
          combinedHourlyStatsMap.set(p.hour, { ...p });
       }
    });
    const combinedHourlyStats = Array.from(combinedHourlyStatsMap.values()).sort((a, b) => a.hour - b.hour);

    // Merge Top Products
    const combinedTopProductsMap = new Map();
    [...(topProducts || []), ...(ipdTopProducts || [])].forEach(p => {
       if (combinedTopProductsMap.has(p.productName)) {
          const existing = combinedTopProductsMap.get(p.productName);
          combinedTopProductsMap.set(p.productName, {
             productName: p.productName,
             quantitySold: existing.quantitySold + p.quantitySold,
             revenue: existing.revenue + p.revenue
          });
       } else {
          combinedTopProductsMap.set(p.productName, { ...p });
       }
    });
    const combinedTopProducts = Array.from(combinedTopProductsMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    // Format payment breakdown (add IPD to a generic "IPD BILLING" or existing mode)
    const paymentDist: any = {};
    paymentBreakdown.forEach((item: any) => {
      paymentDist[item.method || "CASH"] = item.amount;
    });
    if (iStats.totalRevenue > 0) {
      paymentDist["IPD BILLING"] = iStats.totalRevenue;
    }

    res.json({
      success: true,
      data: {
        totalRevenue: combinedTotalRevenue,
        totalInvoices: combinedTotalInvoices,
        totalItemsSold: combinedTotalItemsSold,
        avgBillValue: combinedAvgBillValue,
        dailyRevenue: combinedDailyRevenue || [],
        dailyInvoices: combinedDailyInvoices || [],
        topProducts: combinedTopProducts || [],
        paymentBreakdown: paymentDist,
        hourlyStats: combinedHourlyStats || [],
        // Trend placeholders
        revenueTrend: "neutral",
        revenueChange: "0%",
        transactionTrend: "neutral",
        transactionChange: "0%",
        itemsTrend: "neutral",
        itemsChange: "0%",
        avgOrderTrend: "neutral",
        avgOrderChange: "0%",
        dailyAvgInvoices:
          combinedDailyInvoices.length > 0
            ? combinedTotalInvoices / combinedDailyInvoices.length
            : 0,
      },
    });
  } catch (error: any) {
    console.error("Pharma getAnalyticsData error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getEODItemWiseSales = async (req: PharmaRequest, res: Response) => {
  try {
    const pharmacyId = req.pharma?._id;
    if (!pharmacyId) {
      return res.json({ success: true, data: [] });
    }

    const { date } = req.query;
    
    let targetDate = new Date();
    if (date) {
      targetDate = new Date(date as string);
    }
    
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const matchStage: any = {
      pharmacy: pharmacyId,
      status: "PAID",
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    };

    const eodData = await PharmaInvoice.aggregate([
      { $match: matchStage },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.drug",
          productName: { $first: "$items.productName" },
          totalQtySold: { $sum: "$items.qty" },
          totalRevenue: { $sum: "$items.amount" },
          sales: {
            $push: {
              patientName: "$patientName",
              customerPhone: "$customerPhone",
              invoiceNo: "$invoiceNo",
              qty: "$items.qty",
              amount: "$items.amount",
              time: "$createdAt"
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productDetails"
        }
      },
      {
        $project: {
          _id: 1,
          productName: 1,
          totalQtySold: 1,
          totalRevenue: 1,
          sales: 1,
          brand: { $arrayElemAt: ["$productDetails.brand", 0] },
          generic: { $arrayElemAt: ["$productDetails.generic", 0] },
          stockRemaining: { $arrayElemAt: ["$productDetails.stock", 0] }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    res.json({
      success: true,
      data: eodData,
    });
  } catch (error: any) {
    console.error("Pharma getEODItemWiseSales error:", error);
    res.status(500).json({ message: error.message });
  }
};
