import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";

const SUPER_ADMIN_MODULES = [
  "Dashboard",
  "Shipments",
  "Trip Tracking",
  "Invoices",
  "Expenses",
  "Vehicles",
  "Drivers",
  "Reports",
  "Help & Support",
  "Users",
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
      console.log("⚙️  Auto-seeding initial Super Admin user...");
      superAdmin = new User({
        username: "admin",
        email: "admin@gnxt.com",
        password: "gnxt@admin@123", // Initial bootstrap password; hashed automatically by pre-save hook
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

      console.log("✅ Initial Super Admin seeded successfully (Username: admin, Email: admin@gnxt.com).");
    } else {
      // Super Admin exists — preserve existing credentials and permissions completely
      console.log("✅ Super Admin verified.");
    }
  } catch (error) {
    console.error("❌ Auto-seeding Super Admin notice:", error.message);
  }
};
