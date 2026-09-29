import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import PharmaAuditLog from "../Models/AuditLog.js";

export const getAuditLogs = async (req: PharmaRequest, res: Response) => {
  try {
    const pharmacyId = req.pharma?._id;
    const {
      action,
      resourceType,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    if (!pharmacyId) {
      return res.json({
        success: true,
        count: 0,
        total: 0,
        totalPages: 0,
        currentPage: Number(page),
        data: [],
      });
    }

    const query: any = { pharmacy: pharmacyId };

    if (action) query.action = action;
    if (resourceType) query.resourceType = resourceType;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      PharmaAuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PharmaAuditLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      count: logs.length,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      data: logs,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
