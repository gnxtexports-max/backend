import mongoose from "mongoose";

/* ── Auto-generate Shipment ID: SHP-YYYY-NNNNN ── */
async function generateShipmentId() {
  const year = new Date().getFullYear();
  const prefix = `SHP-${year}-`;
  const last = await mongoose.model("Shipment").findOne(
    { shipmentId: { $regex: `^${prefix}` } },
    { shipmentId: 1 },
    { sort: { shipmentId: -1 } }
  ).lean();

  let next = 1;
  if (last?.shipmentId) {
    const seq = parseInt(last.shipmentId.replace(prefix, ""), 10);
    if (!isNaN(seq)) next = seq + 1;
  }
  return `${prefix}${String(next).padStart(5, "0")}`;
}

/* ── Auto-generate LR Number: LR-YYYY-NNNNN-DD ── */
async function generateLRNumber(shipmentSeq, destinationIndex) {
  const year = new Date().getFullYear();
  return `LR-${year}-${String(shipmentSeq).padStart(5, "0")}-${String(destinationIndex + 1).padStart(2, "0")}`;
}

/* ── Destination sub-schema ── */
const destinationSchema = new mongoose.Schema(
  {
    lrNumber: { type: String, default: "", trim: true },
    plantReferenceNumber: { type: String, required: true, trim: true },
    customerName: { type: String, trim: true, default: "" },       // denormalized from Invoice
    deliveryLocation: { type: String, trim: true, default: "" },   // district from Invoice
    // Invoice IDs linked from Invoice collection
    invoiceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Invoice" }],
    totalTyres: { type: Number, default: 0, min: 0 },
    totalTubes: { type: Number, default: 0, min: 0 },
    totalFlaps: { type: Number, default: 0, min: 0 },
    totalQuantity: { type: Number, default: 0 },
    weightKg: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["Pending", "Delivered", "Closed"], default: "Pending" },
    podReceiverName: { type: String, trim: true, default: "" },
    podRemarks: { type: String, trim: true, default: "" },
    podImages: [{ type: String }],
  },
  { _id: true }
);

/* ── Main Shipment schema ── */
const shipmentSchema = new mongoose.Schema(
  {
    shipmentId: {
      type: String,
      unique: true,
      index: true,
    },
    destinations: {
      type: [destinationSchema],
      validate: {
        validator: (v) => v.length >= 1,
        message: "At least one destination is required",
      },
    },
    // Vehicle reference
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    vehicleNumber: { type: String, required: true, trim: true },
    vehicleCapacityKg: { type: Number },
    // Driver reference
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
    },
    driverName: { type: String, required: true, trim: true },
    driverPhone: { type: String, trim: true },
    // Totals (denormalised for quick reads)
    totalWeightKg: { type: Number, default: 0 },
    totalQuantity: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Pending", "In Transit", "Delivered", "Cancelled", "Closed"],
      default: "Pending",
      index: true,
    },
    dispatchDate: { type: Date },
    deliveryDate: { type: Date },
    returnedDate: { type: Date },
    notes: { type: String, trim: true },
    podReceiverName: { type: String, trim: true, default: "" },
    podRemarks: { type: String, trim: true, default: "" },
    podImages: [{ type: String }],
  },
  { timestamps: true }
);

/* ── Pre-save: generate IDs ── */
shipmentSchema.pre("save", async function () {
  if (this.isNew) {
    // Generate shipment ID: SHP-YYYY-NNNNN
    this.shipmentId = await generateShipmentId();

    // Extract the 5-digit sequence from SHP-YYYY-NNNNN
    const seqStr = this.shipmentId.split("-")[2]; // e.g. "00143"
    const seq = parseInt(seqStr, 10);           // e.g. 143

    // Generate LR number for each destination and compute per-destination totals
    for (let i = 0; i < this.destinations.length; i++) {
      this.destinations[i].lrNumber = await generateLRNumber(seq, i);
      const d = this.destinations[i];
      d.totalQuantity = (d.totalTyres || 0) + (d.totalTubes || 0) + (d.totalFlaps || 0);
    }

    // Compute shipment-level totals
    this.totalWeightKg = this.destinations.reduce((s, d) => s + (d.weightKg || 0), 0);
    this.totalQuantity = this.destinations.reduce((s, d) => s + (d.totalQuantity || 0), 0);
  }
});

export default mongoose.model("Shipment", shipmentSchema);
