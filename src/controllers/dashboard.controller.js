import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Invoice from "../models/invoice.model.js";
import Expense from "../models/expense.model.js";

export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const todayFilter = { $gte: todayStart, $lte: todayEnd };

    const [
      activeShipmentsDocs,
      pendingShipmentsDocs,
      pendingInvoicesDocs,
      cancelledInvoicesCount,
      deliveredTodayDocs
    ] = await Promise.all([
      Shipment.find({ status: "In Transit" }).lean(),
      Shipment.find({ status: "Pending" }).lean(),
      Invoice.find({ status: "Pending" }).select("weight invoiceNumber").lean(),
      Invoice.countDocuments({
        status: "Cancelled",
        $or: [
          { cancelledAt: todayFilter },
          { createdAt: todayFilter }
        ]
      }),
      Shipment.find({
        status: { $in: ["Delivered", "Closed"] },
        $or: [
          { deliveryDate: todayFilter },
          { deliveryDate: { $exists: false }, dispatchDate: todayFilter },
          { deliveryDate: null, dispatchDate: todayFilter },
          { deliveryDate: { $exists: false }, dispatchDate: { $exists: false }, createdAt: todayFilter }
        ]
      }).lean()
    ]);

    // 1. In Transit Shipments metrics
    const inTransitShipmentsCount = activeShipmentsDocs.length;
    let inTransitWeightKg = 0;
    let inTransitInvoicesCount = 0;

    activeShipmentsDocs.forEach((s) => {
      inTransitWeightKg += s.totalWeightKg || 0;
      if (s.destinations && Array.isArray(s.destinations)) {
        s.destinations.forEach((d) => {
          if (d.invoiceNumbers && Array.isArray(d.invoiceNumbers)) {
            inTransitInvoicesCount += d.invoiceNumbers.length;
          } else if (d.invoiceIds && Array.isArray(d.invoiceIds)) {
            inTransitInvoicesCount += d.invoiceIds.length;
          } else {
            inTransitInvoicesCount += 1;
          }
        });
      } else {
        inTransitInvoicesCount += 1;
      }
    });

    // 2. Pending Invoices for Dispatch metrics
    let pendingInvoicesCount = 0;
    let pendingWeightKg = 0;

    if (pendingShipmentsDocs.length > 0) {
      pendingShipmentsDocs.forEach((s) => {
        pendingWeightKg += s.totalWeightKg || 0;
        if (s.destinations && Array.isArray(s.destinations)) {
          s.destinations.forEach((d) => {
            if (d.invoiceNumbers && Array.isArray(d.invoiceNumbers)) {
              pendingInvoicesCount += d.invoiceNumbers.length;
            } else if (d.invoiceIds && Array.isArray(d.invoiceIds)) {
              pendingInvoicesCount += d.invoiceIds.length;
            } else {
              pendingInvoicesCount += 1;
            }
          });
        } else {
          pendingInvoicesCount += 1;
        }
      });
    } else {
      pendingInvoicesCount = pendingInvoicesDocs.length;
      pendingWeightKg = pendingInvoicesDocs.reduce((acc, inv) => acc + (Number(inv.weight) || 0), 0);
    }

    // 3. Deliveries Today metrics
    const deliveredShipmentsCount = deliveredTodayDocs.length;
    let deliveredWeightKg = 0;
    let deliveredInvoicesCount = 0;
    let pendingPodsTodayCount = 0;

    deliveredTodayDocs.forEach((s) => {
      deliveredWeightKg += s.totalWeightKg || 0;
      if (s.destinations && Array.isArray(s.destinations)) {
        s.destinations.forEach((d) => {
          const numInvs = (d.invoiceNumbers && Array.isArray(d.invoiceNumbers))
            ? d.invoiceNumbers.length
            : (d.invoiceIds && Array.isArray(d.invoiceIds))
            ? d.invoiceIds.length
            : 1;
          deliveredInvoicesCount += numInvs;
          if (!d.podImages || d.podImages.length === 0) {
            pendingPodsTodayCount += numInvs;
          }
        });
      } else {
        deliveredInvoicesCount += 1;
        if (!s.podImages || s.podImages.length === 0) {
          pendingPodsTodayCount += 1;
        }
      }
    });

    const stats = [
      {
        title: "In Transit Shipments",
        value: inTransitShipmentsCount.toString(),
        inTransitInvoices: inTransitInvoicesCount,
        inTransitWeight: inTransitWeightKg,
        inTransitWeightFormatted: `${inTransitWeightKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`,
        trendUp: true,
        iconName: "Truck",
        iconColor: "text-blue-600",
        bg: "bg-blue-50",
        border: "border-blue-100"
      },
      {
        title: "Pending Invoices for Dispatch",
        value: (pendingShipmentsDocs.length || pendingInvoicesCount).toString(),
        pendingInvoices: pendingInvoicesCount,
        pendingWeight: pendingWeightKg,
        pendingWeightFormatted: `${pendingWeightKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`,
        trendUp: true,
        iconName: "Clock",
        iconColor: "text-amber-600",
        bg: "bg-amber-50",
        border: "border-amber-100"
      },
      {
        title: "Cancelled Invoices",
        value: cancelledInvoicesCount.toString(),
        trendUp: false,
        iconName: "XCircle",
        iconColor: "text-red-600",
        bg: "bg-red-50",
        border: "border-red-100"
      },
      {
        title: "Deliveries Today",
        value: deliveredShipmentsCount.toString(),
        deliveredInvoices: deliveredInvoicesCount,
        deliveredWeight: deliveredWeightKg,
        deliveredWeightFormatted: `${deliveredWeightKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`,
        pendingPODs: pendingPodsTodayCount,
        trendUp: true,
        iconName: "CheckCircle2",
        iconColor: "text-emerald-600",
        bg: "bg-emerald-50",
        border: "border-emerald-100"
      }
    ];

    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching dashboard stats", error: err.message });
  }
};

export const getDashboardWeeklyData = async (req, res) => {
  try {
    const { fromDate, toDate, dateFrom, dateTo } = req.query;
    const startParam = fromDate || dateFrom;
    const endParam = toDate || dateTo;

    let days = [];
    if (startParam && endParam) {
      let cur = new Date(startParam);
      cur.setHours(0, 0, 0, 0);
      const end = new Date(endParam);
      end.setHours(23, 59, 59, 999);
      while (cur <= end && days.length < 31) {
        days.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      days = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d;
      });
    }

    if (days.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const rangeStart = new Date(days[0]);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(days[days.length - 1]);
    rangeEnd.setHours(23, 59, 59, 999);

    const rangeQuery = { $gte: rangeStart, $lte: rangeEnd };

    const [dispatchedDocs, pendingDocs] = await Promise.all([
      Shipment.find({
        status: { $in: ["In Transit", "Delivered", "Closed"] },
        $or: [
          { dispatchDate: rangeQuery },
          { dispatchDate: { $exists: false }, createdAt: rangeQuery },
          { dispatchDate: null, createdAt: rangeQuery }
        ]
      }).select("dispatchDate deliveryDate createdAt totalWeightKg destinations status").lean(),
      Shipment.find({
        status: "Pending",
        $or: [
          { dispatchDate: rangeQuery },
          { dispatchDate: { $exists: false }, createdAt: rangeQuery },
          { dispatchDate: null, createdAt: rangeQuery }
        ]
      }).select("dispatchDate createdAt totalWeightKg destinations status").lean()
    ]);

    const countInvoices = (s) => {
      let count = 0;
      if (s.destinations && Array.isArray(s.destinations)) {
        s.destinations.forEach((d) => {
          if (d.invoiceNumbers && Array.isArray(d.invoiceNumbers)) count += d.invoiceNumbers.length;
          else if (d.invoiceIds && Array.isArray(d.invoiceIds)) count += d.invoiceIds.length;
          else count += 1;
        });
      } else {
        count += 1;
      }
      return count;
    };

    const data = days.map((date) => {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const isForDay = (docDate) => docDate && new Date(docDate) >= dayStart && new Date(docDate) <= dayEnd;

      let dispatchedInvoices = 0;
      let dispatchedWeightKg = 0;
      let deliveriesCount = 0;

      dispatchedDocs.forEach((s) => {
        const dDate = s.dispatchDate || s.createdAt;
        if (isForDay(dDate)) {
          dispatchedWeightKg += s.totalWeightKg || 0;
          dispatchedInvoices += countInvoices(s);
        }
        const delDate = s.deliveryDate || s.dispatchDate || s.createdAt;
        if (["Delivered", "Closed"].includes(s.status) && isForDay(delDate)) {
          deliveriesCount += 1;
        }
      });

      let pendingDispatches = 0;
      pendingDocs.forEach((s) => {
        const dDate = s.dispatchDate || s.createdAt;
        if (isForDay(dDate)) {
          pendingDispatches += countInvoices(s);
        }
      });

      const totalInvoices = dispatchedInvoices + pendingDispatches;

      return {
        name: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dispatchedInvoices,
        pendingDispatches,
        totalInvoices,
        dispatchedWeightKg: Math.round(dispatchedWeightKg * 100) / 100,
        dispatches: dispatchedInvoices,
        deliveries: deliveriesCount
      };
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching weekly data", error: err.message });
  }
};

export const getDashboardSummary = async (req, res) => {
  try {
    const { fromDate, toDate, dateFrom, dateTo } = req.query;

    const startParam = fromDate || dateFrom;
    const endParam = toDate || dateTo;

    let startDate, endDate;

    if (startParam) {
      startDate = new Date(startParam);
      startDate.setHours(0, 0, 0, 0);
    } else {
      // Default to 1st day of current month
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    if (endParam) {
      endDate = new Date(endParam);
      endDate.setHours(23, 59, 59, 999);
    } else {
      const now = new Date();
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const dateQuery = { $gte: startDate, $lte: endDate };

    const [dispatchedShipmentsDocs, pendingShipmentsDocs, rangeInvoiceCount] = await Promise.all([
      Shipment.find({
        status: { $in: ["In Transit", "Delivered", "Closed"] },
        $or: [
          { dispatchDate: dateQuery },
          { dispatchDate: { $exists: false }, createdAt: dateQuery },
          { dispatchDate: null, createdAt: dateQuery }
        ]
      }).lean(),
      Shipment.find({
        status: "Pending",
        $or: [
          { dispatchDate: dateQuery },
          { dispatchDate: { $exists: false }, createdAt: dateQuery },
          { dispatchDate: null, createdAt: dateQuery }
        ]
      }).lean(),
      Invoice.countDocuments({
        $or: [
          { invoiceDate: dateQuery },
          { createdAt: dateQuery }
        ]
      })
    ]);

    let dispatchedInvoices = 0;
    let dispatchedWeightKg = 0;
    let pendingPODsCount = 0;

    dispatchedShipmentsDocs.forEach((s) => {
      dispatchedWeightKg += s.totalWeightKg || 0;
      if (s.destinations && Array.isArray(s.destinations)) {
        s.destinations.forEach((d) => {
          const numInvs = (d.invoiceNumbers && Array.isArray(d.invoiceNumbers))
            ? d.invoiceNumbers.length
            : (d.invoiceIds && Array.isArray(d.invoiceIds))
            ? d.invoiceIds.length
            : 1;
          dispatchedInvoices += numInvs;
          if (!d.podImages || d.podImages.length === 0) {
            pendingPODsCount += numInvs;
          }
        });
      } else {
        dispatchedInvoices += 1;
        if (!s.podImages || s.podImages.length === 0) {
          pendingPODsCount += 1;
        }
      }
    });

    let pendingDispatches = 0;
    pendingShipmentsDocs.forEach((s) => {
      if (s.destinations && Array.isArray(s.destinations)) {
        s.destinations.forEach((d) => {
          if (d.invoiceNumbers && Array.isArray(d.invoiceNumbers)) {
            pendingDispatches += d.invoiceNumbers.length;
          } else if (d.invoiceIds && Array.isArray(d.invoiceIds)) {
            pendingDispatches += d.invoiceIds.length;
          } else {
            pendingDispatches += 1;
          }
        });
      } else {
        pendingDispatches += 1;
      }
    });

    const totalInvoices = Math.max(rangeInvoiceCount, dispatchedInvoices + pendingDispatches);

    let totalDispatchedWeightFormatted = "";
    if (dispatchedWeightKg >= 1000) {
      totalDispatchedWeightFormatted = `${(dispatchedWeightKg / 1000).toFixed(2)} Ton`;
    } else {
      totalDispatchedWeightFormatted = `${(Math.round(dispatchedWeightKg * 100) / 100).toLocaleString("en-IN")} kg`;
    }

    res.status(200).json({
      success: true,
      data: {
        totalInvoices,
        dispatchedInvoices,
        pendingDispatches,
        pendingPODs: pendingPODsCount,
        totalDispatchedWeightKg: Math.round(dispatchedWeightKg * 100) / 100,
        totalDispatchedWeightFormatted,
        fromDate: startDate.toISOString().split("T")[0],
        toDate: endDate.toISOString().split("T")[0]
      }
    });
  } catch (err) {
    console.error("Get dashboard summary error:", err);
    res.status(500).json({ success: false, message: "Error fetching summary data", error: err.message });
  }
};

export const getDashboardInvoiceSummary = async (req, res) => {
  try {
    const { fromDate, toDate, dateFrom, dateTo } = req.query;
    const startParam = fromDate || dateFrom;
    const endParam = toDate || dateTo;

    let startDate, endDate;
    if (startParam) {
      startDate = new Date(startParam);
      startDate.setHours(0, 0, 0, 0);
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    if (endParam) {
      endDate = new Date(endParam);
      endDate.setHours(23, 59, 59, 999);
    } else {
      const now = new Date();
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const dateQuery = { $gte: startDate, $lte: endDate };

    // STRICT AUTHENTIC QUERY: Filter invoices strictly by invoiceDate in the requested date range
    const invoices = await Invoice.find({
      invoiceDate: dateQuery
    }).lean();

    // Cross-check shipments to accurately determine POD status for delivered invoices
    const deliveredInvoices = invoices.filter(inv => inv.status === "Delivered");
    const deliveredInvoiceNumbers = deliveredInvoices.map(inv => inv.invoiceNumber).filter(Boolean);
    const deliveredInvoiceIds = deliveredInvoices.map(inv => inv._id).filter(Boolean);

    let shipments = [];
    if (deliveredInvoiceNumbers.length > 0 || deliveredInvoiceIds.length > 0) {
      shipments = await Shipment.find({
        $or: [
          { "destinations.invoiceNumbers": { $in: deliveredInvoiceNumbers } },
          { "destinations.invoiceIds": { $in: deliveredInvoiceIds } }
        ]
      }).select("destinations podImages status").lean();
    }

    let totalWeight = 0;
    let cancelledCount = 0;
    let cancelledWeight = 0;
    let deliveredCount = 0;
    let deliveredWeight = 0;
    let inTransitCount = 0;
    let inTransitWeight = 0;
    let pendingCount = 0;
    let pendingWeight = 0;
    let podPendingCount = 0;

    // Track which invoices have POD pending from linked destinations
    const invoicePodStatusMap = new Map();
    shipments.forEach(s => {
      (s.destinations || []).forEach(d => {
        const hasPod = d.podImages && d.podImages.length > 0;
        (d.invoiceNumbers || []).forEach(num => invoicePodStatusMap.set(num, hasPod));
        (d.invoiceIds || []).forEach(id => invoicePodStatusMap.set(id.toString(), hasPod));
      });
    });

    invoices.forEach(inv => {
      const w = Number(inv.weight) || 0;
      const invId = inv._id?.toString();
      const hasPod = invoicePodStatusMap.has(inv.invoiceNumber) 
        ? invoicePodStatusMap.get(inv.invoiceNumber)
        : (invId && invoicePodStatusMap.has(invId) ? invoicePodStatusMap.get(invId) : false);

      if (inv.status === "Cancelled") {
        cancelledCount++;
        cancelledWeight += w;
      } else if (inv.status === "Delivered") {
        deliveredCount++;
        deliveredWeight += w;
        totalWeight += w;
        if (!hasPod) {
          podPendingCount++;
        }
      } else if (inv.status === "In Transit") {
        inTransitCount++;
        inTransitWeight += w;
        totalWeight += w;
      } else if (inv.status === "Pending" || inv.status === "Assigned") {
        pendingCount++;
        pendingWeight += w;
      }
    });

    // If totalWeight is 0 or less than delivered+inTransit, ensure consistency
    if (totalWeight === 0 && (deliveredWeight > 0 || inTransitWeight > 0)) {
      totalWeight = deliveredWeight + inTransitWeight;
    }

    const formatKg = (val) => `${(Math.round(val * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

    const detailedInvoices = invoices.map(inv => {
      const invId = inv._id?.toString();
      const hasPod = invoicePodStatusMap.has(inv.invoiceNumber) 
        ? invoicePodStatusMap.get(inv.invoiceNumber)
        : (invId && invoicePodStatusMap.has(invId) ? invoicePodStatusMap.get(invId) : false);

      let podStatus = "Not Generated";
      if (inv.status === "Cancelled") {
        podStatus = "Not Generated";
      } else if (inv.status === "Delivered") {
        podStatus = hasPod ? "Uploaded" : "Pending";
      } else if (inv.status === "In Transit") {
        podStatus = "In Transit";
      } else {
        podStatus = "Pending Dispatch";
      }

      return {
        _id: inv._id,
        id: inv.invoiceNumber,
        invoiceNumber: inv.invoiceNumber,
        plantReferenceNumber: inv.plantReferenceNumber,
        customerName: inv.customerName,
        customer: inv.customerName,
        location: inv.location || "—",
        weight: Number(inv.weight) || 0,
        quantity: inv.quantity || 0,
        status: inv.status,
        invoiceDate: inv.invoiceDate,
        originalDate: inv.invoiceDate || inv.createdAt,
        hasPod,
        podStatus,
        cancellationReason: inv.cancellationReason || "",
        createdAt: inv.createdAt
      };
    });

    res.status(200).json({
      success: true,
      data: {
        totalInvoices: {
          count: invoices.length,
          weightKg: Math.round(totalWeight * 100) / 100,
          weightFormatted: formatKg(totalWeight)
        },
        cancelledInvoices: {
          count: cancelledCount,
          weightKg: Math.round(cancelledWeight * 100) / 100,
          weightFormatted: cancelledWeight > 0 ? formatKg(cancelledWeight) : "-"
        },
        deliveredInvoices: {
          count: deliveredCount,
          weightKg: Math.round(deliveredWeight * 100) / 100,
          weightFormatted: formatKg(deliveredWeight)
        },
        inTransitInvoices: {
          count: inTransitCount,
          weightKg: Math.round(inTransitWeight * 100) / 100,
          weightFormatted: formatKg(inTransitWeight)
        },
        pendingInvoices: {
          count: pendingCount,
          weightKg: Math.round(pendingWeight * 100) / 100,
          weightFormatted: formatKg(pendingWeight)
        },
        podPending: {
          count: podPendingCount
        },
        fromDate: startDate.toISOString().split("T")[0],
        toDate: endDate.toISOString().split("T")[0],
        items: detailedInvoices
      }
    });
  } catch (err) {
    console.error("Get invoice summary error:", err);
    res.status(500).json({ success: false, message: "Error fetching invoice summary", error: err.message });
  }
};

export const getDashboardDispatchSummary = async (req, res) => {
  try {
    const { fromDate, toDate, dateFrom, dateTo } = req.query;
    const startParam = fromDate || dateFrom;
    const endParam = toDate || dateTo;

    let startDate, endDate;
    if (startParam) {
      startDate = new Date(startParam);
      startDate.setHours(0, 0, 0, 0);
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    if (endParam) {
      endDate = new Date(endParam);
      endDate.setHours(23, 59, 59, 999);
    } else {
      const now = new Date();
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const dateQuery = { $gte: startDate, $lte: endDate };

    // Query shipments dispatched in range
    const dispatchedShipments = await Shipment.find({
      status: { $in: ["In Transit", "Delivered", "Closed"] },
      $or: [
        { dispatchDate: dateQuery },
        { dispatchDate: { $exists: false }, createdAt: dateQuery },
        { dispatchDate: null, createdAt: dateQuery }
      ]
    }).sort({ dispatchDate: -1, createdAt: -1 }).lean();

    let despatchedInvoices = 0;
    let despatchedWeightKg = 0;
    let deliveredWeightKg = 0;
    let inTransitWeightKg = 0;
    let podPendingCount = 0;
    const tripIds = [];

    const detailedShipments = dispatchedShipments.map(s => {
      if (s.shipmentId) tripIds.push(s.shipmentId);
      const w = Number(s.totalWeightKg) || 0;
      despatchedWeightKg += w;

      if (s.status === "Delivered" || s.status === "Closed") {
        deliveredWeightKg += w;
      } else if (s.status === "In Transit") {
        inTransitWeightKg += w;
      }

      let invoicesList = [];
      let hasPendingPod = false;
      (s.destinations || []).forEach(d => {
        const invCount = (d.invoiceNumbers && d.invoiceNumbers.length) 
          || (d.invoiceIds && d.invoiceIds.length) 
          || 1;
        despatchedInvoices += invCount;
        if (!d.podImages || d.podImages.length === 0) {
          podPendingCount += 1;
          hasPendingPod = true;
        }

        if (d.invoiceNumbers && Array.isArray(d.invoiceNumbers)) {
          invoicesList.push(...d.invoiceNumbers);
        } else if (d.plantReferenceNumber) {
          const parts = d.plantReferenceNumber.split(',').map(p => p.trim()).filter(Boolean);
          invoicesList.push(...parts);
        }
      });

      if (invoicesList.length === 0 && s.plantReferenceNumber) {
        invoicesList = s.plantReferenceNumber.split(',').map(p => p.trim()).filter(Boolean);
      }
      if (invoicesList.length === 0 && s.shipmentId) {
        invoicesList = [s.shipmentId];
      }

      const dest = s.destinations?.[0];
      const podUploaded = !hasPendingPod && ((s.podImages && s.podImages.length > 0) || (s.destinations?.some(d => d.podImages?.length > 0)));

      return {
        id: s.shipmentId,
        shipmentId: s.shipmentId,
        vehicle: s.vehicleNumber || "Unknown",
        driver: s.driverName || "Unknown",
        destination: dest?.customerName || dest?.deliveryLocation || "Unknown",
        customer: dest?.customerName || "Unknown",
        location: dest?.deliveryLocation || "—",
        weight: Number(s.totalWeightKg) || 0,
        invoicesList,
        status: s.status,
        podStatus: podUploaded ? "Uploaded" : "Pending",
        dispatchDate: s.dispatchDate || s.createdAt,
        originalDate: s.dispatchDate || s.createdAt,
        originalData: s
      };
    });

    // Despatch Cost from Expense records:
    // Expenses with category="dispatch" within dateQuery, OR linked to tripId in tripIds
    const expenseQueryOr = [{ category: "dispatch", date: dateQuery }];
    if (tripIds.length > 0) {
      expenseQueryOr.push({ tripId: { $in: tripIds } });
    }

    const expenses = await Expense.find({ $or: expenseQueryOr }).lean();
    const expMap = new Map();
    expenses.forEach(e => expMap.set(String(e._id), e));
    const totalDespatchCost = Array.from(expMap.values()).reduce((sum, e) => sum + (Number(e.totalAmount) || 0), 0);

    const formatKg = (val) => `${(Math.round(val * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
    const formatCurrency = (val) => `₹ ${Number(val).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

    res.status(200).json({
      success: true,
      data: {
        despatchedInvoices: {
          count: despatchedInvoices
        },
        despatchedWeight: {
          weightKg: Math.round(despatchedWeightKg * 100) / 100,
          weightFormatted: formatKg(despatchedWeightKg)
        },
        deliveredWeight: {
          weightKg: Math.round(deliveredWeightKg * 100) / 100,
          weightFormatted: formatKg(deliveredWeightKg)
        },
        inTransitWeight: {
          weightKg: Math.round(inTransitWeightKg * 100) / 100,
          weightFormatted: formatKg(inTransitWeightKg)
        },
        podPending: {
          count: podPendingCount
        },
        despatchCost: {
          amount: totalDespatchCost,
          amountFormatted: formatCurrency(totalDespatchCost)
        },
        fromDate: startDate.toISOString().split("T")[0],
        toDate: endDate.toISOString().split("T")[0],
        items: detailedShipments
      }
    });
  } catch (err) {
    console.error("Get dispatch summary error:", err);
    res.status(500).json({ success: false, message: "Error fetching dispatch summary", error: err.message });
  }
};

