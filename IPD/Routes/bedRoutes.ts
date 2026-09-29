import express from "express";
import {
  createBed,
  listBeds,
  getBedDetails,
  updateBedStatus,
  createRoom,
  listRooms,
  deleteRoom,
  updateRoom,
  createIPDDepartment,
  listIPDDepartments,
  deleteIPDDepartment,
  updateIPDDepartment,
  updateBed,
  deleteBed,
  importAssets,
  importAssetsJSON,
  listUnitTypes,
  addUnitType,
  updateUnitType,
  deleteUnitType,
} from "../Controllers/bedController.js";
import { quickUpdateBedStatus } from "../Controllers/ipdController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import multer from "multer";

const router = express.Router();
console.log("🚀 [IPD] Bed Routes initialized");
const upload = multer({ dest: "uploads/" });

// Debug Route
router.get("/ping", (req, res) =>
  res.json({ status: "alive", scope: "bed-routes" }),
);

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

// Unit Type Routes (Specific matches FIRST)
router.get(
  "/unit-types",
  protect,
  authorize("hospital-admin", "helpdesk", "nurse", "doctor", "hr", "super-admin", "masterhelpdesk"),
  listUnitTypes,
);
router.post(
  "/unit-types",
  protect,
  authorize("hospital-admin", "hr", "super-admin", "masterhelpdesk"),
  addUnitType,
);
router.patch(
  "/unit-types",
  protect,
  authorize(
    "hospital-admin",
    "super-admin",
    "masterhelpdesk",
    "helpdesk",
    "staff",
    "nurse",
    "doctor",
    "lab",
    "pharma-owner",
    "hr",
  ),
  updateUnitType,
);
router.delete(
  "/unit-types/:type",
  protect,
  authorize("hospital-admin"),
  deleteUnitType,
);

// Room Routes
router.post("/rooms", protect, authorize("hospital-admin", "hr"), createRoom);
router.get(
  "/rooms",
  protect,
  authorize("hospital-admin", "helpdesk", "nurse", "doctor", "hr", "super-admin", "masterhelpdesk"),
  listRooms,
);
router.delete("/rooms/:id", protect, authorize("hospital-admin"), deleteRoom);
router.patch(
  "/rooms/:id",
  protect,
  authorize("hospital-admin", "hr", "super-admin", "masterhelpdesk"),
  updateRoom,
);

// IPD Department Routes
router.post(
  "/departments",
  protect,
  authorize("hospital-admin", "hr", "super-admin", "masterhelpdesk"),
  createIPDDepartment,
);
router.get(
  "/departments",
  protect,
  authorize("hospital-admin", "helpdesk", "nurse", "doctor", "hr", "super-admin", "masterhelpdesk"),
  listIPDDepartments,
);
router.delete(
  "/departments/:id",
  protect,
  authorize("hospital-admin"),
  deleteIPDDepartment,
);
router.patch(
  "/departments/:id",
  protect,
  authorize("hospital-admin", "hr", "super-admin", "masterhelpdesk"),
  updateIPDDepartment,
);

// Bed Routes
router.post("/", protect, authorize("hospital-admin", "hr"), createBed);
router.get(
  "/",
  authorize("hospital-admin", "helpdesk", "nurse", "doctor", "hr", "super-admin", "masterhelpdesk"),
  listBeds,
);
router.patch(
  "/:id/status",
  protect,
  authorize("hospital-admin", "helpdesk", "super-admin", "masterhelpdesk"),
  updateBedStatus,
);
router.patch(
  "/:id/quick-status",
  protect,
  authorize("hospital-admin", "helpdesk", "staff", "nurse", "super-admin", "masterhelpdesk"),
  quickUpdateBedStatus,
);
router.patch("/:id", protect, authorize("hospital-admin", "hr"), updateBed);
router.delete("/:id", protect, authorize("hospital-admin"), deleteBed);
router.get(
  "/:id",
  protect,
  authorize("hospital-admin", "helpdesk", "nurse", "doctor", "hr", "super-admin", "masterhelpdesk"),
  getBedDetails,
);

// Bulk Import
router.post(
  "/import-json/:type",
  protect,
  authorize("hospital-admin", "super-admin", "masterhelpdesk"),
  importAssetsJSON,
);

export default router;
