// Cache Invalidation Helper for Real-time Updates
import redisService from "../config/redis.js";

/**
 * Invalidate doctor dashboard cache when appointments change
 * This ensures real-time WebSocket updates aren't blocked by stale cache
 */
export async function invalidateDoctorCache(doctorUserId: string | undefined) {
  if (!doctorUserId) return;

  try {
    const patterns = [
      `doctor:dashboard:${doctorUserId}`,
      `doctor:profile:${doctorUserId}`,
      `api:*:${doctorUserId}:*/api/doctors/dashboard*`,
      `api:*:${doctorUserId}:*/api/doctors/me*`,
    ];

    for (const pattern of patterns) {
      await redisService.del(pattern);
    }

    console.log(
      `🗑️ [Cache] Invalidated doctor cache for user: ${doctorUserId}`,
    );
  } catch (err) {
    console.error("[Cache] Invalidation error:", err);
  }
}

/**
 * Invalidate appointment-related caches
 */
export async function invalidateAppointmentCache(appointmentId: string) {
  try {
    await redisService.delPattern(`*appointments*`);
    console.log(`🗑️ [Cache] Invalidated appointment caches`);
  } catch (err) {
    console.error("[Cache] Invalidation error:", err);
  }
}
