import mongoose, { Schema } from "mongoose";
import { INote } from "../types/index.js";

const noteSchema = new Schema<INote>({
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
noteSchema.plugin(multiTenancyPlugin);

const Note = mongoose.model<INote>("Note", noteSchema);
export default Note;
