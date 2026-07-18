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

/* ── Auto-generate LR Number: LR-YYYY-NNNNN ── */
export async function generateNextLRNumber() {
  const year = new Date().getFullYear();
  const prefix = `LR-${year}-`;
  const lastShipments = await mongoose.model("Shipment").find(
    { "destinations.lrNumber": { $regex: `^${prefix}` } }
  )
  .sort({ createdAt: -1 })
  .limit(10)
  .lean();

  let maxSeq = 0;
  for (const s of lastShipments) {
    for (const d of s.destinations || []) {
      if (d.lrNumber && d.lrNumber.startsWith(prefix)) {
        const parts = d.lrNumber.split("-");
        if (parts.length === 3) {
          const seq = parseInt(parts[2], 10);
          if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
      }
    }
  }

  if (maxSeq === 0) {
    const lastAnyShipment = await mongoose.model("Shipment").findOne(
      { "destinations.lrNumber": { $regex: "^LR-" } }
    )
    .sort({ createdAt: -1 })
    .lean();
    if (lastAnyShipment) {
      for (const d of lastAnyShipment.destinations || []) {
        if (d.lrNumber && d.lrNumber.startsWith("LR-")) {
          const parts = d.lrNumber.split("-");
          if (parts.length === 3) {
            const seq = parseInt(parts[2], 10);
            if (!isNaN(seq) && seq > maxSeq) {
              maxSeq = seq;
            }
          }
        }
      }
    }
  }

  return maxSeq + 1;
}

export async function assignSequentialLRNumbers(destinations) {
  const year = new Date().getFullYear();
  const prefix = `LR-${year}-`;
  let nextSeq = await generateNextLRNumber();

  for (let i = 0; i < destinations.length; i++) {
    if (!destinations[i].lrNumber) {
      destinations[i].lrNumber = `${prefix}${String(nextSeq).padStart(5, "0")}`;
      nextSeq++;
    }
  }
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
    plantData: { type: mongoose.Schema.Types.Mixed, default: {} },
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

    // Assign sequential LR numbers for destinations
    await assignSequentialLRNumbers(this.destinations);

    // Compute per-destination totals
    for (let i = 0; i < this.destinations.length; i++) {
      const d = this.destinations[i];
      d.totalQuantity = (d.totalTyres || 0) + (d.totalTubes || 0) + (d.totalFlaps || 0);
    }

    // Compute shipment-level totals
    this.totalWeightKg = this.destinations.reduce((s, d) => s + (d.weightKg || 0), 0);
    this.totalQuantity = this.destinations.reduce((s, d) => s + (d.totalQuantity || 0), 0);
  }
});

export default mongoose.model("Shipment", shipmentSchema);
