import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Invoice from "../models/invoice.model.js";

export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const [
      activeShipments,
      pendingPODs,
      pendingDispatch,
      cancelledInvoices,
      pendingDelivery,
      deliveriesToday
    ] = await Promise.all([
      Shipment.countDocuments({ status: "In Transit", createdAt: { $gte: sevenDaysAgo } }),
      Invoice.countDocuments({ status: "Pending", createdAt: { $gte: sevenDaysAgo } }), // Assuming Pending means POD needed or similar. Adjust if needed.
      Shipment.countDocuments({ status: "Pending", createdAt: { $gte: sevenDaysAgo } }),
      Invoice.countDocuments({
        status: "Cancelled",
        $or: [
          { cancelledAt: { $gte: sevenDaysAgo } },
          { cancelledAt: null, createdAt: { $gte: sevenDaysAgo } }
        ]
      }),
      Shipment.countDocuments({ status: "In Transit", createdAt: { $gte: sevenDaysAgo } }), // Pending Delivery is often same as In Transit or specific state
      Shipment.countDocuments({ status: { $in: ["Delivered", "Closed"] }, deliveryDate: { $gte: today } })
    ]);

    const stats = [
      { title: "Active Shipments", value: activeShipments.toString(), trendUp: true, iconName: "Truck", iconColor: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100" },
      { title: "Pending Dispatch", value: pendingDispatch.toString(), trendUp: true, iconName: "Clock", iconColor: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
      { title: "Cancelled Invoices", value: cancelledInvoices.toString(), trendUp: false, iconName: "XCircle", iconColor: "text-red-600", bg: "bg-red-50", border: "border-red-100" },
      { title: "Deliveries Today", value: deliveriesToday.toString(), trendUp: true, iconName: "CheckCircle2", iconColor: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" }
    ];

    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching dashboard stats", error: err.message });
  }
};

export const getDashboardWeeklyData = async (req, res) => {
  try {
    // Return dummy weekly data or calculate real one. For now calculate dummy to real mapping
    // We can aggregate shipments by day for the last 7 days.
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d;
    });

    const data = await Promise.all(last7Days.map(async (date) => {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      const dispatches = await Shipment.countDocuments({ dispatchDate: { $gte: start, $lte: end } });
      const deliveries = await Shipment.countDocuments({ deliveryDate: { $gte: start, $lte: end } });

      return {
        name: start.toLocaleDateString('en-US', { weekday: 'short' }),
        dispatches,
        deliveries
      };
    }));

    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching weekly data", error: err.message });
  }
};
