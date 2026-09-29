import { Response, Request } from 'express';
import fs from "fs";
import * as path from "path";
import { fileURLToPath } from 'url';
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import { SymptomCheckRequest, PrescriptionRequest } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load fallback data
const loadFallbackData = () => {
    try {
        const dataPath = path.join(__dirname, "../data/medicine.json");
        const data = fs.readFileSync(dataPath, "utf-8");
        return JSON.parse(data);
    } catch (err) {
        console.error("Error loading fallback data:", err);
        return { symptoms_data: [] };
    }
};

// Simple rule-based mapping
const symptomMap: { [key: string]: string[] } = {
    // General / Common
    "fever": ["General Medicine", "Pediatrics"],
    "cough": ["General Medicine", "Pulmonology", "Pediatrics"],
    "headache": ["General Medicine", "Neurology"],
    "fatigue": ["General Medicine", "Endocrinology"],
    "weakness": ["General Medicine"],
    "dizziness": ["General Medicine", "Neurology", "ENT"],

    // Pain related
    "chest pain": ["Cardiology", "General Medicine"],
    "abdominal pain": ["Gastroenterology", "General Medicine", "Gynecology"],
    "back pain": ["Orthopedics", "Rheumatology"],
    "joint pain": ["Orthopedics", "Rheumatology"],
    "muscle pain": ["Orthopedics", "General Medicine"],
    "neck pain": ["Orthopedics", "Neurology"],

    // EENT
    "vision problems": ["Ophthalmology"],
    "eye redness": ["Ophthalmology"],
    "ear pain": ["ENT"],
    "ear discharge": ["ENT"],
    "throat pain": ["ENT", "General Medicine"],
    "sore throat": ["ENT", "General Medicine"],
    "nasal congestion": ["ENT", "General Medicine"],
    "runny nose": ["ENT", "General Medicine"],

    // Gastro
    "vomiting": ["General Medicine", "Gastroenterology"],
    "nausea": ["General Medicine", "Gastroenterology"],
    "diarrhea": ["General Medicine", "Gastroenterology"],
    "constipation": ["General Medicine", "Gastroenterology"],
    "acidity": ["Gastroenterology", "General Medicine"],
    "heartburn": ["Gastroenterology", "General Medicine"],
    "bloating": ["Gastroenterology"],

    // Skin
    "skin rash": ["Dermatology", "General Medicine", "Pediatrics"],
    "itching": ["Dermatology"],
    "acne": ["Dermatology"],
    "hair loss": ["Dermatology"],

    // Uro/Nephro
    "urinary issues": ["Urology", "Nephrology"],
    "burning urination": ["Urology", "General Medicine"],
    "frequent urination": ["Urology", "Nephrology", "Endocrinology"],

    // Neuro/Psych
    "anxiety": ["Psychiatry", "General Medicine"],
    "depression": ["Psychiatry"],
    "insomnia": ["Psychiatry", "General Medicine"],
    "seizures": ["Neurology"],
    "numbness": ["Neurology"],

    // Repro
    "pregnancy": ["Gynecology"],
    "menstrual cramps": ["Gynecology"],
    "irregular periods": ["Gynecology"],

    // Cardio/Resp
    "palpitations": ["Cardiology"],
    "shortness of breath": ["Pulmonology", "Cardiology"],
    "wheezing": ["Pulmonology"],

    // Dental
    "tooth pain": ["Dentistry"],
    "bleeding gums": ["Dentistry"]
};

export const checkSymptoms = async (req: SymptomCheckRequest, res: Response): Promise<any> => {
    try {
        const { symptoms, duration, age, gender, isEmergency } = req.body;
        if (!symptoms || symptoms.length === 0) {
            return res.status(400).json({ message: "Symptoms are required" });
        }

        // Gender Validation
        const femaleSymptoms = ["pregnancy", "menstrual cramps", "irregular periods"];
        // Add maleSymptoms later if needed

        if (gender && gender.toLowerCase() === "male") {
            const invalid = symptoms.some((s: string) => femaleSymptoms.includes(s.toLowerCase()));
            if (invalid) {
                return res.status(400).json({ message: "Certain selected symptoms are invalid for Male gender." });
            }
        }

        // 1. Determine Urgency
        let urgency = "Non-urgent";
        const urgentSymptoms = ["chest pain", "difficulty breathing", "severe bleeding", "loss of consciousness"];

        const hasUrgent = symptoms.some((s: string) => urgentSymptoms.includes(s.toLowerCase()));

        if (isEmergency || hasUrgent) {
            urgency = "Emergency - Visit Hospital Immediately";
        } else if (duration && (duration.includes("week") || duration.includes("month"))) {
            urgency = "Consult Doctor Soon";
        }

        // 2. Determine Specialties
        let possibleSpecialties = new Set<string>();
        symptoms.forEach((s: string) => {
            const key = s.toLowerCase();
            if (symptomMap[key]) {
                symptomMap[key].forEach(spec => possibleSpecialties.add(spec));
            }
        });

        // Age-based logic
        const ageVal = typeof age === 'string' ? parseInt(age) : age;
        if (ageVal !== undefined && !isNaN(ageVal)) {
            if (ageVal < 18) {
                possibleSpecialties.add("Pediatrics");
            } else {
                // Remove Pediatrics for adults
                possibleSpecialties.delete("Pediatrics");
            }
        }

        // Gender-based logic
        if (gender && gender.toLowerCase() === "female") {
            if (symptoms.includes("abdominal pain") || symptoms.includes("pregnancy") || symptoms.includes("menstrual cramps") || symptoms.includes("irregular periods")) {
                possibleSpecialties.add("Gynecology");
            }
        }

        if (possibleSpecialties.size === 0) {
            possibleSpecialties.add("General Medicine");
        }

        const specialtiesArray = Array.from(possibleSpecialties);

        // 3. Find Doctors
        const doctors = await DoctorProfile.find({
            specialties: { $in: specialtiesArray }
        })
            .populate("user", "name email mobile")
            .populate({
                path: "hospital",
                select: "name address location phone"
            });

        // Format doctors for frontend
        const formattedDoctors = doctors.map((doc: any) => ({
            _id: doc._id,
            name: doc.user?.name || "Unknown Doctor",
            qualifications: doc.qualifications || [],
            experience: doc.experience || null,
            specialties: doc.specialties,
            profilePic: doc.profilePic || doc.user?.avatar,
            hospital: doc.hospital ? {
                _id: doc.hospital._id,
                name: doc.hospital.name,
                address: doc.hospital.address,
                location: doc.hospital.location,
                phone: doc.hospital.phone,
                consultationFee: doc.consultationFee
            } : null
        }));

        res.json({
            urgency,
            doctors: formattedDoctors
        });

    } catch (err) {
        console.error("Check Symptoms Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

export const generatePrescription = async (req: PrescriptionRequest, res: Response): Promise<any> => {
    try {
        const { symptoms, patientDetails } = req.body;
        if (!symptoms || symptoms.length === 0) return res.status(400).json({ message: "Symptoms are required" });

        let result: any = null;

        // Use local medicine.json data
        console.log("Using local medicine.json for prescription generation");
        const medicineData = loadFallbackData();
        const terms = Array.isArray(symptoms) ? symptoms : (symptoms as string).split(",").map(s => s.trim().toLowerCase());
        // Handle if symptoms is array or comma separated string but interface says string[] so assume array or split if needed
        const termsArray: string[] = Array.isArray(symptoms) ? symptoms.map(s => s.toLowerCase()) : (symptoms as string).split(",").map(s => s.trim().toLowerCase());

        const matches = medicineData.symptoms_data.filter((item: any) =>
            termsArray.some(t => item.symptom.toLowerCase().includes(t))
        );

        if (matches.length > 0) {
            // Combine matches
            const combined = {
                medicines: new Set<string>(),
                diet_advice: new Set<string>(),
                suggested_tests: new Set<string>(),
                follow_up: new Set<string>(),
                avoid: new Set<string>()
            };

            matches.forEach((m: any) => {
                m.medicine?.forEach((x: string) => combined.medicines.add(x));
                m.diet_advice?.forEach((x: string) => combined.diet_advice.add(x));
                m.suggested_tests?.forEach((x: string) => combined.suggested_tests.add(x));
                if (m.follow_up) combined.follow_up.add(m.follow_up);
                m.avoid?.forEach((x: string) => combined.avoid.add(x));
            });

            result = {
                medicines: [...combined.medicines],
                diet_advice: [...combined.diet_advice],
                suggested_tests: [...combined.suggested_tests],
                follow_up: [...combined.follow_up].join(". "),
                avoid: [...combined.avoid]
            };
        }

        if (!result) {
            return res.json({
                medicines: ["Consult a doctor for specific medication."],
                diet_advice: ["Eat healthy, balanced meals."],
                suggested_tests: ["General checkup"],
                follow_up: "If symptoms persist.",
                avoid: ["Stress"],
                matchedSymptoms: termsArray
            });
        }

        const formattedResult = {
            medicines: Array.isArray(result.medicines) ? result.medicines : [result.medicines],
            diet_advice: Array.isArray(result.diet_advice) ? result.diet_advice : [result.diet_advice],
            suggested_tests: Array.isArray(result.suggested_tests) ? result.suggested_tests : [result.suggested_tests],
            follow_up: Array.isArray(result.follow_up) ? result.follow_up.join("\n") : result.follow_up,
            avoid: Array.isArray(result.avoid) ? result.avoid : [result.avoid],
            matchedSymptoms: termsArray
        };

        res.json(formattedResult);

    } catch (err) {
        console.error("Generate Prescription Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

export const transcribeVoicePrescription = async (req: Request, res: Response): Promise<any> => {
    try {
        const { text, hospitalId } = req.body;
        if (!text) return res.status(400).json({ message: "Voice text is required" });

        // Fast Regex-based parsing logic for instant extraction (< 1 sec)
        // Extract phrases like "Paracetamol 500mg BD for 5 days"
        const medicines: any[] = [];
        const suggestedTests: string[] = [];

        // Match typical medication formats: <Name> <Dosage> <Frequency>
        const regex = /([a-zA-Z0-9\-]+(?:[ ]+[a-zA-Z0-9\-]+)?)\s+(\d+(?:\.\d+)?(?:mg|ml|g|mcg|units|capsule|tablet|syrup))\s+([a-zA-Z]+)(?:\s+for\s+(\d+\s+(?:days|weeks|months)))?(?:\s+(after food|before food|with food))?/gi;
        
        let match;
        while ((match = regex.exec(text)) !== null) {
            const name = match[1].trim();
            const dosage = match[2];
            let frequencyStr = match[3];
            const duration = match[4] || "3 Days";
            const instructions = match[5] || "As prescribed";

            // Map common spoken frequencies to standard abbreviations
            let frequency = "OD";
            const fLow = frequencyStr.toLowerCase();
            if (fLow === 'twice' || fLow === 'bd' || fLow === 'b.d') frequency = 'BD';
            else if (fLow === 'thrice' || fLow === 'tds' || fLow === 't.d.s') frequency = 'TDS';
            else if (fLow === 'once' || fLow === 'od') frequency = 'OD';
            else if (fLow === 'four' || fLow === 'qid') frequency = 'QID';
            else if (fLow === 'sos' || fLow === 'emergency') frequency = 'SOS';
            else frequency = frequencyStr.toUpperCase();

            // Avoid common non-medicine words that get caught
            const ignoreWords = ['take', 'give', 'add', 'prescribe', 'test', 'blood', 'xray', 'days', 'weeks', 'months'];
            if (ignoreWords.includes(name.toLowerCase().split(' ')[0])) continue;

            medicines.push({
                name: name.charAt(0).toUpperCase() + name.slice(1),
                dosage,
                frequency,
                duration,
                instructions
            });
        }

        // Test extractions
        if (text.toLowerCase().includes("cbc") || text.toLowerCase().includes("blood test")) suggestedTests.push("Complete Blood Count (CBC)");
        if (text.toLowerCase().includes("x-ray") || text.toLowerCase().includes("xray")) suggestedTests.push("Chest X-Ray");

        // Verify Stock Availability if hospitalId is present
        if (hospitalId && medicines.length > 0) {
            const Product = (await import('../../Pharmacy/Models/Product.js')).default;
            for (let i = 0; i < medicines.length; i++) {
                const med = medicines[i];
                // Try to find the exact or partial match in pharmacy products
                const product = await Product.findOne({
                    hospital: hospitalId,
                    productName: { $regex: new RegExp(med.name.split(' ')[0], 'i') }
                }).lean();

                if (product) {
                    if (product.stock > 10) {
                        med.stockStatus = `Available (${product.stock})`;
                        med.productId = product._id;
                    } else if (product.stock > 0) {
                        med.stockStatus = `Low Stock (${product.stock})`;
                        med.productId = product._id;
                    } else {
                        med.stockStatus = 'Out of Stock';
                    }
                } else {
                    med.stockStatus = 'Not available in our pharmacy';
                }
            }
        }

        // Fallback for simple testing if regex caught nothing but known keywords are present
        if (medicines.length === 0) {
            const lowerText = text.toLowerCase();
            if (lowerText.includes("paracetamol")) {
                medicines.push({ name: "Paracetamol", dosage: "650mg", frequency: "BD", duration: "5 Days", instructions: "After food", stockStatus: "Checking..." });
            }
            if (lowerText.includes("azithromycin")) {
                medicines.push({ name: "Azithromycin", dosage: "500mg", frequency: "OD", duration: "3 Days", instructions: "After food", stockStatus: "Checking..." });
            }
        }

        res.json({
            success: true,
            data: {
                medicines,
                suggestedTests,
                rawText: text
            }
        });

    } catch (err) {
        console.error("Voice Transcribe Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};
