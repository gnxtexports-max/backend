import mongoose from "mongoose";

const driverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Driver name is required"],
      trim: true,
    },
    age: {
      type: Number,
      required: [true, "Age is required"],
      min: [18, "Driver must be at least 18 years old"],
      max: [65, "Driver must be younger than 65 years"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
      validate: {
        validator: function (v) {
          return /^\+?[0-9\s-()]{10,}$/.test(v);
        },
        message: "Phone number must be valid (at least 10 digits)",
      },
    },
    licenseNumber: {
      type: String,
      required: [true, "License number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    driverType: {
      type: String,
      enum: ["Own", "Hired", "Contract"],
      required: [true, "Driver type is required"],
    },
    tripStatus: {
      type: String,
      enum: ["Driving", "Idle", "Assigned", "In Transit"],
      default: "Idle",
    },
    assignedVehicle: {
      type: String,
      default: null,
    },
    documents: {
      licenseExpiry: Date,
      insuranceExpiry: Date,
      medicalExamExpiry: Date,
    },
    performance: {
      totalTrips: {
        type: Number,
        default: 0,
      },
      completedTrips: {
        type: Number,
        default: 0,
      },
      rating: {
        type: Number,
        default: 5,
        min: 0,
        max: 5,
      },
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Suspended"],
      default: "Active",
    },
  },
  { timestamps: true }
);

// Indexes for faster searches
driverSchema.index({ name: "text", phone: "text", licenseNumber: "text" });
driverSchema.index({ driverType: 1 });
driverSchema.index({ tripStatus: 1 });
driverSchema.index({ createdAt: -1 });

export default mongoose.model("Driver", driverSchema);