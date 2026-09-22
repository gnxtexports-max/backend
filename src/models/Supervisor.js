import mongoose from "mongoose";

/* ── Auto-generate Employee ID: EMP-0001 ── */
export async function generateNextSupervisorId() {
  const supervisors = await mongoose.model("Supervisor").find(
    { employeeId: { $regex: /^EMP-\d+$/i } },
    { employeeId: 1 }
  ).lean();

  let maxSeq = 0;
  for (const s of supervisors) {
    if (s.employeeId) {
      const parts = s.employeeId.split("-");
      if (parts.length === 2) {
        const seq = parseInt(parts[1], 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `EMP-${String(nextSeq).padStart(4, "0")}`;
}

const supervisorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Supervisor name is required"],
      trim: true,
    },
    employeeId: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
  },
  { timestamps: true }
);

/* Auto-generate unique Employee ID before saving if not present */
supervisorSchema.pre("save", async function () {
  if (this.isNew && !this.employeeId) {
    this.employeeId = await generateNextSupervisorId();
  }
});

// Indexes for fast searching
supervisorSchema.index({ name: "text", employeeId: "text" });
supervisorSchema.index({ status: 1 });
supervisorSchema.index({ createdAt: -1 });

export default mongoose.model("Supervisor", supervisorSchema);
