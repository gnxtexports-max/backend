import express from "express";
import { getDashboardStats, getDashboardWeeklyData } from "../controllers/dashboard.controller.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.get("/stats", requirePermission("Dashboard", "view"), getDashboardStats);
router.get("/weekly", requirePermission("Dashboard", "view"), getDashboardWeeklyData);

export default router;
