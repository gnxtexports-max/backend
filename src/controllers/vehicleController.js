import Vehicle from "../models/Vehicle.js";
import Shipment from "../models/shipment.model.js";
import { syncVehicleStatuses } from "../utils/syncStatuses.js";

// Get all vehicles
export const getAllVehicles = async (req, res) => {
  try {
    await syncVehicleStatuses();
    const vehicles = await Vehicle.find().sort({ createdAt: -1 });
    res.status(200).json(vehicles);
  } catch (error) {
    res.status(500).json({ message: "Error fetching vehicles", error: error.message });
  }
};

// Get single vehicle by ID
export const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }
    res.status(200).json(vehicle);
  } catch (error) {
    res.status(500).json({ message: "Error fetching vehicle", error: error.message });
  }
};

// Create new vehicle
export const createVehicle = async (req, res) => {
  try {
    const { vehicleNo, type, model, capacityKg, insuranceExpiry, ownership, gpsImei } = req.body;

    // Validation (only vehicleNo and ownership are required)
    if (!vehicleNo || !ownership) {
      return res.status(400).json({ message: "Vehicle Number and Ownership are required" });
    }

    // Check if vehicle number already exists
    const existingVehicle = await Vehicle.findOne({ vehicleNo });
    if (existingVehicle) {
      return res.status(409).json({ message: "Vehicle number already exists" });
    }

    // Find latest vehicle
    const lastVehicle = await Vehicle.findOne().sort({ createdAt: -1 });

    let nextNumber = 1;

    if (lastVehicle && lastVehicle.vehicleId) {
      const lastNumber = parseInt(
        lastVehicle.vehicleId.split("-")[1]
      );

      nextNumber = lastNumber + 1;
    }

    // Generate VEH-001
    const vehicleId = `VEH-${String(nextNumber).padStart(3, "0")}`;

    console.log(`${vehicleId} vechicle id `);

    // Create new vehicle with default values
    const newVehicle = new Vehicle({
      vehicleId,
      vehicleNo,
      type: type || "",
      model: model || "",
      capacityKg: capacityKg ? Number(capacityKg) : undefined,
      insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : undefined,
      ownership,
      gpsImei: gpsImei || "",
      status: "Idle",
      availability: "Available",
    });

    const savedVehicle = await newVehicle.save();
    if (req.io) req.io.emit("vehicles:changed");
    res.status(201).json(savedVehicle);
  } catch (error) {
    res.status(500).json({ message: "Error creating vehicle", error: error.message });
  }
};

// Update vehicle (full update)
export const updateVehicle = async (req, res) => {
  try {
    const { vehicleNo, type, model, capacityKg, insuranceExpiry, ownership, status, availability, gpsImei } = req.body;

    // Find vehicle
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    // Check if new vehicle number already exists (if being changed)
    if (vehicleNo && vehicleNo !== vehicle.vehicleNo) {
      const existingVehicle = await Vehicle.findOne({ vehicleNo });
      if (existingVehicle) {
        return res.status(409).json({ message: "Vehicle number already exists" });
      }
    }

    // Update fields
    if (vehicleNo) vehicle.vehicleNo = vehicleNo;
    if (type !== undefined) vehicle.type = type || "";
    if (model !== undefined) vehicle.model = model || "";
    if (capacityKg !== undefined) {
      vehicle.capacityKg = capacityKg ? Number(capacityKg) : undefined;
    }
    if (insuranceExpiry !== undefined) {
      vehicle.insuranceExpiry = insuranceExpiry ? new Date(insuranceExpiry) : undefined;
    }
    if (ownership) vehicle.ownership = ownership;
    if (status) {
      vehicle.status = status;

      // ✅ ADD THIS - Auto-set availability based on status
      if (status === "Maintenance" || status === "Breakdown") {
        vehicle.availability = "Unavailable";
      } else if (status === "Idle") {
        // Check if there is an active shipment for this vehicle
        const activeShipment = await Shipment.findOne({
          vehicleId: vehicle._id,
          $or: [
            { status: { $in: ["Pending", "In Transit", "Delivered"] } },
            { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
          ]
        }).sort({ updatedAt: -1 });

        if (activeShipment) {
          if (activeShipment.status === "In Transit" || activeShipment.status === "Delivered" || activeShipment.status === "Closed") {
            vehicle.status = "In Transit";
            vehicle.availability = "On Trip";
          } else {
            vehicle.status = "Assigned";
            vehicle.availability = "Scheduled";
          }
        } else {
          vehicle.availability = "Available";
        }
      }
    }
    if (availability && !status) vehicle.availability = availability; // Allow manual override if no status change
    if (gpsImei !== undefined) vehicle.gpsImei = gpsImei || "";

    const updatedVehicle = await vehicle.save();
    if (req.io) req.io.emit("vehicles:changed");
    res.status(200).json(updatedVehicle);
  } catch (error) {
    res.status(500).json({ message: "Error updating vehicle", error: error.message });
  }
};

// Update vehicle status only (for maintenance toggle)
// export const updateVehicleStatus = async (req, res) => {
//   try {
//     const { status } = req.body;

//     if (!status) {
//       return res.status(400).json({ message: "Status is required" });
//     }

//     const vehicle = await Vehicle.findById(req.params.id);
//     if (!vehicle) {
//       return res.status(404).json({ message: "Vehicle not found" });
//     }

//     vehicle.status = status;
//     const updatedVehicle = await vehicle.save();
//     res.status(200).json(updatedVehicle);
//   } catch (error) {
//     res.status(500).json({ message: "Error updating vehicle status", error: error.message });
//   }
// };

export const updateVehicleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: "Status is required" });
    }

    const updateData = { status };

    if (status === "Maintenance" || status === "Breakdown") {
      updateData.availability = "Unavailable";
    } else if (status === "Idle") {
      // Check if there is an active shipment for this vehicle
      const activeShipment = await Shipment.findOne({
        vehicleId: id,
        $or: [
          { status: { $in: ["Pending", "In Transit", "Delivered"] } },
          { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
        ]
      }).sort({ updatedAt: -1 });

      if (activeShipment) {
        if (activeShipment.status === "In Transit" || activeShipment.status === "Delivered" || activeShipment.status === "Closed") {
          updateData.status = "In Transit";
          updateData.availability = "On Trip";
        } else {
          updateData.status = "Assigned";
          updateData.availability = "Scheduled";
        }
      } else {
        updateData.availability = "Available";
      }
    }

    const vehicle = await Vehicle.findByIdAndUpdate(
      id,
      updateData,
      { returnDocument: "after" }
    );

    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    if (req.io) req.io.emit("vehicles:changed");
    res.status(200).json(vehicle);
  } catch (error) {
    res.status(500).json({ message: "Error updating vehicle status", error: error.message });
  }
};


// Delete vehicle
export const deleteVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }
    if (req.io) req.io.emit("vehicles:changed");
    res.status(200).json({ message: "Vehicle deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting vehicle", error: error.message });
  }
};

// Get fleet statistics
export const getFleetStats = async (req, res) => {
  try {
    const totalVehicles = await Vehicle.countDocuments();
    const activeVehicles = await Vehicle.countDocuments({
      status: { $in: ["Active", "In Transit"] }
    });
    const idleVehicles = await Vehicle.countDocuments({ status: "Idle" });
    const maintenanceVehicles = await Vehicle.countDocuments({
      status: { $in: ["Maintenance", "Breakdown"] }
    });

    res.status(200).json({
      total: totalVehicles,
      active: activeVehicles,
      idle: idleVehicles,
      maintenance: maintenanceVehicles,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching stats", error: error.message });
  }
};

// Search vehicles
export const searchVehicles = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const vehicles = await Vehicle.find({
      $or: [
        { vehicleNo: { $regex: q, $options: "i" } },
        { model: { $regex: q, $options: "i" } },
        { type: { $regex: q, $options: "i" } },
      ],
    });

    res.status(200).json(vehicles);
  } catch (error) {
    res.status(500).json({ message: "Error searching vehicles", error: error.message });
  }
};

// Filter vehicles
export const filterVehicles = async (req, res) => {
  try {
    const { type, status, availability } = req.query;

    const filter = {};

    if (type && type !== "all") filter.type = type;
    if (status && status !== "all") filter.status = status;
    if (availability && availability !== "all") filter.availability = availability;

    const vehicles = await Vehicle.find(filter).sort({ createdAt: -1 });
    res.status(200).json(vehicles);
  } catch (error) {
    res.status(500).json({ message: "Error filtering vehicles", error: error.message });
  }
};
