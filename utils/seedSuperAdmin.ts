import SuperAdmin from "../Auth/Models/SuperAdmin.js";
import User from "../Auth/Models/User.js";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export const seedSuperAdmin = async (): Promise<void> => {
  try {
    const superAdminEmail =
      process.env.SUPER_ADMIN_EMAIL || "superadmin@multicure.com";
    const superAdminPassword =
      process.env.SUPER_ADMIN_PASSWORD || "SuperAdmin@123";
    const superAdminName = process.env.SUPER_ADMIN_NAME || "Super Admin";
    const superAdminMobile = process.env.SUPER_ADMIN_MOBILE || "";

    // 1. Check if super admin already exists in NEW collection (by email or mobile)
    const existingSuperAdmin = await SuperAdmin.findOne({
      $or: [
        { email: superAdminEmail },
        { mobile: superAdminMobile }
      ]
    });

    if (existingSuperAdmin) {
      // Update mobile (and name) from .env on every restart so changes take effect
      const updates: Record<string, string> = {};
      if (superAdminMobile && existingSuperAdmin.mobile !== superAdminMobile) {
        updates.mobile = superAdminMobile;
      }
      if (existingSuperAdmin.email !== superAdminEmail) {
        updates.email = superAdminEmail;
      }
      if (existingSuperAdmin.name !== superAdminName) {
        updates.name = superAdminName;
      }
      if (Object.keys(updates).length > 0) {
        await SuperAdmin.updateOne({ email: superAdminEmail }, { $set: updates });
        console.log("✅ Super Admin updated from .env:", updates);
      } else {
        console.log("✅ Super Admin already exists in separate collection");
      }
      return;
    }

    // 2. Fallback: check if it exists in legacy User collection and migrate it
    const legacySA = await (User.findOne({ role: "super-admin" }) as any).unscoped();
    if (legacySA) {
      console.log("🔄 Migrating legacy Super Admin to separate collection...");
      await SuperAdmin.create({
        _id: legacySA._id,
        name: legacySA.name,
        email: legacySA.email,
        password: legacySA.password,
        mobile: superAdminMobile || undefined,
        role: "super-admin",
        status: "active",
      });
      console.log("✅ Migration complete");
      return;
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(superAdminPassword, SALT_ROUNDS);

    // 4. Create super admin in separate collection
    const superAdmin = new SuperAdmin({
      name: superAdminName,
      email: superAdminEmail,
      mobile: superAdminMobile || undefined,
      password: hashedPassword,
      role: "super-admin",
      status: "active",
    });

    await superAdmin.save();
    console.log("✅ Super Admin seeded successfully");
    console.log(`   Email: ${superAdminEmail}`);
    console.log(`   Mobile: ${superAdminMobile || "not set"}`);
    console.log(`   Default Password: ${superAdminPassword}`);
    console.log("   ⚠️  Please change the default password in production!");
  } catch (error) {
    console.error("❌ Error seeding super admin:", error);
    throw error;
  }
};
