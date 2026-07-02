import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";
import bcrypt from "bcryptjs";

const SUPER_ADMIN_MODULES = [
  "Dashboard",
  "Shipments",
  "Trip Tracking",
  "Invoices",
  "Expenses",
  "Vehicles",
  "Drivers",
  "Reports",
  "Help & Support",
];

const fullAccess = (modules) =>
  modules.map((m) => ({ module: m, view: true, create: true, edit: true, delete: true }));

const getIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "Unknown";

/* ── GET /api/users ── */
export const getUsers = async (req, res) => {
  try {
    const users = await User.find({ username: { $not: /^template_/ } }).sort({ createdAt: -1 });
    // Attach last login from ActivityLog for each user
    const result = await Promise.all(users.map(async (u) => {
      const log = await ActivityLog.findOne({ userId: u._id, action: "Login", status: "Success" })
        .sort({ createdAt: -1 }).lean();
      return { ...u.toJSON(), lastLogin: log?.createdAt ?? u.lastLogin ?? null };
    }));
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching users", error: err.message });
  }
};

/* ── GET /api/users/role-templates
   Returns saved permission configs for roles that have no real users yet.
   Keyed by role name so the frontend can initialize the permission editor. ── */
export const getRoleTemplates = async (req, res) => {
  try {
    const templates = await User.find({ username: /^template_/ }).lean();
    const result = {};
    templates.forEach((t) => {
      result[t.role] = {
        permissions: t.permissions || [],
        granularPermissions: t.granularPermissions
          ? (t.granularPermissions instanceof Map
              ? Object.fromEntries(t.granularPermissions)
              : t.granularPermissions)
          : {},
      };
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching role templates", error: err.message });
  }
};

/* ── POST /api/users ── */
export const createUser = async (req, res) => {
  try {
    const { username, email, password, role, branch } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ success: false, message: "Username, email, password and role are required" });
    }

    let permissions = [];
    let granularPermissions = {};
    if (role === "Super Admin") {
      permissions = fullAccess(SUPER_ADMIN_MODULES);
    } else {
      const existingUser = await User.findOne({ role, permissions: { $exists: true, $not: { $size: 0 } } });
      if (existingUser) {
        permissions = existingUser.permissions.map(p => ({
          module: p.module,
          view: p.view,
          create: p.create,
          edit: p.edit,
          delete: p.delete
        }));
        if (existingUser.granularPermissions) {
          granularPermissions = existingUser.granularPermissions instanceof Map
            ? Object.fromEntries(existingUser.granularPermissions)
            : existingUser.granularPermissions;
        }
      }
    }

    const parts = username.trim().split(" ");
    const avatar = parts.map((p) => p[0]?.toUpperCase()).join("").slice(0, 2);

    const user = await User.create({
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      password,
      role,
      branch: branch || (role === "Super Admin" ? "All Branches" : ""),
      permissions,
      granularPermissions,
      avatar,
    });

    await ActivityLog.create({
      userId: req.user?.id,
      userName: req.user?.username || "System",
      action: "User Created",
      target: user.username,
      ipAddress: getIp(req),
      status: "Success",
    });

    res.status(201).json({ success: true, message: "User created", data: user.toJSON() });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({ success: false, message: `${field} already exists` });
    }
    res.status(500).json({ success: false, message: "Error creating user", error: err.message });
  }
};

/* ── PUT /api/users/:id ── */
export const updateUser = async (req, res) => {
  try {
    const { username, email, role, branch, status } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (username) user.username = username.toLowerCase().trim();
    if (email)    user.email    = email.toLowerCase().trim();
    if (branch)   user.branch   = branch;
    if (status)   user.status   = status;

    if (role && role !== user.role) {
      user.role = role;
      const existingUser = await User.findOne({ role, _id: { $ne: user._id } });
      if (existingUser) {
        user.permissions = existingUser.permissions;
        user.granularPermissions = existingUser.granularPermissions || {};
        user.markModified("granularPermissions");
      } else {
        user.permissions = [];
        user.granularPermissions = {};
        user.markModified("granularPermissions");
      }
    }

    // Rebuild avatar
    user.avatar = user.username.trim().split(" ").map((p) => p[0]?.toUpperCase()).join("").slice(0, 2);

    await user.save();

    await ActivityLog.create({
      userId: req.user?.id,
      userName: req.user?.username || "System",
      action: "User Updated",
      target: user.username,
      ipAddress: getIp(req),
      status: "Success",
    });

    res.status(200).json({ success: true, message: "User updated", data: user.toJSON() });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({ success: false, message: `${field} already in use` });
    }
    res.status(500).json({ success: false, message: "Error updating user", error: err.message });
  }
};

/* ── PATCH /api/users/:id/status ── */
export const toggleUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { returnDocument: "after" });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    await ActivityLog.create({
      userId: req.user?.id,
      userName: req.user?.username || "System",
      action: "Status Changed",
      target: user.username,
      ipAddress: getIp(req),
      status: "Success",
    });

    res.status(200).json({ success: true, data: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating status", error: err.message });
  }
};

/* ── PATCH /api/users/:id/password ── */
export const resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.password = newPassword;
    await user.save();

    await ActivityLog.create({
      userId: req.user?.id,
      userName: req.user?.username || "System",
      action: "Password Reset",
      target: user.username,
      ipAddress: getIp(req),
      status: "Success",
    });

    res.status(200).json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error resetting password", error: err.message });
  }
};

/* ── DELETE /api/users/:id ── */
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Prevent deleting own account
    if (user._id.toString() === req.user?.id) {
      return res.status(400).json({ success: false, message: "Cannot delete your own account" });
    }

    const name = user.username;
    await User.findByIdAndDelete(req.params.id);

    await ActivityLog.create({
      userId: req.user?.id,
      userName: req.user?.username || "System",
      action: "User Deleted",
      target: name,
      ipAddress: getIp(req),
      status: "Success",
    });

    res.status(200).json({ success: true, message: "User deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting user", error: err.message });
  }
};

/* ── PUT /api/users/:id/permissions ── */
export const updatePermissions = async (req, res) => {
  try {
    const { permissions, granularPermissions } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (permissions) user.permissions = permissions;
    if (granularPermissions) {
      user.granularPermissions = granularPermissions;
      user.markModified("granularPermissions");
    }

    await user.save();

    await ActivityLog.create({
      userId: req.user?.id,
      userName: req.user?.username || "System",
      action: "Permission Updated",
      target: user.username,
      ipAddress: getIp(req),
      status: "Success",
    });

    res.status(200).json({ success: true, data: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating permissions", error: err.message });
  }
};

/* ── PUT /api/users/role/permissions ── */
export const updateRolePermissions = async (req, res) => {
  try {
    const { role, permissions, granularPermissions } = req.body;
    if (!role) {
      return res.status(400).json({ success: false, message: "Role is required" });
    }

    // Find ALL users with this role (including template users)
    const users = await User.find({ role });

    if (users.length > 0) {
      // Update all existing users (real + template) with this role
      await Promise.all(
        users.map(async (user) => {
          if (permissions) user.permissions = permissions;
          if (granularPermissions) {
            user.granularPermissions = granularPermissions;
            user.markModified("granularPermissions");
          }
          await user.save();
        })
      );
    } else {
      // No users for this role yet — upsert a template user to persist the config.
      // Using findOneAndUpdate+upsert avoids duplicate key errors on repeated saves.
      const cleanRoleName = role.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const templateUsername = `template_${cleanRoleName}`;

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("TemplatePassword@2026", salt);

      await User.findOneAndUpdate(
        { username: templateUsername },
        {
          $set: {
            username: templateUsername,
            email: `${templateUsername}@gnxt.com`,
            password: hashedPassword,
            role,
            status: "Inactive",
            permissions: permissions || [],
            granularPermissions: granularPermissions || {},
          },
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
      );
    }

    await ActivityLog.create({
      userId: req.user?.id,
      userName: req.user?.username || "System",
      action: "Permission Updated",
      target: role,
      ipAddress: getIp(req),
      status: "Success",
    });

    res.status(200).json({ success: true, message: `Permissions updated for role ${role}` });
  } catch (err) {
    console.error("updateRolePermissions error:", err);
    res.status(500).json({ success: false, message: "Error updating role permissions", error: err.message });
  }
};

/* ── GET /api/users/activity-log ── */
export const getActivityLog = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      ActivityLog.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      ActivityLog.countDocuments(),
    ]);
    res.status(200).json({
      success: true,
      data: logs,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching activity log", error: err.message });
  }
};
