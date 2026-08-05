import mongoose from "mongoose";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import Shipment from "../src/models/shipment.model.js";
import Expense from "../src/models/expense.model.js";
import { fetchImageForExcel, clearImageExportCache } from "../src/services/r2.service.js";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/gnxt";

async function testExports() {
  console.log("Starting Excel Image Embedding Verification...");
  await mongoose.connect(MONGODB_URI);

  // Test Shipment Image Fetching
  const shipment = await Shipment.findOne({ "destinations.podImages": { $exists: true, $not: { $size: 0 } } });
  if (shipment) {
    const firstImgUrl = shipment.destinations.find(d => d.podImages?.length > 0)?.podImages[0];
    console.log("Sample Shipment POD URL:", firstImgUrl);
    const fetched = await fetchImageForExcel(firstImgUrl);
    console.log("Fetched Shipment Image Result:", fetched ? `Buffer size ${fetched.buffer.length} bytes (${fetched.extension})` : "FAILED");
  } else {
    console.log("No shipments found with POD images.");
  }

  // Test Expense Image Fetching
  const expense = await Expense.findOne({ receiptUrl: { $exists: true, $ne: "" } });
  if (expense) {
    console.log("Sample Expense Receipt URL:", expense.receiptUrl);
    const fetched = await fetchImageForExcel(expense.receiptUrl);
    console.log("Fetched Expense Image Result:", fetched ? `Buffer size ${fetched.buffer.length} bytes (${fetched.extension})` : "FAILED");
  } else {
    console.log("No expenses found with receiptUrl.");
  }

  await mongoose.disconnect();
  console.log("Verification script finished cleanly!");
}

testExports();
