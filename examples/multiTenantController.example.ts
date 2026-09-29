/**
 * EXAMPLE CONTROLLER: Multi-Tenant Appointment Management
 *
 * This example demonstrates proper multi-tenancy patterns:
 * - Automatic tenant scoping
 * - Manual tenant validation
 * - SuperAdmin bypass
 * - Cross-tenant security
 */

import { Request, Response } from "express";
import {
  scopeQuery,
  getCurrentTenantId,
  validateTenantOwnership,
  TenantRequest,
} from "../middleware/tenantMiddleware.js";
import Appointment from "../Appointment/Models/Appointment.js";
import { Types } from "mongoose";

/**
 * GET /api/appointments
 * List all appointments (automatically scoped to hospital)
 */
export const getAppointments = async (req: Request, res: Response) => {
  try {
    const tenantReq = req as TenantRequest;

    // Build base query with filters
    const baseQuery: any = {};

    if (req.query.status) {
      baseQuery.status = req.query.status;
    }

    if (req.query.date) {
      baseQuery.date = new Date(req.query.date as string);
    }

    // Apply tenant scope (SuperAdmins see all, others see their hospital only)
    const query = scopeQuery(req, baseQuery);

    const appointments = await Appointment.find(query)
      .populate("patient", "name mobile")
      .populate("doctor", "name specialties")
      .sort({ date: -1 });

    res.json({
      success: true,
      count: appointments.length,
      tenantId: tenantReq.tenantId,
      isSuperAdmin: tenantReq.isSuperAdmin,
      data: appointments,
    });
  } catch (error: any) {
    console.error("getAppointments error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/appointments/:id
 * Get single appointment with tenant validation
 */
export const getAppointmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Find appointment
    const appointment = await Appointment.findById(id)
      .populate("patient")
      .populate("doctor");

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // Validate tenant ownership
    const hasAccess = await validateTenantOwnership(appointment.hospital, req);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied: This appointment belongs to another hospital",
      });
    }

    res.json({ success: true, data: appointment });
  } catch (error: any) {
    console.error("getAppointmentById error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/appointments
 * Create new appointment with automatic tenant assignment
 */
export const createAppointment = async (req: Request, res: Response) => {
  try {
    const tenantId = getCurrentTenantId(req);

    if (!tenantId) {
      return res.status(403).json({
        success: false,
        message: "Hospital context required to create appointment",
      });
    }

    // Create appointment with tenant context
    const appointment = await Appointment.create({
      ...req.body,
      hospital: tenantId,
    });

    res.status(201).json({
      success: true,
      message: "Appointment created successfully",
      data: appointment,
    });
  } catch (error: any) {
    console.error("createAppointment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/appointments/:id
 * Update appointment with tenant validation
 */
export const updateAppointment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Find existing appointment
    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // Validate tenant ownership
    const hasAccess = await validateTenantOwnership(appointment.hospital, req);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied: Cannot update appointment from another hospital",
      });
    }

    // Prevent changing hospital field
    const { hospital, ...updateData } = req.body;

    if (hospital && hospital !== appointment.hospital.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot transfer appointment to another hospital",
      });
    }

    // Update appointment
    Object.assign(appointment, updateData);
    await appointment.save();

    res.json({
      success: true,
      message: "Appointment updated successfully",
      data: appointment,
    });
  } catch (error: any) {
    console.error("updateAppointment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/appointments/:id
 * Delete appointment with tenant validation
 */
export const deleteAppointment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Find appointment
    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // Validate tenant ownership
    const hasAccess = await validateTenantOwnership(appointment.hospital, req);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied: Cannot delete appointment from another hospital",
      });
    }

    await appointment.deleteOne();

    res.json({
      success: true,
      message: "Appointment deleted successfully",
    });
  } catch (error: any) {
    console.error("deleteAppointment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/appointments/all
 * SuperAdmin endpoint to view all appointments across hospitals
 */
export const getAllAppointmentsAdmin = async (req: Request, res: Response) => {
  try {
    const tenantReq = req as TenantRequest;

    // Only SuperAdmins can access
    if (!tenantReq.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: "SuperAdmin access required",
      });
    }

    // Build aggregation pipeline to get stats per hospital
    const stats = await Appointment.aggregate([
      {
        $group: {
          _id: "$hospital",
          totalAppointments: { $sum: 1 },
          confirmedCount: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
          },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
        },
      },
      {
        $lookup: {
          from: "hospitals",
          localField: "_id",
          foreignField: "_id",
          as: "hospital",
        },
      },
      {
        $unwind: "$hospital",
      },
      {
        $project: {
          hospitalId: "$_id",
          hospitalName: "$hospital.name",
          totalAppointments: 1,
          confirmedCount: 1,
          cancelledCount: 1,
        },
      },
    ]);

    res.json({
      success: true,
      message: "Global appointment statistics",
      data: stats,
    });
  } catch (error: any) {
    console.error("getAllAppointmentsAdmin error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  getAppointments,
  getAppointmentById,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getAllAppointmentsAdmin,
};
