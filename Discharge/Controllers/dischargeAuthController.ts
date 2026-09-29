import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { validationResult } from "express-validator";
import User from "../../Auth/Models/User.js";
import { handleAuthResponse } from "../../Auth/Controllers/authController.js";
import { tokenService } from "../../Auth/Services/tokenService.js";

// Discharge Specific Login
export const login = async (req: Request, res: Response) => {
  console.log("🏥 Discharge Portal Login Attempt:", {
    logid: req.body.logid,
    hasPassword: !!req.body.password,
  });

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { logid, password } = req.body;

  if (!logid || !password) {
    return res.status(400).json({
      message: "Log ID and password are required",
    });
  }

  try {
    const user = await (
      User.findOne({
        role: "DISCHARGE",
        $or: [{ mobile: logid }, { email: logid }],
      }) as any
    ).unscoped();

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials for Discharge portal",
      });
    }

    const match = await bcrypt.compare(password, user.password as string);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const { accessToken, csrfToken } = await handleAuthResponse(res, user, req);

    return res.json({
      accessToken,
      csrfToken,
      user: {
        id: user._id,
        name: user.name,
        role: "DISCHARGE",
        email: user.email,
        mobile: user.mobile,
        hospital: user.hospital,
      },
    });
  } catch (err: any) {
    console.error("💥 Discharge login error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Logout
export const logout = async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) {
    try {
      const payload = tokenService.verifyRefreshToken(refreshToken);
      const hashedToken = tokenService.hashToken(refreshToken);

      await (User.updateOne(
        { _id: payload._id },
        { $pull: { refreshTokens: { tokenHash: hashedToken } } }
      ) as any).unscoped();
    } catch (err) { }
  }
  
  tokenService.clearCookies(res);
  res.status(204).send();
};

// Upload Document (Profile/Certificates)
export const uploadDocument = async (req: any, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res
        .status(400)
        .json({
          message: "Invalid file type. Only PDF and Images are allowed.",
        });
    }

    const { uploadToCloudinary } = await import("../../utils/uploadToCloudinary.js");
    const isPdf = req.file.mimetype === "application/pdf";
    const publicId = `discharge_docs/${req.user._id || req.user.id}_${Date.now()}`;

    const result = await uploadToCloudinary(req.file.buffer, {
      public_id: publicId,
      resource_type: isPdf ? "raw" : "image",
      type: "authenticated",
    });

    res.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "File upload failed" });
  }
};
