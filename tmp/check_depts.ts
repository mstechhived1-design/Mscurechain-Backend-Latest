import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

// Define schemas manually to avoid import issues with compiled files
const departmentSchema = new mongoose.Schema({
  name: String,
  hospital: mongoose.Schema.Types.ObjectId,
  isActive: { type: Boolean, default: true },
});

const ipdDepartmentSchema = new mongoose.Schema({
  name: String,
  hospital: mongoose.Schema.Types.ObjectId,
  isActive: { type: Boolean, default: true },
});

const Department = mongoose.model(
  "Department",
  departmentSchema,
  "departments",
);
const IPDDepartment = mongoose.model(
  "IPDDepartment",
  ipdDepartmentSchema,
  "ipddepartments",
);

async function checkDepartments() {
  try {
    await mongoose.connect(
      process.env.MONGO_URI || "mongodb://localhost:27017/mscurechain",
    );
    console.log("Connected to MongoDB");

    const hospitalId = "69a7b5bdc84f8f6e66180d35";
    const hId = new mongoose.Types.ObjectId(hospitalId);

    console.log(`\nChecking departments for Hospital ID: ${hospitalId}`);

    const labDepts = await Department.find({ hospital: hId });
    console.log(`Lab Departments count: ${labDepts.length}`);
    labDepts.slice(0, 5).forEach((d) => console.log(` - ${d.name}`));

    const ipdDepts = await IPDDepartment.find({ hospital: hId });
    console.log(`IPD Departments count: ${ipdDepts.length}`);
    ipdDepts.forEach((d) => console.log(` - ${d.name}`));

    await mongoose.disconnect();
  } catch (err) {
    console.error("Error:", err);
  }
}

checkDepartments();
