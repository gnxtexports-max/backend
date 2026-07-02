import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB for activation");

  const user = await User.findOne({ username: "admin" });
  if (user) {
    console.log("Current User Status:", user.status);
    user.status = "Active";
    await user.save();
    console.log("Updated User Status to Active!");
  } else {
    console.log("User 'admin' not found.");
  }
  process.exit(0);
}

run().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
