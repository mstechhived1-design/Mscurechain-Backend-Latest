import { Request, Response, NextFunction } from "express";
import Hospital from "../../Hospital/Models/Hospital.js";
import logger from "../../utils/logger.js";

type PortalKey =
  | "masterhelpdesk"
  | "helpdesk"
  | "doctor"
  | "pharmacy"
  | "lab"
  | "nurse"
  | "hospitalAdmin"
  | "staff"
  | "hr"
  | "discharge";

/**
 * Factory function: creates a license check middleware for a specific portal.
 * Usage: router.use(checkPortalLicense("masterhelpdesk"))
 *
 * Logic:
 * 1. If portalLicenses[portal].enabled === false  → skip lock (no license configured for this portal)
 * 2. If enabled === true and today < startDate     → locked (not started)
 * 3. If enabled === true and today > endDate       → locked (expired)
 * 4. Otherwise                                     → allow through
 */
export const checkPortalLicense = (portal: PortalKey) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const hospitalId = user.hospital || req.headers["x-hospital-id"];
      if (!hospitalId) {
        return next(); // no hospital context – let route handle it
      }

      const hospital = await Hospital.findById(hospitalId).select("portalLicenses availablePortals status");
      if (!hospital) return res.status(404).json({ message: "Hospital not found" });

      if (hospital.status === "suspended") {
        return res.status(403).json({
          locked: true,
          message: "This hospital's access has been suspended by the administrator."
        });
      }

      // 🔒 Security Layer 1: Check if portal is allocated or has an active license configuration
      const allocated = hospital.availablePortals || [];
      const portalConfig = hospital.portalLicenses?.[portal as keyof typeof hospital.portalLicenses];
      const hasLicenseConfig = portalConfig && portalConfig.enabled;

      // Fallback: Core modules or modules with active license configuration are always 'allocated'
      const isCorePortal = [
        "masterhelpdesk",
        "hospitalAdmin",
        "helpdesk",
        "staff",
        "doctor",
        "nurse",
        "discharge",
        "lab",
        "pharmacy",
        "hr"
      ].includes(portal);

      // Super-logic: If helpdesk is requested, allow if masterhelpdesk is allocated/licensed
      let isAllocated = allocated.includes(portal) || isCorePortal || hasLicenseConfig;

      if (portal === "helpdesk" && !isAllocated) {
        const masterConfig = hospital.portalLicenses?.masterhelpdesk;
        // Also check if masterhelpdesk is core (which it is)
        const isMasterCore = true;
        if (allocated.includes("masterhelpdesk") || (masterConfig && masterConfig.enabled) || isMasterCore) {
          isAllocated = true;
        }
      }

      if (!isAllocated && allocated.length > 0) {
        // If allocation list exists and portal is neither core, nor allocated, nor has a license config
        return res.status(403).json({
          locked: true,
          message: `The ${portal} module is not allocated to your hospital. Please contact your system administrator.`
        });
      }

      if (allocated.length === 0 && !isAllocated) {
        // If nothing is allocated and the portal is not core/licensed/fallback-allowed
        return res.status(403).json({
          locked: true,
          message: `The ${portal} module is not allocated to your hospital. Please contact your system administrator.`
        });
      }

      // 🔒 Security Layer 2: Check per-portal license enabled status and dates
      // If the portal is NOT enabled in license management → no restriction (already checked hasLicenseConfig for allocation)
      if (!hasLicenseConfig) {
        return next();
      }

      const now = new Date();

      // Check start date
      if (portalConfig.startDate) {
        const startDate = new Date(portalConfig.startDate);
        startDate.setHours(0, 0, 0, 0);
        if (now < startDate) {
          return res.status(403).json({
            message: `Your ${portal} portal license has not started yet. It will be active from ${startDate.toDateString()}.`,
            licenseStartDate: portalConfig.startDate,
            portal,
            locked: true,
          });
        }
      }

      // Check end date (valid through the full last day)
      if (portalConfig.endDate) {
        const expiryDate = new Date(portalConfig.endDate);
        expiryDate.setHours(23, 59, 59, 999);
        if (now > expiryDate) {
          return res.status(403).json({
            message: `Your ${portal} portal license has expired. Please contact your administrator to renew.`,
            licenseEndDate: portalConfig.endDate,
            portal,
            locked: true,
          });
        }
      }

      next();
    } catch (err: any) {
      logger.error(`checkPortalLicense(${portal}) error:`, err);
      res.status(500).json({ message: "Server error checking license" });
    }
  };
};

/**
 * Legacy middleware kept for backward compatibility with masterhelpdesk only.
 * New code should use checkPortalLicense("masterhelpdesk") instead.
 */
export const checkLicense = checkPortalLicense("masterhelpdesk");
