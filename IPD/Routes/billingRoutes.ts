import express from "express";
import {
  addExtraCharge,
  removeExtraCharge,
  addAdvancePayment,
  getBillSummary,
  applyDiscount,
  lockBill,
  unlockBill,
  updateExtraCharge,
  updateBedOccupancyCharge,
} from "../Controllers/IPDBillingController.js";
import {
  getChargeCategories,
  addChargeCategory,
  updateChargeCategory,
  deleteChargeCategory,
} from "../Controllers/IPDChargeCategoryController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

// View bill summary - accessible by finance, helpdesk, nurse, doctor
router.get("/summary/:admissionId", getBillSummary);

// Custom Categories
router.get("/categories", getChargeCategories);
router.post(
  "/categories",
  authorize("hospital-admin", "super-admin", "helpdesk"),
  addChargeCategory
);
router.put(
  "/categories/:id",
  authorize("hospital-admin", "super-admin", "helpdesk"),
  updateChargeCategory
);
router.delete(
  "/categories/:id",
  authorize("hospital-admin", "super-admin", "helpdesk"),
  deleteChargeCategory
);

// Add charges/advances - helpdesk, nurse, doctor, pharma-owner
router.post(
  "/charge",
  authorize(
    "helpdesk",
    "nurse",
    "doctor",
    "staff",
    "hospital-admin",
    "super-admin",
    "pharma-owner",
  ),
  addExtraCharge,
);
router.delete(
  "/charge/:chargeId",
  authorize(
    "helpdesk",
    "nurse",
    "doctor",
    "staff",
    "hospital-admin",
    "super-admin",
    "pharma-owner",
  ),
  removeExtraCharge,
);
router.put(
  "/charge/:chargeId",
  authorize(
    "helpdesk",
    "nurse",
    "doctor",
    "staff",
    "hospital-admin",
    "super-admin",
    "pharma-owner",
  ),
  updateExtraCharge,
);
router.put(
  "/bed-charge/:occupancyId",
  authorize(
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "staff",
  ),
  updateBedOccupancyCharge,
);
router.post(
  "/advance",
  authorize("helpdesk", "staff", "hospital-admin", "super-admin"),
  addAdvancePayment,
);

// Admin / Authority actions
router.post(
  "/discount",
  authorize("hospital-admin", "super-admin", "helpdesk", "doctor"),
  applyDiscount,
);
router.patch(
  "/lock/:admissionId",
  authorize("hospital-admin", "staff", "helpdesk", "doctor"),
  lockBill,
);
router.patch(
  "/unlock/:admissionId",
  authorize("hospital-admin", "super-admin", "helpdesk"),
  unlockBill,
);

export default router;
