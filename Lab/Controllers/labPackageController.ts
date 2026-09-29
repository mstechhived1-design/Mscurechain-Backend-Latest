import { Request, Response } from "express";
import LabPackage from "../Models/LabPackage.js";

// GET /lab/packages
export const getLabPackages = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const packages = await LabPackage.find({ hospital: hospitalId })
      .populate("tests")
      .lean();

    res.json({ success: true, data: packages });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /lab/packages
export const createLabPackage = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const { name, description, packagePrice, tests } = req.body;

    const newPackage = await LabPackage.create({
      hospital: hospitalId,
      name,
      description,
      packagePrice,
      tests,
      isActive: true,
    });

    res.status(201).json({ success: true, data: newPackage });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /lab/packages/:id
export const updateLabPackage = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const updated = await LabPackage.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ message: "Package not found" });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /lab/packages/:id
export const deleteLabPackage = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const deleted = await LabPackage.findOneAndDelete({ _id: req.params.id, hospital: hospitalId });
    if (!deleted) return res.status(404).json({ message: "Package not found" });

    res.json({ success: true, message: "Package deleted" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
