import { Request, Response, NextFunction } from "express";

export const checkHospitalAccess = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
        return res.status(401).json({ message: "Authentication required" });
    }

    // super-admin can access everything
    if (user.role === 'super-admin') {
        return next();
    }

    if (user.role === 'hospital-admin') {
        const targetHospitalId = req.params.id || req.body.hospitalId;

        if (!user.hospital) {
            return res.status(403).json({ message: "Access denied. No hospital assigned to this admin." });
        }

        if (targetHospitalId && user.hospital.toString() !== targetHospitalId.toString()) {
            return res.status(403).json({ message: "Access denied. You can only manage your assigned hospital." });
        }

        return next();
    }

    next();
};
