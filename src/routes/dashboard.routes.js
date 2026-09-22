import express from "express";
import { 
  getDashboardStats, 
  getDashboardWeeklyData, 
  getDashboardSummary,
  getDashboardInvoiceSummary,
  getDashboardDispatchSummary
} from "../controllers/dashboard.controller.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.get("/stats", requirePermission("Dashboard", "view"), getDashboardStats);
router.get("/weekly", requirePermission("Dashboard", "view"), getDashboardWeeklyData);
router.get("/summary", requirePermission("Dashboard", "view"), getDashboardSummary);
router.get("/invoice-summary", requirePermission("Dashboard", "view"), getDashboardInvoiceSummary);
router.get("/dispatch-summary", requirePermission("Dashboard", "view"), getDashboardDispatchSummary);

export default router;
