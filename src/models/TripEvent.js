import mongoose from "mongoose";

/**
 * TripEvent — timeline of significant events during a shipment trip.
 * Examples: Trip Started, Vehicle Moving, Vehicle Idle, Geofence Entered,
 *           Reached Destination, Trip Completed.
 */
const tripEventSchema = new mongoose.Schema(
  {
    shipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shipment",
      required: true,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
    },
    vehicleNo: { type: String, trim: true },

    eventType: {
      type: String,
      required: true,
      enum: [
        "TRIP_STARTED",
        "VEHICLE_MOVING",
        "VEHICLE_IDLE",
        "VEHICLE_STOPPED",
        "GEOFENCE_ENTERED",
        "GEOFENCE_EXITED",
        "REACHED_DESTINATION",
        "TRIP_COMPLETED",
        "GPS_SIGNAL_LOST",
        "GPS_SIGNAL_RESTORED",
        "STATUS_CHANGED",
      ],
      index: true,
    },

    eventMessage: { type: String, trim: true },

    lat:  { type: Number },
    lng:  { type: Number },
    speed:    { type: Number },
    heading:  { type: Number },
    accuracy: { type: Number },
    altitude: { type: Number },

    // Extra metadata (geofence name, old/new status, etc.)
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

tripEventSchema.index({ shipmentId: 1, createdAt: 1 });

export default mongoose.model("TripEvent", tripEventSchema);
