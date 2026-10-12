import { Request, Response } from "express";
import whatsappManager from "../Services/whatsappManager.js";
import WhatsAppConfig from "../Models/WhatsAppConfig.js";

// Utility to extract hospitalId. In MsCurechain it might be in req.user, req.headers, or params.
// We'll assume it's passed dynamically or resolved by a middleware
const getHospitalId = (req: Request): string => {
  return req.params.hospitalId || (req as any).user?.hospitalId || req.headers["x-hospital-id"] as string;
};

export const getStatus = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

    const waService = whatsappManager.getInstance(hospitalId);
    const status = waService.getStatus();
    
    // Also merge with DB config for templates
    const config = await WhatsAppConfig.findOne({ hospitalId }).lean();
    
    res.json({ success: true, ...status, templates: config?.templates || {} });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const requestPairingCode = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const { phone } = req.body;
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });
    if (!phone) return res.status(400).json({ error: "phone required" });

    const waService = whatsappManager.getInstance(hospitalId);
    const result = await waService.requestPairingCode(phone);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const refreshQR = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

    const waService = whatsappManager.getInstance(hospitalId);
    const result = await waService.refreshQR();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

    const waService = whatsappManager.getInstance(hospitalId);
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

export const sendMedia = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const { phone, pdfBase64, imageBase64, caption, fileName } = req.body;
    
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });
    if (!phone) return res.status(400).json({ error: "phone required" });
    if (!pdfBase64 && !imageBase64) return res.status(400).json({ error: "pdfBase64 or imageBase64 required" });

    const waService = whatsappManager.getInstance(hospitalId);
    await waService.sendMedia(phone, { pdfBase64, imageBase64, caption, fileName });
    res.json({ success: true, message: "Media sent successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const hospitalId = getHospitalId(req);
    const { phone, message } = req.body;
    
    if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });
    if (!phone) return res.status(400).json({ error: "phone required" });
    if (!message) return res.status(400).json({ error: "message required" });

    const waService = whatsappManager.getInstance(hospitalId);
    await waService.sendTextMessage(phone, message);
    res.json({ success: true, message: "Message sent successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
