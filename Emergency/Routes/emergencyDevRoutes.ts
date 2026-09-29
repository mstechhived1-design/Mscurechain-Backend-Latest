import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import AmbulancePersonnel from "../Models/AmbulancePersonnel.js";
import Hospital from "../../Hospital/Models/Hospital.js";

const router = express.Router();

// @route   POST /api/emergency/dev/seed
// @desc    Create test ambulance personnel (DEV ONLY)
// @access  Public (should be removed in production)
router.post("/seed", async (req: Request, res: Response) => {
    try {
        console.log("🌱 Seeding ambulance personnel...");

        // Check if already exists
        const existing = await AmbulancePersonnel.findOne({ employeeId: "AMB-001" });
        if (existing) {
            return res.json({
                message: "AMB-001 already exists",
                credentials: {
                    employeeId: "AMB-001",
                    mobile: existing.mobile,
                    password: "AMB123 (if not changed)"
                }
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash("AMB123", 10);

        // Check if test hospital exists
        let testHospital = await Hospital.findOne({ name: "City General Hospital" });
        if (!testHospital) {
            testHospital = new Hospital({
                name: "City General Hospital",
                address: "123 Healthcare Ave, Medical District",
                phone: "123-456-7890",
                email: "contact@citygeneral.com",
                status: "approved",
                specialities: ["Emergency", "Cardiology", "Neurology"],
            });
            await testHospital.save();
            console.log("✅ Test hospital created!");
        }

        // Create personnel with hospital reference
        const personnel = new AmbulancePersonnel({
            name: "Rajesh Kumar",
            email: "ambulance@test.com",
            mobile: "9876543210",
            password: hashedPassword,
            employeeId: "AMB-001",
            vehicleNumber: "MH12AB1234",
            driverLicense: "DL1234567890",
            status: "active",
            hospital: testHospital._id,
        });

        await personnel.save();

        console.log("✅ Ambulance personnel created!");

        res.status(201).json({
            message: "✅ Test ambulance personnel and hospital verified!",
            credentials: {
                employeeId: "AMB-001",
                mobile: "9876543210",
                password: "AMB123",
                note: "Login with either Employee ID or Mobile"
            },
            personnel: {
                id: personnel._id,
                name: personnel.name,
                employeeId: personnel.employeeId,
                vehicleNumber: personnel.vehicleNumber
            },
            hospital: {
                id: testHospital._id,
                name: testHospital.name,
                status: testHospital.status
            }
        });
    } catch (error: any) {
        console.error("❌ Error seeding personnel:", error);
        res.status(500).json({ 
            message: "Error creating personnel",
            error: error.message 
        });
    }
});

// @route   GET /api/emergency/dev/check
// @desc    Check existing ambulance personnel
// @access  Public (should be removed in production)
router.get("/check", async (req: Request, res: Response) => {
    try {
        const allPersonnel = await AmbulancePersonnel.find().select("-password");
        const count = await AmbulancePersonnel.countDocuments();

        res.json({
            count,
            personnel: allPersonnel.map(p => ({
                id: p._id,
                name: p.name,
                employeeId: p.employeeId,
                mobile: p.mobile,
                email: p.email,
                status: p.status,
                vehicleNumber: p.vehicleNumber
            }))
        });
    } catch (error: any) {
        console.error("❌ Error checking personnel:", error);
        res.status(500).json({ 
            message: "Error checking personnel",
            error: error.message 
        });
    }
});

export default router;
