import express from "express";
import {
  getAllVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  updateVehicleStatus,
  deleteVehicle,
  getFleetStats,
  searchVehicles,
  filterVehicles,
} from "../controllers/vehicleController.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

// GET routes (must be before /:id to avoid conflicts)
router.get("/stats", requirePermission("Vehicles", "view"), getFleetStats);
router.get("/search", requirePermission("Vehicles", "view"), searchVehicles);
router.get("/filter", requirePermission("Vehicles", "view"), filterVehicles);

// CRUD routes
router.get("/", requirePermission("Vehicles", "view"), getAllVehicles);
router.get("/:id", requirePermission("Vehicles", "view"), getVehicleById);
router.post("/", requirePermission("Vehicles", "create"), createVehicle);
router.put("/:id", requirePermission("Vehicles", "edit"), updateVehicle);
router.patch("/:id/status", requirePermission("Vehicles", "edit"), updateVehicleStatus);
router.delete("/:id", requirePermission("Vehicles", "delete"), deleteVehicle);

export default router;
