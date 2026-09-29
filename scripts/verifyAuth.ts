import request from "supertest";
import express from "express";
// @ts-ignore
import cookieParser from "cookie-parser";

// Set test secrets before ANYTHING else is imported
process.env.JWT_SECRET = "test-access-secret-32-chars-at-least-minimum";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-chars-at-least-minimum";

// Dynamic imports to ensure TokenService reads the env vars after we set them
const { validateCsrf } = await import("../middleware/Auth/csrfMiddleware.js");
const { default: tenantMiddleware } = await import("../middleware/tenantMiddleware.js");
const { tokenService } = await import("../Auth/Services/tokenService.js");

// Mock App for testing middleware
const app = express();
app.use(express.json());
app.use(cookieParser());

// Mock Auth Middleware to simulate 'protect'
const mockProtect = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      req.user = tokenService.verifyAccessToken(token);
      next();
    } catch (err) {
      res.status(401).json({ message: "Invalid token" });
    }
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

// Mock CSRF route
app.post("/test-csrf", validateCsrf, (req, res) => {
  res.status(200).json({ success: true });
});

// Mock Tenant route (requires Auth first)
app.get("/test-tenant", mockProtect, tenantMiddleware.resolveTenant, (req, res) => {
  res.status(200).json({ success: true });
});

async function runTests() {
  console.log("🚀 Starting Auth Migration Verification...");

  // 1. Test CSRF Protection
  console.log("\n--- Testing CSRF Protection ---");
  const csrfToken = "test-csrf-token";
  
  const failCsrf = await request(app)
    .post("/test-csrf")
    .send({});
  console.log(failCsrf.status === 403 ? "✅ CSRF Blocked (Missing Token)" : "❌ CSRF Failed to Block");

  const successCsrf = await request(app)
    .post("/test-csrf")
    .set("Cookie", [`csrf_token=${csrfToken}`])
    .set("X-CSRF-Token", csrfToken)
    .send({});
  console.log(successCsrf.status === 200 ? "✅ CSRF Passed (Double Submit Match)" : "❌ CSRF Failed to Match");

  // 2. Test Tenant Isolation
  console.log("\n--- Testing Tenant Isolation ---");
  
  const mockUserToken = tokenService.generateTokens({
    _id: "65f1a2b3c4d5e6f7a8b9c0d1", // Valid MongoId string
    role: "staff",
    hospitals: ["65f1a2b3c4d5e6f7a8b9c0a1", "65f1a2b3c4d5e6f7a8b9c0b1"],
    sessionId: "sess_1"
  }).accessToken;

  console.log("Testing unauthorized hospital access...");
  const failTenant = await request(app)
    .get("/test-tenant")
    .set("Authorization", `Bearer ${mockUserToken}`)
    .set("X-Hospital-Id", "65f1a2b3c4d5e6f7a8b9c0c1"); // Not in user's hospital list
  console.log(failTenant.status === 403 ? "✅ Tenant Access Blocked (Isolation Intact)" : `❌ Tenant Isolation Breached (Status: ${failTenant.status})`);

  console.log("Testing authorized hospital access...");
  const successTenant = await request(app)
    .get("/test-tenant")
    .set("Authorization", `Bearer ${mockUserToken}`)
    .set("X-Hospital-Id", "65f1a2b3c4d5e6f7a8b9c0a1");
  console.log(successTenant.status === 200 ? "✅ Tenant Access Granted (Authorized)" : `❌ Tenant Access Failed: ${successTenant.status} ${JSON.stringify(successTenant.body)}`);

  console.log("\n🏁 Verification Complete.");
}

runTests().catch(console.error);
