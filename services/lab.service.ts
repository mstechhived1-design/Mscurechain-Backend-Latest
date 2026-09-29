import LabOrder from "../Lab/Models/LabOrder.js";
import DirectLabOrder from "../Lab/Models/DirectLabOrder.js";
import LabTest from "../Lab/Models/LabTest.js";
import Department from "../Lab/Models/Department.js";
import redisService from "../config/redis.js";
import mongoose from "mongoose";

export interface LabDashboardStats {
  revenue: number;
  totalOrders: number;
  completedTests: number;
  pendingTests: number;
  totalTests: number;
  timestamp: string;
}

export class LabService {
  /**
   * Get optimized lab dashboard stats
   */
  async getDashboardStats(
    hospitalId: any,
    range: string = "today",
    useCache: boolean = true,
    startDateStr?: string,
    endDateStr?: string,
  ): Promise<any> {
    const cacheKey = `lab:dashboard:stats:${hospitalId || "all"}:${range}${range === "custom" ? `:${startDateStr}:${endDateStr}` : ""}`;

    if (useCache && range !== "custom") {
      const cached = await redisService.get<any>(cacheKey);
      if (cached) return cached;
    }

    const now = new Date();
    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    let endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const matchQuery: any = {};

    if (range === "7days") {
      startDate.setDate(now.getDate() - 7);
      matchQuery.createdAt = { $gte: startDate };
    } else if (range === "1month") {
      startDate.setMonth(now.getMonth() - 1);
      matchQuery.createdAt = { $gte: startDate };
    } else if (range === "custom" && startDateStr && endDateStr) {
      const parsedStart = new Date(startDateStr);
      parsedStart.setHours(0, 0, 0, 0);
      const parsedEnd = new Date(endDateStr);
      parsedEnd.setHours(23, 59, 59, 999);
      matchQuery.createdAt = { $gte: parsedStart, $lte: parsedEnd };
    } else {
      matchQuery.createdAt = { $gte: startDate };
    }
    if (hospitalId && mongoose.Types.ObjectId.isValid(hospitalId)) {
      matchQuery.hospital = new mongoose.Types.ObjectId(hospitalId);
    }

    const hospitalQuery: any = {};
    if (hospitalId && mongoose.Types.ObjectId.isValid(hospitalId)) {
      hospitalQuery.hospital = new mongoose.Types.ObjectId(hospitalId);
    }

    const [
      revenueData,
      directRevenueData,
      totalOrders,
      directOrders,
      completedCount,
      directCompleted,
      pendingCount,
      directPending,
      testMasterCount,
      deptCount,
      paymentData,
      topTests,
    ] = await Promise.all([
      LabOrder.aggregate([
        { $match: { ...matchQuery, paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
      DirectLabOrder.aggregate([
        { $match: { ...matchQuery, paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$finalAmount" } } },
      ]),
      LabOrder.countDocuments(matchQuery),
      DirectLabOrder.countDocuments(matchQuery),
      LabOrder.countDocuments({ ...matchQuery, status: "completed" }),
      DirectLabOrder.countDocuments({ ...matchQuery, status: "completed" }),
      LabOrder.countDocuments({
        ...hospitalQuery,
        status: { $in: ["prescribed", "sample_collected", "processing"] },
      }),
      DirectLabOrder.countDocuments({
        ...hospitalQuery,
        status: {
          $in: ["registered", "paid", "sample_collected", "processing"],
        },
      }),
      // Count all active tests (these are GLOBAL, not hospital-specific)
      LabTest.countDocuments({ isActive: { $ne: false } }),
      // Count all departments (these are GLOBAL, not hospital-specific)
      Department.countDocuments({ isActive: { $ne: false } }),
      LabOrder.aggregate([
        { $match: { ...matchQuery, paymentStatus: "paid" } },
        {
          $lookup: {
            from: "transactions",
            localField: "invoiceId",
            foreignField: "_id",
            as: "transaction",
          },
        },
        { $unwind: "$transaction" },
        {
          $group: {
            _id: null,
            Cash: {
              $sum: {
                $cond: [
                  { $eq: ["$transaction.paymentMode", "cash"] },
                  "$totalAmount",
                  { $ifNull: ["$transaction.paymentDetails.cash", 0] },
                ],
              },
            },
            UPI: {
              $sum: {
                $cond: [
                  { $eq: ["$transaction.paymentMode", "upi"] },
                  "$totalAmount",
                  { $ifNull: ["$transaction.paymentDetails.upi", 0] },
                ],
              },
            },
            Card: {
              $sum: {
                $cond: [
                  { $eq: ["$transaction.paymentMode", "card"] },
                  "$totalAmount",
                  { $ifNull: ["$transaction.paymentDetails.card", 0] },
                ],
              },
            },
          },
        },
      ]),
      // Add DirectLabOrder payment breakdown too?
      // For now let's focus on basic revenue
      LabOrder.aggregate([
        { $match: matchQuery },
        { $unwind: "$tests" },
        { $group: { _id: "$tests.test", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "labtests",
            localField: "_id",
            foreignField: "_id",
            as: "test",
          },
        },
        { $unwind: "$test" },
        { $project: { name: "$test.testName", count: 1 } },
      ]),
    ]);

    const totalRevenue =
      (revenueData[0]?.total || 0) + (directRevenueData[0]?.total || 0);
    const totalOrdersCount = (totalOrders || 0) + (directOrders || 0);
    const totalCompletedCount = (completedCount || 0) + (directCompleted || 0);
    const totalPendingCount = (pendingCount || 0) + (directPending || 0);

    const paymentBreakdown = {
      Cash: paymentData[0]?.Cash || 0,
      UPI: paymentData[0]?.UPI || 0,
      Card: paymentData[0]?.Card || 0,
    };

    const stats = {
      revenue: totalRevenue,
      collections: totalRevenue,
      patients: totalOrdersCount,
      totalTests: totalOrdersCount,
      totalCompleted: totalCompletedCount,
      totalTestMaster: testMasterCount,
      totalDepartments: deptCount,
      pendingSamples: totalPendingCount,
      paymentBreakdown,
      topTests: topTests.map((t) => ({ ...t, revenue: 0 })),
      timestamp: new Date().toISOString(),
    };

    await redisService.set(cacheKey, stats, 300);
    return stats;
  }

  /**
   * Clear dashboard cache for a hospital
   */
  async clearDashboardCache(hospitalId: any): Promise<void> {
    const id = hospitalId?.toString() || "all";
    // Clear specific hospital cache
    await redisService.delPattern(`lab:dashboard:stats:${id}:*`);
    // Also clear 'all' cache as it might be affected
    if (id !== "all") {
      await redisService.delPattern("lab:dashboard:stats:all:*");
    }
  }
}

export const labService = new LabService();
export default labService;
