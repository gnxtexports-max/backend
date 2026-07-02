import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";
import Expense from "../models/expense.model.js";
import Invoice from "../models/invoice.model.js";

/**
 * GET /api/reports/stats
 * Aggregates shipment, expense, invoice, vehicle, and driver statistics.
 */
export const getShipmentStats = async (req, res) => {
  try {
    const { dateRange, vehicle, driver, dealer, groupBy = "day", startDate: customStart, endDate: customEnd } = req.query;

    const query = {};
    const invoiceQuery = {};
    const expenseQuery = {};

    let startDate = null;
    let endDate = new Date();

    // ── Date Range Filter ─────────────────────────────
    if (dateRange && dateRange !== "all") {
      const now = new Date();
      startDate = new Date();

      if (dateRange === "today") {
        startDate.setHours(0, 0, 0, 0);
      } else if (dateRange === "7d") {
        startDate.setDate(now.getDate() - 7);
      } else if (dateRange === "30d") {
        startDate.setDate(now.getDate() - 30);
      } else if (dateRange === "90d") {
        startDate.setDate(now.getDate() - 90);
      }

      query.$or = [
        { dispatchDate: { $gte: startDate } },
        { status: "Pending", createdAt: { $gte: startDate } }
      ];
      invoiceQuery.deliveredAt = { $gte: startDate };
      expenseQuery.date = { $gte: startDate };
    } else if (dateRange === "all") {
      // Do not restrict date
    } else if (customStart) {
      startDate = new Date(customStart);
      startDate.setHours(0, 0, 0, 0);
      endDate = customEnd ? new Date(customEnd) : new Date();
      endDate.setHours(23, 59, 59, 999);

      query.createdAt = { $gte: startDate, $lte: endDate };
      invoiceQuery.deliveredAt = { $gte: startDate, $lte: endDate };
      expenseQuery.date = { $gte: startDate, $lte: endDate };
    }

    // ── Vehicle Filter ────────────────────────────────
    if (vehicle && vehicle !== "all") {
      query.vehicleNumber = vehicle;
      expenseQuery.vehicleNo = vehicle;
    }

    // ── Driver Filter ─────────────────────────────────
    if (driver && driver !== "all") {
      query.driverName = driver;
      expenseQuery.driverName = driver;
    }

    // ── Dealer (Customer) Filter ──────────────────────
    if (dealer && dealer !== "all") {
      query["destinations.customerName"] = dealer;
    }

    // ── Fetch Shipments ───────────────────────────────
    const shipments = await Shipment.find(query).lean();
    const shipmentIds = shipments.map((s) => s.shipmentId);

    // Fetch matching Expenses linked to these shipments or matching basic filters
    const expenseOrConditions = [
      { tripId: { $in: shipmentIds } }
    ];
    if (vehicle && vehicle !== "all") expenseOrConditions.push({ vehicleNo: vehicle });
    if (driver && driver !== "all") expenseOrConditions.push({ driverName: driver });

    const expenses = await Expense.find({
      $or: expenseOrConditions
    }).lean();

    // Fetch Completed Invoices
    if (dealer && dealer !== "all") {
      invoiceQuery.customerName = dealer;
    }
    const completedInvoices = await Invoice.find({ ...invoiceQuery, status: "Delivered" }).lean();

    // ── Group Expenses by tripId/lrNumber ──────────────
    const expenseMap = new Map();
    expenses.forEach((exp) => {
      const key = exp.tripId || exp.lrNumber;
      if (key) {
        if (!expenseMap.has(key)) {
          expenseMap.set(key, { total: 0, items: [] });
        }
        const grp = expenseMap.get(key);
        grp.total += exp.totalAmount || 0;
        grp.items.push(...(exp.items || []));
      }
    });

    // ── Compute Shipment details with expenses ──────────
    const processedShipments = shipments.map((ship) => {
      const expData = expenseMap.get(ship.shipmentId) || { total: 0, items: [] };
      const breakdown = {};
      expData.items.forEach((item) => {
        breakdown[item.expenseType] = (breakdown[item.expenseType] || 0) + (item.amount || 0);
      });

      return {
        _id: ship._id,
        shipmentId: ship.shipmentId,
        createdAt: ship.createdAt,
        dispatchDate: ship.dispatchDate,
        deliveryDate: ship.deliveryDate,
        vehicleNumber: ship.vehicleNumber,
        driverName: ship.driverName,
        totalWeightKg: ship.totalWeightKg,
        totalQuantity: ship.totalQuantity,
        status: ship.status,
        totalExpenses: expData.total,
        expenseBreakdown: breakdown,
      };
    });

    // ── Compute Summary Stats ──────────────────────────
    const totalShipments = processedShipments.length;
    const activeShipments = processedShipments.filter((s) => ["Pending", "In Transit"].includes(s.status)).length;
    const completedShipmentsCount = processedShipments.filter((s) => ["Delivered", "Closed"].includes(s.status)).length;
    const totalExpensesSum = expenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0);
    const completedInvoicesCount = completedInvoices.length;

    // ── Fleet Performance: Drivers Leaderboard ──────────
    const driverPerformanceMap = new Map();
    processedShipments.forEach((s) => {
      const name = s.driverName || "Unknown Driver";
      if (!driverPerformanceMap.has(name)) {
        driverPerformanceMap.set(name, {
          driverName: name,
          totalTrips: 0,
          completedTrips: 0,
          totalExpenses: 0,
          totalWeightKg: 0,
        });
      }
      const perf = driverPerformanceMap.get(name);
      perf.totalTrips += 1;
      if (["Delivered", "Closed"].includes(s.status)) {
        perf.completedTrips += 1;
      }
      perf.totalWeightKg += s.totalWeightKg || 0;
      perf.totalExpenses += s.totalExpenses || 0;
    });

    // ── Fleet Performance: Vehicles Leaderboard ─────────
    const vehiclePerformanceMap = new Map();
    processedShipments.forEach((s) => {
      const num = s.vehicleNumber || "Unknown Vehicle";
      if (!vehiclePerformanceMap.has(num)) {
        vehiclePerformanceMap.set(num, {
          vehicleNumber: num,
          totalTrips: 0,
          completedTrips: 0,
          totalExpenses: 0,
          totalWeightKg: 0,
        });
      }
      const perf = vehiclePerformanceMap.get(num);
      perf.totalTrips += 1;
      if (["Delivered", "Closed"].includes(s.status)) {
        perf.completedTrips += 1;
      }
      perf.totalWeightKg += s.totalWeightKg || 0;
      perf.totalExpenses += s.totalExpenses || 0;
    });

    // ── Build Timeline Aggregation Trend ──────────────
    let rangeStart = startDate;
    if (!rangeStart) {
      // Find oldest shipment or default to 30 days ago
      const oldestShip = await Shipment.findOne({}, {}, { sort: { createdAt: 1 } }).lean();
      rangeStart = oldestShip ? new Date(oldestShip.createdAt) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    const safeRangeStart = new Date(rangeStart);
    safeRangeStart.setHours(0, 0, 0, 0);

    const timelineBins = [];
    const stepDate = new Date(safeRangeStart);

    while (stepDate <= endDate) {
      let binStart = new Date(stepDate);
      binStart.setHours(0, 0, 0, 0);
      let binEnd = new Date(stepDate);

      let dateLabel = "";

      if (groupBy === "day") {
        binEnd.setHours(23, 59, 59, 999);
        dateLabel = binStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        stepDate.setDate(stepDate.getDate() + 1);
      } else if (groupBy === "week") {
        binEnd.setDate(binEnd.getDate() + 6);
        binEnd.setHours(23, 59, 59, 999);
        const wEnd = new Date(binEnd);
        dateLabel = `${binStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} - ${wEnd.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
        stepDate.setDate(stepDate.getDate() + 7);
      } else {
        // month
        binEnd.setMonth(binEnd.getMonth() + 1);
        binEnd.setDate(0);
        binEnd.setHours(23, 59, 59, 999);
        dateLabel = binStart.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
        stepDate.setMonth(stepDate.getMonth() + 1);
        stepDate.setDate(1);
      }

      const shipmentsInBin = processedShipments.filter(
        (s) => new Date(s.createdAt) >= binStart && new Date(s.createdAt) <= binEnd
      );
      const shipmentsCompletedInBin = processedShipments.filter(
        (s) => s.deliveryDate && new Date(s.deliveryDate) >= binStart && new Date(s.deliveryDate) <= binEnd
      );
      const invoicesCompletedInBin = completedInvoices.filter(
        (i) => i.deliveredAt && new Date(i.deliveredAt) >= binStart && new Date(i.deliveredAt) <= binEnd
      );
      const expensesInBin = expenses.filter(
        (e) => new Date(e.date) >= binStart && new Date(e.date) <= binEnd
      );

      const expensesSum = expensesInBin.reduce((sum, e) => sum + (e.totalAmount || 0), 0);

      timelineBins.push({
        dateLabel,
        shipmentsCount: shipmentsInBin.length,
        completedCount: shipmentsCompletedInBin.length,
        completedInvoices: invoicesCompletedInBin.length,
        totalExpenses: expensesSum,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        stats: {
          totalShipments,
          activeShipments,
          completedShipments: completedShipmentsCount,
          totalExpenses: totalExpensesSum,
          completedInvoices: completedInvoicesCount,
        },
        shipments: processedShipments,
        invoices: completedInvoices,
        fleet: {
          drivers: Array.from(driverPerformanceMap.values()).sort((a, b) => b.completedTrips - a.completedTrips),
          vehicles: Array.from(vehiclePerformanceMap.values()).sort((a, b) => b.completedTrips - a.completedTrips),
        },
        timeline: timelineBins,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching stats", error: err.message });
  }
};

/**
 * GET /api/reports/filters
 * Fetches unique values for filter dropdowns.
 */
export const getFilterOptions = async (req, res) => {
  try {
    const [vehicles, drivers, dealers] = await Promise.all([
      Shipment.distinct("vehicleNumber"),
      Shipment.distinct("driverName"),
      Shipment.distinct("destinations.customerName"),
    ]);

    res.status(200).json({
      success: true,
      data: {
        vehicles: vehicles.sort(),
        drivers: drivers.sort(),
        dealers: dealers.sort(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching filters", error: err.message });
  }
};
