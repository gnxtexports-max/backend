import express from "express";
import { getDashboardStats, getDashboardWeeklyData, getDashboardSummary } from "../controllers/dashboard.controller.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.get("/stats", requirePermission("Dashboard", "view"), getDashboardStats);
router.get("/weekly", requirePermission("Dashboard", "view"), getDashboardWeeklyData);
router.get("/summary", requirePermission("Dashboard", "view"), getDashboardSummary);

export default router;
