### MSCureChain – System & Functional Overview

This document describes the **end‑to‑end features**, **per‑module behaviour**, and **production‑readiness assessment** of the MSCureChain multitenant Hospital Management System.

---

### 1. System Overview

- **Purpose**: A multi‑tenant Hospital Management System (HMS) that connects hospitals, doctors, nurses, helpdesk, labs, pharmacies, HR, emergency staff, discharge staff, and patients on a single platform.
- **Frontend**: Next.js (App Router), React 18, React Query, Tailwind, charting libraries (ApexCharts/Recharts), Socket.IO client.
- **Backend**: Node.js 20, Express 5, MongoDB (Mongoose 8), Redis, Socket.IO, TypeScript.
- **Security & Middleware**:
  - `helmet`, `express-mongo-sanitize`, `hpp`, CORS with allow‑list.
  - Rate‑limit and gateway middleware (`advancedApiGateway`, `errorRecovery`).
  - Tenant context via `initTenantStore`, `resolveTenant`, `requireTenant`.
- **Key Cross‑Cutting Features**:
  - Multi‑hospital tenancy.
  - Role‑based portals and permissions.
  - Real‑time notifications and live dashboards.
  - OPD appointments, IPD admissions and billing.
  - Pharmacy, lab, HR, performance, SOP, incidents, emergency.

---

### 2. Authentication & Authorization

- **Roles**:
  - **Core**: `super-admin`, `hospital-admin`, `doctor`, `nurse`, `helpdesk`, `staff`, `hr`, `pharma-owner`, `lab`, `patient`.
  - **Specialised**: `emergency` (ambulance staff), `discharge` (discharge portal).
- **Backend Endpoints**:
  - `/api/auth/*` – main user auth (login, register, OTP, me, logout, refresh).
  - `/api/super-admin/*`, `/api/admin/*` – super‑admin and legacy admin.
  - `/api/emergency/auth/*` – emergency personnel auth.
  - `/api/discharge/auth/*` – discharge staff auth.
- **Middlewares**:
  - `protect` – validates JWT, attaches `req.user`.
  - `authorizeRoles(...roles)` – checks role membership.
  - `resolveTenant` / `requireTenant` – sets and enforces hospital tenant.
- **Frontend Integration**:
  - `AUTH_ENDPOINTS`, `USER_ENDPOINTS`, and role‑specific endpoints in `endpoints.ts`.
  - Portals under `app/[hospitalId]/(portals)/...` gate routes based on profile/role.

---

### 3. Multi‑Tenancy & Hospital Management

- **Goal**: Isolate data per hospital while sharing a single backend and database cluster.
- **Key Models & Controllers**:
  - `Hospital` – hospital metadata, branches, billing categories, quality and reminder configs.
  - Reminder configuration controllers (`getReminderConfig`, `updateReminderConfig`).
  - IPD‑pharmacy settings (`updateIPDPharmaSettings`).
- **Routes** (backend):
  - `/api/hospitals` – create/list/get/patch/delete hospitals and branches.
  - `/api/hospital` and `/api/hospital-admin` – hospital‑admin‑scoped management.
  - `/api/hospitals/metadata` – departments, rooms, wards, billing categories, clinical note metadata, IPD‑pharma settings.
- **Tenant Handling**:
  - Tenant context is attached early in the pipeline (`initTenantStore`) and then resolved and required for hospital‑scoped routes.
  - Most admin, HR, IPD, pharmacy, lab routes are protected with both `protect` and tenant middlewares.
- **Frontend**:
  - `HOSPITAL_ADMIN_ENDPOINTS` encapsulate URLs for dashboard, staff, attendance, payroll, transactions, analytics.
  - Hospital admin dashboard (`hospital-admin/page.tsx`) displays tenant‑specific KPIs.

---

### 4. Appointments & OPD Workflows

- **Purpose**: Manage patient bookings with doctors, availability, queues, payments, and notifications.
- **Key Components**:
  - Model: `Appointment`.
  - Controller: `Appointment/Controllers/bookingController.ts`.
  - Routes:
    - `/api/bookings/*` – booking, availability, hospital stats.
    - `/api/doctor/*` – consultation workflows (start/end/pause/resume, drafts).
    - `/api/doctors/*` – doctor dashboard, calendar statistics, quick notes, patients.
- **Core Behaviours**:
  - **Booking**:
    - Patients or helpdesk/hospital‑admin can book.
    - Resolves patient ID vs `PatientProfile` automatically.
    - Resolves doctor either by profile ID or user ID.
    - Generates MRN (medical record number) if missing, linked to hospital.
    - Supports queue‑style bookings and walk‑in bookings (flexible times).
  - **Availability**:
    - `checkAvailability` generates time slots based on doctor’s configured availability and consultation duration.
    - Excludes slots where doctor is on approved leave.
    - Groups slots into hourly blocks with capacity vs booked counts.
  - **Status Lifecycle**:
    - `pending` → `Booked` / `confirmed` → `in-progress` → `completed` or `cancelled`.
    - Prevents patients from having multiple active appointments with the same doctor on the same day.
  - **Notifications & Sockets**:
    - On booking and status changes, creates DB notifications and emits Socket.IO events to patient, doctor, hospital, and helpdesk rooms.
  - **Payments & Transactions**:
    - Associates booking with consultation fee or, for IPD type, uses active IPD admission’s payment information.
    - Creates `Transaction` entries for bookings (type `appointment_booking` or `ipd_advance`).

---

### 5. IPD (Inpatient) & Bed Management

- **Purpose**: Manage bed allocation, IPD admissions, transfers, billing, vitals monitoring, and discharge.
- **Key Modules**:
  - Models: `IPDAdmission`, `IPDDepartment`, `Room`, beds, IPD billing models, vitals thresholds and templates.
  - Routes:
    - `/api/ipd/beds` – beds and quick‑status.
    - `/api/ipd/admissions` and `/api/ipd` – admissions, transfers, discharge, requests.
    - `/api/ipd/billing/*` – IPD billing summary, charges, advances, discounts, lock.
    - `/api/ipd/thresholds/*` – vitals thresholds and templates.
    - `/api/ipd/alerts/*` – vitals alert history and details.
- **Core Behaviours**:
  - **Bed Management**:
    - Ward/category‑wise beds with real‑time status.
    - Support for admissions, transfers, and discharges with requests and approvals.
  - **Billing**:
    - IPD billing summary per admission.
    - Charges, advances, discounts, and final lock for billing.
  - **Vitals & Monitoring**:
    - Threshold templates per admission or hospital.
    - Background monitoring tasks emit alerts when thresholds are breached.
  - **Integration with Appointments and Pharmacy**:
    - IPD appointments sync payment status with IPD admission.
    - IPD pharmacy issuance and medicine returns respect IPD admission lifecycle.

---

### 6. Pharmacy Module

- **Purpose**: Provide hospital‑linked pharmacy with inventory, billing, IPD issuance, returns, and analytics.
- **Key Components**:
  - Models: `PharmaProfile`, `Product`, `Batch`, `PharmacyOrder`, `Invoice`, `MedicineReturn`, `IPDMedicineIssuance`.
  - Routes: `/api/pharmacy/*`.
  - Controllers: products, invoices, suppliers, reports, transactions, audit logs, IPD issuance, medicine returns.
- **Core Behaviours**:
  - **Pharmacy Profile Resolution**:
    - `injectPharmacy` middleware:
      - For `pharma-owner`, resolves by user ID.
      - For admins, resolves by hospital ID (query/body/header/user.hospital) and chooses the profile with richest product catalog when multiple exist.
      - For admin roles on GET requests, returns a tolerant `null` profile instead of failing hard to avoid UI crashes.
  - **Inventory Management**:
    - CRUD for products and suppliers.
    - Bulk import (Excel) and bulk creation of products.
    - Exports products and invoices to Excel.
  - **Billing & Reports**:
    - Pharmacy invoices, dashboard stats, sales and inventory reports, analytics, audit logs.
  - **IPD Integration**:
    - IPD medicine issuance per admission, balance summaries, nurse‑assigned admissions, pharmacy sign‑off.
    - Medicine return workflows (submit, approve, reject) with hospital‑level views and per‑admission history.

---

### 7. Lab Module

- **Purpose**: Handle diagnostic workflows across tests, departments, orders, billing, and reporting.
- **Key Components**:
  - Models: `LabOrder`, `DirectLabOrder`, `Department`, lab tests and parameters.
  - Routes: `/api/lab/*`, `/api/lab/walk-in`.
- **Core Behaviours**:
  - **Tests & Departments**:
    - CRUD for tests and departments, test parameters, and bulk destruction.
  - **Orders & Results**:
    - Lab orders linked to appointments or created as walk‑ins.
    - Sample collection, status updates, results upload.
  - **Billing & Dashboard**:
    - Invoices per order.
    - Lab dashboard stats and meta for UI configuration.

---

### 8. HR, Staff, Attendance & Payroll

- **Purpose**: Manage hospital workforce, attendance, leaves, recruitment, and payroll.
- **Key Components**:
  - Models: `StaffProfile`, `Shift`, `Payroll`, HR entities, leaves.
  - Routes: `/api/hr/*`, `/api/hospital/*` (staff, attendance, payroll).
- **Core Behaviours**:
  - **Staff Management**:
    - Doctors, nurses, helpdesk, staff, HR, discharge staff are all onboarded under the hospital.
    - HR can create/update/deactivate/activate staff profiles.
  - **Attendance**:
    - Staff and doctor attendance endpoints for self and admin views.
    - Attendance stats, summaries, detailed views, and dashboards.
  - **Payroll**:
    - Payroll listing with pagination and filters.
    - Payroll generation over custom date ranges.
    - Status updates (paid, pending) plus payment method and transaction ID.
    - Utility method for salary resolution and statutory deductions (PF, ESI, professional tax).
  - **Recruitment & Performance**:
    - Recruitment requests, statuses, reviews, and details under `/api/recruitment/*`.
    - Performance dashboards and weights under `/api/performance/*`.

---

### 9. Performance, Quality, SOP, Training & Incidents

- **Performance Analytics**:
  - Routes: `/api/performance/*`.
  - Dashboards for doctors, nurses, staff; trends per employee; configurable weights per role.
- **Quality Management**:
  - Routes: `/api/quality/*`.
  - Indicators, actions, status updates, and evaluations.
- **SOP & Training**:
  - SOP routes under `/api/sop/*`:
    - CRUD, archive, history, downloads, acknowledgements, reporting.
  - Training routes under `/api/training/*`:
    - Staff training history, staff detail, training sessions.
- **Incidents**:
  - Routes: `/api/incidents/*`.
  - Incident reporting, listing, and responses.

---

### 10. Emergency & Ambulance

- **Purpose**: Provide emergency request handling and ambulance‑hospital coordination.
- **Key Components**:
  - Routes: `/api/emergency/auth/*`, `/api/emergency/requests/*`.
  - Frontend endpoints: `EMERGENCY_ENDPOINTS` and `AMBULANCE_ENDPOINTS`.
- **Core Behaviours**:
  - **Auth**:
    - Dedicated emergency auth domain (login, logout, refresh, profile).
  - **Requests**:
    - Create emergency requests from ambulance side.
    - Hospital‑side listing, statistics, and available hospital discovery.
    - Accept/reject flows for emergency requests per hospital.

---

### 11. Patient Portal & Feedback

- **Purpose**: Give patients self‑service access to records, appointments, labs, and prescriptions.
- **Backend**:
  - Routes: `/api/patients/*`, `/api/feedback/*`.
- **Frontend**:
  - `PATIENT_ENDPOINTS` for profile, appointments, prescriptions, lab records, dashboard data, hospitals.
- **Core Behaviours**:
  - Patient profile CRUD with MRN linkage and demographics.
  - Patient appointments listing and details.
  - Patient lab and prescription history.
  - Feedback submission and hospital feedback dashboards.

---

### 12. Notifications & Real‑Time Features

- **Purpose**: Deliver real‑time updates for appointments, vitals, queues, and announcements.
- **Backend**:
  - Socket.IO server initialised in `app.ts` with `initSocket`.
  - Events:
    - `join_room` – joins user to personal/hospital rooms after validating JWT and fetching role and hospital from DB.
    - `subscribe-patient` / `unsubscribe-patient` – join/leave patient‑specific vitals rooms with access checks.
  - Notifications module handles structured messages for appointment events, helpdesk alerts, and hospital announcements.
- **Frontend**:
  - Socket client configured in `lib/integrations/api/socket.ts`.
  - Notification center UI components and portal‑specific listeners.

---

### 13. Frontend Portals & UX (High Level)

- **Purpose**: Provide dedicated experiences for each role with live hospital context.
- **Portals** (examples):
  - `app/[hospitalId]/(portals)/hospital-admin/*` – admin analytics, staff, payroll, transactions, IPD/OPD views.
  - `app/[hospitalId]/(portals)/doctor/*` – doctor dashboard, patients, prescriptions, lab tokens, analytics.
  - `app/[hospitalId]/(portals)/nurse/*` – nurse tasks, IPD beds, medicine returns.
  - `app/[hospitalId]/(portals)/helpdesk/*` – patient registration, appointments, transactions.
  - `app/[hospitalId]/(portals)/pharmacy/*` – IPD issuance, orders, inventory, bills.
  - `app/[hospitalId]/(portals)/lab/*` – lab billing, tests, departments.
  - `app/[hospitalId]/(portals)/hr/*` – HR stats, staff, recruitment, performance.
- **Landing & Marketing Pages**:
  - `app/page.tsx` – hero, AI prescriptions, bed management journey, FAQ, pricing/demo CTAs.
  - Emphasises AI prescriptions, digital records, staff attendance, bed management, integrated lab/pharmacy, multi‑portal connectivity.

---

### 14. Production Readiness – Ratings by Dimension

These are estimated ratings for a typical production deployment of MSCureChain:

- **Feature completeness**: **9/10**
  - Very broad coverage of real hospital workflows (OPD, IPD, pharmacy, lab, HR, performance, emergency, SOP, quality).
- **Backend architecture & modularity**: **8/10**
  - Clear module boundaries; some large controllers should be split into smaller services.
- **Security & access control**: **8/10**
  - Strong middleware stack (helmet, sanitisation, RBAC, tenant checks); needs continuous review of rate limiting, socket abuse prevention, and secure config.
- **Multi‑tenancy isolation**: **7.5/10**
  - Good tenant patterns; requires strict policy and automated tests to guarantee no cross‑hospital data leakage.
- **Performance & scalability**: **7.5/10**
  - Optimised queries and caching hints; background jobs and logging strategy should be adapted for multi‑instance and containerised deployments.
- **Observability & operations**: **6/10**
  - Basic diagnostics and logs exist; needs structured logs, centralised log shipping, metrics, and better dashboards for SRE/DevOps.
- **Testing & quality assurance**: **6.5/10**
  - Test toolchain is present (Jest, supertest, k6, artillery, newman); critical flows should be covered with deeper integration and regression tests.
- **Frontend UX & polish**: **8/10**
  - Modern, role‑specific dashboards and marketing pages; should add automated accessibility and performance checks.

---

### 15. Recommended Improvement Roadmap

#### 15.1 Short‑Term (High Impact)

- **Observability**
  - Introduce structured logging (e.g. Pino/Winston) with correlation IDs.
  - Pipe logs to central log store (ELK, Loki, Datadog, etc.) instead of local files.
- **Multi‑Tenancy Hardening**
  - Standardise tenant resolution (JWT + DB) and forbid trusting raw `hospitalId` from client without verification.
  - Add tests asserting that cross‑tenant access to appointments, IPD, pharmacy, lab and HR data is rejected.
- **Background Jobs**
  - Move `setInterval`‑based tasks (appointment cleanup, reminders, vitals escalation) into a dedicated worker with a queue (BullMQ/Agenda/custom).
  - Ensure only one worker processes a given job at a time (distributed locking).
- **Security Polishing**
  - Tune rate limits around `/auth`, `/bookings`, `/emergency` and socket connections.
  - Verify strict HTTPS, secure cookies, and headers in deployment configuration.

#### 15.2 Medium‑Term

- **Refactor Complex Controllers**
  - Split large controllers (e.g. booking controller) into domain services:
    - AppointmentBookingService, AppointmentStatsService, NotificationService, PatientProfileService, etc.
- **Automated Tests for Critical Scenarios**
  - For each major module (OPD, IPD, Pharmacy, Lab, HR, Emergency), add:
    - Integration tests around the main user journeys.
    - Regression tests for edge cases (cancellations, overlapping bookings, returns, failed payments).
- **Frontend Resilience & Performance**
  - Add error boundaries and fallback UIs around key portal layouts.
  - Audit bundle sizes and introduce further code‑splitting on heavy dashboards.
  - Add Lighthouse/axe checks for accessibility and core web vitals.

#### 15.3 Long‑Term

- **SRE & Platform**
  - Add metrics (Prometheus or equivalent) for request latency, error rate, queue depth, and job failures.
  - Define SLIs/SLOs for key flows (bookings, IPD billing, vitals alerts, emergency requests) and wire alerts.
- **Documentation & Runbooks**
  - Maintain this document alongside more detailed module‑specific docs.
  - Create runbooks for typical incidents:
    - Appointment queue stuck.
    - Vitals alerts not triggering.
    - Pharmacy inventory mismatch.
    - Emergency routing delays.

---

This document is intended as the **central entry point** for understanding how MSCureChain works, what features are available per module, and what is needed to operate it as a production‑grade hospital system.

