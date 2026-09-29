import EmergencyRequest from '../Emergency/Models/EmergencyRequest.js';
import AmbulancePersonnel from '../Emergency/Models/AmbulancePersonnel.js';
import redisService from '../config/redis.js';
import mongoose from 'mongoose';

export interface EmergencyDashboardStats {
  activeRequests: number;
  pendingRequests: number;
  completedToday: number;
  availableAmbulances: number;
  avgResponseTime: number; // in minutes
  timestamp: string;
}

export class EmergencyService {
  /**
   * Get optimized emergency dashboard stats
   */
  async getDashboardStats(hospitalId: string, useCache: boolean = true): Promise<EmergencyDashboardStats> {
    const cacheKey = `emergency:dashboard:stats:${hospitalId}`;
    
    if (useCache) {
      const cached = await redisService.get<EmergencyDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      activeRequests,
      pendingRequests,
      completedToday,
      availableAmbulances
    ] = await Promise.all([
      EmergencyRequest.countDocuments({ "requestedHospitals.hospital": hospitalId, status: 'active' }),
      EmergencyRequest.countDocuments({ "requestedHospitals.hospital": hospitalId, status: 'pending' }),
      EmergencyRequest.countDocuments({ 
        "requestedHospitals.hospital": hospitalId, 
        status: 'completed', 
        updatedAt: { $gte: startOfDay } 
      }),
      (AmbulancePersonnel.countDocuments({ hospital: hospitalId, status: 'active' }) as any).unscoped() // Changed isAvailable to status: 'active' as per schema
    ]);

    const stats: EmergencyDashboardStats = {
      activeRequests,
      pendingRequests,
      completedToday,
      availableAmbulances,
      avgResponseTime: 0, // Implement if needed
      timestamp: new Date().toISOString()
    };

    await redisService.set(cacheKey, stats, 120); // 2 min cache (needs to be very fresh)
    return stats;
  }
}

export const emergencyService = new EmergencyService();
export default emergencyService;
