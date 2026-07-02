
import express from "express";
import {
  getInvoices,
  uploadInvoiceSheet,
  updateInvoiceStatus,
  toggleInvoiceCheck,
  deleteInvoice,
  getInvoiceHistory,
  addInvoice
} from "../controllers/invoice.controller.js";
import { upload } from "../middleware/upload.middleware.js";
import { authenticate, requirePermission, requireSuperAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

// Add invoice manually
router.post("/", requirePermission("Invoices", "create"), addInvoice);

// Upload Excel
router.post("/upload", requirePermission("Invoices", "create"), upload.single("file"), uploadInvoiceSheet);

// Get invoices (for table)
router.get("/", requirePermission("Invoices", "view"), getInvoices);

router.get("/history", requirePermission("Invoices", "view"), getInvoiceHistory);

router.patch("/:plantId/status", requirePermission("Invoices", "edit"), updateInvoiceStatus);

router.patch(
  "/:plantId/check/:invoiceNumber",
  requirePermission("Invoices", "edit"),
  toggleInvoiceCheck
);
router.delete("/:invoiceId", requireSuperAdmin, deleteInvoice);
export default router;