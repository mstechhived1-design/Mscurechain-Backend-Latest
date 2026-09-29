/**
 * EXAMPLE ROUTE: Multi-Tenant Appointment Routes
 *
 * This file demonstrates how to properly apply multi-tenancy middleware
 * to Express routes for complete data isolation
 */

import express from "express";
import { protect, authorize } from "../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../middleware/tenantMiddleware.js";
import {
  getAppointments,
  getAppointmentById,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getAllAppointmentsAdmin,
} from "./multiTenantController.example.js";

const router = express.Router();

/**
 * STANDARD TENANT-SCOPED ROUTES
 * Pattern: protect → resolveTenant → requireTenant → controller
 */

// List appointments (scoped to user's hospital)
router.get("/", protect, resolveTenant, requireTenant, getAppointments);

// Get single appointment (with ownership validation)
router.get("/:id", protect, resolveTenant, requireTenant, getAppointmentById);

// Create appointment (auto-assigned to user's hospital)
router.post("/", protect, resolveTenant, requireTenant, createAppointment);

// Update appointment (with ownership validation)
router.put("/:id", protect, resolveTenant, requireTenant, updateAppointment);

// Delete appointment (with ownership validation)
router.delete(
  "/:id",
  protect,
  resolveTenant,
  requireTenant,
  authorize("hospital-admin", "super-admin"),
  deleteAppointment,
);

/**
 * SUPERADMIN GLOBAL ROUTES
 * Pattern: protect → authorize → resolveTenant → controller
 *
 * Note: No requireTenant - SuperAdmins can view across hospitals
 */
router.get(
  "/admin/all",
  protect,
  authorize("super-admin"),
  resolveTenant, // Still resolve context for optional filtering
  getAllAppointmentsAdmin,
);

/**
 * OPTIONAL TENANT CONTEXT ROUTES
 * Pattern: protect → resolveTenant → controller
 *
 * Use for resources that can exist without hospital context
 * (e.g., initial patient registration, public endpoints)
 */
router.get(
  "/public/upcoming",
  protect,
  resolveTenant,
  // No requireTenant - patients might not have hospital yet
  getAppointments,
);

export default router;

/**
 * USAGE IN app.ts:
 *
 * import appointmentRoutes from "./examples/multiTenantRoutes.example.js";
 * app.use("/api/appointments", appointmentRoutes);
 */
