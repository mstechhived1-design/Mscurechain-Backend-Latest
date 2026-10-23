const mongoose = require("mongoose");
require("dotenv").config();
async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const Appointment = mongoose.model("Appointment", new mongoose.Schema({}, { strict: false }));
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const query = {
    doctor: new mongoose.Types.ObjectId("69a7b665c84f8f6e66180df6"),
    $or: [
      { date: { $gte: today, $lt: tomorrow } },
      {
        status: {
          $in: [
            "pending",
            "confirmed",
            "in-progress",
            "Booked",
            "waiting",
            "scheduled",
          ],
        },
      },
    ],
    status: { $ne: "cancelled" },
    isPaused: { $ne: true },
  };

  const appts = await Appointment.find(query).lean();
  console.log("Returned by query:", appts.length);
  appts.forEach(a => console.log("ID:", a._id, "Date:", a.date, "Status:", a.status, "isPaused:", a.isPaused));
  process.exit(0);
}
run();
