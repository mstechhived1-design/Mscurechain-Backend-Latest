import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import AmbulancePersonnel from "../Emergency/Models/AmbulancePersonnel.js";
import { EmergencyAuthRequest } from "../Emergency/types/index.js";

export const authenticateEmergencyPersonnel = async (
    req: EmergencyAuthRequest,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.log("❌ No Bearer token in headers:", Object.keys(req.headers));
        return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.substring(7);

    try {
        console.log("🛡️ Emergency Auth Middleware Check");
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
            _id?: string;
            id?: string;
            role: string;
        };
        const userId = decoded._id || decoded.id;

        if (decoded.role !== "ambulance") {
            return res.status(403).json({ message: "Access denied" });
        }

        if (!userId) {
            return res.status(401).json({ message: "Invalid token payload: User ID missing" });
        }

        const personnel = await (AmbulancePersonnel.findById(userId) as any).unscoped().select(
            "-password"
        );

        if (!personnel) {
            console.log("❌ Emergency Auth: Personnel not found for ID:", userId);
            return res.status(401).json({ message: "Personnel not found" });
        }

        if (personnel.status === "suspended") {
            console.log("❌ Emergency Auth: Personnel suspended:", userId);
            return res.status(403).json({
                message: "Your account has been suspended"
            });
        }

        req.ambulancePersonnel = personnel;
        next();
    } catch (err: any) {
        console.error("❌ Emergency auth error:", err?.message || err);
        return res.status(401).json({ message: "Invalid token", error: err?.message });
    }
};
