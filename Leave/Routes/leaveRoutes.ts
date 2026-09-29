import express from "express";
import {
  requestLeave,
  getLeaves,
  updateLeaveStatus,
  getLeaveBalance,
  getLeaveById,
  deleteLeave,
} from "../Controllers/leaveController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

router.post(
  "/request",
  authorizeRoles(
    "doctor",
    "staff",
    "nurse",
    "hr",
    "hospital-admin",
    "super-admin",
  ),
  requestLeave,
);
router.get(
  "/",
  authorizeRoles(
    "doctor",
    "staff",
    "nurse",
    "hr",
    "hospital-admin",
    "super-admin",
  ),
  getLeaves,
);
router.get(
  "/balance",
  authorizeRoles(
    "doctor",
    "staff",
    "nurse",
    "hr",
    "hospital-admin",
    "super-admin",
  ),
  getLeaveBalance,
);

router
  .route("/:id")
  .get(
    authorizeRoles(
      "doctor",
      "staff",
      "nurse",
      "hr",
      "hospital-admin",
      "super-admin",
    ),
    getLeaveById,
  )
  .delete(authorizeRoles("doctor", "staff", "nurse", "hr"), deleteLeave);

router
  .route("/:id/status")
  .put(authorizeRoles("super-admin", "hospital-admin", "hr"), updateLeaveStatus)
  .patch(
    authorizeRoles("super-admin", "hospital-admin", "hr"),
    updateLeaveStatus,
  )
  .post(
    authorizeRoles("super-admin", "hospital-admin", "hr"),
    updateLeaveStatus,
  );

export default router;
