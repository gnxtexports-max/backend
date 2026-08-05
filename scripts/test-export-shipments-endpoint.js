import mongoose from "mongoose";
import dotenv from "dotenv";
import { exportShipments } from "../src/controllers/shipment.controller.js";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/gnxt";

async function testExportEndpoint() {
  await mongoose.connect(MONGODB_URI);
  console.log("Testing exportShipments controller function...");

  // Mock Express res object
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

  const req = { query: {} };

  try {
    await exportShipments(req, res);
    console.log("exportShipments completed without errors! Status:", res.statusCode || 200);
  } catch (err) {
    console.error("exportShipments error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

testExportEndpoint();
