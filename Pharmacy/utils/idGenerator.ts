import PharmaCounter from "../Models/PharmaCounter.js";

// Helper to generate 3-letter Pharma abbreviation
export const getPharmaAbbreviation = (name: string) => {
    const words = name.trim().split(/\s+/);
    if (words.length >= 3) {
        return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
    } else {
        const cleanName = name.replace(/[^a-zA-Z0-9]/g, '');
        return cleanName.slice(0, 3).toUpperCase();
    }
};

export const generatePharmaId = async (pharmacyId: any, businessName: string, type: "invoice" | "order" | "issuance", session?: any) => {
    const prefix = getPharmaAbbreviation(businessName);
    
    // Random 3-digit numeric variability
    const randomPart = Math.floor(100 + Math.random() * 900).toString();

    // Atomic increment of the counter
    const counter = await PharmaCounter.findOneAndUpdate(
        { pharmacy: pharmacyId, type },
        { $inc: { sequence: 1 } },
        { new: true, upsert: true, session }
    );

    const sequenceStr = counter.sequence.toString().padStart(4, "0");
    return `${prefix}-${randomPart}-${sequenceStr}`;
};
