import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";
import Shipment from "../models/shipment.model.js";

/**
 * Sync all vehicle statuses against actual active shipments.
 * Active = status in ["Pending", "In Transit", "Delivered"]
 * No active shipment → status "Idle", availability "Available"
 */
export async function syncVehicleStatuses() {
  const activeShipments = await Shipment.find({
    $or: [
      { status: { $in: ["Pending", "In Transit", "Delivered"] } },
      { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
    ]
  }).select("vehicleId vehicleNumber status").lean();

  const activeByVehicleId = {};
  const activeByVehicleNo = {};
  for (const s of activeShipments) {
    const vId = s.vehicleId?._id?.toString() || s.vehicleId?.toString();
    if (vId) activeByVehicleId[vId] = s;
    if (s.vehicleNumber) activeByVehicleNo[s.vehicleNumber] = s;
  }

  const vehicles = await Vehicle.find().lean();
  const bulkOps = [];

  for (const v of vehicles) {
    if (v.status === "Maintenance" || v.status === "Breakdown") {
      continue;
    }
    const active = activeByVehicleId[v._id.toString()] || activeByVehicleNo[v.vehicleNo];
    let correctStatus = "Idle";
    let correctAvailability = "Available";

    if (active) {
      if (active.status === "In Transit" || active.status === "Delivered" || active.status === "Closed") {
        correctStatus = "In Transit";
        correctAvailability = "On Trip";
      } else if (active.status === "Pending") {
        correctStatus = "Assigned";
        correctAvailability = "Scheduled";
      }
    }

    if (v.status !== correctStatus || v.availability !== correctAvailability) {
      bulkOps.push({
        updateOne: {
          filter: { _id: v._id },
          update: { $set: { status: correctStatus, availability: correctAvailability } },
        },
      });
    }
  }

  if (bulkOps.length) {
    await Vehicle.bulkWrite(bulkOps);
  }

  return { corrected: bulkOps.length, total: vehicles.length };
}

/**
 * Sync all driver tripStatuses against actual active shipments.
 * Active = status in ["Pending", "In Transit", "Delivered"]
 * No active shipment → tripStatus "Idle", assignedVehicle null
 */
export async function syncDriverStatuses() {
  const activeShipments = await Shipment.find({
    $or: [
      { status: { $in: ["Pending", "In Transit", "Delivered"] } },
      { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
    ]
  }).select("driverId vehicleNumber status").lean();

  const activeByDriverId = {};
  for (const s of activeShipments) {
    const dId = s.driverId?._id?.toString() || s.driverId?.toString();
    if (dId) activeByDriverId[dId] = s;
  }

  const drivers = await Driver.find().lean();
  const bulkOps = [];

  for (const d of drivers) {
    const active = activeByDriverId[d._id.toString()];
    let correctStatus = "Idle";
    let correctVehicle = null;

    if (active) {
      if (active.status === "In Transit" || active.status === "Delivered" || active.status === "Closed") {
        correctStatus = "Driving";
        correctVehicle = active.vehicleNumber;
      } else if (active.status === "Pending") {
        correctStatus = "Assigned";
        correctVehicle = active.vehicleNumber;
      }
    }

    if (d.tripStatus !== correctStatus || d.assignedVehicle !== correctVehicle) {
      bulkOps.push({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { tripStatus: correctStatus, assignedVehicle: correctVehicle } },
        },
      });
    }
  }

  if (bulkOps.length) {
    await Driver.bulkWrite(bulkOps);
  }

  return { corrected: bulkOps.length, total: drivers.length };
}

/**
 * Sync a single vehicle's status against its active shipments.
 */
export async function syncSingleVehicle(vehicleId) {
  const vehicle = await Vehicle.findById(vehicleId).lean();
  if (vehicle && (vehicle.status === "Maintenance" || vehicle.status === "Breakdown")) {
    return { status: vehicle.status, availability: vehicle.availability };
  }

  const active = await Shipment.findOne({
    vehicleId,
    $or: [
      { status: { $in: ["Pending", "In Transit", "Delivered"] } },
      { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
    ]
  }).sort({ updatedAt: -1 }).lean();

  let correctStatus = "Idle";
  let correctAvailability = "Available";

  if (active) {
    if (active.status === "In Transit" || active.status === "Delivered" || active.status === "Closed") {
      correctStatus = "In Transit";
      correctAvailability = "On Trip";
    } else if (active.status === "Pending") {
      correctStatus = "Assigned";
      correctAvailability = "Scheduled";
    }
  }

  await Vehicle.findByIdAndUpdate(vehicleId, {
    status: correctStatus,
    availability: correctAvailability,
  });

  return { status: correctStatus, availability: correctAvailability };
}

/**
 * Sync a single driver's status against their active shipments.
 */
export async function syncSingleDriver(driverId) {
  const active = await Shipment.findOne({
    driverId,
    $or: [
      { status: { $in: ["Pending", "In Transit", "Delivered"] } },
      { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
    ]
  }).sort({ updatedAt: -1 }).lean();

  let correctStatus = "Idle";
  let correctVehicle = null;

  if (active) {
    if (active.status === "In Transit" || active.status === "Delivered" || active.status === "Closed") {
      correctStatus = "Driving";
      correctVehicle = active.vehicleNumber;
    } else if (active.status === "Pending") {
      correctStatus = "Assigned";
      correctVehicle = active.vehicleNumber;
    }
  }

  await Driver.findByIdAndUpdate(driverId, {
    tripStatus: correctStatus,
    assignedVehicle: correctVehicle,
  });

  return { tripStatus: correctStatus, assignedVehicle: correctVehicle };
}
