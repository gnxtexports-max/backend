import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });

import Expense from "../models/expense.model.js";

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const expenses = await Expense.find({}).lean();
  console.log("ALL EXPENSES IN DB:");
  console.log(JSON.stringify(expenses, null, 2));
  await mongoose.disconnect();
}

run().catch(console.error);
