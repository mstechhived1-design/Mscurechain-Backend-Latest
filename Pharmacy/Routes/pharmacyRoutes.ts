import express from "express";
import mongoose from "mongoose";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import PharmaProfile from "../Models/PharmaProfile.js";
import { PharmaRequest } from "../types/index.js";
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteAllProducts,
  bulkImportProducts,
  bulkCreateProducts,
  exportProductsToExcel,
  getGenericSubstitutes,
} from "../Controllers/productController.js";
import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  exportInvoicesToExcel,
  deleteInvoice,
  returnInvoiceItems,
} from "../Controllers/invoiceController.js";
import {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getProductsBySupplier,
  getSupplierPurchases,
} from "../Controllers/supplierController.js";
import {
  getDashboardStats,
  getSalesReport,
  getInventoryReport,
  getAnalyticsData,
  getEODItemWiseSales
} from "../Controllers/reportController.js";
import { getAllTransactions } from "../Controllers/transactionController.js";
import { getAuditLogs } from "../Controllers/auditLogController.js";
import {
  getHospitalPharmacyOrders,
  getPharmacyOrder,
  deletePharmacyOrder,
  getActiveOrdersCount,
} from "../Controllers/pharmacyTokenController.js";
import { uploadDocument } from "../Controllers/pharmaProfileController.js";
import {
  issueForIPD,
  getIssuancesByAdmission,
  getIssuanceSummary,
  signoffPharmacy,
  getNurseAssignedAdmissions,
} from "../Controllers/ipdIssuanceController.js";
import {
  submitReturn,
  approveReturn,
  rejectReturn,
  getAllReturns,
  getReturnsByAdmission,
  getUnifiedReturnedStock,
} from "../Controllers/medicineReturnController.js";
import uploadMiddleware from "../../middleware/Upload/upload.js";
import multer from "multer";
import path from "path";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

const upload = multer({ dest: "uploads/" });
const router = express.Router();

// Middleware to inject pharmacy profile with performance optimizations
const injectPharmacy = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user?._id;
    const role = req.user?.role?.toLowerCase();

    let profile;
    if (role === "pharma-owner") {
      profile = await PharmaProfile.findOne({ user: userId })
        .select("_id hospital businessName")
        .lean();
    } else {
      let targetHospitalId =
        req.query?.hospitalId ||
        req.body?.hospitalId ||
        req.headers["x-hospital-id"] ||
        req.user?.hospital;

      if (
        !targetHospitalId &&
        (role === "hospital-admin" ||
          role === "super-admin" ||
          role === "admin")
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Hospital ID is required for administrative pharmacy access. Please provide hospitalId query param or X-Hospital-Id header.",
        });
      }

      if (targetHospitalId) {
        const hospitalId =
          typeof targetHospitalId === "string"
            ? new mongoose.Types.ObjectId(targetHospitalId)
            : targetHospitalId;

        // 🚀 MULTI-PROFILE FIX: Find all registries for this hospital
        const profiles = await PharmaProfile.find({ hospital: hospitalId })
          .select("_id hospital businessName")
          .lean();

        if (profiles.length > 1) {
          console.log(
            `[Pharmacy Access DEBUG] Detected ${profiles.length} profiles for Hospital: ${hospitalId}. Resolving data-rich node...`,
          );
          // Intelligent fallback: Pick the one that actually has products registered
          const Product = (await import("../Models/Product.js")).default;
          const counts = await Promise.all(
            profiles.map((p) => Product.countDocuments({ pharmacy: p._id })),
          );

          let maxIndex = 0;
          let maxCount = -1;
          counts.forEach((count, idx) => {
            if (count > maxCount) {
              maxCount = count;
              maxIndex = idx;
            }
          });

          profile = profiles[maxIndex];
          console.log(
            `[Pharmacy Access DEBUG] Resolved to: ${profile.businessName} (${maxCount} SKUs)`,
          );
        } else if (profiles.length === 1) {
          profile = profiles[0];
        }

        if (!profile) {
          console.log(
            `[Pharmacy Access DEBUG] No hospital profiles found. Trying User ID fallback.`,
          );
          profile = await PharmaProfile.findOne({ user: userId })
            .select("_id hospital businessName")
            .lean();
        }
      }
    }

    if (!profile) {
      // 🚀 TOLERANCE FIX: Don't hard-fail with 404 for admins/super-admins on GET requests.
      // This prevents dashboard crashes if a hospital simply hasn't registered a pharmacy yet.
      const isReadRequest = req.method === "GET";
      const isAdminRole =
        role === "super-admin" || role === "admin" || role === "hospital-admin";

      if (isAdminRole && isReadRequest) {
        console.log(
          `[Pharmacy Access] No profile found for Hospital: ${req.query?.hospitalId || req.user?.hospital}. Returning empty context for admin.`,
        );
        req.pharma = null; // Controllers should handle null pharma for GETs
        return next();
      }

      console.warn(
        `[Pharmacy Access ERROR] No profile found for Role: ${role}, User: ${userId}, Hospital: ${req.query?.hospitalId || req.user?.hospital}`,
      );
      return res.status(404).json({
        success: false,
        message:
          "Pharmacy profile not found. Please ensure a pharmacy is registered for this hospital.",
      });
    }

    req.pharma = profile;
    next();
  } catch (error) {
    console.error("InjectPharmacy Error:", error);
    next(error);
  }
};

router.use(protect);
router.use(resolveTenant);
router.use(checkPortalLicense("pharmacy"));

// Profile & Documents (Common for owner)
router.post(
  "/upload-document",
  authorizeRoles("pharma-owner"),
  uploadMiddleware.single("document"),
  uploadDocument,
);

// Order Management (No Profile Required)
router.get(
  "/orders/hospital/:hospitalId",
  authorizeRoles("pharma-owner", "hospital-admin", "staff", "super-admin"),
  getHospitalPharmacyOrders,
);
router.get(
  "/orders/hospital/:hospitalId/count",
  authorizeRoles("pharma-owner", "hospital-admin", "staff", "super-admin"),
  getActiveOrdersCount,
);
router.get(
  "/orders/:id",
  authorizeRoles("pharma-owner", "hospital-admin", "staff", "super-admin"),
  getPharmacyOrder,
);
router.delete(
  "/orders/:id",
  authorizeRoles("pharma-owner", "hospital-admin", "super-admin"),
  deletePharmacyOrder,
);

// ─── IPD Medicine Issuance (accessible to pharmacist, nurse, doctor, admin) ───
const ipdStaffRoles = [
  "pharma-owner",
  "hospital-admin",
  "nurse",
  "doctor",
  "helpdesk",
  "super-admin",
  "admin",
];
const pharmacistRoles = [
  "pharma-owner",
  "hospital-admin",
  "super-admin",
  "admin",
];

// Issue medicines to IPD patient
router.post("/ipd-issuance", authorizeRoles(...pharmacistRoles), issueForIPD);

// Get explicitly assigned active patients for the logged-in nurse
router.get(
  "/ipd-issuance/nurse-patients/active",
  authorizeRoles("nurse", "hospital-admin", "super-admin"),
  getNurseAssignedAdmissions,
);

// Get all issuances for an admission
router.get(
  "/ipd-issuance/:admissionId",
  authorizeRoles(...ipdStaffRoles),
  getIssuancesByAdmission,
);
// Get balance summary for an admission
router.get(
  "/ipd-issuance/:admissionId/summary",
  authorizeRoles(...ipdStaffRoles),
  getIssuanceSummary,
);
// Manual pharmacy sign-off
router.post(
  "/signoff/:admissionId",
  authorizeRoles(...pharmacistRoles),
  signoffPharmacy,
);

// ─── Medicine Returns ─────────────────────────────────────────────────────────
// Submit return request (nurse or pharmacist)
router.post(
  "/medicine-return",
  authorizeRoles("pharma-owner", "nurse", "hospital-admin", "super-admin"),
  submitReturn,
);
// Approve return (pharmacist)
router.patch(
  "/medicine-return/:id/approve",
  authorizeRoles(...pharmacistRoles),
  approveReturn,
);
// Reject return (pharmacist)
router.patch(
  "/medicine-return/:id/reject",
  authorizeRoles(...pharmacistRoles),
  rejectReturn,
);
// Get all returns for a hospital (all admissions)
router.get(
  "/medicine-return/all",
  authorizeRoles(...ipdStaffRoles),
  getAllReturns,
);
// Get unified returns for hospital admin (IPD & OPD)
router.get(
  "/returns/unified",
  authorizeRoles(...pharmacistRoles),
  getUnifiedReturnedStock,
);
// Get all returns for an admission
router.get(
  "/medicine-return/:admissionId",
  authorizeRoles(...ipdStaffRoles),
  getReturnsByAdmission,
);

// Routes for pharma-owner OR administrative roles
router.use(
  authorizeRoles("pharma-owner", "hospital-admin", "super-admin", "admin"),
);
router.use(requireTenant);
router.use(injectPharmacy);

// Inventory
router.get("/products/export", exportProductsToExcel);
router.get("/products", getProducts);
router.get("/products/:id", getProduct);
router.get("/products/:id/substitutes", getGenericSubstitutes);
router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.delete("/products", deleteAllProducts);
router.delete("/products/:id", deleteProduct);
router.post("/products/import", upload.single("file"), bulkImportProducts);
router.post("/products/bulk", bulkCreateProducts);

// Suppliers
router.get("/suppliers/purchases", getSupplierPurchases);
router.get("/suppliers", getSuppliers);
router.get("/suppliers/:id", getSupplier);
router.get("/suppliers/:id/products", getProductsBySupplier);
router.post("/suppliers", createSupplier);
router.put("/suppliers/:id", updateSupplier);
router.delete("/suppliers/:id", deleteSupplier);

// Billing
router.get("/invoices/export", exportInvoicesToExcel);
router.get("/invoices", getInvoices);
router.get("/invoices/:id", getInvoiceById);
router.post("/invoices", createInvoice);
router.post("/invoices/:id/return", returnInvoiceItems);
router.delete("/invoices/:id", deleteInvoice);

// Advanced
router.get("/reports/dashboard", getDashboardStats);
router.get("/reports/sales", getSalesReport);
router.get("/reports/inventory", getInventoryReport);
router.get("/reports/analytics", getAnalyticsData);
router.get("/reports/eod-sales", getEODItemWiseSales);
router.get("/transactions", getAllTransactions);
router.get("/audit-logs", getAuditLogs);

export default router;
