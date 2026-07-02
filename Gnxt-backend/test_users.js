import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./src/models/User.js";

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const users = await User.find({}, 'username email role permissions granularPermissions');
    console.log(JSON.stringify(users, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
