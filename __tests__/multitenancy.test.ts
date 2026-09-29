/**
 * MULTI-TENANCY TEST SUITE
 *
 * Comprehensive tests to validate tenant isolation and security
 */

import request from "supertest";
import { app } from "../app.js";
import mongoose from "mongoose";
import Hospital from "../Hospital/Models/Hospital.js";
import User from "../Auth/Models/User.js";
import Appointment from "../Appointment/Models/Appointment.js";
import {
  setTenantContext,
  clearTenantContext,
} from "../middleware/tenantPlugin.js";

describe("Multi-Tenancy Tests", () => {
  let hospital1: any;
  let hospital2: any;
  let admin1: any;
  let admin2: any;
  let superAdmin: any;
  let admin1Token: string;
  let admin2Token: string;
  let superAdminToken: string;

  beforeAll(async () => {
    // Setup test database
    await mongoose.connect(
      process.env.TEST_MONGO_URI || "mongodb://localhost:27017/test",
    );
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Clear all collections
    await Hospital.deleteMany({});
    await User.deleteMany({});
    await Appointment.deleteMany({});

    // Create test hospitals
    hospital1 = await Hospital.create({
      name: "Hospital 1",
      address: "123 Main St",
      status: "approved",
    });

    hospital2 = await Hospital.create({
      name: "Hospital 2",
      address: "456 Oak Ave",
      status: "approved",
    });

    // Create hospital admins
    admin1 = await User.create({
      name: "Admin 1",
      email: "admin1@test.com",
      password: "password123",
      role: "hospital-admin",
      hospital: hospital1._id,
    });

    admin2 = await User.create({
      name: "Admin 2",
      email: "admin2@test.com",
      password: "password123",
      role: "hospital-admin",
      hospital: hospital2._id,
    });

    // Create super admin
    superAdmin = await User.create({
      name: "Super Admin",
      email: "superadmin@test.com",
      password: "password123",
      role: "super-admin",
    });

    // Get authentication tokens (you'll need to implement this based on your auth system)
    admin1Token = await getAuthToken(admin1);
    admin2Token = await getAuthToken(admin2);
    superAdminToken = await getAuthToken(superAdmin);
  });

  describe("1. Tenant Context Resolution", () => {
    it("should resolve tenant from authenticated user", async () => {
      const response = await request(app)
        .get("/api/appointments")
        .set("Authorization", `Bearer ${admin1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.tenantId).toBe(hospital1._id.toString());
    });

    it("should mark SuperAdmin correctly", async () => {
      const response = await request(app)
        .get("/api/appointments")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.isSuperAdmin).toBe(true);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await request(app).get("/api/appointments");

      expect(response.status).toBe(401);
    });
  });

  describe("2. Data Isolation", () => {
    let appointment1: any;
    let appointment2: any;

    beforeEach(async () => {
      // Create test appointments
      appointment1 = await Appointment.create({
        hospital: hospital1._id,
        patient: new mongoose.Types.ObjectId(),
        doctor: new mongoose.Types.ObjectId(),
        date: new Date(),
        status: "confirmed",
      });

      appointment2 = await Appointment.create({
        hospital: hospital2._id,
        patient: new mongoose.Types.ObjectId(),
        doctor: new mongoose.Types.ObjectId(),
        date: new Date(),
        status: "confirmed",
      });
    });

    it("should only return hospital 1 data for admin 1", async () => {
      const response = await request(app)
        .get("/api/appointments")
        .set("Authorization", `Bearer ${admin1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]._id).toBe(appointment1._id.toString());
    });

    it("should only return hospital 2 data for admin 2", async () => {
      const response = await request(app)
        .get("/api/appointments")
        .set("Authorization", `Bearer ${admin2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]._id).toBe(appointment2._id.toString());
    });

    it("should return all data for SuperAdmin", async () => {
      const response = await request(app)
        .get("/api/admin/appointments/all")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("3. Cross-Tenant Access Prevention", () => {
    let appointment1: any;

    beforeEach(async () => {
      appointment1 = await Appointment.create({
        hospital: hospital1._id,
        patient: new mongoose.Types.ObjectId(),
        doctor: new mongoose.Types.ObjectId(),
        date: new Date(),
        status: "confirmed",
      });
    });

    it("should prevent admin 2 from accessing hospital 1 appointment", async () => {
      const response = await request(app)
        .get(`/api/appointments/${appointment1._id}`)
        .set("Authorization", `Bearer ${admin2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("another hospital");
    });

    it("should prevent admin 2 from updating hospital 1 appointment", async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointment1._id}`)
        .set("Authorization", `Bearer ${admin2Token}`)
        .send({ status: "cancelled" });

      expect(response.status).toBe(403);
    });

    it("should prevent admin 2 from deleting hospital 1 appointment", async () => {
      const response = await request(app)
        .delete(`/api/appointments/${appointment1._id}`)
        .set("Authorization", `Bearer ${admin2Token}`);

      expect(response.status).toBe(403);
    });
  });

  describe("4. Automatic Tenant Assignment", () => {
    it("should auto-assign hospital to new appointment", async () => {
      const response = await request(app)
        .post("/api/appointments")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({
          patient: new mongoose.Types.ObjectId(),
          doctor: new mongoose.Types.ObjectId(),
          date: new Date(),
          status: "pending",
        });

      expect(response.status).toBe(201);
      expect(response.body.data.hospital).toBe(hospital1._id.toString());
    });

    it("should reject creation without tenant context", async () => {
      // Simulate missing hospital context
      const userWithoutHospital = await User.create({
        name: "No Hospital User",
        email: "nohosp@test.com",
        password: "password123",
        role: "doctor",
      });

      const token = await getAuthToken(userWithoutHospital);

      const response = await request(app)
        .post("/api/appointments")
        .set("Authorization", `Bearer ${token}`)
        .send({
          patient: new mongoose.Types.ObjectId(),
          doctor: new mongoose.Types.ObjectId(),
          date: new Date(),
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain("Hospital context required");
    });
  });

  describe("5. SuperAdmin Hospital Switching", () => {
    it("should allow SuperAdmin to filter by specific hospital via header", async () => {
      await Appointment.create([
        {
          hospital: hospital1._id,
          patient: new mongoose.Types.ObjectId(),
          doctor: new mongoose.Types.ObjectId(),
          date: new Date(),
        },
        {
          hospital: hospital2._id,
          patient: new mongoose.Types.ObjectId(),
          doctor: new mongoose.Types.ObjectId(),
          date: new Date(),
        },
      ]);

      const response = await request(app)
        .get("/api/appointments")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .set("X-Hospital-Id", hospital1._id.toString());

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].hospital).toBe(hospital1._id.toString());
    });
  });

  describe("6. Mongoose Plugin Query Scoping", () => {
    beforeEach(async () => {
      await Appointment.create([
        {
          hospital: hospital1._id,
          patient: new mongoose.Types.ObjectId(),
          doctor: new mongoose.Types.ObjectId(),
          date: new Date(),
          status: "confirmed",
        },
        {
          hospital: hospital2._id,
          patient: new mongoose.Types.ObjectId(),
          doctor: new mongoose.Types.ObjectId(),
          date: new Date(),
          status: "confirmed",
        },
      ]);
    });

    it("should automatically scope find queries", async () => {
      setTenantContext(hospital1._id, false);

      const results = await Appointment.find({});

      expect(results).toHaveLength(1);
      expect(results[0].hospital.toString()).toBe(hospital1._id.toString());

      clearTenantContext();
    });

    it("should automatically scope count queries", async () => {
      setTenantContext(hospital1._id, false);

      const count = await Appointment.countDocuments({});

      expect(count).toBe(1);

      clearTenantContext();
    });

    it("should allow SuperAdmin to bypass scoping", async () => {
      setTenantContext(null, true);

      const results = await Appointment.find({});

      expect(results).toHaveLength(2);

      clearTenantContext();
    });
  });

  describe("7. Hospital Field Immutability", () => {
    let appointment: any;

    beforeEach(async () => {
      appointment = await Appointment.create({
        hospital: hospital1._id,
        patient: new mongoose.Types.ObjectId(),
        doctor: new mongoose.Types.ObjectId(),
        date: new Date(),
      });
    });

    it("should prevent changing hospital field via update", async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointment._id}`)
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({ hospital: hospital2._id });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Cannot transfer");
    });
  });
});

/**
 * Helper function to get authentication token
 * You'll need to implement this based on your auth system
 */
async function getAuthToken(user: any): Promise<string> {
  // Implementation depends on your JWT generation logic
  // This is just a placeholder
  const response = await request(app).post("/api/auth/login").send({
    email: user.email,
    password: "password123",
  });

  return response.body.token;
}
