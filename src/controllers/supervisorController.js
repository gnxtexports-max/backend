import Supervisor, { generateNextSupervisorId } from "../models/Supervisor.js";

// GET all supervisors
export const getSupervisors = async (req, res) => {
  try {
    const { search, status } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }

    if (search) {
      const regex = new RegExp(search.trim(), "i");
      filter.$or = [
        { name: regex },
        { employeeId: regex },
        { phone: regex },
      ];
    }

    const supervisors = await Supervisor.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json(supervisors);
  } catch (error) {
    res.status(500).json({ message: "Error fetching supervisors", error: error.message });
  }
};

// GET next employee ID preview
export const getNextSupervisorId = async (req, res) => {
  try {
    const nextId = await generateNextSupervisorId();
    res.json({ success: true, nextEmployeeId: nextId });
  } catch (error) {
    res.status(500).json({ message: "Error generating supervisor ID", error: error.message });
  }
};

// GET supervisor by ID
export const getSupervisorById = async (req, res) => {
  try {
    const supervisor = await Supervisor.findById(req.params.id).lean();
    if (!supervisor) {
      return res.status(404).json({ message: "Supervisor not found" });
    }
    res.json(supervisor);
  } catch (error) {
    res.status(500).json({ message: "Error fetching supervisor", error: error.message });
  }
};

// CREATE new supervisor
export const createSupervisor = async (req, res) => {
  try {
    const { name, phone, email, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Supervisor name is required" });
    }

    const trimmedPhone = phone && String(phone).trim() ? String(phone).trim() : undefined;
    if (trimmedPhone) {
      const existingPhone = await Supervisor.findOne({ phone: trimmedPhone });
      if (existingPhone) {
        return res.status(400).json({ message: "A supervisor with this phone number already exists" });
      }
    }

    const autoEmployeeId = await generateNextSupervisorId();

    const newSupervisor = new Supervisor({
      name: name.trim(),
      employeeId: autoEmployeeId,
      phone: trimmedPhone,
      email: email ? String(email).trim() : undefined,
      status: status || "Active",
    });

    await newSupervisor.save();

    if (req.io) {
      req.io.emit("supervisors:changed");
    }

    res.status(201).json(newSupervisor);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Employee ID or unique field already exists" });
    }
    res.status(500).json({ message: "Error creating supervisor", error: error.message });
  }
};

// UPDATE supervisor
export const updateSupervisor = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, status } = req.body;

    const supervisor = await Supervisor.findById(id);
    if (!supervisor) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    const trimmedPhone = phone !== undefined && String(phone).trim() !== "" ? String(phone).trim() : undefined;
    if (trimmedPhone) {
      const existingPhone = await Supervisor.findOne({
        phone: trimmedPhone,
        _id: { $ne: id },
      });
      if (existingPhone) {
        return res.status(400).json({ message: "A supervisor with this phone number already exists" });
      }
    }

    if (name) supervisor.name = name.trim();
    if (phone !== undefined) supervisor.phone = trimmedPhone || "";
    if (email !== undefined) supervisor.email = email ? String(email).trim() : "";
    if (status) supervisor.status = status;

    await supervisor.save();

    if (req.io) {
      req.io.emit("supervisors:changed");
    }

    res.json(supervisor);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Employee ID or unique field already exists" });
    }
    res.status(500).json({ message: "Error updating supervisor", error: error.message });
  }
};

// DELETE supervisor
export const deleteSupervisor = async (req, res) => {
  try {
    const { id } = req.params;
    const supervisor = await Supervisor.findByIdAndDelete(id);

    if (!supervisor) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    if (req.io) {
      req.io.emit("supervisors:changed");
    }

    res.json({ message: "Supervisor deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting supervisor", error: error.message });
  }
};
