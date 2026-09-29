import HospitalCounter from "../Hospital/Models/HospitalCounter.js";
import MrnCounter from "../Hospital/Models/MrnCounter.js";
import Hospital from "../Hospital/Models/Hospital.js";
import { nanoid } from "nanoid";

/**
 * Derives a hospital code from its name.
 * - 3+ words: First letter of first three words.
 * - 2 words: First three letters of first word.
 * - 1 word: First three letters.
 */
export const getHospitalCode = (hospitalName: string): string => {
  if (!hospitalName) return "HSP";
  
  const words = hospitalName.trim().split(/\s+/).filter(w => w.length > 0);
  
  if (words.length >= 3) {
    // 3+ words: First letter of first three words
    return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
  } else if (words.length === 2) {
    // 2 words: First letter of first word + first two letters of second word
    const firstPart = words[0][0];
    const secondPart = words[1].replace(/[^a-zA-Z]/g, '').substring(0, 2);
    return (firstPart + secondPart).toUpperCase().padEnd(3, 'X');
  } else if (words.length === 1) {
    // 1 word: First three letters
    const firstWord = words[0].replace(/[^a-zA-Z]/g, '');
    return firstWord.substring(0, 3).toUpperCase().padEnd(3, 'X');
  }
  
  return "HSP";
};

/**
 * Generates a unique MRN: PREFIX + RANDOM3 + SEQUENCE6
 */
export const generateMrn = async (
  hospitalId: any,
  session?: any
): Promise<string> => {
  const hospital = await Hospital.findById(hospitalId).session(session).lean();
  if (!hospital) {
    throw new Error("Hospital not found for MRN generation");
  }

  const prefix = getHospitalCode(hospital.name);

  // Random 3-digit numeric variability segment
  const randomPart = Math.floor(100 + Math.random() * 900).toString();

  // Atomic increment of the MRN sequence for this specific hospital (6 digits)
  const counter = await MrnCounter.findOneAndUpdate(
    { hospital: hospitalId },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, session }
  );

  const sequenceStr = counter.sequence.toString().padStart(6, "0");
  return `${prefix}${randomPart}${sequenceStr}`;
};

/**
 * Generates a unique Transaction ID: TYPE-HHHRRRSSSS
 */
export const generateTransactionId = async (
  hospitalId: any,
  hospitalName: string,
  type: "OPD" | "IPD" | "APT" | "REF",
  session?: any
): Promise<string> => {
  const hhh = getHospitalCode(hospitalName);
  
  // RRR: 3 random digits
  const rrr = Math.floor(100 + Math.random() * 900).toString();
  
  // SSSS: 4-digit auto-incrementing sequence
  const counter = await HospitalCounter.findOneAndUpdate(
    { hospital: hospitalId, type },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, session }
  );
  
  const ssss = counter.sequence.toString().padStart(4, "0");
  
  return `${type}-${hhh}${rrr}${ssss}`;
};

/**
 * Generates a unique Receipt Number: TYPE + SEQUENCE5
 */
export const generateReceiptNumber = async (
  hospitalId: any,
  type: "OPD" | "IPD" | "REC" = "REC",
  session?: any
): Promise<string> => {
  // Use a specific counter type for the receipt (e.g. "OPD_REC" or "IPD_REC")
  const counterType = `${type}_REC`;
  
  const counter = await HospitalCounter.findOneAndUpdate(
    { hospital: hospitalId, type: counterType },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, session }
  );
  
  const sequenceStr = counter.sequence.toString().padStart(5, "0");
  return `${type}${sequenceStr}`;
};
