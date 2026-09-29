import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  createHospital,
  createHospitalAdmin,
  adminListHospitals,
  adminPatchHospitalStatus,
  adminBroadcast,
  adminBulkHospitals,
  getAdminProfile,
  updateAdminProfile,
  getDashboardStats,
  getAnalytics,
  getAllAmbulancePersonnel,
  createAmbulancePersonnel,
  updateAmbulancePersonnel,
  deleteAmbulancePersonnel,
  getHospitalPersonnel,
  getHRUsers,
  seedHRUsers,
} from "../Controllers/adminController.js";

// Add specific content controller imports if they were in a separate file, 
// but since I'm editing adminController.ts soon to match, I'll export them from there.
// Actually, let's import from contentController.ts directly for clarity.
import {
  getAdminBlogs as fetchBlogs,
  createBlog as newBlog,
  updateBlog as patchBlog,
  deleteBlog as removeBlog,
  getAdminTestimonials as fetchTestimonials,
  createTestimonial as newTestimonial,
  updateTestimonial as patchTestimonial,
  deleteTestimonial as removeTestimonial
} from "../Controllers/contentController.js";
import { getAllAuthLogs, getAuthLogFilters } from "../Controllers/authLogController.js";
const router = express.Router();

// Middleware: All routes here require super-admin
router.use(protect);
router.use(authorizeRoles("super-admin"));
router.use(resolveTenant);

// Profile
router.get("/profile", getAdminProfile);
router.put("/profile", updateAdminProfile);

// System Stats & Dashboard
router.get("/stats", getDashboardStats);
router.get("/analytics", getAnalytics);
router.get("/auth-logs", getAllAuthLogs);
router.get("/auth-log-filters", getAuthLogFilters);
router.post("/broadcast", adminBroadcast);

// User Management (Global)
router.get("/users", getAllUsers);
router.post("/users", createUser);
router.put("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);

// HR Management
router.get("/hr-users", getHRUsers);
router.post("/seed-hr", seedHRUsers);

// Emergency / Ambulance Personnel Management
router.get("/emergency-users", getAllAmbulancePersonnel);
router.post("/emergency-users", createAmbulancePersonnel);
router.put("/emergency-users/:id", updateAmbulancePersonnel);
router.delete("/emergency-users/:id", deleteAmbulancePersonnel);

// Hospital Management
router.post("/create-hospital", createHospital);
router.post("/create-hospital-admin", createHospitalAdmin);
router.get("/hospitals", adminListHospitals);
router.get("/hospitals/:id/personnel", getHospitalPersonnel);
router.patch("/hospitals/:id/status", adminPatchHospitalStatus);
router.post("/hospitals/upload", adminBulkHospitals);

// Blog Management
router.get("/blogs", fetchBlogs);
router.post("/blogs", newBlog);
router.put("/blogs/:id", patchBlog);
router.delete("/blogs/:id", removeBlog);

// Testimonial Management
router.get("/testimonials", fetchTestimonials);
router.post("/testimonials", newTestimonial);
router.put("/testimonials/:id", patchTestimonial);
router.delete("/testimonials/:id", removeTestimonial);

export default router;
