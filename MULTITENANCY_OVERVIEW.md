# Multitenancy Overview (Backend)

This backend implements strict, defense‑in‑depth multitenancy for hospitals (tenants). All data access is automatically scoped to a tenant using a request‑local context and a Mongoose plugin, with explicit exceptions for Super Admins and Patients.

## Core Concepts
- Tenant key: `hospital` ObjectId on most documents.
- Context store: AsyncLocalStorage holds `{ tenantId, userId, role, isSuperAdmin }` per request.
- Resolution path: Authentication → resolve tenant → auto scoping in models.
- Super Admins: Global by default; can target a hospital via `X-Hospital-Id` header.
- Patients: Global across hospitals, but automatically restricted to their own records.

## Request Lifecycle
1. Authentication attaches `req.user` with `role` and (for staff) `hospital`.
2. `initTenantStore` initializes AsyncLocalStorage for each request.
3. `resolveTenant` derives tenant rules:
   - Super Admin → global; optional `X-Hospital-Id` narrows context.
   - Patient → no fixed tenant; downstream auto‑filters by patient id.
   - Hospital staff (doctor, nurse, etc.) → tenant set to `req.user.hospital`.
4. Optional `requireTenant` enforces tenant presence for hospital‑scoped endpoints.

## Automatic Data Scoping
All tenant‑sensitive models apply `multiTenancyPlugin`, which:
- Adds an index on the tenant field (default: `hospital`).
- Validates the tenant field on create/save (fail‑closed).
- Auto‑injects tenant filters on:
  - `find`, `findOne`, `countDocuments`, `update*`, `delete*`, and `aggregate` pipelines.
- Provides `.unscoped()` for intentional bypass in safe contexts (e.g., auth lookups).
- Patient mode: When role is `patient`, queries auto‑filter by `globalPatientId` or `patient` fields.
- Fail‑closed behavior: If a route misses tenant resolution, queries are blocked in dev/test and return zero results in production.

## Roles and Access
- Super Admin
  - Global access.
  - Can scope to a specific hospital by sending `X-Hospital-Id: <hospital ObjectId>`.
- Patient
  - Sees only their own records across all hospitals (no fixed tenant).
- Hospital Staff (doctor, nurse, helpdesk, admin, etc.)
  - Strictly scoped to their assigned `hospital` for read/write.

## Route Integration Pattern
- Always use `protect` (auth), then `resolveTenant` to populate context.
- Use `requireTenant` on tenant‑isolated routes.
- Example:
  - `router.use(protect)`
  - `router.use(resolveTenant)`
  - `router.get("/", requireTenant, authorizeRoles("doctor", "nurse"), handler)`

## Model Pattern
- Include a `hospital: ObjectId<Hospital>` field (required, indexed) unless the model is an explicit exception (e.g., SuperAdmin, Patient profile, Emergency personnel).
- Apply the plugin:
  - `schema.plugin(multiTenancyPlugin)`
- Add domain‑specific compound indexes prefixed with `hospital` for performance.

## Security Guards
- Prevent cross‑tenant writes/updates/deletes (immutable `hospital` after creation).
- Validate resource ownership via helpers when accessing by id.
- Socket rooms are joined on the server using DB‑derived hospital and role, not client input.
- Extensive logging for unscoped queries in non‑production environments.

## Special Cases
- Patient data: Auto‑filtered by the current patient id to prevent cross‑patient leakage.
- Aggregations: The plugin injects a leading `$match` for tenant or patient where applicable.
- Explicit `.unscoped()` is allowed only where it is safe and necessary (e.g., initial user lookup in auth).

## Developer Checklist
When adding a new module:
1. Schema
   - Add `hospital: ObjectId<Hospital>` (required, indexed) unless it is an approved exception.
   - `schema.plugin(multiTenancyPlugin)`.
   - Add compound indexes beginning with `{ hospital: 1, ... }`.
2. Routes
   - Mount `protect` → `resolveTenant`; use `requireTenant` where tenant isolation is mandatory.
3. Controllers/Services
   - Avoid manual tenant filters; let the plugin scope queries automatically.
   - Use `.unscoped()` only when justified and safe.
4. Tests
   - Cover isolation (tenant A cannot read/write tenant B’s data).
   - Cover Super Admin global access and hospital switching via header.
   - Cover patient self‑data visibility across hospitals.

## Quick Examples
- Read within tenant:
  - `await Model.find({ status: "active" })` → auto‑scoped by plugin.
- Create within tenant:
  - `await Model.create({ ...body, hospital: currentHospitalId })` → validated by plugin.
- Super Admin scoping:
  - Send `X-Hospital-Id` to narrow results for analysis or operations.

## Validation and Tests
- A dedicated multitenancy test suite verifies:
  - Context resolution, isolation, cross‑tenant prevention, Super Admin switching, query scoping, and immutability of the hospital field.

## Exceptions (No Tenant Field)
- `superadmins`, `patients` (master profile), emergency personnel.
- For exceptions, ensure related transactional records still carry `hospital` and are scoped.

This design ensures principled isolation by default, explicit elevation for administrators, and a safe global view for patients limited strictly to their own records. It scales across all modules through a single plug‑and‑play Mongoose integration and a consistent routing pattern.

