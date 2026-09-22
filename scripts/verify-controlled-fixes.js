/**
 * GNXT Controlled Fix Verification Test Suite
 * Validates that all critical & high priority fixes are correctly implemented
 * and that schemas, guards, filters, and routes meet security and performance requirements.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

const passedTests = [];
const failedTests = [];

function runTest(name, fn) {
  try {
    fn();
    passedTests.push(name);
    console.log(`\x1b[32m✔ PASS:\x1b[0m ${name}`);
  } catch (err) {
    failedTests.push({ name, error: err.message });
    console.error(`\x1b[31m✘ FAIL:\x1b[0m ${name}`);
    console.error(`  Error: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    passedTests.push(name);
    console.log(`\x1b[32m✔ PASS:\x1b[0m ${name}`);
  } catch (err) {
    failedTests.push({ name, error: err.message });
    console.error(`\x1b[31m✘ FAIL:\x1b[0m ${name}`);
    console.error(`  Error: ${err.message}`);
  }
}

console.log("==================================================");
console.log("    GNXT CONTROLLED FIX PHASE - TEST SUITE        ");
console.log("==================================================\n");

// 1. Schema Enum Tests
await runAsyncTest("TripEvent schema accepts 'GPS_OFFLINE'", async () => {
  const { default: TripEvent } = await import("../src/models/TripEvent.js");
  const eventTypePath = TripEvent.schema.path("eventType");
  assert(eventTypePath.enumValues.includes("GPS_OFFLINE"), "GPS_OFFLINE must be in TripEvent eventType enum");
});

await runAsyncTest("VehicleLocation schema accepts 'Offline'", async () => {
  const { default: VehicleLocation } = await import("../src/models/VehicleLocation.js");
  const statusPath = VehicleLocation.schema.path("vehicleStatus");
  assert(statusPath.enumValues.includes("Offline"), "'Offline' must be in VehicleLocation vehicleStatus enum");
});

await runAsyncTest("Vehicle schema accepts 'Offline'", async () => {
  const { default: Vehicle } = await import("../src/models/Vehicle.js");
  const statusPath = Vehicle.schema.path("status");
  assert(statusPath.enumValues.includes("Offline"), "'Offline' must be in Vehicle status enum");
});

// 2. Secret Sanitization & Config Tests
runTest("db.js has no hardcoded Atlas URI fallback", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/config/db.js"), "utf-8");
  assert(!content.includes("FALLBACK_ATLAS_URI"), "FALLBACK_ATLAS_URI should be completely removed");
  assert(!content.includes("mongodb+srv://"), "No hardcoded mongodb+srv URI strings allowed in db.js");
});

runTest("r2.service.js has no hardcoded credentials", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/services/r2.service.js"), "utf-8");
  assert(!content.includes("499092822a106f3be4d048dc7efcfd13"), "Hardcoded R2 account ID should be removed");
  assert(!content.includes("421bb9b216c5bfae7e6d05f32eb6368d"), "Hardcoded R2 access key should be removed");
  assert(!content.includes("88fffc6d4aaebaa0e1c2e4313f8d229f"), "Hardcoded R2 secret key should be removed");
});

runTest("cloudflare_api_data.txt contains no plaintext secret credentials", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/cloudflare_api_data.txt"), "utf-8");
  assert(!content.includes("499092822a106f3be4d048dc7efcfd13"), "Plaintext R2 account ID should be sanitized");
  assert(!content.includes("88fffc6d4aaebaa0e1c2e4313f8d229f"), "Plaintext R2 secret key should be sanitized");
});

// 3. Security Middleware & Auth Tests
runTest("auth.middleware.js has no hardcoded super admin bypass ID", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/middleware/auth.middleware.js"), "utf-8");
  assert(!content.includes("000000000000000000000001"), "Hardcoded super admin ID bypass must be removed");
});

runTest("autoSeed.js does not overwrite existing Super Admin password or log credentials", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/utils/autoSeed.js"), "utf-8");
  assert(content.includes("Super Admin verified") || content.includes("preserve existing credentials"), "Existing super admin must be preserved");
  assert(!content.includes("admin123"), "Default plaintext password should not be hardcoded in seeding logs");
});

runTest("shipment.routes.js protects POD route with authentication and permission check", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/routes/shipment.routes.js"), "utf-8");
  assert(content.includes("router.use(authenticate)"), "shipment router must use authenticate middleware");
  assert(content.includes("/:id/pod/:podIndex") && content.includes('requirePermission("Shipments", "view")'), "GET /:id/pod/:podIndex must require view permission");
});

runTest("expense.routes.js protects receipt route with authentication and permission check", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/routes/expense.routes.js"), "utf-8");
  assert(content.includes("router.use(authenticate)"), "expense router must use authenticate middleware");
  assert(content.includes("/:id/receipt") && content.includes('requirePermission("Expenses", "view")'), "GET /:id/receipt must require view permission");
});

runTest("app.js has rate limiters on login and upload, and database check on /health", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/app.js"), "utf-8");
  assert(content.includes("authLimiter"), "app.js must include authLimiter");
  assert(content.includes("uploadLimiter"), "app.js must include uploadLimiter");
  assert(content.includes("mongoose.connection.readyState"), "Health endpoint must inspect mongoose readyState");
});

runTest("upload.middleware.js enforces fileFilter and 15MB limit", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/middleware/upload.middleware.js"), "utf-8");
  assert(content.includes("fileFilter"), "upload.middleware.js must define fileFilter");
  assert(content.includes("15 * 1024 * 1024"), "upload.middleware.js must enforce 15MB limit");
  assert(!content.includes("30 * 1024 * 1024"), "Old 30MB limit must be removed");
});

// 4. Performance & Controller Logic Tests
runTest("invoice.controller.js does not fetch all shipments on every request", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/controllers/invoice.controller.js"), "utf-8");
  assert(!content.includes("Shipment.find().lean()"), "Whole-table Shipment.find() scan must be removed from invoice controller");
  assert(content.includes("calculatePodStatus"), "POD status computation must still exist");
  assert(content.includes("paginatedData.forEach"), "POD calculation must only run on paginated data");
});

runTest("invoice.controller.js getInvoicesByPlant queries plantReferenceNumber", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/controllers/invoice.controller.js"), "utf-8");
  assert(content.includes("plantReferenceNumber: plantNumber"), "getInvoicesByPlant must query plantReferenceNumber");
});

runTest("dashboard.controller.js does not fetch all shipments without filters", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/controllers/dashboard.controller.js"), "utf-8");
  assert(!content.includes("Shipment.find({}).select(\"destinations podImages status\")"), "Whole-table Shipment.find({}) scan must be removed from dashboard controller");
  assert(content.includes("deliveredInvoices.map"), "Dashboard shipment query must filter by delivered invoices");
});

runTest("dashboard.controller.js handles pending invoices when pending shipments is empty", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/controllers/dashboard.controller.js"), "utf-8");
  assert(content.includes("pendingInvoicesCount = pendingInvoicesDocs.length"), "Dashboard must fall back to pendingInvoicesDocs");
});

runTest("shipment.controller.js combines date filter and search using $and", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/controllers/shipment.controller.js"), "utf-8");
  assert(content.includes("andClauses.push"), "getShipments must push filters into andClauses");
  assert(content.includes("query.$and = andClauses"), "query.$and must combine date and search clauses");
});

runTest("shipment.controller.js does not multiply inventory across multiple invoices", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/controllers/shipment.controller.js"), "utf-8");
  assert(content.includes("matchingInvoices.length === 1"), "syncInvoicesFromDestinations must only sync if exactly 1 invoice matches");
  assert(!content.includes("await Invoice.updateMany(query, {\n          tyre,\n          tube,\n          flap,\n          weight,\n          quantity\n        });"), "Unbounded Invoice.updateMany must not overwrite multi-invoice destinations");
});

runTest("expense.controller.js supports pagination while remaining backwards compatible", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/controllers/expense.controller.js"), "utf-8");
  assert(content.includes("isPaginated = req.query.page !== undefined"), "getExpenses must detect pagination parameter");
  assert(content.includes("res.status(200).json(shaped)"), "getExpenses must return array directly when unpaginated");
  assert(content.includes("pagination: {"), "getExpenses must return pagination object when paginated");
});

runTest("exportToZip.js streams workbook directly without synchronous fs write", () => {
  const content = fs.readFileSync(path.join(backendRoot, "src/utils/exportToZip.js"), "utf-8");
  assert(content.includes("await workbook.xlsx.write(res)"), "streamExcelExport must stream directly using workbook.xlsx.write");
  assert(!content.includes("fs.writeFileSync(tmpXlsx"), "Synchronous temporary file write must be removed");
});

console.log("\n==================================================");
console.log(`TOTAL TESTS: ${passedTests.length + failedTests.length}`);
console.log(`PASSED:      ${passedTests.length}`);
console.log(`FAILED:      ${failedTests.length}`);
console.log("==================================================");

if (failedTests.length > 0) {
  console.error("Some tests failed!");
  process.exit(1);
} else {
  console.log("All controlled fix verifications passed successfully!");
  process.exit(0);
}
