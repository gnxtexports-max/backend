import mongoose from "mongoose";

/**
 * GpsLog — immutable record of every GPS fix received.
 * One document per fix. Never updated, only inserted.
 * Used for route history, audit trail, and analytics.
 */
const gpsLogSchema = new mongoose.Schema(
  {
    imei:       { type: String, required: true, trim: true, index: true },
    vehicleNo:  { type: String, trim: true, index: true },
    vehicleId:  { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", index: true },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", index: true },

    lat:        { type: Number, required: true },
    lng:        { type: Number, required: true },
    speed:      { type: Number, default: 0 },      // km/h
    heading:    { type: Number, default: 0 },      // degrees
    altitude:   { type: Number, default: 0 },      // metres
    accuracy:   { type: Number, default: 0 },      // 1=low 2=moderate 3=high
    satellites: { type: Number, default: 0 },
    gpsTimestamp: { type: Date, required: true },  // from payload.time
    refid:      { type: String, trim: true },       // dedup key from payload.refid

    rawPayload: { type: mongoose.Schema.Types.Mixed },
  },
  {
    timestamps: true,  // createdAt = when we received it
    // TTL: auto-delete logs older than 90 days (optional — comment out to keep forever)
    // expireAfterSeconds is set on the index below
  }
);

// Compound index for fast shipment route queries
gpsLogSchema.index({ shipmentId: 1, gpsTimestamp: 1 });
gpsLogSchema.index({ vehicleId:  1, gpsTimestamp: 1 });
gpsLogSchema.index({ imei:       1, gpsTimestamp: -1 });

// Dedup index — same refid from same device = duplicate, skip silently
gpsLogSchema.index({ imei: 1, refid: 1 }, { unique: true, sparse: true });

export default mongoose.model("GpsLog", gpsLogSchema);
