import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../Models/User.js";
import SuperAdmin from "../Models/SuperAdmin.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import AuthLog from "../Models/AuthLog.js";
import { AuthRequest, IUser } from "../types/index.js";
import redisService from "../../config/redis.js";
import {
  recordFailedAttempt,
  clearFailedAttempts,
} from "../../middleware/Auth/loginSecurity.js";

import { tokenService } from "../Services/tokenService.js";
import { logAudit, logError } from "../../utils/logger.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";
import { emitSSE } from "../../utils/ssePublisher.js";

// ─── SECURITY CONSTANTS (from .env) ──────────────────────────────────────────
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12", 10);
const FORBIDDEN_PUBLIC_ROLES = ["super-admin", "superadmin", "admin"];
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Helper: sign tokens and handle cookies
export const handleAuthResponse = async (res: Response, user: any, req: Request, hospitalIdOverride?: string | null) => {
  const userId = (user._id || user.id).toString();
  const hospitals = user.hospitals || (user.hospital ? [user.hospital] : []);
  
  // Resolve primary hospital with fallback to the override
  let primaryHospital = (
    user.hospital?._id || 
    user.hospital || 
    (user.hospitals?.[0]?._id || user.hospitals?.[0]) || 
    hospitalIdOverride
  )?.toString() || null;

  if (primaryHospital === "global") primaryHospital = null;

  const { accessToken, refreshToken } = tokenService.generateTokens({
    _id: userId,
    role: user.role,
    hospitalId: primaryHospital,
    hospitals: hospitals.filter((h: any) => h).map((h: any) => (h._id || h).toString()),
  });

  const csrfToken = uuidv4();
  const refreshTokenHash = tokenService.hashToken(refreshToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tokenService.getRefreshExpiryMs());

  // 1. Update Database (Refresh Token Array)
  const MAX_TOKENS = parseInt(process.env.MAX_REFRESH_TOKENS_PER_USER || "5", 10);
  let updatedTokens = (user.refreshTokens || []).filter((t: any) => new Date(t.expiresAt) > now);
  updatedTokens.push({
    tokenHash: refreshTokenHash,
    createdAt: now,
    expiresAt: expiresAt
  });

  // ✅ FIX: Enforce token cap — remove oldest entries beyond the limit
  if (updatedTokens.length > MAX_TOKENS) {
    updatedTokens = updatedTokens.slice(updatedTokens.length - MAX_TOKENS);
  }

  user.refreshTokens = updatedTokens;
  await user.save();

  // 2. Auth Log
  try {
    let userModel: "User" | "SuperAdmin" | "Patient" | "AmbulancePersonnel" = "User";
    if (user.role === "super-admin") userModel = "SuperAdmin";
    else if (user.role === "patient") userModel = "Patient";
    
    await AuthLog.create({
      user: userId,
      userModel,
      role: user.role,
      hospital: primaryHospital || (user.hospital ? user.hospital._id || user.hospital : undefined),
      status: "success",
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      loginAt: new Date()
    });
  } catch (logErr) {
    console.error("Failed to create auth log:", logErr);
  }

  // 3. Cookies
  tokenService.setRefreshCookie(res, refreshToken, user.role);
  tokenService.setAccessCookie(res, accessToken, primaryHospital, user.role);
  tokenService.setCsrfCookie(res, csrfToken, primaryHospital, user.role);

  logAudit(`Login Success`, { 
    userId: userId || "unknown", 
    role: user.role || "unknown", 
    hospital: primaryHospital || "global",
    ip: tokenService.getClientIp(req)
  });

  return { accessToken, refreshToken, csrfToken };
};

export const register = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });

  const { name, mobile, email, password, otp, consentGiven, role, hospitalId, platform } =
    req.body;

  const requestedRole = (role || "patient").toLowerCase().trim();
  const isMobilePatient = requestedRole === "patient" && platform === "mobile";

  if (!name || !mobile || (!isMobilePatient && !email) || !password) {
    const missingField = !name ? "name" : !mobile ? "mobile" : !email ? "email" : "password";
    return res.status(400).json({ message: `${missingField} is required` });
  }

  if (!consentGiven) {
    return res
      .status(400)
      .json({ message: "Terms and Conditions consent is required" });
  }

  // SECURITY: Block super-admin registration through public endpoint
  if (FORBIDDEN_PUBLIC_ROLES.includes(requestedRole)) {
    console.warn(
      `[SECURITY] Blocked attempt to register forbidden role "${requestedRole}" via public endpoint from IP: ${req.ip}`,
    );
    return res.status(403).json({
      message: "This role cannot be registered through this endpoint",
    });
  }

  try {
    const existingStaff = await (User.findOne({ mobile }) as any).unscoped();
    if (existingStaff)
      return res
        .status(400)
        .json({ message: "Mobile number already registered for staff/doctor" });

    const existingEmail = await (User.findOne({ email }) as any).unscoped();
    if (existingEmail && requestedRole !== "patient")
      return res.status(400).json({ message: "Email already registered" });

    const finalRole = requestedRole;
    const hashedPwd = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    let user: any;
    if (finalRole === "patient") {
      user = await (Patient.findOne({
        mobile,
        name: { $regex: new RegExp(`^${name}$`, "i") },
      }) as any).unscoped();

      if (user) {
        if (!(user as any).hospitals) (user as any).hospitals = [];
        if (hospitalId && !(user as any).hospitals.some((h: any) => h.toString() === hospitalId.toString())) {
          (user as any).hospitals.push(hospitalId);
        }
        if (email && !user.email) user.email = email.toLowerCase();
        await user.save();
      } else {
        user = await Patient.create({
          name,
          mobile,
          email: email?.toLowerCase(),
          password: hashedPwd,
          role: "patient",
          hospitals: hospitalId ? [hospitalId] : [],
          status: "active",
        });
      }

      if (hospitalId) {
        // Check if profile exists for this hospital
        const existingProfile = await (PatientProfile.findOne({
          user: user._id,
          hospital: hospitalId,
        }) as any).unscoped();

        if (!existingProfile) {
          await PatientProfile.create({
            user: user._id,
            hospital: hospitalId,
          });
        }

        // Ensure PatientHospitalMap exists
        const PatientHospitalMap = (
          await import("../../Patient/Models/PatientHospitalMap.js")
        ).default;
        await PatientHospitalMap.findOneAndUpdate(
          { globalPatientId: user._id, tenantId: hospitalId },
          { status: "active", registeredAt: new Date() },
          { upsert: true, new: true },
        );
      }
    } else {
      user = await User.create({
        name,
        mobile,
        email,
        password: hashedPwd,
        role: finalRole,
        consentGiven: true,
        hospital: hospitalId,
        consentTimestamp: new Date(),
      });

      if (["staff", "nurse", "emergency", "DISCHARGE"].includes(finalRole)) {
        const qrSecret = crypto.randomBytes(32).toString("hex");
        const StaffProfile = (await import("../../Staff/Models/StaffProfile.js")).default;
        await StaffProfile.create({ user: user._id, hospital: hospitalId, qrSecret });
      } else if (finalRole === "doctor") {
        await DoctorProfile.create({ user: user._id, hospital: hospitalId, specialties: [] });
      }
    }

    const { accessToken, refreshToken, csrfToken } = await handleAuthResponse(res, user, req, hospitalId);

    let responseData: any = {
      message: "Registration successful",
      tokens: { accessToken, refreshToken, csrfToken },
      user: {
        id: (user._id || user.id).toString(),
        name,
        mobile,
        email,
        role: user.role,
        hospitals: user.hospitals || (user.hospital ? [user.hospital] : []),
      },
    };

    if (["staff", "nurse", "emergency"].includes(user.role)) {
      const StaffProfile = (await import("../../Staff/Models/StaffProfile.js")).default;
      const profile = await (StaffProfile.findOne({ user: user._id }) as any).unscoped();
      if (profile) responseData.qrSecret = profile.qrSecret;
    }

    logAudit("Registration Success", { userId: user._id, role: user.role, ip: req.ip });
    res.status(201).json(responseData);
  } catch (err: any) {
    logError("Registration Error", err);
    res.status(500).json({ message: "Server error during registration" });
  }
};

export const checkExistence = async (req: Request, res: Response) => {
  const { field, value } = req.body;
  if (!field || !value)
    return res.status(400).json({ message: "Field and value required" });

  const allowedFields = ["mobile", "email", "loginId"];
  if (!allowedFields.includes(field)) {
    return res
      .status(400)
      .json({ message: "Invalid field for existence check" });
  }

  try {
    const query: any = {};
    query[field] = value;

    const [userExists, patientExists] = await Promise.all([
      (User.findOne(query) as any).unscoped(),
      (Patient.findOne(query) as any).unscoped(),
    ]);

    // Role-aware existence check: Patients can share mobile numbers
    if (userExists) {
      return res
        .status(400)
        .json({ message: `${field} already exists (Staff/Doctor)` });
    }

    // For email, we still want uniqueness typically, but for mobile we can be flexible
    if (field === "email" && patientExists) {
      return res.status(400).json({ message: `${field} already exists` });
    }

    // For mobile, we allow it if it's only a patient and the user wants to add a family member
    return res.status(200).json({ message: "Available" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const login = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });

  const { mobile, identifier, logid, password, hospitalId: bodyHospitalId } = req.body;
  const loginId = (mobile || identifier || logid)?.trim();
  const hospitalId = (req.headers["x-hospital-id"] || bodyHospitalId || "global").toString();

  if (!loginId || !password) {
    return res
      .status(400)
      .json({ message: "Mobile and password are required" });
  }

  console.log(
    `[Auth] Attempting login for: '${loginId}' (Is Doctor format: ${/^DOC/i.test(loginId)})`,
  );

  try {
    let user: IUser | null = null;
    let superAdmin: any = null;
    const isDoctorId = /^DOC/i.test(loginId);

    if (isDoctorId) {
      user = await (User.findOne({ doctorId: loginId }) as any).unscoped();
      if (!user) {
        await recordFailedAttempt(loginId, hospitalId);
        return res.status(401).json({ message: "Invalid credentials" });
      }
      // Re-map hospital from valid user object for perfect keying
      const resolvedHosp = (user.hospital || (user as any).hospitals?.[0] || hospitalId).toString();

      if (user.role !== "doctor") {
        await recordFailedAttempt(loginId, resolvedHosp, user._id.toString());
        return res.status(401).json({ message: "Invalid credentials" });
      }
    } else {
      console.log("[Auth] Performing concurrent lookup...");
      const [foundUser, foundSuperAdmin] = await Promise.all([
        (User.findOne({
          $or: [
            { mobile: loginId },
            { email: loginId.toLowerCase() },
            { loginId: loginId },
          ],
        }) as any).unscoped(),
        (SuperAdmin.findOne({
          $or: [{ email: loginId.toLowerCase() }, { mobile: loginId }],
        }) as any).unscoped(),
      ]);
      console.log(`[Auth] Lookup complete. User: ${!!foundUser}, SuperAdmin: ${!!foundSuperAdmin}`);

      user = foundUser;
      superAdmin = foundSuperAdmin;

      // PRIORITY 1: SuperAdmin (Global accounts take precedence)
      if (superAdmin) {
        if (superAdmin.status !== "active") {
          return res.status(403).json({ message: "Account is suspended" });
        }

        const isMatch = await bcrypt.compare(
          password,
          superAdmin.password as string,
        );

        if (isMatch) {
          // ✅ SuperAdmin PIN Verification (replaces email-based 2FA)
          const pin = "6666"; // Static 4-digit PIN
          const pinExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

          superAdmin.otp = pin;
          superAdmin.otpExpiresAt = pinExpiresAt;
          superAdmin.otpAttempts = 0;
          await superAdmin.save();

          // Generate a temporary token (short-lived, 30m)
          const tempToken = jwt.sign(
            { _id: superAdmin._id, role: "super-admin", purpose: "2fa" },
            process.env.JWT_SECRET as string,
            { expiresIn: "30m" }
          );

          return res.json({
            require2FA: true,
            pinLength: 4,
            tempToken,
            message: "Enter your 4-digit security PIN to continue"
          });
        }
        // If password didn't match superAdmin, we continue to check if it matches a regular user
        // (This handles cases where different users might have same email/mobile identifier)
      }

      // PRIORITY 2: Regular User (Staff, Doctor, Admin, etc.)
      if (user) {
        // ... continue to regular user logic ...
      } else {
        // PRIORITY 3: Patient
        const patients = await (Patient.find({ mobile: loginId }) as any).unscoped();
        if (patients.length > 0) {
          let authenticatedPatient: any = null;

          for (const patient of patients) {
            // Check patient status
            if (patient.status !== "active") continue;

            let patientAuth = false;
            if (patient.password) {
              patientAuth = await bcrypt.compare(
                password,
                patient.password as string,
              );
            }

            if (!patientAuth) {
              // Try DOB fallback (DDMMYYYY)
              const profile = await (PatientProfile.findOne({
                user: patient._id,
              }) as any).unscoped();
              if (profile && profile.dob) {
                const dob = new Date(profile.dob);
                const d = String(dob.getUTCDate()).padStart(2, "0");
                const m = String(dob.getUTCMonth() + 1).padStart(2, "0");
                const y = dob.getUTCFullYear();
                const expectedDobPassword = `${d}${m}${y}`;
                if (
                  password.length === expectedDobPassword.length &&
                  crypto.timingSafeEqual(
                    Buffer.from(password),
                    Buffer.from(expectedDobPassword),
                  )
                ) {
                  patientAuth = true;
                }
              }
            }

            if (patientAuth) {
              authenticatedPatient = patient;
              break;
            }
          }

          if (authenticatedPatient) {
            const patientHosp = (authenticatedPatient.hospital || authenticatedPatient.hospitals?.[0] || hospitalId).toString();
            await clearFailedAttempts(loginId, patientHosp, authenticatedPatient._id.toString());
            const { accessToken, refreshToken, csrfToken } = await handleAuthResponse(res, authenticatedPatient, req, patientHosp);
            return res.json({
              tokens: { accessToken, refreshToken, csrfToken },
              user: {
                id: authenticatedPatient._id.toString(),
                name: authenticatedPatient.name,
                role: "patient",
                hospitals: authenticatedPatient.hospitals,
              },
            });
          }
        }

        // If neither user nor patient nor superadmin (verified above) exists
        console.log(`[Auth] User NOT found for: '${loginId}'`);
        await recordFailedAttempt(loginId, hospitalId);
        return res.status(401).json({ message: "Invalid credentials" });
      }
    }

    // Check user status before password validation
    if (user!.status !== "active") {
      return res.status(403).json({
        message:
          "Account is suspended or inactive. Contact your hospital administrator.",
      });
    }

    let isAuthorized = false;
    if (user.password) {
      const match = await bcrypt.compare(password, user.password as string);
      if (match) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      // Use user ID for locking if we found one
      const resolvedHosp = (user?.hospital || (user as any)?.hospitals?.[0] || hospitalId).toString();
      const { attempts, locked, lockDuration } = await recordFailedAttempt(loginId, resolvedHosp, user?._id.toString());
      if (locked) {
        const timeStr = lockDuration < 60 ? `${lockDuration} second(s)` : `${Math.ceil(lockDuration / 60)} minute(s)`;
        return res.status(429).json({
          message: `Account temporarily locked due to too many failed login attempts. Try again in ${timeStr}.`,
          retryAfterSeconds: lockDuration
        });
      }
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const finalHosp = (user?.hospital || (user as any)?.hospitals?.[0] || hospitalId).toString();
    await clearFailedAttempts(loginId, finalHosp, user?._id.toString());

    const { accessToken, refreshToken, csrfToken } = await handleAuthResponse(res, user, req, hospitalId);

    return res.json({
      // ✅ FIX (Bug 5): Top-level fields for AuthResponse type + nested for legacy
      accessToken,
      refreshToken,
      csrfToken,
      tokens: { accessToken, refreshToken, csrfToken },
      accessTokenExpiresIn: tokenService.getAccessExpirySeconds(),
      refreshTokenExpiresIn: tokenService.getRefreshExpirySeconds(),
      user: {
        id: (user._id || (user as any).id).toString(),
        name: user.name,
        role: user.role,
        hospitals: (user as any).hospitals || (user.hospital ? [user.hospital] : []),
        hospital: user.hospital,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Role-specific login factory.
 */
export const roleLogin = (allowedRoles: string[]) => {
  return async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(422).json({ errors: errors.array() });

    const { mobile, identifier, loginId: bodyLoginId, password, hospitalId: bodyHospitalId } = req.body;
    const loginId = (mobile || identifier || bodyLoginId)?.trim();
    const hospitalId = (req.headers["x-hospital-id"] || bodyHospitalId || "global").toString();

    if (!loginId || !password) {
      return res
        .status(400)
        .json({ message: "Mobile/identifier and password are required" });
    }

    try {
      const user = await (User.findOne({
        $or: [{ mobile: loginId }, { email: loginId }, { loginId: loginId }],
      }) as any).unscoped();

      if (!user) {
        await recordFailedAttempt(loginId, hospitalId);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (user.status !== "active") {
        return res.status(403).json({
          message:
            "Account is suspended or inactive. Contact your hospital administrator.",
        });
      }

      if (!allowedRoles.includes(user.role as string)) {
        return res.status(403).json({
          message: `Unauthorized. This portal is restricted to: ${allowedRoles.join(", ")} users only.`,
        });
      }

      if (!user.password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const match = await bcrypt.compare(password, user.password as string);
      if (!match) {
        const resolvedHosp = (user.hospital || (user as any).hospitals?.[0] || hospitalId).toString();
        const { attempts, locked, lockDuration } =
          await recordFailedAttempt(loginId, resolvedHosp, user._id.toString());
        if (locked) {
          const timeStr = lockDuration < 60 ? `${lockDuration} second(s)` : `${Math.ceil(lockDuration / 60)} minute(s)`;
          return res.status(429).json({
            message: `Account temporarily locked due to too many failed attempts. Try again in ${timeStr}.`,
            retryAfterSeconds: lockDuration
          });
        }
        return res.status(401).json({
          message: "Invalid credentials"
        });
      }

      const finalHosp = (user.hospital || (user as any).hospitals?.[0] || hospitalId).toString();
      await clearFailedAttempts(loginId, finalHosp, user._id.toString());

      const { accessToken, refreshToken, csrfToken } = await handleAuthResponse(res, user, req, hospitalId);

      return res.json({
        // ✅ FIX (Bug 5): Top-level fields for AuthResponse type + nested for legacy
        accessToken,
        refreshToken,
        csrfToken,
        tokens: { accessToken, refreshToken, csrfToken },
        accessTokenExpiresIn: tokenService.getAccessExpirySeconds(),
        refreshTokenExpiresIn: tokenService.getRefreshExpirySeconds(),
        user: {
          id: user._id.toString(),
          name: user.name,
          role: user.role,
          hospitals: (user as any).hospitals,
          hospital: user.hospital,
          mobile: user.mobile,
          email: user.email,
        },
      });
    } catch (err) {
      console.error(`[roleLogin:${allowedRoles}] error:`, err);
      res.status(500).json({ message: "Server error" });
    }
  };
};

export const nurseLogin = roleLogin(["nurse"]);
export const labLogin = roleLogin(["lab"]);
export const pharmaLogin = roleLogin(["pharma-owner", "pharmacy", "pharmacist"]);

export const refresh = async (req: Request, res: Response) => {
  let oldRefreshToken = req.cookies.refreshToken;

  if (!oldRefreshToken) {
    const suffixedRef = Object.keys(req.cookies).find(k => k.startsWith("refreshToken_"));
    if (suffixedRef) {
      oldRefreshToken = req.cookies[suffixedRef];
    }
  }

  if (!oldRefreshToken) {
    return res.status(401).json({ message: "Refresh token missing" });
  }

  try {
    const payload = tokenService.verifyRefreshToken(oldRefreshToken);
    const { _id: userId, role } = payload;

    let user: any = null;
    if (role === "patient") {
      user = await (Patient.findById(userId) as any).unscoped();
    } else if (role === "super-admin") {
      user = await SuperAdmin.findById(userId);
    } else {
      user = await (User.findById(userId) as any).unscoped();
    }

    if (!user || user.status !== "active") {
      tokenService.clearCookies(res);
      return res.status(401).json({ message: "User not found or inactive" });
    }

    const hashedOld = tokenService.hashToken(oldRefreshToken);
    const now = new Date();
    
    // Auto Cleanup expired tokens while searching for the current one
    const validTokens = (user.refreshTokens || []).filter((t: any) => new Date(t.expiresAt) > now);
    const currentTokenValid = validTokens.find((t: any) => t.tokenHash === hashedOld);

    if (!currentTokenValid) {
      user.refreshTokens = validTokens; // Save the cleaned up list even if this refresh fails
      await user.save();
      tokenService.clearCookies(res);
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    // ✅ FIX 1: Generate NEW tokens BEFORE updating the DB, then:
    //   a) Remove the OLD token hash (it's being rotated out)
    //   b) Push the NEW token hash (so the next refresh finds it)
    // Without this the old hash stays, new cookie is set, but next rotate can't find the new hash → 401.
    const { accessToken, refreshToken } = tokenService.generateTokens({
      _id: userId,
      role: user.role,
      hospitalId: payload.hospitalId,
      hospitals: user.hospitals || (user.hospital ? [user.hospital] : []),
    });

    const newRefreshHash = tokenService.hashToken(refreshToken);
    const newExpiresAt = new Date(now.getTime() + tokenService.getRefreshExpiryMs());
    const MAX_TOKENS = parseInt(process.env.MAX_REFRESH_TOKENS_PER_USER || "5", 10);

    // Remove old hash, add new hash
    let rotatedTokens = validTokens.filter((t: any) => t.tokenHash !== hashedOld);
    rotatedTokens.push({ tokenHash: newRefreshHash, createdAt: now, expiresAt: newExpiresAt });

    // ✅ FIX 2: Enforce token cap
    if (rotatedTokens.length > MAX_TOKENS) {
      rotatedTokens = rotatedTokens.slice(rotatedTokens.length - MAX_TOKENS);
    }

    user.refreshTokens = rotatedTokens;
    await user.save();

    // ✅ FIX 3: Always issue a fresh CSRF token on rotate (prevent stale CSRF mismatch)
    const { v4: uuidv4Refresh } = await import("uuid");
    const newCsrfToken = uuidv4Refresh();

    tokenService.setAccessCookie(res, accessToken, payload.hospitalId, user.role);
    tokenService.setRefreshCookie(res, refreshToken, user.role);
    tokenService.setCsrfCookie(res, newCsrfToken, payload.hospitalId, user.role);

    return res.json({
      accessToken,
      refreshToken,
      csrfToken: newCsrfToken,
      // Also nest under tokens for backward-compat with older client code
      tokens: { accessToken, refreshToken, csrfToken: newCsrfToken },
      accessTokenExpiresIn: tokenService.getAccessExpirySeconds(),
      refreshTokenExpiresIn: tokenService.getRefreshExpirySeconds()
    });
  } catch (err: any) {
    tokenService.clearCookies(res);
    return res.status(401).json({ message: "Invalid or expired session" });
  }
};

export const logout = async (req: Request, res: Response) => {
  let refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
      const suffixedRef = Object.keys(req.cookies).find(k => k.startsWith("refreshToken_"));
      if (suffixedRef) refreshToken = req.cookies[suffixedRef];
  }

  if (refreshToken) {
    try {
      const payload = tokenService.verifyRefreshToken(refreshToken);
      const { _id: userId, role } = payload;
      const hashedToken = tokenService.hashToken(refreshToken);

      let model: any = User;
      if (role === "patient") model = Patient;
      else if (role === "super-admin") model = SuperAdmin;

      await (model.updateOne(
        { _id: userId },
        { $pull: { refreshTokens: { tokenHash: hashedToken } } }
      ) as any).unscoped();

      // ✅ Update AuthLog with Logout Time & Duration
      try {
        const lastLog = await AuthLog.findOne({
          user: userId,
          role: role,
          status: "success",
          logoutAt: { $exists: false }
        }).sort({ loginAt: -1 });

        if (lastLog) {
          const logoutAt = new Date();
          const diffMs = logoutAt.getTime() - lastLog.loginAt.getTime();
          
          const hours = Math.floor(diffMs / 3600000);
          const minutes = Math.floor((diffMs % 3600000) / 60000);
          const seconds = Math.floor((diffMs % 60000) / 1000);

          let durationStr = "";
          if (hours > 0) durationStr = `${hours}h ${minutes}m`;
          else if (minutes > 0) durationStr = `${minutes}m ${seconds}s`;
          else durationStr = `${seconds}s`;

          lastLog.logoutAt = logoutAt;
          lastLog.duration = durationStr;
          await lastLog.save();

          // Notify admins of the update
          await emitSSE({
            tenantId: "global",
            hospitalId: (lastLog.hospital || "global").toString(),
            domain: "system",
            type: "updated",
            resourceId: lastLog._id.toString(),
            resourceType: "AuthLog"
          });
        }
      } catch (logErr) {
        console.error("Failed to update AuthLog on logout:", logErr);
      }

      tokenService.clearCookies(res, payload.hospitalId, role);
      logAudit("Logout Success", { userId, role });
    } catch (err) {
      tokenService.clearCookies(res);
    }
  } else {
    tokenService.clearCookies(res);
  }
  res.status(204).send();
};

export const logoutAll = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });

  try {
    const userId = (req.user._id || req.user.id).toString();
    const role = req.user.role;

    let model: any = User;
    if (role === "patient") model = Patient;
    else if (role === "super-admin") model = SuperAdmin;

    await (model.updateOne(
        { _id: userId },
        { $set: { refreshTokens: [] } }
    ) as any).unscoped();

    // ✅ Close all open AuthLogs for this user
    try {
      const logoutAt = new Date();
      const openLogs = await AuthLog.find({ 
        user: userId, 
        role: role, 
        logoutAt: { $exists: false } 
      });

      for (const log of openLogs) {
        const diffMs = logoutAt.getTime() - log.loginAt.getTime();
        const minutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(minutes / 60);
        const seconds = Math.floor((diffMs % 60000) / 1000);

        let durationStr = "";
        if (hours > 0) durationStr = `${hours}h ${minutes % 60}m`;
        else if (minutes > 0) durationStr = `${minutes}m ${seconds}s`;
        else durationStr = `${seconds}s`;

        log.logoutAt = logoutAt;
        log.duration = durationStr;
        await log.save();
      }

      if (openLogs.length > 0) {
        await emitSSE({
          tenantId: "global",
          hospitalId: "global",
          domain: "system",
          type: "updated",
          resourceType: "AuthLog"
        });
      }
    } catch (logErr) {
        console.error("Failed to update AuthLogs on logoutAll:", logErr);
    }

    tokenService.clearCookies(res, null, role);

    const cacheKey = `auth:user:v2:${userId}`;
    await redisService.del(cacheKey);

    logAudit("Logout All Success", { userId });
    res.status(200).json({ message: "Logged out from all devices" });
  } catch (err) {
    logError("Logout All Error", err, { userId: req.user?._id });
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Change password (requires current password)
 */
export const changePassword = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });

  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "Current password and new password are required" });
  }

  try {
    const userId = req.user._id || req.user.id;

    let dbUser: any = null;
    const role = (req.user.role as string)?.trim().toLowerCase();

    if (role === "patient") {
      dbUser = await (Patient.findById(userId) as any).unscoped().select("+password");
    } else if (role === "super-admin") {
      dbUser = await (SuperAdmin.findById(userId) as any).unscoped().select("+password");
    } else {
      dbUser = await (User.findById(userId) as any).unscoped().select("+password");
    }

    if (!dbUser || !dbUser.password) {
      return res.status(400).json({ message: "Cannot change password" });
    }

    const isMatch = await bcrypt.compare(currentPassword, dbUser.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    // Prevent reusing the same password
    const isSamePassword = await bcrypt.compare(newPassword, dbUser.password);
    if (isSamePassword) {
      return res.status(400).json({
        message: "New password must be different from current password",
      });
    }

    const hashedPwd = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    dbUser.password = hashedPwd;
    await dbUser.save();

    const cacheKey = `auth:user:v2:${userId}`;
    await redisService.del(cacheKey);

    res.json({
      message: "Password changed successfully. Please log in again.",
    });
  } catch (err: any) {
    console.error("[changePassword] Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * PRODUCTION-GRADE /me ENDPOINT
 * Single source of truth for frontend state.
 * Returns required architectural structure: { id, role, hospitalId, name, permissions }
 */
export const me = async (req: AuthRequest, res: Response) => {
  // The /me endpoint must NEVER issue tokens or create sessions.
  if (!req.user) {
    return res.status(401).json({ message: "Not authenticated", code: "TOKEN_EXPIRED" });
  }

  const user = req.user;
  const decoded = (req as any).user.decoded || {};

  const resolvedHospitalId = decoded.hospitalId || user.hospital || user.hospitals?.[0];
  
  let geofence: any = undefined;
  if (resolvedHospitalId) {
    try {
      const Hospital = (await import("../../Hospital/Models/Hospital.js")).default;
      const hosp = await Hospital.findById(resolvedHospitalId).select("location geofenceSettings").lean();
      if (hosp) {
        geofence = {
          location: hosp.location,
          settings: hosp.geofenceSettings
        };
      }
    } catch (e) {
      console.error("Failed to fetch geofence settings for /me", e);
    }
  }

  // Construct production-safe profile for frontend
  const responseData = {
    id: (user._id || user.id).toString(),
    name: user.name,
    role: user.role,
    hospitalId: resolvedHospitalId,
    permissions: user.permissions || [], // Added for RBAC support
    mobile: user.mobile,
    email: user.email,
    gender: user.gender,
    image: user.image,
    avatar: user.avatar,
    bio: user.bio,
    hospitals: user.hospitals || (user.hospital ? [user.hospital] : []),
    geofence,
  };

  // Attach additional role-specific metadata if needed (but keep root clean)
  try {
    if (["staff", "nurse"].includes(user.role)) {
      const StaffProfile = (await import("../../Staff/Models/StaffProfile.js")).default;
      const profile = await (StaffProfile.findOne({ user: user._id || user.id }) as any).unscoped().lean();
      if (profile) {
        Object.assign(responseData, {
          employeeId: profile.employeeId,
          department: profile.department,
          designation: profile.designation
        });
      }
    } else if (user.role === "doctor") {
      const profile = await (DoctorProfile.findOne({ user: user._id || user.id }) as any).unscoped().lean();
      if (profile) {
        Object.assign(responseData, {
          employeeId: profile.employeeId,
        });
      }
    }
  } catch (e) {
    // Silent fail for non-critical profile enrichment
    console.warn("[Me Controller] Failed to merge StaffProfile:", e);
  }

  // Attach additional role-specific metadata for pharma-owner
  try {
    if (user.role === "pharma-owner") {
      // First, copy core fields directly from the User model as defaults
      Object.assign(responseData, {
        gstin: user.gstin,
        shopName: user.shopName,
        address: user.address,
        licenseNo: user.licenseNo,
        image: user.image || user.avatar,
        pharmacyTerms: user.pharmacyTerms || [],
      });

      const PharmaProfile = (await import("../../Pharmacy/Models/PharmaProfile.js")).default;
      const pharmaProfile = await (PharmaProfile.findOne({
        user: user._id || user.id,
      }) as any).unscoped().lean();
      if (pharmaProfile) {
        Object.assign(responseData, {
          qualificationDetails: pharmaProfile.qualificationDetails,
          documents: pharmaProfile.documents,
          gstin: pharmaProfile.gstin || user.gstin,
          shopName: pharmaProfile.businessName || user.shopName,
          address: pharmaProfile.address || user.address,
          licenseNo: pharmaProfile.licenseNo || user.licenseNo,
          image: pharmaProfile.logoUrl || user.image || user.avatar,
          pharmacyTerms: pharmaProfile.pharmacyTerms || user.pharmacyTerms || [],
        });
      }
    }
  } catch (e) {
    console.warn("[Me Controller] Failed to merge PharmaProfile:", e);
  }

  return res.json(responseData);
};

export const updateMyProfile = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });

  try {
    const userId = req.user._id;
    let reqBody = req.body || {};
    const {
      name,
      email,
      mobile,
      gender,
      shopName,
      address,
      gstin,
      licenseNo,
      image,
      employeeId,
      department,
      pharmacyTerms,
      ...otherData
    } = reqBody;

    // Handle File Upload if present
    const files = req.files as any[] | undefined;
    const file = req.file || (files && files.length > 0 ? files[0] : null);

    const updates: any = {};

    if (file) {
      console.log(`[UpdateProfile] Processing file upload: ${file.originalname}`);
      try {
        const result = await uploadToCloudinary(file.buffer, {
          folder: "profiles",
          public_id: `user_${userId}`,
          overwrite: true
        });
        updates.image = result.secure_url;
        updates.avatar = result.secure_url;

        // Sync to role-specific fields
        if (req.user.role === "doctor") {
          otherData.profilePic = result.secure_url;
        }

        if (["staff", "helpdesk", "nurse", "emergency", "DISCHARGE"].includes(req.user.role)) {
          otherData.image = result.secure_url;
          // No need to set updates again here, handled above but keeping for explicitness
          updates.image = result.secure_url;
          updates.avatar = result.secure_url;
        }
      } catch (uploadError) {
        console.error("[UpdateProfile] Image upload failed:", uploadError);
      }
    }

    // Prevent role/status escalation via profile update
    delete otherData.role;
    delete otherData.status;
    delete otherData.password;

    if (name) updates.name = name;
    if (email) updates.email = email;
    if (mobile) updates.mobile = mobile;
    if (gender) updates.gender = gender;

    if (employeeId) updates.employeeId = employeeId;
    if (department) {
      updates.department = Array.isArray(department)
        ? department[0]
        : department;
    }

    if (shopName) updates.shopName = shopName;
    if (address) updates.address = address;
    if (gstin) updates.gstin = gstin;
    if (licenseNo) updates.licenseNo = licenseNo;
    if (pharmacyTerms) {
      updates.pharmacyTerms = typeof pharmacyTerms === "string" ? JSON.parse(pharmacyTerms) : pharmacyTerms;
    }
    if (image && !updates.image) {
      updates.image = image;
      updates.avatar = image;
    }

    console.log(`[UpdateProfile] Updates for User model:`, updates);
    console.log(`[UpdateProfile] Other data for Profile sync:`, otherData);

    let dbUser: any = null;
    if ((req.user.role as string) === "patient") {
      dbUser = await (Patient.findById(userId) as any).unscoped();
    } else if ((req.user.role as string) === "super-admin") {
      dbUser = await SuperAdmin.findById(userId);
    } else {
      dbUser = await (User.findById(userId) as any).unscoped();
    }

    if (!dbUser) {
      console.error(`[UpdateProfile] User NOT FOUND in DB for ID: ${userId}`);
      return res.status(404).json({ message: "User not found" });
    }

    // Apply updates manually to ensure we see what's happening
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        dbUser[key] = updates[key];
      }
    });

    console.log(`[UpdateProfile] Applying updates for user: ${dbUser.name} (${dbUser.role})`);
    console.log(`[UpdateProfile] Image URL in updates: ${updates.image || 'NOT CHANGED'}`);

    const updatedUser = await dbUser.save();
    console.log(`[UpdateProfile] Save successful for ${updatedUser.name}. Image in DB: ${updatedUser.image}`);

    if ((req.user.role as string) === "patient") {
      await (PatientProfile.findOneAndUpdate(
        { user: userId },
        { $set: otherData },
        { upsert: true, new: true },
      ) as any).unscoped();
    } else if (req.user.role === "doctor") {
      await (DoctorProfile.findOneAndUpdate(
        { user: userId },
        { $set: otherData },
        { upsert: true, new: true },
      ) as any).unscoped();
    } else if (
      ["staff", "helpdesk", "nurse", "emergency", "DISCHARGE"].includes(
        req.user.role,
      )
    ) {
      const StaffProfile = (await import("../../Staff/Models/StaffProfile.js"))
        .default;

      ["qualificationDetails", "bankDetails", "workingHours"].forEach(
        (field: string) => {
          if (typeof (otherData as any)[field] === "string") {
            try {
              (otherData as any)[field] = JSON.parse((otherData as any)[field]);
            } catch (e) {
              console.error(`Failed to parse ${field}:`, e);
            }
          }
        },
      );

      const existingProfile = await (StaffProfile.findOne({ user: userId }) as any).unscoped();
      const staffUpdates: any = {
        ...otherData,
        employeeId: employeeId || otherData.employeeId,
        department: department
          ? Array.isArray(department)
            ? department
            : [department]
          : otherData.department,
      };

      if (address) {
        staffUpdates.address = { street: address };
      }

      if (!existingProfile) {
        staffUpdates.qrSecret = crypto.randomBytes(32).toString("hex");
        staffUpdates.hospital = req.user.hospital;
      }

      // Prevent overwriting existing image with undefined in StaffProfile
      if (!staffUpdates.image && existingProfile?.image) {
        staffUpdates.image = existingProfile.image;
      }

      console.log(
        `[UpdateProfile] Syncing to StaffProfile for user ${userId}:`,
        staffUpdates,
      );
      const updatedProfile = await (StaffProfile.findOneAndUpdate(
        { user: userId },
        { $set: staffUpdates },
        { upsert: true, new: true },
      ) as any).unscoped();

      if (
        updatedProfile &&
        (staffUpdates.qualificationDetails?.licenseValidityDate ||
          staffUpdates.licenseValidityDate)
      ) {
        const { processSingleProfileExpiry } =
          await import("../../services/reminderService.js");
        await processSingleProfileExpiry(updatedProfile, "staff");
      }

      if (updatedUser) {
        const mergedResponse = { ...updatedUser.toObject(), ...staffUpdates };

        // Ensure image/avatar are present in the merged response
        mergedResponse.image = mergedResponse.image || updatedUser.image;
        mergedResponse.avatar = mergedResponse.avatar || updatedUser.avatar;

        if (
          staffUpdates.address &&
          typeof staffUpdates.address === "object" &&
          staffUpdates.address.street
        ) {
          mergedResponse.address = staffUpdates.address.street;
        }

        // ✅ CRITICAL: Invalidate cache before returning
        const cacheKey = `auth:user:v2:${userId}`;
        await redisService.del(cacheKey);
        console.log(`[UpdateProfile] Cache invalidated for staff user: ${userId}`);

        return res.json(mergedResponse);
      }
    } else if (req.user.role === "pharma-owner") {
      const PharmaProfile = (
        await import("../../Pharmacy/Models/PharmaProfile.js")
      ).default;

      ["qualificationDetails", "documents", "pharmacyTerms"].forEach((field: string) => {
        if (typeof (otherData as any)[field] === "string") {
          try {
            (otherData as any)[field] = JSON.parse((otherData as any)[field]);
          } catch (e) {
            console.error(`Failed to parse ${field}:`, e);
          }
        }
      });

      const pharmaUpdates: any = {
        ...otherData,
        businessName: shopName || otherData.businessName,
        address: address || otherData.address,
        gstin: gstin || otherData.gstin,
        licenseNo: licenseNo || otherData.licenseNo,
        logoUrl: image || updates.image,
        pharmacyTerms: updates.pharmacyTerms || otherData.pharmacyTerms,
      };

      console.log(
        `[UpdateProfile] Syncing to PharmaProfile for user ${userId}:`,
        pharmaUpdates,
      );
      await (PharmaProfile.findOneAndUpdate(
        { user: userId },
        { $set: pharmaUpdates },
        { upsert: true, new: true },
      ) as any).unscoped();
    }

    const cacheKey = `auth:user:v2:${userId}`;
    await redisService.del(cacheKey);
    console.log(`[UpdateProfile] Cache invalidated for user: ${userId}`);

    res.json(updatedUser);
  } catch (err: any) {
    console.error("updateMyProfile error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Profile update failed"
        : err.message;
    res.status(500).json({ message: "Server error", error: errorMessage });
  }
};

/**
 * Verify that a hospital ID (MongoDB ObjectId) maps to a real, approved hospital.
 * This is called in Step 1 of the two-step login flow.
 * No authentication required — it's a pre-login check.
 * Returns: { valid: boolean, hospitalName?: string }
 */
export const verifyHospital = async (req: Request, res: Response) => {
  const { hospitalId } = req.params;

  if (!hospitalId) {
    return res.status(400).json({ valid: false, message: "Hospital ID is required" });
  }

  // Basic MongoDB ObjectId format check (24 hex chars)
  if (!/^[a-f0-9]{24}$/i.test(hospitalId)) {
    return res.status(400).json({ valid: false, message: "Invalid Hospital ID format" });
  }

  try {
    const Hospital = (await import("../../Hospital/Models/Hospital.js")).default;
    const hospital = await (Hospital.findById(hospitalId) as any)
      .unscoped()
      .select("name status logo")
      .lean();

    if (!hospital) {
      console.error(`[verifyHospital] Hospital NOT FOUND by ID: ${hospitalId}`);
      
      // DEBUG: List first 5 hospitals to see what's in the DB
      const allHospitals = await (Hospital.find({}) as any).unscoped().limit(5).lean();
      console.log(`[verifyHospital] Sample hospitals in DB:`, allHospitals.map((h: any) => ({ id: h._id, name: h.name })));

      // Fallback: Check if it's the custom hospitalId string (e.g. HOSP0001)
      const hospitalByCustomId = await (Hospital.findOne({ hospitalId }) as any)
        .unscoped()
        .select("name status logo")
        .lean();
      
      if (!hospitalByCustomId) {
        return res.status(404).json({ valid: false, message: "Hospital not found" });
      }
      
      console.log(`[verifyHospital] Found hospital by custom hospitalId string: ${hospitalId}`);
      return res.json({
        valid: true,
        hospitalName: hospitalByCustomId.name,
        hospitalLogo: hospitalByCustomId.logo || "",
        hospitalId: hospitalByCustomId._id.toString(),
      });
    }

    if (hospital.status === "suspended") {
      return res.status(403).json({ valid: false, message: "This hospital account has been suspended" });
    }

    return res.json({
      valid: true,
      hospitalName: hospital.name,
      hospitalLogo: hospital.logo || "",
      hospitalId: hospitalId,
    });
  } catch (err: any) {
    console.error("[verifyHospital] Error:", err);
    return res.status(500).json({ valid: false, message: "Server error during verification" });
  }
};
