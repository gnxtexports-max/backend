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
      enum: ["In Transit", "Pending", "Delivered", "Assigned", "Cancelled"],
      default: "Pending",
      index: true,
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
  },
  { timestamps: true }
);

// COMPOSITE UNIQUE INDEX on all 4 fields
invoiceSchema.index(
  { 
    plantReferenceNumber: 1, 
    customerName: 1, 
    invoiceNumber: 1, 
    invoiceDate: 1 
  }, 
  { unique: true }
);

export default mongoose.model("Invoice", invoiceSchema);