import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

async function testLogin() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const user = await db.collection("users").findOne({ email: "admin@gnxt.com" });
  if (!user) {
    console.log("User not found!");
    process.exit(1);
  }
  console.log("User found:", user.username, user.email, "Hash:", user.password);
  const isMatch = await bcrypt.compare("gnxt@admin@123", user.password);
  console.log("Password match:", isMatch);
  process.exit(0);
}

testLogin();
