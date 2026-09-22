import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    plantReferenceNumber: {  // Plant Reference Number
      type: String,
      required: true,
      trim: true,
    },
    customerName: {  // Customer Name
      type: String,
      required: true,
      trim: true,
    },
    invoiceNumber: {  // Invoice
      type: String,
      required: true,
      trim: true,
    },
    invoiceDate: {  // Invoice Date
      type: Date,
      required: true,
    },

    location: {  // Customer/Delivery Location (from XL sheet, used for shipment tracking)
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["In Transit", "Pending", "Delivered", "Assigned", "Cancelled", "Reassignment"],
      default: "Pending",
      index: true,
    },

    quantity: {
      type: Number,
      default: 0,
    },

    weight: {
      type: Number,
      default: 0,
    },

    tyre: {
      type: Number,
      default: 0,
      min: 0,
    },

    tube: {
      type: Number,
      default: 0,
      min: 0,
    },

    flap: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Stamped the moment status becomes "Assigned" — used for 24-hr remarks editing rule
    assignedAt: {
      type: Date,
      default: null,
    },

    // Stamped the moment status becomes "In Transit" — used for 7-day remarks editing rule
    inTransitAt: {
      type: Date,
      default: null,
    },

    // Stamped the moment status becomes "Delivered" — used for 5-min auto-history rule
    deliveredAt: {
      type: Date,
      default: null,
    },

    // Stamped the moment status becomes "Cancelled" — used for 2-min auto-history rule
    cancelledAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: "",
    },

    beforeDispatchRemarks: {
      type: String,
      trim: true,
      default: "",
    },

    afterDispatchRemarks: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

// Unique index on invoiceNumber to strictly prevent duplicates across dates, plants, or uploads
invoiceSchema.index(
  { invoiceNumber: 1 }, 
  { unique: true }
);

// Compound index for fast queries and grouping by plantReferenceNumber & customerName
invoiceSchema.index(
  { plantReferenceNumber: 1, customerName: 1 }
);

export default mongoose.model("Invoice", invoiceSchema);