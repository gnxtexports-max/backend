import User from "../models/User.js";

export const authenticate = async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    // Bypass database lookup if static admin user ID
    if (userId === "000000000000000000000001") {
      req.user = { id: "000000000000000000000001", username: "admin", role: "Super Admin" };
      return next();
    }

    let user;
    try {
      user = await User.findById(userId).select("-password");
    } catch (dbErr) {
      // DB temporarily unavailable (Atlas cold start, network blip) — don't force-logout,
      // serve a stripped user from the session so the current page stays usable.
      console.error("[Auth] DB lookup failed, serving from session cache:", dbErr.message);
      req.user = {
        id: userId,
        username: req.session.username || "User",
        role: req.session.role || "Employee",
        permissions: req.session.permissions || [],
        granularPermissions: {},
      };
      return next();
    }

    if (!user || user.status === "Inactive") {
      req.session.destroy();
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Cache user profile in session for DB-down fallback
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.permissions = user.permissions;

    req.user = {
      id: user._id.toString(),
      username: user.username,
      role: user.role,
      permissions: user.permissions || [],
      granularPermissions: user.granularPermissions ? Object.fromEntries(user.granularPermissions) : {},
    };
    next();
  } catch (err) {
    console.error("[Auth] Unexpected auth error:", err.message);
    return res.status(401).json({ success: false, message: "Authentication failed" });
  }
};

export const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== "Super Admin") {
    return res.status(403).json({ success: false, message: "Super Admin access required" });
  }
  next();
};

export const requirePermission = (moduleName, action) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (req.user.role === "Super Admin") {
      return next();
    }

    const userPermissions = req.user.permissions || [];
    const modulePerm = userPermissions.find(
      (p) => p.module?.toLowerCase() === moduleName?.toLowerCase()
    );

    const hasModuleAccess = modulePerm && modulePerm[action?.toLowerCase()];
    const hasTripTrackingViewAccess = action?.toLowerCase() === "view" &&
      (moduleName?.toLowerCase() === "vehicles" || moduleName?.toLowerCase() === "shipments") &&
      userPermissions.some(p => p.module?.toLowerCase() === "trip tracking" && p.view);
    const hasShipmentAccess = action?.toLowerCase() === "view" &&
      (moduleName?.toLowerCase() === "vehicles" || moduleName?.toLowerCase() === "drivers") &&
      userPermissions.some(p => p.module?.toLowerCase().includes("shipment") && (p.view || p.create || p.edit));

    if (!hasModuleAccess && !hasTripTrackingViewAccess && !hasShipmentAccess) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have permission to ${action} in ${moduleName}`,
      });
    }

    next();
  };
};
