import express from "express";
import {
  receiveGpsWebhook,
  getVehicleLocation,
  getVehicleHistory,
  getAllVehicleLocations,
  getTripEvents,
  getShipmentTracking,
} from "../controllers/gps.controller.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

// GPS device pushes here (public webhook)
router.post("/webhook", receiveGpsWebhook);

// User-facing GPS tracking endpoints
router.use(authenticate);
router.use(requirePermission("Trip Tracking", "view"));

// Fleet overview
router.get("/all", getAllVehicleLocations);

// Per-vehicle
router.get("/location/:vehicleNo", getVehicleLocation);
router.get("/history/:vehicleNo", getVehicleHistory);

// Per-shipment
router.get("/events/:shipmentId", getTripEvents);
router.get("/shipment-track/:shipmentId", getShipmentTracking);

export default router;
