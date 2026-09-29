import { Router } from "express";
import { sseHandler } from "./sseController.js";

const router = Router();

// GET /api/sse/events
// No protect middleware — sseHandler performs its own JWT auth
// so the connection can be established via EventSource (no custom headers from browser)
router.get("/events", sseHandler);

export default router;
