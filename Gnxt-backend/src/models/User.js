import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const permissionSchema = new mongoose.Schema({
  module: { type: String, required: true },
  view:   { type: Boolean, default: false },
  create: { type: Boolean, default: false },
  edit:   { type: Boolean, default: false },
  delete: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, "Username is required"],
    unique: true,
    trim: true,
    lowercase: true,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: 6,
    maxlength: 128,
  },
  role: {
    type: String,
    enum: ["Super Admin", "Sub Admin", "Billing Executive (Invoice Operator)", "Operations Supervisor", "Accounts Executive"],
    default: "Billing Executive (Invoice Operator)",
  },
  branch: {
    type: String,
    default: "All Branches",
    trim: true,
  },
  status: {
    type: String,
    enum: ["Active", "Inactive"],
    default: "Active",
  },
  permissions: {
    type: [permissionSchema],
    default: [],
  },
  granularPermissions: {
    type: Map,
    of: Boolean,
    default: {},
  },
  lastLogin: {
    type: Date,
    default: null,
  },
  avatar: {
    type: String,
    default: "",
  },
}, { timestamps: true });

/* Hash password before save */
userSchema.pre("save", async function () {
  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  // Auto-generate avatar initials from username
  if (this.isModified("username") || !this.avatar) {
    const parts = (this.username || "").trim().split(" ");
    this.avatar = parts.map((p) => p[0]?.toUpperCase()).join("").slice(0, 2) || "U";
  }
});

/* Compare password */
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

/* Mask password in JSON responses */
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// Index
userSchema.index({ username: "text", email: "text" });

export default mongoose.model("User", userSchema);
