import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import MedicineReturn, { IReturnItem } from "../Models/MedicineReturn.js";
import IPDMedicineIssuance, { IIssuanceItem } from "../Models/IPDMedicineIssuance.js";
import Batch from "../Models/Batch.js";
import Product from "../Models/Product.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import IPDExtraCharge from "../../IPD/Models/IPDExtraCharge.js";
import redisService from "../../config/redis.js";
import PharmaProfile from "../Models/PharmaProfile.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Transaction from "../../Admin/Models/Transaction.js";
import Invoice from "../Models/Invoice.js";

interface AuthRequest extends Request {
    user: {
        _id: string | mongoose.Types.ObjectId;
        hospital: string | mongoose.Types.ObjectId;
    };
}

interface IReturnInputItem {
    issuanceId: string;
    productId: string;
    batchId?: string;
    returnedQty: number;
    reason?: string;
}

// ─── Submit a Return Request (Nurse) ─────────────────────────────────────────
export const submitReturn = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as unknown as AuthRequest;
    const { admissionId, items, notes } = req.body as { admissionId: string; items: IReturnInputItem[]; notes?: string };
    const hospitalId = authReq.user.hospital;
    const returnedBy = authReq.user._id;

    if (!admissionId || !items || !Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, "admissionId and at least one item are required");
    }

    const pharmaProfile = await PharmaProfile.findOne({ hospital: hospitalId }).lean();
    if (!pharmaProfile) {
        throw new ApiError(404, "Pharmacy profile not found");
    }

    const admission = await IPDAdmission.findOne({ admissionId: admissionId, hospital: hospitalId });
    if (!admission) throw new ApiError(404, "Admission not found");

    const returnItems: IReturnItem[] = [];
    const affectedIssuances = new Set<string>();

    for (const item of items) {
        if (!item.issuanceId) throw new ApiError(400, "issuanceId required for every item");

        const issuance = await IPDMedicineIssuance.findOne({
            _id: item.issuanceId,
            hospital: hospitalId,
        });

        if (!issuance) throw new ApiError(404, `Medicine issuance not found for ID: ${item.issuanceId}`);
        if (issuance.status === "CLOSED") throw new ApiError(400, "Cannot return medicines. Issuance is already closed.");

        const issuanceItem = issuance.items.find(
            (i) => i.product.toString() === item.productId && (!item.batchId || i.batch.toString() === item.batchId)
        );

        if (!issuanceItem) {
            throw new ApiError(400, `Product ${item.productId} was not part of issuance ${item.issuanceId}`);
        }

        const alreadyReturned = issuanceItem.returnedQty;
        const maxReturnable = issuanceItem.issuedQty - alreadyReturned;

        if (item.returnedQty > maxReturnable) {
            throw new ApiError(
                400,
                `Cannot return ${item.returnedQty} units of ${issuanceItem.productName}. Maximum returnable: ${maxReturnable}`
            );
        }

        returnItems.push({
            issuance: issuance._id,
            product: issuanceItem.product,
            batch: issuanceItem.batch,
            productName: issuanceItem.productName,
            returnedQty: item.returnedQty,
            reason: item.reason,
        });

        affectedIssuances.add(issuance._id.toString());
    }

    const medicineReturn = await MedicineReturn.create({
        admissionId,
        patient: admission.patient,
        hospital: hospitalId,
        pharmacy: pharmaProfile._id,
        returnedBy: new mongoose.Types.ObjectId(returnedBy as string),
        items: returnItems,
        status: "PENDING",
        notes,
    });

    for (const issuanceIdStr of affectedIssuances) {
        await IPDMedicineIssuance.findByIdAndUpdate(issuanceIdStr, { status: "RETURN_REQUESTED" });
    }

    // Mark admission as PENDING clearance since a return is active
    admission.pharmacyClearanceStatus = "PENDING";
    await admission.save();

    // Notify relevant portals: Pharmacy and Nurse
    (req.app.get("io") as any)?.to(`hospital_${hospitalId}`).emit("medicine_return_requested", {
        admissionId: admissionId,
        returnId: medicineReturn._id
    });

    res.status(201).json({
        success: true,
        message: "Return request submitted. Awaiting pharmacist approval.",
        data: {
            returnId: medicineReturn._id,
            admissionId: admissionId,
            status: "PENDING",
        },
    });
});

// ─── Approve Return (Pharmacist) ──────────────────────────────────────────────
export const approveReturn = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as unknown as AuthRequest;
    const { id } = req.params;
    const hospitalId = authReq.user.hospital;
    const approvedBy = authReq.user._id;

    const medicineReturn = await MedicineReturn.findOne({
        _id: id,
        hospital: hospitalId,
        status: "PENDING",
    });
    if (!medicineReturn) {
        throw new ApiError(404, "Return request not found or already processed");
    }

    let totalReturnedAmount = 0;
    const affectedIssuances = new Set<string>();

    // 1. Restore batch & product stock and update return qty on issuance items
    for (const returnItem of medicineReturn.items) {
        const product = await Product.findById(returnItem.product).select("unitsPerPack");
        const unitsPerPack = product?.unitsPerPack || 1;
        const packQty = returnItem.returnedQty / unitsPerPack;

        // Restore stock in batch
        await Batch.findByIdAndUpdate(returnItem.batch, {
            $inc: { qtySold: -packQty },
        });

        // Restore stock in Product
        await Product.findByIdAndUpdate(returnItem.product, {
            $inc: { stock: packQty }
        });

        const issuance = await IPDMedicineIssuance.findById(returnItem.issuance);
        if (issuance) {
            const issuanceItem = issuance.items.find(
                (i) => i.product.toString() === returnItem.product.toString() && i.batch.toString() === returnItem.batch.toString()
            );
            if (issuanceItem) {
                issuanceItem.returnedQty += returnItem.returnedQty;
                totalReturnedAmount += returnItem.returnedQty * issuanceItem.unitRate;
                await issuance.save();
                affectedIssuances.add(issuance._id.toString());
            }
        }
    }

    // 2. Save updated issuances
    for (const issId of affectedIssuances) {
        await IPDMedicineIssuance.findByIdAndUpdate(issId, { status: "RETURN_APPROVED" });
    }

    // 3. Adjust IPDExtraCharge — add a reversal entry for the returned amount
    const admission = await IPDAdmission.findOne({
        admissionId: medicineReturn.admissionId,
        hospital: hospitalId,
    });
    if (admission && totalReturnedAmount > 0) {
        await IPDExtraCharge.create({
            patient: medicineReturn.patient,
            admission: admission._id,
            hospital: hospitalId,
            category: "Pharmacy",
            description: `Medicine Return Credit - ${medicineReturn.items.length} item(s) returned`,
            amount: -totalReturnedAmount,
            date: new Date(),
            addedBy: new mongoose.Types.ObjectId(approvedBy as string),
            status: "Active",
        });

        // Global Transaction reversal
        await Transaction.create({
            user: new mongoose.Types.ObjectId(approvedBy as string),
            hospital: hospitalId,
            amount: -totalReturnedAmount,
            type: "pharmacy",
            status: "completed",
            paymentMode: "other",
            referenceId: medicineReturn._id,
            date: new Date(),
        });

        // Invalidate bill cache
        await redisService.del(`ipd:bill:${admission._id}`);
        await redisService.del(`ipd:bill:${admission.admissionId}`);
    }

    // 5. Update return status
    medicineReturn.status = "APPROVED";
    medicineReturn.approvedBy = new mongoose.Types.ObjectId(approvedBy as string);
    medicineReturn.approvedAt = new Date();
    await medicineReturn.save();

    // 6. Auto-clearance check
    const pendingReturns = await MedicineReturn.countDocuments({
        admissionId: medicineReturn.admissionId,
        hospital: hospitalId,
        status: "PENDING",
    });

    if (pendingReturns === 0 && admission) {
        admission.pharmacyClearanceStatus = "CLEARED";
        await admission.save();
    }

    // Notify Portals
    (req.app.get("io") as any)?.to(`hospital_${hospitalId}`).emit("medicine_return_approved", {
        admissionId: medicineReturn.admissionId,
        returnId: medicineReturn._id
    });

    res.status(200).json({
        success: true,
        message: "Return approved. Stock restored and bill adjusted.",
        data: {
            returnId: medicineReturn._id,
            admissionId: medicineReturn.admissionId,
            returnedAmount: parseFloat(totalReturnedAmount.toFixed(2)),
            pharmacyClearanceStatus: admission?.pharmacyClearanceStatus,
        },
    });
});

// ─── Reject Return (Pharmacist) ───────────────────────────────────────────────
export const rejectReturn = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as unknown as AuthRequest;
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const hospitalId = authReq.user.hospital;

    const medicineReturn = await MedicineReturn.findOne({
        _id: id,
        hospital: hospitalId,
        status: "PENDING",
    });
    if (!medicineReturn) {
        throw new ApiError(404, "Return request not found or already processed");
    }

    const affectedIssuances = [...new Set(medicineReturn.items.map(i => i.issuance.toString()))];
    for (const issId of affectedIssuances) {
        await IPDMedicineIssuance.findByIdAndUpdate(issId, { status: "ISSUED" });
    }

    medicineReturn.status = "REJECTED";
    medicineReturn.rejectionReason = rejectionReason || "Rejected by pharmacist";
    medicineReturn.approvedBy = new mongoose.Types.ObjectId(authReq.user._id as string);
    await medicineReturn.save();

    // Auto-clearance check
    const pendingReturns = await MedicineReturn.countDocuments({
        admissionId: medicineReturn.admissionId,
        hospital: hospitalId,
        status: "PENDING",
    });

    if (pendingReturns === 0) {
        await IPDAdmission.findOneAndUpdate(
            { admissionId: medicineReturn.admissionId, hospital: hospitalId },
            { pharmacyClearanceStatus: "CLEARED" }
        );
    }

    // Notify Portals
    (req.app.get("io") as any)?.to(`hospital_${hospitalId}`).emit("medicine_return_rejected", {
        admissionId: medicineReturn.admissionId,
        returnId: medicineReturn._id
    });

    res.status(200).json({
        success: true,
        message: "Return request rejected.",
        data: {
            returnId: medicineReturn._id,
            status: "REJECTED",
        },
    });
});

// ─── Get all Returns for a Hospital (Pharmacist) ──────────────────────────────
export const getAllReturns = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as unknown as AuthRequest;
    const hospitalId = authReq.user.hospital;
    const { status, admissionId } = req.query;

    const filter: any = { hospital: hospitalId };
    if (status) filter.status = status;
    if (admissionId) filter.admissionId = admissionId;

    const returns = await MedicineReturn.find(filter)
        .populate("patient", "name mobile")
        .populate("returnedBy", "name role")
        .populate("approvedBy", "name role")
        .populate("items.issuance", "totalAmount items")
        .sort({ createdAt: -1 })
        .lean();

    // Optimized Enrichment: Bulk fetch PatientProfiles and Admissions to avoid N+1 queries
    const userIds = returns.map((r: any) => r.patient?._id).filter(Boolean);
    const admissionIds = returns.map((r: any) => r.admissionId).filter(Boolean);

    const [patientProfiles, admissions] = await Promise.all([
        PatientProfile.find({ user: { $in: userIds as any }, hospital: hospitalId })
            .select("user mrn")
            .lean(),
        IPDAdmission.find({ admissionId: { $in: admissionIds as any }, hospital: hospitalId })
            .select("admissionId primaryDoctor")
            .populate({
                path: "primaryDoctor",
                populate: { path: "user", select: "name" }
            })
            .lean()
    ]);

    const profileMap = patientProfiles.reduce((acc: any, prof: any) => {
        acc[prof.user.toString()] = prof;
        return acc;
    }, {});

    const admissionMap = admissions.reduce((acc: any, adm: any) => {
        acc[adm.admissionId] = adm;
        return acc;
    }, {});

    const enrichedReturns = (returns as any[]).map((ret: any) => {
        const pId = ret.patient?._id?.toString();
        const profile = pId ? (profileMap[pId] as any) : null;
        const adm = ret.admissionId ? (admissionMap[ret.admissionId] as any) : null;

        // Compute Financials
        let totalIssuanceAmount = 0;
        let totalReturnAmount = 0;
        const processedIssuances = new Set<string>();

        if (ret.items && Array.isArray(ret.items)) {
            ret.items.forEach((item: any) => {
                const issuance = item.issuance as any;
                if (issuance) {
                    const issId = issuance._id?.toString() || issuance.toString();
                    if (!processedIssuances.has(issId)) {
                        totalIssuanceAmount += issuance.totalAmount || 0;
                        processedIssuances.add(issId);
                    }

                    // Calculate return amount for this item
                    if (issuance.items && Array.isArray(issuance.items)) {
                        const issItem = (issuance.items as any[]).find(
                            (i: any) => i.product.toString() === item.product.toString() && i.batch.toString() === item.batch.toString()
                        );
                        if (issItem) {
                            totalReturnAmount += (item.returnedQty * (issItem.unitRate || 0));
                        }
                    }
                }
            });
        }

        const primaryDoctor = (adm?.primaryDoctor as any)?.user?.name || "N/A";

        return {
            ...ret,
            patient: ret.patient
                ? {
                    ...ret.patient,
                    mrn: profile?.mrn,
                }
                : null,
            primaryDoctor,
            financials: {
                issuanceTotal: parseFloat(totalIssuanceAmount.toFixed(2)),
                thisReturnTotal: parseFloat(totalReturnAmount.toFixed(2)),
                netAmount: parseFloat((totalIssuanceAmount - totalReturnAmount).toFixed(2))
            },
            bedDetails: null
        };
    });

    res.status(200).json({
        success: true,
        count: enrichedReturns.length,
        data: enrichedReturns,
    });
});

// ─── Get all Returns for a specific Admission (Nurse/Pharmacist) ────────────
export const getReturnsByAdmission = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as unknown as AuthRequest;
    const { admissionId } = req.params;
    const hospitalId = authReq.user.hospital;

    const returns = await MedicineReturn.find({
        admissionId,
        hospital: hospitalId,
    })
        .populate("returnedBy", "name")
        .populate("approvedBy", "name")
        .sort({ createdAt: -1 })
        .lean();

    res.status(200).json({
        success: true,
        data: returns,
    });
});

// ─── Get Unified Returns for Hospital Admin (IPD & OPD) ─────────────────────
export const getUnifiedReturnedStock = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as unknown as AuthRequest;
    const hospitalId = (req as any).pharma?.hospital || authReq.user.hospital || (req.query as any).hospitalId;
    
    // 1. Fetch IPD Returns (MedicineReturn)
    const ipdReturns = await MedicineReturn.find({ hospital: hospitalId })
        .populate("patient", "name mobile")
        .populate("items.issuance", "totalAmount items")
        .sort({ createdAt: -1 })
        .lean();

    // 2. Fetch OPD Returns (Invoice with returned items or status RETURN)
    // Find invoices where status is RETURN, or any item has returnedQty > 0
    const opdReturns = await Invoice.find({ 
        hospital: hospitalId,
        $or: [
            { status: "RETURN" },
            { "items.returnedQty": { $gt: 0 } }
        ]
    }).sort({ createdAt: -1 }).lean();

    // 3. Normalize IPD Data
    const normalizedIpd = ipdReturns.map((ret: any) => {
        let totalReturnAmount = 0;
        let itemsCount = 0;

        if (ret.items && Array.isArray(ret.items)) {
            ret.items.forEach((item: any) => {
                itemsCount += 1;
                const issuance = item.issuance as any;
                if (issuance && issuance.items) {
                    const issItem = (issuance.items as any[]).find(
                        (i: any) => i.product.toString() === item.product.toString() && i.batch.toString() === item.batch.toString()
                    );
                    if (issItem) {
                        totalReturnAmount += (item.returnedQty * (issItem.unitRate || 0));
                    }
                }
            });
        }

        return {
            id: ret._id,
            source: "IPD",
            patientName: ret.patient?.name || "Unknown Patient",
            mobile: ret.patient?.mobile || "",
            referenceId: ret.admissionId || "N/A",
            date: ret.createdAt,
            itemsCount,
            refundAmount: parseFloat(totalReturnAmount.toFixed(2)),
            status: ret.status
        };
    });

    // 4. Normalize OPD Data
    const normalizedOpd = opdReturns.map((inv: any) => {
        let totalReturnAmount = 0;
        let itemsCount = 0;

        if (inv.items && Array.isArray(inv.items)) {
            inv.items.forEach((item: any) => {
                const isFullyReturned = inv.status === "RETURN";
                const rQty = item.returnedQty || (isFullyReturned ? item.qty : 0);

                if (rQty > 0) {
                    itemsCount += 1;
                    const unitPrice = item.amount / item.qty;
                    totalReturnAmount += (rQty * unitPrice);
                }
            });
        }

        return {
            id: inv._id,
            source: "OPD",
            patientName: inv.patientName || "Walk-in Patient",
            mobile: inv.patientMobile || "",
            referenceId: inv.invoiceNo || "N/A",
            date: inv.updatedAt || inv.createdAt, // since it was updated when returned
            itemsCount,
            refundAmount: parseFloat(totalReturnAmount.toFixed(2)),
            status: inv.status === "RETURN" ? "APPROVED" : "PARTIAL RETURN"
        };
    });

    // 5. Combine and Sort
    const unifiedReturns = [...normalizedIpd, ...normalizedOpd].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    res.status(200).json({
        success: true,
        count: unifiedReturns.length,
        data: unifiedReturns,
    });
});
