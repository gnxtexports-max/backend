import express from "express";
import {
  getUsers,
  getRoleTemplates,
  createUser,
  updateUser,
  toggleUserStatus,
  resetPassword,
  deleteUser,
  updatePermissions,
  updateRolePermissions,
  getActivityLog,
} from "../controllers/user.controller.js";
import { authenticate, requireSuperAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

// All user management routes require authentication + Super Admin
router.use(authenticate);

// Static named routes MUST come before /:id wildcard routes
router.get("/",                          requireSuperAdmin, getUsers);
router.get("/role-templates",            requireSuperAdmin, getRoleTemplates);
router.get("/activity-log",              requireSuperAdmin, getActivityLog);
router.post("/",                         requireSuperAdmin, createUser);
router.put("/role/permissions",          requireSuperAdmin, updateRolePermissions);
router.put("/:id",                       requireSuperAdmin, updateUser);
router.patch("/:id/status",              requireSuperAdmin, toggleUserStatus);
router.patch("/:id/password",            requireSuperAdmin, resetPassword);
router.delete("/:id",                    requireSuperAdmin, deleteUser);
router.put("/:id/permissions",           requireSuperAdmin, updatePermissions);

export default router;
