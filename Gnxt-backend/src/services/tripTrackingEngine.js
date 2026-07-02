/**
 * tripTrackingEngine.js
 * ─────────────────────
 * Core business logic for GPS processing:
 *   1. Find vehicle + active shipment from IMEI / vehicle_id
 *   2. Store GPS log (deduplicated)
 *   3. Update latest vehicle location
 *   4. Run trip status automation (Moving / Idle / Arrived)
 *   5. Run geofence detection
 *   6. Emit Socket.io events to connected frontend clients
 */

import GpsLog          from "../models/GpsLog.js";
import TripEvent       from "../models/TripEvent.js";
import VehicleLocation from "../models/VehicleLocation.js";
import Vehicle         from "../models/Vehicle.js";
import Shipment        from "../models/shipment.model.js";

/* ── Constants ─────────────────────────────────── */
const IDLE_THRESHOLD_SECONDS = 300;   // 5 min stopped → IDLE event
const ARRIVAL_RADIUS_METRES  = 500;   // within 500 m of destination → arrived
const EARTH_RADIUS_KM        = 6371;

/* ── Haversine distance (metres) ─────────────────── */
function distanceMetres(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLng  = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000;
}

/* ── Parse destination coordinates from string "City, State" ── */
// We don't have lat/lng for destinations stored — geofence uses a
// rough lookup table for known cities. Extend as needed.
const CITY_COORDS = {
  "kochi":       { lat: 9.9312,  lng: 76.2673 },
  "ernakulam":   { lat: 9.9816,  lng: 76.2999 },
  "trivandrum":  { lat: 8.5241,  lng: 76.9366 },
  "kozhikode":   { lat: 11.2588, lng: 75.7804 },
  "thrissur":    { lat: 10.5276, lng: 76.2144 },
  "kollam":      { lat: 8.8932,  lng: 76.6141 },
  "pune":        { lat: 18.5204, lng: 73.8567 },
  "mumbai":      { lat: 19.0760, lng: 72.8777 },
  "nagpur":      { lat: 21.1458, lng: 79.0882 },
  "nashik":      { lat: 19.9975, lng: 73.7898 },
  "aurangabad":  { lat: 19.8762, lng: 75.3433 },
};

function getDestCoords(locationStr) {
  if (!locationStr) return null;
  const key = locationStr.split(",")[0].trim().toLowerCase();
  return CITY_COORDS[key] ?? null;
}

/* ── Create a trip event (deduped by type within 60s) ─────── */
async function createEvent(shipmentId, vehicleId, vehicleNo, eventType, message, lat, lng, speed, heading, accuracy, altitude, meta = {}) {
  try {
    // Avoid duplicate events of same type within 60 seconds
    const recent = await TripEvent.findOne({
      shipmentId,
      eventType,
      createdAt: { $gte: new Date(Date.now() - 60_000) },
    }).lean();
    if (recent) return;

    await TripEvent.create({
      shipmentId, vehicleId, vehicleNo,
      eventType, eventMessage: message,
      lat, lng, speed, heading, accuracy, altitude, meta,
    });
  } catch (err) {
    console.error("TripEvent create error:", err.message);
  }
}

/* ── Main processing function ─────────────────────────────── */
export async function processGpsPayload(payload, io) {
  const {
    t,
    time,
    device_id: imei,
    vehicle_id: rawVehicleNo,
    sp: speed   = 0,
    hd: heading = 0,
    alt: altitude = 0,
    ns: satellites = 0,
    refid,
    geo,
  } = payload;

  // Coordinate check (redundant but safe)
  const lat = geo?.lat;
  const lng = geo?.lng;
  const acc = geo?.acc ?? 0;
  if (lat == null || lng == null) return;

  const vehicleNo = (rawVehicleNo || "").trim().toUpperCase();

  // Determine fix time:
  // 1. If t is a number, it's an epoch timestamp
  // 2. If time is a valid date (not "G"), use it
  // 3. Fallback to current time
  let fixTime = new Date();
  if (typeof t === "number") {
    fixTime = new Date(t);
  } else if (time && time !== "G") {
    fixTime = new Date(time);
  }

  /* ── 1. Find vehicle ─────────────────────────── */
  let vehicle = null;

  // Try by IMEI first (most reliable)
  if (imei) {
    vehicle = await Vehicle.findOne({ gpsImei: imei }).lean();
  }
  // Fallback: match by vehicle registration number
  if (!vehicle && vehicleNo) {
    vehicle = await Vehicle.findOne({
      vehicleNo: { $regex: new RegExp(`^${vehicleNo.replace(/\s/g, "\\s*")}$`, "i") },
    }).lean();
  }

  const resolvedVehicleNo = vehicle?.vehicleNo ?? vehicleNo;
  const vehicleId         = vehicle?._id ?? null;

  /* ── 2. Find active shipment ─────────────────── */
  let shipment = null;
  if (vehicleId) {
    shipment = await Shipment.findOne({
      vehicleId,
      status: "In Transit",
    })
      .sort({ dispatchDate: -1 })
      .lean();
  }

  /* ── 3. Store GPS log (skip duplicates via refid) ── */
  try {
    await GpsLog.create({
      imei:         imei || "",
      vehicleNo:    resolvedVehicleNo,
      vehicleId:    vehicleId || undefined,
      shipmentId:   shipment?._id || undefined,
      lat, lng, speed, heading, altitude,
      accuracy:     acc,
      satellites,
      gpsTimestamp: fixTime,
      refid:        refid || undefined,
      rawPayload:   payload,
    });
  } catch (err) {
    // Duplicate refid → silently skip
    if (err.code !== 11000) console.error("GpsLog insert error:", err.message);
  }

  /* ── 4. Update latest vehicle location ──────── */
  const vehicleStatus = speed > 2 ? "Moving" : "Stopped";

  const locationDoc = await VehicleLocation.findOneAndUpdate(
    { vehicleNo: resolvedVehicleNo },
    {
      $set: {
        deviceId:    imei || "",
        lat, lng, acc, speed, heading, altitude,
        satellites,
        fixTime,
        vehicleStatus,
        rawPayload:  payload,
        ...(vehicleId    && { vehicleId }),
        ...(shipment?._id && { activeShipmentId: shipment._id }),
      },
      $push: {
        history: {
          $each:  [{ lat, lng, speed, heading, fixTime, acc }],
          $slice: -500,
        },
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  // Update Vehicle document status
  if (vehicleId) {
    await Vehicle.findByIdAndUpdate(vehicleId, {
      status: vehicleStatus === "Moving" ? "In Transit" : "Idle",
    });
  }

  /* ── 5. Trip status automation ───────────────── */
  if (shipment) {
    const prevLocation = await VehicleLocation.findOne(
      { vehicleNo: resolvedVehicleNo },
      { vehicleStatus: 1, fixTime: 1 }
    ).lean();

    // TRIP_STARTED — first fix for this shipment
    const logCount = await GpsLog.countDocuments({ shipmentId: shipment._id });
    if (logCount === 1) {
      await createEvent(
        shipment._id, vehicleId, resolvedVehicleNo,
        "TRIP_STARTED",
        `Trip started for shipment ${shipment.shipmentId}`,
        lat, lng, speed, heading, acc, altitude
      );
    }

    // VEHICLE_MOVING
    if (speed > 2) {
      await createEvent(
        shipment._id, vehicleId, resolvedVehicleNo,
        "VEHICLE_MOVING",
        `Vehicle moving at ${speed.toFixed(1)} km/h`,
        lat, lng, speed, heading, acc, altitude
      );
    }

    // VEHICLE_IDLE — stopped for > IDLE_THRESHOLD_SECONDS
    if (speed === 0 && locationDoc?.fixTime) {
      const stoppedSince = (Date.now() - new Date(locationDoc.fixTime).getTime()) / 1000;
      if (stoppedSince > IDLE_THRESHOLD_SECONDS) {
        await createEvent(
          shipment._id, vehicleId, resolvedVehicleNo,
          "VEHICLE_IDLE",
          `Vehicle idle for ${Math.round(stoppedSince / 60)} minutes`,
          lat, lng, speed, heading, acc, altitude,
          { idleSeconds: Math.round(stoppedSince) }
        );
      }
    }

    /* ── 6. Geofence detection ─────────────────── */
    for (const dest of shipment.destinations ?? []) {
      const destCoords = getDestCoords(dest.deliveryLocation);
      if (!destCoords) continue;

      const dist = distanceMetres(lat, lng, destCoords.lat, destCoords.lng);

      if (dist <= ARRIVAL_RADIUS_METRES) {
        await createEvent(
          shipment._id, vehicleId, resolvedVehicleNo,
          "REACHED_DESTINATION",
          `Vehicle arrived at ${dest.deliveryLocation} (${dest.customerName}) — ${Math.round(dist)} m from destination`,
          lat, lng, speed, heading, acc, altitude,
          { destinationId: dest._id, distanceMetres: Math.round(dist), lrNumber: dest.lrNumber }
        );

        // Auto-update shipment status to Delivered if all destinations reached
        const allEvents = await TripEvent.find({
          shipmentId: shipment._id,
          eventType:  "REACHED_DESTINATION",
        }).lean();

        if (allEvents.length >= (shipment.destinations?.length ?? 1)) {
          await Shipment.findByIdAndUpdate(shipment._id, {
            status:       "Delivered",
            deliveryDate: new Date(),
          });
          await createEvent(
            shipment._id, vehicleId, resolvedVehicleNo,
            "TRIP_COMPLETED",
            `All destinations reached. Trip completed for ${shipment.shipmentId}`,
            lat, lng, speed, heading, acc, altitude
          );
        }
      }
    }
  }

  /* ── 7. Broadcast via Socket.io ──────────────── */
  if (io) {
    const broadcastPayload = {
      vehicleNo:    resolvedVehicleNo,
      vehicleId:    vehicleId?.toString(),
      shipmentId:   shipment?._id?.toString(),
      shipmentRef:  shipment?.shipmentId,
      lat, lng, speed, heading, altitude,
      accuracy:     acc,
      satellites,
      fixTime:      fixTime.toISOString(),
      vehicleStatus,
      imei:         imei || "",
    };

    // Broadcast to all connected clients
    io.emit("gps:update", broadcastPayload);

    // Also broadcast to vehicle-specific room
    io.to(`vehicle:${resolvedVehicleNo}`).emit("gps:update", broadcastPayload);

    // And shipment-specific room
    if (shipment?._id) {
      io.to(`shipment:${shipment._id}`).emit("gps:update", broadcastPayload);
    }
  }

  return { vehicleNo: resolvedVehicleNo, vehicleId, shipmentId: shipment?._id };
}
