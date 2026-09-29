import User from "../Auth/Models/User.js";
import Patient from "../Patient/Models/Patient.js";
import EmergencyRequest from "../Emergency/Models/EmergencyRequest.js";
import Appointment from "../Appointment/Models/Appointment.js";
// import HelpDesk from "../Helpdesk/Models/HelpDesk.js";
import redisService from "../config/redis.js";
import mongoose from "mongoose";

export interface HelpdeskDashboardStats {
  totalHelpdesks: number;
  totalDoctors: number;
  activeTransits: number;
  completedTransitsToday: number;
  pendingEmergencyRequests: number;
  totalPatientsRegistered: number;
  timestamp: string;
}

export class HelpdeskService {
  /**
   * Get optimized helpdesk dashboard stats
   */
  async getDashboardStats(
    hospitalId: string,
    useCache: boolean = true,
  ): Promise<HelpdeskDashboardStats> {
    const cacheKey = `helpdesk:dashboard:stats:${hospitalId}`;

    if (useCache) {
      const cached = await redisService.get<HelpdeskDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      totalHelpdesks,
      totalDoctors,
      activeTransits,
      completedTransitsToday,
      pendingEmergencyRequests,
      totalPatientsRegistered,
    ] = await Promise.all([
      User.countDocuments({ role: "helpdesk", hospital: hospitalId }),
      User.countDocuments({
        hospital: hospitalId,
        role: "doctor",
        status: "active",
      }),
      Appointment.countDocuments({
        hospital: hospitalId,
        sentToHelpdesk: true,
        transitStatus: { $ne: "delivered" },
      }),
      Appointment.countDocuments({
        hospital: hospitalId,
        transitStatus: "delivered",
        updatedAt: { $gte: startOfDay },
      }),
      EmergencyRequest.countDocuments({
        hospital: hospitalId,
        status: { $in: ["pending", "en-route"] },
      }),
      Patient.countDocuments({
        hospital: hospitalId,
        createdAt: { $gte: startOfDay },
      }),
    ]);

    const stats: HelpdeskDashboardStats = {
      totalHelpdesks,
      totalDoctors,
      activeTransits,
      completedTransitsToday,
      pendingEmergencyRequests,
      totalPatientsRegistered,
      timestamp: new Date().toISOString(),
    };

    await redisService.set(cacheKey, stats, 300); // 5 min cache
    return stats;
  }
}

export const helpdeskService = new HelpdeskService();
export default helpdeskService;
