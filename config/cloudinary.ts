import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Robust loading of .env for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');

dotenv.config({ path: envPath });

const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

if (!cloudName || !apiKey || !apiSecret) {
    console.error("[CLOUDINARY ERROR] Missing Cloudinary configuration in .env");
    console.error(`- CLOUDINARY_CLOUD_NAME: ${cloudName ? "Set" : "Missing"}`);
    console.error(`- CLOUDINARY_API_KEY: ${apiKey ? "Set" : "Missing"}`);
    console.error(`- CLOUDINARY_API_SECRET: ${apiSecret ? "Set" : "Missing"}`);
}

cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
    analytics: false,
    sdk_analytics: false
});

console.log(`[CLOUDINARY] Config Loaded for Cloud: ${cloudName}`);

export default cloudinary;
