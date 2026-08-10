import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Invoice from "../models/invoice.model.js";

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
      pendingInvoicesCount = 0;
      pendingWeightKg = 0;
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

    const data = await Promise.all(days.map(async (date) => {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      const dateQuery = { $gte: start, $lte: end };

      const [dispatchedShipmentsDocs, pendingShipmentsDocs] = await Promise.all([
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
        }).lean()
      ]);

      let dispatchedInvoices = 0;
      let dispatchedWeightKg = 0;

      dispatchedShipmentsDocs.forEach((s) => {
        dispatchedWeightKg += s.totalWeightKg || 0;
        if (s.destinations && Array.isArray(s.destinations)) {
          s.destinations.forEach((d) => {
            if (d.invoiceNumbers && Array.isArray(d.invoiceNumbers)) {
              dispatchedInvoices += d.invoiceNumbers.length;
            } else if (d.invoiceIds && Array.isArray(d.invoiceIds)) {
              dispatchedInvoices += d.invoiceIds.length;
            } else {
              dispatchedInvoices += 1;
            }
          });
        } else {
          dispatchedInvoices += 1;
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

      const totalInvoices = dispatchedInvoices + pendingDispatches;

      return {
        name: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dispatchedInvoices,
        pendingDispatches,
        totalInvoices,
        dispatchedWeightKg: Math.round(dispatchedWeightKg * 100) / 100,
        dispatches: dispatchedInvoices,
        deliveries: await Shipment.countDocuments({
          status: { $in: ["Delivered", "Closed"] },
          $or: [{ deliveryDate: dateQuery }, { dispatchDate: dateQuery }, { createdAt: dateQuery }]
        })
      };
    }));

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

    const [dispatchedShipmentsDocs, pendingShipmentsDocs] = await Promise.all([
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
      }).lean()
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

    const totalInvoices = dispatchedInvoices + pendingDispatches;

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
