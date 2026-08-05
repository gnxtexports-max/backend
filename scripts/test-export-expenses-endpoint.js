import mongoose from "mongoose";
import dotenv from "dotenv";
import { exportExpenses } from "../src/controllers/expense.controller.js";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/gnxt";

async function testExpenseExportEndpoint() {
  await mongoose.connect(MONGODB_URI);
  console.log("Testing exportExpenses controller function...");

  const res = {
    headers: {},
    setHeader(key, val) { this.headers[key] = val; },
    status(code) { this.statusCode = code; return this; },
    json(data) { console.log("JSON response:", data); },
    on() {},
    once() {},
    emit() {},
    write() {},
    end() { console.log("Response stream ended successfully!"); }
  };

  const req = { query: {}, protocol: "http", get: () => "localhost:5000" };

  try {
    await exportExpenses(req, res);
    console.log("exportExpenses completed successfully! Status:", res.statusCode || 200);
  } catch (err) {
    console.error("exportExpenses error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

testExpenseExportEndpoint();
