import { Request, Response } from "express";
import Incident from "../Models/Incident.js";
import User from "../../Auth/Models/User.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";

interface IncidentRequest extends Request {
  user?: any;
  files?: Express.Multer.File[];
}

// Create new incident report
export const reportIncident = async (req: IncidentRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Log ALL keys from the body to find hidden spaces or typos
    console.log("Raw req.body keys:", Object.keys(req.body));
    console.log("Raw req.body:", req.body);

    const {
      incidentDate,
      department,
      incidentType,
      severity,
      description,
      patientFallDetails,
      equipmentFailureDetails,
      medicationErrorDetails,
    } = req.body;

    // Log received data for debugging
    console.log("Received incident data:", {
      incidentDate,
      department,
      incidentType,
      severity,
      description: description
        ? `${description.substring(0, 50)}...`
        : undefined,
    });

    // Validate required fields
    if (
      !incidentDate ||
      !department ||
      !incidentType ||
      !severity ||
      !description
    ) {
      return res.status(400).json({
        message: "Missing required fields",
        missing: {
          incidentDate: !incidentDate,
          department: !department,
          incidentType: !incidentType,
          severity: !severity,
          description: !description,
        },
      });
    }

    // Validate incident date is not in the future (with 1 minute tolerance)
    const incidentDateTime = new Date(incidentDate);
    const now = new Date();
    const futureThreshold = new Date(now.getTime() + 60000); // 1 minute tolerance

    console.log("Date validation:", {
      incidentDateTime: incidentDateTime.toISOString(),
      now: now.toISOString(),
      futureThreshold: futureThreshold.toISOString(),
      isFuture: incidentDateTime > futureThreshold,
    });

    if (incidentDateTime > futureThreshold) {
      return res.status(400).json({
        message: "Incident date cannot be in the future",
        receivedDate: incidentDateTime.toISOString(),
        currentDate: now.toISOString(),
      });
    }

    // Parse JSON strings if sent as form data
    const parsedPatientFallDetails =
      typeof patientFallDetails === "string"
        ? JSON.parse(patientFallDetails)
        : patientFallDetails;
    const parsedEquipmentFailureDetails =
      typeof equipmentFailureDetails === "string"
        ? JSON.parse(equipmentFailureDetails)
        : equipmentFailureDetails;
    const parsedMedicationErrorDetails =
      typeof medicationErrorDetails === "string"
        ? JSON.parse(medicationErrorDetails)
        : medicationErrorDetails;

    // Handle file uploads
    const attachments: Array<{
      url: string;
      publicId: string;
      fileName?: string;
    }> = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const publicId = `incident_attachments/${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
        const result = await uploadToCloudinary(file.buffer, {
          public_id: publicId,
          folder: "incident_attachments",
          resource_type: "image",
        });
        attachments.push({
          url: result.secure_url,
          publicId: result.public_id,
          fileName: file.originalname,
        });
      }
    }

    // Generate Incident ID (INC-YYYYMMDD-SERIAL)
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
    const hospitalContextId = req.user?.hospital || (req as any).tenantId;

    const incidentCount = await (
      Incident.countDocuments({
        hospital: hospitalContextId,
        createdAt: {
          $gte: new Date(new Date(today).setHours(0, 0, 0, 0)),
          $lte: new Date(new Date(today).setHours(23, 59, 59, 999)),
        },
      }) as any
    ).unscoped();
    const serial = (incidentCount + 1).toString().padStart(3, "0");
    const incidentId = `INC-${dateStr}-${serial}`;

    const newIncident = new Incident({
      incidentId,
      incidentDate,
      department,
      incidentType,
      severity,
      description,
      reportedBy: userId,
      hospital: req.user?.hospital || (req as any).tenantId,
      patientFallDetails: parsedPatientFallDetails,
      equipmentFailureDetails: parsedEquipmentFailureDetails,
      medicationErrorDetails: parsedMedicationErrorDetails,
      attachments,
    });

    await newIncident.save();

    // Notify Hospital Admin via WebSocket
    const io = (req as any).io;
    if (io) {
      const user = await (User.findById(userId) as any).unscoped();
      if (user && user.hospital) {
        const adminRoom = `hospital_${user.hospital}_hospital-admin`;
        io.to(adminRoom).emit("new_incident", {
          incidentId: newIncident.incidentId,
          type: newIncident.incidentType,
          severity: newIncident.severity,
          message: `New ${newIncident.incidentType} reported by ${user.name}`,
          hasAttachments: attachments.length > 0,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: "Incident reported successfully",
      incident: newIncident,
    });
  } catch (error: any) {
    console.error("Report incident error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all incidents (Role-based filtering)
export const getAllIncidents = async (req: IncidentRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const role = req.user?.role;
    const { startDate, endDate, department, status } = req.query;

    let query: any = {};

    // Role-based scoping
    if (role !== "hospital-admin" && role !== "super-admin") {
      query.reportedBy = userId;
    } else {
      const user = await User.findById(userId);
      if (user && user.hospital) {
        const hospitalUsers = await User.find({
          hospital: user.hospital,
        }).select("_id");
        const userIds = hospitalUsers.map((u) => u._id);
        query.reportedBy = { $in: userIds };
      }
    }

    // Apply dynamic filters
    if (startDate || endDate) {
      query.incidentDate = {};
      if (startDate) query.incidentDate.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        query.incidentDate.$lte = end;
      }
    }

    if (department && department !== "all") {
      query.department = department;
    }

    if (status && status !== "all") {
      query.status = status;
    }

    const incidents = await (Incident.find(query) as any)
      .unscoped()
      .populate({
        path: "reportedBy",
        select: "name role mobile",
        options: { unscoped: true },
      })
      .populate({
        path: "adminResponse.adminId",
        select: "name",
        options: { unscoped: true },
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      incidents,
    });
  } catch (error: any) {
    console.error("Get incidents error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Admin response to incident
export const respondToIncident = async (
  req: IncidentRequest,
  res: Response,
) => {
  try {
    const { incidentId } = req.params;
    const { message, actionTaken, status } = req.body;
    const adminId = req.user?._id;

    if (
      req.user?.role !== "hospital-admin" &&
      req.user?.role !== "super-admin"
    ) {
      return res
        .status(403)
        .json({ message: "Only admins can respond to incidents" });
    }

    let query = {};
    if (incidentId.match(/^[0-9a-fA-F]{24}$/)) {
      query = { _id: incidentId };
    } else {
      query = { incidentId: incidentId };
    }

    const incident = await (
      Incident.findOne({ ...query, hospital: req.user?.hospital }) as any
    ).unscoped();

    if (!incident) {
      return res.status(404).json({ message: "Incident not found" });
    }

    incident.status = status || incident.status;
    incident.adminResponse = {
      adminId,
      message,
      actionTaken,
      respondedAt: new Date(),
    };

    await incident.save();

    const io = (req as any).io;
    if (io) {
      const reporterRoom = `user_${incident.reportedBy}`;
      io.to(reporterRoom).emit("incident_update", {
        incidentId: incident.incidentId,
        status: incident.status,
        message: `Your incident report ${incident.incidentId} has been ${incident.status.toLowerCase()}`,
      });
    }

    res.json({
      success: true,
      message: "Response recorded successfully",
      incident,
    });
  } catch (error: any) {
    console.error("Respond to incident error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
