import express from "express";
import {
  createShipment,
  getShipments,
  getShipmentById,
  updateShipmentStatus,
  updateShipmentPOD,
  updateShipment,
  deleteShipment,
  getInvoicesByPlant,
  getPlantNumbers,
  getNextShipmentId,
  getShipmentsByDriver,
  getRelatedPlants,
  exportShipments,
  getShipmentPodImage,
  markArrival,
} from "../controllers/shipment.controller.js";
import { authenticate, requirePermission, requireSuperAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

// Preview next auto-generated IDs (must be before /:id)
router.get("/next-id", requirePermission("Shipments", "view"), getNextShipmentId);

// Plant data helpers (used by create form)
router.get("/plant-numbers", requirePermission("Shipments", "view"), getPlantNumbers);
router.get("/invoices-by-plant/:plantRef", requirePermission("Shipments", "view"), getInvoicesByPlant);
router.get("/by-driver/:driverId", requirePermission("Shipments", "view"), getShipmentsByDriver);
router.get("/related-plants/:plantRef", requirePermission("Shipments", "view"), getRelatedPlants);

// Shipment CRUD
router.post("/", requirePermission("Shipments", "create"), createShipment);
router.get("/export", requirePermission("Shipments", "view"), exportShipments);
router.get("/", requirePermission("Shipments", "view"), getShipments);
router.get("/:id/pod/:podIndex", requirePermission("Shipments", "view"), getShipmentPodImage);
router.get("/:id", requirePermission("Shipments", "view"), getShipmentById);
router.patch("/:id/status", requirePermission("Shipments", "edit"), updateShipmentStatus);
router.patch("/:id/arrival", requirePermission("Shipments", "edit"), markArrival);
router.patch("/:id/pod", requirePermission("Shipments", "edit"), updateShipmentPOD);
router.put("/:id", requirePermission("Shipments", "edit"), updateShipment);
router.delete("/:id", requireSuperAdmin, deleteShipment);

export default router;
