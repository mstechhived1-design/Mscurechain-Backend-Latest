import { Request, Response } from "express";
import QualityTargets from "../Models/QualityTargets.js";

/** GET /hospital-admin/quality-metrics/targets */
export const getQualityTargets = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    let targets = await QualityTargets.findOne({ hospital: hospitalId });

    if (!targets) {
      // Return defaults if not yet configured
      targets = new QualityTargets({ hospital: hospitalId }) as any;
    }

    res.status(200).json({ success: true, data: targets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** PUT /hospital-admin/quality-metrics/targets */
export const saveQualityTargets = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const {
      opdWaitingTime,
      bedOccupancyMin,
      bedOccupancyMax,
      alos,
      billingTat,
      incidentRateMax,
      incidentCountMax,
      readmissionRate,
    } = req.body;

    const updated = await QualityTargets.findOneAndUpdate(
      { hospital: hospitalId },
      {
        opdWaitingTime,
        bedOccupancyMin,
        bedOccupancyMax,
        alos,
        billingTat,
        incidentRateMax,
        incidentCountMax,
        readmissionRate,
      },
      { upsert: true, new: true, runValidators: true },
    );

    res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
