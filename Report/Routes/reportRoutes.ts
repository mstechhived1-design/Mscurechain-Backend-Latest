import express from "express";
import { uploadFile, saveReport, getPatientReports, deleteReport, proxyPDF } from "../Controllers/reportController.js";
import { saveTransactionReport, getPatientTransactionReports, getAllTransactionReports, updateTransactionReport, deleteTransactionReport } from "../Controllers/transactionReportController.js";
import upload from "../../middleware/Upload/upload.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";

const router = express.Router();

// Apply auth + tenant context to all report routes
router.use(protect);
router.use(resolveTenant);

router.post("/upload", upload.single("file"), uploadFile);
router.post("/", saveReport);
router.get("/patient/:patientId", getPatientReports);
router.delete("/:id", deleteReport);
router.get("/proxy-pdf/:reportId", proxyPDF);

import { getIPDFinalBill } from "../Controllers/ipdFinalBillController.js";
import { getOPDFinalBill } from "../Controllers/opdFinalBillController.js";

// Transaction Reports
router.post("/transaction-reports", saveTransactionReport);
router.get("/transaction-reports", getAllTransactionReports);
router.get("/transaction-reports/patient/:patientId", getPatientTransactionReports);
router.get("/transaction-reports/patient/:patientId/ipd-final-bill", getIPDFinalBill);
router.get("/transaction-reports/patient/:patientId/opd-final-bill", getOPDFinalBill);
router.put("/transaction-reports/:id", updateTransactionReport);
router.delete("/transaction-reports/:id", deleteTransactionReport);

export default router;
