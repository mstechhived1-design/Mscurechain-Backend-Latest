import { Request, Response } from "express";
import mongoose from "mongoose";
import User from "../../Auth/Models/User.js";
import Attendance from "../../Staff/Models/Attendance.js";
import NursingTask from "../../Staff/Models/NursingTask.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import Feedback from "../../Patient/Models/Feedback.js";
import PerformanceWeights from "../Models/PerformanceWeights.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns start & end Date for a given month (0-indexed) and year */
function getMonthRange(month: number, year: number) {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { startDate, endDate };
}

/** Returns start & end Date for the PREVIOUS month */
function getPrevMonthRange(month: number, year: number) {
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    return getMonthRange(prevMonth, prevYear);
}

/** Fetch or create default PerformanceWeights for a hospital+role */
async function getWeights(
    hospitalId: mongoose.Types.ObjectId,
    role: "doctor" | "nurse" | "staff",
): Promise<any> {
    let weights: any = await PerformanceWeights.findOne({
        hospital: hospitalId,
        role,
    }).lean();
    if (!weights) {
        const created = await PerformanceWeights.create({
            hospital: hospitalId,
            role,
            weights: { attendance: 0.30, quality: 0.25, activity: 0.25, revenue: 0.10, taskCompletion: 0.10 },
            thresholds: { highPerformer: 4.0, lowAttendance: 70, burnoutOvertime: 50, lowRating: 3.0 },
        });
        weights = created.toObject();
    }
    return weights;
}


/** Calculate attendance stats for a user in a period */
async function calcAttendance(
    userId: mongoose.Types.ObjectId,
    hospitalId: mongoose.Types.ObjectId,
    startDate: Date,
    endDate: Date,
) {
    const result = await Attendance.aggregate([
        {
            $match: {
                user: userId,
                hospital: hospitalId,
                date: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: null,
                totalDays: { $sum: 1 },
                presentDays: {
                    $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] },
                },
                lateDays: {
                    $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] },
                },
                absentDays: {
                    $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] },
                },
                onLeaveDays: {
                    $sum: { $cond: [{ $eq: ["$status", "on-leave"] }, 1, 0] },
                },
            },
        },
    ]);

    const att = result[0] || {
        totalDays: 0,
        presentDays: 0,
        lateDays: 0,
        absentDays: 0,
        onLeaveDays: 0,
    };

    const rate =
        att.totalDays > 0
            ? Math.round((att.presentDays / att.totalDays) * 100)
            : 0;

    return { ...att, rate };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/performance/dashboard?month=MM&year=YYYY
// Master dashboard combining all roles
// ══════════════════════════════════════════════════════════════════════════════
export const getPerformanceDashboardV2 = async (
    req: Request,
    res: Response,
) => {
    try {
        const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);

        const targetMonth = req.query.month !== undefined
            ? parseInt(req.query.month as string)
            : new Date().getMonth();
        const targetYear = req.query.year !== undefined
            ? parseInt(req.query.year as string)
            : new Date().getFullYear();

        const { startDate, endDate } = getMonthRange(targetMonth, targetYear);
        const { startDate: prevStart, endDate: prevEnd } = getPrevMonthRange(
            targetMonth,
            targetYear,
        );

        // ── 1. All active staff (doctors, nurses, staff) ──────────────────────────
        const allPersonnel = await User.find({
            hospital: hospitalId,
            status: "active",
            role: { $in: ["doctor", "nurse", "staff"] },
        })
            .select("_id name role employeeId image email createdAt")
            .lean();

        if (allPersonnel.length === 0) {
            return res.json({
                success: true,
                data: {
                    stats: {
                        totalStaff: 0,
                        totalDoctors: 0,
                        totalNurses: 0,
                        totalStaffCount: 0,
                        avgAttendanceRate: 0,
                        avgCompositeScore: 0,
                        highPerformers: 0,
                        attendanceBelow70: 0,
                        burnoutRisk: 0,
                        lowRatingAlerts: 0,
                        period: `${targetMonth + 1}/${targetYear}`,
                    },
                    topPerformers: { doctors: [], nurses: [], staff: [] },
                    employees: [],
                    departmentStats: [],
                    trends: [],
                },
                message: "No staff found for this hospital",
            });
        }

        // ── 2. Aggregated attendance for all staff in one query ───────────────────
        const bulkAttendance = await Attendance.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    date: { $gte: startDate, $lte: endDate },
                    user: { $in: allPersonnel.map((p) => p._id) },
                },
            },
            {
                $group: {
                    _id: "$user",
                    totalDays: { $sum: 1 },
                    presentDays: {
                        $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] },
                    },
                    lateDays: {
                        $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] },
                    },
                    absentDays: {
                        $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] },
                    },
                    onLeaveDays: {
                        $sum: { $cond: [{ $eq: ["$status", "on-leave"] }, 1, 0] },
                    },
                },
            },
        ]);
        const attendanceMap = new Map(bulkAttendance.map((a) => [a._id.toString(), a]));

        // Previous month attendance (for trend)
        const prevBulkAttendance = await Attendance.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    date: { $gte: prevStart, $lte: prevEnd },
                    user: { $in: allPersonnel.map((p) => p._id) },
                },
            },
            {
                $group: {
                    _id: "$user",
                    totalDays: { $sum: 1 },
                    presentDays: {
                        $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] },
                    },
                },
            },
        ]);
        const prevAttMap = new Map(prevBulkAttendance.map((a) => [a._id.toString(), a]));

        // ── 3. Doctor-specific: DoctorProfiles, Appointments, Prescriptions, Feedback
        const doctors = allPersonnel.filter((p) => p.role === "doctor");
        const doctorProfiles = await (DoctorProfile.find({
            user: { $in: doctors.map((d) => d._id) },
        }) as any)
            .unscoped()
            .select("_id user specialties")
            .lean();
        const doctorProfileMap = new Map(
            doctorProfiles.map((dp) => [dp.user.toString(), dp]),
        );

        // Bulk appointment counts
        const doctorProfileIds = doctorProfiles.map((dp) => dp._id);
        const bulkAppointments = await Appointment.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    doctor: { $in: doctorProfileIds },
                    createdAt: { $gte: startDate, $lte: endDate },
                },
            },
            { $group: { _id: "$doctor", count: { $sum: 1 }, completedCount: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } },
        ]);
        const apptMap = new Map(bulkAppointments.map((a) => [a._id.toString(), a]));

        // Bulk prescription counts
        const bulkPrescriptions = await Prescription.aggregate([
            {
                $match: {
                    doctor: { $in: doctorProfileIds },
                    createdAt: { $gte: startDate, $lte: endDate },
                },
            },
            { $group: { _id: "$doctor", count: { $sum: 1 } } },
        ]);
        const prescMap = new Map(bulkPrescriptions.map((p) => [p._id.toString(), p]));

        // Bulk doctor feedback
        const bulkFeedback = await Feedback.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    doctor: { $in: doctorProfileIds },
                    createdAt: { $gte: startDate, $lte: endDate },
                },
            },
            { $group: { _id: "$doctor", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
        ]);
        const feedbackMap = new Map(bulkFeedback.map((f) => [f._id.toString(), f]));

        // Revenue from IPD billing per doctor (using admissions)
        const ipdBillingColl = mongoose.connection.collection("ipdbillings");
        const bulkRevenue = await ipdBillingColl.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    createdAt: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $lookup: {
                    from: "ipdadmissions",
                    localField: "admission",
                    foreignField: "_id",
                    as: "admissionData",
                },
            },
            { $unwind: { path: "$admissionData", preserveNullAndEmptyArrays: true } },

            {
                $group: {
                    _id: "$admissionData.doctor",
                    totalRevenue: { $sum: "$totalAmount" },
                },
            },
        ]).toArray();
        const revenueMap = new Map(
            bulkRevenue
                .filter((r) => r._id)
                .map((r) => [r._id.toString(), r.totalRevenue || 0]),
        );

        // ── 4. Nurse-specific: Tasks derived from IPD Admissions
        // The nurse tasks page generates tasks from active IPD admissions (2 per admission:
        // Vitals Check + Clinical Notes). There is no standalone NursingTask collection used.
        const nurses = allPersonnel.filter((p) => p.role === "nurse");

        // Count active admissions for this hospital in the selected month
        const activeAdmissionsForMonth = await IPDAdmission.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    status: "Active",
                },
            },
            {
                $group: {
                    _id: null,
                    admissionCount: { $sum: 1 },
                    withVitals: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $gt: ["$vitals.pulse", null] },
                                        { $gt: ["$vitals.bloodPressure", null] },
                                        { $gt: ["$vitals.spO2", null] },
                                        { $gt: ["$vitals.temperature", null] },
                                    ]
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    withNotes: {
                        $sum: {
                            $cond: [
                                { $and: [{ $ne: ["$clinicalNotes", null] }, { $ne: ["$clinicalNotes", ""] }] },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]);

        // Also count admissions created/admitted within the selected month
        const monthAdmissions = await IPDAdmission.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    admissionDate: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: null,
                    admissionCount: { $sum: 1 },
                    withVitals: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $gt: ["$vitals.pulse", null] },
                                        { $gt: ["$vitals.bloodPressure", null] },
                                    ]
                                },
                                1, 0,
                            ],
                        },
                    },
                },
            },
        ]);

        // Use active admissions if any, otherwise fall back to month admissions
        const admAgg = activeAdmissionsForMonth[0] || monthAdmissions[0] || { admissionCount: 0, withVitals: 0, withNotes: 0 };
        const admissionCount = admAgg.admissionCount || 0;

        // 2 tasks per admission (Vitals Check + Clinical Notes)
        const totalNurseTasks = admissionCount * 2;
        const completedVitals = admAgg.withVitals || 0;
        const completedNotes = admAgg.withNotes || 0;
        const completedNurseTasks = completedVitals + completedNotes;
        // Medication tasks: Vitals Check tasks that were completed
        const medicationTasks = completedVitals;
        const completedMedTasks = completedVitals;

        console.log(`[PerfDashboard] Admissions: ${admissionCount}, totalTasks: ${totalNurseTasks}, completed: ${completedNurseTasks}`);

        // Build per-nurse task map: distribute evenly across all nurses
        const nurseTaskMap = new Map<string, any>();
        if (nurses.length > 0 && totalNurseTasks > 0) {
            const n = nurses.length;
            const shared = {
                totalTasks: Math.round(totalNurseTasks / n),
                completedTasks: Math.round(completedNurseTasks / n),
                medicationTasks: Math.round(medicationTasks / n),
                completedMedTasks: Math.round(completedMedTasks / n),
            };
            nurses.forEach((nurse) => {
                nurseTaskMap.set(nurse._id.toString(), shared);
            });
        }

        // Nurse feedback (general hospital feedback with no doctor ref = staff/nurse)
        const bulkNurseFeedback = await Feedback.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    doctor: { $exists: false },
                    category: "Staff Behavior",
                    createdAt: { $gte: startDate, $lte: endDate },
                },
            },
            { $group: { _id: null, avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
        ]);
        const nurseAvgRating = bulkNurseFeedback[0]?.avgRating || 0;

        // ── 5. Staff-specific: Registrations via helpdesk, support tickets
        const staffMembers = allPersonnel.filter((p) => p.role === "staff");
        const supportTicketsColl = mongoose.connection.collection("supporttickets");
        const bulkTickets = await supportTicketsColl.aggregate([
            {
                $match: {
                    hospital: hospitalId,
                    createdAt: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: "$assignedTo",
                    totalTickets: { $sum: 1 },
                    resolvedTickets: {
                        $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
                    },
                },
            },
        ]).toArray();
        const ticketMap = new Map(
            bulkTickets
                .filter((t) => t._id)
                .map((t) => [t._id.toString(), t]),
        );

        // ── 6. Load weights per role ──────────────────────────────────────────────
        const [doctorWeights, nurseWeights, staffWeights] = await Promise.all([
            getWeights(hospitalId, "doctor"),
            getWeights(hospitalId, "nurse"),
            getWeights(hospitalId, "staff"),
        ]);

        // ── 7. Build enriched employee records ───────────────────────────────────
        const employees = allPersonnel.map((person) => {
            const uid = person._id.toString();
            const att = attendanceMap.get(uid) || {
                totalDays: 0,
                presentDays: 0,
                lateDays: 0,
                absentDays: 0,
                onLeaveDays: 0,
            };
            const attendanceRate =
                att.totalDays > 0
                    ? Math.round((att.presentDays / att.totalDays) * 100)
                    : 0;

            const prevAtt = prevAttMap.get(uid);
            const prevRate =
                prevAtt && prevAtt.totalDays > 0
                    ? Math.round((prevAtt.presentDays / prevAtt.totalDays) * 100)
                    : null;

            // Attendance score: 0-5
            const attendanceScore = attendanceRate / 20;

            let compositeScore = 0;
            let roleMetrics: any = {};
            let riskFlags: string[] = [];

            if (person.role === "doctor") {
                const dp = doctorProfileMap.get(uid);
                const dpId = (dp as any)?._id?.toString();
                const appt = dpId ? apptMap.get(dpId) : null;
                const presc = dpId ? prescMap.get(dpId) : null;
                const fb = dpId ? feedbackMap.get(dpId) : null;
                const revenue = dpId ? (revenueMap.get(dpId) || 0) : 0;

                const totalAppts = appt?.count || 0;
                const completedAppts = appt?.completedCount || 0;
                const totalPrx = presc?.count || 0;
                const avgRating = fb?.avgRating || 0;
                const feedbackCount = fb?.count || 0;

                // Quality: avg rating (0-5)
                const qualityScore = avgRating; // 0-5

                // Activity: completed appointments + prescriptions (scaled 0-5)
                const activityScore = Math.min(
                    5,
                    completedAppts / 20 + totalPrx / 30,
                );

                // Revenue: scale over expected e.g. 50000/month = 5
                const revenueScore = Math.min(5, (revenue / 50000) * 5);

                const w = (doctorWeights as any).weights;
                compositeScore =
                    attendanceScore * w.attendance +
                    qualityScore * w.quality +
                    activityScore * w.activity +
                    revenueScore * w.revenue;

                roleMetrics = {
                    totalAppointments: totalAppts,
                    completedAppointments: completedAppts,
                    totalPrescriptions: totalPrx,
                    avgPatientRating: parseFloat(avgRating.toFixed(2)),
                    feedbackCount,
                    revenueGenerated: revenue,
                    specialization: (dp as any)?.specialties?.join(", ") || "General",
                };

                if (avgRating > 0 && avgRating < (doctorWeights as any).thresholds.lowRating) {
                    riskFlags.push("low_rating");
                }
            } else if (person.role === "nurse") {
                const tasks = nurseTaskMap.get(uid);
                const totalTasks = tasks?.totalTasks || 0;
                const completedTasks = tasks?.completedTasks || 0;
                const medTasks = tasks?.medicationTasks || 0;
                const completedMedTasks = tasks?.completedMedTasks || 0;

                const taskCompletionRate =
                    totalTasks > 0
                        ? Math.round((completedTasks / totalTasks) * 100)
                        : 0;
                const medicationAccuracy =
                    medTasks > 0
                        ? Math.round((completedMedTasks / medTasks) * 100)
                        : 0;

                // Quality: task completion as proxy (0-5)
                const qualityScore = (taskCompletionRate / 100) * 5;

                // Activity: number of completed tasks scaled 0-5
                const activityScore = Math.min(5, completedTasks / 10);

                const w = (nurseWeights as any).weights;
                compositeScore =
                    attendanceScore * w.attendance +
                    qualityScore * w.quality +
                    activityScore * w.activity +
                    (nurseAvgRating / 5) * 5 * w.taskCompletion;

                roleMetrics = {
                    totalTasks,
                    completedTasks,
                    taskCompletionRate,
                    medicationTasks: medTasks,
                    medicationAccuracy,
                    patientCareRating: parseFloat(nurseAvgRating.toFixed(2)),
                };

                if (nurseAvgRating > 0 && nurseAvgRating < (nurseWeights as any).thresholds.lowRating) {
                    riskFlags.push("low_rating");
                }
            } else if (person.role === "staff") {
                const tickets = ticketMap.get(uid);
                const totalTickets = tickets?.totalTickets || 0;
                const resolvedTickets = tickets?.resolvedTickets || 0;
                const resolutionRate =
                    totalTickets > 0
                        ? Math.round((resolvedTickets / totalTickets) * 100)
                        : 0;

                // Quality: resolution rate (0-5)
                const qualityScore = (resolutionRate / 100) * 5;

                // Activity: total tickets handled (0-5)
                const activityScore = Math.min(5, totalTickets / 5);

                const w = (staffWeights as any).weights;
                compositeScore =
                    attendanceScore * w.attendance +
                    qualityScore * w.quality +
                    activityScore * w.activity;

                roleMetrics = {
                    totalTickets,
                    resolvedTickets,
                    resolutionRate,
                    dailyThroughput: parseFloat((totalTickets / 26).toFixed(1)),
                };
            }

            compositeScore = parseFloat(Math.min(5, compositeScore).toFixed(2));

            // Risk flags
            if (attendanceRate < (doctorWeights as any).thresholds.lowAttendance) {
                riskFlags.push("low_attendance");
            }

            // Month-over-month improvement
            let improvementPct: number | null = null;
            if (prevRate !== null && prevRate > 0) {
                improvementPct = parseFloat(
                    (((attendanceRate - prevRate) / prevRate) * 100).toFixed(1),
                );
            }

            return {
                _id: uid,
                name: person.name,
                role: person.role,
                employeeId: person.employeeId,
                image: person.image,
                attendance: {
                    ...att,
                    rate: attendanceRate,
                },
                compositeScore,
                roleMetrics,
                riskFlags,
                improvementVsPrevMonth: improvementPct,
                period: `${targetMonth + 1}/${targetYear}`,
                rank: 0, // assigned below after sorting
            };
        });

        // ── 8. Assign ranks per role ──────────────────────────────────────────────
        const roleGroups = ["doctor", "nurse", "staff"] as const;
        roleGroups.forEach((role) => {
            const group = employees
                .filter((e) => e.role === role)
                .sort((a, b) => b.compositeScore - a.compositeScore);
            group.forEach((emp, idx) => {
                emp.rank = idx + 1;
            });
        });

        // ── 9. Stats ──────────────────────────────────────────────────────────────
        const thresholds = (doctorWeights as any).thresholds;
        const totalRates = employees.map((e) => e.attendance.rate);
        const totalScores = employees.map((e) => e.compositeScore);

        const stats = {
            totalStaff: employees.length,
            totalDoctors: doctors.length,
            totalNurses: nurses.length,
            totalStaffCount: staffMembers.length,
            avgAttendanceRate:
                employees.length > 0
                    ? Math.round(totalRates.reduce((a, b) => a + b, 0) / totalRates.length)
                    : 0,
            avgCompositeScore:
                employees.length > 0
                    ? parseFloat(
                        (
                            totalScores.reduce((a, b) => a + b, 0) / totalScores.length
                        ).toFixed(2),
                    )
                    : 0,
            highPerformers: employees.filter(
                (e) => e.compositeScore >= thresholds.highPerformer,
            ).length,
            attendanceBelow70: employees.filter(
                (e) => e.attendance.rate < thresholds.lowAttendance,
            ).length,
            burnoutRisk: employees.filter((e) => e.riskFlags.includes("burnout_risk")).length,
            lowRatingAlerts: employees.filter((e) => e.riskFlags.includes("low_rating")).length,
            period: `${targetMonth + 1}/${targetYear}`,
        };

        // ── 10. Top performers ────────────────────────────────────────────────────
        const topPerformers = {
            doctors: employees
                .filter((e) => e.role === "doctor")
                .sort((a, b) => b.compositeScore - a.compositeScore)
                .slice(0, 5),
            nurses: employees
                .filter((e) => e.role === "nurse")
                .sort((a, b) => b.compositeScore - a.compositeScore)
                .slice(0, 5),
            staff: employees
                .filter((e) => e.role === "staff")
                .sort((a, b) => b.compositeScore - a.compositeScore)
                .slice(0, 5),
        };

        // ── 11. Department stats (by role) ────────────────────────────────────────
        const departmentStats = roleGroups
            .map((role) => {
                const group = employees.filter((e) => e.role === role);
                if (group.length === 0) return null;
                return {
                    department: role.charAt(0).toUpperCase() + role.slice(1) + "s",
                    role,
                    count: group.length,
                    avgAttendance: Math.round(
                        group.reduce((a, b) => a + b.attendance.rate, 0) / group.length,
                    ),
                    avgCompositeScore: parseFloat(
                        (
                            group.reduce((a, b) => a + b.compositeScore, 0) / group.length
                        ).toFixed(2),
                    ),
                    highPerformers: group.filter(
                        (e) => e.compositeScore >= thresholds.highPerformer,
                    ).length,
                };
            })
            .filter(Boolean);

        return res.json({
            success: true,
            data: {
                stats,
                topPerformers,
                employees,
                departmentStats,
                trends: [], // filled by /trends/:employeeId
            },
            message: `Performance dashboard for ${targetMonth + 1}/${targetYear}`,
        });
    } catch (err: any) {
        console.error("[Performance Dashboard V2]", err);
        return res.status(500).json({
            success: false,
            message: "Error computing performance dashboard",
            error: err.message,
        });
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/performance/doctors?month=MM&year=YYYY
// ══════════════════════════════════════════════════════════════════════════════
export const getDoctorPerformance = async (req: Request, res: Response) => {
    try {
        const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);
        const targetMonth = req.query.month !== undefined
            ? parseInt(req.query.month as string)
            : new Date().getMonth();
        const targetYear = req.query.year !== undefined
            ? parseInt(req.query.year as string)
            : new Date().getFullYear();

        const { startDate, endDate } = getMonthRange(targetMonth, targetYear);
        const { startDate: prevStart, endDate: prevEnd } = getPrevMonthRange(targetMonth, targetYear);

        const weights = await getWeights(hospitalId, "doctor");
        const w = (weights as any).weights;
        const thr = (weights as any).thresholds;

        const allDoctors = await User.find({
            hospital: hospitalId,
            status: "active",
            role: "doctor",
        })
            .select("_id name employeeId image email createdAt")
            .lean();

        if (allDoctors.length === 0) {
            return res.json({ success: true, data: { employees: [], stats: {}, topPerformers: [] } });
        }

        const doctorProfiles = await (DoctorProfile.find({
            user: { $in: allDoctors.map((d) => d._id) },
        }) as any)
            .unscoped()
            .select("_id user specialties")
            .lean();
        const dpMap = new Map(doctorProfiles.map((dp) => [dp.user.toString(), dp]));
        const dpIds = doctorProfiles.map((dp) => dp._id);

        // Bulk queries
        const [bulkAtt, bulkPrevAtt, bulkAppts, bulkPrx, bulkFb] = await Promise.all([
            Attendance.aggregate([
                { $match: { hospital: hospitalId, user: { $in: allDoctors.map((d) => d._id) }, date: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$user", totalDays: { $sum: 1 }, presentDays: { $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] } }, lateDays: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } }, absentDays: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } } } },
            ]),
            Attendance.aggregate([
                { $match: { hospital: hospitalId, user: { $in: allDoctors.map((d) => d._id) }, date: { $gte: prevStart, $lte: prevEnd } } },
                { $group: { _id: "$user", totalDays: { $sum: 1 }, presentDays: { $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] } } } },
            ]),
            Appointment.aggregate([
                { $match: { hospital: hospitalId, doctor: { $in: dpIds }, createdAt: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$doctor", total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }, followUps: { $sum: { $cond: [{ $in: ["$type", ["follow-up"]] }, 1, 0] } } } },
            ]),
            Prescription.aggregate([
                { $match: { doctor: { $in: dpIds }, createdAt: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$doctor", count: { $sum: 1 } } },
            ]),
            Feedback.aggregate([
                { $match: { hospital: hospitalId, doctor: { $in: dpIds }, createdAt: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$doctor", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
            ]),
        ]);

        const attMap = new Map(bulkAtt.map((a) => [a._id.toString(), a]));
        const prevAttMap = new Map(bulkPrevAtt.map((a) => [a._id.toString(), a]));
        const apptMap = new Map(bulkAppts.map((a) => [a._id.toString(), a]));
        const prxMap = new Map(bulkPrx.map((p) => [p._id.toString(), p]));
        const fbMap = new Map(bulkFb.map((f) => [f._id.toString(), f]));

        const doctors = allDoctors.map((doc) => {
            const uid = doc._id.toString();
            const dp = dpMap.get(uid);
            const dpId = (dp as any)?._id?.toString();

            const att = attMap.get(uid) || { totalDays: 0, presentDays: 0, lateDays: 0, absentDays: 0 };
            const prevAtt = prevAttMap.get(uid);
            const attendanceRate = att.totalDays > 0 ? Math.round((att.presentDays / att.totalDays) * 100) : 0;
            const prevRate = prevAtt && prevAtt.totalDays > 0 ? Math.round((prevAtt.presentDays / prevAtt.totalDays) * 100) : null;

            const appt = dpId ? apptMap.get(dpId) : null;
            const prx = dpId ? prxMap.get(dpId) : null;
            const fb = dpId ? fbMap.get(dpId) : null;

            const totalAppts = appt?.total || 0;
            const completedAppts = appt?.completed || 0;
            const followUps = appt?.followUps || 0;
            const totalPrx = prx?.count || 0;
            const avgRating = fb?.avgRating || 0;

            const attendanceScore = attendanceRate / 20;
            const qualityScore = avgRating;
            const activityScore = Math.min(5, completedAppts / 20 + totalPrx / 30);
            const revenueScore = 0; // could be loaded separately

            const compositeScore = parseFloat(
                Math.min(
                    5,
                    attendanceScore * w.attendance +
                    qualityScore * w.quality +
                    activityScore * w.activity,
                ).toFixed(2),
            );

            const riskFlags: string[] = [];
            if (attendanceRate < thr.lowAttendance) riskFlags.push("low_attendance");
            if (avgRating > 0 && avgRating < thr.lowRating) riskFlags.push("low_rating");

            const improvementVsPrevMonth =
                prevRate !== null && prevRate > 0
                    ? parseFloat((((attendanceRate - prevRate) / prevRate) * 100).toFixed(1))
                    : null;

            return {
                _id: uid,
                name: doc.name,
                role: "doctor",
                employeeId: doc.employeeId,
                image: doc.image,
                specialization: (dp as any)?.specialties?.join(", ") || "General",
                attendance: { totalDays: att.totalDays, presentDays: att.presentDays, lateDays: att.lateDays, absentDays: att.absentDays, rate: attendanceRate },
                roleMetrics: { totalAppointments: totalAppts, completedAppointments: completedAppts, followUpRatio: totalAppts > 0 ? parseFloat((followUps / totalAppts).toFixed(2)) : 0, totalPrescriptions: totalPrx, avgPatientRating: parseFloat(avgRating.toFixed(2)), feedbackCount: fb?.count || 0 },
                compositeScore,
                riskFlags,
                improvementVsPrevMonth,
                period: `${targetMonth + 1}/${targetYear}`,
            };
        });

        const sorted = [...doctors].sort((a, b) => b.compositeScore - a.compositeScore);
        sorted.forEach((d, i) => ((d as any).rank = i + 1));

        const avgAttRate = sorted.length > 0 ? Math.round(sorted.reduce((s, d) => s + d.attendance.rate, 0) / sorted.length) : 0;
        const avgScore = sorted.length > 0 ? parseFloat((sorted.reduce((s, d) => s + d.compositeScore, 0) / sorted.length).toFixed(2)) : 0;

        return res.json({
            success: true,
            data: {
                employees: sorted,
                topPerformers: sorted.slice(0, 10),
                stats: {
                    total: allDoctors.length,
                    avgAttendanceRate: avgAttRate,
                    avgCompositeScore: avgScore,
                    highPerformers: sorted.filter((d) => d.compositeScore >= thr.highPerformer).length,
                    lowAttendance: sorted.filter((d) => d.attendance.rate < thr.lowAttendance).length,
                    lowRatingAlerts: sorted.filter((d) => d.riskFlags.includes("low_rating")).length,
                    period: `${targetMonth + 1}/${targetYear}`,
                },
            },
        });
    } catch (err: any) {
        console.error("[Doctor Performance]", err);
        return res.status(500).json({ success: false, message: "Error fetching doctor performance", error: err.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/performance/nurses?month=MM&year=YYYY
// ══════════════════════════════════════════════════════════════════════════════
export const getNursePerformance = async (req: Request, res: Response) => {
    try {
        const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);
        const targetMonth = req.query.month !== undefined ? parseInt(req.query.month as string) : new Date().getMonth();
        const targetYear = req.query.year !== undefined ? parseInt(req.query.year as string) : new Date().getFullYear();
        const { startDate, endDate } = getMonthRange(targetMonth, targetYear);
        const { startDate: prevStart, endDate: prevEnd } = getPrevMonthRange(targetMonth, targetYear);

        const weights = await getWeights(hospitalId, "nurse");
        const w = (weights as any).weights;
        const thr = (weights as any).thresholds;

        const allNurses = await User.find({ hospital: hospitalId, status: "active", role: "nurse" })
            .select("_id name employeeId image createdAt")
            .lean();

        if (allNurses.length === 0) {
            return res.json({ success: true, data: { employees: [], stats: {}, topPerformers: [] } });
        }

        const nurseIds = allNurses.map((n) => n._id);

        const [bulkAtt, bulkPrevAtt, bulkTasks] = await Promise.all([
            Attendance.aggregate([
                { $match: { hospital: hospitalId, user: { $in: nurseIds }, date: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$user", totalDays: { $sum: 1 }, presentDays: { $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] } }, lateDays: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } }, absentDays: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } } } },
            ]),
            Attendance.aggregate([
                { $match: { hospital: hospitalId, user: { $in: nurseIds }, date: { $gte: prevStart, $lte: prevEnd } } },
                { $group: { _id: "$user", totalDays: { $sum: 1 }, presentDays: { $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] } } } },
            ]),
            NursingTask.aggregate([
                { $match: { hospital: hospitalId, nurse: { $in: nurseIds }, createdAt: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$nurse", totalTasks: { $sum: 1 }, completedTasks: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } }, medTasks: { $sum: { $cond: [{ $eq: ["$type", "Medication"] }, 1, 0] } }, completedMedTasks: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "Medication"] }, { $eq: ["$status", "Completed"] }] }, 1, 0] } } } },
            ]),
        ]);

        const attMap = new Map(bulkAtt.map((a) => [a._id.toString(), a]));
        const prevAttMap = new Map(bulkPrevAtt.map((a) => [a._id.toString(), a]));
        let taskMap = new Map(bulkTasks.map((t) => [t._id.toString(), t]));

        // Fallback: if no tasks found linked to specific nurses (nurse field is optional),
        // fetch all hospital tasks and distribute them evenly among nurses.
        if (taskMap.size === 0 && allNurses.length > 0) {
            const allHospitalTasks = await NursingTask.aggregate([
                { $match: { hospital: hospitalId, createdAt: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: null, totalTasks: { $sum: 1 }, completedTasks: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } }, medTasks: { $sum: { $cond: [{ $eq: ["$type", "Medication"] }, 1, 0] } }, completedMedTasks: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "Medication"] }, { $eq: ["$status", "Completed"] }] }, 1, 0] } } } },
            ]);
            if (allHospitalTasks[0] && allHospitalTasks[0].totalTasks > 0) {
                const n = allNurses.length;
                const shared = {
                    totalTasks: Math.round(allHospitalTasks[0].totalTasks / n),
                    completedTasks: Math.round(allHospitalTasks[0].completedTasks / n),
                    medTasks: Math.round(allHospitalTasks[0].medTasks / n),
                    completedMedTasks: Math.round(allHospitalTasks[0].completedMedTasks / n),
                };
                allNurses.forEach((nurse) => taskMap.set(nurse._id.toString(), shared));
            }
        }

        const nurses = allNurses.map((nurse) => {
            const uid = nurse._id.toString();
            const att = attMap.get(uid) || { totalDays: 0, presentDays: 0, lateDays: 0, absentDays: 0 };
            const prevAtt = prevAttMap.get(uid);
            const attendanceRate = att.totalDays > 0 ? Math.round((att.presentDays / att.totalDays) * 100) : 0;
            const prevRate = prevAtt && prevAtt.totalDays > 0 ? Math.round((prevAtt.presentDays / prevAtt.totalDays) * 100) : null;

            const tasks = taskMap.get(uid) || { totalTasks: 0, completedTasks: 0, medTasks: 0, completedMedTasks: 0 };
            const taskCompletionRate = tasks.totalTasks > 0 ? Math.round((tasks.completedTasks / tasks.totalTasks) * 100) : 0;
            const medAccuracy = tasks.medTasks > 0 ? Math.round(((tasks.completedMedTasks || 0) / tasks.medTasks) * 100) : 0;

            const attendanceScore = attendanceRate / 20;
            const qualityScore = (taskCompletionRate / 100) * 5;
            const activityScore = Math.min(5, tasks.completedTasks / 10);

            const compositeScore = parseFloat(
                Math.min(5,
                    attendanceScore * w.attendance +
                    qualityScore * w.quality +
                    activityScore * w.activity
                ).toFixed(2)
            );

            const riskFlags: string[] = [];
            if (attendanceRate < thr.lowAttendance) riskFlags.push("low_attendance");

            return {
                _id: uid,
                name: nurse.name,
                role: "nurse",
                employeeId: nurse.employeeId,
                image: nurse.image,
                attendance: { totalDays: att.totalDays, presentDays: att.presentDays, lateDays: att.lateDays, absentDays: att.absentDays, rate: attendanceRate },
                roleMetrics: { totalTasks: tasks.totalTasks, completedTasks: tasks.completedTasks, taskCompletionRate, medicationTasks: tasks.medTasks, medicationAccuracy: medAccuracy },
                compositeScore,
                riskFlags,
                improvementVsPrevMonth: prevRate !== null && prevRate > 0 ? parseFloat((((attendanceRate - prevRate) / prevRate) * 100).toFixed(1)) : null,
                period: `${targetMonth + 1}/${targetYear}`,
            };
        });

        const sorted = [...nurses].sort((a, b) => b.compositeScore - a.compositeScore);
        sorted.forEach((n, i) => ((n as any).rank = i + 1));

        return res.json({
            success: true,
            data: {
                employees: sorted,
                topPerformers: sorted.slice(0, 5),
                stats: {
                    total: allNurses.length,
                    avgAttendanceRate: sorted.length > 0 ? Math.round(sorted.reduce((s, n) => s + n.attendance.rate, 0) / sorted.length) : 0,
                    avgCompositeScore: sorted.length > 0 ? parseFloat((sorted.reduce((s, n) => s + n.compositeScore, 0) / sorted.length).toFixed(2)) : 0,
                    highPerformers: sorted.filter((n) => n.compositeScore >= thr.highPerformer).length,
                    lowAttendance: sorted.filter((n) => n.attendance.rate < thr.lowAttendance).length,
                    period: `${targetMonth + 1}/${targetYear}`,
                },
            },
        });
    } catch (err: any) {
        console.error("[Nurse Performance]", err);
        return res.status(500).json({ success: false, message: "Error fetching nurse performance", error: err.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/performance/staff?month=MM&year=YYYY
// ══════════════════════════════════════════════════════════════════════════════
export const getStaffPerformance = async (req: Request, res: Response) => {
    try {
        const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);
        const targetMonth = req.query.month !== undefined ? parseInt(req.query.month as string) : new Date().getMonth();
        const targetYear = req.query.year !== undefined ? parseInt(req.query.year as string) : new Date().getFullYear();
        const { startDate, endDate } = getMonthRange(targetMonth, targetYear);
        const { startDate: prevStart, endDate: prevEnd } = getPrevMonthRange(targetMonth, targetYear);

        const weights = await getWeights(hospitalId, "staff");
        const w = (weights as any).weights;
        const thr = (weights as any).thresholds;

        const allStaff = await User.find({ hospital: hospitalId, status: "active", role: "staff" })
            .select("_id name employeeId image createdAt")
            .lean();

        if (allStaff.length === 0) {
            return res.json({ success: true, data: { employees: [], stats: {}, topPerformers: [] } });
        }

        const staffIds = allStaff.map((s) => s._id);
        const supportColl = mongoose.connection.collection("supporttickets");

        const [bulkAtt, bulkPrevAtt, bulkTickets] = await Promise.all([
            Attendance.aggregate([
                { $match: { hospital: hospitalId, user: { $in: staffIds }, date: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$user", totalDays: { $sum: 1 }, presentDays: { $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] } }, lateDays: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } }, absentDays: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } } } },
            ]),
            Attendance.aggregate([
                { $match: { hospital: hospitalId, user: { $in: staffIds }, date: { $gte: prevStart, $lte: prevEnd } } },
                { $group: { _id: "$user", totalDays: { $sum: 1 }, presentDays: { $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] } } } },
            ]),
            supportColl.aggregate([
                { $match: { hospital: hospitalId, assignedTo: { $in: staffIds.map((id) => new mongoose.Types.ObjectId(id.toString())) }, createdAt: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: "$assignedTo", totalTickets: { $sum: 1 }, resolvedTickets: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } },
            ]).toArray(),
        ]);

        const attMap = new Map(bulkAtt.map((a) => [a._id.toString(), a]));
        const prevAttMap = new Map(bulkPrevAtt.map((a) => [a._id.toString(), a]));
        const ticketMap = new Map((bulkTickets as any[]).filter((t) => t._id).map((t) => [t._id.toString(), t]));

        const staffList = allStaff.map((s) => {
            const uid = s._id.toString();
            const att = attMap.get(uid) || { totalDays: 0, presentDays: 0, lateDays: 0, absentDays: 0 };
            const prevAtt = prevAttMap.get(uid);
            const attendanceRate = att.totalDays > 0 ? Math.round((att.presentDays / att.totalDays) * 100) : 0;
            const prevRate = prevAtt && prevAtt.totalDays > 0 ? Math.round((prevAtt.presentDays / prevAtt.totalDays) * 100) : null;

            const tickets = ticketMap.get(uid) || { totalTickets: 0, resolvedTickets: 0 };
            const resolutionRate = tickets.totalTickets > 0 ? Math.round((tickets.resolvedTickets / tickets.totalTickets) * 100) : 0;

            const attendanceScore = attendanceRate / 20;
            const qualityScore = (resolutionRate / 100) * 5;
            const activityScore = Math.min(5, tickets.totalTickets / 5);

            const compositeScore = parseFloat(
                Math.min(5, attendanceScore * w.attendance + qualityScore * w.quality + activityScore * w.activity).toFixed(2)
            );

            const riskFlags: string[] = [];
            if (attendanceRate < thr.lowAttendance) riskFlags.push("low_attendance");

            return {
                _id: uid,
                name: s.name,
                role: "staff",
                employeeId: s.employeeId,
                image: s.image,
                attendance: { totalDays: att.totalDays, presentDays: att.presentDays, lateDays: att.lateDays, absentDays: att.absentDays, rate: attendanceRate },
                roleMetrics: { totalTickets: tickets.totalTickets, resolvedTickets: tickets.resolvedTickets, resolutionRate, dailyThroughput: parseFloat((tickets.totalTickets / 26).toFixed(1)) },
                compositeScore,
                riskFlags,
                improvementVsPrevMonth: prevRate !== null && prevRate > 0 ? parseFloat((((attendanceRate - prevRate) / prevRate) * 100).toFixed(1)) : null,
                period: `${targetMonth + 1}/${targetYear}`,
            };
        });

        const sorted = [...staffList].sort((a, b) => b.compositeScore - a.compositeScore);
        sorted.forEach((s, i) => ((s as any).rank = i + 1));

        return res.json({
            success: true,
            data: {
                employees: sorted,
                topPerformers: sorted.slice(0, 5),
                stats: {
                    total: allStaff.length,
                    avgAttendanceRate: sorted.length > 0 ? Math.round(sorted.reduce((s, e) => s + e.attendance.rate, 0) / sorted.length) : 0,
                    avgCompositeScore: sorted.length > 0 ? parseFloat((sorted.reduce((s, e) => s + e.compositeScore, 0) / sorted.length).toFixed(2)) : 0,
                    highPerformers: sorted.filter((e) => e.compositeScore >= thr.highPerformer).length,
                    lowAttendance: sorted.filter((e) => e.attendance.rate < thr.lowAttendance).length,
                    period: `${targetMonth + 1}/${targetYear}`,
                },
            },
        });
    } catch (err: any) {
        console.error("[Staff Performance]", err);
        return res.status(500).json({ success: false, message: "Error fetching staff performance", error: err.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/performance/trends/:employeeId
// 6-month trend for a single employee
// ══════════════════════════════════════════════════════════════════════════════
export const getEmployeeTrends = async (req: Request, res: Response) => {
    try {
        const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);
        const { employeeId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return res.status(400).json({ success: false, message: "Invalid employeeId" });
        }

        const userId = new mongoose.Types.ObjectId(employeeId);
        const user = await User.findOne({ _id: userId, hospital: hospitalId }).select("name role employeeId image").lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        const today = new Date();
        const trends: any[] = [];

        for (let i = 5; i >= 0; i--) {
            const month = today.getMonth() - i;
            const adjustedMonth = ((month % 12) + 12) % 12;
            const adjustedYear = today.getFullYear() + Math.floor((today.getMonth() - i) / 12);
            const { startDate, endDate } = getMonthRange(adjustedMonth, adjustedYear);

            const att = await calcAttendance(userId, hospitalId, startDate, endDate);

            let compositeScore = att.rate / 20;
            let roleMetrics: any = {};

            if (user.role === "doctor") {
                const dp = await DoctorProfile.findOne({ user: userId }).select("_id specialties").lean();
                if (dp) {
                    const [appts, prx, fb] = await Promise.all([
                        Appointment.countDocuments({ doctor: dp._id, createdAt: { $gte: startDate, $lte: endDate } }),
                        Prescription.countDocuments({ doctor: dp._id, createdAt: { $gte: startDate, $lte: endDate } }),
                        Feedback.aggregate([{ $match: { doctor: dp._id, createdAt: { $gte: startDate, $lte: endDate } } }, { $group: { _id: null, avg: { $avg: "$rating" } } }]),
                    ]);
                    const avgRating = fb[0]?.avg || 0;
                    const weights = await getWeights(hospitalId, "doctor");
                    const wt = (weights as any).weights;
                    compositeScore = Math.min(5,
                        (att.rate / 20) * wt.attendance +
                        avgRating * wt.quality +
                        Math.min(5, appts / 20 + prx / 30) * wt.activity
                    );
                    roleMetrics = { totalAppointments: appts, totalPrescriptions: prx, avgPatientRating: parseFloat(avgRating.toFixed(2)) };
                }
            } else if (user.role === "nurse") {
                const tasks = await NursingTask.aggregate([
                    { $match: { hospital: hospitalId, nurse: userId, createdAt: { $gte: startDate, $lte: endDate } } },
                    { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } } } },
                ]);
                const t = tasks[0] || { total: 0, completed: 0 };
                const weights = await getWeights(hospitalId, "nurse");
                const wt = (weights as any).weights;
                compositeScore = Math.min(5,
                    (att.rate / 20) * wt.attendance +
                    (t.total > 0 ? (t.completed / t.total) : 0) * 5 * wt.quality +
                    Math.min(5, t.completed / 10) * wt.activity
                );
                roleMetrics = { totalTasks: t.total, completedTasks: t.completed };
            }

            trends.push({
                month: adjustedMonth + 1,
                year: adjustedYear,
                label: new Date(adjustedYear, adjustedMonth, 1).toLocaleString("default", { month: "short", year: "numeric" }),
                attendanceRate: att.rate,
                presentDays: att.presentDays,
                totalDays: att.totalDays,
                compositeScore: parseFloat(compositeScore.toFixed(2)),
                ...roleMetrics,
            });
        }

        return res.json({
            success: true,
            data: {
                employee: { _id: user._id, name: user.name, role: user.role, employeeId: user.employeeId, image: user.image },
                trends,
            },
        });
    } catch (err: any) {
        console.error("[Employee Trends]", err);
        return res.status(500).json({ success: false, message: "Error fetching trends", error: err.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/performance/weights
// GET weights for all roles in this hospital
// ══════════════════════════════════════════════════════════════════════════════
export const getPerformanceWeights = async (req: Request, res: Response) => {
    try {
        const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);
        const roles = ["doctor", "nurse", "staff"] as const;
        const results: any = {};
        for (const role of roles) {
            results[role] = await getWeights(hospitalId, role);
        }
        return res.json({ success: true, data: results });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: "Error fetching weights", error: err.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/performance/weights/:role
// HR can update weights dynamically
// ══════════════════════════════════════════════════════════════════════════════
export const updatePerformanceWeights = async (req: Request, res: Response) => {
    try {
        const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);
        const { role } = req.params as { role: "doctor" | "nurse" | "staff" };
        const { weights, thresholds } = req.body;

        if (!["doctor", "nurse", "staff"].includes(role)) {
            return res.status(400).json({ success: false, message: "Invalid role" });
        }

        const updated = await PerformanceWeights.findOneAndUpdate(
            { hospital: hospitalId, role },
            {
                $set: {
                    ...(weights && { weights }),
                    ...(thresholds && { thresholds }),
                    updatedBy: new mongoose.Types.ObjectId((req as any).user.id),
                },
            },
            { new: true, upsert: true, runValidators: true },
        );

        return res.json({ success: true, data: updated, message: `Weights for ${role} updated successfully` });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: "Error updating weights", error: err.message });
    }
};
