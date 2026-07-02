
import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: String,
      unique: true,
    },
    vehicleNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    type: {
      type: String,
      required: false,
    },
    model: {
      type: String,
      required: false,
      trim: true,
    },
    capacityKg: {
      type: Number,
      required: false,
      min: 0,
    },

    status: {
      type: String,
      default: "Idle",
      enum: ["Active", "In Transit", "Idle", "Maintenance", "Assigned"],
    },

    insuranceExpiry: {
      type: Date,
      required: false,
    },
    availability: {
      type: String,
      default: "Available",
      enum: ["Available", "On Trip", "Scheduled", "Unavailable"],
    },
    ownership: {
      type: String,
      required: true,
      enum: ["Company", "Leased", "Rented"],
    },
    gpsImei: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Vehicle", vehicleSchema);
