import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../../Auth/Models/User.js";
import SuperAdmin from "../../Auth/Models/SuperAdmin.js";
import Patient from "../../Patient/Models/Patient.js";
import redisService from "../../config/redis.js";
import { AuthRequest } from "../../Auth/types/index.js";
import { tokenService } from "../../Auth/Services/tokenService.js";

export const protect = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  let token: string | undefined;

  // 1. Prioritize Authorization Header
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  // 2. Fallback to HttpOnly Cookie
  else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, login required." });
  }

  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);

    if (!decoded._id || !decoded.role) {
      return res
        .status(401)
        .json({ message: "Invalid session. Please log in again." });
    }

    const userId = decoded._id;

    // Fetch user (with cache)
    const cacheKey = `auth:user:v2:${userId}`;
    let user = await redisService.get<any>(cacheKey);

    if (!user) {
      const role = decoded.role?.toLowerCase().trim();
      if (role === "patient") {
        user = await (
          Patient.findById(userId).select("-password").lean() as any
        ).unscoped();
      } else if (role === "super-admin") {
        user = await SuperAdmin.findById(userId).select("-password").lean();
      } else {
        user = await (
          User.findById(userId).select("-password").lean() as any
        ).unscoped();
      }

      if (user) {
        user.id = user._id.toString();
        await redisService.set(cacheKey, user, 300); // 5 min
      }
    }

    if (!user || user.status !== "active") {
      tokenService.clearCookies(res, decoded.hospitalId, decoded.role);
      return res
        .status(401)
        .json({ message: "Account is inaccessible or revoked." });
    }

    // Attach user information
    (req as any).user = user;
    (req as any).user.decoded = decoded;

    return next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ message: "Session expired.", code: "TOKEN_EXPIRED" });
    }
    return res
      .status(401)
      .json({ message: "Invalid session.", code: "TOKEN_INVALID" });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (
      !user ||
      !roles
        .map((r) => r.trim().toLowerCase())
        .includes(user.role?.trim().toLowerCase())
    ) {
      return res.status(403).json({
        message: `Access denied. Your role is not authorized for this action.`,
      });
    }
    next();
  };
};

export const optionalProtect = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  // 3. Fallback to HttpOnly Cookie (Crucial for session restoration when JS can't read token)
  else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return next(); // Just continue to controller
  }

  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
    const userId = decoded._id;
    const cacheKey = `auth:user:v2:${userId}`;

    const cachedUser = await redisService.get<any>(cacheKey);
    if (cachedUser && cachedUser.status === "active") {
      (req as any).user = cachedUser;
      return next();
    }

    // Role-based lookup (simplified for optional)
    const role = decoded.role?.trim().toLowerCase();
    let user: any = null;

    if (role === "patient")
      user = await (Patient.findById(userId).lean() as any).unscoped();
    else if (role === "super-admin")
      user = await SuperAdmin.findById(userId).lean();
    else user = await (User.findById(userId).lean() as any).unscoped();

    if (user && user.status === "active") {
      user.id = user._id.toString();
      (req as any).user = user;
    }
    next();
  } catch (err) {
    next(); // Continue even on error, controller will handle missing user
  }
};
