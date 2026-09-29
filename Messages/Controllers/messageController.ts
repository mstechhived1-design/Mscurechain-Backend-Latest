import { Request, Response } from "express";
import Message from "../Models/Message.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
// import HelpDesk from "../../Helpdesk/Models/HelpDesk.js";
// Using static imports for cleaner code, assuming circular deps are handled or not present for these usage patterns.
// If runtime errors occur, we might need to revert to dynamic imports or use forward references.
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import { MessageRequest } from "../types/index.js";

// Helper to populate messages from both User and HelpDesk collections
const populateMessages = async (messages: any[]): Promise<any[]> => {
  if (!messages || messages.length === 0) return [];

  const userIds = new Set<string>();
  const replyIds = new Set<string>(); // To fetch quoted messages

  // Handle both array of documents and single document
  const msgArray = Array.isArray(messages) ? messages : [messages];

  msgArray.forEach((msg) => {
    if (msg.sender) userIds.add(msg.sender.toString());
    if (msg.recipient) userIds.add(msg.recipient.toString());
    if (msg.replyTo) replyIds.add(msg.replyTo.toString());
  });

  const ids = Array.from(userIds);
  const rIds = Array.from(replyIds);

  const [users, patients, replies] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("name role avatar"),
    Patient.find({ _id: { $in: ids } }).select("name role avatar"),
    Message.find({ _id: { $in: rIds } }).select("content sender"),
  ]);

  const userMap: any = {};
  users.forEach((u) => {
    userMap[u._id.toString()] = u.toObject ? u.toObject() : u;
  });
  patients.forEach((p) => {
    userMap[p._id.toString()] = p.toObject ? p.toObject() : p;
  });

  // Populate Doctor Profile Pictures
  const doctorIds = users
    .filter((u: any) => u.role === "doctor")
    .map((u: any) => u._id);
  if (doctorIds.length > 0) {
    try {
      const profiles = await DoctorProfile.find({
        user: { $in: doctorIds },
      }).select("user profilePic");
      profiles.forEach((p) => {
        if (userMap[p.user.toString()] && p.profilePic) {
          userMap[p.user.toString()].profilePic = p.profilePic;
        }
      });
    } catch (e) {
      console.error("Error populating doctor images", e);
    }
  }

  // Helpdesk users are already in userMap from User.find()
  /*
  helpDesks.forEach((hd) => {
    const obj = hd.toObject ? hd.toObject() : hd;
    (obj as any).role = "helpdesk"; // Manually assign role
    userMap[hd._id.toString()] = obj;
  });
  */

  const replyMap: any = {};
  replies.forEach((r) => (replyMap[r._id.toString()] = r));

  return msgArray.map((msg) => {
    const msgObj = msg.toObject ? msg.toObject() : msg;
    msgObj.sender = userMap[msg.sender.toString()] || null;
    msgObj.recipient = userMap[msg.recipient.toString()] || null;

    if (msg.replyTo) {
      const originalMsg = replyMap[msg.replyTo.toString()];
      if (originalMsg) {
        msgObj.replyTo = {
          _id: originalMsg._id,
          content: originalMsg.content,
          senderName: userMap[originalMsg.sender.toString()]?.name || "Unknown",
        };
      }
    }

    return msgObj;
  });
};

// Send Message
export const sendMessage = async (req: MessageRequest, res: Response) => {
  try {
    let { recipientId, content, hospitalId, replyTo } = req.body;
    const senderId = (req.user as any)._id;

    // --- SIMPLIFIED HOSPITAL INFERRING (Single Clinic) ---
    if (!hospitalId) {
      const clinic = await Hospital.findOne().select("_id");
      if (clinic) {
        hospitalId = clinic._id;
      }
    }
    // -----------------------------------------------------

    if (!hospitalId) {
      console.warn(
        "Message validation warning: Hospital ID could not be inferred.",
      );
      // We allow mongoose to throw the validation error if it's still missing and required
    }
    // -------------------------------------

    const senderRole = (req.user as any).role;
    const senderModel = senderRole === "patient" ? "Patient" : "User";

    // Resolve recipient model - try User first, then Patient
    let recipientModel: "User" | "Patient" = "User";
    const isUserRecip = await User.exists({ _id: recipientId });
    if (!isUserRecip) {
      const isPatientRecip = await Patient.exists({ _id: recipientId });
      if (isPatientRecip) recipientModel = "Patient";
    }

    const message = await Message.create({
      sender: senderId,
      senderModel,
      recipient: recipientId,
      recipientModel,
      content,
      hospital: hospitalId,
      replyTo: replyTo || null,
    });

    // Manually populate
    const populatedMessages = await populateMessages([message]);
    const fullMessage = populatedMessages[0];

    // Socket.io Emit
    if ((req as any).io) {
      (req as any).io.to(recipientId).emit("receive_message", fullMessage);
    }

    // --- AUTO-COMPLETE APPOINTMENT LOGIC ---
    // If sender is a doctor and message implies completion
    if (
      (req.user as any).role === "doctor" &&
      (content.toLowerCase().includes("completed") ||
        content.toLowerCase().includes("next patient"))
    ) {
      try {
        const docProfile = await DoctorProfile.findOne({ user: senderId });
        if (docProfile) {
          // Find the latest active appointment (pending or confirmed) for this doctor
          // We prioritize 'confirmed' ones that are likely happening now
          const activeAppointment = await Appointment.findOne({
            doctor: docProfile._id,
            status: { $in: ["confirmed", "pending"] },
            date: {
              $gte: new Date(new Date().setHours(0, 0, 0, 0)),
              $lt: new Date(new Date().setHours(23, 59, 59, 999)),
            }, // Today's appointments
          }).sort({ timeSlot: 1 }); // Get the earliest one (likely the current one)

          if (activeAppointment) {
            activeAppointment.status = "completed";
            await activeAppointment.save();
            console.log(
              `Auto-completed appointment ${activeAppointment._id} for doctor ${docProfile._id}`,
            );

            // Notify via socket about status change
            if ((req as any).io) {
              (req as any).io.emit("appointment_status_changed", {
                appointmentId: activeAppointment._id,
                status: "completed",
                doctorName: (req.user as any).name,
                hospitalId: hospitalId,
              });
            }
          }
        }
      } catch (autoErr) {
        console.error("Auto-complete error:", autoErr);
        // Don't fail the message send if auto-complete fails
      }
    }
    // ---------------------------------------

    res.status(201).json(fullMessage);
  } catch (err: any) {
    console.error("Send Message Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get Messages (Conversation between two users)
export const getMessages = async (req: MessageRequest, res: Response) => {
  try {
    const { otherUserId } = req.params;
    const currentUserId = (req.user as any)._id;

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, recipient: otherUserId },
        { sender: otherUserId, recipient: currentUserId },
      ],
      // Exclude messages hidden for this user
      hiddenFor: { $ne: currentUserId },
    }).sort({ createdAt: 1 });

    const populatedMessages = await populateMessages(messages);

    res.json(populatedMessages);
  } catch (err) {
    console.error("Get Messages Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get Recent Conversations (For Help Desk to see list of doctors they talked to)
export const getConversations = async (req: MessageRequest, res: Response) => {
  try {
    const currentUserId = (req.user as any)._id;

    // Find all messages where current user is sender or receiver
    // AND not hidden for current user
    const messages = await Message.find({
      $or: [{ sender: currentUserId }, { recipient: currentUserId }],
      hiddenFor: { $ne: currentUserId },
    }).sort({ createdAt: -1 });

    const populatedMessages = await populateMessages(messages);

    // Group by other user
    const conversations: any = {};
    populatedMessages.forEach((msg) => {
      if (!msg.sender || !msg.recipient) return; // Skip if user deleted

      const otherUser =
        msg.sender._id.toString() === currentUserId.toString()
          ? msg.recipient
          : msg.sender;

      if (!conversations[otherUser._id]) {
        conversations[otherUser._id] = {
          user: otherUser,
          lastMessage: msg,
        };
      }
    });

    res.json(Object.values(conversations));
  } catch (err) {
    console.error("Get Conversations Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Edit Message
export const editMessage = async (req: MessageRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const currentUserId = (req.user as any)._id;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    // Check ownership
    if ((message.sender as any).toString() !== currentUserId.toString()) {
      return res
        .status(403)
        .json({ message: "You can only edit your own messages" });
    }

    // Check time limit (24 hours)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (
      new Date().getTime() - new Date(message.createdAt).getTime() >
      TWENTY_FOUR_HOURS
    ) {
      return res
        .status(400)
        .json({ message: "You can only edit messages sent within 24 hours" });
    }

    message.content = content;
    (message as any).isEdited = true;
    await message.save();

    const populatedMessages = await populateMessages([message]);
    const fullMessage = populatedMessages[0];

    if ((req as any).io) {
      (req as any).io
        .to((message.recipient as any).toString())
        .emit("message_updated", fullMessage);
      (req as any).io
        .to((message.sender as any).toString())
        .emit("message_updated", fullMessage);
    }

    res.json(fullMessage);
  } catch (err) {
    console.error("Edit Message Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete Message (Soft delete for "Delete For Me", Tombstone if "Delete for Everyone")
export const deleteMessage = async (req: MessageRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const currentUserId = (req.user as any)._id;
    const { deleteForEveryone } = req.body || {};

    const message: any = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    // Logic:
    // 1. If "Delete for Everyone" AND user is sender -> Content replacement (Tombstone)
    // 2. Else -> "Delete for Me" -> Add to hiddenFor

    if (
      deleteForEveryone &&
      message.sender.toString() === currentUserId.toString()
    ) {
      message.content = "This message was deleted";
      message.isDeleted = true;
      await message.save();

      const populatedMessages = await populateMessages([message]);
      const fullMessage = populatedMessages[0];

      if ((req as any).io) {
        // Emit update instead of delete, so clients show the tombstone
        (req as any).io
          .to(message.recipient.toString())
          .emit("message_updated", fullMessage);
        (req as any).io
          .to(message.sender.toString())
          .emit("message_updated", fullMessage);
      }
      return res.json({ message: "Message deleted for everyone" });
    }

    // Soft Delete (Delete for Me)
    // Check if already hidden
    if (!message.hiddenFor.includes(currentUserId)) {
      message.hiddenFor.push(currentUserId);
      await message.save();
    }

    res.json({ message: "Message deleted for you" });
  } catch (err) {
    console.error("Delete Message Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Toggle Reaction
export const toggleReaction = async (req: MessageRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const currentUserId = (req.user as any)._id;

    const message: any = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    // Check availability of reaction from this user
    const existingIndex = message.reactions.findIndex(
      (r: any) => r.user.toString() === currentUserId.toString(),
    );

    if (existingIndex > -1) {
      // If same emoji, remove it (toggle off)
      if (message.reactions[existingIndex].emoji === emoji) {
        message.reactions.splice(existingIndex, 1);
      } else {
        // Change emoji
        message.reactions[existingIndex].emoji = emoji;
      }
    } else {
      // Add new reaction
      message.reactions.push({ user: currentUserId, emoji });
    }

    await message.save();

    const populatedMessages = await populateMessages([message]);
    const fullMessage = populatedMessages[0];

    if ((req as any).io) {
      (req as any).io
        .to(message.recipient.toString())
        .emit("message_updated", fullMessage);
      (req as any).io
        .to(message.sender.toString())
        .emit("message_updated", fullMessage);
    }

    res.json(fullMessage);
  } catch (err) {
    console.error("Reaction Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
