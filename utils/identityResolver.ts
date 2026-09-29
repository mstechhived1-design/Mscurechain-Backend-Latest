import Patient from "../Patient/Models/Patient.js";
import User from "../Auth/Models/User.js";
import PatientProfile from "../Patient/Models/PatientProfile.js";

/**
 * Robust identity resolution utility to eliminate "Unknown" names
 * Strategy: Check Context -> Check Global Patient -> Check Hospital Profile
 */
export const resolvePatientIdentity = async (patientId: any, context?: any): Promise<string> => {
  // 1. Check if the context (appointment/transaction) already has a valid name
  if (context) {
    const contextName = 
      context.patientName || 
      context.name || 
      (context.patient && typeof context.patient === 'object' ? context.patient.name : null) || 
      (context.user && typeof context.user === 'object' ? context.user.name : null) || 
      (context.patientDetails && context.patientDetails.name) ||
      (context.referenceId && context.referenceId.patientName) ||
      (context.referenceId && typeof context.referenceId.patient === 'object' ? (context.referenceId.patient.name || context.referenceId.patient.user?.name) : null) ||
      (context.referenceId && context.referenceId.patientDetails && context.referenceId.patientDetails.name);

    if (contextName && typeof contextName === 'string' && !isPlaceholder(contextName)) {
      return sanitize(contextName);
    }
  }

  // 2. If no valid name in context, look up global Patient record
  if (!patientId) return "";

  try {
    let patient = await (Patient.findById(patientId) as any).unscoped();
    
    // 2.1 If not in Patient collection, check primary User collection (common for helpdesk registrations)
    if (!patient || !patient.name || isPlaceholder(patient.name)) {
      const userPatient = await (User.findById(patientId) as any).unscoped();
      if (userPatient && userPatient.name && !isPlaceholder(userPatient.name)) {
        patient = userPatient;
      }
    }

    if (patient && patient.name && !isPlaceholder(patient.name)) {
      return sanitize(patient.name);
    }

    // 3. Deep lookup: Check for a PatientProfile which might have better demographic data
    const profile = await (PatientProfile.findOne({ user: patientId }) as any).unscoped();
    if (profile && profile.name && !isPlaceholder(profile.name)) {
      return sanitize(profile.name);
    }

    // 4. Fallback to patient mobile if name is still unknown
    const mobile = patient?.mobile || context?.mobile || context?.patientMobile || context?.patientDetails?.mobile || context?.patient?.mobile;
    if (mobile) {
      return `Patient (${mobile})`;
    }

    // 5. Context-based fallback for source
    if (context?.source === "offline" || context?.type === "offline") {
      return "Walk-in Patient";
    }

    return "";
  } catch (error) {
    console.error(`[resolvePatientIdentity] Resolution error for ID ${patientId}:`, error);
    return "";
  }
};

/**
 * Checks if a string is a common placeholder for unknown data
 */
function isPlaceholder(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "unknown" ||
    n === "unknown patient" ||
    n === "unnamed" ||
    n === "unnamed patient" ||
    n === "placeholder" ||
    n === "test" ||
    n === "test patient" ||
    n.includes("null") ||
    n.includes("undefined") ||
    n.trim() === ""
  );
}

/**
 * Capitalizes and cleans the name string
 */
function sanitize(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Formats patient display name with honorific without duplicate prefixes
 */
export function formatPatientDisplayName(name?: string | null, honorific?: string | null): string {
  let raw = sanitize(name || "Unnamed Patient");
  // Clean existing title prefixes from raw name
  while (/^(mr|mrs|ms|miss|mx|dr|prof|prof\.\s*dr|shri|smt|kumari|sister|father|rev|late|capt|col|maj|adv|er|master|baby\s+of(\s*\(b\/o\))?|baby|b\/o)\.?\s+/i.test(raw)) {
    raw = raw.replace(/^(mr|mrs|ms|miss|mx|dr|prof|prof\.\s*dr|shri|smt|kumari|sister|father|rev|late|capt|col|maj|adv|er|master|baby\s+of(\s*\(b\/o\))?|baby|b\/o)\.?\s+/i, "").trim();
  }

  const h = (honorific || "").trim();
  if (!h) return raw;

  let up = h.toUpperCase().replace(/\.$/, "");
  const dottedPrefixes = ["MR", "MRS", "MS", "DR", "PROF"];
  const prefix = dottedPrefixes.includes(up) ? `${h.replace(/\.$/, "")}.` : (up === "BABY OF" || up === "B/O" ? "Baby of (B/o)" : h);
  return `${prefix} ${raw}`.trim();
}
