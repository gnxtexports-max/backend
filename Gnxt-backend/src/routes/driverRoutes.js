import express from "express";
import * as driverController from "../controllers/driverController.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

// CRUD operations
router.get("/", requirePermission("Drivers", "view"), driverController.getDrivers);
router.post("/", requirePermission("Drivers", "create"), driverController.createDriver);
router.get("/search", requirePermission("Drivers", "view"), driverController.searchDrivers);
router.get("/type/:type", requirePermission("Drivers", "view"), driverController.getDriversByType);
router.get("/status/:status", requirePermission("Drivers", "view"), driverController.getDriversByStatus);
router.get("/:id", requirePermission("Drivers", "view"), driverController.getDriverById);
router.put("/:id", requirePermission("Drivers", "edit"), driverController.updateDriver);
router.delete("/:id", requirePermission("Drivers", "delete"), driverController.deleteDriver);

// Special endpoints
router.put("/:id/performance", requirePermission("Drivers", "edit"), driverController.updateDriverPerformance);
router.put("/:id/documents", requirePermission("Drivers", "edit"), driverController.updateDriverDocuments);

export default router;