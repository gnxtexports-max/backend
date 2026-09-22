
import XLSX from "xlsx";
import Invoice from "../models/invoice.model.js";
import Shipment from "../models/shipment.model.js";
import { mapExcelRowToInvoice, validateSheetColumns, resolveHeaderKeys } from "../utils/mapInvoice.js";

const parseDate = (value) => {
  if (!value) return null;
  // Handle dd.mm.yyyy / dd/mm/yyyy
  const parts = String(value).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (parts) {
    const [_, day, month, year] = parts;
    return new Date(+year, +month - 1, +day);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

export const uploadInvoiceSheet = async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    // Validate that sheet has required columns
    const sheetHeaders = Object.keys(rows[0] || {});
    const missingColumns = validateSheetColumns(sheetHeaders);

    if (missingColumns.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Sheet validation failed: Missing required column(s)",
        validationError: true,
        missingColumns,
        headers: sheetHeaders,
      });
    }

    const resolvedKeys = resolveHeaderKeys(sheetHeaders);
    const uniqueMap = new Map();
    const invoiceSetInSheet = new Set();

    for (const row of rows) {
      const mapped = mapExcelRowToInvoice(row, resolvedKeys);

      if (!mapped.plantReferenceNumber || !mapped.invoiceNumber) continue;

      const plantKey = String(mapped.plantReferenceNumber).trim();
      const invoiceKey = String(mapped.invoiceNumber).trim();

      // Only allow 1 row per plant number and per invoice number within the uploaded sheet
      if (!uniqueMap.has(plantKey) && !invoiceSetInSheet.has(invoiceKey)) {
        uniqueMap.set(plantKey, mapped);
        invoiceSetInSheet.add(invoiceKey);
      }
    }

    const cleanData = Array.from(uniqueMap.values());

    if (cleanData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid rows with Plant Number and Invoice Number found in the sheet",
      });
    }

    // Check existing plant numbers and invoice numbers in DB to prevent duplicates
    const plantNumbersInSheet = cleanData.map((d) => d.plantReferenceNumber);
    const invoiceNumbersInSheet = cleanData.map((d) => d.invoiceNumber);

    const existingInvoices = await Invoice.find({
      $or: [
        { plantReferenceNumber: { $in: plantNumbersInSheet } },
        { invoiceNumber: { $in: invoiceNumbersInSheet } },
      ],
    }).select("plantReferenceNumber invoiceNumber");

    const existingPlantSet = new Set(existingInvoices.map((i) => String(i.plantReferenceNumber).trim()));
    const existingInvoiceSet = new Set(existingInvoices.map((i) => String(i.invoiceNumber).trim()));

    // Filter out rows whose plant number or invoice number already exists in DB
    const nonDuplicateData = cleanData.filter(
      (d) =>
        !existingPlantSet.has(String(d.plantReferenceNumber).trim()) &&
        !existingInvoiceSet.has(String(d.invoiceNumber).trim())
    );

    let insertedCount = 0;

    if (nonDuplicateData.length > 0) {
      try {
        const inserted = await Invoice.insertMany(nonDuplicateData, {
          ordered: false,
        });

        insertedCount = inserted.length;
      } catch (error) {
        if (error.writeErrors || error.code === 11000) {
          insertedCount = error.result?.result?.nInserted || error.insertedDocs?.length || 0;
        } else {
          throw error;
        }
      }
    }

    const duplicateCount = cleanData.length - nonDuplicateData.length;

    if (req.io) req.io.emit("invoices:changed");

    res.json({
      success: true,
      data: {
        invoicesAdded: insertedCount,
        skippedDuplicates: duplicateCount,
        uniquePlants: insertedCount,
      },
      message: duplicateCount > 0
        ? `${insertedCount} invoices added (${duplicateCount} rows skipped due to duplicate Plant No / Invoice No)`
        : `${insertedCount} invoices uploaded successfully`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET

export const getInvoices = async (req, res) => {
  try {
    let {
      search = "",
      status = "",
      fromDate = "",
      toDate = "",
      dateFrom = "",
      dateTo = "",
      page = 1,
      limit = 15,
      all = "false",
    } = req.query;

    page = Number(page);
    limit = Number(limit);

    const query = {};

    // SEARCH
    if (search.trim()) {
      query.$or = [
        {
          plantReferenceNumber: {
            $regex: search,
            $options: "i",
          },
        },
        {
          customerName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          invoiceNumber: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    // STATUS FILTER
    if (status.trim()) {
      query.status = status;
    }

    // DATE RANGE FILTER
    const start = fromDate || dateFrom;
    const end = toDate || dateTo;
    if (start || end) {
      query.invoiceDate = {};
      if (start) {
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        query.invoiceDate.$gte = s;
      }
      if (end) {
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        query.invoiceDate.$lte = e;
      }
    }

    // FETCH MATCHING RECORDS: Sort by invoiceDate descending, plantReferenceNumber descending
    const invoices = await Invoice.find(query).sort({
      invoiceDate: -1,
      plantReferenceNumber: -1,
      createdAt: -1
    }).lean();

    // GROUPING
    const groupedMap = new Map();

    invoices.forEach((inv) => {
      const key = `${inv.plantReferenceNumber}_${inv.customerName}`;

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          _id: inv._id,
          plantNumber: inv.plantReferenceNumber,
          customerName: inv.customerName,
          location: inv.location || "",
          status: inv.status,
          podStatus: "Not Generated",
          createdAt: inv.createdAt,
          updatedAt: inv.updatedAt,
          assignedAt: inv.assignedAt,
          inTransitAt: inv.inTransitAt,
          deliveredAt: inv.deliveredAt,
          cancelledAt: inv.cancelledAt,
          invoices: [],
        });
      }

      groupedMap.get(key).invoices.push({
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        isChecked: inv.isChecked,
        status: inv.status,
        podStatus: "Not Generated",
        quantity: inv.quantity || 0,
        weight: inv.weight || 0,
        tyre: inv.tyre || 0,
        tube: inv.tube || 0,
        flap: inv.flap || 0,
        cancellationReason: inv.cancellationReason || "",
        beforeDispatchRemarks: inv.beforeDispatchRemarks || "",
        afterDispatchRemarks: inv.afterDispatchRemarks || "",
        assignedAt: inv.assignedAt,
        inTransitAt: inv.inTransitAt,
        deliveredAt: inv.deliveredAt,
        cancelledAt: inv.cancelledAt,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
      });
    });

    const groupedData = Array.from(groupedMap.values());

    // Sort grouped items and their sub-invoices by newest invoiceDate first, then plantNumber descending
    groupedData.forEach((group) => {
      group.invoices.sort((a, b) => {
        const dDiff = new Date(b.invoiceDate || 0) - new Date(a.invoiceDate || 0);
        if (dDiff !== 0) return dDiff;
        return String(b.invoiceNumber || "").localeCompare(String(a.invoiceNumber || ""), undefined, { numeric: true, sensitivity: "base" });
      });
    });
    groupedData.sort((a, b) => {
      const maxA = Math.max(...a.invoices.map((i) => new Date(i.invoiceDate || 0).getTime() || 0));
      const maxB = Math.max(...b.invoices.map((i) => new Date(i.invoiceDate || 0).getTime() || 0));
      if (maxB !== maxA) return maxB - maxA;
      return String(b.plantNumber || "").localeCompare(String(a.plantNumber || ""), undefined, { numeric: true, sensitivity: "base" });
    });

    // PAGINATION
    const total = groupedData.length;
    const totalPages = all === "true" ? 1 : Math.ceil(total / limit);

    const startIndex = all === "true" ? 0 : (page - 1) * limit;
    const endIndex = all === "true" ? total : startIndex + limit;

    const paginatedData = groupedData.slice(
      startIndex,
      endIndex
    );

    // Compute POD status ONLY for the paginated slice
    if (paginatedData.length > 0) {
      const targetInvoiceIds = [];
      const targetPlantNumbers = [];
      paginatedData.forEach((group) => {
        if (group.plantNumber) targetPlantNumbers.push(group.plantNumber);
        group.invoices.forEach((inv) => {
          if (inv._id) targetInvoiceIds.push(inv._id);
        });
      });

      const shipments = await Shipment.find({
        $or: [
          { "destinations.invoiceIds": { $in: targetInvoiceIds } },
          { "destinations.plantReferenceNumber": { $in: targetPlantNumbers } }
        ]
      }).select("status destinations podImages").lean();

      const calculatePodStatus = (inv, plantRef) => {
        if (inv.status === "Cancelled") return "Not Generated";

        const matchingShipment = shipments.find((s) => {
          if (!s.destinations || !Array.isArray(s.destinations)) return false;
          return s.destinations.some((d) => {
            const idMatch = d.invoiceIds && d.invoiceIds.some((id) => id.toString() === inv._id.toString());
            const plantMatch = d.plantReferenceNumber === (plantRef || inv.plantReferenceNumber);
            return idMatch || plantMatch;
          });
        });

        if (!matchingShipment) return "Not Generated";
        if (matchingShipment.status === "Pending") return "Not Generated";

        const dest = matchingShipment.destinations?.find((d) => {
          const idMatch = d.invoiceIds && d.invoiceIds.some((id) => id.toString() === inv._id.toString());
          const plantMatch = d.plantReferenceNumber === (plantRef || inv.plantReferenceNumber);
          return idMatch || plantMatch;
        });

        const hasPOD = (dest?.podImages && dest.podImages.length > 0) || (matchingShipment.podImages && matchingShipment.podImages.length > 0);
        return hasPOD ? "Received" : "Pending";
      };

      paginatedData.forEach((group) => {
        group.invoices.forEach((inv) => {
          inv.podStatus = calculatePodStatus(inv, group.plantNumber);
        });
        group.podStatus = group.invoices[0]?.podStatus || "Not Generated";
      });
    }

    res.status(200).json({
      success: true,
      data: paginatedData,
      pagination: {
        total,
        totalPages,
        currentPage: page,
      },
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateInvoiceStatus = async (req, res) => {
  try {
    const { plantId } = req.params;
    const { status, cancellationReason, reason } = req.body;

    // Stamp timestamps when status transitions
    const updateData = { status };
    if (status === "Assigned") {
      updateData.assignedAt = new Date();
      updateData.inTransitAt = null;
      updateData.deliveredAt = null;
      updateData.cancelledAt = null;
    } else if (status === "In Transit") {
      updateData.inTransitAt = new Date();
      updateData.deliveredAt = null;
      updateData.cancelledAt = null;
    } else if (status === "Delivered") {
      updateData.deliveredAt = new Date();
      updateData.cancelledAt = null;
    } else if (status === "Cancelled") {
      updateData.cancelledAt = new Date();
      updateData.deliveredAt = null;
      if (cancellationReason || reason) {
        updateData.cancellationReason = (cancellationReason || reason).trim();
      }
    } else {
      // Reset stamps if status reverts (e.g., back to Pending/Reassignment)
      updateData.assignedAt = null;
      updateData.inTransitAt = null;
      updateData.deliveredAt = null;
      updateData.cancelledAt = null;
    }

    // If plantId is a valid 24-char MongoDB ObjectId, update only that specific invoice
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(plantId);
    if (isObjectId) {
      await Invoice.findByIdAndUpdate(plantId, updateData);
    } else {
      await Invoice.updateMany(
        { plantReferenceNumber: plantId },
        updateData
      );
    }

    if (req.io) req.io.emit("invoices:changed");

    res.json({
      success: true,
      message: "Status updated",
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const toggleInvoiceCheck = async (req, res) => {
  try {
    const { plantId, invoiceNumber } = req.params;

    const invoice = await Invoice.findOne({
      _id: plantId,
      invoiceNumber,
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    invoice.isChecked = !invoice.isChecked;

    await invoice.save();

    if (req.io) req.io.emit("invoices:changed");

    res.json({
      success: true,
      data: invoice,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


export const deleteInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // Example for MongoDB
    await Invoice.findByIdAndDelete(invoiceId);

    if (req.io) req.io.emit("invoices:changed");

    res.status(200).json({
      success: true,
      message: "Invoice deleted successfully",
    });
  } catch (error) {
    console.error("Delete invoice error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete invoice",
    });
  }
};

export const getInvoicesByPlant = async (req, res) => {
  try {
    const { plantNumber } = req.params;

    const invoices = await Invoice.find({
      $or: [
        { plantReferenceNumber: plantNumber },
        { plantNumber: plantNumber },
      ],
    }).sort({ invoiceDate: -1 }).lean();

    res.status(200).json({
      success: true,
      data: invoices,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/invoices/history
   Returns Delivered invoices that have aged past 5 minutes (moved to history)
───────────────────────────────────────────────── */
export const getInvoiceHistory = async (req, res) => {
  try {
    let { search = "", fromDate = "", toDate = "", dateFrom = "", dateTo = "", page = 1, limit = 15 } = req.query;
    page = Number(page);
    limit = Number(limit);

    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);

    const query = {
      $or: [
        {
          status: "Delivered",
          $or: [
            { deliveredAt: { $lt: oneMinuteAgo } },
            { deliveredAt: null, updatedAt: { $lt: oneMinuteAgo } },
            { deliveredAt: { $exists: false }, updatedAt: { $lt: oneMinuteAgo } }
          ]
        },
        {
          status: "Cancelled",
          $or: [
            { cancelledAt: { $lt: oneMinuteAgo } },
            { cancelledAt: null, updatedAt: { $lt: oneMinuteAgo } },
            { cancelledAt: { $exists: false }, updatedAt: { $lt: oneMinuteAgo } }
          ]
        }
      ]
    };

    const start = fromDate || dateFrom;
    const end = toDate || dateTo;
    if (start || end) {
      const dateCond = {};
      if (start) {
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        dateCond.$gte = s;
      }
      if (end) {
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        dateCond.$lte = e;
      }
      query.invoiceDate = dateCond;
    }

    if (search.trim()) {
      query.$and = [
        {
          $or: [
            { plantReferenceNumber: { $regex: search, $options: "i" } },
            { customerName: { $regex: search, $options: "i" } },
            { invoiceNumber: { $regex: search, $options: "i" } },
          ]
        }
      ];
    }

    const invoices = await Invoice.find(query).sort({ invoiceDate: -1, updatedAt: -1 }).lean();

    // Group by plant + customer (same as main list)
    const groupedMap = new Map();
    invoices.forEach((inv) => {
      const key = `${inv.plantReferenceNumber}_${inv.customerName}`;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          _id: inv._id,
          plantNumber: inv.plantReferenceNumber,
          customerName: inv.customerName,
          location: inv.location || "",
          status: inv.status,
          deliveredAt: inv.deliveredAt,
          cancelledAt: inv.cancelledAt,
          invoices: [],
        });
      }
      groupedMap.get(key).invoices.push({
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        deliveredAt: inv.deliveredAt,
        cancelledAt: inv.cancelledAt,
        status: inv.status,
        quantity: inv.quantity || 0,
        weight: inv.weight || 0,
        tyre: inv.tyre || 0,
        tube: inv.tube || 0,
        flap: inv.flap || 0,
      });
    });

    const groupedData = Array.from(groupedMap.values());

    groupedData.forEach((group) => {
      group.invoices.sort((a, b) => new Date(b.invoiceDate || 0) - new Date(a.invoiceDate || 0));
    });
    groupedData.sort((a, b) => {
      const maxA = Math.max(...a.invoices.map((i) => new Date(i.invoiceDate || 0).getTime() || 0));
      const maxB = Math.max(...b.invoices.map((i) => new Date(i.invoiceDate || 0).getTime() || 0));
      if (maxB !== maxA) return maxB - maxA;
      return String(b.plantNumber || "").localeCompare(String(a.plantNumber || ""), undefined, { numeric: true, sensitivity: "base" });
    });

    // PAGINATION
    const total = groupedData.length;
    const totalPages = Math.ceil(total / limit);

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedData = groupedData.slice(
      startIndex,
      endIndex
    );

    res.json({
      data: paginatedData,
      pagination: {
        total,
        totalPages,
        page,
        limit,
      },
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const addInvoice = async (req, res) => {
  try {
    const { plantNumber, customerName, location, invoiceNumber, invoiceDate, quantity, weight, tyre, tube, flap } = req.body;

    if (!plantNumber || !customerName || !invoiceNumber || !invoiceDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: plantNumber, customerName, invoiceNumber, invoiceDate",
      });
    }

    const cleanPlantNumber = String(plantNumber).trim();
    const cleanInvoiceNumber = String(invoiceNumber).trim();
    const escapedPlant = cleanPlantNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedInvoice = cleanInvoiceNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Check if Plant Number already exists (prevent duplicate plant numbers)
    const existingPlant = await Invoice.findOne({
      plantReferenceNumber: { $regex: new RegExp(`^${escapedPlant}$`, "i") },
    });

    if (existingPlant) {
      return res.status(400).json({
        success: false,
        message: `Plant Number "${cleanPlantNumber}" already exists. Duplicate plant numbers are not allowed.`,
      });
    }

    // Check if Invoice Number already exists (prevent duplicate invoice numbers)
    const existingInvoice = await Invoice.findOne({
      invoiceNumber: { $regex: new RegExp(`^${escapedInvoice}$`, "i") },
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: `Invoice Number "${cleanInvoiceNumber}" already exists. Duplicate invoice numbers are not allowed.`,
      });
    }

    const parsedDate = parseDate(invoiceDate);
    if (!parsedDate) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice date format. Use dd/mm/yyyy (e.g. 01.07.2026)",
      });
    }

    const tyreVal = Number(tyre) || 0;
    const tubeVal = Number(tube) || 0;
    const flapVal = Number(flap) || 0;
    const itemSum = tyreVal + tubeVal + flapVal;
    const computedQty = itemSum > 0 ? itemSum : (Number(quantity) || 0);

    const newInvoice = new Invoice({
      plantReferenceNumber: cleanPlantNumber,
      customerName: customerName.trim(),
      location: location?.trim() || "",
      invoiceNumber: cleanInvoiceNumber,
      invoiceDate: parsedDate,
      quantity: computedQty,
      weight: Number(weight) || 0,
      tyre: tyreVal,
      tube: tubeVal,
      flap: flapVal,
      beforeDispatchRemarks: req.body.beforeDispatchRemarks?.trim() || "",
      afterDispatchRemarks: req.body.afterDispatchRemarks?.trim() || "",
      status: "Pending",
    });

    await newInvoice.save();

    if (req.io) req.io.emit("invoices:changed");

    res.status(201).json({
      success: true,
      message: "Invoice added successfully",
      data: newInvoice,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "An invoice with this Invoice Number already exists.",
      });
    }
    console.error("Add invoice error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to add invoice",
    });
  }
};

export const updateInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const {
      plantNumber,
      customerName,
      location,
      invoiceNumber,
      invoiceDate,
      quantity,
      weight,
      tyre,
      tube,
      flap,
      beforeDispatchRemarks,
      afterDispatchRemarks,
    } = req.body;

    if (!plantNumber || !customerName || !invoiceNumber || !invoiceDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: plantNumber, customerName, invoiceNumber, invoiceDate",
      });
    }

    const cleanPlantNumber = String(plantNumber).trim();
    const cleanInvoiceNumber = String(invoiceNumber).trim();
    const escapedPlant = cleanPlantNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedInvoice = cleanInvoiceNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Check if Plant Number is already used by another invoice
    const existingPlant = await Invoice.findOne({
      _id: { $ne: invoiceId },
      plantReferenceNumber: { $regex: new RegExp(`^${escapedPlant}$`, "i") },
    });

    if (existingPlant) {
      return res.status(400).json({
        success: false,
        message: `Plant Number "${cleanPlantNumber}" is already in use by another invoice. Duplicate plant numbers are not allowed.`,
      });
    }

    // Check if Invoice Number is already used by another invoice
    const existingInvoice = await Invoice.findOne({
      _id: { $ne: invoiceId },
      invoiceNumber: { $regex: new RegExp(`^${escapedInvoice}$`, "i") },
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: `Invoice Number "${cleanInvoiceNumber}" is already in use by another invoice. Duplicate invoice numbers are not allowed.`,
      });
    }

    const parsedDate = parseDate(invoiceDate);
    if (!parsedDate) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice date format.",
      });
    }

    const tyreVal = Number(tyre) || 0;
    const tubeVal = Number(tube) || 0;
    const flapVal = Number(flap) || 0;
    const itemSum = tyreVal + tubeVal + flapVal;
    const computedQty = itemSum > 0 ? itemSum : (Number(quantity) || 0);

    const updateFields = {
      plantReferenceNumber: cleanPlantNumber,
      customerName: customerName.trim(),
      location: location?.trim() || "",
      invoiceNumber: cleanInvoiceNumber,
      invoiceDate: parsedDate,
      quantity: computedQty,
      weight: Number(weight) || 0,
      tyre: tyreVal,
      tube: tubeVal,
      flap: flapVal,
    };
    if (beforeDispatchRemarks !== undefined) updateFields.beforeDispatchRemarks = String(beforeDispatchRemarks).trim();
    if (afterDispatchRemarks !== undefined) updateFields.afterDispatchRemarks = String(afterDispatchRemarks).trim();

    const updated = await Invoice.findByIdAndUpdate(
      invoiceId,
      updateFields,
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (req.io) req.io.emit("invoices:changed");

    // Recalculate and update totals on all shipments that contain this invoice
    try {
      const shipmentsToSync = await Shipment.find({ "destinations.invoiceIds": updated._id });
      for (const s of shipmentsToSync) {
        let modified = false;
        const updatedDestinations = await Promise.all((s.destinations || []).map(async (d) => {
          if (d.invoiceIds && d.invoiceIds.some(id => id.toString() === updated._id.toString())) {
            const invoices = await Invoice.find({ _id: { $in: d.invoiceIds } }).lean();
            if (invoices.length > 0) {
              const totalWeight = invoices.reduce((sum, inv) => sum + (Number(inv.weight) || 0), 0);
              const totalTyres = invoices.reduce((sum, inv) => sum + (Number(inv.tyre) || 0), 0);
              const totalTubes = invoices.reduce((sum, inv) => sum + (Number(inv.tube) || 0), 0);
              const totalFlaps = invoices.reduce((sum, inv) => sum + (Number(inv.flap) || 0), 0);
              const totalQuantity = totalTyres + totalTubes + totalFlaps;

              d.weightKg = parseFloat(totalWeight.toFixed(2));
              d.totalTyres = totalTyres;
              d.totalTubes = totalTubes;
              d.totalFlaps = totalFlaps;
              d.totalQuantity = totalQuantity;
              modified = true;
            }
          }
          return d;
        }));

        if (modified) {
          s.destinations = updatedDestinations;
          s.totalWeightKg = parseFloat(updatedDestinations.reduce((sum, d) => sum + (Number(d.weightKg) || 0), 0).toFixed(2));
          s.totalQuantity = updatedDestinations.reduce((sum, d) => sum + (Number(d.totalQuantity) || 0), 0);
          await s.save();
        }
      }
      if (shipmentsToSync.length > 0 && req.io) {
        req.io.emit("shipments:changed");
      }
    } catch (syncErr) {
      console.error("Failed to sync shipments after invoice edit:", syncErr);
    }

    res.json({
      success: true,
      message: "Invoice updated successfully",
      data: updated,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "An invoice with this Invoice Number already exists.",
      });
    }
    console.error("Update invoice error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update invoice",
    });
  }
};

export const updateInvoiceRemarks = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { beforeDispatchRemarks, afterDispatchRemarks } = req.body;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const updateData = {};

    // 1. Before Dispatch Remarks restriction:
    // Accessible until status is "Assigned" for 1 day (24 hours).
    if (beforeDispatchRemarks !== undefined) {
      const status = invoice.status;
      if (status === "Cancelled" || status === "In Transit" || status === "Delivered") {
        return res.status(403).json({
          success: false,
          message: "Before Dispatch Remarks cannot be edited once the invoice is In Transit, Delivered, or Cancelled.",
        });
      }
      if (status === "Assigned") {
        const assignedTime = invoice.assignedAt
          ? new Date(invoice.assignedAt).getTime()
          : (invoice.updatedAt ? new Date(invoice.updatedAt).getTime() : null);
        if (assignedTime && Date.now() - assignedTime > 24 * 60 * 60 * 1000) {
          return res.status(403).json({
            success: false,
            message: "Before Dispatch Remarks editing window (24 hours after assignment) has expired.",
          });
        }
      }
      updateData.beforeDispatchRemarks = String(beforeDispatchRemarks).trim();
    }

    // 2. After Dispatch Remarks restriction:
    // Accessible from "In Transit" for 1 week (7 days).
    if (afterDispatchRemarks !== undefined) {
      const status = invoice.status;
      if (status === "Cancelled") {
        return res.status(403).json({
          success: false,
          message: "After Dispatch Remarks cannot be edited for cancelled invoices.",
        });
      }
      const inTransitTime = invoice.inTransitAt
        ? new Date(invoice.inTransitAt).getTime()
        : ((status === "In Transit" || status === "Delivered") && invoice.updatedAt ? new Date(invoice.updatedAt).getTime() : null);
      if (inTransitTime && Date.now() - inTransitTime > 7 * 24 * 60 * 60 * 1000) {
        return res.status(403).json({
          success: false,
          message: "After Dispatch Remarks editing window (7 days after In Transit) has expired.",
        });
      }
      updateData.afterDispatchRemarks = String(afterDispatchRemarks).trim();
    }

    const updated = await Invoice.findByIdAndUpdate(invoiceId, updateData, { new: true });

    if (req.io) req.io.emit("invoices:changed");
    res.json({ success: true, message: "Remarks updated", data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
