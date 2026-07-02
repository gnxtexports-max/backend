import express from "express";
import {
  getExpenses,
  createExpense,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  exportExpenses,
  getExpenseReceipt,
} from "../controllers/expense.controller.js";
import { authenticate, requirePermission, requireSuperAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.get("/summary", requirePermission("Expenses", "view"), getExpenseSummary);   // must be before /:id
router.get("/export", requirePermission("Expenses", "view"), exportExpenses);       // must be before /:id
router.get("/:id/receipt", requirePermission("Expenses", "view"), getExpenseReceipt); // must be before /:id
router.get("/", requirePermission("Expenses", "view"), getExpenses);
router.post("/", requirePermission("Expenses", "create"), createExpense);
router.get("/:id", requirePermission("Expenses", "view"), getExpenseById);
router.put("/:id", requirePermission("Expenses", "edit"), updateExpense);
router.delete("/:id", requireSuperAdmin, deleteExpense);

export default router;
