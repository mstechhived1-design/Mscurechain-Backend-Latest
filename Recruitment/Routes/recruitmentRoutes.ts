import express from "express";
import {
  createRecruitmentRequest,
  getRecruitments,
  reviewRecruitmentRequest,
  updateRecruitmentStatus,
  getRecruitmentDetail,
} from "../Controllers/recruitmentController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);

// Generic roles that can view
router.get("/", authorizeRoles("hr", "hospital-admin"), getRecruitments);
router.get(
  "/:id",
  authorizeRoles("hr", "hospital-admin"),
  getRecruitmentDetail,
);

// HR specific
router.post("/request", authorizeRoles("hr"), createRecruitmentRequest);
router.patch("/status/:id", authorizeRoles("hr"), updateRecruitmentStatus);

// Hospital Admin specific
router.patch(
  "/review/:id",
  authorizeRoles("hospital-admin"),
  reviewRecruitmentRequest,
);

export default router;
