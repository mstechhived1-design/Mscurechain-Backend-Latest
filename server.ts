import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import os from "os";

// 🔐 SECURITY: Load Environment Variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

// 🔐 SECURITY: Fail-fast if encryption key is missing or invalid
const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) {
  throw new Error("❌ CRITICAL: ENCRYPTION_KEY is missing from .env. Server cannot start.");
}

if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
  throw new Error("❌ CRITICAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).");
}

import logger from "./utils/logger.js";

logger.info("✅ Encryption system validated.");

import connectDB from "./config/db.js";
import { server } from "./app.js";
import { initReminderService } from "./services/reminderService.js";
import { initEscalationService } from "./services/vitalsEscalationService.js";
import { seedSuperAdmin } from "./utils/seedSuperAdmin.js";
import { redisService } from "./config/redis.js";

function getLocalIp(): string | undefined {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (netList) {
      for (const net of netList) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
  }
}

connectDB().then(async () => {
  const PORT = process.env.PORT || 4005;
  const ip = getLocalIp() || "localhost";
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || `http://${ip}:${PORT}`;

  // Seed Super Admin if not exists
  await seedSuperAdmin();

  server.listen(PORT as number, () => {
    logger.info(`Backend URLs:`);
    logger.info(`➡ Local:   http://localhost:${PORT}`);
    logger.info(`➡ Network: http://${ip}:${PORT}`);

    // Initialize Background Services
    initReminderService();
    initEscalationService();

    // ─── Redis Cache Verification ────────────────────────────────────────
    setTimeout(() => {
      const isRedis = redisService.getIsRedisAvailable();
      if (isRedis) {
        console.log('🟢 [Cache] API Cache → REDIS (fully active, persisted cache)');
      } else {
        console.warn('🟡 [Cache] API Cache → IN-MEMORY fallback (Redis not reachable)');
      }
    }, 1500); // wait 1.5s for Redis ready event to fire
  });
});
