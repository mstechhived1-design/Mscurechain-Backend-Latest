# MSCurechain — Backend Isolation Issues & Complete Fix Plan

> **Audit Date:** 2026-03-01
> **Scope:** Full backend — routes, middleware, controllers, services, socket layer
> **Total Issues Found:** 12 (3 Critical · 4 High · 4 Medium · 2 Low)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [What Is Working Correctly](#2-what-is-working-correctly)
3. [All Isolation Issues Found](#3-all-isolation-issues-found)
   - [🔴 Critical Issues](#-critical-issues)
   - [🟠 High Issues](#-high-issues)
   - [🟡 Medium Issues](#-medium-issues)
   - [🟢 Low Issues](#-low-issues)
4. [Complete Fix Plan — Phase by Phase](#4-complete-fix-plan--phase-by-phase)
5. [Testing Checklist After Fixes](#5-testing-checklist-after-fixes)
6. [Anti-Pattern to Eliminate Globally](#6-anti-pattern-to-eliminate-globally)
7. [Summary Table](#7-summary-table)

---

## 1. Architecture Overview

MSCurechain uses a **two-layer multitenancy system**:

```
Request → initTenantStore → protect (JWT) → resolveTenant → requireTenant → Controller
                                                  ↓
                                    AsyncLocalStorage (tenantId, role, userId)
                                                  ↓
                                    Mongoose Plugin (auto-injects hospital filter)
                                    on every find / save / update / delete / aggregate
```

### Layer 1 — Route / Middleware

- `initTenantStore` — initialises `AsyncLocalStorage` at the start of every request.
- `resolveTenant` — extracts `hospital` from the authenticated JWT and stores it in the store.
- `requireTenant` — blocks requests with no `tenantId` for hospital-scoped routes.

### Layer 2 — Database (Mongoose Plugin)

- `multiTenancyPlugin` reads from `AsyncLocalStorage` and **automatically injects** `{ hospital: tenantId }` into every `find`, `findOne`, `save`, `update`, `delete`, and `aggregate` that runs on a model using the plugin.

### Fail-Closed Behaviour

| Environment | Behaviour when no tenant context                                            |
| ----------- | --------------------------------------------------------------------------- |
| Development | **Throws a loud error** with a stack trace                                  |
| Production  | **Injects** `{ _id: null }` — query returns zero rows, **never leaks data** |

---

## 2. What Is Working Correctly ✅

| Area                                                                                                                                        | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `initTenantStore` runs globally on every request (app.ts line 71)                                                                           | ✅     |
| `resolveTenant` applied in all major route files                                                                                            | ✅     |
| Mongoose plugin on IPD, Pharmacy, Lab, HR, Staff, Helpdesk, Leave, Attendance, Notifications, Support, SOP, Quality, Performance, Incidents | ✅     |
| Fail-closed in Production — returns `{ _id: null }` (zero rows, no data leak)                                                               | ✅     |
| Socket.io `join_room` derives hospital from DB, **not** from client payload                                                                 | ✅     |
| Super-Admin `X-Hospital-Id` header validates hospital existence before use                                                                  | ✅     |
| Save/update hooks block cross-tenant writes                                                                                                 | ✅     |
| Tenant field (`hospital`) is immutable after document creation                                                                              | ✅     |

---

## 3. All Isolation Issues Found

---

### 🔴 Critical Issues

---

#### C-1 — Cross-Hospital Helpdesk Notifications on Appointment Booking

| Field    | Detail                                         |
| -------- | ---------------------------------------------- |
| **File** | `Appointment/Controllers/bookingController.ts` |
| **Line** | 496                                            |
| **Risk** | Cross-hospital real-time notification leak     |

**Problematic Code:**

```ts
const helpdeskUsers = await User.find({ role: "helpdesk" }); // All helpdesk — ALL hospitals
for (const hdUser of helpdeskUsers) {
  await createNotification(bookingReq as any, {
    hospital: targetHospitalId,
    recipient: hdUser._id,
    ...
  });
}
```

**Root Cause:**
`User.find({ role: "helpdesk" })` has no `hospital` filter. In a multi-hospital deployment, helpdesk staff from Hospital-B receives real-time push notifications about Hospital-A appointments.

**Impact:**

- Helpdesk staff see appointment requests from other hospitals in their notification feed.
- Real-time socket events (`notification:new`) broadcast to wrong staff rooms.

**Fix:**

```ts
// ✅ FIX: Always scope helpdesk lookup to the booking hospital
const helpdeskUsers = await User.find({
  role: "helpdesk",
  hospital: targetHospitalId, // ← Add this
});
```

---

#### C-2 — Messaging System Tags Messages to First Hospital in Database

| Field     | Detail                                           |
| --------- | ------------------------------------------------ |
| **File**  | `Messages/Controllers/messageController.ts`      |
| **Lines** | 104–109                                          |
| **Risk**  | Messages permanently stored under wrong hospital |

**Problematic Code:**

```ts
if (!hospitalId) {
  const clinic = await Hospital.findOne().select("_id"); // ← First hospital in DB!
  if (clinic) hospitalId = clinic._id;
}
```

**Root Cause:**
When `hospitalId` is not present in the message body, the code performs a bare `Hospital.findOne()` which returns whichever hospital was created first in MongoDB. All messages from Hospital-B staff will be tagged to Hospital-A if Hospital-A was the first one created.

**Impact:**

- All messages stored under wrong hospital in DB.
- Hospital data separation is permanently broken for the messaging module.

**Fix:**

```ts
// ✅ FIX: Always use the authenticated user's hospital context
if (!hospitalId) {
  hospitalId = (req as any).user?.hospital;
}
if (!hospitalId) {
  return res
    .status(400)
    .json({ message: "Hospital context required for messaging" });
}
```

---

#### C-3 — Lab Invoices / Transactions Tagged to First Hospital in Database

| Field     | Detail                                             |
| --------- | -------------------------------------------------- |
| **File**  | `Lab/Controllers/labController.ts`                 |
| **Lines** | 754–759 (`finalizeOrder`) and 833–838 (`payOrder`) |
| **Risk**  | Financial/billing data stored under wrong hospital |

**Problematic Code (appears in two functions):**

```ts
if (!txHospital) {
  const defaultHospital = await Hospital.findOne(); // ← First hospital in DB!
  if (defaultHospital) txHospital = defaultHospital._id;
}
```

**Root Cause:**
Same `Hospital.findOne()` anti-pattern used as a fallback when a lab order has no `hospital` field. The invoice / transaction is created under the first hospital in the database.

**Impact:**

- Transaction records (billing) stored under wrong hospital.
- Financial reports for Hospital-A include Hospital-B's lab revenue.

**Fix (apply to BOTH locations):**

```ts
// ✅ FIX: Never fall back to a random hospital — use user context or fail-safe
if (!txHospital) {
  txHospital = (req as any).user?.hospital;
}
if (!txHospital) {
  throw new Error(
    "Hospital context is required for invoice creation. Lab order is missing hospital association.",
  );
}
```

---

### 🟠 High Issues

---

#### H-1 — Appointment Availability Check Uses Client-Controlled `hospitalId`

| Field     | Detail                                                            |
| --------- | ----------------------------------------------------------------- |
| **File**  | `Appointment/Controllers/bookingController.ts`                    |
| **Lines** | 533, 641–647                                                      |
| **Risk**  | Any authenticated user can query any hospital's appointment slots |

**Problematic Code:**

```ts
const { doctorId, hospitalId, date } = availabilityReq.query; // ← from URL query string

// Used directly in DB query:
const appointments = await Appointment.find({
  doctor: doctorId,
  hospital: hospitalId, // ← client-supplied, NOT validated against user's tenant
  date: new Date(date as string),
  status: { $ne: "cancelled" },
});
```

**Root Cause:**
`hospitalId` is taken from `req.query` (URL) and used directly in a DB query. The `requireTenant` middleware only verifies that the JWT user has a tenant — it does NOT prevent them from querying a different hospital by supplying another `hospitalId` in the URL.

**Impact:**

- A nurse from Hospital-A can call `/api/bookings/availability?hospitalId=HOSPITAL_B_ID&doctorId=...` and see Hospital-B's appointment booking density.
- Horizontal privilege escalation.

**Fix:**

```ts
// ✅ FIX: Derive hospital from user context, never from client
const { doctorId, date } = availabilityReq.query;

const targetHospitalId =
  availabilityReq.user!.role === "super-admin"
    ? (availabilityReq.query.hospitalId as string) // Super-admin can specify
    : availabilityReq.user!.hospital; // All others: use JWT hospital

if (!targetHospitalId) {
  return res
    .status(400)
    .json({ message: "Hospital context not found in session" });
}

const appointments = await Appointment.find({
  doctor: doctorId,
  hospital: targetHospitalId, // ✅ From session, not client
  date: new Date(date as string),
  status: { $ne: "cancelled" },
});
```

---

#### H-2 — Leave Controller Doctor Hospital Not Cross-Validated

| Field     | Detail                                     |
| --------- | ------------------------------------------ |
| **File**  | `Leave/Controllers/leaveController.ts`     |
| **Lines** | 47–52                                      |
| **Risk**  | Leave request created under wrong hospital |

**Problematic Code:**

```ts
if (role === "doctor") {
  const doctorProfile = await (
    DoctorProfile.findOne({ user: userId }) as any
  ).unscoped();
  if (!doctorProfile) return sendStatus(res, 404, "Doctor profile not found");
  hospitalId = doctorProfile.hospital; // ← Taken from profile, not verified against JWT
  assignedHelpdesk = doctorProfile.assignedHelpdesk;
}
```

**Root Cause:**
The `hospitalId` is taken from the DoctorProfile document without verifying it matches `req.user.hospital` from the JWT. If a profile has a stale or incorrect hospital reference, leave records will be created under the wrong hospital.

**Fix:**

```ts
if (role === "doctor") {
  const doctorProfile = await (
    DoctorProfile.findOne({ user: userId }) as any
  ).unscoped();
  if (!doctorProfile) return sendStatus(res, 404, "Doctor profile not found");

  // ✅ FIX: Cross-check profile hospital with JWT hospital; trust JWT as source of truth
  const profileHospital = doctorProfile.hospital?.toString();
  const jwtHospital = (leaveReq.user as any).hospital?.toString();

  if (profileHospital && jwtHospital && profileHospital !== jwtHospital) {
    console.warn(
      `[Leave] Hospital mismatch: profile=${profileHospital}, jwt=${jwtHospital}`,
    );
    hospitalId = jwtHospital; // Trust JWT
  } else {
    hospitalId = doctorProfile.hospital;
  }
  assignedHelpdesk = doctorProfile.assignedHelpdesk;
}
```

---

#### H-3 — Attendance Auto-Provisioning Assigns Wrong Hospital

| Field     | Detail                                                  |
| --------- | ------------------------------------------------------- |
| **File**  | `Staff/Controllers/attendanceController.ts`             |
| **Lines** | 86–91                                                   |
| **Risk**  | Attendance records permanently linked to wrong hospital |

**Problematic Code:**

```ts
let hospitalId = user?.hospital;
if (!hospitalId) {
  const defaultHospital = await Hospital.findOne(); // ← First hospital in DB!
  hospitalId = defaultHospital?._id;
}
```

**Root Cause:**
When a user logs in but has no hospital in their JWT (incomplete profile), the system auto-creates their `StaffProfile` and links it to whichever hospital was created first in the database.

**Impact:**

- Staff from Hospital-B have their attendance records stored under Hospital-A.
- HR / attendance reports for Hospital-A include Hospital-B's staff.

**Fix:**

```ts
let hospitalId = user?.hospital;
if (!hospitalId) {
  // ✅ FIX: Never fall back to a random hospital — fail explicitly
  throw new Error(
    `Cannot auto-provision staff profile for user ${user?._id}: ` +
      `no hospital association found. Assign the user to a hospital first.`,
  );
}
```

---

#### H-4 — Lab Invoice List Accepts `hospitalId` From Client Request

| Field     | Detail                                                  |
| --------- | ------------------------------------------------------- |
| **File**  | `Lab/Controllers/labController.ts`                      |
| **Lines** | 1005–1020 (`getAllInvoices`)                            |
| **Risk**  | Lab staff can view financial records of other hospitals |

**Problematic Code:**

```ts
let hospitalId =
  requester?.role === "hospital-admin"
    ? requester.hospital
    : req.query.hospitalId || req.headers["x-hospital-id"]; // ← client-controlled!
```

**Root Cause:**
For all roles except `hospital-admin`, the `hospitalId` used to filter financial records comes from the client's request (`req.query` or headers). Any lab user can pass another hospital's ID to access their billing data.

**Fix:**

```ts
// ✅ FIX: Derive hospitalId from session for all non-super-admin roles
let hospitalId: any;

if (requester?.role === "super-admin") {
  // Super-admins can specify a target via header (already validated by resolveTenant)
  hospitalId =
    req.query.hospitalId || req.headers["x-hospital-id"] || undefined;
} else {
  // All staff: strictly use their assigned hospital from JWT
  hospitalId = requester?.hospital;
  if (!hospitalId) {
    return res.status(403).json({ message: "Hospital context required" });
  }
}
```

---

### 🟡 Medium Issues

---

#### M-1 — Reminder Service Not Partitioned by Hospital

| Field     | Detail                                                                            |
| --------- | --------------------------------------------------------------------------------- |
| **File**  | `services/reminderService.ts`                                                     |
| **Lines** | 24, 38, 114, 126, 134, 201, 238, 248, 263, 337, 351, 382, 434, 443, 485, 526, 528 |
| **Risk**  | Cross-hospital reminders sent to staff of wrong hospital                          |

**Root Cause:**
The reminder service is a background cron job running outside of request scope (no AsyncLocalStorage context), so `.unscoped()` is technically correct. However, it queries and processes data across **all hospitals at once** without partitioning. In a multi-hospital deployment, reminders from Hospital-B's data could be processed with Hospital-A's configuration.

**Fix Pattern:**

```ts
// ✅ FIX: Process reminders per-hospital to maintain isolation
const hospitals = await Hospital.find({}).select("_id").lean();

for (const hospital of hospitals) {
  const hId = hospital._id;

  // All queries inside this loop must be scoped to hId:
  const configs = await (
    ReminderConfiguration.find({
      isActive: true,
      hospital: hId, // ← Scope to this hospital
    }) as any
  ).unscoped();

  // ... process reminders for this hospital only
}
```

---

#### M-2 — IPD Controller Falls Back to First Hospital

| Field    | Detail                                  |
| -------- | --------------------------------------- |
| **File** | `IPD/Controllers/ipdController.ts`      |
| **Line** | 69                                      |
| **Risk** | IPD admissions linked to wrong hospital |

**Problematic Code:**

```ts
const h = await Hospital.findOne(); // ← First hospital in DB as fallback
```

**Fix:**

```ts
// ✅ FIX: Require hospital context strictly — no fallback in clinical flows
if (!hospitalId) {
  return res.status(400).json({
    message:
      "Hospital context is required for IPD admission. User must be assigned to a hospital.",
  });
}
```

---

#### M-3 — Helpdesk Controller Falls Back to First Hospital

| Field    | Detail                                        |
| -------- | --------------------------------------------- |
| **File** | `Helpdesk/Controllers/helpDeskController.ts`  |
| **Line** | 199                                           |
| **Risk** | Helpdesk tickets created under wrong hospital |

**Problematic Code:**

```ts
const fallbackHospital = await Hospital.findOne(); // ← First hospital in DB
```

**Fix:**

```ts
// ✅ FIX: Require context — no random fallback
if (!hospitalId) {
  return res.status(400).json({
    message: "Hospital context required for helpdesk operations",
  });
}
```

---

#### M-4 — Messages Not Scoped by Hospital in Read Queries

| Field     | Detail                                                   |
| --------- | -------------------------------------------------------- |
| **File**  | `Messages/Controllers/messageController.ts`              |
| **Lines** | 209–216 (`getMessages`), 234–237 (`getConversations`)    |
| **Risk**  | Users may see messages from cross-hospital conversations |

**Problematic Code:**

```ts
// getMessages — no hospital filter
const messages = await Message.find({
  $or: [
    { sender: currentUserId, recipient: otherUserId },
    { sender: otherUserId, recipient: currentUserId },
  ],
  hiddenFor: { $ne: currentUserId },
  // ← No hospital filter!
});

// getConversations — no hospital filter
const messages = await Message.find({
  $or: [{ sender: currentUserId }, { recipient: currentUserId }],
  hiddenFor: { $ne: currentUserId },
  // ← No hospital filter!
});
```

**Fix:**

```ts
// ✅ FIX: Add hospital scope to all message read queries
const userHospital = (req as any).user?.hospital;
const hospitalFilter = userHospital ? { hospital: userHospital } : {};

// getMessages
const messages = await Message.find({
  ...hospitalFilter,
  $or: [
    { sender: currentUserId, recipient: otherUserId },
    { sender: otherUserId, recipient: currentUserId },
  ],
  hiddenFor: { $ne: currentUserId },
});

// getConversations
const messages = await Message.find({
  ...hospitalFilter,
  $or: [{ sender: currentUserId }, { recipient: currentUserId }],
  hiddenFor: { $ne: currentUserId },
});
```

---

### 🟢 Low Issues

---

#### L-1 — Doctor `/me` Routes Missing Explicit `requireTenant`

| Field     | Detail                                                |
| --------- | ----------------------------------------------------- |
| **File**  | `Doctor/Routes/doctorRoutes.ts`                       |
| **Lines** | 35–60                                                 |
| **Risk**  | Routes accessible without explicit tenant enforcement |

**Root Cause:**
`router.use(requireTenant)` is placed on line 103, but `/me` and `/profile/me` are defined on lines 35–60, before that middleware. The Mongoose plugin still protects the DB layer, but the route-level guard is missing.

**Fix:**

```ts
// ✅ FIX: Add requireTenant explicitly to /me routes
router.get(
  "/me",
  requireTenant, // ← Add this
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
  ),
  getDoctorProfile,
);
router.get(
  "/profile/me",
  requireTenant, // ← Add this
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
  ),
  getDoctorProfile,
);
```

---

#### L-2 — Public Doctor Search / Lookup Lacks Role Restrictions

| Field     | Detail                                       |
| --------- | -------------------------------------------- |
| **File**  | `Doctor/Routes/doctorRoutes.ts`              |
| **Lines** | 205–206                                      |
| **Risk**  | Doctor data exposed without role restriction |

**Current Code:**

```ts
router.get("/", searchDoctors); // Any authenticated user
router.get("/:id", getDoctorById); // Any authenticated user
```

**Fix:**

```ts
// ✅ FIX: Add explicit role restrictions
router.get(
  "/",
  requireTenant,
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "patient",
    "doctor",
    "nurse",
  ),
  searchDoctors,
);
router.get(
  "/:id",
  requireTenant,
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "patient",
    "doctor",
    "nurse",
    "pharma-owner",
    "lab",
  ),
  getDoctorById,
);
```

> Also audit `searchDoctors` and `getDoctorById` controller functions to confirm they don't expose private fields (mobile number, email, etc.) in their responses.

---

## 4. Complete Fix Plan — Phase by Phase

---

### Phase 1 — Critical Fixes (Do First)

> **Estimated Time:** ~30 minutes
> **Risk to Existing Functionality:** Very Low — single-line changes

#### Step 1.1 — Fix Cross-Hospital Helpdesk Notification

**File:** `Appointment/Controllers/bookingController.ts` → Line 496

```ts
// BEFORE:
const helpdeskUsers = await User.find({ role: "helpdesk" });

// AFTER:
const helpdeskUsers = await User.find({
  role: "helpdesk",
  hospital: targetHospitalId,
});
```

#### Step 1.2 — Fix Message Hospital Assignment

**File:** `Messages/Controllers/messageController.ts` → Lines 104–117

```ts
// BEFORE:
if (!hospitalId) {
  const clinic = await Hospital.findOne().select("_id");
  if (clinic) {
    hospitalId = clinic._id;
  }
}

// AFTER:
if (!hospitalId) {
  hospitalId = (req as any).user?.hospital;
}
if (!hospitalId) {
  return res
    .status(400)
    .json({ message: "Hospital context required for messaging" });
}
```

#### Step 1.3 — Fix Lab Invoice Hospital Fallback (2 locations)

**File:** `Lab/Controllers/labController.ts` → Lines 754–759 AND 833–838

```ts
// BEFORE (both locations):
if (!txHospital) {
  const defaultHospital = await Hospital.findOne();
  if (defaultHospital) txHospital = defaultHospital._id;
}

// AFTER (both locations):
if (!txHospital) {
  txHospital = (req as any).user?.hospital;
}
if (!txHospital) {
  throw new Error("Hospital context required for invoice creation.");
}
```

---

### Phase 2 — High Priority Fixes

> **Estimated Time:** ~45 minutes
> **Risk to Existing Functionality:** Low — input source changes

#### Step 2.1 — Fix Availability Check `hospitalId` Source

**File:** `Appointment/Controllers/bookingController.ts` → Line 533

```ts
// BEFORE:
const { doctorId, hospitalId, date } = availabilityReq.query;

// AFTER:
const { doctorId, date } = availabilityReq.query;
const hospitalId =
  availabilityReq.user!.role === "super-admin"
    ? (availabilityReq.query.hospitalId as string)
    : availabilityReq.user!.hospital;
```

#### Step 2.2 — Fix Lab Invoice List `hospitalId` Source

**File:** `Lab/Controllers/labController.ts` → Lines 1005–1020

```ts
// BEFORE:
let hospitalId =
  requester?.role === "hospital-admin"
    ? requester.hospital
    : req.query.hospitalId || req.headers["x-hospital-id"];

// AFTER:
let hospitalId: any;
if (requester?.role === "super-admin") {
  hospitalId =
    req.query.hospitalId || req.headers["x-hospital-id"] || undefined;
} else {
  hospitalId = requester?.hospital;
  if (!hospitalId)
    return res.status(403).json({ message: "Hospital context required" });
}
```

#### Step 2.3 — Fix Attendance Auto-Provisioning Hospital

**File:** `Staff/Controllers/attendanceController.ts` → Lines 86–91

```ts
// BEFORE:
if (!hospitalId) {
  const defaultHospital = await Hospital.findOne();
  hospitalId = defaultHospital?._id;
}

// AFTER:
if (!hospitalId) {
  throw new Error(
    `Cannot provision attendance profile for user ${user?._id}: no hospital found in session.`,
  );
}
```

#### Step 2.4 — Fix Leave Controller Hospital Validation

**File:** `Leave/Controllers/leaveController.ts` → Lines 47–52

```ts
// Add cross-validation (shown in H-2 section above):
const jwtHospital = (leaveReq.user as any).hospital?.toString();
hospitalId = jwtHospital; // Trust JWT as source of truth
```

---

### Phase 3 — Medium Priority Fixes

> **Estimated Time:** ~90 minutes
> **Risk to Existing Functionality:** Medium — behavioural changes in services

#### Step 3.1 — Fix IPD Hospital Fallback

**File:** `IPD/Controllers/ipdController.ts` → Line 69

```ts
// Remove Hospital.findOne() fallback, require context explicitly
if (!hospitalId) {
  return res
    .status(400)
    .json({ message: "Hospital context required for IPD operations" });
}
```

#### Step 3.2 — Fix Helpdesk Hospital Fallback

**File:** `Helpdesk/Controllers/helpDeskController.ts` → Line 199

```ts
// Remove Hospital.findOne() fallback
if (!hospitalId) {
  return res.status(400).json({ message: "Hospital context required" });
}
```

#### Step 3.3 — Fix Message Read Queries

**File:** `Messages/Controllers/messageController.ts` → Lines 209–237

```ts
// Add hospital filter to both getMessages and getConversations
const userHospital = (req as any).user?.hospital;
const hospitalFilter = userHospital ? { hospital: userHospital } : {};
// Spread hospitalFilter into both Message.find() calls
```

#### Step 3.4 — Fix Reminder Service Hospital Partitioning

**File:** `services/reminderService.ts`

```ts
// Wrap all reminder query logic in a per-hospital loop:
const hospitals = await Hospital.find({}).select("_id").lean();
for (const hospital of hospitals) {
  const hId = hospital._id;
  // All queries inside use: { hospital: hId }
}
```

---

### Phase 4 — Low Priority Fixes (Defence-in-Depth)

> **Estimated Time:** ~30 minutes

#### Step 4.1 — Add `requireTenant` to Doctor `/me` Routes

**File:** `Doctor/Routes/doctorRoutes.ts` → Lines 35–60

```ts
// Add requireTenant explicitly to /me and /profile/me route definitions
router.get("/me", requireTenant, authorizeRoles(...), getDoctorProfile);
router.get("/profile/me", requireTenant, authorizeRoles(...), getDoctorProfile);
```

#### Step 4.2 — Restrict Doctor Search Routes

**File:** `Doctor/Routes/doctorRoutes.ts` → Lines 205–206

```ts
router.get(
  "/",
  requireTenant,
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "patient",
    "doctor",
    "nurse",
  ),
  searchDoctors,
);
router.get("/:id", requireTenant, getDoctorById);
```

---

## 5. Testing Checklist After Fixes

### Phase 1 — Critical Fixes Verification

- [ ] Book an appointment as Hospital-A patient → confirm Hospital-B helpdesk does **NOT** receive notification
- [ ] Send a message as Hospital-A staff → confirm message `hospital` field in DB matches Hospital-A's ID
- [ ] Finalize a lab order in Hospital-A → confirm the `Transaction` record has Hospital-A's ID
- [ ] Pay for a lab order in Hospital-A → confirm `Transaction` record has Hospital-A's ID

### Phase 2 — High Fixes Verification

- [ ] As Hospital-A lab user, call `GET /api/bookings/availability?hospitalId=HOSP_B_ID&doctorId=...` → confirm only Hospital-A data returned (or 400/403)
- [ ] Request leave as a doctor → confirm leave `hospital` field matches doctor's JWT hospital
- [ ] Attempt check-in with a user who has no hospital assigned → confirm **400 error** (not auto-assigned to random hospital)
- [ ] As lab staff in Hospital-A, call `GET /api/lab/invoices?hospitalId=HOSP_B_ID` → confirm only Hospital-A invoices returned

### Phase 3 — Medium Fixes Verification

- [ ] IPD admission still works for valid hospital users
- [ ] Helpdesk ticket creation still works
- [ ] Messages still send and receive within same hospital
- [ ] Reminder service still fires correctly for all hospitals (check logs)

### Phase 4 — Low Fixes Verification

- [ ] Doctor `/me` endpoint still returns profile for authenticated hospital users
- [ ] Doctor search still works for allowed roles

### General Regression Tests (Run After All Phases)

- [ ] Appointment booking end-to-end still works
- [ ] Lab order creation → finalize → pay flow still works
- [ ] Attendance check-in/out still works for valid hospital users
- [ ] Leave request and approval flow still works
- [ ] IPD admissions / discharge flow still works
- [ ] Pharmacy order flow still works
- [ ] Notifications still delivered to correct recipients
- [ ] Real-time socket events still work within correct hospital rooms

---

## 6. Anti-Pattern to Eliminate Globally

> ⚠️ **Search the entire codebase for `Hospital.findOne()` and remove EVERY instance in request handlers and services.**
>
> This pattern always picks an **arbitrary hospital** (whichever was inserted first in MongoDB) and must **never** be used as a fallback in a multi-tenant system.

Run this command from the backend directory to find all remaining instances:

```bash
grep -rn "Hospital.findOne()" --include="*.ts" .
```

**Expected Results After All Fixes:** Zero results in controllers and services.
(Only acceptable in migration scripts or seeding files that run once, not in request handlers.)

---

## 7. Summary Table

| ID  | Severity    | File                      | Line(s)            | Issue Description                                        | Fix Complexity | Phase |
| --- | ----------- | ------------------------- | ------------------ | -------------------------------------------------------- | -------------- | ----- |
| C-1 | 🔴 Critical | `bookingController.ts`    | 496                | Helpdesk notification sent to ALL hospitals              | 1 line         | 1     |
| C-2 | 🔴 Critical | `messageController.ts`    | 104–109            | Message hospital picked from first DB record             | 3 lines        | 1     |
| C-3 | 🔴 Critical | `labController.ts`        | 754–759, 833–838   | Lab invoice hospital picked from first DB record         | 3 lines (×2)   | 1     |
| H-1 | 🟠 High     | `bookingController.ts`    | 533, 641           | Client-supplied `hospitalId` in availability check       | 5 lines        | 2     |
| H-2 | 🟠 High     | `leaveController.ts`      | 47–52              | Doctor leave hospital not cross-validated with JWT       | 5 lines        | 2     |
| H-3 | 🟠 High     | `attendanceController.ts` | 86–91              | Attendance auto-provisioned to first hospital in DB      | 3 lines        | 2     |
| H-4 | 🟠 High     | `labController.ts`        | 1005–1020          | Lab invoices accessible via client-supplied `hospitalId` | 8 lines        | 2     |
| M-1 | 🟡 Medium   | `reminderService.ts`      | 24+ (17 locations) | Reminder service not partitioned by hospital             | Refactor loop  | 3     |
| M-2 | 🟡 Medium   | `ipdController.ts`        | 69                 | IPD fallback to first hospital in DB                     | 2 lines        | 3     |
| M-3 | 🟡 Medium   | `helpDeskController.ts`   | 199                | Helpdesk fallback to first hospital in DB                | 2 lines        | 3     |
| M-4 | 🟡 Medium   | `messageController.ts`    | 209, 234           | Messages not hospital-scoped in read queries             | 4 lines        | 3     |
| L-1 | 🟢 Low      | `doctorRoutes.ts`         | 35–60              | `/me` routes missing explicit `requireTenant`            | 2 lines        | 4     |
| L-2 | 🟢 Low      | `doctorRoutes.ts`         | 205–206            | Doctor search lacks role restrictions                    | 2 lines        | 4     |

---

### Fix Timeline Summary

| Phase              | Issues             | Estimated Time | Risk Level |
| ------------------ | ------------------ | -------------- | ---------- |
| Phase 1 — Critical | C-1, C-2, C-3      | ~30 minutes    | Very Low   |
| Phase 2 — High     | H-1, H-2, H-3, H-4 | ~45 minutes    | Low        |
| Phase 3 — Medium   | M-1, M-2, M-3, M-4 | ~90 minutes    | Medium     |
| Phase 4 — Low      | L-1, L-2           | ~30 minutes    | Very Low   |
| **Total**          | **All 12 issues**  | **~3.5 hours** | —          |

---

_Audit & Fix Plan by: Antigravity AI | Date: 2026-03-01 | Project: MSCurechain Multitenant Backend_
