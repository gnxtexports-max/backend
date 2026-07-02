/**
 * Seed Super Admin user
 * Run: node src/scripts/seedSuperAdmin.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";

dotenv.config();

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

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const existing = await User.findOne({ username: "admin" });
  if (existing) {
    console.log("ℹ️  Super Admin already exists — skipping seed.");
    process.exit(0);
  }

  const superAdmin = new User({
    username: "admin",
    email: "admin@gnxt.com",
    password: "gnxt@admin@123",      // will be hashed by pre-save hook
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

  console.log("✅ Super Admin seeded:");
  console.log("   Username : admin");
  console.log("   Email    : admin@gnxt.com");
  console.log("   Password : gnxt@admin@123");
  console.log("   Role     : Super Admin");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
