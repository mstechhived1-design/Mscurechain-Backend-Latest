import express from "express";
import {
  sendMessage,
  getMessages,
  getConversations,
  editMessage,
  deleteMessage,
  toggleReaction,
} from "../Controllers/messageController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";

import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

router.post("/send", sendMessage);
router.get("/conversation/:otherUserId", getMessages);
router.get("/conversations", getConversations);
router.put("/edit/:messageId", editMessage);
router.post("/delete/:messageId", deleteMessage);
router.post("/reaction/:messageId", toggleReaction);

export default router;
