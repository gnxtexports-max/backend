import mongoose from "mongoose";

/**
 * Stores the LATEST GPS fix for each vehicle.
 * One document per vehicle — upserted on every webhook push.
 * Also keeps a capped history of the last 500 fixes for the timeline.
 */
const vehicleLocationSchema = new mongoose.Schema(
  {
    // vehicle_id from the webhook payload (registration number)
    vehicleNo: { type: String, required: true, unique: true, index: true, trim: true },

    // device IMEI from the webhook
    deviceId: { type: String, trim: true, default: "" },

    // Latest fix
    lat:      { type: Number },
    lng:      { type: Number },
    acc:      { type: Number },   // 1=low, 2=moderate, 3=high
    speed:    { type: Number },   // km/h  (sp field)
    heading:  { type: Number },   // degrees (hd field)
    altitude: { type: Number },   // metres (alt field)
    satellites: { type: Number }, // ns field
    fixTime:  { type: Date },     // epoch ms → Date

    // Derived status
    vehicleStatus: {
      type: String,
      enum: ["Moving", "Stopped", "Idle"],
      default: "Idle",
    },

    // Raw last payload (for debugging)
    rawPayload: { type: mongoose.Schema.Types.Mixed },

    // History — last 500 fixes (oldest dropped automatically)
    history: {
      type: [
        {
          lat:     Number,
          lng:     Number,
          speed:   Number,
          heading: Number,
          fixTime: Date,
          acc:     Number,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model("VehicleLocation", vehicleLocationSchema);
