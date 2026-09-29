import { Request, Response } from 'express';
import WalkInPatient from '../Models/WalkInPatient.js';
import DirectLabOrder from '../Models/DirectLabOrder.js';
import LabTest from '../Models/LabTest.js';
import labService from '../../services/lab.service.js';

/**
 * Register a walk-in patient
 * @route POST /api/lab/walk-in/register
 */
export const registerWalkInPatient = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, age, gender, mobile, email, address } = req.body;
        const hospitalId = (req as any).user?.hospital;

        if (!name || !age || !gender || !mobile) {
            res.status(400).json({ message: 'Name, age, gender, and mobile are required' });
            return;
        }

        // Check if patient with same mobile exists (optional: return existing)
        const existingPatient = await WalkInPatient.findOne({
            mobile,
            hospital: hospitalId
        });

        if (existingPatient) {
            res.status(200).json({
                message: 'Patient already registered',
                patient: existingPatient,
                isExisting: true
            });
            return;
        }

        // Create new walk-in patient
        const patient = await WalkInPatient.create({
            name,
            age,
            gender,
            mobile,
            email,
            address,
            hospital: hospitalId
        });

        res.status(201).json({
            message: 'Walk-in patient registered successfully',
            patient,
            isExisting: false
        });

    } catch (error) {
        console.error('Error registering walk-in patient:', error);
        res.status(500).json({ message: 'Failed to register patient', error });
    }
};

/**
 * Create a direct lab order for walk-in patient
 * @route POST /api/lab/walk-in/orders
 */
export const createDirectLabOrder = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            walkInPatientId,
            testIds,
            sampleType,
            discount,
            paymentMethod,
            referredBy,
            notes
        } = req.body;

        const hospitalId = (req as any).user?.hospital;
        const labTechnicianId = (req as any).user?._id;

        if (!walkInPatientId || !testIds || testIds.length === 0) {
            res.status(400).json({ message: 'Walk-in patient and tests are required' });
            return;
        }

        // Verify patient exists
        const patient = await WalkInPatient.findById(walkInPatientId);
        if (!patient) {
            res.status(404).json({ message: 'Walk-in patient not found' });
            return;
        }

        // Fetch selected tests
        const tests = await LabTest.find({ _id: { $in: testIds } });
        if (tests.length !== testIds.length) {
            res.status(400).json({ message: 'Some tests were not found' });
            return;
        }

        // Calculate total amount
        const totalAmount = tests.reduce((sum, test) => sum + (test.price || 0), 0);
        const discountAmount = discount || 0;
        const finalAmount = Math.max(0, totalAmount - discountAmount);

        // Create order with tests
        const order = await DirectLabOrder.create({
            walkInPatient: walkInPatientId,
            hospital: hospitalId,
            labTechnician: labTechnicianId,
            tests: tests.map(test => ({
                test: test._id,
                testName: test.testName || test.name,
                status: 'pending',
                isAbnormal: false
            })),
            totalAmount,
            discount: discountAmount,
            finalAmount,
            paymentStatus: 'pending',
            paymentMethod,
            status: 'registered',
            sampleType: sampleType || 'Blood',
            referredBy: referredBy || 'Self',
            notes
        });

        // Populate for response
        const populatedOrder = await DirectLabOrder.findById(order._id)
            .populate('walkInPatient')
            .populate({ path: 'tests.test', options: { unscoped: true } });

        // Invalidate dashboard cache
        if (hospitalId) {
            const hId = hospitalId.toString();
            await labService.clearDashboardCache(hId);
            (req as any).io?.to(`hospital_${hId}`).emit('new_lab_order', { orderId: order._id });
            (req as any).io?.to(`hospital_${hId}_lab`).emit('new_lab_order', { orderId: order._id });
        }

        res.status(201).json({
            message: 'Direct lab order created successfully',
            order: populatedOrder
        });

    } catch (error) {
        console.error('Error creating direct lab order:', error);
        res.status(500).json({ message: 'Failed to create order', error });
    }
};

/**
 * Process payment for direct lab order
 * @route POST /api/lab/walk-in/orders/:orderId/pay
 */
export const processPayment = async (req: Request, res: Response): Promise<void> => {
    try {
        const { orderId } = req.params;
        const { paymentMethod, transactionId, amountPaid } = req.body;

        const order = await DirectLabOrder.findById(orderId);
        if (!order) {
            res.status(404).json({ message: 'Order not found' });
            return;
        }

        if (order.paymentStatus === 'paid') {
            res.status(400).json({ message: 'Order already paid' });
            return;
        }

        // Verify amount
        if (amountPaid < order.finalAmount) {
            res.status(400).json({
                message: 'Insufficient payment',
                required: order.finalAmount,
                received: amountPaid
            });
            return;
        }

        // Update payment status
        order.paymentStatus = 'paid';
        order.paymentMethod = paymentMethod;
        order.transactionId = transactionId;
        order.status = 'paid';

        await order.save();

        const populatedOrder = await DirectLabOrder.findById(order._id)
            .populate('walkInPatient')
            .populate({ path: 'tests.test', options: { unscoped: true } });

        // Invalidate dashboard cache
        if (order.hospital) {
            const hId = order.hospital.toString();
            await labService.clearDashboardCache(hId);
            (req as any).io?.to(`hospital_${hId}`).emit('payment_status_changed', { orderId: order._id });
            (req as any).io?.to(`hospital_${hId}_lab`).emit('payment_status_changed', { orderId: order._id });
        }

        res.status(200).json({
            message: 'Payment processed successfully',
            order: populatedOrder
        });

    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ message: 'Failed to process payment', error });
    }
};

/**
 * Collect sample for direct lab order
 * @route PUT /api/lab/walk-in/orders/:orderId/collect-sample
 */
export const collectSample = async (req: Request, res: Response): Promise<void> => {
    try {
        const { orderId } = req.params;
        const { sampleType } = req.body;

        const order = await DirectLabOrder.findById(orderId);
        if (!order) {
            res.status(404).json({ message: 'Order not found' });
            return;
        }

        if (order.paymentStatus !== 'paid') {
            res.status(400).json({ message: 'Payment not completed. Please complete payment first.' });
            return;
        }

        if (order.status === 'completed') {
            res.status(400).json({ message: 'Order already completed' });
            return;
        }

        // Update sample collection
        order.sampleCollectedAt = new Date();
        order.status = 'sample_collected';
        if (sampleType) {
            order.sampleType = sampleType;
        }

        await order.save();

        const populatedOrder = await DirectLabOrder.findById(order._id)
            .populate('walkInPatient')
            .populate({ path: 'tests.test', options: { unscoped: true } });

        // Invalidate dashboard cache
        if (order.hospital) {
            const hId = order.hospital.toString();
            await labService.clearDashboardCache(hId);
            (req as any).io?.to(`hospital_${hId}`).emit('sample_collected', { orderId: order._id });
            (req as any).io?.to(`hospital_${hId}_lab`).emit('sample_collected', { orderId: order._id });
        }

        res.status(200).json({
            message: 'Sample collected successfully',
            order: populatedOrder
        });

    } catch (error) {
        console.error('Error collecting sample:', error);
        res.status(500).json({ message: 'Failed to collect sample', error });
    }
};

/**
 * Enter test results for direct lab order
 * @route PUT /api/lab/walk-in/orders/:orderId/results
 */
export const enterResults = async (req: Request, res: Response): Promise<void> => {
    try {
        const { orderId } = req.params;
        const { tests: testResults } = req.body;

        const order = await DirectLabOrder.findById(orderId);
        if (!order) {
            res.status(404).json({ message: 'Order not found' });
            return;
        }

        if (order.status === 'completed') {
            res.status(400).json({ message: 'Order already completed' });
            return;
        }

        // Update test results
        if (testResults && Array.isArray(testResults)) {
            testResults.forEach((testResult: any) => {
                const orderTest = order.tests.find(
                    (t: any) => t.test.toString() === testResult.testId
                );

                if (orderTest) {
                    orderTest.result = testResult.result;
                    orderTest.remarks = testResult.remarks;
                    orderTest.isAbnormal = testResult.isAbnormal || false;
                    orderTest.status = 'completed';
                    if (testResult.subTests) {
                        orderTest.subTests = testResult.subTests;
                    }
                }
            });
        }

        // Check if all tests are completed
        const allCompleted = order.tests.every((t: any) => t.status === 'completed');

        order.resultsEnteredAt = new Date();
        order.status = allCompleted ? 'completed' : 'processing';

        if (allCompleted) {
            order.completedAt = new Date();
        }

        await order.save();

        const populatedOrder = await DirectLabOrder.findById(order._id)
            .populate('walkInPatient')
            .populate({ path: 'tests.test', options: { unscoped: true } });

        // Invalidate dashboard cache
        if (order.hospital) {
            const hId = order.hospital.toString();
            await labService.clearDashboardCache(hId);
            (req as any).io?.to(`hospital_${hId}`).emit('lab_order_updated', { orderId: order._id });
            (req as any).io?.to(`hospital_${hId}_lab`).emit('lab_order_updated', { orderId: order._id });
        }

        res.status(200).json({
            message: 'Test results entered successfully',
            order: populatedOrder
        });

    } catch (error) {
        console.error('Error entering results:', error);
        res.status(500).json({ message: 'Failed to enter results', error });
    }
};

/**
 * Get all direct lab orders
 * @route GET /api/lab/walk-in/orders
 */
export const getDirectLabOrders = async (req: Request, res: Response): Promise<void> => {
    try {
        const hospitalId = (req as any).user?.hospital;
        const { status, paymentStatus, search, limit = 50, page = 1 } = req.query;

        const query: any = { hospital: hospitalId };

        if (status) {
            query.status = status;
        }

        if (paymentStatus) {
            query.paymentStatus = paymentStatus;
        }

        const skip = (Number(page) - 1) * Number(limit);

        let orders = await DirectLabOrder.find(query)
            .populate('walkInPatient')
            .populate({ path: 'tests.test', options: { unscoped: true } })
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip);

        // Search by patient name or mobile if provided
        if (search) {
            const searchRegex = new RegExp(search as string, 'i');
            orders = orders.filter(order => {
                const patient = order.walkInPatient as any;
                return patient?.name?.match(searchRegex) ||
                    patient?.mobile?.includes(search as string) ||
                    order.orderNumber?.match(searchRegex);
            });
        }

        const total = await DirectLabOrder.countDocuments(query);

        res.status(200).json({
            orders,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / Number(limit))
            }
        });

    } catch (error) {
        console.error('Error fetching direct lab orders:', error);
        res.status(500).json({ message: 'Failed to fetch orders', error });
    }
};

/**
 * Get single direct lab order by ID
 * @route GET /api/lab/walk-in/orders/:orderId
 */
export const getDirectLabOrder = async (req: Request, res: Response): Promise<void> => {
    try {
        const { orderId } = req.params;

        const order = await DirectLabOrder.findById(orderId)
            .populate('walkInPatient')
            .populate({ path: 'tests.test', options: { unscoped: true } })
            .populate('labTechnician', 'name email');

        if (!order) {
            res.status(404).json({ message: 'Order not found' });
            return;
        }

        res.status(200).json({ order });

    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ message: 'Failed to fetch order', error });
    }
};

/**
 * Search walk-in patients by mobile or name
 * @route GET /api/lab/walk-in/patients/search
 */
export const searchWalkInPatients = async (req: Request, res: Response): Promise<void> => {
    try {
        const hospitalId = (req as any).user?.hospital;
        const { query } = req.query;

        if (!query) {
            res.status(400).json({ message: 'Search query is required' });
            return;
        }

        const searchRegex = new RegExp(query as string, 'i');

        const patients = await WalkInPatient.find({
            hospital: hospitalId,
            $or: [
                { name: searchRegex },
                { mobile: searchRegex },
                { registrationId: searchRegex }
            ]
        })
            .limit(20)
            .sort({ createdAt: -1 });

        res.status(200).json({ patients });

    } catch (error) {
        console.error('Error searching patients:', error);
        res.status(500).json({ message: 'Failed to search patients', error });
    }
};
