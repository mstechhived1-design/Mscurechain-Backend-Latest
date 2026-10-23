import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
import PatientProfile from "./Patient/Models/PatientProfile.js";
import { getIPDFinalBill } from "./Report/Controllers/ipdFinalBillController.js";

async function run() {
  await mongoose.connect("mongodb+srv://curechain:NEXG4w5rYhE08iZ8@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain");
  const profile = await PatientProfile.findOne({ mrn: "DHO528000014" });
  console.log("Patient ID:", profile?.user);
  
  // mock request
  const req = { params: { patientId: profile?.user?.toString() }, hospitalId: profile?.hospital?.toString() };
  const res = { 
    json: (data: any) => console.log(JSON.stringify(data, null, 2)), 
    status: (code: any) => ({ json: (d: any) => console.log("Status", code, d) })
  };
  
  await getIPDFinalBill(req as any, res as any);
  
  mongoose.disconnect();
}
run();
