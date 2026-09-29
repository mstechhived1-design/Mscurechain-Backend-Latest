import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
// FIX: LEGACY_KEY moved from hardcoded source to environment variable
const LEGACY_KEY = process.env.ENCRYPTION_KEY_LEGACY;

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts a string using AES-256-GCM
 * Output format: iv:authTag:encryptedText (all hex)
 * FIX: Non-string inputs are coerced to String to prevent bypass
 */
export const encrypt = (text: any): string => {
    // FIX: Coerce to string — prevents non-string inputs from bypassing encryption
    if (text === null || text === undefined) return text;
    const textStr = String(text);
    if (!textStr) return text;

    if (!ENCRYPTION_KEY) {
        throw new Error("ENCRYPTION_KEY MUST be set in environment variables.");
    }

    // Detect if already encrypted using strict regex — prevents double-encryption
    const encryptedRegex = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;
    if (encryptedRegex.test(textStr)) {
        return textStr;
    }

    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(
            ALGORITHM,
            Buffer.from(ENCRYPTION_KEY, "hex"),
            iv
        );

        let encrypted = cipher.update(textStr, "utf8", "hex");
        encrypted += cipher.final("hex");

        const authTag = cipher.getAuthTag().toString("hex");

        return `${iv.toString("hex")}:${authTag}:${encrypted}`;
    } catch (error) {
        // FIX: Log but re-throw so the caller knows encryption failed
        console.error("[Crypto] Encryption error:", error);
        throw new Error(`Encryption failed: ${(error as Error).message}`);
    }
};

/**
 * Decrypts a string using AES-256-GCM
 * FIX: Decrypt failure now logs a clear error and returns a controlled fallback
 *      rather than silently returning ciphertext, which would be invisible corruption.
 */
export const decrypt = (encryptedText: any): string => {
    if (!encryptedText || typeof encryptedText !== "string") return encryptedText;
    if (!ENCRYPTION_KEY) {
        throw new Error("ENCRYPTION_KEY MUST be set in environment variables.");
    }

    // Strict regex detection for AES-256-GCM format (iv:authTag:ciphertext)
    // IV (24 hex) : AuthTag (32 hex) : Ciphertext (hex)
    const gcmRegex = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

    // Legacy detection for AES-256-CBC format (iv:ciphertext)
    // IV (32 hex) : Ciphertext (hex)
    const cbcRegex = /^[0-9a-f]{32}:[0-9a-f]+$/;

    if (gcmRegex.test(encryptedText)) {
        try {
            const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
            const iv = Buffer.from(ivHex, "hex");
            const authTag = Buffer.from(authTagHex, "hex");
            const decipher = crypto.createDecipheriv(
                ALGORITHM,
                Buffer.from(ENCRYPTION_KEY, "hex"),
                iv
            );

            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encrypted, "hex", "utf8");
            decrypted += decipher.final("utf8");

            return decrypted;
        } catch (error) {
            // FIX: Log clearly — this is likely a key rotation issue or data corruption.
            // Return empty string instead of ciphertext so callers get "" not garbled data.
            console.error(
                "[Crypto] GCM Decryption failure. Possible key mismatch or data corruption. " +
                "If ENCRYPTION_KEY was recently rotated, old records need re-encryption.",
                error
            );
            return ""; // Return empty string — visibly wrong but not silently wrong
        }
    }

    if (cbcRegex.test(encryptedText)) {
        try {
            const [ivHex, encrypted] = encryptedText.split(":");
            const iv = Buffer.from(ivHex, "hex");

            // FIX: LEGACY_KEY is now from env variable (ENCRYPTION_KEY_LEGACY), not hardcoded
            const keysToTry = [ENCRYPTION_KEY, LEGACY_KEY].filter(Boolean) as string[];

            for (const k of keysToTry) {
                try {
                    const decipher = crypto.createDecipheriv(
                        "aes-256-cbc",
                        Buffer.from(k, "hex"),
                        iv
                    );
                    let decrypted = decipher.update(encrypted, "hex", "utf8");
                    decrypted += decipher.final("utf8");
                    return decrypted;
                } catch (e) {
                    // Try next key
                }
            }
            // FIX: Clear log instead of silent fallback
            console.error(
                "[Crypto] CBC Legacy Decryption failed for all available keys. " +
                "Ensure ENCRYPTION_KEY_LEGACY is set in env if legacy CBC data exists."
            );
            return "";
        } catch (error) {
            console.error("[Crypto] Legacy CBC Decryption failure:", error);
            return "";
        }
    }

    // Not matching any encrypted format — return as-is (plain text compatibility)
    return encryptedText;
};

/**
 * Helper to decrypt an object or array recursively
 */
export const decryptObject = (obj: any): any => {
    if (!obj) return obj;

    // Skip recursion for Date objects - keep as is
    if (obj instanceof Date) return obj;

    // Skip recursion for Mongo/Mongoose ObjectIds - keep as is
    if (obj && obj._bsontype === 'Binary') return obj;
    if (obj && (obj.constructor?.name === 'ObjectId' || obj._bsontype === 'ObjectID')) return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => decryptObject(item));
    }

    if (typeof obj === 'object') {
        const decryptedObj: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                decryptedObj[key] = decrypt(value);
            } else if (typeof value === 'object' && value !== null) {
                decryptedObj[key] = decryptObject(value);
            } else {
                decryptedObj[key] = value;
            }
        }
        return decryptedObj;
    }

    return obj;
};

/**
 * Identify sensitive fields and handle their encryption/decryption
 */
export const SENSITIVE_FIELDS = [
    "panNumber",
    "aadharNumber",
    "pfNumber",
    "esiNumber",
    "uanNumber",
    "accountNumber",
    "ifscCode",
    "accountName"
];
