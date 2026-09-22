import express from "express";
import * as supervisorController from "../controllers/supervisorController.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

// Auto-generated ID preview (before /:id)
router.get("/next-id", requirePermission("Supervisors", "view"), supervisorController.getNextSupervisorId);

// CRUD operations
router.get("/", requirePermission("Supervisors", "view"), supervisorController.getSupervisors);
router.post("/", requirePermission("Supervisors", "create"), supervisorController.createSupervisor);
router.get("/:id", requirePermission("Supervisors", "view"), supervisorController.getSupervisorById);
router.put("/:id", requirePermission("Supervisors", "edit"), supervisorController.updateSupervisor);
router.delete("/:id", requirePermission("Supervisors", "delete"), supervisorController.deleteSupervisor);

export default router;
