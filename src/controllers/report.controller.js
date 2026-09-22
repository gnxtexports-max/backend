import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";
import Expense from "../models/expense.model.js";
import Invoice from "../models/invoice.model.js";
import NodeCache from "node-cache";

const reportCache = new NodeCache({ stdTTL: 600 }); // 10 minutes cache

/**
 * GET /api/reports/stats
 * Aggregates shipment, expense, invoice, vehicle, and driver statistics.
 */
export const getShipmentStats = async (req, res) => {
  try {
    const {
      dateRange, vehicle, driver, dealer, groupBy = "day",
      startDate: customStart, endDate: customEnd,
      fromDate, toDate, dateFrom, dateTo,
      // Ledger-specific filters
      ledgerVehicle, ledgerDriver, ledgerDealer,
      lrNo, plantNo, pod, status,
      dispatchedDateFrom, dispatchedDateTo,
    } = req.query;

    const query = {};
    const invoiceQuery = {};
    const expenseQuery = {};

    let startDate = null;
    let endDate = new Date();

    const startParam = customStart || fromDate || dateFrom;
    const endParam = customEnd || toDate || dateTo;

    // ── Date Range Filter ─────────────────────────────
    if (startParam || endParam) {
      startDate = startParam ? new Date(startParam) : new Date(0);
      startDate.setHours(0, 0, 0, 0);
      endDate = endParam ? new Date(endParam) : new Date();
      endDate.setHours(23, 59, 59, 999);

      query.createdAt = { $gte: startDate, $lte: endDate };
      invoiceQuery.deliveredAt = { $gte: startDate, $lte: endDate };
      expenseQuery.date = { $gte: startDate, $lte: endDate };
    } else if (dateRange && dateRange !== "all") {
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

    // ── Fetch Shipments (Date Range Filtered for KPIs & Charts) ────────
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

    // Fetch Completed Invoices (Date Range Filtered for KPIs & Charts)
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

    // ── Fetch Historical Completed Data for Detailed Reports ─────────────
    const historicalQuery = {};
    if (startDate && endDate) {
      historicalQuery.createdAt = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      historicalQuery.createdAt = { $gte: startDate };
    }

    if (vehicle && vehicle !== "all") historicalQuery.vehicleNumber = vehicle;
    if (driver && driver !== "all") historicalQuery.driverName = driver;
    if (dealer && dealer !== "all") historicalQuery["destinations.customerName"] = dealer;

    // LR number filter
    if (lrNo && lrNo.trim()) {
      historicalQuery["destinations.lrNumber"] = { $regex: lrNo.trim(), $options: "i" };
    }
    // Plant number filter
    if (plantNo && plantNo.trim()) {
      historicalQuery["destinations.plantReferenceNumber"] = { $regex: plantNo.trim(), $options: "i" };
    }
    // Dispatched date range filter (on shipment dispatchDate)
    if (dispatchedDateFrom || dispatchedDateTo) {
      const dFrom = dispatchedDateFrom ? new Date(dispatchedDateFrom) : new Date(0);
      const dTo = dispatchedDateTo ? new Date(dispatchedDateTo) : new Date();
      dFrom.setHours(0, 0, 0, 0);
      dTo.setHours(23, 59, 59, 999);
      historicalQuery.dispatchDate = { $gte: dFrom, $lte: dTo };
    }

    // Populate destinations.invoiceIds to aggregate invoice details within LR records
    const historicalShipments = await Shipment.find(historicalQuery)
      .populate("destinations.invoiceIds")
      .lean();

    const historicalShipmentIds = historicalShipments.map((s) => s.shipmentId);

    // Fetch historical expenses associated with these shipments/filters within the date range
    const historicalExpenseOrConditions = [
      { tripId: { $in: historicalShipmentIds } }
    ];
    if (vehicle && vehicle !== "all") historicalExpenseOrConditions.push({ vehicleNo: vehicle });
    if (driver && driver !== "all") historicalExpenseOrConditions.push({ driverName: driver });

    const expenseQueryFilter = { $or: historicalExpenseOrConditions };
    if (startDate && endDate) {
      expenseQueryFilter.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      expenseQueryFilter.date = { $gte: startDate };
    }

    const historicalExpenses = await Expense.find(expenseQueryFilter).lean();

    const historicalExpenseMap = new Map();
    historicalExpenses.forEach((exp) => {
      const key = exp.tripId || exp.lrNumber;
      if (key) {
        if (!historicalExpenseMap.has(key)) {
          historicalExpenseMap.set(key, { total: 0, items: [] });
        }
        const grp = historicalExpenseMap.get(key);
        grp.total += exp.totalAmount || 0;
        grp.items.push(...(exp.items || []));
      }
    });

    // ── Process historical shipments with expense details ───────────────
    const processedHistoricalShipments = historicalShipments.map((ship) => {
      const expData = historicalExpenseMap.get(ship.shipmentId) || { total: 0, items: [] };
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

    // Shipment Expenses Auditing Report shows completed historical shipments (Delivered, Closed)
    const completedHistoricalShipments = processedHistoricalShipments.filter((s) =>
      ["Delivered", "Closed"].includes(s.status)
    );

    // ── Compute Historical Fleet Leaderboards ──────────────────
    const driverPerformanceMap = new Map();
    processedHistoricalShipments.forEach((s) => {
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

    const vehiclePerformanceMap = new Map();
    processedHistoricalShipments.forEach((s) => {
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

    // ── Completed Invoices Historical Ledger (Comprehensive LR & Invoice Records) ──
    // Effective filters for ledger: dedicated ledger filters take precedence over global filters
    const effVehicle = (ledgerVehicle && ledgerVehicle !== "all") ? ledgerVehicle : (vehicle && vehicle !== "all" ? vehicle : null);
    const effDriver = (ledgerDriver && ledgerDriver !== "all") ? ledgerDriver : (driver && driver !== "all" ? driver : null);
    const effDealer = (ledgerDealer && ledgerDealer !== "all") ? ledgerDealer : (dealer && dealer !== "all" ? dealer : null);

    // Fetch all shipments with populated invoices to build cross-references
    const allShipments = await Shipment.find().populate("destinations.invoiceIds").lean();
    const allDbInvoices = await Invoice.find().sort({ invoiceDate: -1, createdAt: -1 }).lean();

    const invoiceToShipmentMap = new Map();
    const plantToShipmentMap = new Map();
    const invoiceNumToShipmentMap = new Map();

    allShipments.forEach((s) => {
      (s.destinations || []).forEach((d) => {
        (d.invoiceIds || []).forEach((invItem) => {
          const idStr = invItem?._id ? invItem._id.toString() : (invItem ? invItem.toString() : null);
          if (idStr) {
            invoiceToShipmentMap.set(idStr, { shipment: s, destination: d, invoiceData: typeof invItem === "object" ? invItem : null });
          }
        });

        // Split comma-separated plant numbers so each plant can match individually
        if (d.plantReferenceNumber) {
          const pList = d.plantReferenceNumber.split(",").map((p) => p.trim()).filter(Boolean);
          pList.forEach((pRef) => {
            plantToShipmentMap.set(pRef, { shipment: s, destination: d });
          });
        }

        (d.invoiceNumbers || []).forEach((num) => {
          if (num) {
            invoiceNumToShipmentMap.set(num.trim(), { shipment: s, destination: d });
          }
        });
      });
    });

    // Build unified ledger records from all invoices
    const allLedgerRows = allDbInvoices.map((inv) => {
      const match = invoiceToShipmentMap.get(inv._id.toString()) ||
        plantToShipmentMap.get(inv.plantReferenceNumber) ||
        invoiceNumToShipmentMap.get(inv.invoiceNumber);

      const s = match?.shipment;
      const d = match?.destination;

      // Status mapping: AWAITING SHIPMENT, DESPATCHED, DELIVERED, CANCELLED
      let rowStatus = "AWAITING SHIPMENT";
      if (inv.status === "Cancelled" || s?.status === "Cancelled") {
        rowStatus = "CANCELLED";
      } else if (
        inv.status === "Delivered" ||
        d?.status === "Delivered" ||
        d?.status === "Closed" ||
        s?.status === "Delivered" ||
        s?.status === "Closed"
      ) {
        rowStatus = "DELIVERED";
      } else if (inv.status === "In Transit" || s?.status === "In Transit") {
        rowStatus = "DESPATCHED";
      } else {
        rowStatus = "AWAITING SHIPMENT";
      }

      // POD status: "NOT GENERATED", "PENDING", "UPLOADED"
      const hasPod = !!(d?.podImages?.length > 0 || d?.podReceiverName || d?.podRemarks || s?.podImages?.length > 0);
      let podDisplay = "NOT GENERATED";
      if (rowStatus === "DELIVERED" || rowStatus === "DESPATCHED") {
        podDisplay = hasPod ? "UPLOADED" : "PENDING";
      } else {
        podDisplay = "NOT GENERATED";
      }

      // Check plantData on destination if present
      const pData = (d?.plantData && inv.plantReferenceNumber && d.plantData[inv.plantReferenceNumber]) || null;

      const invTyre = Number(inv.tyre) || 0;
      const invTube = Number(inv.tube) || 0;
      const invFlap = Number(inv.flap) || 0;

      const pDataTyre = Number(pData?.totalTyres) || 0;
      const pDataTube = Number(pData?.totalTubes) || 0;
      const pDataFlap = Number(pData?.totalFlaps) || 0;

      const destTyre = (d?.invoiceIds?.length <= 1) ? (Number(d?.totalTyres) || 0) : 0;
      const destTube = (d?.invoiceIds?.length <= 1) ? (Number(d?.totalTubes) || 0) : 0;
      const destFlap = (d?.invoiceIds?.length <= 1) ? (Number(d?.totalFlaps) || 0) : 0;

      const tyreVal = invTyre > 0 ? invTyre : (pDataTyre > 0 ? pDataTyre : destTyre);
      const tubeVal = invTube > 0 ? invTube : (pDataTube > 0 ? pDataTube : destTube);
      const flapVal = invFlap > 0 ? invFlap : (pDataFlap > 0 ? pDataFlap : destFlap);

      const weightVal = (Number(inv.weight) || 0) > 0
        ? Number(inv.weight)
        : (pData?.weightKg ? Number(pData.weightKg) : (Number(d?.weightKg) || 0));

      return {
        _id: inv._id,
        plant: inv.plantReferenceNumber || "",
        plantReferenceNumber: inv.plantReferenceNumber || "",
        plantNumber: inv.plantReferenceNumber || "",
        invoiceNo: inv.invoiceNumber || "",
        invoiceNumber: inv.invoiceNumber || "",
        invoiceDt: inv.invoiceDate || null,
        invoiceDate: inv.invoiceDate || null,
        customer: inv.customerName || d?.customerName || "",
        customerName: inv.customerName || d?.customerName || "",
        customerLocation: inv.location || d?.deliveryLocation || "",
        location: inv.location || d?.deliveryLocation || "",
        status: rowStatus,
        shipmentStatus: s?.status || inv.status || "",
        destStatus: d?.status || "",
        tyre: tyreVal,
        tube: tubeVal,
        flap: flapVal,
        totalWeight: weightVal,
        weight: weightVal,
        quantity: (inv.quantity || 0) > 0 ? inv.quantity : (tyreVal + tubeVal + flapVal),
        lrNo: d?.lrNumber || "",
        lrNumber: d?.lrNumber || "",
        dispatchDate: s?.dispatchDate || null,
        vehicleNumber: s?.vehicleNumber || "",
        driverName: s?.driverName || "",
        deliveryDate: s?.deliveryDate || inv.deliveredAt || null,
        pod: podDisplay,
        podSubmitted: hasPod ? "Yes" : "No",
        podReceiverName: d?.podReceiverName || "",
        podRemarks: d?.podRemarks || "",
        podImages: d?.podImages || s?.podImages || [],
        shipmentId: s?.shipmentId || "",
        createdAt: inv.createdAt,
      };
    });

    // Also include any shipment destinations that may not have direct Invoice document records
    const knownInvIds = new Set(allDbInvoices.map((i) => i._id.toString()));
    const knownInvNumbers = new Set(allDbInvoices.map((i) => i.invoiceNumber).filter(Boolean));
    const knownPlants = new Set(allDbInvoices.map((i) => i.plantReferenceNumber).filter(Boolean));

    allShipments.forEach((s) => {
      (s.destinations || []).forEach((d) => {
        const pList = (d.plantReferenceNumber || "").split(",").map((p) => p.trim()).filter(Boolean);
        const hasExistingPlant = pList.some((p) => knownPlants.has(p));
        const hasExistingInvoiceNum = (d.invoiceNumbers || []).some((num) => knownInvNumbers.has(num));
        const hasExistingInvoiceId = (d.invoiceIds || []).some((id) => {
          const idStr = id?._id ? id._id.toString() : (id ? id.toString() : null);
          return idStr && knownInvIds.has(idStr);
        });

        if (!hasExistingPlant && !hasExistingInvoiceNum && !hasExistingInvoiceId && d.plantReferenceNumber) {
          const hasPod = !!(d.podImages?.length > 0 || d.podReceiverName || d.podRemarks || s.podImages?.length > 0);
          let rowStatus = "AWAITING SHIPMENT";
          if (s.status === "Cancelled") rowStatus = "CANCELLED";
          else if (s.status === "Delivered" || s.status === "Closed" || d.status === "Delivered" || d.status === "Closed") rowStatus = "DELIVERED";
          else if (s.status === "In Transit") rowStatus = "DESPATCHED";

          allLedgerRows.push({
            _id: d._id || `${s.shipmentId}-${d.plantReferenceNumber}`,
            plant: d.plantReferenceNumber,
            plantReferenceNumber: d.plantReferenceNumber,
            plantNumber: d.plantReferenceNumber,
            invoiceNo: (d.invoiceNumbers && d.invoiceNumbers[0]) || "—",
            invoiceNumber: (d.invoiceNumbers && d.invoiceNumbers[0]) || "—",
            invoiceDt: null,
            invoiceDate: null,
            customer: d.customerName || "",
            customerName: d.customerName || "",
            customerLocation: d.deliveryLocation || "",
            location: d.deliveryLocation || "",
            status: rowStatus,
            shipmentStatus: s.status,
            destStatus: d.status,
            tyre: d.totalTyres || 0,
            tube: d.totalTubes || 0,
            flap: d.totalFlaps || 0,
            totalWeight: d.weightKg || 0,
            weight: d.weightKg || 0,
            quantity: d.totalQuantity || 0,
            lrNo: d.lrNumber || "",
            lrNumber: d.lrNumber || "",
            dispatchDate: s.dispatchDate || null,
            vehicleNumber: s.vehicleNumber || "",
            driverName: s.driverName || "",
            deliveryDate: s.deliveryDate || null,
            pod: (rowStatus === "DELIVERED" || rowStatus === "DESPATCHED") ? (hasPod ? "UPLOADED" : "PENDING") : "NOT GENERATED",
            podSubmitted: hasPod ? "Yes" : "No",
            podReceiverName: d.podReceiverName || "",
            podRemarks: d.podRemarks || "",
            podImages: d.podImages || s.podImages || [],
            shipmentId: s.shipmentId || "",
            createdAt: s.createdAt,
          });
        }
      });
    });

    // ── Apply All Ledger Filters ───────────────────────────
    let filteredLedger = allLedgerRows;

    // Date range filter (custom from/to or predefined range)
    if (startDate && endDate) {
      filteredLedger = filteredLedger.filter((r) => {
        const invD = r.invoiceDate ? new Date(r.invoiceDate) : null;
        const dispD = r.dispatchDate ? new Date(r.dispatchDate) : null;
        const crtD = r.createdAt ? new Date(r.createdAt) : null;
        return (invD && invD >= startDate && invD <= endDate) ||
               (dispD && dispD >= startDate && dispD <= endDate) ||
               (crtD && crtD >= startDate && crtD <= endDate);
      });
    } else if (startDate) {
      filteredLedger = filteredLedger.filter((r) => {
        const invD = r.invoiceDate ? new Date(r.invoiceDate) : null;
        const dispD = r.dispatchDate ? new Date(r.dispatchDate) : null;
        const crtD = r.createdAt ? new Date(r.createdAt) : null;
        return (invD && invD >= startDate) ||
               (dispD && dispD >= startDate) ||
               (crtD && crtD >= startDate);
      });
    }

    // Vehicle filter (date range + vehicle)
    if (effVehicle) {
      filteredLedger = filteredLedger.filter((r) => r.vehicleNumber === effVehicle);
    }

    // Driver filter (date range + driver)
    if (effDriver) {
      filteredLedger = filteredLedger.filter((r) => r.driverName === effDriver);
    }

    // Dealer filter (date range + dealer)
    if (effDealer) {
      const dLower = effDealer.toLowerCase();
      filteredLedger = filteredLedger.filter((r) =>
        (r.customer && r.customer.toLowerCase() === dLower) ||
        (r.customerName && r.customerName.toLowerCase() === dLower)
      );
    }

    // LR No filter
    if (lrNo && lrNo.trim()) {
      const lrQuery = lrNo.trim().toLowerCase();
      filteredLedger = filteredLedger.filter((r) => (r.lrNo || "").toLowerCase().includes(lrQuery));
    }

    // Plant No filter
    if (plantNo && plantNo !== "all" && plantNo.trim()) {
      const plantQuery = plantNo.trim().toLowerCase();
      filteredLedger = filteredLedger.filter((r) => (r.plant || "").toLowerCase().includes(plantQuery));
    }

    // Status filter (AWAITING SHIPMENT, DESPATCHED, DELIVERED, CANCELLED)
    if (status && status !== "all") {
      const normStatus = status.trim().toUpperCase().replace(/_/g, " ");
      filteredLedger = filteredLedger.filter((r) => r.status === normStatus);
    }

    // POD filter (NOT GENERATED, PENDING, UPLOADED)
    if (pod && pod !== "all") {
      const normPod = pod.trim().toUpperCase().replace(/_/g, " ");
      filteredLedger = filteredLedger.filter((r) => r.pod === normPod);
    }

    // Dispatched date range filter
    if (dispatchedDateFrom || dispatchedDateTo) {
      const dFrom = dispatchedDateFrom ? new Date(dispatchedDateFrom) : new Date(0);
      const dTo = dispatchedDateTo ? new Date(dispatchedDateTo) : new Date();
      dFrom.setHours(0, 0, 0, 0);
      dTo.setHours(23, 59, 59, 999);
      filteredLedger = filteredLedger.filter((r) => {
        if (!r.dispatchDate) return false;
        const dDate = new Date(r.dispatchDate);
        return dDate >= dFrom && dDate <= dTo;
      });
    }

    // ── Status counts for ledger summary ────────────────────
    const statusCounts = {
      total: filteredLedger.length,
      awaitingShipment: filteredLedger.filter((r) => r.status === "AWAITING SHIPMENT").length,
      despatched: filteredLedger.filter((r) => r.status === "DESPATCHED").length,
      delivered: filteredLedger.filter((r) => r.status === "DELIVERED").length,
      cancelled: filteredLedger.filter((r) => r.status === "CANCELLED").length,
    };

    // Sort by Plant Reference Number
    filteredLedger.sort((a, b) =>
      String(a.plant || "").localeCompare(String(b.plant || ""), undefined, { numeric: true, sensitivity: "base" })
    );

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
        shipments: completedHistoricalShipments,
        invoices: filteredLedger,
        invoiceStatusCounts: statusCounts,
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
 * Fetches unique values for filter dropdowns across shipments and invoices.
 */
export const getFilterOptions = async (req, res) => {
  try {
    const cacheKey = "report_filter_options_v3";
    const cached = reportCache.get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached });
    }

    const [
      shipmentVehicles,
      shipmentDrivers,
      shipmentDealers,
      invoiceDealers,
      shipmentLRs,
      shipmentPlants,
      invoicePlants,
    ] = await Promise.all([
      Shipment.distinct("vehicleNumber"),
      Shipment.distinct("driverName"),
      Shipment.distinct("destinations.customerName"),
      Invoice.distinct("customerName"),
      Shipment.distinct("destinations.lrNumber"),
      Shipment.distinct("destinations.plantReferenceNumber"),
      Invoice.distinct("plantReferenceNumber"),
    ]);

    const data = {
      vehicles: shipmentVehicles.filter(Boolean).sort(),
      drivers: shipmentDrivers.filter(Boolean).sort(),
      dealers: Array.from(new Set([...shipmentDealers, ...invoiceDealers])).filter(Boolean).sort(),
      lrNumbers: shipmentLRs.filter(Boolean).sort(),
      plantNumbers: Array.from(new Set([...shipmentPlants, ...invoicePlants])).filter(Boolean).sort(),
    };

    reportCache.set(cacheKey, data);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching filters", error: err.message });
  }
};
