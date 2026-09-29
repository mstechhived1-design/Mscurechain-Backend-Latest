import { Response } from 'express';
import Note from "../Models/Note.js";
import { NoteRequest } from "../types/index.js";

// Get notes for a specific doctor
export const getDoctorNotes = async (req: NoteRequest, res: Response): Promise<void> => {
    try {
        const { doctorId } = req.params;
        const notes = await Note.find({ doctor: doctorId }).sort({ timestamp: -1 });
        res.json(notes);
    } catch (err) {
        console.error("getDoctorNotes error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// Create a new note
export const createNote = async (req: NoteRequest, res: Response): Promise<any> => {
    try {
        const { doctorId, text } = req.body;
        if (!doctorId || !text) {
            return res.status(400).json({ message: "Doctor ID and text are required" });
        }

        const newNote = await Note.create({
            doctor: doctorId,
            hospital: req.hospitalId,
            text
        });

        res.status(201).json(newNote);
    } catch (err) {
        console.error("createNote error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// Delete a note
export const deleteNote = async (req: NoteRequest, res: Response): Promise<any> => {
    try {
        const { id } = req.params;
        const deletedNote = await Note.findByIdAndDelete(id);

        if (!deletedNote) {
            return res.status(404).json({ message: "Note not found" });
        }

        res.json({ message: "Note deleted" });
    } catch (err) {
        console.error("deleteNote error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// Delete ALL notes for a doctor
export const deleteAllNotes = async (req: NoteRequest, res: Response): Promise<any> => {
    try {
        const { doctorId } = req.params;
        if (!doctorId) {
            return res.status(400).json({ message: "Doctor ID is required" });
        }

        await Note.deleteMany({ doctor: doctorId });
        res.json({ message: "All notes deleted successfully" });
    } catch (err) {
        console.error("deleteAllNotes error:", err);
        res.status(500).json({ message: "Server error" });
    }
};
