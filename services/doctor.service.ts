import User from "../Auth/Models/User.js";
import Appointment from "../Appointment/Models/Appointment.js";
import Prescription from "../Prescription/Models/Prescription.js";
import Report from "../Report/Models/Report.js";
import DoctorProfile from "../Doctor/Models/DoctorProfile.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import LabToken from "../Lab/Models/LabToken.js";
import VitalsAlert from "../IPD/Models/VitalsAlert.js";
import redisService from "../config/redis.js";
import mongoose from "mongoose";

export interface DoctorDashboardStats {
  totalPatients: number;
  appointmentsToday: number;
  totalPendingQueue: number;
  pendingReports: number;
  activeInpatients: number;
  criticalAlerts: number;
  warningAlerts: number;
  consultationsValue: number;
  totalPrescriptions: number;
  totalLabTests: number;
  timestamp: string;
}

export interface DoctorAnalytics {
  appointmentTrend: Array<{ date: string; appointments: number }>;
  patientDistribution: {
    opd: number;
    ipd: number;
  };
  genderDistribution: {
    male: number;
    female: number;
    other: number;
  };
  ageDistribution: {
    junior: number; // 0-17
    adult: number; // 18-45
    senior: number; // 45+
  };
  performanceMetrics: {
    totalPrescriptions: number;
    totalLabTokens: number;
    avgConsultationTime: string;
    patientSatisfaction: number;
    activeTreatmentPlans: number;
  };
  diagnosisStats: Array<{ name: string; count: number }>;
  topMedicines: Array<{ name: string; count: number }>;
  visitTendency: {
    new: number;
    returning: number;
  };
}

export class DoctorService {
  /**
   * Get optimized doctor dashboard stats
   */
  async getDashboardStats(
    doctorProfileId: string,
    useCache: boolean = true,
  ): Promise<DoctorDashboardStats> {
    const cacheKey = `doctor:dashboard:stats:${doctorProfileId}`;

    if (useCache) {
      const cached = await redisService.get<DoctorDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const doctorProfile = await (DoctorProfile.findById(doctorProfileId) as any)
      .unscoped()
      .lean();
    const doctorUserId = doctorProfile?.user;
    const doctorHospitalId = (doctorProfile as any)?.hospital; // Used for hospital-scoped queries

    const [
      uniquePatients,
      totalPendingQueue,
      appointmentsToday,
      pendingReports,
      completedAppointmentsCount,
      activeInpatientsCount,
      criticalAlertsCount,
      warningAlertsCount,
    ] = await Promise.all([
      (
        Appointment.distinct("patient", { doctor: doctorProfileId }) as any
      ).unscoped(),
      (
        Appointment.countDocuments({
          doctor: doctorProfileId,
          status: {
            $in: ["pending", "confirmed", "in-progress", "Booked", "waiting"],
          },
          isPaused: { $ne: true },
        }) as any
      ).unscoped(),
      (
        Appointment.countDocuments({
          doctor: doctorProfileId,
          date: { $gte: today, $lt: tomorrow },
          status: { $ne: "cancelled" },
          isPaused: { $ne: true },
        }) as any
      ).unscoped(),
      doctorUserId
        ? (
          Report.countDocuments({
            doctor: doctorUserId,
            status: "pending",
          }) as any
        ).unscoped()
        : 0,
      (
        Appointment.countDocuments({
          doctor: doctorProfileId,
          date: { $gte: startOfMonth },
          status: "completed",
        }) as any
      ).unscoped(),
      (
        IPDAdmission.countDocuments({
          primaryDoctor: doctorProfileId,
          status: "Active", // Only Active. Once discharge is confirmed (Discharge Initiated), hide from Doctor's count.
        }) as any
      ).unscoped(),
      (
        VitalsAlert.countDocuments({
          assignedDoctor: doctorProfileId,
          status: "Active",
          severity: "Critical",
        }) as any
      ).unscoped(),
      (
        VitalsAlert.countDocuments({
          assignedDoctor: doctorProfileId,
          status: "Active",
          severity: "Warning",
        }) as any
      ).unscoped(),
    ]);

    const consultationFee = (doctorProfile as any)?.consultationFee || 500;
    const consultationsValue = completedAppointmentsCount * consultationFee;

    const stats: DoctorDashboardStats = {
      totalPatients: uniquePatients.length,
      appointmentsToday,
      totalPendingQueue,
      pendingReports,
      activeInpatients: activeInpatientsCount,
      criticalAlerts: criticalAlertsCount,
      warningAlerts: warningAlertsCount,
      consultationsValue,
      totalPrescriptions: await (
        Prescription.countDocuments({
          doctor: doctorProfileId,
        }) as any
      ).unscoped(),
      totalLabTests: await (
        Report.countDocuments({ doctor: doctorUserId }) as any
      ).unscoped(),
      timestamp: new Date().toISOString(),
    };

    await redisService.set(cacheKey, stats, 60); // 1 min cache
    return stats;
  }

  async getAnalytics(doctorProfileId: string): Promise<DoctorAnalytics> {
    const cacheKey = `doctor:analytics:${doctorProfileId}`;
    const cached = await redisService.get<DoctorAnalytics>(cacheKey);
    if (cached) return cached;

    const trailing30Days = new Date();
    trailing30Days.setDate(trailing30Days.getDate() - 30);

    const [
      prescriptionsCount,
      labTokensCount,
      trendData,
      demographicsData,
      clinicalDistribution,
      visitStats,
    ] = await Promise.all([
      (
        Prescription.countDocuments({ doctor: doctorProfileId }) as any
      ).unscoped(),
      (LabToken.countDocuments({ doctor: doctorProfileId }) as any).unscoped(),

      // 1. Trend & Distribution (last 30 days)
      Appointment.aggregate([
        {
          $match: {
            doctor: new mongoose.Types.ObjectId(doctorProfileId),
            date: { $gte: trailing30Days },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]) as any,

      // 2. Demographics (All-time unique patients)
      Appointment.aggregate([
        { $match: { doctor: new mongoose.Types.ObjectId(doctorProfileId) } },
        { $group: { _id: "$patient" } },
        {
          $lookup: {
            from: "patients",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $group: {
            _id: null,
            male: {
              $sum: {
                $cond: [{ $eq: [{ $toLower: "$user.gender" }, "male"] }, 1, 0],
              },
            },
            female: {
              $sum: {
                $cond: [
                  { $eq: [{ $toLower: "$user.gender" }, "female"] },
                  1,
                  0,
                ],
              },
            },
            other: {
              $sum: {
                $cond: [
                  { $in: [{ $toLower: "$user.gender" }, ["male", "female"]] },
                  0,
                  1,
                ],
              },
            },
            junior: {
              $sum: { $cond: [{ $lt: [{ $toInt: "$user.age" }, 18] }, 1, 0] },
            },
            adult: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: [{ $toInt: "$user.age" }, 18] },
                      { $lte: [{ $toInt: "$user.age" }, 45] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            senior: {
              $sum: { $cond: [{ $gt: [{ $toInt: "$user.age" }, 45] }, 1, 0] },
            },
          },
        },
      ]) as any,

      // 3. Clinical Distributions (Top Diagnosis & Meds)
      Prescription.aggregate([
        { $match: { doctor: new mongoose.Types.ObjectId(doctorProfileId) } },
        {
          $facet: {
            diagnoses: [
              { $group: { _id: "$diagnosis", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            medicines: [
              { $unwind: "$medicines" },
              { $group: { _id: "$medicines.name", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ]) as any,

      // 4. Inpatient/Outpatient & Loyalty
      Appointment.aggregate([
        { $match: { doctor: new mongoose.Types.ObjectId(doctorProfileId) } },
        {
          $group: {
            _id: null,
            totalVisits: { $sum: 1 },
            uniquePatients: { $addToSet: "$patient" },
            ipd: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      {
                        $toUpper: {
                          $ifNull: ["$type", { $ifNull: ["$visitType", ""] }],
                        },
                      },
                      ["IPD", "INPATIENT", "EMERGENCY", "WARD", "ADMISSION"],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $project: {
            totalVisits: 1,
            ipd: 1,
            opd: { $subtract: ["$totalVisits", "$ipd"] },
            uniquePatientsCount: { $size: "$uniquePatients" },
          },
        },
      ]) as any,
    ]);

    // Format Trend Map
    const trendMap = new Map();
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      trendMap.set(d.toISOString().split("T")[0], 0);
    }

    if (Array.isArray(trendData)) {
      trendData.forEach((d: any) => {
        if (d?._id) trendMap.set(d._id, d.count || 0);
      });
    }

    const appointmentTrend = Array.from(trendMap.entries())
      .map(([date, count]) => ({ date, appointments: count }))
      .reverse();

    const dStats = (demographicsData && demographicsData[0]) || {
      male: 0,
      female: 0,
      other: 0,
      junior: 0,
      adult: 0,
      senior: 0,
    };

    const vStats = (visitStats && visitStats[0]) || {
      totalVisits: 0,
      ipd: 0,
      opd: 0,
      uniquePatientsCount: 0,
    };

    const cStats = (clinicalDistribution && clinicalDistribution[0]) || {
      diagnoses: [],
      medicines: [],
    };

    const analytics: DoctorAnalytics = {
      appointmentTrend,
      patientDistribution: {
        opd: vStats.opd || 0,
        ipd: vStats.ipd || 0,
      },
      genderDistribution: {
        male: dStats.male || 0,
        female: dStats.female || 0,
        other: dStats.other || 0,
      },
      ageDistribution: {
        junior: dStats.junior || 0,
        adult: dStats.adult || 0,
        senior: dStats.senior || 0,
      },
      performanceMetrics: {
        totalPrescriptions: prescriptionsCount || 0,
        totalLabTokens: labTokensCount || 0,
        avgConsultationTime: "14m",
        patientSatisfaction: 4.8,
        activeTreatmentPlans: prescriptionsCount || 0,
      },
      diagnosisStats: (cStats.diagnoses || []).map((d: any) => ({
        name: d._id || "Unknown",
        count: d.count || 0,
      })),
      topMedicines: (cStats.medicines || []).map((m: any) => ({
        name: m._id || "Unknown",
        count: m.count || 0,
      })),
      visitTendency: {
        new: vStats.uniquePatientsCount || 0,
        returning: Math.max(
          0,
          (vStats.totalVisits || 0) - (vStats.uniquePatientsCount || 0),
        ),
      },
    };

    await redisService.set(cacheKey, analytics, 300); // 5 min cache
    return analytics;
  }
}

export const doctorService = new DoctorService();
export default doctorService;
