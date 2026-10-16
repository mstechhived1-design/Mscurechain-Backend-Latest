import express from "express";
import { getPublicBlogs, getPublicTestimonials } from "../../Admin/Controllers/contentController.js";
import publicAppointmentRoutes from "./publicAppointmentRoutes.js";

const router = express.Router();

router.get("/blogs", getPublicBlogs);
router.get("/testimonials", getPublicTestimonials);

// Mount public appointment booking routes
router.use("/appointments", publicAppointmentRoutes);
router.use("/", publicAppointmentRoutes);

export default router;