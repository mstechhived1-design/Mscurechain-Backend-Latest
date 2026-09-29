import express from "express";
import { createFeedback, getFeedbacks, updateFeedbackStatus, deleteFeedback } from "../Controllers/feedbackController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";

const router = express.Router();

// Apply auth + tenant context to all feedback routes
router.use(protect);
router.use(resolveTenant);

router.post("/", authorizeRoles("patient"), createFeedback);
router.get("/", authorizeRoles("hospital-admin", "super-admin"), getFeedbacks);
router.patch("/:id/status", authorizeRoles("hospital-admin", "super-admin"), updateFeedbackStatus);
router.delete("/:id", authorizeRoles("hospital-admin", "super-admin"), deleteFeedback);

export default router;
