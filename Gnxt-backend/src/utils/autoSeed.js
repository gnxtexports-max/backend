import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";

const SUPER_ADMIN_MODULES = [
  "Shipments & LR Management",
  "Fleet & Vehicle Tracking",
  "Invoice & Finance",
  "Master Data (Dealers/Products)",
  "User & Role Management",
  "Reports & Analytics",
  "Expenses",
  "Trip Tracking",
];

const fullAccess = SUPER_ADMIN_MODULES.map((m) => ({
  module: m,
  view: true,
  create: true,
  edit: true,
  delete: true,
}));

export const autoSeedSuperAdmin = async () => {
  try {
    // Look for any existing Super Admin by role, email, or username
    let superAdmin = await User.findOne({
      $or: [
        { role: "Super Admin" },
        { email: "admin@gnxt.com" },
        { username: "admin" }
      ]
    });

    if (!superAdmin) {
      console.log("⚙️  Auto-seeding Super Admin user...");
      superAdmin = new User({
        username: "admin",
        email: "admin@gnxt.com",
        password: "gnxt@admin@123", // Will be hashed automatically by the pre-save hook
        role: "Super Admin",
        branch: "All Branches",
        status: "Active",
        avatar: "SA",
        permissions: fullAccess,
      });

      await superAdmin.save();

      await ActivityLog.create({
        userId: superAdmin._id,
        userName: "admin",
        action: "User Created",
        target: "System",
        ipAddress: "127.0.0.1",
        status: "Success",
      });

      console.log("✅ Super Admin seeded successfully:");
      console.log("   Username : admin");
      console.log("   Email    : admin@gnxt.com");
      console.log("   Password : gnxt@admin@123");
    } else {
      console.log("ℹ️  Super Admin user exists. Syncing credentials to admin@gnxt.com / gnxt@admin@123...");
      superAdmin.email = "admin@gnxt.com";
      superAdmin.password = "gnxt@admin@123"; // Will be hashed by pre-save hook on save
      superAdmin.role = "Super Admin";
      superAdmin.status = "Active";
      superAdmin.permissions = fullAccess;
      
      await superAdmin.save();
      console.log("✅ Super Admin credentials updated and synced successfully in DB.");
    }
  } catch (error) {
    console.error("❌ Auto-seeding Super Admin failed:", error.message);
  }
};
