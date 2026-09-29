import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import {
  createAnnouncement,
  getHospitalAnnouncements,
  getAllAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
} from "../Controllers/announcementController.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

router.get("/", getAllAnnouncements);
router.get("/hospital", getHospitalAnnouncements);

router.post(
  "/",
  authorizeRoles("super-admin", "hospital-admin"),
  createAnnouncement,
);
router.patch(
  "/:id",
  authorizeRoles("super-admin", "hospital-admin"),
  updateAnnouncement,
);
router.delete(
  "/:id",
  authorizeRoles("super-admin", "hospital-admin"),
  deleteAnnouncement,
);

export default router;
