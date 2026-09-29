import express from "express";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant, requireTenant } from "../../middleware/tenantMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";

const router = express.Router();

/**
 * TENANT ROLE ONLY ROUTE
 * - Role: nurse, doctor, etc.
 * - Requirement: Strictly scoped to the hospital in their JWT.
 * - Enforcement: req.user.hospitalId is mandatory.
 */
router.get(
  "/patient-data",
  protect, // Verify JWT & Session
  resolveTenant, // Populate tenant context from JWT
  requireTenant, // Fail if no hospital context
  authorizeRoles("doctor", "nurse"), // RBAC
  (req, res) => {
    // Controller logic is now safely scoped!
    // Hospital ID is guaranteed to be in req.tenantId (Types.ObjectId)
    // Any downstream Mongoose queries will be auto-scoped to this hospital.
    res.json({
      success: true,
      message: "Accessed isolated tenant data.",
      hospital: (req as any).tenantId,
      userId: (req as any).user._id
    });
  }
);

/**
 * GLOBAL ACCESS ROUTE
 * - Role: super-admin, emergency
 * - Requirement: Can specify a hospitalId via query/params for cross-access.
 * - Enforcement: Explicit validation for context.
 */
router.get(
  "/hospital-audit/:hospitalId",
  protect,
  resolveTenant, // Populates tenant context from JWT *or* URL param (for global roles)
  authorizeRoles("super-admin", "emergency"),
  (req, res) => {
    // For global roles, resolveTenant checks params.hospitalId
    // and validates the hospital exists before allowing access.
    res.json({
      success: true,
      message: "Accessed cross-hospital global audit.",
      hospitalContext: (req as any).tenantId,
      isGlobal: (req as any).user.role === "super-admin"
    });
  }
);

export default router;
