import StaffProfile from '../Staff/Models/StaffProfile.js';
import Attendance from '../Staff/Models/Attendance.js';
import Leave from '../Leave/Models/Leave.js';
import Shift from '../Staff/Models/Shift.js';
import User from '../Auth/Models/User.js';
import redisService from '../config/redis.js';
import mongoose from 'mongoose';

export interface StaffDashboardStats {
  totalStaff: number;
  presentToday: number;
  onLeave: number;
  lateToday: number;
  pendingLeaves: number;
  activeShifts: number;
  timestamp: string;
}

export class StaffService {
  /**
   * Get optimized staff/HR dashboard stats
   */
  async getDashboardStats(hospitalId: string, useCache: boolean = true): Promise<StaffDashboardStats> {
    const cacheKey = `staff:dashboard:stats:${hospitalId}`;

    if (useCache) {
      const cached = await redisService.get<StaffDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const istOffset = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + istOffset);
    
    const today = new Date(Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      0, 0, 0, 0
    ));
    
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60000);

    const [
      totalStaff,
      attendanceToday,
      onLeaveCount,
      pendingLeaves,
      activeShifts
    ] = await Promise.all([
      User.countDocuments({
        hospital: hospitalId,
        role: { $in: ['staff', 'doctor', 'nurse', 'emergency', 'helpdesk'] },
        status: 'active'
      }),
      Attendance.find({
        hospital: hospitalId,
        date: { $gte: today, $lt: tomorrow }
      }).lean(),
      Leave.countDocuments({
        hospital: hospitalId,
        status: 'approved',
        startDate: { $lte: today },
        endDate: { $gte: today }
      }),
      Leave.countDocuments({
        hospital: hospitalId,
        status: 'pending'
      }),
      Shift.countDocuments({ hospital: hospitalId })
    ]);

    const presentCount = attendanceToday.filter(a => a.status === 'present').length;
    const lateCount = attendanceToday.filter(a => a.status === 'late').length;

    const stats: StaffDashboardStats = {
      totalStaff,
      presentToday: presentCount,
      onLeave: onLeaveCount,
      lateToday: lateCount,
      pendingLeaves,
      activeShifts,
      timestamp: new Date().toISOString()
    };

    await redisService.set(cacheKey, stats, 300); // 5 min cache
    return stats;
  }

  /**
   * Get staff list with optimized lookup
   */
  async getStaffList(hospitalId: string, filters: any = {}) {
    const query: any = { hospital: hospitalId };
    if (filters.department) query.department = filters.department;
    if (filters.role) query.role = filters.role;

    const staff = await StaffProfile.find(query)
      .populate('user', 'name email mobile role status')
      .populate('shift', 'name startTime endTime')
      .lean();

    return staff;
  }
}

export const staffService = new StaffService();
export default staffService;
