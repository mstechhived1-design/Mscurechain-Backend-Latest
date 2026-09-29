import express from "express";
import multer from "multer";
import {
  reportIncident,
  getAllIncidents,
  respondToIncident,
} from "../Controllers/incidentController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

// Multer Config for image uploads (Memory Storage for Cloudinary)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 5, // Max 5 files
  },
});

router.post("/report", upload.array("attachments", 5), reportIncident as any);
router.get("/all", getAllIncidents as any);
router.post("/respond/:incidentId", respondToIncident as any);

export default router;
