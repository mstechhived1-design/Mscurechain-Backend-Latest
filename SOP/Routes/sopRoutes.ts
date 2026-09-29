import express from "express";
import multer from "multer";
import {
  uploadSOP,
  getSOPs,
  archiveSOP,
  getSOPHistory,
  downloadSOP,
  acknowledgeSOP,
  getSOPReport,
  updateSOP,
} from "../Controllers/sopController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

// Multer Config (Memory Storage for Cloudinary)
// Use upload.any() so that metadata-only PUT updates (no file) never hit the fileFilter.
// PDF mimetype validation is enforced inside the controller when a file is actually present.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Apply auth + tenant context to ALL SOP routes (required for multi-tenancy DB queries)
router.use(protect);
router.use(resolveTenant);

// Admin routes
router.post("/", authorize("hospital-admin", "hr"), upload.any(), uploadSOP);
router.put("/:id", authorize("hospital-admin", "hr"), upload.any(), updateSOP);
router.patch("/:id/archive", authorize("hospital-admin", "hr"), archiveSOP);
router.get("/history/:name", authorize("hospital-admin", "hr"), getSOPHistory);

// Shared routes (Filtering handled in controller)
router.get("/", getSOPs);
router.get("/download/:id", downloadSOP);
router.post("/:id/acknowledge", acknowledgeSOP);
router.get("/:id/report", authorize("hospital-admin", "hr"), getSOPReport);

export default router;
