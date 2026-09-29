import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import IPDMedicineIssuance, { IIssuanceItem } from "../Models/IPDMedicineIssuance.js";
import MedicineReturn from "../Models/MedicineReturn.js";
import Batch from "../Models/Batch.js";
import Product from "../Models/Product.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import IPDExtraCharge from "../../IPD/Models/IPDExtraCharge.js";

import PharmaProfile from "../Models/PharmaProfile.js";
import PharmacyOrder from "../Models/PharmacyOrder.js";
import MedicationRecord from "../../IPD/Models/MedicationRecord.js";
import Transaction from "../../Admin/Models/Transaction.js";
import { generatePharmaId } from "../utils/idGenerator.js";

// ─── Issue Medicines to IPD Patient ──────────────────────────────────────────
export const issueForIPD = asyncHandler(async (req: Request, res: Response) => {
    const {
        admissionId,
        orderId,
        requestedBy,
        items,
        notes,
        receivedByNurse,  // nurse ObjectId (optional)
        nurseNote,        // nurse name string (optional, denormalized for display)
    } = req.body;

    const hospitalId = (req as any).user.hospital;
    const issuedBy = (req as any).user._id;

    if (!admissionId || !items || !Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, "admissionId and at least one item are required");
    }

    // 1. Verify admission belongs to same hospital
    const admission = await IPDAdmission.findOne({
        admissionId,
        hospital: hospitalId,
    });
    if (!admission) {
        throw new ApiError(404, "IPD Admission not found");
    }

    if (admission.isBillLocked) {
        throw new ApiError(400, "Cannot issue medicines. IPD Bill is locked for this admission. Please unlock the bill first.");
    }

    // 2. Resolve pharmacy profile for this hospital
    const pharmaProfile = await PharmaProfile.findOne({ hospital: hospitalId }).lean();
    if (!pharmaProfile) {
        throw new ApiError(404, "Pharmacy profile not found for this hospital");
    }

    // 3. Validate stock for each item and prepare issuance items
    const issuanceItems: IIssuanceItem[] = [];
    let totalAmount = 0;

    for (const item of items) {
        const { productId, batchId, issuedQty } = item;

        if (!productId || !issuedQty || issuedQty < 1) {
            throw new ApiError(400, `Invalid item: productId and issuedQty are required`);
        }

        // Fetch Product for unitsPerPack
        const product = await Product.findById(productId).lean();
        if (!product) {
            throw new ApiError(404, `Product ${productId} not found`);
        }
        const unitsPerPack = product.unitsPerPack || 1;

        let remainingQty = issuedQty;

        if (batchId) {
            // Specific batch requested
            const batch = await Batch.findOne({
                _id: batchId,
                product: productId,
                hospital: hospitalId,
            });

            if (!batch) {
                throw new ApiError(404, `Batch ${batchId} not found`);
            }

            const availablePacks = batch.qtyReceived - batch.qtySold;
            const availableUnits = Math.floor(availablePacks * unitsPerPack);

            if (availableUnits < remainingQty) {
                throw new ApiError(
                    400,
                    `Insufficient stock for batch ${batch.batchNo}. Available: ${availableUnits} units, Requested: ${issuedQty} units`
                );
            }

            const unitRate = (product.mrp || 0) / unitsPerPack;
            const itemAmount = unitRate * remainingQty;

            totalAmount += itemAmount;

            issuanceItems.push({
                product: new mongoose.Types.ObjectId(productId),
                batch: batch._id,
                productName: item.productName || product.brand || `Product-${productId}`,
                batchNo: batch.batchNo,
                issuedQty: remainingQty,
                returnedQty: 0,
                unitRate: unitRate, // rate per unit
                frequency: item.frequency,
                totalAmount: itemAmount,
            });
        } else {
            // Auto-select batches FIFO
            const batches = await Batch.find({
                product: productId,
                hospital: hospitalId,
                $expr: { $gt: ["$qtyReceived", "$qtySold"] }
            }).sort({ expiryDate: 1, createdAt: 1 });

            for (const batch of batches) {
                if (remainingQty <= 0) break;
                const availablePacks = batch.qtyReceived - batch.qtySold;
                const availableUnits = Math.floor(availablePacks * unitsPerPack);

                const unitsToTake = Math.min(availableUnits, remainingQty);
                if (unitsToTake <= 0) continue;

                const unitRate = (product.mrp || 0) / unitsPerPack;
                const itemAmount = unitRate * unitsToTake;

                totalAmount += itemAmount;

                issuanceItems.push({
                    product: new mongoose.Types.ObjectId(productId),
                    batch: batch._id,
                    productName: item.productName || product.brand || `Product-${productId}`,
                    batchNo: batch.batchNo,
                    issuedQty: unitsToTake,
                    returnedQty: 0,
                    unitRate: unitRate,
                    frequency: item.frequency || "1-1-1",
                    totalAmount: itemAmount,
                });

                remainingQty -= unitsToTake;
            }

            if (remainingQty > 0) {
                throw new ApiError(
                    400,
                    `Insufficient total stock for product ${product.brand || productId}. Short by ${remainingQty} units.`
                );
            }
        }
    }


    // 4. Deduct stock from batches & products
    for (const item of issuanceItems) {
        const product = await Product.findById(item.product).select("unitsPerPack");
        const unitsPerPack = product?.unitsPerPack || 1;
        const packQty = item.issuedQty / unitsPerPack;

        // Deduct from batch
        await Batch.findByIdAndUpdate(item.batch, {
            $inc: { qtySold: packQty },
        });

        // Deduct from total product stock
        await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: -packQty }
        });
    }


    // 5. Create issuance record with formatted Invoice ID
    const invoiceNo = await generatePharmaId(pharmaProfile._id, pharmaProfile.businessName || "PHARMA", "issuance");

    const issuance = await IPDMedicineIssuance.create({
        admissionId,
        invoiceNo,
        admission: admission._id,
        patient: admission.patient,
        hospital: hospitalId,
        pharmacy: pharmaProfile._id,
        issuedBy,
        requestedBy: requestedBy || issuedBy,
        receivedByNurse: receivedByNurse || null,
        nurseNote: nurseNote || null,
        items: issuanceItems,
        status: "ISSUED",
        totalAmount,
        notes,
        issuedAt: new Date(),
    });

    // 6. Add pharmacy charge to IPD bill (flows into final bill automatically)
    await IPDExtraCharge.create({
        patient: admission.patient,
        admission: admission._id,
        hospital: hospitalId,
        category: "Pharmacy",
        description: `Pharmacy Issuance - ${issuanceItems.length} item(s)`,
        amount: totalAmount,
        date: new Date(),
        addedBy: issuedBy,
        status: "Active",
    });

    // 7. Global Revenue Transaction (Marked as 'pharmacy' so it shows in sales history)
    await Transaction.create({
        user: issuedBy,
        hospital: hospitalId,
        amount: totalAmount,
        type: "pharmacy",
        status: "completed",
        paymentMode: "other",
        referenceId: issuance._id,
        date: new Date(),
    });

    // 8. Set pharmacy clearance to PENDING on the admission
    admission.pharmacyClearanceStatus = "PENDING";
    await admission.save();

    // 8. If an orderId was passed, mark that order as completed and sync quantities
    if (orderId) {
        const pOrder = await PharmacyOrder.findById(orderId);
        if (pOrder) {
            pOrder.status = "completed";

            pOrder.paymentStatus = "paid"; // Charged to IPD bill

            // Create a mapping of productId -> total issued
            const issuedMap = new Map();
            issuanceItems.forEach(item => {
                const pid = item.product.toString();
                issuedMap.set(pid, (issuedMap.get(pid) || 0) + item.issuedQty);
            });

            pOrder.medicines = pOrder.medicines.map(m => {
                const pid = m.productId?.toString();
                if (pid && issuedMap.has(pid)) {
                    return {
                        ...m,
                        quantity: issuedMap.get(pid).toString(),
                        status: "dispensed"
                    };
                }
                return m;
            });

            await pOrder.save();
        }
        req.app.get("io")?.to(`hospital_${hospitalId}`).emit("pharmacy_order_completed", orderId);
    }

    res.status(201).json({
        success: true,
        message: "Medicines issued successfully. Pharmacy clearance set to PENDING.",
        data: {
            issuanceId: issuance._id,
            invoiceNo,
            admissionId,
            totalAmount,
            itemCount: issuanceItems.length,
            pharmacyClearanceStatus: "PENDING",
        },
    });
});

// ─── Get explicitly assigned active patients for the logged-in nurse ───────────
export const getNurseAssignedAdmissions = asyncHandler(
    async (req: Request, res: Response) => {
        const hospitalId = (req as any).user.hospital;
        const nurseId = (req as any).user._id;

        // Find all issuances for this nurse in this hospital
        const distinctAdmissionIds = await IPDMedicineIssuance.distinct("admissionId", {
            hospital: hospitalId,
            receivedByNurse: nurseId
        });

        // Now lookup the admission details from IPDAdmission
        const admissions = await IPDAdmission.find({
            admissionId: { $in: distinctAdmissionIds },
            hospital: hospitalId,
            status: "Active"
        })
            .populate("patient", "name")
            .populate({
                path: "primaryDoctor",
                populate: { path: "user", select: "name" }
            })
            .sort({ admissionDate: -1 })
            .lean();

        // Optional: Manual bed resolution and fetch recent explicitly assigned issuances
        const BedOccupancy = (await import('../../IPD/Models/BedOccupancy.js')).default;

        const admissionsWithDetails = await Promise.all(admissions.map(async (adm) => {
            const occupancy = await BedOccupancy.findOne({ admission: adm._id }).populate('bed', 'bedId').sort({ startDate: -1 }).lean();

            // Fetch the explicit issuances assigned to THIS nurse for THIS patient
            const nurseIssuances = await IPDMedicineIssuance.find({
                admissionId: adm.admissionId,
                hospital: hospitalId,
                receivedByNurse: nurseId
            })
                .sort({ issuedAt: -1 })
                .lean();

            return {
                ...adm,
                bed: occupancy?.bed ? occupancy.bed : null,
                nurseIssuances
            };
        }));

        res.status(200).json(admissionsWithDetails);
    }
);

// ─── Get All Issuances for an Admission ──────────────────────────────────────
export const getIssuancesByAdmission = asyncHandler(
    async (req: Request, res: Response) => {
        const { admissionId } = req.params;
        const hospitalId = (req as any).user.hospital;

        // Resolve admission manually to handle both Mongo _id or String admissionId
        let query: any = { hospital: hospitalId };
        if (mongoose.Types.ObjectId.isValid(admissionId)) {
            query._id = admissionId;
        } else {
            query.admissionId = admissionId;
        }

        const admission = await IPDAdmission.findOne(query).select("admissionId").lean();
        if (!admission) throw new ApiError(404, "Admission not found");

        const queryIss: any = {
            admissionId: admission.admissionId,
            hospital: hospitalId,
        };

        const userRole = (req as any).user.role;
        const userId = (req as any).user._id;

        // If nurse, only show issuances they personally received
        if (userRole === "nurse") {
            queryIss.receivedByNurse = userId;
        }

        const issuances = await IPDMedicineIssuance.find(queryIss)
            .populate("issuedBy", "name role")
            .populate("requestedBy", "name role")
            .populate("receivedByNurse", "name role")
            .populate("items.product", "name generic brand")
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({
            success: true,
            data: issuances,
            total: issuances.length,
        });
    }
);

// ─── Get Issuance Summary (Balance Calculation) ───────────────────────────────
export const getIssuanceSummary = asyncHandler(
    async (req: Request, res: Response) => {
        const { admissionId } = req.params;
        const hospitalId = (req as any).user.hospital;

        // Smart Resolve: Handle Mongo _id or admissionId string
        let q: any = { hospital: hospitalId };
        if (mongoose.Types.ObjectId.isValid(admissionId)) {
            q._id = admissionId;
        } else {
            q.admissionId = admissionId;
        }

        const admission = await IPDAdmission.findOne(q).select("admissionId pharmacyClearanceStatus").lean();
        if (!admission) throw new ApiError(404, "Admission not found");

        const issuances = await IPDMedicineIssuance.find({
            admissionId: admission.admissionId,
            hospital: hospitalId,
        }).lean();

        let totalIssued = 0;
        let totalReturned = 0;
        let totalIssuedAmount = 0;
        let totalReturnedAmount = 0;

        for (const issuance of issuances) {
            for (const item of issuance.items) {
                totalIssued += item.issuedQty;
                totalReturned += item.returnedQty;
                totalIssuedAmount += item.totalAmount;
                totalReturnedAmount += item.returnedQty * item.unitRate;
            }
        }

        // Pending returns
        const pendingReturns = await MedicineReturn.countDocuments({
            admissionId: admission.admissionId,
            hospital: hospitalId,
            status: "PENDING",
        });

        res.status(200).json({
            success: true,
            data: {
                admissionId: admission.admissionId,
                totalIssued,
                totalReturned,
                totalConsumed: totalIssued - totalReturned,
                totalIssuedAmount: parseFloat(totalIssuedAmount.toFixed(2)),
                totalReturnedAmount: parseFloat(totalReturnedAmount.toFixed(2)),
                netBillableAmount: parseFloat((totalIssuedAmount - totalReturnedAmount).toFixed(2)),
                pendingReturnRequests: pendingReturns,
                pharmacyClearanceStatus: admission?.pharmacyClearanceStatus ?? "NOT_REQUIRED",
                issuanceCount: issuances.length,
            },
        });
    }
);

// ─── Pharmacy Manual Sign-Off (Strict Reconciliation) ──────────────────────────
export const signoffPharmacy = asyncHandler(
    async (req: Request, res: Response) => {
        const { admissionId } = req.params;
        const { forceOverride, overrideReason } = req.body;
        const hospitalId = (req as any).user.hospital;

        let query: any = { hospital: hospitalId };
        if (mongoose.Types.ObjectId.isValid(admissionId)) {
            query._id = admissionId;
        } else {
            query.admissionId = admissionId;
        }

        const admission = await IPDAdmission.findOne(query);

        if (!admission) {
            throw new ApiError(404, "IPD Admission not found");
        }

        if (admission.pharmacyClearanceStatus === "CLEARED") {
            return res.status(200).json({
                success: true,
                message: "Pharmacy clearance already completed",
                data: { pharmacyClearanceStatus: "CLEARED" },
            });
        }

        // 1. Block if there are PENDING return requests that need action
        const pendingReturns = await MedicineReturn.countDocuments({
            admissionId,
            hospital: hospitalId,
            status: "PENDING",
        });

        if (pendingReturns > 0) {
            throw new ApiError(
                400,
                `Cannot sign-off. There are ${pendingReturns} pending medicine return requests. Please approve or reject them first.`
            );
        }

        // 2. Compute Reconciliations (Issued vs Consumed vs Returned)
        const issuances = await IPDMedicineIssuance.find({
            admissionId,
            hospital: hospitalId,
        }).populate("items.product", "name generic brand").lean();

        const medRecords = await MedicationRecord.find({
            admission: admission._id,
            hospital: hospitalId,
            status: "Administered"
        }).lean();

        const administeredById: Record<string, number> = {};
        const administeredByName: Record<string, number> = {};

        medRecords.forEach(m => {
            const mid = (m.medicineId as any)?.toString();
            const drugName = (m.drugName || "").toLowerCase().trim();
            if (mid && mid.length === 24 && /^[0-9a-fA-F]+$/.test(mid)) {
                administeredById[mid] = (administeredById[mid] || 0) + 1;
            } else {
                const finalName = (mid || drugName).toLowerCase().trim();
                if (finalName) {
                    administeredByName[finalName] = (administeredByName[finalName] || 0) + 1;
                }
            }
        });

        const missingItems: { medicine: string; issued: number; returned: number; consumed: number; missing: number }[] = [];

        issuances.forEach(iss => {
            (iss.items || []).forEach((item: any) => {
                const issued = item.issuedQty || 0;
                const returned = item.returnedQty || 0;
                let leftQty = issued - returned;
                let consumedCount = 0;

                if (leftQty > 0) {
                    const productId = (item.product?._id || item.product)?.toString();
                    const productGeneric = item.product?.generic?.toLowerCase() || "";
                    const productBrand = item.product?.brand?.toLowerCase() || "";
                    const productNameLow = item.productName?.toLowerCase() || "";

                    // 1. Primary Match: medicineId (Exact match)
                    if (productId && administeredById[productId] > 0) {
                        const toDeduct = Math.min(administeredById[productId], leftQty);
                        leftQty -= toDeduct;
                        consumedCount += toDeduct;
                        administeredById[productId] -= toDeduct;
                    }

                    // 2. Secondary Match: Name-based Fuzzy
                    if (leftQty > 0) {
                        for (const drugName in administeredByName) {
                            if (administeredByName[drugName] <= 0) continue;
                            const drugBase = drugName.split(" ")[0];
                            const isMatch =
                                productNameLow.includes(drugBase) ||
                                productGeneric.includes(drugBase) ||
                                productBrand.includes(drugBase) ||
                                drugName.includes(productNameLow.split(" ")[0]);

                            if (isMatch) {
                                const toDeduct = Math.min(administeredByName[drugName], leftQty);
                                leftQty -= toDeduct;
                                consumedCount += toDeduct;
                                administeredByName[drugName] -= toDeduct;
                            }
                        }
                    }

                    if (leftQty > 0) {
                        missingItems.push({
                            medicine: item.productName,
                            issued: issued,
                            returned: returned,
                            consumed: consumedCount,
                            missing: leftQty
                        });
                    }
                }
            });
        });

        // 3. Evaluate Result
        if (missingItems.length > 0) {
            // Allow pharmacist to bypass if they have physically verified it's a documentation mismatch, 
            // but log the override reason strictly.
            if (!forceOverride) {
                return res.status(400).json({
                    success: false,
                    message: "Pharmacy clearance blocked: Medicine mismatch detected between issued stock and administered records.",
                    mismatch: true,
                    data: { missingItems }
                });
            } else if (!overrideReason) {
                throw new ApiError(400, "An override reason is required to force clearance with a mismatch.");
            }
        }

        // 4. Mark as cleared
        admission.pharmacyClearanceStatus = "CLEARED";
        await admission.save();

        res.status(200).json({
            success: true,
            message: forceOverride ? "Pharmacy clearance enforced with override." : "Pharmacy clearance successfully validated and approved. Discharge can proceed.",
            data: {
                admissionId,
                pharmacyClearanceStatus: "CLEARED",
                signedOffBy: (req as any).user._id,
                signedOffAt: new Date(),
                wasOverridden: !!forceOverride,
                overrideReason: overrideReason || null
            },
        });
    }
);
