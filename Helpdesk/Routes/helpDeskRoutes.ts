import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import {
  helpDeskDashboard,
  helpdeskLogin,
  helpdeskLogout,
  helpdeskMe,
  updateHelpdeskProfile,
  getHelpDeskById,
  getHelpDeskByHospitalId,
  getHelpDeskDoctors,
  getBillingCategories,
  addBillingCategory,
  removeBillingCategory
} from "../Controllers/helpDeskController.js";
import {
  getPatients,
  getPatientById,
  registerPatient,
  updatePatient,
  getPatientIPDAdmissions,
  getPatientVisitHistory,
  lookupGuardianByMobile,
} from "../Controllers/frontDeskController.js";
import {
  getAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  bookAppointment,
} from "../../Appointment/Controllers/bookingController.js";
import {
  createDoctor,
  deleteUser,
} from "../../Admin/Controllers/adminController.js";
import { cacheMiddleware } from "../../middleware/cache.middleware.js";
import { getPackages, submitPackageBill } from "../../Admin/Controllers/hospitalPackageController.js";

import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

const router = express.Router();

// Auth & Profile
router.post("/login", helpdeskLogin);
// Refresh is handled centrally via /api/auth/refresh
router.post("/logout", helpdeskLogout);

// Protected Routes Stack
router.use(protect);
router.use(resolveTenant);
router.use(checkPortalLicense("helpdesk"));

// Me/Profile
router.get("/me", helpdeskMe);
router.get("/profile/me", helpdeskMe);
router.put("/me", authorizeRoles("helpdesk", "masterhelpdesk"), updateHelpdeskProfile);

// Explicit Tenant Required for below
router.use(requireTenant);

// Dashboard
router.get("/dashboard", authorizeRoles("helpdesk", "masterhelpdesk"), helpDeskDashboard);

// Doctors
router.get("/doctors", cacheMiddleware(60), getHelpDeskDoctors);
router.post(
  "/doctor",
  authorizeRoles("hospital-admin", "super-admin", "masterhelpdesk"),
  createDoctor,
);

// Patients
router.get("/guardians/lookup", lookupGuardianByMobile);
router.get("/patients/search", getPatients);
router.get("/patients/:patientId/ipd-admissions", getPatientIPDAdmissions);
router.get("/patients/:patientId/visit-history", getPatientVisitHistory);
router.get("/patients/:patientId", getPatientById);
router.post("/patients/register", registerPatient);
router.put("/patients/:patientId", updatePatient);

// Appointments
router.get("/appointments", getAppointments);
router.get("/appointments/:id", getAppointmentById);
router.post("/appointments", bookAppointment);
router.patch("/appointments/:id/status", updateAppointmentStatus);

// Transactions
import { getTransactions, editTransaction } from "../../Admin/Controllers/adminController.js";
router.get("/transactions", authorizeRoles("helpdesk", "masterhelpdesk", "hospital-admin", "admin", "super-admin", "frontdesk", "staff"), getTransactions);
router.patch("/transactions/:id/edit", authorizeRoles("helpdesk", "masterhelpdesk", "hospital-admin", "admin", "super-admin", "frontdesk", "staff"), editTransaction);

// Packages
router.get("/packages", authorizeRoles("helpdesk", "masterhelpdesk"), getPackages);
router.post("/packages/bill", authorizeRoles("helpdesk", "masterhelpdesk"), submitPackageBill);

// Lab Billing (for Add Bills feature — bypasses lab portal license)
import {
  getLabTests,
  createLabTest,
  createLabOrder,
  updateLabTest,
} from "../../Lab/Controllers/labController.js";
router.get("/lab-tests", authorizeRoles("helpdesk", "masterhelpdesk"), getLabTests);
router.post("/lab-tests", authorizeRoles("helpdesk", "masterhelpdesk"), createLabTest);
router.put("/lab-tests/:id", authorizeRoles("helpdesk", "masterhelpdesk"), updateLabTest);
router.post("/lab-orders-test", createLabOrder);
router.post("/lab-orders", authorizeRoles("helpdesk", "masterhelpdesk"), createLabOrder);

// Billing Categories CRUD
router.get("/billing-categories", authorizeRoles("helpdesk", "masterhelpdesk"), getBillingCategories);
router.post("/billing-categories", authorizeRoles("helpdesk", "masterhelpdesk"), addBillingCategory);
router.delete("/billing-categories/:category", authorizeRoles("helpdesk", "masterhelpdesk"), removeBillingCategory);

// Hospital/Helpdesk Details
router.get("/hospital/:hospitalId", getHelpDeskByHospitalId);
router.get("/:id", getHelpDeskById);

router.delete(
  "/:id",
  authorizeRoles("super-admin", "hospital-admin"),
  deleteUser,
);

export default router;
