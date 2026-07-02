import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  userName: { type: String, default: "System" },
  action: {
    type: String,
    enum: ["Login", "Logout", "Failed Login", "Password Reset", "User Created",
           "User Updated", "User Deleted", "Role Changed", "Auto Logout",
           "Permission Updated", "Status Changed"],
    required: true,
  },
  target: { type: String, default: "System" },
  ipAddress: { type: String, default: "—" },
  status: {
    type: String,
    enum: ["Success", "Failed"],
    default: "Success",
  },
}, { timestamps: true });

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ userId: 1 });

export default mongoose.model("ActivityLog", activityLogSchema);
