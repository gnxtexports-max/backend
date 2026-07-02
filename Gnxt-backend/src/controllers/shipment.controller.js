import Shipment from "../models/shipment.model.js";
import Invoice from "../models/invoice.model.js";
import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";
import { compressBase64DataUrl } from "../utils/compressImage.js";
import { streamExcelExport, decodeBase64Image } from "../utils/exportToZip.js";
import { syncSingleVehicle, syncSingleDriver } from "../utils/syncStatuses.js";

/* ─────────────────────────────────────────────────
   POST /api/shipments
   Create a new shipment
───────────────────────────────────────────────── */
export const createShipment = async (req, res) => {
  try {
    const { destinations, vehicleId, driverId, notes } = req.body;

    if (!destinations?.length) {
      return res.status(400).json({ success: false, message: "At least one destination is required" });
    }
    if (!vehicleId) return res.status(400).json({ success: false, message: "Vehicle is required" });
    if (!driverId) return res.status(400).json({ success: false, message: "Driver is required" });

    // Validate vehicle exists
    const vehicle = await Vehicle.findById(vehicleId).lean();
    if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found" });

    // Validate driver exists
    const driver = await Driver.findById(driverId).lean();
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

    // Build destination docs — resolve customerName + location from invoices
    const destinationDocs = await Promise.all(destinations.map(async (d) => {
      let customerName = "";
      let deliveryLocation = d.deliveryLocation || "";

      // Try selected invoiceIds first
      if (d.invoiceIds?.length) {
        const inv = await Invoice.findById(d.invoiceIds[0])
          .select("customerName location").lean();
        if (inv) {
          customerName = inv.customerName || "";
          deliveryLocation = deliveryLocation || inv.location || "";
        }
      }

      // Fallback: look up any invoice for this plant to get customerName + location
      if ((!customerName || !deliveryLocation) && d.plantReferenceNumber) {
        const plantNumbers = d.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean);
        const inv = await Invoice.findOne({ plantReferenceNumber: { $in: plantNumbers } })
          .select("customerName location").lean();
        if (inv) {
          customerName = customerName || inv.customerName || "";
          deliveryLocation = deliveryLocation || inv.location || "";
        }
      }

      return {
        lrNumber: "",
        plantReferenceNumber: d.plantReferenceNumber,
        customerName,
        deliveryLocation,
        invoiceIds: d.invoiceIds || [],
        totalTyres: d.totalTyres || 0,
        totalTubes: d.totalTubes || 0,
        totalFlaps: d.totalFlaps || 0,
        weightKg: d.weightKg || 0,
      };
    }));

    const shipment = new Shipment({
      destinations: destinationDocs,
      vehicleId: vehicle._id,
      vehicleNumber: vehicle.vehicleNo,
      vehicleCapacityKg: vehicle.capacityKg,
      driverId: driver._id,
      driverName: driver.name,
      driverPhone: driver.phone,
      notes,
    });

    await shipment.save();

    // Mark selected invoices as Assigned
    const allPlantNumbers = destinationDocs.reduce((acc, dest) => {
      if (dest.plantReferenceNumber) {
        acc.push(...dest.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean));
      }
      return acc;
    }, []);

    if (allPlantNumbers.length) {
      // Prevent duplicate assignment if UI was out of sync
      const alreadyAssigned = await Invoice.find({
        plantReferenceNumber: { $in: allPlantNumbers },
        status: { $ne: "Pending" }
      }).lean();

      if (alreadyAssigned.length > 0) {
        return res.status(400).json({
          success: false,
          message: "One or more selected invoices have already been assigned to another shipment."
        });
      }

      await Invoice.updateMany(
        { plantReferenceNumber: { $in: allPlantNumbers } },
        { status: "Assigned" }
      );
    }

    // Sync vehicle/driver status based on active shipments
    await syncSingleVehicle(vehicle._id);
    await syncSingleDriver(driver._id);

    if (req.io) req.io.emit("shipments:changed");

    res.status(201).json({ success: true, message: "Shipment created", data: shipment });
  } catch (err) {
    console.error("Create shipment error:", err);
    res.status(500).json({ success: false, message: "Error creating shipment", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/shipments
   List shipments with optional filters
───────────────────────────────────────────────── */
export const getShipments = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status && status !== "all") query.status = status;
    if (search) {
      const r = { $regex: search, $options: "i" };
      query.$or = [
        { shipmentId: r },
        { vehicleNumber: r },
        { driverName: r },
        { "destinations.plantReferenceNumber": r },
        { "destinations.lrNumber": r },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [shipments, total] = await Promise.all([
      Shipment.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("destinations.invoiceIds", "invoiceNumber invoiceDate customerName location")
        .lean(),
      Shipment.countDocuments(query),
    ]);

    // Backfill customerName + deliveryLocation for destinations that are missing them
    // (records created before the denormalization fix)
    const enriched = await Promise.all(shipments.map(async (s) => {
      const destinations = await Promise.all((s.destinations ?? []).map(async (dest) => {
        if (dest.customerName && dest.deliveryLocation) return dest; // already set

        // Try populated invoices first
        const popInv = (dest.invoiceIds ?? []).find((inv) => typeof inv === "object");
        let customerName = dest.customerName || popInv?.customerName || "";
        let deliveryLocation = dest.deliveryLocation || popInv?.location || "";

        // Fallback: look up by plantReferenceNumber
        if ((!customerName || !deliveryLocation) && dest.plantReferenceNumber) {
          const plantNumbers = dest.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean);
          const inv = await Invoice.findOne({ plantReferenceNumber: { $in: plantNumbers } })
            .select("customerName location").lean();
          customerName = customerName || inv?.customerName || "";
          deliveryLocation = deliveryLocation || inv?.location || "";
        }

        return { ...dest, customerName, deliveryLocation };
      }));
      return { ...s, destinations };
    }));

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    console.error("Get shipments error:", err);
    res.status(500).json({ success: false, message: "Error fetching shipments", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/shipments/:id
───────────────────────────────────────────────── */
export const getShipmentById = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate("vehicleId", "vehicleNo type model capacityKg")
      .populate("driverId", "name phone licenseNumber driverType")
      .populate("destinations.invoiceIds", "invoiceNumber invoiceDate plantReferenceNumber customerName location")
      .lean();

    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

    // Backfill customerName + deliveryLocation for destinations if missing
    const enrichedDestinations = await Promise.all((shipment.destinations ?? []).map(async (dest) => {
      let customerName = dest.customerName || "";
      let deliveryLocation = dest.deliveryLocation || "";

      // Try populated invoices first
      const popInv = (dest.invoiceIds ?? []).find((inv) => typeof inv === "object");
      customerName = customerName || popInv?.customerName || "";
      deliveryLocation = deliveryLocation || popInv?.location || "";

      // Fallback lookup
      if ((!customerName || !deliveryLocation) && dest.plantReferenceNumber) {
        const plantNumbers = dest.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean);
        const inv = await Invoice.findOne({ plantReferenceNumber: { $in: plantNumbers } })
          .select("customerName location").lean();
        customerName = customerName || inv?.customerName || "";
        deliveryLocation = deliveryLocation || inv?.location || "";
      }

      return { ...dest, customerName, deliveryLocation };
    }));

    shipment.destinations = enrichedDestinations;

    res.status(200).json({ success: true, data: shipment });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching shipment", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   PATCH /api/shipments/:id/status
───────────────────────────────────────────────── */
export const updateShipmentStatus = async (req, res) => {
  try {
    const { status, podReceiverName, podRemarks, podImages, destinationId, dispatchDate: manualDispatchDate, returnedDate: manualReturnedDate } = req.body;
    const allowed = ["Pending", "In Transit", "Delivered", "Cancelled", "Closed"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    if (destinationId) {
      const shipment = await Shipment.findById(req.params.id);
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

      const dest = shipment.destinations.id(destinationId);
      if (!dest) return res.status(404).json({ success: false, message: "Destination not found" });

      // If shipment is already Closed, don't regress status — only allow POD field updates
      if (shipment.status !== "Closed") {
        dest.status = status;
      }
      if (podReceiverName !== undefined) dest.podReceiverName = podReceiverName;
      if (podRemarks !== undefined) dest.podRemarks = podRemarks;
      if (podImages !== undefined) {
        dest.podImages = await Promise.all(podImages.map(img => compressBase64DataUrl(img)));
      }

      // Don't regress shipment from Closed back to Delivered
      if (shipment.status !== "Closed") {
        const allDelivered = shipment.destinations.every((d) => d.status === "Delivered");
        if (allDelivered) {
          shipment.status = "Delivered";
          shipment.deliveryDate = new Date();
        }
      }

      await shipment.save();

      // Sync invoice statuses (skip if shipment is Closed)
      if (dest.plantReferenceNumber && shipment.status !== "Closed") {
        let targetInvoiceStatus = "Assigned";
        let deliveredAt = null;
        if (status === "Delivered") {
          targetInvoiceStatus = "Delivered";
          deliveredAt = new Date();
        } else if (status === "In Transit") {
          targetInvoiceStatus = "In Transit";
        }

        const plantNumbers = dest.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean);

        const updateData = { status: targetInvoiceStatus };
        if (targetInvoiceStatus === "Delivered") {
          updateData.deliveredAt = deliveredAt;
        } else if (targetInvoiceStatus === "Pending" || targetInvoiceStatus === "Assigned" || targetInvoiceStatus === "In Transit") {
          updateData.deliveredAt = null;
        }

        await Invoice.updateMany(
          { plantReferenceNumber: { $in: plantNumbers } },
          updateData
        );
      }

      if (req.io) {
        req.io.emit("shipments:changed");
        req.io.emit("invoices:changed");
      }

      const populatedShipment = await Shipment.findById(shipment._id)
        .populate("vehicleId", "vehicleNo type model capacityKg")
        .populate("driverId", "name phone licenseNumber driverType")
        .lean();

      return res.status(200).json({ success: true, message: "Destination status updated", data: populatedShipment });
    }

    const updateFields = {
      status,
      ...(status === "Delivered" ? { deliveryDate: new Date() } : {}),
      ...(status === "In Transit" ? { dispatchDate: manualDispatchDate ? new Date(manualDispatchDate) : new Date() } : {}),
      ...(status === "Closed" ? {} : {}),
      ...(podReceiverName !== undefined ? { podReceiverName } : {}),
      ...(podRemarks !== undefined ? { podRemarks } : {}),
      ...(podImages !== undefined ? { podImages: await Promise.all(podImages.map(img => compressBase64DataUrl(img))) } : {}),
    };

    const shipment = await Shipment.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { returnDocument: "after" }
    )
      .populate("vehicleId", "vehicleNo type model capacityKg")
      .populate("driverId", "name phone licenseNumber driverType")
      .lean();
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

    // Sync vehicle & driver status based on actual active shipments (always correct)
    const vId = shipment.vehicleId?._id || shipment.vehicleId;
    const dId = shipment.driverId?._id || shipment.driverId;
    if (vId) await syncSingleVehicle(vId);
    if (dId) await syncSingleDriver(dId);

    // Sync invoice statuses
    const allPlantNumbers = shipment.destinations?.reduce((acc, dest) => {
      if (dest.plantReferenceNumber) {
        acc.push(...dest.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean));
      }
      return acc;
    }, []) || [];

    if (allPlantNumbers.length) {
      let targetInvoiceStatus = "Assigned";
      let deliveredAt = null;
      if (status === "In Transit") {
        targetInvoiceStatus = "In Transit";
      } else if (status === "Delivered" || status === "Closed") {
        targetInvoiceStatus = "Delivered";
        deliveredAt = new Date();
      } else if (status === "Cancelled") {
        targetInvoiceStatus = "Pending";
      }

      const updateData = { status: targetInvoiceStatus };
      if (targetInvoiceStatus === "Delivered") {
        updateData.deliveredAt = deliveredAt;
      } else if (targetInvoiceStatus === "Pending" || targetInvoiceStatus === "Assigned" || targetInvoiceStatus === "In Transit") {
        updateData.deliveredAt = null;
      }

      await Invoice.updateMany(
        { plantReferenceNumber: { $in: allPlantNumbers } },
        updateData
      );
    }

    if (req.io) {
      req.io.emit("shipments:changed");
      req.io.emit("invoices:changed");
    }

    res.status(200).json({ success: true, message: "Status updated", data: shipment });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating status", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   PATCH /api/shipments/:id/pod
   Update POD fields only — no status change, no side effects.
   Works on any shipment regardless of status (including Closed).
───────────────────────────────────────────────── */
export const updateShipmentPOD = async (req, res) => {
  try {
    const { podReceiverName, podRemarks, podImages, destinationId } = req.body;

    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

    if (destinationId) {
      const dest = shipment.destinations.id(destinationId);
      if (!dest) return res.status(404).json({ success: false, message: "Destination not found" });
      if (podReceiverName !== undefined) dest.podReceiverName = podReceiverName;
      if (podRemarks !== undefined) dest.podRemarks = podRemarks;
      if (podImages !== undefined) {
        dest.podImages = await Promise.all(podImages.map(img => compressBase64DataUrl(img)));
      }
    } else {
      if (podReceiverName !== undefined) shipment.podReceiverName = podReceiverName;
      if (podRemarks !== undefined) shipment.podRemarks = podRemarks;
      if (podImages !== undefined) {
        shipment.podImages = await Promise.all(podImages.map(img => compressBase64DataUrl(img)));
      }
    }

    await shipment.save();

    if (req.io) req.io.emit("shipments:changed");

    const populated = await Shipment.findById(shipment._id)
      .populate("vehicleId", "vehicleNo type model capacityKg")
      .populate("driverId", "name phone licenseNumber driverType")
      .lean();

    res.status(200).json({ success: true, message: "POD updated", data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating POD", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   PATCH /api/shipments/:id/arrival
   Record vehicle arrival time (returnedDate) manually.
   Only works on Closed shipments without returnedDate.
   Does NOT change shipment status.
───────────────────────────────────────────────── */
export const markArrival = async (req, res) => {
  try {
    const { arrivalTime } = req.body;
    if (!arrivalTime) {
      return res.status(400).json({ success: false, message: "arrivalTime is required" });
    }

    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

    if (shipment.status !== "Closed") {
      return res.status(400).json({ success: false, message: "Shipment must be Closed before marking arrival" });
    }

    if (shipment.returnedDate) {
      return res.status(400).json({ success: false, message: "Arrival already recorded for this shipment" });
    }

    shipment.returnedDate = new Date(arrivalTime);
    await shipment.save();

    // Sync vehicle & driver status after updating returnedDate
    const vId = shipment.vehicleId?._id || shipment.vehicleId;
    const dId = shipment.driverId?._id || shipment.driverId;
    if (vId) await syncSingleVehicle(vId);
    if (dId) await syncSingleDriver(dId);

    if (req.io) {
      req.io.emit("shipments:changed");
    }

    const populated = await Shipment.findById(shipment._id)
      .populate("vehicleId", "vehicleNo type model capacityKg")
      .populate("driverId", "name phone licenseNumber driverType")
      .lean();

    res.status(200).json({ success: true, message: "Arrival recorded", data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error recording arrival", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   PUT /api/shipments/:id
   Update an existing shipment (vehicle, driver, destinations)
───────────────────────────────────────────────── */
export const updateShipment = async (req, res) => {
  try {
    const { destinations, vehicleId, driverId, notes } = req.body;

    // Fetch existing shipment to handle vehicle/driver swaps
    const existing = await Shipment.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: "Shipment not found" });

    const vehicle = vehicleId ? await Vehicle.findById(vehicleId).lean() : null;
    const driver = driverId ? await Driver.findById(driverId).lean() : null;

    const update = { notes };

    // ── Vehicle change ──────────────────────────────
    if (vehicle) {
      if (existing.vehicleId?.toString() !== vehicle._id.toString()) {
        await syncSingleVehicle(existing.vehicleId);
      }
      update.vehicleId = vehicle._id;
      update.vehicleNumber = vehicle.vehicleNo;
      update.vehicleCapacityKg = vehicle.capacityKg;
    }

    // ── Driver change ───────────────────────────────
    if (driver) {
      if (existing.driverId?.toString() !== driver._id.toString()) {
        await syncSingleDriver(existing.driverId);
      }
      update.driverId = driver._id;
      update.driverName = driver.name;
      update.driverPhone = driver.phone;
    }

    // ── Status logic on update ──────────────────────
    // If vehicle or driver changed and shipment is Pending → move to In Transit
    const vehicleChanged = vehicle && existing.vehicleId?.toString() !== vehicle._id.toString();
    const driverChanged = driver && existing.driverId?.toString() !== driver._id.toString();
    if ((vehicleChanged || driverChanged) && existing.status === "Pending") {
      update.status = "In Transit";
      update.dispatchDate = new Date();
    }

    // ── Destinations ────────────────────────────────
    if (destinations?.length) {
      // Re-resolve customerName + location from invoices (same as create)
      const resolvedDests = await Promise.all(destinations.map(async (d, i) => {
        let customerName = d.customerName || "";
        let deliveryLocation = d.deliveryLocation || "";

        // Try selected invoiceIds first
        if (d.invoiceIds?.length) {
          const inv = await Invoice.findById(d.invoiceIds[0])
            .select("customerName location").lean();
          if (inv) {
            customerName = customerName || inv.customerName || "";
            deliveryLocation = deliveryLocation || inv.location || "";
          }
        }

        // Fallback: look up by plantReferenceNumber
        if ((!customerName || !deliveryLocation) && d.plantReferenceNumber) {
          const plantNumbers = d.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean);
          const inv = await Invoice.findOne({ plantReferenceNumber: { $in: plantNumbers } })
            .select("customerName location").lean();
          if (inv) {
            customerName = customerName || inv.customerName || "";
            deliveryLocation = deliveryLocation || inv.location || "";
          }
        }

        let existingLr = existing.destinations?.[i]?.lrNumber || d.lrNumber || "";
        if (!existingLr) {
          const parts = existing.shipmentId.split("-"); // ["SHP", "YYYY", "NNNNN"]
          const year = parts[1];
          const seq = parts[2];
          existingLr = `LR-${year}-${seq}-${String(i + 1).padStart(2, "0")}`;
        }

        return {
          lrNumber: existingLr,
          plantReferenceNumber: d.plantReferenceNumber,
          customerName,
          deliveryLocation,
          invoiceIds: d.invoiceIds || [],
          totalTyres: d.totalTyres || 0,
          totalTubes: d.totalTubes || 0,
          totalFlaps: d.totalFlaps || 0,
          weightKg: d.weightKg || 0,
          totalQuantity: (d.totalTyres || 0) + (d.totalTubes || 0) + (d.totalFlaps || 0),
        };
      }));

      update.destinations = resolvedDests;
      update.totalWeightKg = resolvedDests.reduce((s, d) => s + (d.weightKg || 0), 0);
      update.totalQuantity = resolvedDests.reduce((s, d) => s + (d.totalQuantity || 0), 0);

      // Revert old invoices to Pending
      const oldPlantNumbers = existing.destinations?.reduce((acc, dest) => {
        if (dest.plantReferenceNumber) {
          acc.push(...dest.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean));
        }
        return acc;
      }, []) || [];

      if (oldPlantNumbers.length) {
        await Invoice.updateMany(
          { plantReferenceNumber: { $in: oldPlantNumbers } },
          { status: "Pending" }
        );
      }

      // Mark the new set of invoices as Assigned (or current status)
      const newPlantNumbers = resolvedDests.reduce((acc, dest) => {
        if (dest.plantReferenceNumber) {
          acc.push(...dest.plantReferenceNumber.split(",").map(p => p.trim()).filter(Boolean));
        }
        return acc;
      }, []);

      if (newPlantNumbers.length) {
        const targetStatus = update.status || existing.status || "Assigned";
        let invoiceStatus = "Assigned";
        let deliveredAt = null;
        if (targetStatus === "In Transit") {
          invoiceStatus = "In Transit";
        } else if (targetStatus === "Delivered" || targetStatus === "Closed") {
          invoiceStatus = "Delivered";
          deliveredAt = new Date();
        } else if (targetStatus === "Cancelled") {
          invoiceStatus = "Pending";
        }

        const updateData = { status: invoiceStatus };
        if (invoiceStatus === "Delivered") {
          updateData.deliveredAt = deliveredAt;
        } else {
          updateData.deliveredAt = null;
        }

        await Invoice.updateMany(
          { plantReferenceNumber: { $in: newPlantNumbers } },
          updateData
        );
      }
    }

    const shipment = await Shipment.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" })
      .populate("vehicleId", "vehicleNo type model capacityKg")
      .populate("driverId", "name phone licenseNumber driverType")
      .lean();

    // Sync vehicle/driver status after update
    const vId = shipment.vehicleId?._id || shipment.vehicleId;
    const dId = shipment.driverId?._id || shipment.driverId;
    if (vId) await syncSingleVehicle(vId);
    if (dId) await syncSingleDriver(dId);

    if (req.io) {
      req.io.emit("shipments:changed");
      req.io.emit("invoices:changed");
    }

    res.status(200).json({ success: true, message: "Shipment updated", data: shipment });
  } catch (err) {
    console.error("Update shipment error:", err);
    res.status(500).json({ success: false, message: "Error updating shipment", error: err.message });
  }
};


export const deleteShipment = async (req, res) => {
  try {
    // Fetch first so we have vehicleId / driverId before deletion
    const shipment = await Shipment.findById(req.params.id).lean();
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

    await Shipment.findByIdAndDelete(req.params.id);

    const vId = shipment.vehicleId?._id || shipment.vehicleId;
    const dId = shipment.driverId?._id || shipment.driverId;

    // Sync vehicle/driver status after deletion
    if (vId) await syncSingleVehicle(vId);
    if (dId) await syncSingleDriver(dId);

    // Revert associated invoices back to Pending ONLY if they are not in another active shipment
    const allInvoiceIds = shipment.destinations?.reduce((acc, dest) => {
      if (dest.invoiceIds?.length) acc.push(...dest.invoiceIds);
      return acc;
    }, []) || [];

    if (allInvoiceIds.length) {
      const invoicesToRevert = [];
      for (const invId of allInvoiceIds) {
        // Check if this invoice is still part of another shipment that is not cancelled
        const otherShipment = await Shipment.findOne({
          _id: { $ne: shipment._id },
          "destinations.invoiceIds": invId,
          status: { $in: ["Pending", "In Transit", "Delivered", "Closed"] }
        }).lean();

        if (!otherShipment) {
          invoicesToRevert.push(invId);
        }
      }

      if (invoicesToRevert.length > 0) {
        await Invoice.updateMany({ _id: { $in: invoicesToRevert } }, { status: "Pending" });
      }
    }

    if (req.io) {
      req.io.emit("shipments:changed");
      req.io.emit("invoices:changed");
    }

    res.status(200).json({ success: true, message: "Shipment deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting shipment", error: err.message });
  }
};


/* ─────────────────────────────────────────────────
   GET /api/shipments/invoices-by-plant/:plantRef
   Returns invoices for a plant (for the create form)
───────────────────────────────────────────────── */
export const getInvoicesByPlant = async (req, res) => {
  try {
    const invoices = await Invoice.find({
      plantReferenceNumber: req.params.plantRef,
      status: { $in: ["Pending"] },
    })
      .select("invoiceNumber invoiceDate status location customerName plantReferenceNumber")
      .sort({ invoiceDate: -1 })
      .lean();

    res.status(200).json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching invoices", error: err.message });
  }
};

/* ── GET /api/shipments/next-id
   Returns the next shipment ID that will be generated (preview)
───────────────────────────────────────────────── */
export const getNextShipmentId = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = `SHP-${year}-`;
    const last = await Shipment.findOne(
      { shipmentId: { $regex: `^${prefix}` } },
      { shipmentId: 1 },
      { sort: { shipmentId: -1 } }
    ).lean();

    let next = 1;
    if (last?.shipmentId) {
      const seq = parseInt(last.shipmentId.replace(prefix, ""), 10);
      if (!isNaN(seq)) next = seq + 1;
    }

    const nextShipmentId = `${prefix}${String(next).padStart(5, "0")}`;
    // LR numbers follow the same sequence: LR-YYYY-NNNNN-01, -02, etc.
    const lrPrefix = `LR-${year}-${String(next).padStart(5, "0")}`;

    res.status(200).json({ success: true, data: { nextShipmentId, lrPrefix, sequence: next } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching next ID", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/shipments/plant-numbers
   Returns distinct plant reference numbers from invoices
───────────────────────────────────────────────── */
export const getPlantNumbers = async (req, res) => {
  try {
    const plants = await Invoice.distinct("plantReferenceNumber", { status: "Pending" });
    res.status(200).json({ success: true, data: plants.sort() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching plant numbers", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/shipments/by-driver/:driverId
   Returns all shipments assigned to a specific driver
───────────────────────────────────────────────── */
export const getShipmentsByDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const shipments = await Shipment.find({ driverId })
      .sort({ createdAt: -1 })
      .populate("vehicleId", "vehicleNo type model capacityKg")
      .lean();

    res.status(200).json({ success: true, data: shipments });
  } catch (err) {
    console.error("Get shipments by driver error:", err);
    res.status(500).json({ success: false, message: "Error fetching driver shipments", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/shipments/related-plants/:plantRef
   Returns distinct plant numbers sharing the same customerName and location from invoices
───────────────────────────────────────────────── */
export const getRelatedPlants = async (req, res) => {
  try {
    const { plantRef } = req.params;

    // Find the customer and location of the current plantRef from invoices
    const refInvoice = await Invoice.findOne({ plantReferenceNumber: plantRef })
      .select("customerName location")
      .lean();

    if (!refInvoice) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Find all OTHER plant numbers that share the same customerName and location and are Pending
    const related = await Invoice.distinct("plantReferenceNumber", {
      plantReferenceNumber: { $ne: plantRef },
      customerName: refInvoice.customerName,
      location: refInvoice.location,
      status: "Pending"
    });

    res.status(200).json({ success: true, data: related.sort() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching related plants", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/shipments/export
   Export all shipments as ZIP (Excel + POD images)
───────────────────────────────────────────────── */
export const exportShipments = async (req, res) => {
  try {
    const { status, search, ids } = req.query;
    const query = {};

    if (ids) {
      query._id = { $in: ids.split(",") };
    } else {
      if (status && status !== "all") query.status = status;
      if (search) {
        const r = { $regex: search, $options: "i" };
        query.$or = [
          { shipmentId: r },
          { vehicleNumber: r },
          { driverName: r },
          { "destinations.plantReferenceNumber": r },
          { "destinations.lrNumber": r },
        ];
      }
    }

    const shipments = await Shipment.find(query)
      .populate("destinations.invoiceIds", "invoiceNumber invoiceDate customerName location")
      .sort({ createdAt: -1 })
      .lean();

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const rows = [];

    for (const s of shipments) {
      // Per-destination details (ensures alignment)
      for (const dest of s.destinations ?? []) {
        const baseRow = {
          shipmentId: s.shipmentId,
          status: dest.status || s.status,
          vehicleNumber: s.vehicleNumber,
          driverName: s.driverName,
          driverPhone: s.driverPhone || "",
          plantNumber: dest.plantReferenceNumber || "",
          lrNumber: dest.lrNumber || "",
          customerName: dest.customerName || "",
          deliveryLocation: dest.deliveryLocation || "",
          weightKg: dest.weightKg || 0,
          totalQuantity: dest.totalQuantity || 0,
          dispatchDate: s.dispatchDate ? new Date(s.dispatchDate).toLocaleDateString("en-IN") : "",
          deliveryDate: s.deliveryDate ? new Date(s.deliveryDate).toLocaleDateString("en-IN") : "",
          returnedDate: s.returnedDate ? new Date(s.returnedDate).toLocaleDateString("en-IN") : "",
          podReceiver: dest.podReceiverName || "",
          podRemarks: dest.podRemarks || "",
          podImage: "",
        };

        if (dest.podImages?.length) {
          for (let i = 0; i < dest.podImages.length; i++) {
            const label = dest.podImages.length === 1 ? "View POD" : `View POD ${i + 1}`;
            rows.push({
              ...baseRow,
              podImage: {
                label,
                target: `${baseUrl}/api/shipments/${s.shipmentId}/pod/${i}`,
                tooltip: `POD: ${s.shipmentId} — ${label}`,
              },
            });
          }
        } else {
          rows.push(baseRow);
        }
      }

      // Shipment-level POD images (legacy / fallback)
      if (s.podImages?.length) {
        for (let i = 0; i < s.podImages.length; i++) {
          const label = s.podImages.length === 1 ? "View POD" : `View POD ${i + 1}`;
          rows.push({
            shipmentId: s.shipmentId,
            status: s.status,
            vehicleNumber: s.vehicleNumber,
            driverName: s.driverName,
            driverPhone: s.driverPhone || "",
            plantNumber: "(shipment-level)",
            lrNumber: "",
            customerName: "",
            deliveryLocation: "",
            weightKg: s.totalWeightKg || 0,
            totalQuantity: s.totalQuantity || 0,
            dispatchDate: s.dispatchDate ? new Date(s.dispatchDate).toLocaleDateString("en-IN") : "",
            deliveryDate: s.deliveryDate ? new Date(s.deliveryDate).toLocaleDateString("en-IN") : "",
            returnedDate: s.returnedDate ? new Date(s.returnedDate).toLocaleDateString("en-IN") : "",
            podReceiver: s.podReceiverName || "",
            podRemarks: s.podRemarks || "",
            podImage: {
              label,
              target: `${baseUrl}/api/shipments/${s.shipmentId}/pod/${i}`,
              tooltip: `POD: ${s.shipmentId} — ${label}`,
            },
          });
        }
      }
    }

    const columns = [
      { header: "Shipment ID", key: "shipmentId", width: 20 },
      { header: "Status", key: "status", width: 14 },
      { header: "Vehicle No", key: "vehicleNumber", width: 16 },
      { header: "Driver Name", key: "driverName", width: 20 },
      { header: "Driver Phone", key: "driverPhone", width: 16 },
      { header: "Plant Number", key: "plantNumber", width: 18 },
      { header: "LR Number", key: "lrNumber", width: 22 },
      { header: "Customer Name", key: "customerName", width: 20 },
      { header: "Location", key: "deliveryLocation", width: 18 },
      { header: "Weight (kg)", key: "weightKg", width: 14 },
      { header: "Quantity", key: "totalQuantity", width: 12 },
      { header: "Dispatch Date", key: "dispatchDate", width: 16 },
      { header: "Delivery Date", key: "deliveryDate", width: 16 },
      { header: "Returned Date", key: "returnedDate", width: 16 },
      { header: "POD Receiver", key: "podReceiver", width: 18 },
      { header: "POD Remarks", key: "podRemarks", width: 20 },
      { header: "POD Image", key: "podImage", width: 18, type: "link" },
    ];

    const dateStr = new Date().toISOString().slice(0, 10);
    await streamExcelExport({
      res,
      filename: `Shipment_History_${dateStr}.xlsx`,
      sheetName: "Shipments",
      columns,
      rows,
    });
  } catch (err) {
    console.error("Export shipments error:", err);
    res.status(500).json({ success: false, message: "Export failed", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/shipments/:id/pod/:podIndex
   Serve a POD image by shipment ID and index
 ───────────────────────────────────────────────── */
export const getShipmentPodImage = async (req, res) => {
  try {
    const { id, podIndex } = req.params;
    const idx = parseInt(podIndex, 10);

    if (isNaN(idx) || idx < 0) {
      return res.status(400).send("Invalid pod index");
    }

    const shipment = await Shipment.findOne({ shipmentId: id }).lean();
    if (!shipment) {
      return res.status(404).send("Shipment not found");
    }

    // Check destination-level images first
    for (const dest of shipment.destinations ?? []) {
      if (dest.podImages && dest.podImages[idx]) {
        const dataUrl = dest.podImages[idx];
        const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          const buffer = Buffer.from(match[2], "base64");
          res.setHeader("Content-Type", `image/${match[1]}`);
          return res.send(buffer);
        }
      }
    }

    // Check shipment-level images (legacy)
    if (shipment.podImages && shipment.podImages[idx]) {
      const dataUrl = shipment.podImages[idx];
      const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        const buffer = Buffer.from(match[2], "base64");
        res.setHeader("Content-Type", `image/${match[1]}`);
        return res.send(buffer);
      }
    }

    res.status(404).send("POD image not found");
  } catch (err) {
    res.status(500).send("Error retrieving POD image: " + err.message);
  }
};
