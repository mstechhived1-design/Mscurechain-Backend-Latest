import User from '../Auth/Models/User.js';
import Appointment from '../Appointment/Models/Appointment.js';
import Prescription from '../Prescription/Models/Prescription.js';
import LabToken from '../Lab/Models/LabToken.js';
import redisService from '../config/redis.js';
import mongoose from 'mongoose';

export interface PatientDashboardStats {
  totalAppointments: number;
  upcomingAppointmentsCount: number;
  totalPrescriptions: number;
  totalLabReports: number;
  lastConsultation: any | null;
  timestamp: string;
}

export class PatientService {
  /**
   * Get optimized patient dashboard stats
   */
  async getDashboardStats(patientId: string, useCache: boolean = true): Promise<PatientDashboardStats> {
    const cacheKey = `patient:dashboard:stats:${patientId}`;
    
    if (useCache) {
      const cached = await redisService.get<PatientDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const now = new Date();

    const [
      totalAppointments,
      upcomingAppointmentsCount,
      totalPrescriptions,
      totalLabReports,
      lastConsultation
    ] = await Promise.all([
      Appointment.countDocuments({ patient: patientId }),
      Appointment.countDocuments({ patient: patientId, date: { $gte: now }, status: 'scheduled' }),
      Prescription.countDocuments({ patient: patientId }),
      LabToken.countDocuments({ patient: patientId }),
      Appointment.findOne({ patient: patientId, status: 'completed' })
        .sort({ date: -1 })
        .populate('doctor', 'name')
        .lean()
    ]);

    const stats: PatientDashboardStats = {
      totalAppointments,
      upcomingAppointmentsCount,
      totalPrescriptions,
      totalLabReports,
      lastConsultation,
      timestamp: new Date().toISOString()
    };

    await redisService.set(cacheKey, stats, 600); // 10 min cache
    return stats;
  }
}

export const patientService = new PatientService();
export default patientService;
