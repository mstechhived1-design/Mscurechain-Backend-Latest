import Message from '../Messages/Models/Message.js';
import Notification from '../Notification/Models/Notification.js';
import Announcement from '../Notification/Models/Announcement.js';
import redisService from '../config/redis.js';
import mongoose from 'mongoose';

export interface CommunicationStats {
  unreadNotifications: number;
  unreadMessages: number;
  activeAnnouncements: number;
  timestamp: string;
}

export class CommunicationService {
  /**
   * Get optimized communication stats (unread counts)
   */
  async getUnreadStats(userId: string, hospitalId: string, useCache: boolean = true): Promise<CommunicationStats> {
    const cacheKey = `comm:stats:${userId}`;
    
    if (useCache) {
      const cached = await redisService.get<CommunicationStats>(cacheKey);
      if (cached) return cached;
    }

    const [
      unreadNotifications,
      unreadMessages,
      activeAnnouncements
    ] = await Promise.all([
      Notification.countDocuments({ recipient: userId, isRead: false }),
      Message.countDocuments({ receiver: userId, isRead: false }),
      Announcement.countDocuments({ 
        hospital: hospitalId, 
        expiresAt: { $gt: new Date() } 
      })
    ]);

    const stats: CommunicationStats = {
      unreadNotifications,
      unreadMessages,
      activeAnnouncements,
      timestamp: new Date().toISOString()
    };

    await redisService.set(cacheKey, stats, 60); // 1 min cache (needs to be fresh)
    return stats;
  }

  /**
   * Clear cache for a user's communication stats
   */
  async invalidateUserStats(userId: string) {
    await redisService.del(`comm:stats:${userId}`);
  }
}

export const communicationService = new CommunicationService();
export default communicationService;
