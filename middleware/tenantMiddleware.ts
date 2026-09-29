import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { tenantLocalStorage, TenantContext } from "./tenantPlugin.js";
import Hospital from "../Hospital/Models/Hospital.js";

/**
 * MULTI-TENANCY MIDDLEWARE
 *
 * This middleware is responsible for:
 * 1. Extracting the hospital/tenant ID from the authenticated user
 * 2. Validating tenant context for all operations
 * 3. Preventing cross-tenant data access
 * 4. Supporting SuperAdmin global access
 * 5. Securing context with AsyncLocalStorage
 */

export interface TenantRequest extends Request {
  user?: any;
  tenantId?: Types.ObjectId | string;
  hospitalId?: Types.ObjectId | string;
  isSuperAdmin?: boolean;
}

/**
 * Global Tenant Store Initialization
 * MUST run at the very beginning of the request cycle to ensure
 * AsyncLocalStorage context is available for all down-stream calls.
 */
export const initTenantStore = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const initialContext: TenantContext = {
    tenantId: null,
    userId: null,
    role: null,
    isSuperAdmin: false,
  };
  tenantLocalStorage.run(initialContext, () => {
    next();
  });
};

const TENANT_ROLES = [
  "hospital-admin",
  "doctor",
  "nurse",
  "lab",
  "pharma",
  "pharma-owner",
  "pharmacist",
  "pharmacy",
  "frontdesk",
  "helpdesk",
  "hr",
  "staff",
  "discharge",
  "ambulance",
  "emergency",
];
const GLOBAL_ROLES = ["super-admin", "patient", "masterhelpdesk", "admin"];

/**
 * Tenant Resolver Middleware
 * STRICTOR ENFORCEMENT:
 * 1. For Tenant Roles: hospitalId MUST come from JWT.
 * 2. For Global Roles: hospitalId can come from params/query but must be validated.
 */
export const resolveTenant = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const tenantReq = req as TenantRequest;

  // Ensure protect middleware has run
  if (!tenantReq.user || !tenantReq.user.decoded) {
    return next();
  }

  const user = tenantReq.user;
  const role = user.role?.toLowerCase();
  const tokenData = user.decoded; // Extracted from decoded JWT in authMiddleware

  let context: TenantContext = {
    tenantId: null,
    userId: user._id,
    role: role,
    isSuperAdmin: ["super-admin", "admin", "masterhelpdesk"].includes(role),
  };

  // 1. ENFORCE TENANT ROLES (Strict Isolation)
  if (TENANT_ROLES.includes(role)) {
    // hospitalId MUST come from JWT. NEVER trust header/query/body for tenant roles.
    const hospitalId = tokenData.hospitalId;

    if (!hospitalId) {
      return res.status(403).json({
        success: false,
        message: "Tenant isolation error: Hospital context missing in token.",
      });
    }

    try {
      const hId = new Types.ObjectId(hospitalId);
      tenantReq.tenantId = hId;
      tenantReq.hospitalId = hId;
      context.tenantId = hId;
    } catch (err) {
      return res
        .status(401)
        .json({
          success: false,
          message: "Invalid hospital context in session.",
        });
    }
  }
  // 2. ENFORCE GLOBAL ROLES (Flexible Access with Validation)
  else if (GLOBAL_ROLES.includes(role)) {
    // Global users can access multiple hospitals via dynamic input
    const requestedHospitalId = (req.query.hospitalId ||
      req.params.hospitalId ||
      req.headers["x-hospital-id"]) as string;

    if (requestedHospitalId) {
      try {
        const hId = new Types.ObjectId(requestedHospitalId);

        // VALIDATION: Ensure the hospital actually exists
        const hospitalExists = await (Hospital.findOne({ _id: hId }) as any).unscoped();
        if (!hospitalExists) {
          return res
            .status(404)
            .json({
              success: false,
              message: "Requested hospital does not exist.",
            });
        }

        tenantReq.tenantId = hId;
        tenantReq.hospitalId = hId;
        context.tenantId = hId;
      } catch (err) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid hospital ID format." });
      }
    } else {
      // SuperAdmin might be accessing global (non-tenant) routes
      tenantReq.tenantId = undefined;
      context.tenantId = null;
    }
  }

  // Bind to AsyncLocalStorage for model-level isolation (tenantPlugin)
  const store = tenantLocalStorage.getStore();
  if (store) {
    store.tenantId = context.tenantId;
    store.userId = context.userId;
    store.role = context.role;
    store.isSuperAdmin = context.isSuperAdmin;
  }

  next();
};

/**
 * Strict Tenant Enforcement (Route-level)
 */
export const requireTenant = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const tenantReq = req as TenantRequest;
  if (!tenantReq.tenantId) {
    console.error(`[requireTenant] FALLTHROUGH BLOCKED: method=${req.method} path=${req.path} originalUrl=${req.originalUrl}`);
    return res.status(403).json({
      success: false,
      message: "This operation requires a specific hospital context.",
    });
  }
  next();
};

/**
 * Helper to get current tenant ID from request safely
 */
export const getCurrentTenantId = (
  req: Request,
): Types.ObjectId | string | null => {
  const tenantReq = req as TenantRequest;
  return tenantReq.tenantId || null;
};

/**
 * Manual Query Scoping Helper
 * Use this for models that DO NOT use the multiTenancyPlugin automatically,
 * or when you need explicit control over the filter.
 */
export const scopeQuery = (req: Request, baseQuery: any = {}): any => {
  const tenantReq = req as TenantRequest;

  // SuperAdmins bypass all scoping
  if (tenantReq.isSuperAdmin) {
    return baseQuery;
  }

  // Enforce tenant isolation
  return {
    ...baseQuery,
    hospital: tenantReq.tenantId,
  };
};

/**
 * Validate Tenant Ownership
 * Returns true if the user has access to the specified hospital
 */
export const validateTenantOwnership = async (
  hospitalId: any,
  req: Request,
): Promise<boolean> => {
  const tenantReq = req as TenantRequest;

  if (tenantReq.isSuperAdmin) return true;

  if (!tenantReq.tenantId || !hospitalId) return false;

  return tenantReq.tenantId.toString() === hospitalId.toString();
};

export default {
  resolveTenant,
  requireTenant,
  getCurrentTenantId,
  scopeQuery,
  validateTenantOwnership,
};
