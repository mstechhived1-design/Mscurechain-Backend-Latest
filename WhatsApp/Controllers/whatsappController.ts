import { Request, Response } from "express";
import whatsappManager from "../Services/whatsappManager.js";
import WhatsAppConfig from "../Models/WhatsAppConfig.js";

// Utility to extract hospitalId. In MsCurechain it might be in req.user, req.headers, or params.
// We'll assume it's passed dynamically or resolved by a middleware
const getHospitalId = (req: Request): string => {
  return req.params.hospitalId || (req as any).user?.hospitalId || req.headers["x-hospital-id"] as string;
};

const resolveInstanceKey = async (hospitalId: string, department?: string): Promise<{ instanceKey: string; isDedicated: boolean; deptName?: string }> => {
  if (!department) return { instanceKey: hospitalId, isDedicated: false };
  try {
    const config = await WhatsAppConfig.findOne({ hospitalId }).lean();
    const deptRoute = (config?.departmentRouting as any)?.[department];
    if (deptRoute?.enabled) {
      return { instanceKey: `${hospitalId}_${department}`, isDedicated: true, deptName: deptRoute.name };
    }
  } catch (e) {}
  return { instanceKey: hospitalId, isDedicated: false };
};

export const getStatus = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const department = (req.query?.department || req.body?.department || req.headers?.["x-department"]) as string;
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

    const config = await WhatsAppConfig.findOne({ hospitalId }).lean();
    const defaultRouting = {
      pharma: { enabled: false, phoneNumber: "", name: "Pharmacy Portal" },
      lab: { enabled: false, phoneNumber: "", name: "Laboratory Portal" },
      frontdesk: { enabled: false, phoneNumber: "", name: "Front Desk / Helpdesk" },
      doctor: { enabled: false, phoneNumber: "", name: "Doctor Terminal" },
    };

    const routing = config?.departmentRouting || defaultRouting;

    // If querying specifically for a department's status (e.g. from their portal profile page)
    if (department) {
      const isEnabled = Boolean((routing as any)?.[department]?.enabled);
      if (!isEnabled) {
        return res.json({
          success: true,
          status: "DEFAULT_HOSPITAL_GATEWAY",
          dedicatedEnabled: false,
          department,
          departmentName: (routing as any)?.[department]?.name || department,
          hospitalMainNumber: config?.connectedNumber,
          connectedNumber: config?.connectedNumber,
          message: "Dedicated WhatsApp scanner is currently disabled by Hospital Admin. All notifications automatically use the Hospital Main Gateway.",
        });
      }

      // Department has dedicated routing enabled -> return dedicated Baileys instance status
      const deptService = whatsappManager.getInstance(`${hospitalId}_${department}`, `${(routing as any)?.[department]?.name || department}`);
      const deptStatus = deptService.getStatus();
      return res.json({
        success: true,
        ...deptStatus,
        dedicatedEnabled: true,
        department,
        departmentName: (routing as any)?.[department]?.name || department,
        hospitalMainNumber: config?.connectedNumber,
      });
    }

    // Default: Hospital Admin view
    const waService = whatsappManager.getInstance(hospitalId);
    const status = waService.getStatus();

    res.json({
      success: true,
      ...status,
      templates: config?.templates || {},
      departmentRouting: routing,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const requestPairingCode = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const { phone, department } = req.body || {};
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });
    if (!phone) return res.status(400).json({ error: "phone required" });

    const { instanceKey, deptName } = await resolveInstanceKey(hospitalId, department);
    const waService = whatsappManager.getInstance(instanceKey, deptName);
    const result = await waService.requestPairingCode(phone);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const refreshQR = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const department = (req.body?.department || req.query?.department) as string;
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

    const { instanceKey, deptName } = await resolveInstanceKey(hospitalId, department);
    const waService = whatsappManager.getInstance(instanceKey, deptName);
    const result = await waService.refreshQR();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const department = (req.body?.department || req.query?.department) as string;
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

    const { instanceKey, deptName } = await resolveInstanceKey(hospitalId, department);
    const waService = whatsappManager.getInstance(instanceKey, deptName);
    const result = await waService.logout();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateTemplates = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const { templates } = req.body;
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

    const config = await WhatsAppConfig.findOneAndUpdate(
      { hospitalId },
      { $set: { templates } },
      { new: true, upsert: true }
    );
    res.json({ success: true, templates: config.templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateDepartmentRouting = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const { departmentRouting } = req.body || {};
    if (!hospitalId) return res.status(400).json({ success: false, error: "hospitalId required" });
    if (!departmentRouting || typeof departmentRouting !== "object") {
      return res.status(400).json({ success: false, error: "departmentRouting object required" });
    }

    // Strict validation:
    // If a department is enabled, validate that its phoneNumber is a valid 10-digit number
    const sanitizedRouting: Record<string, any> = {};

    for (const [deptKey, deptData] of Object.entries(departmentRouting)) {
      if (!deptData || typeof deptData !== "object") continue;
      const data = deptData as any;
      const isEnabled = Boolean(data.enabled);
      let rawPhone = String(data.phoneNumber || "").replace(/[^0-9]/g, "");
      if (rawPhone.length === 12 && rawPhone.startsWith("91")) {
        rawPhone = rawPhone.slice(2);
      }

      if (rawPhone && rawPhone.length !== 10) {
        return res.status(400).json({
          success: false,
          error: `Validation failed: ${data.name || deptKey} WhatsApp number must be exactly 10 digits.`,
          deptKey,
        });
      }

      sanitizedRouting[deptKey] = {
        enabled: isEnabled,
        phoneNumber: rawPhone,
        name: data.name || deptKey,
      };
    }

    const config = await WhatsAppConfig.findOneAndUpdate(
      { hospitalId },
      { $set: { departmentRouting: sanitizedRouting } },
      { new: true, upsert: true }
    );

    res.json({ success: true, departmentRouting: config.departmentRouting });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getDepartmentDetectedNumbers = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    if (!hospitalId) return res.status(400).json({ success: false, error: "hospitalId required" });

    const detected: Record<string, string> = {
      pharma: "",
      lab: "",
      frontdesk: "",
      doctor: "",
    };

    // 1. Hospital Frontdesk / Main number
    try {
      const Hospital = (await import("../../Hospital/Models/Hospital.js")).default;
      const hosp = await Hospital.findOne({
        $or: [{ _id: hospitalId }, { hospitalId: hospitalId }]
      }).lean();
      if (hosp?.phone) {
        let p = String(hosp.phone).replace(/[^0-9]/g, "");
        if (p.length === 12 && p.startsWith("91")) p = p.slice(2);
        detected.frontdesk = p.slice(-10);
      }
    } catch (e) {}

    // 2. Lab Settings Phone
    try {
      const LabSettings = (await import("../../Lab/Models/LabSettings.js")).default;
      const lab = await LabSettings.findOne({ hospital: hospitalId }).lean();
      if (lab?.phone) {
        let p = String(lab.phone).replace(/[^0-9]/g, "");
        if (p.length === 12 && p.startsWith("91")) p = p.slice(2);
        detected.lab = p.slice(-10);
      }
    } catch (e) {}

    // 3. Pharma Profile Phone
    try {
      const PharmaProfile = (await import("../../Pharmacy/Models/PharmaProfile.js")).default;
      const pharma = await PharmaProfile.findOne({ hospital: hospitalId }).lean();
      if (pharma?.phone) {
        let p = String(pharma.phone).replace(/[^0-9]/g, "");
        if (p.length === 12 && p.startsWith("91")) p = p.slice(2);
        detected.pharma = p.slice(-10);
      }
    } catch (e) {}

    // 4. Doctor Phone (first active doctor in this hospital)
    try {
      const User = (await import("../../Auth/Models/User.js")).default;
      const docUser = await User.findOne({ hospital: hospitalId, role: "doctor", mobile: { $exists: true, $ne: "" } }).lean();
      if (docUser?.mobile) {
        let p = String(docUser.mobile).replace(/[^0-9]/g, "");
        if (p.length === 12 && p.startsWith("91")) p = p.slice(2);
        detected.doctor = p.slice(-10);
      }
    } catch (e) {}

    res.json({ success: true, detected });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const sendMedia = async (req: Request, res: Response) => {
  const hospitalId = getHospitalId(req);
  try {
    const { phone, pdfBase64, imageBase64, caption, fileName, department } = req.body || {};
    
    if (!hospitalId) return res.status(400).json({ success: false, error: "hospitalId required" });
    if (!phone) return res.status(400).json({ success: false, error: "phone required" });
    if (!pdfBase64 && !imageBase64) return res.status(400).json({ success: false, error: "pdfBase64 or imageBase64 required" });

    // Resolve which WhatsApp instance to dispatch from:
    // If department has dedicated routing ON and is CONNECTED, use dedicated instance!
    // Otherwise fallback safely to main hospital admin instance.
    let waService = whatsappManager.getInstance(hospitalId);
    let usedDedicated = false;
    let finalCaption = caption || '';
    let routingSenderNote = '';

    if (department) {
      const config = await WhatsAppConfig.findOne({ hospitalId }).lean();
      const deptRoute = (config?.departmentRouting as any)?.[department];
      if (deptRoute?.enabled) {
        const deptService = whatsappManager.getInstance(`${hospitalId}_${department}`, deptRoute.name);
        if (deptService.status === "CONNECTED") {
          waService = deptService;
          usedDedicated = true;
        } else if (deptRoute.phoneNumber) {
          routingSenderNote = `\n\n━━━━━━━━━━━━━━━━━━\n*Dispatched from Dedicated ${deptRoute.name || department.toUpperCase()} Line: +91 ${deptRoute.phoneNumber}*`;
        }
      }
    }
    
    if (routingSenderNote && !finalCaption.includes(routingSenderNote.trim())) {
      finalCaption = finalCaption + routingSenderNote;
    }

    await waService.sendMedia(phone, { pdfBase64, imageBase64, caption: finalCaption, fileName });
    res.json({ success: true, message: "Media sent successfully", usedDedicated });
  } catch (error: any) {
    console.error(`[WhatsApp sendMedia Error - ${hospitalId}]:`, error);
    const errorMsg =
      error?.output?.payload?.message ||
      error?.message ||
      (typeof error === 'string' ? error : '') ||
      'Failed to send WhatsApp media';
    res.status(500).json({ success: false, error: errorMsg });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  const hospitalId = getHospitalId(req);
  try {
    const { phone, message, department } = req.body || {};
    
    if (!hospitalId) return res.status(400).json({ success: false, error: "hospitalId required" });
    if (!phone) return res.status(400).json({ success: false, error: "phone required" });
    if (!message) return res.status(400).json({ success: false, error: "message required" });

    let finalMessage = message;
    let waService = whatsappManager.getInstance(hospitalId);
    let usedDedicated = false;

    if (department) {
      const config = await WhatsAppConfig.findOne({ hospitalId }).lean();
      const deptRoute = (config?.departmentRouting as any)?.[department];
      if (deptRoute?.enabled) {
        const deptService = whatsappManager.getInstance(`${hospitalId}_${department}`, deptRoute.name);
        if (deptService.status === "CONNECTED") {
          waService = deptService;
          usedDedicated = true;
        } else if (deptRoute.phoneNumber) {
          finalMessage = `${message}\n\n*Dedicated ${deptRoute.name || department.toUpperCase()}: +91 ${deptRoute.phoneNumber}*`;
        }
      }
    }

    await waService.sendTextMessage(phone, finalMessage);
    res.json({ success: true, message: "Message sent successfully", usedDedicated });
  } catch (error: any) {
    console.error(`[WhatsApp sendMessage Error - ${hospitalId}]:`, error);
    const errorMsg =
      error?.output?.payload?.message ||
      error?.message ||
      (typeof error === 'string' ? error : '') ||
      'Failed to send WhatsApp message';
    res.status(500).json({ success: false, error: errorMsg });
  }
};
