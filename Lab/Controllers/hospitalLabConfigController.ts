import { Request, Response } from "express";
import HospitalLabConfig from "../Models/HospitalLabConfig.js";

/**
 * GET /lab/config
 * Fetches the lab configuration for the hospital
 */
export const getHospitalLabConfig = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    let config: any = await HospitalLabConfig.findOne({ hospital: hospitalId }).lean();
    if (!config) {
      // Auto-create default config
      const newConfig = await HospitalLabConfig.create({
        hospital: hospitalId,
        enabledDepartments: [],
        barcodeEnabled: false,
        qrVerificationEnabled: false,
        allowCustomTests: true,
      });
      config = newConfig.toObject();
    }

    res.json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /lab/config
 * Updates the lab configuration for the hospital
 */
export const updateHospitalLabConfig = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const {
      enabledDepartments,
      barcodeEnabled,
      qrVerificationEnabled,
      allowCustomTests,
      defaultReportTemplate,
    } = req.body;

    const config = await HospitalLabConfig.findOneAndUpdate(
      { hospital: hospitalId },
      {
        $set: {
          ...(enabledDepartments !== undefined && { enabledDepartments }),
          ...(barcodeEnabled !== undefined && { barcodeEnabled }),
          ...(qrVerificationEnabled !== undefined && { qrVerificationEnabled }),
          ...(allowCustomTests !== undefined && { allowCustomTests }),
          ...(defaultReportTemplate !== undefined && { defaultReportTemplate }),
        },
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ success: true, message: "Configuration updated successfully", data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
