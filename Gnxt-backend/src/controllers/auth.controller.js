import mongoose from "mongoose";
import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";

// Define a static Super Admin user profile for offline/development fallback
export const STATIC_ADMIN = {
  _id: "000000000000000000000001",
  username: "admin",
  email: "admin@gnxt.com",
  role: "Super Admin",
  branch: "All Branches",
  status: "Active",
  avatar: "SA",
  permissions: [
    { module: "Dashboard", view: true, create: true, edit: true, delete: true },
    { module: "Shipments", view: true, create: true, edit: true, delete: true },
    { module: "Vehicles", view: true, create: true, edit: true, delete: true },
    { module: "Drivers", view: true, create: true, edit: true, delete: true },
    { module: "Invoices", view: true, create: true, edit: true, delete: true },
    { module: "Expenses", view: true, create: true, edit: true, delete: true },
    { module: "GPS Tracking", view: true, create: true, edit: true, delete: true },
    { module: "Reports", view: true, create: true, edit: true, delete: true },
    { module: "Users", view: true, create: true, edit: true, delete: true },
    { module: "Support", view: true, create: true, edit: true, delete: true }
  ],
  toJSON: function() {
    const obj = { ...this };
    delete obj.password;
    delete obj.toJSON;
    return obj;
  }
};

const getIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "Unknown";

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = getIp(req);

    // Anti-NoSQL-injection / Anti-DoS validation
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ success: false, message: "Invalid input format" });
    }

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }

    if (trimmedUser.length > 100 || password.length > 128) {
      return res.status(400).json({ success: false, message: "Invalid input length" });
    }

    const isMongoConnected = mongoose.connection.readyState === 1;
    const lowerUsername = trimmedUser.toLowerCase();

    let user = null;
    if (isMongoConnected) {
      user = await User.findOne({
        $or: [
          { username: lowerUsername },
          { email: lowerUsername },
        ],
      });
    }

    if (user) {
      if (user.status === "Inactive") {
        return res.status(403).json({ success: false, message: "Account is inactive. Contact admin." });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        await ActivityLog.create({
          userId: user._id,
          userName: user.username,
          action: "Failed Login",
          target: "System",
          ipAddress: ip,
          status: "Failed",
        });
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      user.lastLogin = new Date();
      await user.save();

      await ActivityLog.create({
        userId: user._id,
        userName: user.username,
        action: "Login",
        target: "System",
        ipAddress: ip,
        status: "Success",
      });

      // Create session
      req.session.userId = user._id.toString();

      return new Promise((resolve) => {
        req.session.save((err) => {
          if (err) console.error("Session save error:", err);
          res.status(200).json({
            success: true,
            message: "Login successful",
            user: user.toJSON(),
          });
          resolve();
        });
      });
    }

    if (!isMongoConnected) {
      return res.status(503).json({
        success: false,
        message: "Database is temporarily unavailable. Please try again later."
      });
    }

    return res.status(401).json({ success: false, message: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
};

export const logout = async (req, res) => {
  try {
    const ip = getIp(req);
    const isMongoConnected = mongoose.connection.readyState === 1;
    if (req.user && isMongoConnected) {
      await ActivityLog.create({
        userId: req.user.id,
        userName: req.user.username,
        action: "Logout",
        target: "System",
        ipAddress: ip,
        status: "Success",
      });
    } else if (req.user) {
      console.log(`[Static Mode Log] Logout for ${req.user.username} from ${ip}`);
    }

    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ success: false, message: "Logout error" });
      }
      res.clearCookie("connect.sid");
      res.status(200).json({ success: true, message: "Logged out" });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Logout error" });
  }
};

export const getMe = async (req, res) => {
  try {
    if (req.user.id === "000000000000000000000001") {
      return res.status(200).json({ success: true, data: STATIC_ADMIN });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, data: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching profile" });
  }
};
