import { Request, Response } from "express";
import mongoose from "mongoose";
import QualityMetric from "../Models/QualityMetric.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import DischargeRecord from "../../Discharge/Models/DischargeRecord.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Bed from "../../IPD/Models/Bed.js";
import Incident from "../../Incident/Models/Incident.js";

export const getQualityMetrics = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res
        .status(403)
        .json({ message: "No hospital associated with this account" });
    }

    const month =
      parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    // Check if metrics already exist and are locked
    let metrics = await QualityMetric.findOne({
      hospital: hospitalId,
      month,
      year,
    });

    if (metrics && metrics.status === "locked") {
      return res.json(metrics);
    }

    // If not locked, we recalculate real-time values
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // 1. OPD Waiting Time (Avg of Completed Appointments)
    // Using createdAt as check-in for now, and updatedAt as consultation start if not explicitly tracked
    const opdMetrics = await Appointment.aggregate([
      {
        $match: {
          hospital: new mongoose.Types.ObjectId(hospitalId),
          status: "completed",
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $project: {
          waitTime: {
            $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60000], // In minutes
          },
        },
      },
      {
        $group: {
          _id: null,
          avgWait: { $avg: "$waitTime" },
          totalVisits: { $sum: 1 },
        },
      },
    ]);

    const avgWait =
      opdMetrics.length > 0 ? Math.round(opdMetrics[0].avgWait) : 0;
    const totalVisits = opdMetrics.length > 0 ? opdMetrics[0].totalVisits : 0;

    // 2. Bed Occupancy Rate
    const totalBeds = await Bed.countDocuments({ hospital: hospitalId });
    const daysInMonth = endDate.getDate();
    const totalAvailableBedDays = totalBeds * daysInMonth;

    const occupancyMetrics = await BedOccupancy.aggregate([
      {
        $match: {
          hospital: new mongoose.Types.ObjectId(hospitalId),
          $or: [
            { startDate: { $lte: endDate }, endDate: { $gte: startDate } },
            { startDate: { $lte: endDate }, endDate: { $exists: false } },
          ],
        },
      },
    ]);

    let totalOccupiedBedDays = 0;
    occupancyMetrics.forEach((occ) => {
      const start = occ.startDate < startDate ? startDate : occ.startDate;
      const end = occ.endDate && occ.endDate < endDate ? occ.endDate : endDate;
      const diffInDays =
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      totalOccupiedBedDays += Math.max(0, diffInDays);
    });

    const bedOccupancyRate =
      totalAvailableBedDays > 0
        ? Number(
            ((totalOccupiedBedDays / totalAvailableBedDays) * 100).toFixed(2),
          )
        : 0;

    // 3. ALOS & 4. Billing TAT & 5. Infection Rate & 6. Readmission Rate
    const dischargeMetrics = await DischargeRecord.aggregate([
      {
        $match: {
          hospital: new mongoose.Types.ObjectId(hospitalId),
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          totalDischarges: { $sum: 1 },
          totalStayDuration: {
            $sum: { $subtract: ["$createdAt", "$admissionDate"] },
          },
          totalBillingDuration: {
            $sum: {
              $cond: [
                "$paymentSettledAt",
                {
                  $subtract: [
                    "$paymentSettledAt",
                    { $ifNull: ["$dischargeAdviceAt", "$createdAt"] },
                  ],
                },
                0,
              ],
            },
          },
          billingCount: {
            $sum: { $cond: ["$paymentSettledAt", 1, 0] },
          },
          totalInfections: {
            $sum: {
              $add: [
                { $cond: ["$infectionFlags.hasSSI", 1, 0] },
                { $cond: ["$infectionFlags.hasUTI", 1, 0] },
                { $cond: ["$infectionFlags.hasVAP", 1, 0] },
                { $cond: ["$infectionFlags.hasCLABSI", 1, 0] },
              ],
            },
          },
          mrns: { $push: { mrn: "$mrn", date: "$createdAt" } }, // Collect MRNs for readmission check
        },
      },
    ]);

    const d = dischargeMetrics[0] || {};
    const totalDischarges = d.totalDischarges || 0;
    const alos =
      totalDischarges > 0
        ? (
            d.totalStayDuration /
            (1000 * 60 * 60 * 24) /
            totalDischarges
          ).toFixed(1)
        : 0;
    const billingTat =
      (d.billingCount || 0) > 0
        ? Math.round(d.totalBillingDuration / (60000 * d.billingCount))
        : 0;

    // Infection rate per 1000 patient days
    const infectionRate =
      totalOccupiedBedDays > 0
        ? (((d.totalInfections || 0) / totalOccupiedBedDays) * 1000).toFixed(2)
        : 0;

    // 6. Active Readmission Calculation (Same Diagnosis/MRN within 30 days)
    // We look for ANY discharge for these MRNs in the 30 days PRIOR to their current discharge
    // This is a simplified check: matched MRN = potential readmission
    let readmissionCount = 0;
    if (d.mrns && d.mrns.length > 0) {
      const uniqueMrns = [...new Set(d.mrns.map((m: any) => m.mrn))];

      // Find ALL discharges for these MRNs in the [StartDate - 30 days, EndDate] window
      const lookbackDate = new Date(startDate);
      lookbackDate.setDate(lookbackDate.getDate() - 30);

      const potentialPriorDischarges = await DischargeRecord.find({
        hospital: hospitalId,
        mrn: { $in: uniqueMrns },
        createdAt: { $gte: lookbackDate, $lt: endDate },
      }).select("mrn createdAt diagnosis");

      // Analyze locally in memory for overlaps
      d.mrns.forEach((currentDischarge: any) => {
        const currentDt = new Date(currentDischarge.date);
        // Check if this specific discharge has a predecessor within 30 days
        const hasPrior = potentialPriorDischarges.some(
          (prior) =>
            prior.mrn === currentDischarge.mrn &&
            prior.createdAt < currentDt &&
            currentDt.getTime() - prior.createdAt.getTime() <
              30 * 24 * 60 * 60 * 1000,
        );
        if (hasPrior) readmissionCount++;
      });
    }

    const readmissionRate =
      totalDischarges > 0
        ? Math.round((readmissionCount / totalDischarges) * 100)
        : 0;

    // 7. Incident Rate (per 1000 patient days)
    const totalIncidents = await Incident.countDocuments({
      hospital: new mongoose.Types.ObjectId(hospitalId),
      incidentDate: { $gte: startDate, $lte: endDate },
    });

    const safeDenominator = Math.max(
      Math.round(totalOccupiedBedDays) || 0,
      daysInMonth,
      1,
    );
    const incidentRate =
      totalIncidents === 0
        ? 0
        : Number(((totalIncidents / safeDenominator) * 1000).toFixed(2));

    const calculatedIndicators = {
      opdWaitingTime: avgWait,
      bedOccupancyRate: bedOccupancyRate,
      alos: Number(alos),
      billingTat: billingTat,
      incidentRate: incidentRate,
      infectionRate: Number(infectionRate),
      readmissionRate: readmissionRate,
    };

    // GAP Analysis Calculations
    // 1. Missing Discharge Diagnoses
    const missingDiagnosesCount = await DischargeRecord.countDocuments({
      hospital: hospitalId,
      createdAt: { $gte: startDate, $lte: endDate },
      $or: [
        { diagnosis: { $exists: false } },
        { diagnosis: "" },
        { diagnosis: null },
      ],
    });

    // 2. Untracked Surgical Infections (using infectionFlags existence as proxy)
    // If infectionFlags is missing entirely, we consider it "untracked" for this audit purpose
    const untrackedInfectionsCount = await DischargeRecord.countDocuments({
      hospital: hospitalId,
      createdAt: { $gte: startDate, $lte: endDate },
      infectionFlags: { $exists: false },
    });

    // 3. Empty OPD Arrival Timestamps
    // Checking for completed appointments where no explicit check-in/start time was tracked
    // (using consultationStartTime as the "arrival" confirmation for the sake of audit)
    const emptyArrivalTimesCount = await Appointment.countDocuments({
      hospital: hospitalId,
      date: { $gte: startDate, $lte: endDate },
      status: "completed",
      consultationStartTime: { $exists: false },
    });

    const dataGaps = {
      missingDiagnoses: missingDiagnosesCount,
      untrackedInfections: untrackedInfectionsCount,
      emptyArrivalTimes: emptyArrivalTimesCount,
    };

    // Compliance Score Calculation (Simplified Logic)
    // Start with 100, deduct points for gaps
    let score = 100;
    if (missingDiagnosesCount > 0) score -= missingDiagnosesCount * 2; // High impact
    if (untrackedInfectionsCount > 0) score -= untrackedInfectionsCount * 5; // Critical impact
    if (emptyArrivalTimesCount > 0) score -= emptyArrivalTimesCount * 0.5; // Low impact

    // Also factor in if indicators are wildly off target (optional, keeping simple for now)
    if (avgWait > 60) score -= 5;
    if (Number(infectionRate) > 5) score -= 10;

    const complianceScore = Math.max(0, Math.round(score));

    const rawCounts = {
      totalOpdVisits: totalVisits,
      totalAdmissions: await IPDAdmission.countDocuments({
        hospital: hospitalId,
        admissionDate: { $gte: startDate, $lte: endDate },
      }),
      totalDischarges: totalDischarges,
      totalInfections: d.totalInfections || 0,
      totalIncidents: totalIncidents,
      totalReadmissions: d.totalReadmissions || 0,
      totalOccupiedBedDays: Math.round(totalOccupiedBedDays),
      totalAvailableBedDays: totalAvailableBedDays,
    };

    // If metrics didn't exist, create an 'open' record
    if (!metrics) {
      metrics = await QualityMetric.create({
        hospital: hospitalId,
        month,
        year,
        indicators: calculatedIndicators,
        rawCounts,
        dataGaps,
        complianceScore,
        status: "open",
      });
    } else {
      // Update the 'open' record with fresh calculations
      metrics.indicators = calculatedIndicators;
      metrics.rawCounts = rawCounts;
      metrics.dataGaps = dataGaps;
      metrics.complianceScore = complianceScore;
      await metrics.save();
    }

    res.json(metrics);
  } catch (error: any) {
    console.error("Quality Metrics Error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getQualityTrends = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const trends = await QualityMetric.find({ hospital: hospitalId, year })
      .sort({ month: 1 })
      .select("month indicators");

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const formattedTrends = trends.map((t) => ({
      month: monthNames[t.month - 1],
      alos: t.indicators.alos,
      occupancy: t.indicators.bedOccupancyRate,
    }));

    res.json(formattedTrends);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const lockQualityMetrics = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const { month, year } = req.body;

    const metrics = await QualityMetric.findOneAndUpdate(
      { hospital: hospitalId, month, year },
      {
        status: "locked",
        lockedAt: new Date(),
        lockedBy: (req as any).user?._id,
      },
      { new: true },
    );

    if (!metrics) {
      return res
        .status(404)
        .json({ message: "Metrics not found for this period" });
    }

    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
