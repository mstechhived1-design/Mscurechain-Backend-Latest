import PatientProfile from "../Patient/Models/PatientProfile.js";
import Appointment from "../Appointment/Models/Appointment.js";
import Hospital from "../Hospital/Models/Hospital.js";
import Bed from "../IPD/Models/Bed.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import redisService from "../config/redis.js";
import mongoose from "mongoose";

export interface NurseDashboardStats {
  activePatients: number;
  patientsInWard: number; // Occupied beds
  availableBeds: number; // Vacant beds
  pendingVitals: number;
  completedVitalsToday: number;
  timestamp: string;
}

export class NurseService {
  /**
   * Get optimized nurse dashboard stats
   */
  async getDashboardStats(
    hospitalId: string,
    department?: string,
    useCache: boolean = true,
  ): Promise<NurseDashboardStats> {
    const cacheKey = `nurse:dashboard:stats:${hospitalId}:${department || "all"}`;

    if (useCache) {
      const cached = await redisService.get<NurseDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let query: any = { hospital: hospitalId };
    if (department) {
      const searchTerms: string[] = [department.trim()];
      if (department.toLowerCase().includes("ward")) {
        searchTerms.push(department.replace(/ward/i, "").trim());
      }
      const deptRegex = new RegExp(
        searchTerms
          .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|"),
        "i",
      );
      query.$or = [
        { department: deptRegex },
        { ward: deptRegex },
        { type: deptRegex },
      ];
    }

    const [occupiedBeds, vacantBeds] = await Promise.all([
      Bed.countDocuments({ ...query, status: "Occupied" }),
      Bed.countDocuments({ ...query, status: "Vacant" }),
    ]);

    let activePatientsCount = 0;
    if (department) {
      activePatientsCount = occupiedBeds;
    } else {
      activePatientsCount = await IPDAdmission.countDocuments({
        hospital: hospitalId,
        status: "Active",
      });
    }

    const [pendingVitalsCount, completedToday] = await Promise.all([
      Appointment.countDocuments({ hospital: hospitalId, status: "scheduled" }),
      Appointment.countDocuments({
        hospital: hospitalId,
        status: "in-progress",
        updatedAt: { $gte: startOfDay },
      }),
    ]);

    const stats: NurseDashboardStats = {
      activePatients: activePatientsCount,
      patientsInWard: occupiedBeds,
      availableBeds: vacantBeds,
      pendingVitals: pendingVitalsCount,
      completedVitalsToday: completedToday,
      timestamp: new Date().toISOString(),
    };

    await redisService.set(cacheKey, stats, 300); // 5 min cache
    return stats;
  }
}

export const nurseService = new NurseService();
export default nurseService;
