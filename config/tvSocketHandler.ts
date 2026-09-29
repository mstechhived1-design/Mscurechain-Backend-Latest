import { Server, Socket } from "socket.io";
import crypto from "crypto";
import DisplayDevice from "../Admin/Models/DisplayDevice.js";
import logger from "../utils/logger.js";

// Keep track of active TVs: pair_code -> socket.id
const activeUnpairedTVs = new Map<string, string>();

export const registerTVSocketHandlers = (io: Server) => {
  const tvNamespace = io.of("/tv-display");

  tvNamespace.on("connection", (socket: Socket) => {
    logger.info(`[TV Socket] New connection: ${socket.id}`);

    // 1. TV requests a pair code (Unpaired TV)
    socket.on("request_pair_code", async () => {
      // Generate a 4-character alphanumeric code
      const pairCode = crypto.randomBytes(2).toString("hex").toUpperCase();
      
      // Join a room for this specific pair code so we can emit to it when admin pairs
      socket.join(`tv_${pairCode}`);
      activeUnpairedTVs.set(pairCode, socket.id);
      
      socket.emit("pair_code_generated", { pairCode });
      logger.info(`[TV Socket] Generated pair code ${pairCode} for socket ${socket.id}`);
    });

    // 2. TV identifies itself as an already paired device
    socket.on("identify_paired_device", async (data: { display_id: string }) => {
      if (!data.display_id) return;
      
      try {
        const device = await (DisplayDevice.findOne({ display_id: data.display_id }) as any).unscoped();
        if (device) {
          // Join the specific room for this display
          socket.join(`tv_paired_${device.display_id}`);
          // Join a general hospital room for hospital-wide broadcasts if needed
          socket.join(`hospital_${device.hospital}`);
          
          device.status = "online";
          device.socket_id = socket.id;
          device.last_seen = new Date();
          await device.save();

          socket.emit("device_identified_success", {
            display_name: device.display_name,
            assigned_doctors: device.assigned_doctors,
            announcement_language: device.announcement_language || "en-IN",
            video_url: device.video_url || "",
            play_sound: device.play_sound || false,
          });

          logger.info(`[TV Socket] TV ${device.display_id} identified and online`);

          // Send initial queue update for all assigned doctors or all active doctors in hospital
          const docIds = device.assigned_doctors && device.assigned_doctors.length > 0
            ? device.assigned_doctors
            : await (DoctorProfile.find({ hospital: device.hospital }) as any).unscoped().distinct("_id");

          for (const docId of docIds) {
            await emitQueueUpdate(socket, docId, device.hospital);
          }
        } else {
          socket.emit("device_identified_failed", { message: "Device not found" });
        }
      } catch (err) {
        logger.error(`[TV Socket] Error identifying device: ${err}`);
      }
    });

    socket.on("disconnect", async () => {
      logger.info(`[TV Socket] Disconnected: ${socket.id}`);
      
      // Remove from active unpaired TVs if it was there
      for (const [code, sid] of activeUnpairedTVs.entries()) {
        if (sid === socket.id) {
          activeUnpairedTVs.delete(code);
        }
      }

      // Mark paired device offline
      try {
        await (DisplayDevice.findOneAndUpdate(
          { socket_id: socket.id },
          { status: "offline", last_seen: new Date() }
        ) as any).unscoped();
      } catch (err) {
        logger.error(`[TV Socket] Error marking device offline: ${err}`);
      }
    });
  });
};

import Appointment from "../Appointment/Models/Appointment.js";
import PatientProfile from "../Patient/Models/PatientProfile.js";
import DoctorProfile from "../Doctor/Models/DoctorProfile.js";
import mongoose from "mongoose";

export const emitQueueUpdate = async (ioOrSocket: Server | Socket, doctorId: mongoose.Types.ObjectId | string, hospitalId: mongoose.Types.ObjectId | string) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // Get current appointment
    const currentAppointment = await (Appointment.findOne({
      doctor: doctorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: "in-progress"
    }) as any).unscoped().populate({
      path: "patient",
      select: "name",
      options: { unscoped: true }
    });

    // Get next appointment
    const nextAppointment = await (Appointment.findOne({
      doctor: doctorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ["confirmed", "waiting"] }
    }) as any).unscoped().sort({ appointmentTime: 1, startTime: 1, createdAt: 1 }).populate({
      path: "patient",
      select: "name",
      options: { unscoped: true }
    });

    const doctorProfile = await (DoctorProfile.findById(doctorId) as any).unscoped().populate({
      path: "user",
      select: "name",
      options: { unscoped: true }
    });

    const payload = {
      doctorId,
      doctorName: (doctorProfile?.user as any)?.name || "Doctor",
      currentPatient: currentAppointment ? {
        token: currentAppointment.token_number || "N/A",
        name: (currentAppointment.patient as any)?.name || "Patient",
        time: currentAppointment.appointmentTime || currentAppointment.startTime || "N/A"
      } : null,
      nextPatient: nextAppointment ? {
        token: nextAppointment.token_number || "N/A",
        name: (nextAppointment.patient as any)?.name || "Patient",
        time: nextAppointment.appointmentTime || nextAppointment.startTime || "N/A"
      } : null
    };

    if ('of' in ioOrSocket) {
      // It's a Server object
      ioOrSocket.of("/tv-display").to(`hospital_${hospitalId.toString()}`).emit("queue_update", payload);
    } else {
      // It's a Socket object
      ioOrSocket.emit("queue_update", payload);
    }
  } catch (err) {
    logger.error(`[TV Socket] Error emitting queue update: ${err}`);
  }
};
