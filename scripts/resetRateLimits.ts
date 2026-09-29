/**
 * resetRateLimits.ts
 * One-shot script to clear all rate-limit keys from Redis / in-memory cache.
 * Run with:  npx ts-node --esm scripts/resetRateLimits.ts
 *        or: node --loader ts-node/esm scripts/resetRateLimits.ts
 */

import "dotenv/config";
import { Redis } from "ioredis";

const PATTERNS = [
  "ratelimit:*",        // enhancedRateLimiter (distributedRateLimiter)
  "auth:ip_login_rate:*", // loginRateLimiter (IP-based)
];

async function main() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.warn("⚠️  REDIS_URL not set — no Redis to flush. If you are using in-memory fallback, simply restart the backend server.");
    process.exit(0);
  }

  console.log("🔌 Connecting to Redis …");
  const client = new Redis(redisUrl);

  let totalDeleted = 0;

  for (const pattern of PATTERNS) {
    const keys = await client.keys(pattern);
    if (keys.length === 0) {
      console.log(`✅ No keys found for pattern: ${pattern}`);
      continue;
    }
    const deleted = await client.del(...keys);
    totalDeleted += deleted;
    console.log(`🗑️  Deleted ${deleted} key(s) matching "${pattern}"`);
    keys.forEach((k) => console.log(`   - ${k}`));
  }

  console.log(`\n✅ Done — ${totalDeleted} rate-limit key(s) cleared.`);
  await client.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
