import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    // Grouping by Trip ID (Shipment ID in string format, e.g. SHP-2026-00142)
    tripId: { type: String, trim: true, default: "" },
    // Link to shipment destination (LR number for easy display)
    lrNumber: { type: String, trim: true, default: "" },
    // Denormalized references for quick filtering
    vehicleId:   { type: String, trim: true, default: "" }, // Changed from ObjectId to String to match frontend usage if needed, or keep as is. Actually let's check frontend.
    vehicleNo:   { type: String, trim: true, default: "" },
    driverId:    { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
    driverName:  { type: String, trim: true, default: "" },
    shipmentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Shipment" },

    items: [
      {
        expenseType: {
          type: String,
          enum: [
            "Fuel",
            "Toll",
            "Maintenance",
            "Loading/Unloading",
            "Driver Allowance",
            "Miscellaneous",
          ],
          required: true,
        },
        amount: { type: Number, required: true, min: 0 },
        description: { type: String, trim: true, default: "" },
        liters: { type: Number, min: 0 }, // specifically for Fuel
      }
    ],

    totalAmount: { type: Number, required: true, min: 0, default: 0 },
    date:        { type: Date, required: true, default: Date.now },
    notes:       { type: String, trim: true, default: "" },
    receiptUrl:  { type: String, trim: true, default: "" },
    paymentMode: { type: String, default: "Cash" },
    status:      { type: String, default: "Pending" },
  },
  { timestamps: true }
);

// Index for common queries
expenseSchema.index({ tripId: 1 });
expenseSchema.index({ lrNumber: 1 });
expenseSchema.index({ vehicleId: 1 });
expenseSchema.index({ driverId: 1 });
expenseSchema.index({ date: -1 });

export default mongoose.model("Expense", expenseSchema);
