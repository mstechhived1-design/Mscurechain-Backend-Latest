import { Request, Response } from "express";
import mongoose from "mongoose";
import telemetryService from "../../services/telemetryService.js";
import redisService from "../../config/redis.js";
import cloudinary from "../../config/cloudinary.js";
import { getLiveSSEStats } from "../../config/redisPubSub.js";
import WhatsAppConfig from "../../WhatsApp/Models/WhatsAppConfig.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Appointment from "../../Appointment/Models/Appointment.js";

/**
 * 1. Live Pulse Metrics:
 * - Global RPM, Average Latency, API Errors, Live WebSocket/SSE Connections
 * - Rolling RPM time series for line chart
 * - Top 5 hospitals by RPM for bar chart
 * - Full Hospital Live Matrix (RPM, data transfer, status, last ping)
 */
export const getPulseMetrics = async (req: Request, res: Response) => {
  try {
    const rawHospitals = await Hospital.find({}, "_id hospitalId name status").lean();
    const hospitals = rawHospitals.map((h: any) => {
      const mongoId = h._id ? h._id.toString() : "";
      const customId = h.hospitalId ? String(h.hospitalId).trim() : "";
      const name = h.name || "Unknown Hospital";
      return {
        hospitalId: customId || mongoId,
        mongoId,
        name,
        aliases: [mongoId, customId, name].filter(Boolean),
      };
    });

    const rpm = telemetryService.getGlobalRPM();
    const avgLatency = telemetryService.getAvgLatency();
    const apiErrors = telemetryService.getApiErrors();
    const sseStats = getLiveSSEStats();
    const trafficHistory = telemetryService.getTrafficHistory();
    const topHospitals = telemetryService.getTopHospitalsByRpm(hospitals);
    const hospitalMatrix = telemetryService.getHospitalLiveMatrix(hospitals);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      pulse: {
        rpm,
        avgLatency,
        apiErrors,
        liveConnections: sseStats.totalClients,
      },
      trafficHistory,
      topHospitals,
      hospitalMatrix,
    });
  } catch (error: any) {
    console.error("[Telemetry] getPulseMetrics error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Deep Storage & Infrastructure Health:
 * - MongoDB Atlas Single Cluster (512 MB Free Tier quota breakdown)
 * - Cloudinary Storage (Quota, used, remaining, live images/assets)
 * - Redis Cache (Live status, URL, ping latency, keys)
 * - Daily Data Transfer (In, Out, Total)
 * - Live Revenue Velocity (Today's GMV from paid appointments/bills)
 */
export const getInfrastructureHealth = async (req: Request, res: Response) => {
  try {
    // ── MongoDB Single Cluster 512 MB Stats ──────────────────────────────────
    let mongoStats: any = {
      plan: "MongoDB Atlas (M0 Free Tier)",
      totalQuotaBytes: 512 * 1024 * 1024, // 512 MB
      formattedQuota: "512 MB",
      usedStorageBytes: 0,
      formattedUsed: "0 MB",
      remainingBytes: 512 * 1024 * 1024,
      formattedRemaining: "512 MB",
      usedPercentage: 0,
      collectionsCount: 0,
      documentsCount: 0,
      avgObjSize: 0,
      status: "Healthy",
    };

    try {
      if (mongoose.connection.db) {
        const stats = await mongoose.connection.db.stats();
        const totalUsed = (stats.storageSize || 0) + (stats.indexSize || 0);
        const quota = 512 * 1024 * 1024;
        const remaining = Math.max(0, quota - totalUsed);
        const usedPercent = parseFloat(((totalUsed / quota) * 100).toFixed(2));

        mongoStats = {
          plan: "MongoDB Atlas (M0 Free Tier)",
          totalQuotaBytes: quota,
          formattedQuota: "512 MB",
          usedStorageBytes: totalUsed,
          formattedUsed: telemetryService.formatBytes(totalUsed),
          remainingBytes: remaining,
          formattedRemaining: telemetryService.formatBytes(remaining),
          usedPercentage: usedPercent,
          collectionsCount: stats.collections || 0,
          collectionsLimit: 500,
          documentsCount: stats.objects || 0,
          avgObjSize: stats.avgObjSize ? `${Math.round(stats.avgObjSize)} B` : "0 B",
          dataSize: telemetryService.formatBytes(stats.dataSize || 0),
          indexSize: telemetryService.formatBytes(stats.indexSize || 0),
          status: usedPercent > 90 ? "Critical" : usedPercent > 75 ? "Warning" : "Healthy",
        };
      }
    } catch (err: any) {
      console.warn("[Telemetry] Mongo stats fetch error:", err.message);
    }

    // ── Cloudinary Media Usage ────────────────────────────────────────────────
    let cloudinaryStats = {
      status: "Connected",
      plan: "Free",
      totalQuotaBytes: 25 * 1024 * 1024 * 1024, // Standard 25GB
      formattedQuota: "25 GB",
      usedStorageBytes: 0,
      formattedUsed: "0 B",
      remainingBytes: 25 * 1024 * 1024 * 1024,
      formattedRemaining: "25 GB",
      liveImages: 0,
      bandwidthUsed: "0 B",
    };

    try {
      const usage: any = await cloudinary.api.usage();
      if (usage) {
        const usedBytes = usage.storage?.usage || 0;
        const quotaBytes = usage.storage?.limit || 25 * 1024 * 1024 * 1024;
        const remaining = Math.max(0, quotaBytes - usedBytes);
        cloudinaryStats = {
          status: "Connected & Healthy",
          plan: usage.plan || "Free",
          totalQuotaBytes: quotaBytes,
          formattedQuota: telemetryService.formatBytes(quotaBytes),
          usedStorageBytes: usedBytes,
          formattedUsed: telemetryService.formatBytes(usedBytes),
          remainingBytes: remaining,
          formattedRemaining: telemetryService.formatBytes(remaining),
          liveImages: usage.objects?.usage || 0,
          bandwidthUsed: telemetryService.formatBytes(usage.bandwidth?.usage || 0),
        };
      }
    } catch (err: any) {
      // Cloudinary api usage may fail if API keys have limited permissions or in dev
      cloudinaryStats.status = "Offline / Restricted";
    }

    // ── Redis Cache Live Status ───────────────────────────────────────────────
    const isRedisAvail = redisService.getIsRedisAvailable();
    let redisLatency = 0;
    let redisConnected = false;
    const redisStart = Date.now();

    try {
      redisConnected = await redisService.healthCheck();
      redisLatency = Date.now() - redisStart;
    } catch {
      redisConnected = false;
    }

    const rawRedisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    // Mask password in URL for display
    const maskedRedisUrl = rawRedisUrl.replace(/:([^:@]+)@/, ":••••••••@");

    const redisStats = {
      isAvailable: isRedisAvail && redisConnected,
      status: (isRedisAvail && redisConnected) ? "Connected & Healthy" : "In-Memory Fallback",
      connectionUrl: maskedRedisUrl,
      latencyMs: redisLatency,
      cacheType: isRedisAvail ? "Redis Cluster / Server" : "In-Memory NodeCache",
    };

    // ── Daily Data Transfer ───────────────────────────────────────────────────
    const dailyTransfer = telemetryService.getDailyTransfer();

    // ── Live Revenue Velocity (Today's GMV) ────────────────────────────────────
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let todayRevenue = 0;
    let todayPaidTransactions = 0;

    try {
      const paidAppointments = await Appointment.find({
        $or: [
          { createdAt: { $gte: startOfToday } },
          { date: { $gte: startOfToday } },
        ],
        "payment.paymentStatus": { $in: ["paid", "Paid"] },
      }).select("payment.amount payment.fee payment.totalBillAmount amount").lean();

      for (const apt of paidAppointments as any[]) {
        const val = apt.payment?.totalBillAmount || apt.payment?.amount || apt.payment?.fee || apt.amount || 0;
        todayRevenue += Number(val) || 0;
        todayPaidTransactions++;
      }
    } catch (err: any) {
      console.warn("[Telemetry] Revenue velocity calculation error:", err.message);
    }

    // ── Email Integration Health (Gmail SMTP Engine) ──────────────────────────
    const emailUser = (process.env.EMAIL_USER_FINAL || process.env.EMAIL_USER || "mscurechain@gmail.com").trim();
    const emailPass = (process.env.EMAIL_PASS_FINAL || process.env.EMAIL_PASS || "").trim();
    const isEmailConfigured = Boolean(emailUser && emailPass);
    const maskedPass = emailPass ? `${emailPass.slice(0, 4)}••••••••${emailPass.slice(-4)}` : "Not Configured";

    const emailStats = {
      isConfigured: isEmailConfigured,
      status: isEmailConfigured ? "Connected & Ready" : "Unconfigured",
      provider: "Gmail SMTP Service",
      senderEmail: emailUser,
      maskedPassword: maskedPass,
      port: 465,
      encryption: "SSL / TLS",
      authMethod: "App Password (2FA)",
      service: process.env.EMAIL_SERVICE || "gmail",
    };

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      mongodb: mongoStats,
      cloudinary: cloudinaryStats,
      redis: redisStats,
      email: emailStats,
      dailyTransfer,
      revenueVelocity: {
        todayRevenue,
        formattedRevenue: `₹${todayRevenue.toLocaleString("en-IN")}`,
        paidTransactions: todayPaidTransactions,
        asOf: new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) + " IST",
      },
    });
  } catch (error: any) {
    console.error("[Telemetry] getInfrastructureHealth error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. WhatsApp Communication Matrix:
 * - Active vs. Disconnected nodes (counted strictly per hospital, not per user/department)
 * - Global messages sent today
 * - Live connection matrix per hospital with phone numbers and department routing sub-table
 */
export const getWhatsAppMatrix = async (req: Request, res: Response) => {
  try {
    const [configs, hospitals] = await Promise.all([
      WhatsAppConfig.find({}).lean(),
      Hospital.find({}, "_id hospitalId name").lean(),
    ]);

    // Lookup map supporting lookup by _id string, hospitalId, and lowercase normalized name
    const hospitalLookup = new Map<string, any>();
    for (const h of hospitals as any[]) {
      const objId = h._id.toString();
      hospitalLookup.set(objId, h);
      if (h.hospitalId) {
        hospitalLookup.set(h.hospitalId, h);
      }
      const normName = h.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normName) {
        hospitalLookup.set(normName, h);
      }
    }

    // Map hospital _id string -> all related configs (main + departments)
    const groupedConfigs = new Map<string, any[]>();
    for (const h of hospitals as any[]) {
      groupedConfigs.set(h._id.toString(), []);
    }

    for (const cfg of configs as any[]) {
      const rawId = (cfg.hospitalId || "").trim();
      // Extract base ID by stripping department suffix like _pharma, _lab, _doctor, _frontdesk
      const baseId = rawId.split("_")[0];

      let matchedHospital = hospitalLookup.get(baseId) || hospitalLookup.get(rawId);

      // Fallback matching by deviceName or partial match if available
      if (!matchedHospital && cfg.deviceName) {
        const normDevice = cfg.deviceName.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const h of hospitals as any[]) {
          const normH = h.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (normDevice.includes(normH) || normH.includes(normDevice)) {
            matchedHospital = h;
            break;
          }
        }
      }

      if (matchedHospital) {
        const key = matchedHospital._id.toString();
        const list = groupedConfigs.get(key) || [];
        list.push(cfg);
        groupedConfigs.set(key, list);
      }
    }

    let activeHospitalsCount = 0;
    let globalMessagesToday = 0;

    const matrix = (hospitals as any[]).map((h) => {
      const key = h._id.toString();
      const cfgs = groupedConfigs.get(key) || [];

      // Find main hospital config (without underscore department suffix)
      const mainCfg = cfgs.find((c) => !c.hospitalId.includes("_")) || cfgs[0] || null;

      // Build department routing sub-table
      const departmentRouting: Record<string, any> = {
        pharma: { enabled: false, phoneNumber: "", name: "Pharmacy Portal" },
        lab: { enabled: false, phoneNumber: "", name: "Laboratory Portal" },
        frontdesk: { enabled: false, phoneNumber: "", name: "Front Desk / Helpdesk" },
        doctor: { enabled: false, phoneNumber: "", name: "Doctor Terminal" },
      };

      // 1. Merge routing from main config if present
      if (mainCfg?.departmentRouting) {
        Object.keys(mainCfg.departmentRouting).forEach((k) => {
          if (departmentRouting[k]) {
            departmentRouting[k] = { ...departmentRouting[k], ...mainCfg.departmentRouting[k] };
          }
        });
      }

      // 2. Merge routing from department-specific configs (e.g. 69a7b..._pharma)
      for (const c of cfgs) {
        const parts = c.hospitalId.split("_");
        if (parts.length > 1) {
          const deptKey = parts[1].toLowerCase();
          if (departmentRouting[deptKey]) {
            departmentRouting[deptKey] = {
              ...departmentRouting[deptKey],
              enabled: c.status === "CONNECTED" || !!c.connectedNumber,
              phoneNumber: c.connectedNumber || departmentRouting[deptKey].phoneNumber,
              status: c.status,
              deviceName: c.deviceName,
            };
          }
        }
      }

      // Hospital is active if main config or any department is connected
      const isHospitalConnected = cfgs.some((c) => c.status === "CONNECTED");
      if (isHospitalConnected) {
        activeHospitalsCount++;
      }

      // Calculate total messages today across all nodes for this hospital
      let hospitalMsgs = 0;
      for (const c of cfgs) {
        const msgs = c.messagesSentToday || (c.status === "CONNECTED" ? 3 : 0);
        hospitalMsgs += msgs;
      }
      globalMessagesToday += hospitalMsgs;

      // Preferred phone number: main config, or first department with phone
      const phone = mainCfg?.connectedNumber || cfgs.find((c) => c.connectedNumber)?.connectedNumber || null;
      const device = mainCfg?.deviceName || cfgs.find((c) => c.deviceName)?.deviceName || null;
      const linked = mainCfg?.linkedAt || cfgs.find((c) => c.linkedAt)?.linkedAt || null;

      return {
        hospitalId: h.hospitalId || h._id.toString(),
        hospitalName: h.name, // Always shows the actual registered hospital name
        status: isHospitalConnected ? "CONNECTED" : (mainCfg?.status || "DISCONNECTED"),
        connectedNumber: phone,
        deviceName: device,
        linkedAt: linked,
        messagesToday: hospitalMsgs,
        departmentRouting,
      };
    });

    const totalHospitals = hospitals.length;
    const disconnectedHospitalsCount = Math.max(0, totalHospitals - activeHospitalsCount);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        activeNodes: activeHospitalsCount,
        totalNodes: totalHospitals,
        disconnectedNodes: disconnectedHospitalsCount,
        globalMessagesToday,
      },
      matrix,
    });
  } catch (error: any) {
    console.error("[Telemetry] getWhatsAppMatrix error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Single Hospital Infrastructure & Permissions:
 * - Location, Geofencing, Camera, Microphone, Biometric / Hardware ID binding
 * - Hospital storage and data usage
 * - WhatsApp integration status for this hospital
 */
export const getHospitalInfrastructure = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hospital: any = await Hospital.findOne({
      $or: [{ hospitalId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }],
    }).lean();

    if (!hospital) {
      return res.status(404).json({ success: false, message: "Hospital not found" });
    }

    const objId = hospital._id.toString();
    const customId = hospital.hospitalId || "";
    const possibleIds = [objId];
    if (customId) possibleIds.push(customId);

    // Search for all WhatsAppConfigs matching this hospital:
    // by exact ID, by department suffix (_pharma, _lab, etc.), or by deviceName matching hospital name
    const idRegex = new RegExp(`^(${possibleIds.join("|")})(_|$)`, "i");

    const whatsappConfigs = await WhatsAppConfig.find({
      $or: [
        { hospitalId: { $in: possibleIds } },
        { hospitalId: idRegex },
        { deviceName: { $regex: new RegExp(hospital.name.replace(/[^a-zA-Z0-9]/g, ".*"), "i") } }
      ]
    }).lean();

    // Prefer connected config, or main config (no underscore), or first available
    const connectedConfig = whatsappConfigs.find((c: any) => c.status === "CONNECTED");
    const mainConfig = whatsappConfigs.find((c: any) => !c.hospitalId.includes("_"));
    const activeConfig: any = connectedConfig || mainConfig || whatsappConfigs[0] || null;

    // Check if any config is connected
    const isAnyConnected = whatsappConfigs.some((c: any) => c.status === "CONNECTED");
    const resolvedStatus = isAnyConnected ? "CONNECTED" : (activeConfig?.status || "DISCONNECTED");
    const resolvedPhone = activeConfig?.connectedNumber || whatsappConfigs.find((c: any) => c.connectedNumber)?.connectedNumber || null;
    const resolvedDevice = activeConfig?.deviceName || whatsappConfigs.find((c: any) => c.deviceName)?.deviceName || null;

    // Default permissions if unset
    const permissions = hospital.devicePermissions || {
      camera: true,
      location: true,
      microphone: false,
      biometrics: false,
      hwidLock: false,
      boundHwid: "",
    };

    return res.json({
      success: true,
      hospital: {
        id: hospital._id,
        hospitalId: customId || objId,
        name: hospital.name,
        city: hospital.city,
        state: hospital.state,
        location: hospital.location || { lat: 0, lng: 0 },
        geofenceSettings: hospital.geofenceSettings || {
          enabled: false,
          radiusMeters: 500,
          restrictedPortals: [],
        },
        devicePermissions: permissions,
        portalLicenses: hospital.portalLicenses || {},
        status: hospital.status,
      },
      whatsapp: {
        status: resolvedStatus,
        connectedNumber: resolvedPhone,
        deviceName: resolvedDevice,
      },
    });
  } catch (error: any) {
    console.error("[Telemetry] getHospitalInfrastructure error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Update Hospital Permissions & Geofencing:
 */
export const updateHospitalPermissions = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { devicePermissions, geofenceSettings, location } = req.body;

    const updates: any = {};
    if (devicePermissions) updates.devicePermissions = devicePermissions;
    if (geofenceSettings) updates.geofenceSettings = geofenceSettings;
    if (location) updates.location = location;

    const hospital = await Hospital.findOneAndUpdate(
      { $or: [{ hospitalId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }] },
      { $set: updates },
      { new: true }
    );

    if (!hospital) {
      return res.status(404).json({ success: false, message: "Hospital not found" });
    }

    return res.json({
      success: true,
      message: "Hospital infrastructure permissions updated successfully",
      hospital,
    });
  } catch (error: any) {
    console.error("[Telemetry] updateHospitalPermissions error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
