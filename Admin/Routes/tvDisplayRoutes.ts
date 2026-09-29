import express from "express";
import {
  pairDevice,
  getDisplays,
  updateDisplay,
  deleteDisplay,
  uploadVideo
} from "../Controllers/tvDisplayController.js";
import upload from "../../middleware/Upload/upload.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import { AuthRequest } from "../../Auth/types/index.js";

const router = express.Router();

// All routes require authentication and admin/hospitalAdmin roles
router.use(protect);
router.use(resolveTenant);
router.use(authorize("admin", "hospitalAdmin", "hospital-admin", "superAdmin", "super-admin"));

router.post("/pair", pairDevice as any);
router.post("/upload-video", upload.single("video"), uploadVideo as any);
router.get("/", getDisplays as any);
router.put("/:id", updateDisplay as any);
router.delete("/:id", deleteDisplay as any);

export default router;
