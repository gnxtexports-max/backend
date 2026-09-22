import Expense from "../models/expense.model.js";
import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";
import { streamExcelExport, decodeBase64Image } from "../utils/exportToZip.js";
import { compressBase64DataUrl } from "../utils/compressImage.js";
import { uploadBase64ToR2, fetchImageForExcel, getFileBuffer } from "../services/r2.service.js";
import path from "path";
import fs from "fs";

/* ─────────────────────────────────────────────────
   GET /api/expenses
   List expenses with optional filters
 ───────────────────────────────────────────────── */
export const getExpenses = async (req, res) => {
  try {
    const { lrNumber, vehicleId, driverId, dateFrom, dateTo, fromDate, toDate, tripId, category, page, limit } = req.query;
    const query = {};

    if (category) query.category = category;
    if (lrNumber) query.lrNumber = { $regex: lrNumber, $options: "i" };
    if (tripId) query.tripId = { $regex: tripId, $options: "i" };
    if (vehicleId) query.vehicleId = vehicleId;
    if (driverId) query.driverId = driverId;

    const start = fromDate || dateFrom;
    const end = toDate || dateTo;
    if (start || end) {
      query.date = {};
      if (start) {
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        query.date.$gte = s;
      }
      if (end) {
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        query.date.$lte = e;
      }
    }

    const isPaginated = req.query.page !== undefined;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const skip = (pageNum - 1) * limitNum;

    let expenseQuery = Expense.find(query)
      .select("tripId lrNumber vehicleNo vehicleId driverId driverName category weight km items totalAmount date notes receiptUrl paymentMode status")
      .sort({ date: -1 });

    if (isPaginated) {
      expenseQuery = expenseQuery.skip(skip).limit(limitNum);
    }

    const [expenses, total] = await Promise.all([
      expenseQuery.lean(),
      isPaginated ? Expense.countDocuments(query) : Promise.resolve(null),
    ]);

    // Dynamically resolve missing tripId values for unlinked expenses only
    const unlinkedShipmentIds = expenses.filter(e => !e.tripId && e.shipmentId).map(e => e.shipmentId);
    const unlinkedLrNumbers = expenses.filter(e => !e.tripId && e.lrNumber).map(e => e.lrNumber);

    const shipmentMapByRef = new Map();
    const shipmentMapByLr = new Map();

    if (unlinkedShipmentIds.length > 0 || unlinkedLrNumbers.length > 0) {
      const shipments = await Shipment.find({
        $or: [
          ...(unlinkedShipmentIds.length ? [{ _id: { $in: unlinkedShipmentIds } }] : []),
          ...(unlinkedLrNumbers.length ? [{ "destinations.lrNumber": { $in: unlinkedLrNumbers } }] : []),
        ]
      })
        .select("_id shipmentId destinations.lrNumber")
        .lean();

      shipments.forEach((s) => {
        if (s._id) shipmentMapByRef.set(s._id.toString(), s.shipmentId);
        s.destinations?.forEach((d) => {
          if (d.lrNumber) shipmentMapByLr.set(d.lrNumber, s.shipmentId);
        });
      });
    }

    // Shape response to match what the frontend expects
    const shaped = expenses.map((e) => {
      let resolvedTripId = e.tripId || "";
      if (!resolvedTripId && e.category !== "maintenance") {
        if (e.shipmentId) {
          resolvedTripId = shipmentMapByRef.get(e.shipmentId.toString()) || "";
        }
        if (!resolvedTripId && e.lrNumber) {
          resolvedTripId = shipmentMapByLr.get(e.lrNumber) || "";
        }
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const formattedReceiptUrl = e.receiptUrl ? `${baseUrl}/api/expenses/${e._id}/receipt` : "";

      return {
        ...e,
        category: e.category || "dispatch",
        tripId: resolvedTripId,
        vehicleId: e.vehicleNo || e.vehicleId?.toString() || "",
        driverName: e.driverName || "",
        weight: e.weight || 0,
        km: e.km || 0,
        amount: e.totalAmount !== undefined ? e.totalAmount : (e.amount || 0),
        receiptUrl: formattedReceiptUrl,
      };
    });

    if (isPaginated) {
      return res.status(200).json({
        success: true,
        data: shaped,
        pagination: {
          total,
          totalPages: Math.ceil(total / limitNum),
          currentPage: pageNum,
          limit: limitNum,
        },
      });
    }

    res.status(200).json(shaped);
  } catch (err) {
    console.error("Get expenses error:", err);
    res.status(500).json({ success: false, message: "Error fetching expenses", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   POST /api/expenses
   Create new expense entry/entries (possibly with multiple items/records)
 ───────────────────────────────────────────────── */
export const createExpense = async (req, res) => {
  try {
    const {
      category = "dispatch",
      tripId,
      entries, // Array of { lrNumber, items, date, notes, receiptUrl, paymentMode, category, weight, km, driverName, driverId, vehicleId, vehicleNo }
      lrNumber,
      vehicleId,
      vehicleNo: inputVehicleNo,
      driverId,
      driverName: inputDriverName,
      weight,
      km,
      items,
      date,
      notes,
      receiptUrl,
      paymentMode,
    } = req.body;

    const isObjectId = (id) => id && typeof id === "string" && id.length === 24 && /^[0-9a-fA-F]{24}$/.test(id);

    // Helper to resolve shipment details
    const resolveShipmentDetails = async (lr, tId) => {
      let shipmentRef = null;
      let finalVehicleId = undefined;
      let vehicleNo = "";
      let finalDriverId = undefined;
      let driverName = "";
      let resolvedTripId = tId || "";

      if (lr) {
        const s = await Shipment.findOne({ "destinations.lrNumber": lr })
          .select("_id shipmentId vehicleId driverId vehicleNumber driverName")
          .lean();
        if (s) {
          shipmentRef = s._id;
          finalVehicleId = s.vehicleId;
          vehicleNo = s.vehicleNumber || "";
          finalDriverId = s.driverId;
          driverName = s.driverName || "";
          resolvedTripId = s.shipmentId || "";
        }
      } else if (tId) {
        const s = await Shipment.findOne({ shipmentId: tId })
          .select("_id shipmentId vehicleId driverId vehicleNumber driverName")
          .lean();
        if (s) {
          shipmentRef = s._id;
          finalVehicleId = s.vehicleId;
          vehicleNo = s.vehicleNumber || "";
          finalDriverId = s.driverId;
          driverName = s.driverName || "";
          resolvedTripId = s.shipmentId || "";
        }
      }
      return { shipmentRef, finalVehicleId, vehicleNo, finalDriverId, driverName, resolvedTripId };
    };

    // Case 1: Bulk creations (Multiple expense entries from same form submission)
    if (entries && Array.isArray(entries) && entries.length > 0) {
      const createdExpenses = [];

      for (const entry of entries) {
        const entryCategory = entry.category || category || "dispatch";
        const resolved = await resolveShipmentDetails(entry.lrNumber, tripId);

        let finalVehicleId = resolved.finalVehicleId || vehicleId;
        let vehicleNo = resolved.vehicleNo || inputVehicleNo || "";
        let finalDriverId = resolved.finalDriverId || driverId;
        let driverName = resolved.driverName || inputDriverName || "";

        // Fallbacks
        if (!vehicleNo && isObjectId(vehicleId)) {
          const v = await Vehicle.findById(vehicleId).select("vehicleNo").lean();
          finalVehicleId = vehicleId;
          vehicleNo = v?.vehicleNo || "";
        } else if (!vehicleNo && vehicleId) {
          vehicleNo = vehicleId;
        }

        if (!driverName && isObjectId(driverId)) {
          const d = await Driver.findById(driverId).select("name").lean();
          finalDriverId = driverId;
          driverName = d?.name || "";
        }

        const entryItems = entry.items || [];
        const totalAmount = entryItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

        const exp = await Expense.create({
          category: entryCategory,
          tripId: resolved.resolvedTripId || tripId || "",
          lrNumber: entry.lrNumber || "",
          vehicleId: finalVehicleId,
          vehicleNo,
          driverId: finalDriverId,
          driverName: entry.driverName || driverName,
          shipmentId: resolved.shipmentRef || undefined,
          weight: Number(entry.weight !== undefined ? entry.weight : weight) || 0,
          km: Number(entry.km !== undefined ? entry.km : km) || 0,
          items: entryItems,
          totalAmount,
          date: entry.date ? new Date(entry.date) : new Date(),
          notes: entry.notes || "",
          receiptUrl: entry.receiptUrl ? await uploadBase64ToR2(entry.receiptUrl, "receipts/exp") : "",
          paymentMode: entry.paymentMode || paymentMode || "Cash",
          status: "Pending",
        });

        const baseUrl = `${req.protocol}://${req.get("host")}`;
        createdExpenses.push({
          ...exp.toObject(),
          category: exp.category || "dispatch",
          vehicleId: exp.vehicleNo || exp.vehicleId?.toString() || "",
          driverName: exp.driverName || "",
          amount: exp.totalAmount !== undefined ? exp.totalAmount : 0,
          receiptUrl: exp.receiptUrl ? `${baseUrl}/api/expenses/${exp._id}/receipt` : "",
        });
      }

      if (req.io) req.io.emit("expenses:changed");
      return res.status(201).json(createdExpenses);
    }

    // Case 2: Single creation (Fallback/Backward compatibility)
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one expense item is required" });
    }

    const resolved = await resolveShipmentDetails(lrNumber, tripId);
    let finalVehicleId = resolved.finalVehicleId || vehicleId;
    let vehicleNo = resolved.vehicleNo || inputVehicleNo || "";
    let finalDriverId = resolved.finalDriverId || driverId;
    let driverName = resolved.driverName || inputDriverName || "";

    if (!vehicleNo && isObjectId(vehicleId)) {
      const v = await Vehicle.findById(vehicleId).select("vehicleNo").lean();
      finalVehicleId = vehicleId;
      vehicleNo = v?.vehicleNo || "";
    } else if (!vehicleNo && vehicleId) {
      vehicleNo = vehicleId;
    }

    if (!driverName && isObjectId(driverId)) {
      const d = await Driver.findById(driverId).select("name").lean();
      finalDriverId = driverId;
      driverName = d?.name || "";
    }

    const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    const expense = await Expense.create({
      category: category || "dispatch",
      tripId: resolved.resolvedTripId || tripId || "",
      lrNumber: lrNumber || "",
      vehicleId: finalVehicleId,
      vehicleNo,
      driverId: finalDriverId,
      driverName,
      shipmentId: resolved.shipmentRef || undefined,
      weight: Number(weight) || 0,
      km: Number(km) || 0,
      items,
      totalAmount,
      date: date ? new Date(date) : new Date(),
      notes: notes || "",
      receiptUrl: receiptUrl ? await uploadBase64ToR2(receiptUrl, "receipts/exp") : "",
      paymentMode: paymentMode || "Cash",
      status: "Pending",
    });

    const shaped = {
      ...expense.toObject(),
      vehicleId: expense.vehicleNo || expense.vehicleId?.toString() || "",
      driverName: expense.driverName || "",
      amount: expense.totalAmount !== undefined ? expense.totalAmount : 0,
    };

    if (req.io) req.io.emit("expenses:changed");
    res.status(201).json(shaped);
  } catch (err) {
    console.error("Create expense error:", err);
    res.status(500).json({ success: false, message: "Error creating expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/expenses/:id
 ───────────────────────────────────────────────── */
export const getExpenseById = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).lean();
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    if (expense.receiptUrl) {
      expense.receiptUrl = `${baseUrl}/api/expenses/${expense._id}/receipt`;
    }
    res.status(200).json(expense);
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   PUT /api/expenses/:id
 ───────────────────────────────────────────────── */
export const updateExpense = async (req, res) => {
  try {
    const { items, date, notes, lrNumber, receiptUrl, paymentMode, status, weight, km, driverName } = req.body;

    const update = {};
    if (items && Array.isArray(items)) {
      update.items = items;
      update.totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    }
    if (date) update.date = new Date(date);
    if (notes !== undefined) update.notes = notes;
    if (lrNumber !== undefined) update.lrNumber = lrNumber;
    if (weight !== undefined) update.weight = Number(weight) || 0;
    if (km !== undefined) update.km = Number(km) || 0;
    if (driverName !== undefined) update.driverName = driverName;
    if (receiptUrl !== undefined) update.receiptUrl = receiptUrl ? await uploadBase64ToR2(receiptUrl, `receipts/exp_${req.params.id}`) : "";
    if (paymentMode !== undefined) update.paymentMode = paymentMode;
    if (status !== undefined) update.status = status;

    const expense = await Expense.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    const shaped = {
      ...expense.toObject(),
      vehicleId: expense.vehicleNo || expense.vehicleId?.toString() || "",
      driverName: expense.driverName || "",
      amount: expense.totalAmount !== undefined ? expense.totalAmount : 0,
    };

    if (req.io) req.io.emit("expenses:changed");
    res.status(200).json({ success: true, data: shaped });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   DELETE /api/expenses/:id
 ───────────────────────────────────────────────── */
export const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    if (req.io) req.io.emit("expenses:changed");
    res.status(200).json({ success: true, message: "Expense deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/expenses/summary
   Returns aggregated totals by expense type
 ───────────────────────────────────────────────── */
export const getExpenseSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const match = {};
    if (dateFrom || dateTo) {
      match.date = {};
      if (dateFrom) match.date.$gte = new Date(dateFrom);
      if (dateTo) match.date.$lte = new Date(dateTo);
    }

    const summary = await Expense.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.expenseType",
          total: { $sum: "$items.amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const grandTotal = summary.reduce((s, e) => s + e.total, 0);
    res.status(200).json({ success: true, data: { summary, grandTotal } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching summary", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/expenses/export
   Export expenses as ZIP (Excel + receipt images)
───────────────────────────────────────────────── */
export const exportExpenses = async (req, res) => {
  try {
    const { dateFrom, dateTo, vehicleId, driverId, ids, tripIds, category } = req.query;
    const query = {};

    if (category && category !== "all") {
      query.category = category;
    }

    if (ids) {
      query._id = { $in: ids.split(",") };
    } else if (tripIds) {
      const keysList = tripIds.split(",").map(k => k.trim()).filter(Boolean);
      query.$or = [
        { tripId: { $in: keysList } },
        { vehicleNo: { $in: keysList } },
        { vehicleId: { $in: keysList } },
      ];
    } else {
      if (vehicleId && vehicleId !== "all") {
        query.$or = [{ vehicleId: vehicleId }, { vehicleNo: vehicleId }];
      }
      if (driverId && driverId !== "all") query.driverName = driverId;
      if (dateFrom || dateTo) {
        query.date = {};
        if (dateFrom) query.date.$gte = new Date(dateFrom);
        if (dateTo) query.date.$lte = new Date(dateTo);
      }
    }

    const expenses = await Expense.find(query).sort({ date: -1 }).lean();

    // Dynamically resolve associated shipment details for alignment
    const shipments = await Shipment.find({})
      .select("shipmentId destinations.customerName destinations.deliveryLocation totalWeightKg totalQuantity")
      .lean();

    const shipmentMap = new Map();
    shipments.forEach((s) => {
      if (s.shipmentId) {
        const customers = [...new Set((s.destinations || []).map(d => d.customerName).filter(Boolean))];
        const locations = [...new Set((s.destinations || []).map(d => d.deliveryLocation).filter(Boolean))];
        shipmentMap.set(s.shipmentId, {
          customer: customers.join(", ") || "—",
          location: locations.join(", ") || "—",
          weight: s.totalWeightKg || 0,
          qty: s.totalQuantity || 0,
        });
      }
    });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const rows = [];

    for (const exp of expenses) {
      const itemDescriptions = (exp.items ?? [])
        .map(item => `${item.expenseType || ""}: ₹${item.amount || 0}${item.description ? ` (${item.description})` : ""}`)
        .join("; ");

      const shipDetails = shipmentMap.get(exp.tripId) || { customer: "—", location: "—", weight: 0, qty: 0 };

      rows.push({
        category: exp.category === "maintenance" ? "Maintenance" : "Dispatch",
        date: exp.date ? new Date(exp.date).toLocaleDateString("en-IN") : "",
        tripId: exp.tripId || "N/A",
        lrNumber: exp.lrNumber || "N/A",
        vehicleNo: exp.vehicleNo || exp.vehicleId || "N/A",
        driverName: exp.driverName || "N/A",
        customer: shipDetails.customer,
        location: shipDetails.location,
        weight: shipDetails.weight,
        qty: shipDetails.qty,
        items: itemDescriptions,
        totalAmount: exp.totalAmount || 0,
        paymentMode: exp.paymentMode || "",
        status: exp.status || "",
        notes: exp.notes || "",
        receipt: exp.receiptUrl || "",
      });
    }

    const columns = [
      { header: "Category", key: "category", width: 15 },
      { header: "Date", key: "date", width: 14 },
      { header: "Trip ID", key: "tripId", width: 20 },
      { header: "LR Number", key: "lrNumber", width: 22 },
      { header: "Vehicle No", key: "vehicleNo", width: 16 },
      { header: "Driver", key: "driverName", width: 20 },
      { header: "Customer", key: "customer", width: 22 },
      { header: "Location", key: "location", width: 18 },
      { header: "Weight (kg)", key: "weight", width: 14 },
      { header: "Quantity", key: "qty", width: 12 },
      { header: "Items", key: "items", width: 50 },
      { header: "Total Amount", key: "totalAmount", width: 14 },
      { header: "Payment Mode", key: "paymentMode", width: 14 },
      { header: "Status", key: "status", width: 12 },
      { header: "Notes", key: "notes", width: 30 },
      { header: "Receipt", key: "receipt", width: 22, type: "image" },
    ];

    const dateStr = new Date().toISOString().slice(0, 10);
    await streamExcelExport({
      res,
      filename: `Expense_Report_${dateStr}.xlsx`,
      sheetName: "Expenses",
      columns,
      rows,
    });
  } catch (err) {
    console.error("Export expenses error:", err);
    res.status(500).json({ success: false, message: "Export failed", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/expenses/:id/receipt
   Serve the receipt image or PDF by expense ID
 ───────────────────────────────────────────────── */
export const getExpenseReceipt = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).lean();
    if (!expense || !expense.receiptUrl) {
      return res.status(404).send("Receipt not found");
    }

    const file = await getFileBuffer(expense.receiptUrl);
    if (file && file.buffer) {
      res.setHeader("Content-Type", file.contentType);
      const isPdf = file.contentType.includes("pdf") || expense.receiptUrl.toLowerCase().includes(".pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="receipt_${expense._id}.${isPdf ? "pdf" : "jpg"}"`
      );
      return res.send(file.buffer);
    }

    res.status(404).send("Receipt image not found");
  } catch (err) {
    console.error("[getExpenseReceipt] error:", err);
    res.status(500).send("Error retrieving receipt: " + err.message);
  }
};

