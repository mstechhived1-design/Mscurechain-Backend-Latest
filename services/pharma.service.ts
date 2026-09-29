import Product from "../Pharmacy/Models/Product.js";
import Batch from "../Pharmacy/Models/Batch.js";
import PharmaInvoice from "../Pharmacy/Models/Invoice.js";
import Supplier from "../Pharmacy/Models/Supplier.js";
import redisService from "../config/redis.js";
import mongoose from "mongoose";
import IPDMedicineIssuance from "../Pharmacy/Models/IPDMedicineIssuance.js";

export interface PharmaDashboardStats {
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringSoonCount: number;
  todaySales: number;
  todayInvoices: number;
  todayItemsSold: number;
  monthlyRevenue: number;
  monthlyInvoices: number;
  monthlyItemsSold: number;
  requestedSales: number;
  requestedInvoices: number;
  requestedItemsSold: number;
  pendingInvoices: number;
  paymentBreakdown: {
    CASH: number;
    CARD: number;
    UPI: number;
    MIXED: number;
    CREDIT: number;
  };
  topProducts?: any[];
  leastSellingWithExpiry?: any[];
  timestamp: string;
}

export class PharmaService {
  /**
   * Get optimized pharma dashboard stats with caching
   * PERFORMANCE OPTIMIZED: Uses single aggregation instead of multiple countDocuments
   */
  async getDashboardStats(
    pharmacyId: string,
    options?: {
      range?: string;
      startDate?: string;
      endDate?: string;
      useCache?: boolean;
    },
  ): Promise<PharmaDashboardStats> {
    const {
      range = "today",
      startDate,
      endDate,
      useCache = true,
    } = options || {};
    const cacheKey = `pharma:dashboard:stats:${pharmacyId}:${range}:${startDate || ""}:${endDate || ""}`;

    if (useCache) {
      const cached = await redisService.get<PharmaDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    // Calculate filter range for 'requested' stats
    let invoiceMatch: any = {
      pharmacy: new mongoose.Types.ObjectId(pharmacyId),
    };

    let requestedStart = startOfDay;

    if (range === "custom") {
      const gte: any = {};
      if (startDate && startDate !== "") {
        gte.$gte = new Date(startDate);
        requestedStart = gte.$gte;
      }
      if (endDate && endDate !== "") {
        gte.$lte = new Date(endDate);
        gte.$lte.setHours(23, 59, 59, 999);
      }
      if (Object.keys(gte).length > 0) invoiceMatch.createdAt = gte;
    } else if (range === "7days") {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 7);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      invoiceMatch.createdAt = { $gte: sevenDaysAgo };
      requestedStart = sevenDaysAgo;
    } else if (range === "1month") {
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      invoiceMatch.createdAt = { $gte: thirtyDaysAgo };
      requestedStart = thirtyDaysAgo;
    } else {
      // Default to "today"
      invoiceMatch.createdAt = { $gte: startOfDay };
      requestedStart = startOfDay;
    }

    // Determine the broadest date needed for the top-level match (Math.min of all starts)
    const deepestStart = new Date(
      Math.min(
        requestedStart.getTime(),
        startOfMonth.getTime(),
        startOfDay.getTime(),
      ),
    );

    const invoiceAggregatePipeline = (isIPD: boolean) => [
        {
          $match: {
            pharmacy: new mongoose.Types.ObjectId(pharmacyId),
            ...(isIPD ? { status: { $in: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"] } } : { status: { $in: ["PAID", "PENDING"] } }),
            ...(isIPD ? { issuedAt: { $gte: deepestStart } } : { createdAt: { $gte: deepestStart } }),
          },
        },
        {
          $facet: {
            today: [
              { $match: isIPD ? { issuedAt: { $gte: startOfDay } } : { createdAt: { $gte: startOfDay } } },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum: {
                      $cond: [(isIPD ? true : { $eq: ["$status", "PAID"] }), (isIPD ? "$totalAmount" : "$netPayable"), 0],
                    },
                  },
                  count: { $sum: 1 },
                  itemsSold: {
                    $sum: {
                      $cond: [
                        (isIPD ? true : { $eq: ["$status", "PAID"] }),
                        { $sum: isIPD ? "$items.issuedQty" : "$items.qty" },
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            month: [
              { $match: isIPD ? { issuedAt: { $gte: startOfMonth } } : { createdAt: { $gte: startOfMonth } } },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum: {
                      $cond: [(isIPD ? true : { $eq: ["$status", "PAID"] }), (isIPD ? "$totalAmount" : "$netPayable"), 0],
                    },
                  },
                  count: { $sum: 1 },
                  itemsSold: {
                    $sum: {
                      $cond: [
                        (isIPD ? true : { $eq: ["$status", "PAID"] }),
                        { $sum: isIPD ? "$items.issuedQty" : "$items.qty" },
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            requested: [
              {
                $match: invoiceMatch.createdAt
                  ? (isIPD ? { issuedAt: invoiceMatch.createdAt } : { createdAt: invoiceMatch.createdAt })
                  : (isIPD ? { issuedAt: { $gte: startOfDay } } : { createdAt: { $gte: startOfDay } }),
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum: {
                      $cond: [(isIPD ? true : { $eq: ["$status", "PAID"] }), (isIPD ? "$totalAmount" : "$netPayable"), 0],
                    },
                  },
                  count: { $sum: 1 },
                  itemsSold: {
                    $sum: {
                      $cond: [
                        (isIPD ? true : { $eq: ["$status", "PAID"] }),
                        { $sum: isIPD ? "$items.issuedQty" : "$items.qty" },
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            payments: isIPD ? [] : [
              { $match: { status: "PAID" } }, // Payments breakdown only for PAID
              {
                $match: invoiceMatch.createdAt
                  ? { createdAt: invoiceMatch.createdAt }
                  : { createdAt: { $gte: startOfDay } },
              },
              {
                $group: {
                  _id: "$mode",
                  total: { $sum: "$netPayable" },
                  cashSum: { $sum: "$paymentDetails.cash" },
                  cardSum: { $sum: "$paymentDetails.card" },
                  upiSum: { $sum: "$paymentDetails.upi" },
                },
              },
            ],
            topProducts: [
              { $match: isIPD ? {} : { status: "PAID" } },
              {
                $match: invoiceMatch.createdAt
                  ? (isIPD ? { issuedAt: invoiceMatch.createdAt } : { createdAt: invoiceMatch.createdAt })
                  : (isIPD ? { issuedAt: { $gte: startOfDay } } : { createdAt: { $gte: startOfDay } }),
              },
              { $unwind: "$items" },
              {
                $group: {
                  _id: isIPD ? "$items.productName" : "$items.productName",
                  quantity: { $sum: isIPD ? "$items.issuedQty" : "$items.qty" },
                  revenue: { $sum: isIPD ? "$items.totalAmount" : "$items.amount" },
                },
              },
              { $project: { _id: 0, name: "$_id", quantity: 1, revenue: 1 } },
              { $sort: { quantity: -1 } },
              { $limit: 5 },
            ],
          },
        },
    ];

    // Date bounds for "near expiry" window: 6–9 months from now
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    const nineMonthsFromNow = new Date(now);
    nineMonthsFromNow.setMonth(nineMonthsFromNow.getMonth() + 9);

    const [productStats, salesStats, ipdStats, leastSellingRaw] = await Promise.all([
      Product.aggregate([
        {
          $match: {
            pharmacy: new mongoose.Types.ObjectId(pharmacyId),
            isActive: true,
          },
        },
        {
          $facet: {
            total: [{ $count: "count" }],
            lowStock: [
              {
                $match: {
                  stock: { $gt: 0 },
                  $expr: { $lte: ["$stock", "$minStock"] },
                },
              },
              { $count: "count" },
            ],
            outOfStock: [{ $match: { stock: 0 } }, { $count: "count" }],
            expiringSoon: [
              {
                $match: { expiryDate: { $gte: now, $lte: thirtyDaysFromNow } },
              },
              { $count: "count" },
            ],
          },
        },
      ]),
      PharmaInvoice.aggregate(invoiceAggregatePipeline(false) as any),
      IPDMedicineIssuance.aggregate(invoiceAggregatePipeline(true) as any),
      // Least selling + near-expiry products (6–9 months window)
      Product.aggregate([
        {
          $match: {
            pharmacy: new mongoose.Types.ObjectId(pharmacyId),
            isActive: true,
            stock: { $gt: 0 },
            expiryDate: { $gte: sixMonthsFromNow, $lte: nineMonthsFromNow },
          },
        },
        {
          $lookup: {
            from: "pharmainvoices",
            let: { productName: "$name" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$pharmacy", new mongoose.Types.ObjectId(pharmacyId)] },
                  status: "PAID",
                },
              },
              { $unwind: "$items" },
              { $match: { $expr: { $eq: ["$items.productName", "$$productName"] } } },
              {
                $group: {
                  _id: null,
                  totalQty: { $sum: "$items.qty" },
                  totalRevenue: { $sum: "$items.amount" },
                },
              },
            ],
            as: "salesData",
          },
        },
        {
          $addFields: {
            qtySold: { $ifNull: [{ $arrayElemAt: ["$salesData.totalQty", 0] }, 0] },
            revenue: { $ifNull: [{ $arrayElemAt: ["$salesData.totalRevenue", 0] }, 0] },
          },
        },
        {
          $project: {
            _id: 0,
            name: 1,
            brand: 1,
            stock: 1,
            expiryDate: 1,
            mrp: 1,
            qtySold: 1,
            revenue: 1,
          },
        },
        { $sort: { qtySold: 1, expiryDate: 1 } },
        { $limit: 20 },
      ]),
    ]);

    // Merge OPD and IPD Stats
    const opdSales = salesStats[0] || {};
    const ipdSales = ipdStats[0] || {};

    // Helper to merge metric arrays
    const mergeMetric = (opdArr: any[], ipdArr: any[]) => {
      const o = opdArr?.[0] || { total: 0, count: 0, itemsSold: 0 };
      const i = ipdArr?.[0] || { total: 0, count: 0, itemsSold: 0 };
      return {
        total: (o.total || 0) + (i.total || 0),
        count: (o.count || 0) + (i.count || 0),
        itemsSold: (o.itemsSold || 0) + (i.itemsSold || 0)
      };
    };

    const combinedToday = mergeMetric(opdSales.today, ipdSales.today);
    const combinedMonth = mergeMetric(opdSales.month, ipdSales.month);
    const combinedRequested = mergeMetric(opdSales.requested, ipdSales.requested);
    
    // Merge Top Products
    const combinedTopProductsMap = new Map();
    [...(opdSales.topProducts || []), ...(ipdSales.topProducts || [])].forEach(p => {
       if (combinedTopProductsMap.has(p.name)) {
          const existing = combinedTopProductsMap.get(p.name);
          combinedTopProductsMap.set(p.name, {
             name: p.name,
             quantity: existing.quantity + p.quantity,
             revenue: existing.revenue + p.revenue
          });
       } else {
          combinedTopProductsMap.set(p.name, { ...p });
       }
    });
    const combinedTopProducts = Array.from(combinedTopProductsMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);

    // Process payment breakdown with robust fallbacks
    const paymentBreakdown = { CASH: 0, CARD: 0, UPI: 0, MIXED: 0, CREDIT: 0 };
    const rawPayments = salesStats[0]?.payments || [];

    rawPayments.forEach((p: any) => {
      const mode = (p._id || "CASH").toUpperCase();
      if (mode === "MIXED") {
        // For mixed, use specific details if they exist
        paymentBreakdown.CASH += p.cashSum || 0;
        paymentBreakdown.CARD += p.cardSum || 0;
        paymentBreakdown.UPI += p.upiSum || 0;
        paymentBreakdown.MIXED += p.total;
      } else if (paymentBreakdown.hasOwnProperty(mode)) {
        // For single modes, if specific sum is missing, fallback to the total netPayable
        const amount = p.total || 0;
        (paymentBreakdown as any)[mode] += amount;
      }
    });

    const stats: PharmaDashboardStats = {
      totalProducts: productStats[0]?.total[0]?.count || 0,
      lowStockCount: productStats[0]?.lowStock[0]?.count || 0,
      outOfStockCount: productStats[0]?.outOfStock[0]?.count || 0,
      expiringSoonCount: productStats[0]?.expiringSoon[0]?.count || 0,
      todaySales: combinedToday.total || 0,
      todayInvoices: combinedToday.count || 0,
      todayItemsSold: combinedToday.itemsSold || 0,
      monthlyRevenue: combinedMonth.total || 0,
      monthlyInvoices: combinedMonth.count || 0,
      monthlyItemsSold: combinedMonth.itemsSold || 0,
      requestedSales: combinedRequested.total || 0,
      requestedInvoices: combinedRequested.count || 0,
      requestedItemsSold: combinedRequested.itemsSold || 0,
      pendingInvoices: 0,
      paymentBreakdown,
      topProducts: combinedTopProducts || [],
      leastSellingWithExpiry: leastSellingRaw || [],
      timestamp: new Date().toISOString(),
    };

    // ✅ PERFORMANCE FIX: Reduced cache from 30min to 1min (60 seconds) for real-time feel
    await redisService.set(cacheKey, stats, 60);
    return stats;
  }

  /**
   * Get products with optimized pagination and cache
   */
  async getProducts(pharmacyId: string, options: any) {
    const { page = 1, limit = 50, search, status } = options;
    const skip = (page - 1) * limit;

    const query: any = { pharmacy: pharmacyId, isActive: true };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { brand: { $regex: search, $options: "i" } },
        { generic: { $regex: search, $options: "i" } },
      ];
    }

    if (status === "Low Stock") {
      query.stock = { $gt: 0 };
      query.$expr = { $lte: ["$stock", "$minStock"] };
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort({ brand: 1 })
        .skip(skip)
        .limit(limit)
        .populate("supplier", "name")
        .lean(),
      Product.countDocuments(query),
    ]);

    return { products, total };
  }
}

export const pharmaService = new PharmaService();
export default pharmaService;
