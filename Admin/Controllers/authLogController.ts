import { Request, Response } from "express";
import AuthLog from "../../Auth/Models/AuthLog.js";
import { logError } from "../../utils/logger.js";

/**
 * Get all authentication logs (SuperAdmin or HospitalAdmin)
 */
export const getAllAuthLogs = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, hospital, role, status, userId, grouped } = req.query;
    const authUser = (req as any).user;
    
    const query: any = {};
    
    // Multi-tenancy isolation
    if (authUser.role !== "super-admin") {
      // HospitalAdmins are restricted to their own hospital's logs
      query.hospital = (req as any).tenantId || authUser.hospital;
    } else if (hospital) {
      // SuperAdmin can filter by any hospital
      query.hospital = hospital;
    }

    if (role) query.role = role;
    
    // Improved Status Filtering: handle 'active' and 'success' synonyms
    if (status === "active") {
      // Active sessions are successful logins without a logout timestamp
      query.status = "success";
      query.logoutAt = { $exists: false };
    } else if (status === "expired") {
      // Sessions that are "success" but might have been cleared or expired elsewhere
      // (For now, treat expired as a specific status check if intended, or sessions older than X hours)
      query.status = "expired"; 
    } else if (status) {
      query.status = status;
    }
    
    if (userId) query.user = userId;

    const skip = (Number(page) - 1) * Number(limit);
    
    if (grouped === "true") {
      // Grouping logic: Each user + role combination is a row
      const aggregatePipeline: any[] = [
        { $match: query },
        { $sort: { loginAt: -1 } },
        {
          $group: {
            _id: { user: "$user", role: "$role" },
            latestSession: { $first: "$$ROOT" },
            allSessions: { $push: "$$ROOT" },
            count: { $sum: 1 }
          }
        },
        { $sort: { "latestSession.loginAt": -1 } },
        {
          $facet: {
            metadata: [{ $count: "total" }],
            data: [{ $skip: skip }, { $limit: Number(limit) }]
          }
        }
      ];

      const result = await AuthLog.aggregate(aggregatePipeline);
      const data = result[0].data;
      const total = result[0].metadata[0]?.total || 0;

      // Populate user info for grouped data
      const populatedData = await Promise.all(data.map(async (item: any) => {
        const log = item.latestSession;
        
        // Auto-fix userModel if missing (same logic as before)
        if (!log.userModel) {
          if (log.role === "super-admin" || log.role === "superadmin") {
            log.userModel = "SuperAdmin";
          } else if (log.role === "patient") {
            log.userModel = "Patient";
          } else {
            log.userModel = "User";
          }
        }

        const populatedLog = await AuthLog.populate(log, [
          { 
            path: "user", 
            select: "name email mobile hospitals",
            populate: log.userModel === "Patient" ? { path: "hospitals", select: "name" } : undefined
          },
          { path: "hospital", select: "name" }
        ]);

        // Also populate hospital for each session in allSessions (optional but helpful)
        const populatedSessions = await Promise.all(item.allSessions.map(async (sess: any) => {
          return AuthLog.populate(sess, { path: "hospital", select: "name" });
        }));

        return {
          ...populatedLog.toObject ? populatedLog.toObject() : populatedLog,
          totalSessions: item.count,
          allSessions: populatedSessions
        };
      }));

      return res.json({
        success: true,
        data: populatedData,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      });
    }

    // Default (Existing) Flat List Logic
    const logs = await AuthLog.find(query)
      .sort({ loginAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Dynamic population based on userModel
    const populatedLogs = await Promise.all(logs.map(async (log: any) => {
      if (!log.userModel) {
        if (log.role === "super-admin" || log.role === "superadmin") {
          log.userModel = "SuperAdmin";
        } else if (log.role === "patient") {
          log.userModel = "Patient";
        } else {
          log.userModel = "User";
        }
        AuthLog.updateOne({ _id: log._id }, { userModel: log.userModel }).catch(() => {});
      }

      return AuthLog.populate(log, [
        { 
          path: "user", 
          select: "name email mobile hospitals",
          populate: log.userModel === "Patient" ? { path: "hospitals", select: "name" } : undefined
        },
        { path: "hospital", select: "name" }
      ]);
    }));

    const total = await AuthLog.countDocuments(query);

    res.json({
      success: true,
      data: populatedLogs,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    logError("Error fetching auth logs", err);
    res.status(500).json({ success: false, message: "Error fetching auth logs" });
  }
};

/**
 * Get filters for auth logs (roles and hospitals)
 */
export const getAuthLogFilters = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    const isSuperAdmin = authUser.role === "super-admin";
    
    const query: any = {};
    if (!isSuperAdmin) {
      query.hospital = (req as any).tenantId || authUser.hospital;
    }

    // Get unique roles from AuthLog within the scope
    const roles = await AuthLog.distinct("role", query);
    
    let hospitals: any[] = [];
    if (isSuperAdmin) {
      // Get all hospitals that have logs
      const hospitalIds = await AuthLog.distinct("hospital");
      const Hospital = (await import("../../Hospital/Models/Hospital.js")).default;
      hospitals = await Hospital.find({ _id: { $in: hospitalIds } }).select("name");
    }

    res.json({
      success: true,
      data: {
        roles,
        ...(isSuperAdmin ? { hospitals } : {})
      }
    });
  } catch (err) {
    logError("Error fetching auth log filters", err);
    res.status(500).json({ success: false, message: "Error fetching filters" });
  }
};
