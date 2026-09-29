import express from "express";
import {
    getNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAllNotifications,
    deleteEmergencyAlerts,
    sendEmergencyAlert
} from "../Controllers/notificationController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);

router.get("/", getNotifications);
router.put("/:id/read", markAsRead);
router.put("/read-all", markAllAsRead);
router.delete("/clear-all", deleteAllNotifications);
router.delete("/:id", deleteNotification);

// Emergency Alerts
router.post("/emergency", authorizeRoles("helpdesk", "super-admin", "hospital-admin"), sendEmergencyAlert);
router.delete("/emergency/clear", deleteEmergencyAlerts);

export default router;
