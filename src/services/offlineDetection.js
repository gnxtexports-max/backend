import VehicleLocation from "../models/VehicleLocation.js";
import Vehicle from "../models/Vehicle.js";
import TripEvent from "../models/TripEvent.js";
import Shipment from "../models/shipment.model.js";

// Offline threshold (e.g., no GPS ping for 15 minutes = 15 * 60 * 1000 ms)
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000; // run every minute

let ioInstance = null;
let intervalId = null;

export const startOfflineDetection = (io) => {
  ioInstance = io;
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(async () => {
    try {
      const offlineThresholdTime = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

      // Find vehicles that haven't updated since threshold, and are not already marked offline
      const offlineVehicles = await VehicleLocation.find({
        fixTime: { $lt: offlineThresholdTime },
        vehicleStatus: { $ne: "Offline" }
      }).lean();

      if (!offlineVehicles || offlineVehicles.length === 0) return;

      for (const loc of offlineVehicles) {
        // 1. Update VehicleLocation status
        await VehicleLocation.findByIdAndUpdate(loc._id, {
          vehicleStatus: "Offline",
          speed: 0 // Assume speed is 0 if offline
        });

        // 2. Update Vehicle status
        if (loc.vehicleId) {
          await Vehicle.findByIdAndUpdate(loc.vehicleId, {
            status: "Offline"
          });
        }

        // 3. Create a TripEvent if there is an active shipment
        if (loc.activeShipmentId) {
          // Check for recent offline event to avoid spamming
          const recentOfflineEvent = await TripEvent.findOne({
            shipmentId: loc.activeShipmentId,
            eventType: "GPS_OFFLINE",
            createdAt: { $gte: new Date(Date.now() - OFFLINE_THRESHOLD_MS) }
          }).lean();

          if (!recentOfflineEvent) {
            await TripEvent.create({
              shipmentId: loc.activeShipmentId,
              vehicleId: loc.vehicleId,
              vehicleNo: loc.vehicleNo,
              eventType: "GPS_OFFLINE",
              eventMessage: `Vehicle went offline. No GPS signal received for over 15 minutes.`,
              lat: loc.lat,
              lng: loc.lng,
              speed: 0
            });
          }
        }

        // 4. Emit to frontend
        if (ioInstance) {
          const broadcastPayload = {
            vehicleNo: loc.vehicleNo,
            vehicleId: loc.vehicleId?.toString(),
            shipmentId: loc.activeShipmentId?.toString(),
            lat: loc.lat,
            lng: loc.lng,
            speed: 0,
            fixTime: loc.fixTime,
            vehicleStatus: "Offline",
            imei: loc.deviceId || "",
          };

          ioInstance.emit("gps:update", broadcastPayload);
          ioInstance.to(`vehicle:${loc.vehicleNo}`).emit("gps:update", broadcastPayload);
          if (loc.activeShipmentId) {
            ioInstance.to(`shipment:${loc.activeShipmentId}`).emit("gps:update", broadcastPayload);
          }
        }
        
        console.log(`[Offline Detection] Vehicle ${loc.vehicleNo} marked as Offline.`);
      }
    } catch (err) {
      console.error("[Offline Detection] Error running check:", err.message);
    }
  }, CHECK_INTERVAL_MS);
  
  console.log(`✅ Offline Detection service started (runs every ${CHECK_INTERVAL_MS/1000}s)`);
};

export const stopOfflineDetection = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};
