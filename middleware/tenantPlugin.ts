import { Schema, Model, Query, Document } from "mongoose";
import { Types } from "mongoose";
import { AsyncLocalStorage } from "async_hooks";

/**
 * MULTI-TENANCY MONGOOSE PLUGIN
 *
 * This plugin automatically:
 * 1. Adds hospital field to all queries (find, findOne, update, delete)
 * 2. Validates that created documents have hospital field
 * 3. Prevents accidental cross-tenant queries
 * 4. Supports SuperAdmin bypass via context
 */

export interface TenantPluginOptions {
  tenantField?: string; // Default: 'hospital'
  requireTenant?: boolean; // Default: true
  indexTenant?: boolean; // Default: true
  includeGlobal?: boolean; // Default: false (if true, allows documents with tenantField: null)
  scoping?: boolean; // Default: true (if false, disables automatic query scoping)
}

/**
 * Tenant Context for Query Scope
 * Using AsyncLocalStorage to prevent race conditions in concurrent requests
 */
export interface TenantContext {
  tenantId: Types.ObjectId | null;
  userId: Types.ObjectId | null;
  role: string | null;
  isSuperAdmin: boolean;
}

export const tenantLocalStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Global override for testing context outside of request cycle
 */
let testContext: TenantContext | null = null;

/**
 * Set Tenant Context (Manual override for tests)
 */
export const setTenantContext = (
  tenantId: any,
  isSuperAdmin: boolean = false,
) => {
  testContext = {
    tenantId: tenantId
      ? typeof tenantId === "string"
        ? new Types.ObjectId(tenantId)
        : tenantId
      : null,
    userId: null,
    role: null,
    isSuperAdmin,
  };
};

/**
 * Clear Tenant Context
 */
export const clearTenantContext = () => {
  testContext = null;
};

/**
 * Get Current Tenant Context
 */
export const getTenantContext = (): TenantContext => {
  return (
    tenantLocalStorage.getStore() ||
    testContext || {
      tenantId: null,
      userId: null,
      role: null,
      isSuperAdmin: false,
    }
  );
};

/**
 * Multi-Tenancy Plugin
 */
export function multiTenancyPlugin(
  schema: Schema,
  options: TenantPluginOptions = {},
) {
  const tenantField = options.tenantField || "hospital";
  const requireTenant = options.requireTenant !== false;
  const indexTenant = options.indexTenant !== false;
  const isScopingEnabled = options.scoping !== false;

  // Add index for tenant field if not already present
  if (indexTenant) {
    schema.index({ [tenantField]: 1 });
  }

  // ✅ HOOK: Before Save - Validate tenant field
  schema.pre("save", function (next) {
    const doc = this as any;
    const context = getTenantContext();

    // Patients don't have a fixed hospital in context, but documents must belong to one
    if (
      requireTenant &&
      !doc[tenantField] &&
      !context.isSuperAdmin &&
      context.role !== "patient"
    ) {
      const error = new Error(
        `${tenantField} is required for tenant isolation`,
      );
      return next(error);
    }

    // Strict Enforcement: If staff member saves, ensure they don't cross-post to another hospital
    if (context.tenantId && doc[tenantField] && !context.isSuperAdmin) {
      const docTenant = doc[tenantField];
      const contextTenantIdStr = context.tenantId.toString();

      let isAuthorized = false;
      if (Array.isArray(docTenant)) {
        // Support multiple hospitals/tenants for a single document (e.g. Global Patients)
        isAuthorized = docTenant.some(
          (t: any) => (t?._id || t).toString() === contextTenantIdStr,
        );
      } else {
        // Handle case where tenant field is a string, ObjectId, or a populated object
        const tenantId = docTenant?._id || docTenant;
        isAuthorized = (tenantId?.toString() || "") === contextTenantIdStr;
      }

      if (!isAuthorized) {
        return next(
          new Error(
            `Security Violation: Cannot save document for a different tenant (${docTenant} vs ${context.tenantId})`,
          ),
        );
      }
    }

    next();
  });

  // ✅ HOOK: Before Find Queries - Auto-scope to tenant OR patient
  const scopeQuery = function (this: any) {
    const context = getTenantContext();
    const queryOptions = (this as any).options || {};
    const mongooseOptions =
      typeof (this as any).mongooseOptions === "function"
        ? (this as any).mongooseOptions()
        : (this as any)._mongooseOptions || {};

    // Check for explicit unscoping in multiple potential locations (Query options, Mongoose internal options)
    const isExplicitlyUnscoped =
      (this as any)._unscoped ||
      queryOptions.unscoped ||
      mongooseOptions.unscoped ||
      (mongooseOptions.populate &&
        Object.values(mongooseOptions.populate).some(
          (p: any) => p.options && p.options.unscoped,
        ));

    if (!isScopingEnabled || context.isSuperAdmin || isExplicitlyUnscoped)
      return;

    // 1. HOSPITAL STAFF SCOPING
    if (context.tenantId) {
      if (options.includeGlobal) {
        this.where({
          $or: [{ [tenantField]: context.tenantId }, { [tenantField]: null }],
        });
      } else {
        // Strictly scoped to tenant - OVERWRITE query if it contradicts context
        this.where({ [tenantField]: context.tenantId });
      }
    }
    // 2. PATIENT SCOPING (CRITICAL SECURITY)
    else if (context.role === "patient" && context.userId) {
      const paths = schema.paths;
      
      if (paths.globalPatientId && paths.patient) {
        // Automatically inject patient filter to prevent cross-patient data leaks.
        // Support BOTH legacy 'patient' and new 'globalPatientId' for backwards compatibility.
        this.where({
          $or: [
            { globalPatientId: context.userId },
            { patient: context.userId }
          ]
        });
      } else {
        const patientField = paths.globalPatientId
          ? "globalPatientId"
          : paths.patient
            ? "patient"
            : null;
  
        if (patientField) {
          this.where({ [patientField]: context.userId });
        }
      }
    }
    // 3. ✅ FAIL-CLOSED: No tenant context, not a patient, not explicitly unscoped
    //    → Block query entirely rather than silently leaking cross-tenant data.
    else {
      const modelName = (this as any).model?.modelName || "UnknownModel";
      console.warn(
        `[MT Security DEBUG] Query blocked on '${modelName}'. ` +
          `Context: { tenantId: ${context.tenantId}, role: ${context.role}, userId: ${context.userId}, isSuperAdmin: ${context.isSuperAdmin} }. ` +
          `Options: ${JSON.stringify((this as any).options)}. ` +
          `Query: ${JSON.stringify(this.getQuery())}`,
      );
      if (
        process.env.NODE_ENV === "development" ||
        process.env.NODE_ENV === "test"
      ) {
        console.error(new Error("Tracing Unscoped query block").stack);
        // In development: throw a loud error so developers see this immediately
        throw new Error(
          `[MT Security] Unscoped query BLOCKED on '${modelName}' (field: '${tenantField}'). ` +
            `No tenant context found in AsyncLocalStorage. ` +
            `Either add 'resolveTenant' middleware to this route, ` +
            `or call .unscoped() to explicitly bypass isolation.`
        );
      } else {
        // FIX: In production — fail-closed but with actionable context for operators
        console.error(
          `[MT Security] CRITICAL: Unscoped query blocked on model='${modelName}' ` +
          `(tenantField='${tenantField}'). Context dump: ` +
          `tenantId=${context.tenantId} role=${context.role} userId=${context.userId} ` +
          `isSuperAdmin=${context.isSuperAdmin}. ` +
          `Route is likely missing 'resolveTenant' middleware. Zero results returned.`
        );
        this.where({ _id: null }); // Fail-closed: return zero results, never leak cross-tenant data
      }
    }
  };

  schema.pre(/^find/, scopeQuery);
  schema.pre("countDocuments", scopeQuery);

  // ✅ ADD: .unscoped() helper to Query
  (schema.query as any).unscoped = function (this: any) {
    if (this.setOptions) {
      this.setOptions({ unscoped: true });
    }
    this._unscoped = true;
    return this;
  };

  // ✅ HOOK: Aggregate - Auto-scope to tenant OR patient
  schema.pre("aggregate", function (next) {
    const context = getTenantContext();
    if (!isScopingEnabled || context.isSuperAdmin) return next();

    const pipeline = this.pipeline();

    if (context.tenantId) {
      pipeline.unshift({ $match: { [tenantField]: context.tenantId } });
    } else if (context.role === "patient" && context.userId) {
      const paths = schema.paths;
      const patientField = paths.globalPatientId
        ? "globalPatientId"
        : paths.patient
          ? "patient"
          : null;
      if (patientField) {
        pipeline.unshift({ $match: { [patientField]: context.userId } });
      }
    } else {
      // ✅ FAIL-CLOSED: No tenant context on aggregate — block pipeline
      if (
        process.env.NODE_ENV === "development" ||
        process.env.NODE_ENV === "test"
      ) {
        return next(
          new Error(
            `[MT Security] Unscoped aggregate BLOCKED (field: '${tenantField}'). ` +
              `Missing tenant context \u2014 add resolveTenant middleware to this route.`,
          ),
        );
      } else {
        console.error(
          `[MT Security] CRITICAL: Unscoped aggregate blocked. Missing tenant context.`,
        );
        // Inject impossible match to return zero results
        pipeline.unshift({ $match: { _id: null } });
      }
    }
    next();
  });

  // ✅ HOOK: Before Update - Prevent cross-tenant updates
  schema.pre(/^update/, function (this: Query<any, any>, next) {
    const query = this.getQuery();
    const update = this.getUpdate() as any;
    const context = getTenantContext();

    if (context.isSuperAdmin) return next();

    // Prevent changing tenant after creation
    if (update.$set && update.$set[tenantField]) {
      return next(
        new Error(`Cannot modify ${tenantField} field after creation`),
      );
    }

    // Apply tenant filter
    if (isScopingEnabled && context.tenantId) {
      this.where({ [tenantField]: context.tenantId });
    }

    next();
  });

  // ✅ HOOK: Before Delete - Prevent cross-tenant deletes
  schema.pre(/^delete/, function (this: Query<any, any>, next) {
    const context = getTenantContext();
    if (context.isSuperAdmin) return next();

    if (isScopingEnabled && context.tenantId) {
      this.where({ [tenantField]: context.tenantId });
    }

    next();
  });
}

/**
 * Apply Multi-Tenancy to Specific Model
 */
export const applyTenancy = <T extends Document>(
  model: Model<T>,
  options?: TenantPluginOptions,
) => {
  multiTenancyPlugin(model.schema, options);
};

export default multiTenancyPlugin;