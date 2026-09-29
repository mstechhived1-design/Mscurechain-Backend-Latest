import { Request, Response, NextFunction } from 'express';
import QualityIndicator from '../Models/QualityIndicator.js';
import QualityAction from '../Models/QualityAction.js';
import asyncHandler from '../../middleware/Utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';

// ✅ CREATE INDICATOR
export const createIndicator = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const {
        name,
        department,
        problemIdentified,
        baselineValue,
        targetValue,
        currentValue,
        actionTaken,
        status,
        unit
    } = req.body;
    const hospitalId = (req as any).user?.hospital;

    if (!hospitalId) {
        return next(new ApiError(400, 'Hospital ID not found'));
    }

    const indicator = await QualityIndicator.create({
        name,
        department,
        problemIdentified,
        baselineValue,
        targetValue,
        currentValue,
        actionTaken,
        status,
        unit,
        hospitalId
    });

    res.status(201).json({
        status: 'success',
        data: { indicator }
    });
});

// ✅ UPDATE INDICATOR
export const updateIndicator = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const indicatorId = req.params.id;
    const hospitalId = (req as any).user?.hospital;

    const indicator = await QualityIndicator.findOneAndUpdate(
        { _id: indicatorId, hospitalId },
        req.body,
        { new: true, runValidators: true }
    );

    if (!indicator) {
        return next(new ApiError(404, 'No quality indicator found with that ID or does not belong to your hospital'));
    }

    res.status(200).json({
        status: 'success',
        data: { indicator }
    });
});

// ✅ DELETE INDICATOR
export const deleteIndicator = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const indicatorId = req.params.id;
    const hospitalId = (req as any).user?.hospital;

    const indicator = await QualityIndicator.findOneAndDelete({ _id: indicatorId, hospitalId });

    if (!indicator) {
        return next(new ApiError(404, 'No quality indicator found with that ID or does not belong to your hospital'));
    }

    res.status(204).json({
        status: 'success',
        data: null
    });
});

// ✅ GET ALL INDICATORS
export const getIndicators = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const hospitalId = (req as any).user?.hospital;

    const indicators = await QualityIndicator.find({ hospitalId });

    res.status(200).json({
        status: 'success',
        results: indicators.length,
        data: { indicators }
    });
});

// ✅ CREATE ACTION (Problem Identification)
export const createAction = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const {
        indicatorId,
        problemDescription,
        period,
        actionDescription,
        responsibleDepartment,
        startDate,
        reviewDate
    } = req.body;

    const hospitalId = (req as any).user?.hospital;
    const userId = (req as any).user?._id;

    if (!hospitalId) {
        return next(new ApiError(400, 'Hospital ID not found'));
    }

    const action = await QualityAction.create({
        indicatorId,
        problemDescription,
        period,
        actionDescription,
        responsibleDepartment,
        startDate,
        reviewDate,
        hospitalId,
        status: 'Open',
        statusHistory: [{
            status: 'Open',
            timestamp: new Date(),
            updatedBy: userId
        }]
    });

    res.status(201).json({
        status: 'success',
        data: { action }
    });
});

// ✅ UPDATE ACTION STATUS
export const updateActionStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { status } = req.body;
    const actionId = req.params.id;
    const userId = (req as any).user?._id;

    const action = await QualityAction.findById(actionId);

    if (!action) {
        return next(new ApiError(404, 'No quality action found with that ID'));
    }

    if (action.isClosed) {
        return next(new ApiError(400, 'This action is already completed and cannot be updated.'));
    }

    // Add to history
    action.status = status;
    action.statusHistory.push({
        status,
        timestamp: new Date(),
        updatedBy: userId
    });

    await action.save();

    res.status(200).json({
        status: 'success',
        data: { action }
    });
});

// ✅ EVALUATE OUTCOME & CLOSE
export const evaluateOutcome = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { outcomeSummary, measurableResultBefore, measurableResultAfter } = req.body;
    const actionId = req.params.id;

    const action = await QualityAction.findById(actionId);

    if (!action) {
        return next(new ApiError(404, 'No quality action found with that ID'));
    }

    if (action.isClosed) {
        return next(new ApiError(400, 'This action is already closed.'));
    }

    action.outcomeSummary = outcomeSummary;
    action.measurableResultBefore = measurableResultBefore;
    action.measurableResultAfter = measurableResultAfter;
    action.status = 'Completed';
    action.isClosed = true; // Permanent lock

    await action.save();

    res.status(200).json({
        status: 'success',
        data: { action }
    });
});

// ✅ GET ALL ACTIONS (Audit Trail)
export const getActions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const hospitalId = (req as any).user?.hospital;

    const actions = await QualityAction.find({ hospitalId })
        .populate('indicatorId')
        .populate('statusHistory.updatedBy', 'name role')
        .sort({ createdAt: -1 });

    res.status(200).json({
        status: 'success',
        results: actions.length,
        data: { actions }
    });
});
