import Driver from "../models/Driver.js";
import Shipment from "../models/shipment.model.js";
import { syncDriverStatuses } from "../utils/syncStatuses.js";

// GET all drivers
export const getDrivers = async (req, res) => {
  try {
    await syncDriverStatuses();
    const drivers = await Driver.find()
      .select("name phone age licenseNumber driverType tripStatus assignedVehicle status performance rating documents")
      .sort({ createdAt: -1 })
      .lean();
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching drivers", error: error.message });
  }
};

// GET driver by ID
export const getDriverById = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json(driver);
  } catch (error) {
    res.status(500).json({ message: "Error fetching driver", error: error.message });
  }
};

// CREATE new driver
export const createDriver = async (req, res) => {
  try {
    const { name, age, phone, licenseNumber, driverType, tripStatus } = req.body;

    if (!name || !driverType) {
      return res.status(400).json({ message: "Driver name and driver type are required" });
    }

    const trimmedPhone = phone && phone.trim() ? phone.trim() : undefined;
    const trimmedLicense = licenseNumber && licenseNumber.trim() ? licenseNumber.trim() : undefined;
    const numericAge = age !== "" && age !== null && age !== undefined ? Number(age) : undefined;

    // Check if phone already exists
    if (trimmedPhone) {
      const existingPhone = await Driver.findOne({ phone: trimmedPhone });
      if (existingPhone) {
        return res.status(400).json({ message: "Phone number already registered" });
      }
    }

    // Check if license already exists
    if (trimmedLicense) {
      const existingLicense = await Driver.findOne({ licenseNumber: trimmedLicense });
      if (existingLicense) {
        return res.status(400).json({ message: "License number already registered" });
      }
    }

    const driverPayload = {
      name: name.trim(),
      driverType,
      tripStatus: tripStatus || "Idle",
    };
    if (numericAge !== undefined && !isNaN(numericAge)) driverPayload.age = numericAge;
    if (trimmedPhone) driverPayload.phone = trimmedPhone;
    if (trimmedLicense) driverPayload.licenseNumber = trimmedLicense;

    const newDriver = new Driver(driverPayload);

    await newDriver.save();
    if (req.io) req.io.emit("drivers:changed");
    res.status(201).json(newDriver);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "Field";
      return res.status(400).json({ message: `${field} already exists` });
    }
    res.status(500).json({ message: "Error creating driver", error: error.message });
  }
};

// UPDATE driver
export const updateDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, age, phone, licenseNumber, driverType, tripStatus, assignedVehicle } = req.body;

    const trimmedPhone = phone && phone.trim() ? phone.trim() : undefined;
    const trimmedLicense = licenseNumber && licenseNumber.trim() ? licenseNumber.trim() : undefined;
    const numericAge = age !== "" && age !== null && age !== undefined ? Number(age) : undefined;

    // Check if phone already exists for another driver
    if (trimmedPhone) {
      const existingPhone = await Driver.findOne({
        phone: trimmedPhone,
        _id: { $ne: id },
      });
      if (existingPhone) {
        return res.status(400).json({ message: "Phone number already in use" });
      }
    }

    // Check if license already exists for another driver
    if (trimmedLicense) {
      const existingLicense = await Driver.findOne({
        licenseNumber: trimmedLicense,
        _id: { $ne: id },
      });
      if (existingLicense) {
        return res.status(400).json({ message: "License number already in use" });
      }
    }

    const updateDoc = {
      $set: {
        name: name ? name.trim() : undefined,
        driverType,
        tripStatus,
        assignedVehicle: assignedVehicle || null,
      },
      $unset: {},
    };

    if (numericAge !== undefined && !isNaN(numericAge)) {
      updateDoc.$set.age = numericAge;
    } else {
      updateDoc.$unset.age = 1;
    }

    if (trimmedPhone) {
      updateDoc.$set.phone = trimmedPhone;
    } else {
      updateDoc.$unset.phone = 1;
    }

    if (trimmedLicense) {
      updateDoc.$set.licenseNumber = trimmedLicense;
    } else {
      updateDoc.$unset.licenseNumber = 1;
    }

    if (Object.keys(updateDoc.$unset).length === 0) {
      delete updateDoc.$unset;
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      id,
      updateDoc,
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (req.io) req.io.emit("drivers:changed");
    res.json(updatedDriver);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "Field";
      return res.status(400).json({ message: `${field} already exists` });
    }
    res.status(500).json({ message: "Error updating driver", error: error.message });
  }
};

// DELETE driver
export const deleteDriver = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedDriver = await Driver.findByIdAndDelete(id);

    if (!deletedDriver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    if (req.io) req.io.emit("drivers:changed");
    res.json({ message: "Driver deleted successfully", driver: deletedDriver });
  } catch (error) {
    res.status(500).json({ message: "Error deleting driver", error: error.message });
  }
};

// GET drivers by type
export const getDriversByType = async (req, res) => {
  try {
    const { type } = req.params;

    const drivers = await Driver.find({ driverType: type }).sort({ createdAt: -1 }).lean();

    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching drivers", error: error.message });
  }
};

// GET drivers by status
export const getDriversByStatus = async (req, res) => {
  try {
    const { status } = req.params;

    const drivers = await Driver.find({ tripStatus: status }).sort({ createdAt: -1 }).lean();

    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching drivers", error: error.message });
  }
};

// SEARCH drivers
export const searchDrivers = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const drivers = await Driver.find({
      $or: [
        { name: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { licenseNumber: { $regex: q, $options: "i" } },
      ],
    }).sort({ createdAt: -1 }).lean();

    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: "Error searching drivers", error: error.message });
  }
};

// UPDATE driver performance
export const updateDriverPerformance = async (req, res) => {
  try {
    const { id } = req.params;
    const { totalTrips, completedTrips, rating } = req.body;

    const updatedDriver = await Driver.findByIdAndUpdate(
      id,
      {
        "performance.totalTrips": totalTrips,
        "performance.completedTrips": completedTrips,
        "performance.rating": rating,
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json(updatedDriver);
  } catch (error) {
    res.status(500).json({ message: "Error updating performance", error: error.message });
  }
};

// UPDATE driver documents
export const updateDriverDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const { licenseExpiry, insuranceExpiry, medicalExamExpiry } = req.body;

    const updatedDriver = await Driver.findByIdAndUpdate(
      id,
      {
        documents: {
          licenseExpiry,
          insuranceExpiry,
          medicalExamExpiry,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json(updatedDriver);
  } catch (error) {
    res.status(500).json({ message: "Error updating documents", error: error.message });
  }
};