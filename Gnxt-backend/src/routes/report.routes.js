import express from "express";
import { getShipmentStats, getFilterOptions } from "../controllers/report.controller.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);
router.use(requirePermission("Reports", "view"));

router.get("/stats", getShipmentStats);
router.get("/filters", getFilterOptions);

export default router;
