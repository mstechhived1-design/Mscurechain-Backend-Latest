import SupportRequest from '../Support/Models/SupportRequest.js';
import redisService from '../config/redis.js';
import mongoose from 'mongoose';

export interface SupportDashboardStats {
  totalRequests: number;
  openRequests: number;
  inProgressRequests: number;
  resolvedToday: number;
  avgResolutionTime: number; // in hours
  timestamp: string;
}

export class SupportService {
  /**
   * Get optimized support dashboard stats
   */
  async getDashboardStats(hospitalId?: string, useCache: boolean = true): Promise<SupportDashboardStats> {
    const cacheKey = hospitalId ? `support:dashboard:stats:${hospitalId}` : `support:dashboard:stats:global`;
    
    if (useCache) {
      const cached = await redisService.get<SupportDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const query: any = hospitalId ? { hospital: hospitalId } : {};
    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      totalRequests,
      openRequests,
      inProgressRequests,
      resolvedToday,
    ] = await Promise.all([
      SupportRequest.countDocuments(query),
      SupportRequest.countDocuments({ ...query, status: 'open' }),
      SupportRequest.countDocuments({ ...query, status: 'in-progress' }),
      SupportRequest.countDocuments({ ...query, status: 'resolved', updatedAt: { $gte: startOfDay } })
    ]);

    const stats: SupportDashboardStats = {
      totalRequests,
      openRequests,
      inProgressRequests,
      resolvedToday,
      avgResolutionTime: 0, // Implement based on historical data if needed
      timestamp: new Date().toISOString()
    };

    await redisService.set(cacheKey, stats, 600); // 10 min cache
    return stats;
  }
}

export const supportService = new SupportService();
export default supportService;
