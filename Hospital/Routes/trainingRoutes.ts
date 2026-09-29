import express from 'express';
import {
    createTraining,
    getAllTrainings,
    getStaffTrainings,
    updateTraining,
    deleteTraining
} from '../Controllers/trainingController.js';
import { protect, authorize } from '../../middleware/Auth/authMiddleware.js';
import upload from '../../middleware/Upload/upload.js';
import { resolveTenant } from '../../middleware/tenantMiddleware.js';

const router = express.Router();

// protect all routes, then resolve tenant context (required for multi-tenancy DB queries)
router.use(protect);
router.use(resolveTenant);

// Route for staff to view their own training history (MUST be before /:id to avoid conflict)
router.get('/my-history', getStaffTrainings);

// Route for admin to view a specific staff member's training history
router.get('/staff/:staffId', authorize('hospital-admin', 'admin', 'super-admin', 'doctor', 'nurse', 'hr'), getStaffTrainings);

// Admin only routes for management
router.route('/')
    .get(authorize('hospital-admin', 'admin', 'super-admin', 'hr'), getAllTrainings)
    .post(authorize('hospital-admin', 'admin', 'super-admin', 'hr'), upload.any(), createTraining);

router.route('/:id')
    .patch(authorize('hospital-admin', 'admin', 'super-admin', 'hr'), upload.any(), updateTraining)
    .delete(authorize('hospital-admin', 'admin', 'super-admin', 'hr'), deleteTraining);

export default router;
