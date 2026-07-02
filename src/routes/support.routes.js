import express from "express";
import { createSupportTicket } from "../controllers/support.controller.js";
import { authenticate, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.post("/ticket", requirePermission("Help & Support", "create"), createSupportTicket);

export default router;
