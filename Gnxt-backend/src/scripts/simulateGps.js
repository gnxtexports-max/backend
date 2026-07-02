/**
 * simulateGps.js
 * ──────────────
 * Simulates the GPS device sending real-looking location updates
 * to your webhook every 5 seconds, moving the vehicle along a
 * route in Kerala.
 *
 * Run:  node src/scripts/simulateGps.js
 * Stop: Ctrl+C
 *
 * This proves the full pipeline works:
 *   GPS device → webhook → DB → frontend map updates live
 */

const WEBHOOK_URL = "http://localhost:5000/api/gps/webhook";
const DEVICE_IMEI = "869833082438627";
const VEHICLE_ID  = "KL07DC9716";
const INTERVAL_MS = 5000; // send a fix every 5 seconds

// A simple route: moving east along Kochi roads
// Each step moves ~50-100 metres
const routePoints = [
  { lat: 9.9312, lng: 76.2673, sp: 38.4, hd: 92.5 },
  { lat: 9.9314, lng: 76.2685, sp: 42.1, hd: 88.0 },
  { lat: 9.9316, lng: 76.2700, sp: 45.0, hd: 85.5 },
  { lat: 9.9318, lng: 76.2715, sp: 40.2, hd: 90.0 },
  { lat: 9.9320, lng: 76.2730, sp: 35.8, hd: 95.0 },
  { lat: 9.9322, lng: 76.2745, sp: 50.0, hd: 88.5 },
  { lat: 9.9325, lng: 76.2760, sp: 55.3, hd: 82.0 },
  { lat: 9.9327, lng: 76.2775, sp: 48.7, hd: 91.0 },
  { lat: 9.9329, lng: 76.2790, sp: 43.2, hd: 89.5 },
  { lat: 9.9331, lng: 76.2805, sp: 38.0, hd: 93.0 },
];

let step = 0;

async function sendFix() {
  const point = routePoints[step % routePoints.length];
  step++;

  const payload = {
    t:         "G",
    time:      Date.now(),
    device_id: DEVICE_IMEI,
    hd:        point.hd,
    sp:        point.sp,
    refid:     `sim-${Date.now()}`,
    ns:        9,
    alt:       7.2,
    geo: {
      lat: point.lat,
      lng: point.lng,
      acc: 3,
    },
    vehicle_id: VEHICLE_ID,
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    console.log(
      `[${new Date().toLocaleTimeString()}]  Fix #${step}  →  ` +
      `lat: ${point.lat}, lng: ${point.lng}  ` +
      `speed: ${point.sp} km/h  heading: ${point.hd}°  ` +
      `HTTP ${res.status}`
    );
  } catch (err) {
    console.error("Webhook call failed:", err.message);
  }
}

console.log("🚛  GPS Simulator started");
console.log(`   Device : ${DEVICE_IMEI}`);
console.log(`   Vehicle: ${VEHICLE_ID}`);
console.log(`   Webhook: ${WEBHOOK_URL}`);
console.log(`   Sending a fix every ${INTERVAL_MS / 1000}s — watch the map update live`);
console.log("   Press Ctrl+C to stop\n");

// Send first fix immediately, then every INTERVAL_MS
sendFix();
const timer = setInterval(sendFix, INTERVAL_MS);

process.on("SIGINT", () => {
  clearInterval(timer);
  console.log("\n⏹  Simulator stopped.");
  process.exit(0);
});
