import { Request, Response } from "express";
import Shift from "../Models/Shift.js";
import StaffProfile from "../Models/StaffProfile.js";

export const createShift = async (req: Request, res: Response) => {
    try {
        const hospitalId = (req as any).user.hospital;
        const { name, startTime, endTime, color } = req.body;

        const shift = await Shift.create({
            name,
            startTime,
            endTime,
            hospital: hospitalId,
            color: color || "blue"
        });

        res.status(201).json(shift);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const getShifts = async (req: Request, res: Response) => {
    try {
        const hospitalId = (req as any).user.hospital;
        const shifts = await Shift.find({ hospital: hospitalId });

        // For each shift, count assigned staff
        const shiftsWithCounts = await Promise.all(shifts.map(async (shift) => {
            const staffCount = await StaffProfile.countDocuments({ 
                hospital: hospitalId, 
                shift: shift._id
            });
            return {
                ...shift.toObject(),
                staff: staffCount
            };
        }));

        res.status(200).json(shiftsWithCounts);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const updateShift = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const shift = await Shift.findByIdAndUpdate(id, req.body, { new: true });
        res.status(200).json(shift);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteShift = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await Shift.findByIdAndDelete(id);
        res.status(200).json({ message: "Shift deleted" });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const getShiftStaff = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const staff = await StaffProfile.find({ shift: id }).populate("user", "name email mobile");
        res.status(200).json(staff);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const assignStaffToShift = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // shiftId
        const { staffIds } = req.body; // Array of User IDs
        
        await StaffProfile.updateMany(
            { user: { $in: staffIds } },
            { shift: id }
        );

        res.status(200).json({ message: "Staff assigned successfully" });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};
