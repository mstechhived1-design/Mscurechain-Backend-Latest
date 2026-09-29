import { Request, Response } from "express";
import mongoose from "mongoose";
import PharmacyToken from "../Models/PharmacyToken.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import PharmacyOrder from "../Models/PharmacyOrder.js";
import AuditLog from "../Models/AuditLog.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import Bed from "../../IPD/Models/Bed.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import { generatePharmaId } from "../utils/idGenerator.js";
import PharmaProfile from "../Models/PharmaProfile.js";

interface PharmacyTokenRequest extends Request {
  user?: any;
  io?: any;
}

// Create pharmacy token
export const createPharmacyToken = async (
  req: PharmacyTokenRequest,
  res: Response,
) => {
  try {
    const { appointmentId, patientId, medicines, priority, notes, age, gender } = req.body;
    const doctorId = req.user?._id;

    if (!appointmentId && !patientId) {
      return res
        .status(400)
        .json({ message: "Appointment ID or Patient ID is required" });
    }

    if (!medicines || medicines.length === 0) {
      return res
        .status(400)
        .json({ message: "At least one medicine is required" });
    }

    let patient: any, doctor: any, hospital: any;
    let appointment: any = null;

    if (appointmentId) {
      appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }
      patient = appointment.patient;
      doctor = appointment.doctor;
      hospital = appointment.hospital;
    } else {
      // Support for existing patients without active appointment
      patient = patientId;
      const doctorProfile = await DoctorProfile.findOne({ user: doctorId });
      if (!doctorProfile) {
        return res.status(404).json({ message: "Doctor profile not found" });
      }
      doctor = doctorProfile._id;
      hospital = doctorProfile.hospital;
    }

    // Resolve primary pharmacy profile to generate standard prefix
    const pharmaProfile = await PharmaProfile.findOne({ hospital }).lean();
    const pharmaName = pharmaProfile?.businessName || "PHARMA";
    const pharmacyId = pharmaProfile?._id || hospital;

    // Generate Structured Token/Order Number (PREFIX-RAND-SEQ)
    const tokenNumber = await generatePharmaId(pharmacyId, pharmaName, "order");

    const pharmacyToken = new PharmacyToken({
      appointment: appointmentId || undefined,
      patient,
      globalPatientId: patient,
      doctor,
      hospital,
      tokenNumber,
      medicines,
      priority: priority || "routine",
      notes: notes || "",
    });

    await pharmacyToken.save();

    // Calculate total amount
    const totalAmount = medicines.reduce(
      (sum: number, m: any) => sum + (parseFloat(m.price) || 0),
      0,
    );

    // Create Pharmacy Order for Staff View
    const pharmacyOrder = await PharmacyOrder.create({
      patient,
      globalPatientId: patient,
      doctor,
      hospital,
      tokenNumber: tokenNumber,
      patientAge: age ? String(age) : appointment?.patientDetails?.age,
      patientGender: gender ? String(gender) : appointment?.patientDetails?.gender,
      // prescription: Can link if we had a Prescription Object ID from request
      medicines: medicines.map((m: any) => ({
        name: m.name,
        dosage: m.dosage,
        freq: m.freq,
        duration: m.duration,
        quantity: m.quantity,
        price: m.price || 0,
        status: "pending",
      })),
      status: "prescribed",
      totalAmount: totalAmount,
      paymentStatus: "pending",
    });

    // --- Sync Patient Demographics ---
    if (patient && (age || gender)) {
      await Patient.findByIdAndUpdate(patient, {
        $set: {
          ...(age && { age: parseInt(String(age)) }),
          ...(gender && { gender: String(gender).charAt(0).toUpperCase() + String(gender).slice(1).toLowerCase() })
        }
      });
    }

    // Emit Socket Event to Hospital Room
    if (req.io) {
      const hospitalId = hospital?.toString();
      if (hospitalId) {
        // Populate for frontend display
        const populatedOrder = await PharmacyOrder.findById(pharmacyOrder._id)
          .populate("patient", "name age gender mobile")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          });

        const payload = {
          _id: populatedOrder?._id,
          tokenNumber: tokenNumber,
          patientDetails: {
            name: (populatedOrder?.patient as any)?.name || "N/A",
            age:
              (populatedOrder?.patient as any)?.age ||
              (appointment as any)?.patientDetails?.age ||
              0,
            gender:
              (populatedOrder?.patient as any)?.gender ||
              (appointment as any)?.patientDetails?.gender ||
              "N/A",
          },
          doctorName:
            (populatedOrder?.doctor as any)?.user?.name || "Dr. Staff",
          medicinesCount: medicines.length,
          status: "Pending",
          totalAmount: totalAmount,
          receivedAt: new Date(),
          isNew: true,
        };

        req.io.to(`hospital_${hospitalId}`).emit("new_pharmacy_order", payload);
        console.log(`Emitted new_pharmacy_order to hospital_${hospitalId}`);
      }
    }

    res.status(201).json({
      success: true,
      pharmacyToken,
      pharmacyOrder,
      message: "Pharmacy token and order created successfully",
    });
  } catch (error: any) {
    console.error("Create pharmacy token error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get pharmacy token by ID
export const getPharmacyToken = async (
  req: PharmacyTokenRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;

    const pharmacyToken = await PharmacyToken.findById(id)
      .populate("patient", "name mobile email age gender mrn")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      })
      .populate("hospital", "name address")
      .populate("appointment", "date mrn");

    if (!pharmacyToken) {
      return res.status(404).json({ message: "Pharmacy token not found" });
    }

    res.json({
      success: true,
      pharmacyToken,
    });
  } catch (error: any) {
    console.error("Get pharmacy token error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get pharmacy tokens by appointment
export const getPharmacyTokensByAppointment = async (
  req: PharmacyTokenRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;

    const pharmacyTokens = await PharmacyToken.find({
      appointment: appointmentId,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      pharmacyTokens,
    });
  } catch (error: any) {
    console.error("Get pharmacy tokens error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// Get all pharmacy orders for hospital (for pharmacy staff)
export const getHospitalPharmacyOrders = async (
  req: PharmacyTokenRequest,
  res: Response,
) => {
  try {
    const { hospitalId } = req.params;
    const { status } = req.query;

    const query: any = { hospital: hospitalId };
    if (status) {
      query.status = status;
    } else {
      // Show only active orders (prescribed, processing and ready), exclude completed
      query.status = { $in: ["prescribed", "processing", "ready"] };
    }

    const pharmacyOrdersUnenriched = await PharmacyOrder.find(query)
      .populate("patient", "name mobile email age gender")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      })
      .populate({
        path: "prescription",
        populate: { path: "appointment" }
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const pharmacyOrders = await Promise.all(
      pharmacyOrdersUnenriched.map(async (order: any) => {
        // Fallback Logic for demographics
        let age = order.patientAge || order.patient?.age || (order.prescription?.appointment as any)?.patientDetails?.age;
        let gender = order.patientGender || order.patient?.gender || (order.prescription?.appointment as any)?.patientDetails?.gender;

        // Severe Fallback: If still missing, check most recent appointment for this patient
        if ((!age || !gender) && order.patient?._id) {
          const lastAppt = await Appointment.findOne({ patient: order.patient._id })
            .sort({ createdAt: -1 })
            .select("patientDetails")
            .lean();
          if (lastAppt?.patientDetails) {
            if (!age) age = lastAppt.patientDetails.age;
            if (!gender) gender = lastAppt.patientDetails.gender;

            // Self-healing: Update Patient model so it's fixed for next time
            if (age || gender) {
              Patient.findByIdAndUpdate(order.patient._id, {
                $set: {
                  ...(age && !order.patient.age && { age: parseInt(String(age)) }),
                  ...(gender && !order.patient.gender && { gender: String(gender).charAt(0).toUpperCase() + String(gender).slice(1).toLowerCase() })
                }
              }).exec().catch(err => console.error("Self-healing update failed:", err));
            }
          }
        }

        const finalAge = String(age || "");
        const finalGender = String(gender || "");

        if (!order.patient?._id) {
          return {
            ...order,
            isIPD: false,
            patientAge: finalAge,
            patientGender: finalGender,
            patientType: "OPD",
            mrn: "N/A",
            address: "N/A"
          };
        }

        const [activeDoc, patientProfile] = await Promise.all([
          IPDAdmission.findOne({
            patient: order.patient._id,
            hospital: hospitalId,
            status: { $in: ["Active", "Discharge Initiated"] },
          }).select("admissionId status").lean(),
          PatientProfile.findOne({
            user: order.patient._id
          }).select("mrn address").lean()
        ]);

        const patientType = activeDoc ? "IPD" : "OPD";
        const mrn = patientProfile?.mrn || "N/A";
        const address = patientProfile?.address || order.patient?.address || "N/A";

        return {
          ...order,
          isIPD: !!activeDoc,
          admissionId: activeDoc ? activeDoc.admissionId : undefined,
          patientAge: finalAge,
          patientGender: finalGender,
          patientType,
          mrn,
          address
        };
      }),
    );

    res.json({
      success: true,
      pharmacyOrders,
    });
  } catch (error: any) {
    console.error("Get hospital pharmacy orders error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get active pharmacy orders count for hospital
export const getActiveOrdersCount = async (
  req: PharmacyTokenRequest,
  res: Response,
) => {
  try {
    const { hospitalId } = req.params;

    // Count active orders (prescribed, processing, ready - exclude completed)
    const count = await PharmacyOrder.countDocuments({
      hospital: hospitalId,
      status: { $in: ["prescribed", "processing", "ready"] },
      isDeleted: { $ne: true },
    });

    res.json({
      success: true,
      count,
    });
  } catch (error: any) {
    console.error("Get active orders count error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get single pharmacy order
export const getPharmacyOrder = async (
  req: PharmacyTokenRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;
    let pharmacyOrder = await PharmacyOrder.findById(id)
      .populate("patient", "name mobile email age gender address")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      })
      .populate("admission");

    if (!pharmacyOrder && mongoose.Types.ObjectId.isValid(id)) {
      pharmacyOrder = await PharmacyOrder.findOne({ prescription: id })
        .populate("patient", "name mobile email age gender address")
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
        })
        .populate("admission");
    }

    if (!pharmacyOrder) {
      return res.status(404).json({ message: "Pharmacy order not found" });
    }

    // Fetch patient profile for MRN and Address
    let mrn = "";
    let profileAddress = "";
    if (pharmacyOrder.patient) {
      const patientProfile = await mongoose.model("PatientProfile").findOne({
        user: (pharmacyOrder.patient as any)._id,
        hospital: pharmacyOrder.hospital
      }).select("mrn address");
      if (patientProfile) {
        mrn = patientProfile.mrn || "";
        profileAddress = patientProfile.address || "";
      }
    }

    // Enrich with up-to-date product prices and bed/ward info
    let enrichedOrder: any = pharmacyOrder.toObject();
    enrichedOrder.mrn = mrn;
    enrichedOrder.patientType = pharmacyOrder.admission ? "IPD" : "OPD";
    if (enrichedOrder.patient) {
      enrichedOrder.patient.address = enrichedOrder.patient.address || profileAddress || "Address not provided";
    }

    // Enrich medicines with up-to-date prices from inventory
    if (enrichedOrder.medicines && enrichedOrder.medicines.length > 0) {
      const productIds = enrichedOrder.medicines
        .filter((m: any) => m.productId)
        .map((m: any) => m.productId);

      if (productIds.length > 0) {
        const products = await mongoose
          .model("Product")
          .find({ _id: { $in: productIds } })
          .lean();
        const productMap = new Map(
          products.map((p: any) => [p._id.toString(), p]),
        );

        enrichedOrder.medicines = enrichedOrder.medicines.map((m: any) => {
          if (m.productId && productMap.has(m.productId.toString())) {
            const product = productMap.get(m.productId.toString());
            return {
              ...m,
              price: product.mrp || m.price,
            };
          }
          return m;
        });
      }
    }

    if (pharmacyOrder.admission) {
      const admission = pharmacyOrder.admission as any;

      const occupancy = await mongoose
        .model("BedOccupancy")
        .findOne({
          admission: admission._id,
          endDate: null,
        })
        .lean();

      if (occupancy && (occupancy as any).bed) {
        const bed = await Bed.findById((occupancy as any).bed).lean();
        if (bed) {
          const admissionObj = admission.toObject
            ? admission.toObject()
            : admission;
          enrichedOrder.admission = {
            ...admissionObj,
            admissionId: admissionObj.admissionId || admissionObj._id, // Fallback to _id if needed
            bedDetails: {
              bedId: bed.bedId,
              wardType: bed.type,
              wardName: bed.ward,
              room: bed.room,
              department: bed.department,
            },
          };
        }
      }

      // ✅ BED HISTORY: Fetch all previous room/bed transfers for this admission
      const bedHistoryRecords = await (mongoose.model("BedOccupancy").find({
        admission: admission._id,
      }) as any)
        .unscoped()
        .sort({ startDate: 1 })
        .populate({
            path: "bed",
            select: "bedId room type dailyRateAtTime pricePerDay pricePerHalfDay pricePerHour",
            options: { unscoped: true } as any
        })
        .lean();

      enrichedOrder.admission.bedHistory = bedHistoryRecords.map((occ: any) => ({
        bedId: occ.bed?.bedId || "Unknown",
        room: occ.bed?.room || "General",
        type: occ.bed?.type || "Standard",
        startDate: occ.startDate,
        endDate: occ.endDate,
        pricePerDay: occ.dailyRateAtTime || occ.bed?.pricePerDay || 0,
        pricePerHalfDay: occ.halfDayRateAtTime !== undefined ? occ.halfDayRateAtTime : (occ.bed?.pricePerHalfDay !== undefined ? occ.bed.pricePerHalfDay : Math.round((occ.dailyRateAtTime || occ.bed?.pricePerDay || 0) / 2)),
        pricePerHour: occ.hourlyRateAtTime !== undefined ? occ.hourlyRateAtTime : (occ.bed?.pricePerHour !== undefined ? occ.bed.pricePerHour : Math.round((occ.dailyRateAtTime || occ.bed?.pricePerDay || 0) / 24)),
      }));
    }

    res.json({
      success: true,
      pharmacyOrder: enrichedOrder,
    });
  } catch (error: any) {
    console.error("Get pharmacy order error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete pharmacy order (soft delete with audit log)
export const deletePharmacyOrder = async (
  req: PharmacyTokenRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const pharmacyOrder = await PharmacyOrder.findById(id)
      .populate("patient", "name")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      });

    if (!pharmacyOrder) {
      return res.status(404).json({ message: "Pharmacy order not found" });
    }

    if (pharmacyOrder.isDeleted) {
      return res.status(400).json({ message: "Order is already deleted" });
    }

    // Soft delete
    pharmacyOrder.isDeleted = true;
    pharmacyOrder.deletedAt = new Date();
    pharmacyOrder.deletedBy = userId;
    await pharmacyOrder.save();

    // Create audit log entry
    const patientName =
      (pharmacyOrder.patient as any)?.name || "Unknown Patient";
    const doctorName =
      (pharmacyOrder.doctor as any)?.user?.name || "Unknown Doctor";

    await AuditLog.create({
      pharmacy: req.user?.pharmacy || req.user?.id,
      hospital: pharmacyOrder.hospital,
      action: "DELETE",
      entityType: "PharmacyOrder",
      entityId: pharmacyOrder._id,
      performedBy: userId,
      description: `Deleted pharmacy order ${pharmacyOrder.tokenNumber} for patient ${patientName} prescribed by ${doctorName}`,
      metadata: {
        tokenNumber: pharmacyOrder.tokenNumber,
        patientName: patientName,
        doctorName: doctorName,
        medicineCount: pharmacyOrder.medicines.length,
        totalAmount: pharmacyOrder.totalAmount,
        deletedReason: "Manual deletion by pharmacy staff",
      },
    });

    res.json({
      success: true,
      message: "Order deleted successfully and logged in audit trail",
    });
  } catch (error: any) {
    console.error("Delete pharmacy order error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
