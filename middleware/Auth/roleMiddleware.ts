// middleware/Auth/roleMiddleware.ts
// FIX: Unified role middleware — no debug info in production, clear error in development.
// This is the SINGLE source of truth for role authorization going forward.
// The authorize() function in authMiddleware.ts delegates to this same logic.
import { Request, Response, NextFunction } from "express";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export const authorizeRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const userRole = user?.role?.trim().toLowerCase();
    const allowedRoles = roles.map(r => r.trim().toLowerCase());

    if (!allowedRoles.includes(userRole)) {
      // FIX: Only log detailed info in development — never expose role/path structure in production
      if (!IS_PRODUCTION) {
        console.error(
          `[AUTH DENIED] User: ${user?._id}, Role: "${user?.role}" (${userRole}), ` +
          `Path: ${req.originalUrl}, Allowed: [${allowedRoles.join(', ')}]`
        );
      } else {
        // In production, log to server console only (not sent to client)
        console.warn(`[AUTH DENIED] userId=${user?._id} role=${userRole} path=${req.originalUrl}`);
      }

      return res.status(403).json({
        message: "Access denied. You do not have permission to access this resource.",
        // FIX: Never expose debug info (userId, role, allowedRoles, path) in production response
        ...(IS_PRODUCTION ? {} : {
          debug: {
            userId: user?._id || user?.id,
            userRole: user?.role,
            normalizedRole: userRole,
            allowedRoles: allowedRoles,
            path: req.originalUrl
          }
        })
      });
    }

    next();
  };
};
