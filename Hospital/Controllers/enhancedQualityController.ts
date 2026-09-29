import { Request, Response } from "express";
import mongoose from "mongoose";
import QualityMetric from "../Models/QualityMetric.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import DischargeRecord from "../../Discharge/Models/DischargeRecord.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Incident from "../../Incident/Models/Incident.js";
import Bed from "../../IPD/Models/Bed.js";
import User from "../../Auth/Models/User.js";

async function calculateMetricsForRange(
  hospitalId: string,
  startDate: Date,
  endDate: Date,
) {
  // 1. OPD Waiting Time
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
          $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60 * 1000],
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

  const opdResult = opdMetrics[0] || { avgWait: 0, totalVisits: 0 };
  const avgWait = Math.round(opdResult.avgWait);
  const opdVisits = opdResult.totalVisits;

  // 2. Bed Occupancy Rate
  const totalBeds = await Bed.countDocuments({ hospital: hospitalId });
  const diffInMs = endDate.getTime() - startDate.getTime();
  const daysInRange = Math.max(1, Math.ceil(diffInMs / (1000 * 60 * 60 * 24)));
  const totalAvailableBedDays = totalBeds * daysInRange;

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
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    totalOccupiedBedDays += Math.max(0, diff);
  });

  const bedOccupancyRate =
    totalAvailableBedDays > 0
      ? Number(
          ((totalOccupiedBedDays / totalAvailableBedDays) * 100).toFixed(2),
        )
      : 0;

  // 3. Discharge based metrics (ALOS, Billing TAT, Infection, Readmission)
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
        // TAT = paymentSettledAt - (dischargeAdviceAt ?? createdAt)
        // Fallback to createdAt covers all legacy records where
        // dischargeAdviceAt was never written (field is missing).
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
        readmissionCount: { $sum: { $cond: ["$isReadmission", 1, 0] } },
        mrns: { $push: { mrn: "$mrn", date: "$createdAt" } },
      },
    },
  ]);

  const d = dischargeMetrics[0] || {};
  const totalDischarges = d.totalDischarges || 0;
  const readmissionCount = d.readmissionCount || 0;
  const alos =
    totalDischarges > 0
      ? Number(
          (
            d.totalStayDuration /
            (1000 * 60 * 60 * 24) /
            totalDischarges
          ).toFixed(1),
        )
      : 0;
  const billingTat =
    (d.billingCount || 0) > 0
      ? Math.round(d.totalBillingDuration / (60000 * d.billingCount))
      : 0;

  // 4. Incident Rate: per 1000 patient-days
  const hospitalUsers = await User.find({ hospital: hospitalId }).select("_id");
  const hospitalUserIds = hospitalUsers.map((u) => u._id);

  const incidentCount = await Incident.countDocuments({
    reportedBy: { $in: hospitalUserIds },
    incidentDate: { $gte: startDate, $lte: endDate },
  });

  // Use max(rounded bed-days, calendar days in period, 1) as denominator.
  // This prevents division by a tiny fraction (e.g. 0.1 bed-days) which
  // caused rates like 10,000‰ for a hospital with only one short admission.
  const safePatientDays = Math.max(
    Math.round(totalOccupiedBedDays) || 0,
    daysInRange,
    1,
  );

  const incidentRate =
    incidentCount === 0
      ? 0
      : Number(((incidentCount / safePatientDays) * 1000).toFixed(2));

  // --- OPD Readmission logic ---
  const allOpdAppointments = await Appointment.find({
    hospital: new mongoose.Types.ObjectId(hospitalId),
    date: { $gte: startDate, $lte: endDate },
    status: { $in: ["completed", "confirmed", "Booked", "in-progress"] },
  })
    .select("patient date")
    .lean();

  const opdPatients = [
    ...new Set(allOpdAppointments.map((a) => a.patient.toString())),
  ];
  const opdLookbackStart = new Date(startDate);
  opdLookbackStart.setDate(opdLookbackStart.getDate() - 30);

  const historicalOpdApps = await Appointment.find({
    hospital: new mongoose.Types.ObjectId(hospitalId),
    patient: { $in: opdPatients },
    date: { $gte: opdLookbackStart, $lt: endDate },
    status: { $in: ["completed", "confirmed", "Booked", "in-progress"] },
  })
    .select("patient date")
    .lean();

  const opdAppsByPatient = historicalOpdApps.reduce(
    (acc, app) => {
      const pid = app.patient.toString();
      if (!acc[pid]) acc[pid] = [];
      acc[pid].push(new Date(app.date).getTime());
      return acc;
    },
    {} as Record<string, number[]>,
  );

  let opdReadmissionCount = 0;
  for (const app of allOpdAppointments) {
    const currentMs = new Date(app.date).getTime();
    const patientApps = opdAppsByPatient[app.patient.toString()] || [];
    const hasPrior = patientApps.some(
      (ms) => ms < currentMs && currentMs - ms <= 30 * 24 * 60 * 60 * 1000,
    );
    if (hasPrior) opdReadmissionCount++;
  }

  const totalReadmissionCount = readmissionCount + opdReadmissionCount;
  const totalVisitCount = totalDischarges + allOpdAppointments.length;

  const readmissionRate =
    totalVisitCount > 0
      ? Math.round((totalReadmissionCount / totalVisitCount) * 100)
      : 0;

  // 4. GAP Analysis Calculations
  const missingDiagnosesCount = await DischargeRecord.countDocuments({
    hospital: new mongoose.Types.ObjectId(hospitalId),
    createdAt: { $gte: startDate, $lte: endDate },
    $or: [
      { diagnosis: { $exists: false } },
      { diagnosis: "" },
      { diagnosis: null },
    ],
  });

  const untrackedInfectionsCount = await DischargeRecord.countDocuments({
    hospital: new mongoose.Types.ObjectId(hospitalId),
    createdAt: { $gte: startDate, $lte: endDate },
    infectionFlags: { $exists: false },
  });

  const emptyArrivalTimesCount = await Appointment.countDocuments({
    hospital: new mongoose.Types.ObjectId(hospitalId),
    date: { $gte: startDate, $lte: endDate },
    status: "completed",
    consultationStartTime: { $exists: false },
  });

  const dataGaps = {
    missingDiagnoses: missingDiagnosesCount,
    untrackedInfections: untrackedInfectionsCount,
    emptyArrivalTimes: emptyArrivalTimesCount,
  };

  // 5. Compliance Score Calculation
  let score = 100;
  if (missingDiagnosesCount > 0) score -= missingDiagnosesCount * 2;
  if (untrackedInfectionsCount > 0) score -= untrackedInfectionsCount * 5;
  if (emptyArrivalTimesCount > 0) score -= emptyArrivalTimesCount * 0.5;
  const complianceScore = Math.max(0, Math.round(score));

  // 6. Raw Counts
  const rawCounts = {
    totalOpdVisits: allOpdAppointments.length,
    totalAdmissions: await IPDAdmission.countDocuments({
      hospital: new mongoose.Types.ObjectId(hospitalId),
      admissionDate: { $gte: startDate, $lte: endDate },
    }),
    totalDischarges: totalDischarges,
    totalInfections: d.totalInfections || 0,
    totalIncidents: incidentCount,
    totalReadmissions: totalReadmissionCount,
    totalOccupiedBedDays: Number(totalOccupiedBedDays.toFixed(2)),
    totalAvailableBedDays: totalAvailableBedDays,
  };

  return {
    indicators: {
      opdWaitingTime: avgWait,
      bedOccupancyRate: bedOccupancyRate,
      alos: alos,
      billingTat: billingTat,
      incidentRate: incidentRate,
      readmissionRate: readmissionRate,
    },
    dataGaps,
    complianceScore,
    rawCounts,
  };
}

/**
 * GET /enhanced-quality-metrics
 * Returns current metrics and comparison with previous month
 */
export const getEnhancedQualityMetrics = async (
  req: Request,
  res: Response,
) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const month =
      parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    // 1. Get Current Month Metrics
    let currentMetrics = await QualityMetric.findOne({
      hospital: hospitalId,
      month,
      year,
    }).populate("lockedBy", "name");

    // If not locked, we might want to return real-time calculations
    if (!currentMetrics || currentMetrics.status !== "locked") {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      const calculatedData = await calculateMetricsForRange(
        hospitalId,
        startDate,
        endDate,
      );

      // Temporary object for response if doesn't exist in DB
      if (!currentMetrics) {
        currentMetrics = {
          ...calculatedData,
          status: "open",
          month,
          year,
        } as any;
      } else {
        currentMetrics.indicators = calculatedData.indicators;
        currentMetrics.dataGaps = calculatedData.dataGaps;
        currentMetrics.complianceScore = calculatedData.complianceScore;
        currentMetrics.rawCounts = calculatedData.rawCounts;
        await currentMetrics.save();
      }
    }

    // 2. Get Previous Month Metrics for Comparison
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear -= 1;
    }

    let previousMetrics = await QualityMetric.findOne({
      hospital: hospitalId,
      month: prevMonth,
      year: prevYear,
    });

    // If previous month metrics don't exist in DB, calculate them on the fly
    if (!previousMetrics) {
      const pStart = new Date(prevYear, prevMonth - 1, 1);
      const pEnd = new Date(prevYear, prevMonth, 0, 23, 59, 59);
      const pData = await calculateMetricsForRange(hospitalId, pStart, pEnd);
      previousMetrics = { ...pData } as any;
    }

    res.status(200).json({
      status: "success",
      data: {
        current: currentMetrics,
        previous: previousMetrics?.indicators,
      },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

/**
 * GET /quality-metrics/day-wise
 * Returns day-by-day metrics for a specific indicator
 */
export const getIndicatorDayWiseTrends = async (
  req: Request,
  res: Response,
) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const { month, year, indicatorId } = req.query as any;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();

    const daysInMonth = new Date(y, m, 0).getDate();
    const dailyTrends: any[] = [];

    // For performance, we'll fetch all data for the month once and process in memory
    const startDate = new Date(y, m - 1, 1);
    const endDate = new Date(y, m, 0, 23, 59, 59);

    // Fetch source data based on indicatorId
    if (indicatorId === "opdWaitingTime") {
      const appointments = await Appointment.find({
        hospital: hospitalId,
        status: "completed",
        date: { $gte: startDate, $lte: endDate },
      }).select("createdAt updatedAt date");

      for (let day = 1; day <= daysInMonth; day++) {
        const dayApps = appointments.filter(
          (a) => new Date(a.date).getDate() === day,
        );
        const avg =
          dayApps.length > 0
            ? Math.round(
                dayApps.reduce(
                  (sum: number, a: any) =>
                    sum +
                    (new Date(a.updatedAt).getTime() -
                      new Date(a.createdAt).getTime()),
                  0,
                ) /
                  (dayApps.length * 60000),
              )
            : 0;
        dailyTrends.push({ day, date: day, value: avg });
      }
    } else if (indicatorId === "bedOccupancyRate") {
      const totalBeds = await Bed.countDocuments({ hospital: hospitalId });
      const occupancies = await BedOccupancy.find({
        hospital: hospitalId,
        $or: [
          { startDate: { $lte: endDate }, endDate: { $gte: startDate } },
          { startDate: { $lte: endDate }, endDate: { $exists: false } },
        ],
      });

      for (let day = 1; day <= daysInMonth; day++) {
        const dayStart = new Date(y, m - 1, day, 0, 0, 0);
        const dayEnd = new Date(y, m - 1, day, 23, 59, 59);

        let occupiedDays = 0;
        occupancies.forEach((occ: any) => {
          const start = occ.startDate < dayStart ? dayStart : occ.startDate;
          const end =
            occ.endDate && occ.endDate < dayEnd ? occ.endDate : dayEnd;
          if (start <= dayEnd && end >= dayStart) {
            const diff =
              (new Date(end).getTime() - new Date(start).getTime()) /
              (1000 * 60 * 60 * 24);
            occupiedDays += Math.max(0, diff);
          }
        });

        const rate =
          totalBeds > 0 ? Number(((occupiedDays / 1) * 100).toFixed(2)) : 0;
        dailyTrends.push({ day, date: day, value: Math.min(100, rate) });
      }
    } else {
      // ALOS, Billing TAT, Infection, Readmission use Discharge Records
      const discharges = await DischargeRecord.find({
        hospital: hospitalId,
        createdAt: { $gte: startDate, $lte: endDate },
      });

      for (let day = 1; day <= daysInMonth; day++) {
        const dayDischarges = discharges.filter(
          (d) => new Date(d.createdAt).getDate() === day,
        );
        let value = 0;

        if (indicatorId === "alos") {
          value =
            dayDischarges.length > 0
              ? Number(
                  (
                    dayDischarges.reduce((sum: number, d: any) => {
                      const createdAt = d.createdAt
                        ? new Date(d.createdAt).getTime()
                        : Date.now();
                      const admissionDate = d.admissionDate
                        ? new Date(d.admissionDate).getTime()
                        : createdAt;
                      return sum + (createdAt - admissionDate);
                    }, 0) /
                    (dayDischarges.length * 86400000)
                  ).toFixed(1),
                )
              : 0;
        } else if (indicatorId === "billingTat") {
          // Only need paymentSettledAt; use dischargeAdviceAt when present,
          // otherwise fall back to createdAt (covers all legacy records).
          const billingDischarges = dayDischarges.filter(
            (d: any) => d.paymentSettledAt,
          );
          value =
            billingDischarges.length > 0
              ? Math.round(
                  billingDischarges.reduce(
                    (sum: number, d: any) => {
                      const start = d.dischargeAdviceAt
                        ? new Date(d.dischargeAdviceAt).getTime()
                        : new Date(d.createdAt).getTime();
                      return (
                        sum +
                        (new Date(d.paymentSettledAt).getTime() - start)
                      );
                    },
                    0,
                  ) /
                    (billingDischarges.length * 60000),
                )
              : 0;
        } else if (indicatorId === "incidentRate") {
          const hospitalUsers = await User.find({
            hospital: hospitalId,
          }).select("_id");
          const hospitalUserIds = hospitalUsers.map((u) => u._id);
          const dayIncidents = await Incident.countDocuments({
            reportedBy: { $in: hospitalUserIds },
            incidentDate: {
              $gte: new Date(y, m - 1, day, 0, 0, 0),
              $lte: new Date(y, m - 1, day, 23, 59, 59),
            },
          });
          value = dayIncidents;
        } else if (indicatorId === "readmissionRate") {
          const category = req.query.category || "IPD"; // Default to IPD

          if (category === "OPD") {
            // OPD Readmission Logic: Repeat visit within 30 days
            const dayDate = new Date(y, m - 1, day);
            const dayStart = new Date(y, m - 1, day, 0, 0, 0);
            const dayEnd = new Date(y, m - 1, day, 23, 59, 59);

            const dayAppointments = await Appointment.find({
              hospital: hospitalId,
              status: {
                $in: ["completed", "confirmed", "Booked", "in-progress"],
              },
              date: { $gte: dayStart, $lte: dayEnd },
            })
              .select("_id patient date")
              .lean();

            let opdReadmitCount = 0;
            for (const app of dayAppointments) {
              const lookback = new Date(app.date);
              lookback.setDate(lookback.getDate() - 30);

              const previousApp = await Appointment.findOne({
                _id: { $ne: (app as any)._id },
                hospital: hospitalId,
                patient: app.patient,
                status: {
                  $in: ["completed", "confirmed", "Booked", "in-progress"],
                },
                date: { $gte: lookback, $lte: new Date(app.date) },
              });

              if (previousApp) opdReadmitCount++;
            }
            value = opdReadmitCount;
          } else {
            // IPD Readmission Logic
            value = dayDischarges.filter((d) => d.isReadmission).length;
          }
        }

        dailyTrends.push({ day, date: day, value });
      }
    }

    res.status(200).json({
      status: "success",
      data: { trends: dailyTrends },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

/**
 * GET /quality-metrics/audit-trends
 * Returns trend data for 3 or 6 months
 */
export const getAuditTrendData = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const months = parseInt(req.query.months as string) || 3;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months + 1);
    startDate.setDate(1);

    const results = await QualityMetric.find({
      hospital: hospitalId,
      $or: [
        {
          year: startDate.getFullYear(),
          month: { $gte: startDate.getMonth() + 1 },
        },
        {
          year: endDate.getFullYear(),
          month: { $lte: endDate.getMonth() + 1 },
        },
      ],
    }).sort({ year: 1, month: 1 });

    // Fill missing months with calculated data (non-locked)
    const allMonthsData: any[] = [];
    let tempDate = new Date(startDate);

    while (tempDate <= endDate) {
      const m = tempDate.getMonth() + 1;
      const y = tempDate.getFullYear();

      let data = results.find((r) => r.month === m && r.year === y);
      if (!data) {
        // Calculate on the fly
        const s = new Date(y, m - 1, 1);
        const e = new Date(y, m, 0, 23, 59, 59);
        const calculated = await calculateMetricsForRange(hospitalId, s, e);
        allMonthsData.push({
          month: m,
          year: y,
          indicators: calculated.indicators,
          status: "open",
        });
      } else {
        allMonthsData.push(data);
      }

      tempDate.setMonth(tempDate.getMonth() + 1);
    }

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
    const formatted = allMonthsData.map((d) => {
      const indicators = d.toObject ? d.toObject().indicators : d.indicators;
      return {
        label: `${monthNames[d.month - 1]} ${d.year}`,
        month: monthNames[d.month - 1],
        ...indicators,
      };
    });

    res.status(200).json({
      status: "success",
      data: { trends: formatted },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};
