import express from "express";
import {
  createLabTest,
  getLabTests,
  getTestParameters,
  createLabOrder,
  collectSample,
  enterResult,
  notifyDoctorResults,
  finalizeOrder,
  payOrder,
  getInternalOrders,
  generateInvoice,
  getAllInvoices,
  deleteInvoice,
  getLabTest,
  getLabOrder,
  getDepartments,
  getDashboardStats,
  updateLabTest,
  deleteLabTest,
  deleteAllLabTests,
  deleteLabOrder,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getMetaOptions,
  updateMetaOptions,
  bulkImportDepartments,
  bulkImportTests,
  autoImportTest,
} from "../Controllers/labController.js";
import {
  createEquipment,
  getEquipmentList,
  getEquipmentById,
  updateEquipment,
  deleteEquipment,
  restoreEquipment,
  bulkDeleteEquipment,
  bulkRestoreEquipment,
  bulkStatusUpdate,
  bulkImportEquipment,
} from "../Controllers/equipmentController.js";
import {
  getUniversalTests,
  getUniversalTestById,
  createUniversalTest,
  updateUniversalTest,
  deleteUniversalTest,
  getSeedStatus,
  syncUniversalSeed,
  resetUniversalSeed
} from "../Controllers/universalLabController.js";
import {
  getHospitalLabConfig,
  updateHospitalLabConfig,
} from "../Controllers/hospitalLabConfigController.js";
import {
  getLabPackages,
  createLabPackage,
  updateLabPackage,
  deleteLabPackage,
} from "../Controllers/labPackageController.js";
import {
  generateLabReport,
  generateReportWithBilling,
} from "../Controllers/reportController.js";
import {
  getLabSettings,
  updateLabSettings,
  uploadLabLogo,
  uploadLabImage,
} from "../Controllers/labSettingsController.js";
import {
  createInventoryItem,
  getInventoryList,
  getInventoryById,
  updateInventoryItem,
  deleteInventoryItem,
  bulkDeleteInventory,
  bulkImportInventory,
} from "../Controllers/inventoryController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import upload from "../../middleware/Upload/upload.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

const router = express.Router();

// Protected Routes Stack
router.use((req, res, next) => {
  console.error(`[DEBUG ROUTE] ${req.method} ${req.originalUrl}`);
  next();
});
router.use(protect);
router.use(resolveTenant);

// --- UNIVERSAL MASTER LIBRARY (Super Admin Only) ---
// These routes do NOT require a hospital tenant context
router.get("/universal/seed/status", authorizeRoles("super-admin", "hospital-admin", "lab"), getSeedStatus);
router.post("/universal/seed/sync", authorizeRoles("super-admin"), syncUniversalSeed);
router.post("/universal/seed/reset", authorizeRoles("super-admin"), resetUniversalSeed);

router.get("/universal/tests", authorizeRoles("super-admin", "hospital-admin", "lab", "doctor"), getUniversalTests);
router.get("/universal/tests/:id", authorizeRoles("super-admin", "hospital-admin", "lab", "doctor"), getUniversalTestById);
router.post("/universal/tests", authorizeRoles("super-admin"), createUniversalTest);
router.put("/universal/tests/:id", authorizeRoles("super-admin"), updateUniversalTest);
router.delete("/universal/tests/:id", authorizeRoles("super-admin"), deleteUniversalTest);
// ---------------------------------------------------

router.use(checkPortalLicense("lab"));
router.use(requireTenant);

// Catalog Management (Admin/Lab)
router.post(
  "/tests",
  authorizeRoles("super-admin", "hospital-admin", "lab", "helpdesk", "masterhelpdesk"),
  createLabTest,
);

router.delete(
  "/tests/destroy/all",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  deleteAllLabTests,
);
// Bulk import (must be before /:id routes)
router.post(
  "/tests/bulk",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  bulkImportTests,
);
router.post(
  "/tests/auto-import",
  authorizeRoles("super-admin", "hospital-admin", "doctor", "helpdesk", "frontdesk"),
  autoImportTest,
);
router.post(
  "/departments/bulk",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  bulkImportDepartments,
);

router.get("/tests", getLabTests);
router.get("/tests/:id", getLabTest);
router.get("/tests/:id/parameters", getTestParameters);
router.get("/departments", getDepartments);
router.get("/meta", getMetaOptions);
router.put("/meta", authorizeRoles("super-admin", "hospital-admin", "lab"), updateMetaOptions);

router.put(
  "/tests/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  updateLabTest,
);
router.delete(
  "/tests/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  deleteLabTest,
);

// Lab Workflow
router.post("/orders", authorizeRoles("lab", "helpdesk", "masterhelpdesk"), createLabOrder);
router.get(
  "/orders",
  authorizeRoles("lab", "hospital-admin", "super-admin", "helpdesk", "frontdesk"),
  getInternalOrders,
);
router.put("/orders/:id/collect", authorizeRoles("lab"), collectSample);
router.put("/orders/:id/results", authorizeRoles("lab"), enterResult);
router.post(
  "/orders/:id/notify-doctor",
  authorizeRoles("lab"),
  notifyDoctorResults,
);
router.put("/orders/:id/finalize", authorizeRoles("lab", "helpdesk", "frontdesk"), finalizeOrder);
router.post(
  "/orders/:id/pay",
  authorizeRoles("lab", "patient", "hospital-admin", "helpdesk", "frontdesk"),
  payOrder,
);
router.get(
  "/orders/:id/invoice",
  authorizeRoles("lab", "patient", "hospital-admin", "super-admin", "helpdesk", "frontdesk"),
  generateInvoice,
);
router.delete(
  "/orders/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor"),
  deleteLabOrder,
);
router.get(
  "/orders/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor", "helpdesk", "frontdesk"),
  getLabOrder,
);

// Invoices
router.get(
  "/invoices",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getAllInvoices,
);
router.post(
  "/invoices",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  createLabOrder,
);
router.delete(
  "/invoices/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  deleteInvoice,
);

// Reports
router.get(
  "/reports/:sampleId",
  authorizeRoles("lab", "patient", "hospital-admin", "super-admin"),
  generateLabReport,
);
router.get(
  "/reports/:sampleId/with-billing",
  authorizeRoles("lab", "patient", "hospital-admin", "super-admin"),
  generateReportWithBilling,
);

// Dashboard & Analytics
router.get(
  "/dashboard-stats",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getDashboardStats,
);
router.post(
  "/departments",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  createDepartment,
);
router.put(
  "/departments/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  updateDepartment,
);
router.delete(
  "/departments/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  deleteDepartment,
);
router.get(
  "/orders/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor"),
  getLabOrder,
);

// Lab Settings & Config
router.get(
  "/config",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getHospitalLabConfig,
);
router.put(
  "/config",
  authorizeRoles("hospital-admin", "super-admin"),
  updateHospitalLabConfig,
);

router.post(
  "/settings/logo",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  upload.single("logo"),
  uploadLabLogo,
);
router.post(
  "/settings/upload-image",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  upload.single("image"),
  uploadLabImage,
);
router.get(
  "/settings",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor", "helpdesk", "staff", "nurse", "pharma-owner"),
  getLabSettings,
);
router.put(
  "/settings",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  updateLabSettings,
);

// Lab Packages
router.get("/packages", authorizeRoles("lab", "hospital-admin", "super-admin", "doctor"), getLabPackages);
router.post("/packages", authorizeRoles("hospital-admin", "super-admin"), createLabPackage);
router.put("/packages/:id", authorizeRoles("hospital-admin", "super-admin"), updateLabPackage);
router.delete("/packages/:id", authorizeRoles("hospital-admin", "super-admin"), deleteLabPackage);

// --- LAB EQUIPMENT MANAGEMENT ---
router.get("/equipment", authorizeRoles("lab", "hospital-admin", "super-admin"), getEquipmentList);
router.get("/equipment/:id", authorizeRoles("lab", "hospital-admin", "super-admin"), getEquipmentById);
router.post("/equipment", authorizeRoles("lab", "hospital-admin", "super-admin"), createEquipment);
router.put("/equipment/:id", authorizeRoles("lab", "hospital-admin", "super-admin"), updateEquipment);
router.delete("/equipment/:id", authorizeRoles("lab", "hospital-admin", "super-admin"), deleteEquipment);
router.post("/equipment/:id/restore", authorizeRoles("hospital-admin", "super-admin"), restoreEquipment);

// Bulk operations
router.post("/equipment/bulk-import", authorizeRoles("lab", "hospital-admin", "super-admin"), bulkImportEquipment);
router.post("/equipment/bulk-delete", authorizeRoles("lab", "hospital-admin", "super-admin"), bulkDeleteEquipment);
router.post("/equipment/bulk-restore", authorizeRoles("hospital-admin", "super-admin"), bulkRestoreEquipment);
router.post("/equipment/bulk-status", authorizeRoles("lab", "hospital-admin", "super-admin"), bulkStatusUpdate);

// --- LAB INVENTORY MANAGEMENT ---
router.get("/inventory", authorizeRoles("lab", "hospital-admin", "super-admin"), getInventoryList);
router.get("/inventory/:id", authorizeRoles("lab", "hospital-admin", "super-admin"), getInventoryById);
router.post("/inventory", authorizeRoles("lab", "hospital-admin", "super-admin"), createInventoryItem);
router.put("/inventory/:id", authorizeRoles("lab", "hospital-admin", "super-admin"), updateInventoryItem);
router.delete("/inventory/:id", authorizeRoles("lab", "hospital-admin", "super-admin"), deleteInventoryItem);

// Bulk operations
router.post("/inventory/bulk-import", authorizeRoles("lab", "hospital-admin", "super-admin"), bulkImportInventory);
router.post("/inventory/bulk-delete", authorizeRoles("lab", "hospital-admin", "super-admin"), bulkDeleteInventory);

export default router;
