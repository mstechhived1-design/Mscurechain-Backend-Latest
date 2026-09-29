import express from "express";
import {
  getDoctorNotes,
  createNote,
  deleteNote,
  deleteAllNotes,
} from "../Controllers/noteController.js";

import { protect } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

router.get("/:doctorId", getDoctorNotes);
router.post("/", createNote);
router.delete("/:id", deleteNote);
router.delete("/all/:doctorId", deleteAllNotes);

export default router;
