import express from "express";
import { getPublicBlogs, getPublicTestimonials } from "../../Admin/Controllers/contentController.js";

const router = express.Router();

router.get("/blogs", getPublicBlogs);
router.get("/testimonials", getPublicTestimonials);

export default router;
