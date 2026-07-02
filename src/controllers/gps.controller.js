import VehicleLocation      from "../models/VehicleLocation.js";
import GpsLog               from "../models/GpsLog.js";
import TripEvent            from "../models/TripEvent.js";
import Shipment             from "../models/shipment.model.js";
import { processGpsPayload } from "../services/tripTrackingEngine.js";

/* ── Shared io reference (set by app.js after socket init) ── */
let _io = null;
export const setIo = (io) => { _io = io; };

/* ─────────────────────────────────────────────────
   POST /api/gps/webhook
   GPS device pushes location here.
   Responds 200 immediately, processes async.
───────────────────────────────────────────────── */
export const receiveGpsWebhook = async (req, res) => {
  console.log('GPS DATA:', req.body);

  // Respond 200 immediately — per spec, must not delay
  res.status(200).json({ success: true });

  const payload = req.body;

  // Basic validation
  if (!payload || typeof payload !== "object") return;
  if (!payload.geo?.lat || !payload.geo?.lng) return;

  // Log raw payload for debugging
  console.log(`[GPS] ${new Date().toISOString()} | device=${payload.device_id} vehicle=${payload.vehicle_id} lat=${payload.geo?.lat} lng=${payload.geo?.lng} sp=${payload.sp}`);

  // Process asynchronously — don't await
  processGpsPayload(payload, _io).catch((err) =>
    console.error("[GPS] Processing error:", err.message)
  );
};

/* ─────────────────────────────────────────────────
   GET /api/gps/location/:vehicleNo
   Latest GPS fix for one vehicle.
───────────────────────────────────────────────── */
export const getVehicleLocation = async (req, res) => {
  try {
    const vehicleNo = decodeURIComponent(req.params.vehicleNo).trim().toUpperCase();

    const loc = await VehicleLocation.findOne({
      vehicleNo: { $regex: new RegExp(`^${vehicleNo.replace(/\s/g, "\\s*")}$`, "i") },
    })
      .select("-rawPayload -history")
      .lean();

    if (!loc) {
      return res.status(404).json({ success: false, message: "No GPS data found for this vehicle" });
    }

    res.status(200).json({ success: true, data: loc });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching location", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/gps/history/:vehicleNo
   Last N GPS fixes for route polyline.
───────────────────────────────────────────────── */
export const getVehicleHistory = async (req, res) => {
  try {
    const vehicleNo = decodeURIComponent(req.params.vehicleNo).trim().toUpperCase();
    const limit     = Math.min(parseInt(req.query.limit) || 100, 500);

    // Use GpsLog for accurate history (ordered, deduplicated)
    const logs = await GpsLog.find({
      vehicleNo: { $regex: new RegExp(`^${vehicleNo.replace(/\s/g, "\\s*")}$`, "i") },
    })
      .sort({ gpsTimestamp: -1 })
      .limit(limit)
      .select("lat lng speed heading gpsTimestamp accuracy")
      .lean();

    if (!logs.length) {
      // Fallback to VehicleLocation history
      const loc = await VehicleLocation.findOne({
        vehicleNo: { $regex: new RegExp(`^${vehicleNo.replace(/\s/g, "\\s*")}$`, "i") },
      })
        .select("history")
        .lean();

      return res.status(200).json({
        success: true,
        data: (loc?.history ?? []).slice(-limit).reverse(),
      });
    }

    res.status(200).json({ success: true, data: logs.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching history", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/gps/all
   Latest location for ALL tracked vehicles.
───────────────────────────────────────────────── */
export const getAllVehicleLocations = async (req, res) => {
  try {
    const locations = await VehicleLocation.find()
      .select("-rawPayload -history")
      .lean();
    res.status(200).json({ success: true, data: locations });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching locations", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/gps/events/:shipmentId
   Trip events timeline for a shipment.
───────────────────────────────────────────────── */
export const getTripEvents = async (req, res) => {
  try {
    const events = await TripEvent.find({ shipmentId: req.params.shipmentId })
      .sort({ createdAt: 1 })
      .lean();
    res.status(200).json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching events", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/gps/shipment-track/:shipmentId
   Full tracking data for a shipment:
   latest location + route history + trip events.
───────────────────────────────────────────────── */
export const getShipmentTracking = async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);

    const [shipment, events, routeLogs] = await Promise.all([
      Shipment.findById(shipmentId)
        .populate("vehicleId", "vehicleNo gpsImei type model")
        .populate("driverId", "name phone")
        .lean(),
      TripEvent.find({ shipmentId }).sort({ createdAt: 1 }).lean(),
      GpsLog.find({ shipmentId })
        .sort({ gpsTimestamp: 1 })
        .limit(limit)
        .select("lat lng speed heading gpsTimestamp accuracy")
        .lean(),
    ]);

    if (!shipment) {
      return res.status(404).json({ success: false, message: "Shipment not found" });
    }

    // Get latest location
    const vehicleNo = shipment.vehicleNumber;
    const latestLoc = vehicleNo
      ? await VehicleLocation.findOne({ vehicleNo })
          .select("-rawPayload -history")
          .lean()
      : null;

    res.status(200).json({
      success: true,
      data: {
        shipment,
        latestLocation: latestLoc,
        routeHistory:   routeLogs,
        events,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching shipment tracking", error: err.message });
  }
};
