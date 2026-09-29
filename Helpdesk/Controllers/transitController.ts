import { Request, Response } from "express";
import Appointment from "../../Appointment/Models/Appointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import LabToken from "../../Lab/Models/LabToken.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import User from "../../Auth/Models/User.js";
import { mapOrderToSample } from "../../Lab/Controllers/labController.js";

interface TransitRequest extends Request {
  user?: any;
  hospitalId?: any;
}

// Get all transits for a hospital (for helpdesk)
export const getHospitalTransits = async (
  req: TransitRequest,
  res: Response,
) => {
  try {
    const user = req.user;
    const hospitalId = req.hospitalId || user?.hospital;
    const { page = 1, limit = 10, search, type } = req.query;

    console.log("--- Get Hospital Transits Request ---");
    console.log("Query:", req.query);
    console.log("User Hospital:", hospitalId);

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID not found" });
    }

    // CRITICAL ZERO-MISS RULE:
    // We MUST fetch all non-cancelled appointments (status: { $ne: "cancelled" }).
    // NEVER restrict status to strictly "completed", because if a doctor writes a Prescription,
    // Lab Token, or Lab Order while the appointment is "in-progress" or forgets to click Complete,
    // restricting by "completed" will cause those files to be hidden and missed by Helpdesk.
    // 1. Fetch potential appointments (Not Collected, Not Cancelled)
    const candidateAppointments = await (
      Appointment.find({
        hospital: hospitalId,
        status: { $ne: "cancelled" },
        documentsCollected: { $ne: true },
      }) as any
    )
      .unscoped()
      .populate("patient", "name mobile email mrn age gender")
      .populate({
        path: "doctor",
        select: "user specialties signature",
        populate: { path: "user", select: "name" },
      })
      .sort({ sentToHelpdeskAt: -1, updatedAt: -1 })
      .lean()
      .exec();

    console.log(
      `Found ${candidateAppointments.length} candidate appointments (completed, not collected)`,
    );

    // 2. Hydrate with Documents (Reverse Lookup Strategy)
    const fullTransits = await Promise.all(
      candidateAppointments.map(async (apt: any) => {
        const [prescriptions, labTokens] = await Promise.all([
          (Prescription.find({ appointment: apt._id }) as any)
            .unscoped()
            .lean()
            .exec(),
          (LabToken.find({ appointment: apt._id }) as any)
            .unscoped()
            .lean()
            .exec()
        ]);

        let labOrders: any[] = [];
        if (prescriptions.length > 0) {
            labOrders = await (LabOrder.find({
                prescription: { $in: prescriptions.map((p: any) => p._id) }
            }) as any)
            .unscoped()
            .populate("tests.test")
            .populate("patient")
            .lean()
            .exec();
        }

        // If LabOrder wasn't found by prescription, try by tokenNumber
        if (labOrders.length === 0 && labTokens.length > 0) {
            const tokenNumbers = labTokens.map((t: any) => t.tokenNumber).filter(Boolean);
            if (tokenNumbers.length > 0) {
                const ordersByToken = await (LabOrder.find({ tokenNumber: { $in: tokenNumbers } }) as any)
                    .unscoped()
                    .populate("tests.test")
                    .populate("patient")
                    .lean()
                    .exec();
                labOrders.push(...ordersByToken);
            }
        }

        const hasPrescription = prescriptions.length > 0;
        const hasLabToken = labTokens.length > 0;
        const hasLabSample = labOrders.length > 0;

        // Flatten formatting
        const doctorProfile: any = apt.doctor;
        const doctorUser = doctorProfile?.user;
        const patient: any = apt.patient;

        return {
          _id: apt._id,
          appointmentId: apt.appointmentId || apt._id,

          patientName: patient?.name || "Unknown",
          patientMobile: patient?.mobile,
          patientMRN: patient?.mrn || apt.mrn || "N/A",
          patientAge: apt.patientDetails?.age || patient?.age || "-",
          patientGender: apt.patientDetails?.gender || patient?.gender || "-",

          doctorName:
            doctorUser?.name ||
            (doctorProfile as any)?.name ||
            "Unknown Doctor",
          doctorSpecialization:
            doctorProfile?.specialties?.[0] ||
            (doctorProfile as any)?.specialization ||
            "General Physician",
          doctorSignature: doctorProfile?.signature,

          createdAt: apt.createdAt,
          completedAt: apt.consultationEndTime || apt.updatedAt,

          // Attach the actual documents (use first one if multiple)
          prescription: hasPrescription ? prescriptions[0] : null,
          labToken: hasLabToken ? labTokens[0] : null,
          labSample: hasLabSample ? mapOrderToSample(labOrders[0]) : null,

          hasDocuments: hasPrescription || hasLabToken || hasLabSample,
        };
      }),
    );

    // 3. Filter Logic (In-Memory)
    let filtered = fullTransits.filter((t) => t.hasDocuments);
    console.log(`Transits with documents: ${filtered.length}`);

    // Filter by Type
    const typeStr = (type as string)?.toLowerCase().trim();
    if (typeStr && typeStr !== "all") {
      console.log(`Filtering by type: ${typeStr}`);
      filtered = filtered.filter((t) => {
        if (typeStr === "prescription") return !!t.prescription;
        if (typeStr === "lab") return !!t.labToken;
        if (typeStr === "lab-report" || typeStr === "lab_report") return !!t.labSample;
        return true;
      });
    }
    console.log(`After Type Filter: ${filtered.length}`);

    // Filter by Search
    if (search) {
      const term = (search as string).toLowerCase().trim();
      console.log(`Filtering by search: ${term}`);
      filtered = filtered.filter(
        (t) =>
          t.patientName.toLowerCase().includes(term) ||
          t.patientMRN.toLowerCase().includes(term) ||
          (t.appointmentId &&
            t.appointmentId.toString().toLowerCase().includes(term)),
      );
    }
    console.log(`After Search Filter: ${filtered.length}`);

    // 4. Pagination (In-Memory)
    const total = filtered.length;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = filtered.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      transits: paginated,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Get hospital transits error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Mark transit as collected
export const markTransitCollected = async (
  req: TransitRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;

    const appointment = await (Appointment.findById(appointmentId) as any)
      .unscoped()
      .exec();
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    appointment.documentsCollected = true;
    appointment.documentsCollectedAt = new Date();
    await appointment.save();

    res.json({
      success: true,
      message: "Transit marked as collected",
    });
  } catch (error: any) {
    console.error("Mark transit collected error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
