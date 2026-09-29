import { Request, Response } from "express";
import DoctorTemplate from "../../Prescription/Models/DoctorTemplate.js";
import DoctorProfile from "../Models/DoctorProfile.js";

// Get all templates for the logged-in doctor
export const getDoctorTemplates = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?._id;
    const doctorProfile = await DoctorProfile.findOne({ user: userId });

    if (!doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    const templates = await DoctorTemplate.find({ doctor: doctorProfile._id }).sort({ createdAt: -1 });
    res.json({ success: true, templates });
  } catch (error: any) {
    console.error("Get doctor templates error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Create a new template
export const createDoctorTemplate = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?._id;
    const doctorProfile = await DoctorProfile.findOne({ user: userId });

    if (!doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    const { shortcut, name, department, diagnosis, chiefComplaints, advice, medicines, suggestedTests } = req.body;

    if (!shortcut || !name) {
      return res.status(400).json({ message: "Shortcut and Name are required" });
    }

    const template = new DoctorTemplate({
      doctor: doctorProfile._id,
      hospital: doctorProfile.hospital,
      shortcut,
      name,
      department,
      diagnosis,
      chiefComplaints,
      advice,
      medicines: medicines || [],
      suggestedTests: suggestedTests || []
    });

    await template.save();
    res.json({ success: true, template });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "A template with this shortcut already exists." });
    }
    console.error("Create doctor template error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a template
export const deleteDoctorTemplate = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?._id;
    const doctorProfile = await DoctorProfile.findOne({ user: userId });

    if (!doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    const template = await DoctorTemplate.findOneAndDelete({ _id: id, doctor: doctorProfile._id });

    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    res.json({ success: true, message: "Template deleted" });
  } catch (error: any) {
    console.error("Delete doctor template error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
