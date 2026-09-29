import { Request, Response } from "express";
import nurseService from "../../services/nurse.service.js";
import redisService from "../../config/redis.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import User from "../../Auth/Models/User.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Bed from "../../IPD/Models/Bed.js";
import NursingTask from "../Models/NursingTask.js";
import Prescription from "../../Prescription/Models/Prescription.js";

// ---------------------------------------------------------------------------
// Native date helpers (replaces moment dependency)
// ---------------------------------------------------------------------------
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
// ---------------------------------------------------------------------------

export const getNurseStats = async (req: any, res: Response) => {
  try {
    const hospitalId = req.user?.hospital || req.query.hospitalId;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID is required" });
    }

    // Check for specific nurse department
    let departmentFilter: string | undefined = undefined;
    if (req.user?.role === "nurse") {
      const staffProfile = await StaffProfile.findOne({ user: req.user._id });
      if (staffProfile && staffProfile.department) {
        departmentFilter = Array.isArray(staffProfile.department)
          ? staffProfile.department[0]
          : staffProfile.department;
      }
    }

    const cacheKey = `nurse:stats:${hospitalId}:${departmentFilter || "all"}`;

    // Try to get from cache
    const cachedStats = await redisService.get(cacheKey);
    if (cachedStats) {
      return res.json({ success: true, stats: cachedStats, fromCache: true });
    }

    const stats = await nurseService.getDashboardStats(
      hospitalId,
      departmentFilter,
    );

    // Cache for 5 minutes (300 seconds)
    await redisService.set(cacheKey, stats, 300);

    res.json({ success: true, stats });
  } catch (err: any) {
    console.error("Get nurse stats error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const getNursePatients = async (req: any, res: Response) => {
  try {
    const hospitalId = req.user?.hospital;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get Nurse Department for Filtering
    let departmentFilter: string[] = [];
    if (req.user?.role === "nurse") {
      const staffProfile = await StaffProfile.findOne({ user: req.user._id });
      if (staffProfile && staffProfile.department) {
        if (Array.isArray(staffProfile.department)) {
          departmentFilter = staffProfile.department;
        } else if (typeof staffProfile.department === "string") {
          // Legacy support for comma-separated string
          departmentFilter = (staffProfile.department as string)
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean);
        }
      }
    }

    const admissions = await IPDAdmission.find({
      hospital: hospitalId,
      status: "Active",
    })
      .populate({ path: "patient", select: "name mobile gender dateOfBirth" })
      .populate({
        path: "primaryDoctor",
        populate: { path: "user", select: "name" },
      })
      .sort({ admissionDate: -1 });

    // Fetch Bed details from standalone collection
    const beds = await Bed.find({ hospital: hospitalId }).lean();
    const bedMap = new Map();
    beds.forEach((b: any) => {
      bedMap.set(b._id.toString(), b);
    });

    // Filter results in-memory to handle Department matching via Bed Occupancy
    const filteredResults = (
      await Promise.all(
        admissions.map(async (adm: any) => {
          const occupancy = await BedOccupancy.findOne({
            admission: adm._id,
            endDate: { $exists: false },
          }); // Removed .populate("bed")

          // Resolve Bed Details
          let bed: any = null;
          if (occupancy && occupancy.bed) {
            bed = bedMap.get(occupancy.bed.toString());
          }

          // Skip if no bed assigned
          if (!bed) return null;

          // Apply Department Filter if Nurse has one assigned
          // Updated to check bed.type OR bed.department as "Department" field on nurse may refer to Room Type
          if (departmentFilter.length > 0) {
            // Regex match for flexibility
            const escapedDepts = departmentFilter.map((d) =>
              d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            );
            const regexPattern = escapedDepts.join("|");
            const deptRegex = new RegExp(regexPattern, "i");

            const matchesType = bed.type && deptRegex.test(bed.type);
            const matchesDept =
              bed.department && deptRegex.test(bed.department);

            if (!matchesType && !matchesDept) {
              return null;
            }
          }

          return {
            ...adm.toObject(),
            bed: bed,
          };
        }),
      )
    ).filter((item) => item !== null);

    // Apply Pagination to the filtered set
    const total = filteredResults.length;
    const paginatedData = filteredResults.slice(skip, skip + limit);

    res.json({
      success: true,
      data: paginatedData,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const getNurseTasks = async (req: any, res: Response) => {
  try {
    const hospitalId = req.user?.hospital;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const { status, priority, date } = req.query;

    // Default to today if no date provided
    const targetDate = date ? new Date(date as string) : new Date();
    const startOfDayDate = startOfDay(targetDate);
    const endOfDayDate = endOfDay(targetDate);

    const query: any = {
      hospital: hospitalId,
      dueDate: { $gte: startOfDayDate, $lte: endOfDayDate },
    };

    if (status) {
      const s = status.toString().toLowerCase();
      if (s === "completed") query.status = "Completed";
      else if (s === "pending") query.status = "Pending";
      else if (s === "in-progress" || s === "in progress")
        query.status = "In Progress";
      else if (s === "cancelled") query.status = "Cancelled";
      else query.status = status;
    }

    if (priority) {
      const p = priority.toString().toLowerCase();
      if (p === "low") query.priority = "Low";
      else if (p === "medium") query.priority = "Medium";
      else if (p === "high") query.priority = "High";
      else if (p === "critical") query.priority = "Critical";
      else query.priority = priority;
    }

    // 1. Fetch existing tasks from DB
    let [tasks, total] = await Promise.all([
      NursingTask.find(query)
        .populate("patient", "name mobile gender dateOfBirth")
        .populate("admission", "admissionId")
        .sort({ dueDate: 1 })
        .skip(skip)
        .limit(limit),
      NursingTask.countDocuments(query),
    ]);

    // 2. If it's TODAY, ensure each active admission has daily tasks
    const isToday = isSameDay(new Date(), targetDate);
    if (isToday && !status && !priority && hospitalId) {
      const activeAdmissions = await IPDAdmission.find({
        hospital: hospitalId,
        status: "Active",
      }).populate("patient", "name mobile gender dateOfBirth");

      const generatedTasks: any[] = [];

      for (const adm of activeAdmissions) {
        // Safety check: skip if patient record is missing or not populated
        if (!adm.patient) continue;

        // Extract patient info safely
        const patientObj = adm.patient as any;
        const patientName = patientObj.name || "Unknown Patient";
        const patientId = patientObj._id || adm.patient; // adm.patient is the ID if not populated

        // Check if THIS admission already has tasks for TODAY in the DB
        // We check for "Vitals" type as a marker for default tasks
        const existingCount = await NursingTask.countDocuments({
          admission: adm._id,
          hospital: hospitalId,
          type: "Vitals",
          dueDate: { $gte: startOfDayDate, $lte: endOfDayDate },
        });

        if (existingCount > 0) continue; // Skip as tasks already exist for this admission today

        // A. Vitals Check Task
        generatedTasks.push({
          hospital: hospitalId,
          admission: adm._id,
          patient: patientId,
          title: `Vitals Check - ${patientName}`,
          description: "Record daily vitals (BP, Pulse, Temp, SpO2)",
          type: "Vitals",
          priority: "Medium",
          dueDate: startOfDayDate, // Consistent with query
          status: "Pending",
        });

        // B. Clinical Notes Task
        generatedTasks.push({
          hospital: hospitalId,
          admission: adm._id,
          patient: patientId,
          title: `Daily Progress Note - ${patientName}`,
          description: "Update medical history and clinical progress",
          type: "Clinical Notes",
          priority: "Low",
          dueDate: startOfDayDate,
          status: "Pending",
        });

        // C. Medication Tasks from Prescriptions
        const prescriptions = await Prescription.find({
          admission: adm._id,
          hospital: hospitalId,
        })
          .sort({ createdAt: -1 })
          .limit(1);

        if (prescriptions.length > 0) {
          const prx = prescriptions[0];
          if (prx && prx.medicines && Array.isArray(prx.medicines)) {
            for (const med of prx.medicines) {
              if (!med || !med.name) continue;
              generatedTasks.push({
                hospital: hospitalId,
                admission: adm._id,
                patient: patientId,
                title: `Administer ${med.name}`,
                description: `Dose: ${med.dosage || "N/A"}, Frequency: ${med.frequency || "N/A"}, Instructions: ${med.instructions || "None"}`,
                type: "Medication",
                priority: "High",
                dueDate: startOfDayDate,
                status: "Pending",
              });
            }
          }
        }
      }

      if (generatedTasks.length > 0) {
        console.log(
          `[NurseTasks] Inserting ${generatedTasks.length} new generated tasks for Hospital: ${hospitalId}`,
        );
        // Bulk insert generated tasks
        await NursingTask.insertMany(generatedTasks);

        // Re-fetch to get populated fields for the response
        [tasks, total] = await Promise.all([
          NursingTask.find(query)
            .populate("patient", "name mobile gender dateOfBirth")
            .populate("admission", "admissionId")
            .sort({ dueDate: 1 })
            .skip(skip)
            .limit(limit),
          NursingTask.countDocuments(query),
        ]);
      }
    }

    res.json({
      success: true,
      data: tasks,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      isHistorical: !isToday,
    });
  } catch (err: any) {
    console.error("Get nurse tasks error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const updateNurseTask = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const hospitalId = req.user?.hospital;
    const userId = req.user?._id;

    const task = await NursingTask.findOne({ _id: id, hospital: hospitalId });
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Today-only modification rule
    const taskDate = new Date(task.dueDate);
    const isToday = isSameDay(new Date(), taskDate);
    if (!isToday) {
      return res.status(403).json({
        message:
          "Historical tasks cannot be modified. You can only update tasks for today.",
      });
    }

    // Robust status handling: Normalize to PascalCase to match Mongoose enum
    let normalizedStatus = status;
    if (status) {
      const s = status.toLowerCase();
      if (s === "completed") normalizedStatus = "Completed";
      else if (s === "pending") normalizedStatus = "Pending";
      else if (s === "in-progress" || s === "in progress")
        normalizedStatus = "In Progress";
      else if (s === "cancelled") normalizedStatus = "Cancelled";
    }

    task.status = normalizedStatus;
    if (notes) task.notes = notes;

    if (normalizedStatus === "Completed") {
      task.completedAt = new Date();
      task.completedBy = userId;
    } else {
      // If rolling back to pending, clear completion info
      task.completedAt = undefined;
      task.completedBy = undefined;
    }

    await task.save();

    res.json({
      success: true,
      message: "Task updated successfully",
      task,
    });
  } catch (err: any) {
    console.error("Update nurse task error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
