import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import PharmaInvoice from "../Models/Invoice.js";
import Product from "../Models/Product.js";
import Batch from "../Models/Batch.js";
import PharmaAuditLog from "../Models/AuditLog.js";
import PharmacyOrder from "../Models/PharmacyOrder.js";
import IPDMedicineIssuance from "../Models/IPDMedicineIssuance.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import Patient from "../../Patient/Models/Patient.js";
import Transaction from "../../Admin/Models/Transaction.js";
import mongoose from "mongoose";
import redisService from "../../config/redis.js";
import { generatePharmaId } from "../utils/idGenerator.js";
import { formatPatientDisplayName } from "../../utils/identityResolver.js";

export const getInvoices = async (req: PharmaRequest, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      status,
      search,
      page = 1,
      limit = 10,
      mode,
      patientType,
    } = req.query;
    const pharmacyId = req.pharma?._id;

    if (!pharmacyId) {
      return res.json({
        success: true,
        count: 0,
        total: 0,
        totalPages: 0,
        currentPage: Number(page),
        data: [],
      });
    }

    const filterType = (patientType as string || "").toUpperCase();

    const isWalkInQuery = filterType === "WALKIN" || filterType === "WALK-IN";
    const isOpdQuery = filterType === "OPD";
    const isIpdQuery = filterType === "IPD";
    const isAllQuery = filterType === "ALL";
    const isHospitalQuery = filterType === "HOSPITAL" || (!isWalkInQuery && !isOpdQuery && !isIpdQuery && !isAllQuery);

    let matchStage: any = {
      pharmacy: new mongoose.Types.ObjectId(pharmacyId?.toString()),
    };

    if (isWalkInQuery) {
      // Explicitly show only walk-in retail counter patients
      matchStage.$or = [
        { isWalkIn: true },
        { patientType: { $in: ["WALKIN", "Walk-in", "walkin", "Walk-In", "WALK_IN"] } }
      ];
    } else if (isOpdQuery) {
      // Hospital OPD patients only (exclude walk-in and IPD)
      matchStage.isWalkIn = { $ne: true };
      matchStage.patientType = { $nin: ["IPD", "WALKIN", "Walk-in", "walkin", "Walk-In", "WALK_IN"] };
      matchStage.isIPD = { $ne: true };
    } else if (isIpdQuery) {
      // Hospital IPD patients only
      matchStage.isWalkIn = { $ne: true };
      matchStage.$or = [{ patientType: "IPD" }, { isIPD: true }];
    } else if (isAllQuery) {
      // Show ALL (Hospital + Walk-in)
    } else {
      // Default / HOSPITAL: Show hospital patients only (do not show walk-in patients)
      matchStage.isWalkIn = { $ne: true };
      matchStage.patientType = { $nin: ["WALKIN", "Walk-in", "walkin", "Walk-In", "WALK_IN"] };
    }

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = end;
      }
    }

    if (status) matchStage.status = status;
    if (mode) matchStage.mode = mode;

    let matchedPatientIds: any[] = [];
    if (search) {
      const escapedSearch = (search as string).replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      const cleanPhone = (search as string).replace(/[^0-9]/g, "");

      try {
        const PatientModel = mongoose.model("Patient");
        const patientConditions: any[] = [
          { name: { $regex: escapedSearch, $options: "i" } }
        ];
        if (cleanPhone) {
          patientConditions.push({ mobile: { $regex: cleanPhone, $options: "i" } });
        }
        const matchedPatients = await PatientModel.find({ $or: patientConditions }).select("_id").lean();
        matchedPatientIds = matchedPatients.map((p: any) => p._id);
      } catch (err) {
        console.warn("Patient search lookup error:", err);
      }

      matchStage.$or = [
        { invoiceNo: { $regex: escapedSearch, $options: "i" } },
        { patientName: { $regex: escapedSearch, $options: "i" } },
        { customerPhone: { $regex: escapedSearch, $options: "i" } },
        { "items.productName": { $regex: escapedSearch, $options: "i" } },
        ...(matchedPatientIds.length > 0 ? [{ patient: { $in: matchedPatientIds } }] : [])
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    // IPD Issuances use different dates
    let ipdMatchStage: any = {
      pharmacy: new mongoose.Types.ObjectId(pharmacyId?.toString()),
      status: { $in: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"] },
      isTransferredToOPD: { $ne: true }
    };

    if (startDate || endDate) {
      ipdMatchStage.issuedAt = {};
      if (startDate) ipdMatchStage.issuedAt.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        ipdMatchStage.issuedAt.$lte = end;
      }
    }

    if (search) {
      const escapedSearch = (search as string).replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      ipdMatchStage.$or = [
        { invoiceNo: { $regex: escapedSearch, $options: "i" } },
        { admissionId: { $regex: escapedSearch, $options: "i" } },
        { patientName: { $regex: escapedSearch, $options: "i" } },
        { customerPhone: { $regex: escapedSearch, $options: "i" } },
        { "items.productName": { $regex: escapedSearch, $options: "i" } },
        ...(matchedPatientIds.length > 0 ? [{ patient: { $in: matchedPatientIds } }] : [])
      ];
    }

    const shouldFetchIpdIssuance = isIpdQuery || isHospitalQuery || isAllQuery;

    const [totalInvoices, invoices, ipdIssuances] = await Promise.all([
      PharmaInvoice.countDocuments(matchStage),
      PharmaInvoice.find(matchStage)
        .sort({ createdAt: -1 })
        .skip(isWalkInQuery || isOpdQuery ? skip : 0)
        .limit(isWalkInQuery || isOpdQuery ? Number(limit) : 1000)
        .populate("createdBy", "name email role")
        .populate("items.batch", "batchNo expiry")
        .populate("patient", "name honorific mobile")
        .lean(),
      !shouldFetchIpdIssuance ? Promise.resolve([]) : IPDMedicineIssuance.find(ipdMatchStage)
        .sort({ issuedAt: -1 })
        // Note: For aggregation to work correctly with pagination, 
        // we fetch all relevant for now or handle via pipeline.
        // Assuming reasonably small set for current patient context.
        .populate("patient", "name honorific mobile")
        .populate("issuedBy", "name email")
        .populate("items.batch", "expiry")
        .populate("items.product", "hsnCode")
        .populate({
          path: "admission",
          select: "primaryDoctor paymentStatus status",
          populate: {
            path: "primaryDoctor",
            select: "user",
            populate: {
              path: "user",
              select: "name"
            }
          }
        })
        .lean(),
    ]);

    // Map individual IPD Issuances (Each issuance is its own separate transaction & invoice)
    const mappedIpd = ipdIssuances.map((iss: any) => {
      const pName = (iss.patient as any)?.honorific
        ? `${(iss.patient as any).honorific} ${(iss.patient as any).name}`
        : ((iss.patient as any)?.name || iss.patientName || "IPD Patient");

      const isDischarged = (iss.admission as any)?.status === "Discharged" || iss.status === "CLOSED";
      const isPaid = iss.status === "CLOSED" || (iss.paid !== undefined && iss.paid > 0 && iss.paid >= iss.totalAmount) || isDischarged;
      const netPayable = Math.round((iss.totalAmount || 0) * 100) / 100;
      const paid = iss.paid !== undefined ? Math.round(Number(iss.paid) * 100) / 100 : (isPaid ? netPayable : 0);
      const balance = Math.round(Math.max(0, netPayable - paid) * 100) / 100;

      const hasDoctorOrder = Boolean(iss.orderId || (iss.notes && /PHARMA-\d+/i.test(iss.notes)));
      const prescriptionSource = iss.prescriptionSource || (hasDoctorOrder ? "DOCTOR_DIGITAL" : "DIRECT_PHARMACY");

      return {
        _id: iss._id,
        invoiceNo: iss.invoiceNo || `ISS-${iss._id.toString().slice(-6).toUpperCase()}`,
        patientName: pName,
        customerPhone: (iss.patient as any)?.mobile || iss.customerPhone || "-",
        netPayable,
        subTotal: netPayable,
        taxTotal: 0,
        discountTotal: 0,
        paid,
        balance,
        status: isPaid ? "PAID" : "CHARGED TO IPD",
        mode: iss.mode || (isPaid ? "CASH" : "IPD BILLING"),
        createdAt: iss.issuedAt || iss.createdAt,
        updatedAt: iss.updatedAt,
        prescriptionSource,
        orderId: iss.orderId,
        notes: iss.notes,
        items: (iss.items || []).map((i: any) => ({
          product: i.product,
          productId: i.product,
          drug: i.product,
          batch: i.batch,
          batchId: i.batch,
          productName: i.productName,
          itemName: i.productName,
          qty: i.issuedQty,
          unitRate: Math.round((i.unitRate || 0) * 100) / 100,
          amount: Math.round((i.totalAmount || 0) * 100) / 100,
          batchNo: i.batchNo || "-",
          expiryDate: i.batch?.expiry,
          hsnCode: i.product?.hsnCode || "-"
        })),
        createdBy: iss.issuedBy,
        doctorName: (iss.admission as any)?.primaryDoctor?.user?.name || "IPD Admission",
        isIPD: true,
        patientType: "IPD",
        admissionId: iss.admissionId,
        admission: iss.admission?._id || iss.admission
      };
    });

    const mappedInvoices = invoices.map((inv: any) => {
      const hasDoctorOrder = Boolean(inv.orderId || (inv.notes && /PHARMA-\d+/i.test(inv.notes)));
      const prescriptionSource = inv.prescriptionSource || (hasDoctorOrder ? "DOCTOR_DIGITAL" : "DIRECT_PHARMACY");

      return {
        ...inv,
        prescriptionSource,
        patientType: inv.patientType || (isWalkInQuery ? "Walk-in" : (inv.isIPD ? "IPD" : "OPD")),
        isIPD: isWalkInQuery ? false : (inv.isIPD || inv.patientType === "IPD"),
        isWalkIn: isWalkInQuery || Boolean(inv.isWalkIn)
      };
    });

    let paginatedRecords: any[] = [];
    let total = 0;

    if (isWalkInQuery || isOpdQuery) {
      // Pure PharmaInvoice: already sorted, skipped, and limited via MongoDB
      paginatedRecords = mappedInvoices;
      total = totalInvoices;
    } else if (isIpdQuery) {
      // Merge IPD invoices with IPD medicine issuances
      const allIpd = [...mappedInvoices, ...mappedIpd].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      total = allIpd.length;
      paginatedRecords = allIpd.slice(skip, skip + Number(limit));
    } else {
      // Hospital / ALL: Merge hospital invoices with IPD medicine issuances
      const allRecords = [...mappedInvoices, ...mappedIpd].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      total = allRecords.length;
      paginatedRecords = allRecords.slice(skip, skip + Number(limit));
    }

    // Resolve MRNs and Honorifics for pharmacy records
    const isMongoId = (val?: string) => typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val);
    const phones = paginatedRecords
      .map((inv: any) => (inv.customerPhone || inv.patient?.mobile || "").replace(/[^0-9]/g, "").slice(-10))
      .filter((p: string) => p.length === 10);
    const mrns = paginatedRecords
      .map((inv: any) => inv.mrn)
      .filter((m: any) => m && m !== "N/A" && !isMongoId(m));

    if (phones.length > 0 || mrns.length > 0) {
      const Patient = mongoose.model("Patient");
      const PatientProfile = mongoose.model("PatientProfile");

      const [patients, profiles, appointments] = await Promise.all([
        Patient.find({
          $or: [
            ...(mrns.length > 0 ? [{ mrn: { $in: mrns } }] : []),
            ...(phones.length > 0 ? [
              { mobile: { $in: phones } },
              { mobile: { $in: phones.map((p: string) => "91" + p) } },
              { mobile: { $in: phones.map((p: string) => "+91" + p) } }
            ] : [])
          ]
        }).select("_id name mobile mrn honorific gender").lean().catch(() => []),

        (PatientProfile.find({
          $or: [
            ...(mrns.length > 0 ? [{ mrn: { $in: mrns } }] : []),
            ...(phones.length > 0 ? [
              { contactNumber: { $in: phones } },
              { contactNumber: { $in: phones.map((p: string) => "91" + p) } },
              { contactNumber: { $in: phones.map((p: string) => "+91" + p) } }
            ] : [])
          ]
        }) as any).unscoped().select("user hospital mrn honorific contactNumber gender name").lean().catch(() => []),

        (async () => {
          try {
            const AppointmentModel = (await import("../../Appointment/Models/Appointment.js")).default;
            return await AppointmentModel.find({
              $or: [
                ...(mrns.length > 0 ? [{ "patientDetails.mrn": { $in: mrns } }] : []),
                ...(phones.length > 0 ? [
                  { "patientDetails.mobile": { $in: phones } },
                  { "patientDetails.mobile": { $in: phones.map((p: string) => "+91" + p) } },
                  { "patientDetails.mobile": { $in: phones.map((p: string) => "91" + p) } }
                ] : [])
              ]
            }).select("patientDetails honorific appointmentHonorific mrn").lean();
          } catch (e) {
            return [];
          }
        })()
      ]);

      const rawHospIdStr = (req.pharma?.hospital || req.headers["x-hospital-id"] || "")?.toString();
      (profiles as any[]).sort((a: any, b: any) => {
        const aMatch = a.hospital?.toString() === rawHospIdStr ? 1 : 0;
        const bMatch = b.hospital?.toString() === rawHospIdStr ? 1 : 0;
        return bMatch - aMatch;
      });

      const mrnToHonorific = new Map<string, string>();
      const phoneToHonorific = new Map<string, string>();
      const phoneToMrn = new Map<string, string>();

      for (const prof of (profiles as any[])) {
        const cleanP = (prof.contactNumber || "").replace(/[^0-9]/g, "").slice(-10);
        if (prof.mrn) {
          if (prof.honorific && !mrnToHonorific.has(prof.mrn)) mrnToHonorific.set(prof.mrn, prof.honorific);
          if (cleanP && !phoneToMrn.has(cleanP)) phoneToMrn.set(cleanP, prof.mrn);
        }
        if (cleanP && prof.honorific && !phoneToHonorific.has(cleanP)) {
          phoneToHonorific.set(cleanP, prof.honorific);
        }
      }

      for (const pat of (patients as any[])) {
        const cleanP = (pat.mobile || "").replace(/[^0-9]/g, "").slice(-10);
        if (pat.mrn) {
          if (pat.honorific && !mrnToHonorific.has(pat.mrn)) mrnToHonorific.set(pat.mrn, pat.honorific);
          if (cleanP && !phoneToMrn.has(cleanP)) phoneToMrn.set(cleanP, pat.mrn);
        }
        if (cleanP && pat.honorific && !phoneToHonorific.has(cleanP)) {
          phoneToHonorific.set(cleanP, pat.honorific);
        }
      }

      for (const app of (appointments as any[])) {
        const cleanP = (app.patientDetails?.mobile || "").replace(/[^0-9]/g, "").slice(-10);
        const m = app.patientDetails?.mrn || app.mrn;
        const hon = app.patientDetails?.honorific || app.appointmentHonorific || app.honorific;
        if (m && hon && !mrnToHonorific.has(m)) mrnToHonorific.set(m, hon);
        if (cleanP && hon && !phoneToHonorific.has(cleanP)) phoneToHonorific.set(cleanP, hon);
        if (cleanP && m && !phoneToMrn.has(cleanP)) phoneToMrn.set(cleanP, m);
      }

      paginatedRecords.forEach((inv: any) => {
        const cleanP = (inv.customerPhone || inv.patient?.mobile || "").replace(/[^0-9]/g, "").slice(-10);
        if (!inv.mrn || inv.mrn === "N/A" || isMongoId(inv.mrn)) {
          if (cleanP && phoneToMrn.has(cleanP)) {
            inv.mrn = phoneToMrn.get(cleanP);
          }
        }

        const resolvedHonorific =
          inv.honorific ||
          (inv.mrn && mrnToHonorific.get(inv.mrn)) ||
          (cleanP && phoneToHonorific.get(cleanP)) ||
          inv.patient?.honorific ||
          inv.patientDetails?.honorific ||
          "";

        if (resolvedHonorific) {
          inv.honorific = resolvedHonorific;
        }

        if (inv.patientName) {
          inv.patientName = formatPatientDisplayName(inv.patientName, resolvedHonorific);
        }

        inv.patientDetails = {
          name: inv.patientName,
          honorific: resolvedHonorific || "",
          mobile: inv.customerPhone,
          mrn: inv.mrn
        };

        if (inv.patient && typeof inv.patient === "object") {
          inv.patient.name = inv.patientName;
          inv.patient.honorific = resolvedHonorific || "";
          inv.patient.mrn = inv.mrn;
        }
      });
    }

    res.json({
      success: true,
      count: paginatedRecords.length,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      data: paginatedRecords,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getInvoiceById = async (req: PharmaRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pharmacyId = req.pharma?._id;

    const invoice = await PharmaInvoice.findOne({
      _id: id,
      pharmacy: pharmacyId,
    })
      .populate("createdBy", "name email")
      .populate("items.drug", "name brand generic")
      .populate("items.batch", "batchNo expiry")
      .lean();

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    try {
      const Patient = mongoose.model("Patient");
      const PatientProfile = mongoose.model("PatientProfile");
      const cleanPhone = (invoice.customerPhone || "").replace(/[^0-9]/g, "").slice(-10);
      const queryMrn = (invoice.mrn && !/^[0-9a-fA-F]{24}$/.test(invoice.mrn) && invoice.mrn !== "N/A") ? invoice.mrn : null;

      let resolvedHonorific = (invoice as any).honorific;
      let resolvedMrn = queryMrn;

      const orClauses: any[] = [];
      if (queryMrn) orClauses.push({ mrn: queryMrn });
      if (cleanPhone) {
        orClauses.push({ mobile: cleanPhone });
        orClauses.push({ mobile: "+91" + cleanPhone });
        orClauses.push({ contactNumber: cleanPhone });
        orClauses.push({ contactNumber: "+91" + cleanPhone });
      }

      if (orClauses.length > 0) {
        const pat: any = await Patient.findOne({ $or: orClauses.filter(c => c.mobile || c.mrn) }).lean();
        if (pat) {
          if (pat.honorific && !resolvedHonorific) resolvedHonorific = pat.honorific;
          if (pat.mrn && (!resolvedMrn || resolvedMrn === "N/A")) resolvedMrn = pat.mrn;
        }

        const prof: any = await (PatientProfile.findOne({ $or: orClauses.filter(c => c.contactNumber || c.mrn) }) as any).unscoped().lean();
        if (prof) {
          if (prof.honorific && !resolvedHonorific) resolvedHonorific = prof.honorific;
          if (prof.mrn && (!resolvedMrn || resolvedMrn === "N/A")) resolvedMrn = prof.mrn;
        }
      }

      if (resolvedHonorific) (invoice as any).honorific = resolvedHonorific;
      if (resolvedMrn) (invoice as any).mrn = resolvedMrn;
      if (invoice.patientName) {
        (invoice as any).patientName = formatPatientDisplayName(invoice.patientName, (invoice as any).honorific);
      }
    } catch (e) {
      // ignore fallback errors
    }

    res.json({ success: true, data: invoice });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createInvoice = async (req: PharmaRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      items,
      patientName,
      customerPhone,
      status = "PAID",
      paymentSummary,
      paymentDetails,
      orderId,
    } = req.body;
    let { mode = "CASH" } = req.body;

    // If frontend sends it nested
    if (
      (!req.body.mode || req.body.mode === "CASH") &&
      paymentSummary?.paymentMode
    ) {
      mode = paymentSummary.paymentMode;
    }
    const pharmacyId = req.pharma?._id;
    const hospitalId = req.pharma?.hospital;
    const userId = req.user._id;

    let subTotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    const processedItems: any[] = [];

    // Robust discount detection: check various potential fields for the total/global discount
    const globalDiscount = Number(
      paymentSummary?.discount ??
      paymentSummary?.discountTotal ??
      req.body.discountTotal ??
      req.body.discount ??
      0,
    );

    const computedSubtotal = items.reduce((sum: number, item: any) => {
      const rate = Number(item.unitRate || item.rate || 0);
      return sum + rate * Number(item.qty || 0);
    }, 0);

    for (const item of items) {
      // Map frontend fields to backend model if needed
      const drugId = item.drug || item.productId;
      const productName = item.productName || item.itemName;
      const unitRate = Number(item.unitRate || item.rate || 0);
      const gstPct = Number(item.gstPct || item.gst || 0);
      const itemQty = Number(item.qty || 1);

      const product = await Product.findOne({
        _id: drugId,
        pharmacy: pharmacyId,
      }).session(session);
      if (!product)
        throw new Error(`Product ${productName || "undefined"} not found`);

      const unitsPerPack = product.unitsPerPack || 1;
      const soldPacks = itemQty / unitsPerPack;

      if (product.stock < soldPacks) {
        throw new Error(`Insufficient stock for ${product.brand}`);
      }

      // Calculation Logic (MRP Inclusive of GST)

      // MRP = Taxable + (Taxable * GST / 100)
      // MRP = Taxable * (1 + GST / 100)
      // Taxable = MRP / (1 + GST / 100)

      const totalItemMRP = unitRate * itemQty;
      let itemDiscount =
        item.discountType === "FIXED"
          ? Number(item.discountValue || 0)
          : (totalItemMRP * Number(item.discountValue || 0)) / 100;

      // Handle global discount distribution if individual item discount is not provided
      if (itemDiscount === 0 && globalDiscount > 0 && computedSubtotal > 0) {
        itemDiscount = (totalItemMRP / computedSubtotal) * globalDiscount;
      }

      const netMRPAfterDiscount = totalItemMRP - itemDiscount;
      const itemTaxableAmount = netMRPAfterDiscount / (1 + gstPct / 100);
      const itemTax = netMRPAfterDiscount - itemTaxableAmount;

      subTotal += totalItemMRP;
      discountTotal += itemDiscount;
      taxTotal += itemTax;

      // FIFO Stock Subtraction - track first batch for batchNo/expiryDate on the invoice
      let remainingToSubtract = soldPacks;
      let firstBatchNo: string | undefined;
      let firstBatchExpiry: Date | undefined;
      let firstBatchId: any;

      const batches = await Batch.find({
        product: product._id,
        $expr: { $gt: ["$qtyReceived", "$qtySold"] },
      })
        .sort({ expiry: 1, grnDate: 1 })
        .session(session);

      for (const batch of batches) {
        const availableInBatch = batch.qtyReceived - batch.qtySold;
        const toTake = Math.min(remainingToSubtract, availableInBatch);

        // Track the first (primary) batch used for display
        if (!firstBatchId) {
          firstBatchId = batch._id;
          firstBatchNo = batch.batchNo;
          firstBatchExpiry = batch.expiry;
        }

        batch.qtySold += toTake;
        // @ts-ignore
        await batch.save({ session });

        remainingToSubtract -= toTake;
        if (remainingToSubtract <= 0) break;
      }

      if (remainingToSubtract > 0) {
        // AUTO-RECONCILE: If there's a discrepancy (stock exists but no batches),
        // create a system adjustment batch on the fly so the billing isn't blocked.
        const fallbackExpiry = new Date();
        fallbackExpiry.setFullYear(fallbackExpiry.getFullYear() + 2);

        let batchSupplier = product.supplier;
        if (!batchSupplier) {
          const fallback = await Supplier.findOne({
            pharmacy: pharmacyId,
          }).session(session);
          batchSupplier = fallback?._id;
        }

        if (batchSupplier) {
          // Use upsert to avoid E11000 duplicate key error when a SYSTEM_ADJ batch
          // already exists for this product+pharmacy. If it exists, increment
          // qtyReceived and qtySold; otherwise create it fresh.
          const sysAdjBatch = await Batch.findOneAndUpdate(
            {
              product: product._id,
              batchNo: "SYSTEM_ADJ",
              pharmacy: pharmacyId,
            },
            {
              $inc: {
                qtyReceived: remainingToSubtract,
                qtySold: remainingToSubtract,
              },
              $setOnInsert: {
                expiry: fallbackExpiry,
                unitCost: product.mrp * 0.7,
                supplier: batchSupplier,
                hospital: hospitalId,
                grnDate: new Date(),
              },
            },
            {
              upsert: true,
              new: true,
              session,
              setDefaultsOnInsert: true,
            },
          );

          // Use system adjustment batch for display if no real batch was found
          if (!firstBatchId) {
            firstBatchId = sysAdjBatch!._id;
            firstBatchNo = "SYSTEM_ADJ";
            firstBatchExpiry = fallbackExpiry;
          }

          remainingToSubtract = 0;
        } else {
          // If no supplier can be found anywhere, we finally throw.
          throw new Error(
            `Stock discrepancy in batches for ${product.brand}. Please register a supplier first.`,
          );
        }
      }

      processedItems.push({
        drug: product._id,
        productName: product.brand,
        qty: itemQty,
        unitRate: unitRate,
        mrp: product.mrp,
        gstPct: gstPct,
        hsnCode: product.hsnCode || item.hsnCode || item.hsn,
        discountType: "FIXED",
        discountValue: itemDiscount,
        amount: netMRPAfterDiscount,
        // Batch info from FIFO allocation
        batch: firstBatchId,
        batchNo: firstBatchNo,
        expiryDate: firstBatchExpiry,
      });

      // Use updateOne with $inc for atomic stock subtraction and isolation
      await Product.updateOne(
        { _id: product._id },
        { $inc: { stock: -soldPacks } },
      ).session(session);
    }

    const netPayable = Math.round(subTotal - discountTotal); // Sum of MRPs after item discounts

    // Mixed Payment Validation
    if (mode === "MIXED") {
      if (!paymentDetails)
        throw new Error("Payment details required for MIXED mode");
      const totalPaid =
        Number(paymentDetails.cash || 0) +
        Number(paymentDetails.card || 0) +
        Number(paymentDetails.upi || 0);
      if (Math.abs(totalPaid - netPayable) > 2) {
        // Allowing small rounding difference
        throw new Error(
          `Total mixed payments (₹${totalPaid}) do not match net payable (₹${netPayable})`,
        );
      }
    }

    const roundOff = netPayable - (subTotal - discountTotal);

    // Generate Structured Invoice Number (PREFIX-RAND-SEQ)
    const invoiceNo = await generatePharmaId(pharmacyId, req.pharma?.businessName || "PHARMA", "invoice", session);

    let resolvedMrn = req.body.mrn;
    let resolvedHonorific = req.body.honorific;
    let resolvedPatientId = req.body.patientId || req.body.patient;
    const isMongoIdVal = (val?: string) => typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val);
    let pat: any = null;

    if (!resolvedMrn || resolvedMrn === "N/A" || isMongoIdVal(resolvedMrn) || !resolvedHonorific || !resolvedPatientId) {
      if (customerPhone) {
        const cleanPhone = customerPhone.replace(/[^0-9]/g, "").slice(-10);
        const Patient = mongoose.model("Patient");
        const PatientProfile = mongoose.model("PatientProfile");

        pat = await Patient.findOne({
          $or: [
            ...(resolvedMrn && !isMongoIdVal(resolvedMrn) ? [{ mrn: resolvedMrn }] : []),
            { mobile: customerPhone },
            { mobile: cleanPhone },
            { mobile: "91" + cleanPhone },
            { mobile: "+91" + cleanPhone }
          ]
        }).session(session).lean();
        if (pat) {
          if (!resolvedPatientId) resolvedPatientId = pat._id;
          if (!resolvedMrn && pat.mrn) resolvedMrn = pat.mrn;
          if (!resolvedHonorific && pat.honorific) resolvedHonorific = pat.honorific;
        }

        const profile: any = await (PatientProfile.findOne({
          $or: [
            ...(resolvedMrn && !isMongoIdVal(resolvedMrn) ? [{ mrn: resolvedMrn }] : []),
            { contactNumber: customerPhone },
            { contactNumber: cleanPhone },
            { contactNumber: "+91" + cleanPhone },
            ...(pat?._id ? [{ user: pat._id }] : [])
          ],
          ...(hospitalId ? { hospital: hospitalId } : {})
        }) as any).unscoped().session(session).lean();
        if (profile) {
          if (!resolvedMrn && profile.mrn) resolvedMrn = profile.mrn;
          if (!resolvedHonorific && profile.honorific) resolvedHonorific = profile.honorific;
        }
      }
    }

    // Check Walk-in vs Hospital patient
    const isWalkIn = req.body.isWalkIn || req.body.patientCategory === 'walkin' || req.body.patientType === 'Walk-in' || req.body.patientType === 'WALKIN';

    // Resolve IPD Admission linkage if applicable (only for hospital patients)
    const isIPDPatient = !isWalkIn && (req.body.patientType === "IPD" || req.body.isIPD || Boolean(req.body.admissionId));
    let resolvedAdmissionId = isWalkIn ? undefined : req.body.admissionId;
    let resolvedAdmissionDoc: any = null;

    if (!isWalkIn && (isIPDPatient || resolvedAdmissionId)) {
      if (resolvedAdmissionId) {
        resolvedAdmissionDoc = await IPDAdmission.findOne({
          $or: [
            ...(mongoose.Types.ObjectId.isValid(resolvedAdmissionId) ? [{ _id: new mongoose.Types.ObjectId(resolvedAdmissionId) }] : []),
            { admissionId: resolvedAdmissionId }
          ]
        }).session(session);
      } else if (resolvedPatientId) {
        resolvedAdmissionDoc = await IPDAdmission.findOne({
          patient: resolvedPatientId,
          status: { $in: ["Active", "Admitted", "In Treatment", "Discharge Initiated"] }
        }).sort({ createdAt: -1 }).session(session);
      }
      if (resolvedAdmissionDoc) {
        resolvedAdmissionId = resolvedAdmissionDoc.admissionId;
        if (!resolvedPatientId) resolvedPatientId = resolvedAdmissionDoc.patient;
      }
    }

    const resolvedPrescriptionSource = orderId ? "DOCTOR_DIGITAL" : "DIRECT_PHARMACY";

    const invoice = await PharmaInvoice.create(
      [
        {
          ...req.body,
          patient: isWalkIn ? undefined : (resolvedPatientId || pat?._id || undefined),
          patientType: isWalkIn ? "Walk-in" : (isIPDPatient ? "IPD" : (req.body.patientType || "OPD")),
          isIPD: isWalkIn ? false : Boolean(isIPDPatient),
          isWalkIn: Boolean(isWalkIn),
          admission: isWalkIn ? undefined : (resolvedAdmissionDoc?._id || undefined),
          admissionId: isWalkIn ? undefined : (resolvedAdmissionId || undefined),
          appointmentId: isWalkIn ? undefined : (req.body.appointmentId || undefined),
          mrn: isWalkIn ? "N/A" : (resolvedMrn || req.body.mrn || "N/A"),
          honorific: resolvedHonorific || req.body.honorific || "",
          invoiceNo,
          items: processedItems,
          subTotal,
          discountTotal,
          taxTotal,
          netPayable,
          roundOff: Math.round(roundOff * 100) / 100,
          pharmacy: pharmacyId,
          hospital: hospitalId,
          createdBy: userId,
          prescriptionSource: resolvedPrescriptionSource,
          orderId: orderId || undefined,
          status,
          mode,
          paid: status === "PAID" ? netPayable : (paymentSummary?.paidAmount || 0),
          balance: status === "PAID" ? 0 : (paymentSummary?.balanceDue ?? (netPayable - (paymentSummary?.paidAmount || 0))),
        },
      ],
      { session },
    );

    // If linked to an active IPD admission, sync into IPDExtraCharge with detailed medicine items
    if (!isWalkIn && resolvedAdmissionDoc) {
      const IPDExtraCharge = (await import("../../IPD/Models/IPDExtraCharge.js")).default;
      await IPDExtraCharge.create(
        [
          {
            patient: resolvedAdmissionDoc.patient,
            admission: resolvedAdmissionDoc._id,
            hospital: hospitalId,
            category: "Pharmacy",
            description: `Pharmacy Bill (${invoiceNo})`,
            amount: invoice[0].netPayable,
            medicines: processedItems.map(it => ({
              medicineName: it.productName,
              rate: it.unitRate || it.mrp || 0,
              quantity: it.qty,
              amount: it.amount,
              batchNo: it.batchNo,
              expiryDate: it.expiryDate
            })),
            isPharmaOrder: true,
            prescriptionSource: resolvedPrescriptionSource,
            orderId: orderId || undefined,
            date: new Date(),
            addedBy: userId,
            status: "Active"
          }
        ],
        { session }
      );

      // If counter payment was made, record in IPDAdvancePayment so frontdesk billing immediately tracks it
      if (invoice[0].paid > 0) {
        const IPDAdvancePayment = (await import("../../IPD/Models/IPDAdvancePayment.js")).default;
        await IPDAdvancePayment.create(
          [
            {
              patient: resolvedAdmissionDoc.patient,
              admission: resolvedAdmissionDoc._id,
              hospital: hospitalId,
              amount: invoice[0].paid,
              mode: mode.toUpperCase() === "MIXED" ? "Mixed" : (mode.toUpperCase() === "UPI" ? "UPI" : (mode.toUpperCase() === "CARD" ? "Card" : "Cash")),
              paymentDetails: paymentDetails || {},
              reference: invoiceNo,
              receiptNumber: invoiceNo,
              transactionType: "Advance",
              date: new Date(),
              receivedBy: userId,
              notes: `Paid at Pharmacy Counter (${invoiceNo})`
            }
          ],
          { session }
        );
      }
    }

    // Global Revenue Transaction
    if (invoice[0].paid > 0) {
      await Transaction.create(
        [
          {
            user: userId,
            hospital: hospitalId,
            amount: invoice[0].paid,
            type: "pharmacy",
            status: "completed",
            paymentMode: mode.toLowerCase(),
            referenceId: invoice[0]._id,
            receiptNumber: invoiceNo,
            invoiceNumber: invoiceNo,
            date: new Date(),
          },
        ],
        { session },
      );
    }

    // Audit Log
    await PharmaAuditLog.create(
      [
        {
          action: "INVOICE_CREATED",
          userId,
          userName: req.user.name,
          userEmail: req.user.email,
          resourceType: "Invoice",
          resourceId: invoice[0]._id,
          details: {
            invoiceNo: invoice[0].invoiceNo,
            amount: invoice[0].netPayable,
          },
          hospital: hospitalId,
          pharmacy: pharmacyId,
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        },
      ],
      { session },
    );

    // If this bill came from an active pharmacy order, mark it as completed
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      console.log(
        `✅ Completing pharmacy order: ${orderId} for invoice: ${invoice[0].invoiceNo}`,
      );
      await PharmacyOrder.findByIdAndUpdate(orderId, {
        status: "completed",
        invoiceId: invoice[0]._id,
      }).session(session);

      // Emit real-time update to hospital room to remove from active lists everywhere
      const io = req.app.get("io");
      if (io && hospitalId) {
        io.to(`hospital_${hospitalId?.toString()}`).emit(
          "pharmacy_order_completed",
          orderId,
        );
      }
    }

    await session.commitTransaction();

    // 🚀 PERFORMANCE OPTIMIZATION: Invalidate dashboard cache variants for real-time updates
    const cacheBase = `pharma:dashboard:stats:${pharmacyId}`;
    await Promise.all([
      redisService.del(`${cacheBase}:today::`),
      redisService.del(`${cacheBase}:7days::`),
      redisService.del(`${cacheBase}:1month::`),
      redisService.del(`${cacheBase}:::`), // Default/Month
    ]);

    res.status(201).json({ success: true, data: invoice[0] });
  } catch (error: any) {
    await session.abortTransaction();
    res.status(500).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const returnInvoiceItems = async (req: PharmaRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const pharmacyId = req.pharma?._id;
    const hospitalId = req.pharma?.hospital;
    const userId = req.user._id;
    const { returnItems, refundMode } = req.body;
    
    if (!returnItems || !Array.isArray(returnItems) || returnItems.length === 0) {
      return res.status(400).json({ success: false, message: "No items provided for return" });
    }

    const invoice = await PharmaInvoice.findOne({
      _id: id,
      pharmacy: pharmacyId,
    }).session(session);

    if (!invoice) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    if (invoice.status === "RETURN") {
      return res.status(400).json({ success: false, message: "Invoice is already fully returned" });
    }

    let totalRefundAmount = 0;
    const updatedItems = [...invoice.items];

    for (const returnItem of returnItems) {
      const { drugId, returnQty } = returnItem;
      const parsedReturnQty = Number(returnQty);

      if (parsedReturnQty <= 0) continue;

      const itemIndex = updatedItems.findIndex((item: any) => item.drug.toString() === drugId);
      if (itemIndex === -1) {
        throw new Error(`Drug ${drugId} not found in this invoice`);
      }

      const item = updatedItems[itemIndex];
      const maxReturnable = item.qty - (item.returnedQty || 0);

      if (parsedReturnQty > maxReturnable) {
        throw new Error(`Cannot return more than purchased/remaining for ${item.productName}`);
      }

      const unitRefund = item.amount / item.qty;
      const refundAmount = unitRefund * parsedReturnQty;
      totalRefundAmount += refundAmount;

      updatedItems[itemIndex].returnedQty = (item.returnedQty || 0) + parsedReturnQty;

      // RESTORE STOCK
      const product = await Product.findById(drugId).select("unitsPerPack").session(session);
      const unitsPerPack = product?.unitsPerPack || 1;
      const returnedPacks = parsedReturnQty / unitsPerPack;

      await Product.updateOne(
        { _id: drugId },
        { $inc: { stock: returnedPacks } },
      ).session(session);

      let remainingToRestore = returnedPacks;
      const batches = await Batch.find({
        product: drugId,
        qtySold: { $gt: 0 },
      })
        .sort({ expiry: 1, grnDate: 1 })
        .session(session);

      for (const batch of batches) {
        if (remainingToRestore <= 0) break;
        const toRestore = Math.min(remainingToRestore, batch.qtySold);
        batch.qtySold -= toRestore;
        // @ts-ignore
        await batch.save({ session });
        remainingToRestore -= toRestore;
      }
    }

    if (totalRefundAmount === 0) {
       throw new Error("No valid return quantities processed");
    }

    invoice.items = updatedItems;
    invoice.netPayable -= totalRefundAmount;
    invoice.paid -= totalRefundAmount;
    invoice.subTotal -= totalRefundAmount;
    
    const isFullyReturned = updatedItems.every((item: any) => (item.returnedQty || 0) === item.qty);
    if (isFullyReturned) {
      invoice.status = "RETURN";
    }

    await invoice.save({ session });

    await Transaction.create(
      [
        {
          user: userId,
          hospital: hospitalId,
          amount: -totalRefundAmount,
          type: "pharmacy",
          status: "completed",
          paymentMode: (refundMode || invoice.mode || "cash").toLowerCase(),
          transactionType: "DEBIT",
          referenceId: invoice._id,
          date: new Date(),
        },
      ],
      { session },
    );

    await PharmaAuditLog.create(
      [
        {
          action: "INVOICE_RETURNED",
          userId,
          userName: req.user.name,
          userEmail: req.user.email,
          resourceType: "Invoice",
          resourceId: invoice._id,
          details: { invoiceNo: invoice.invoiceNo, refundAmount: totalRefundAmount },
          hospital: hospitalId,
          pharmacy: pharmacyId,
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        },
      ],
      { session },
    );

    await session.commitTransaction();

    const cacheBase = `pharma:dashboard:stats:${pharmacyId}`;
    await Promise.all([
      redisService.del(`${cacheBase}:today::`),
      redisService.del(`${cacheBase}:7days::`),
      redisService.del(`${cacheBase}:1month::`),
      redisService.del(`${cacheBase}:::`),
    ]);

    // Emit real-time event for admin panel live updates
    const io = req.app.get("io");
    if (io && hospitalId) {
      io.to(`hospital_${hospitalId?.toString()}`).emit("general_return_processed", {
        invoiceId: invoice._id,
        invoiceNo: invoice.invoiceNo,
        refundAmount: totalRefundAmount,
      });
    }

    res.json({ success: true, message: "Items returned successfully", refundAmount: totalRefundAmount, invoice });
  } catch (error: any) {
    await session.abortTransaction();
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

import ExcelJS from "exceljs";
import Supplier from "../Models/Supplier.js";

export const exportInvoicesToExcel = async (
  req: PharmaRequest,
  res: Response,
) => {
  try {
    const pharmacyId = req.pharma?._id;
    const invoices = await PharmaInvoice.find({ pharmacy: pharmacyId })
      .sort({ createdAt: -1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Invoices");

    worksheet.columns = [
      { header: "Invoice #", key: "invoiceNo", width: 20 },
      { header: "Date", key: "date", width: 15 },
      { header: "Patient Name", key: "patientName", width: 20 },
      { header: "Phone", key: "customerPhone", width: 15 },
      { header: "SubTotal", key: "subTotal", width: 12 },
      { header: "Discount", key: "discountTotal", width: 12 },
      { header: "Tax", key: "taxTotal", width: 12 },
      { header: "Net Payable", key: "netPayable", width: 12 },
      { header: "Paid", key: "paid", width: 12 },
      { header: "Mode", key: "mode", width: 10 },
      { header: "Status", key: "status", width: 10 },
    ];

    invoices.forEach((inv: any) => {
      worksheet.addRow({
        invoiceNo: inv.invoiceNo,
        date: new Date(inv.createdAt).toLocaleDateString(),
        patientName: inv.patientName,
        customerPhone: inv.customerPhone || "N/A",
        subTotal: inv.subTotal,
        discountTotal: inv.discountTotal,
        taxTotal: inv.taxTotal,
        netPayable: inv.netPayable,
        paid: inv.paid,
        mode: inv.mode,
        status: inv.status,
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=invoices.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteInvoice = async (req: PharmaRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const pharmacyId = req.pharma?._id;
    const userId = req.user._id;
    const hospitalId = req.pharma?.hospital;

    // Find the invoice
    const invoice = await PharmaInvoice.findOne({
      _id: id,
      pharmacy: pharmacyId,
    }).session(session);

    if (!invoice) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Invoice not found" });
    }

    // RESTORE STOCK (using atomic $inc)
    for (const item of invoice.items) {
      const product = await Product.findById(item.drug).select("unitsPerPack");
      const unitsPerPack = product?.unitsPerPack || 1;
      const returnedPacks = item.qty / unitsPerPack;

      await Product.updateOne(
        { _id: item.drug },
        { $inc: { stock: returnedPacks } },
      ).session(session);

      // Restore batch quantities (FIFO reversal)
      let remainingToRestore = returnedPacks;

      const batches = await Batch.find({
        product: item.drug,
        qtySold: { $gt: 0 },
      })
        .sort({ expiry: 1, grnDate: 1 })
        .session(session);

      for (const batch of batches) {
        if (remainingToRestore <= 0) break;

        const toRestore = Math.min(remainingToRestore, batch.qtySold);
        batch.qtySold -= toRestore;
        // @ts-ignore
        await batch.save({ session });
        remainingToRestore -= toRestore;
      }
    }

    // Delete the invoice
    await PharmaInvoice.findByIdAndDelete(id).session(session);

    // Audit Log
    await PharmaAuditLog.create(
      [
        {
          action: "INVOICE_DELETED",
          userId,
          userName: req.user.name,
          userEmail: req.user.email,
          resourceType: "Invoice",
          resourceId: invoice._id,
          details: { invoiceNo: invoice.invoiceNo, amount: invoice.netPayable },
          hospital: hospitalId,
          pharmacy: pharmacyId,
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        },
      ],
      { session },
    );

    await session.commitTransaction();

    // Invalidate dashboard cache variants for real-time updates
    const cacheBase = `pharma:dashboard:stats:${pharmacyId}`;
    await Promise.all([
      redisService.del(`${cacheBase}:today::`),
      redisService.del(`${cacheBase}:7days::`),
      redisService.del(`${cacheBase}:1month::`),
      redisService.del(`${cacheBase}:::`),
    ]);

    res.json({ success: true, message: "Invoice deleted successfully" });
  } catch (error: any) {
    await session.abortTransaction();
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const updateInvoicePatient = async (req: PharmaRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      patientName,
      customerPhone,
      patientAddress,
      patientType,
      doctorName,
      mrn,
      honorific,
      mode,
      status,
      paid,
      balance,
      items,
      subTotal,
      taxTotal,
      netPayable,
      paymentDetails,
    } = req.body;

    let invoice = await PharmaInvoice.findById(id);
    let ipdIssuance: any = null;

    if (!invoice) {
      ipdIssuance = await IPDMedicineIssuance.findById(id);
    }
    if (!invoice && !ipdIssuance) {
      invoice = await PharmaInvoice.findOne({ invoiceNo: id });
      if (!invoice) {
        ipdIssuance = await IPDMedicineIssuance.findOne({ invoiceNo: id });
      }
    }

    if (!invoice && !ipdIssuance) {
      return res.status(404).json({ success: false, message: "Invoice / Bill record not found" });
    }

    if (invoice) {
      if (patientName !== undefined) invoice.patientName = String(patientName).trim();
      if (customerPhone !== undefined) invoice.customerPhone = String(customerPhone).trim();
      if (patientAddress !== undefined) invoice.patientAddress = String(patientAddress).trim();
      if (patientType !== undefined) invoice.patientType = String(patientType).trim();
      if (doctorName !== undefined) invoice.doctorName = String(doctorName).trim();
      if (mrn !== undefined) invoice.mrn = String(mrn).trim();
      if (honorific !== undefined) invoice.honorific = String(honorific).trim();

      // Payment Details
      if (mode !== undefined) invoice.mode = mode.toUpperCase() as any;
      if (status !== undefined) invoice.status = status.toUpperCase() as any;
      if (paymentDetails !== undefined) invoice.paymentDetails = paymentDetails;

      // Medicine Line Items
      if (Array.isArray(items) && items.length > 0) {
        invoice.items = items.map((it: any) => ({
          drug: it.drug || it.productId || it._id,
          batch: it.batch,
          batchNo: it.batchNo || it.batch || "",
          expiryDate: it.expiryDate || it.expiry || "",
          productName: it.productName || it.itemName || it.name || it.medicineName || it.brandName || it.brand || "",
          qty: Number(it.qty || 1),
          freeQty: Number(it.freeQty || 0),
          unitRate: Number(it.unitRate || it.rate || it.mrp || 0),
          mrp: Number(it.mrp || it.unitRate || 0),
          discountType: it.discountType || "PERCENTAGE",
          discountValue: Number(it.discountValue || 0),
          gstPct: Number(it.gstPct || it.gst || 0),
          hsnCode: it.hsnCode || "",
          amount: Number(it.amount || ((it.qty || 1) * (it.unitRate || it.rate || 0)))
        }));

        const calculatedSubTotal = subTotal !== undefined ? Number(subTotal) : invoice.items.reduce((sum, it) => sum + it.amount, 0);
        invoice.subTotal = calculatedSubTotal;
        if (taxTotal !== undefined) invoice.taxTotal = Number(taxTotal);
        invoice.netPayable = netPayable !== undefined ? Number(netPayable) : Math.round(calculatedSubTotal + (invoice.taxTotal || 0));

        if (status === "PAID" || invoice.status === "PAID") {
          invoice.paid = invoice.netPayable;
          invoice.balance = 0;
        } else if (paid !== undefined) {
          invoice.paid = Number(paid);
          invoice.balance = Math.max(0, invoice.netPayable - Number(paid));
        } else {
          invoice.balance = invoice.netPayable;
          invoice.paid = 0;
        }
      } else {
        if (status === "PAID") {
          invoice.paid = invoice.netPayable;
          invoice.balance = 0;
        } else if (paid !== undefined) {
          invoice.paid = Number(paid);
          if (balance !== undefined) {
            invoice.balance = Number(balance);
          } else {
            invoice.balance = Math.max(0, (invoice.netPayable || 0) - Number(paid));
          }
        }
      }

      invoice.isEdited = true;
      invoice.editedAt = new Date();
      if (req.user?._id) {
        invoice.editedBy = req.user._id;
      }

      await invoice.save();

      // Financial Transaction Sync (Hospital Admin and Frontdesk Reports)
      const Transaction = mongoose.model("Transaction");
      if (invoice.status === "PAID" && invoice.paid > 0) {
        await Transaction.findOneAndUpdate(
          {
            $or: [
              { invoiceId: invoice._id },
              { invoiceNumber: invoice.invoiceNo },
              { referenceId: invoice._id }
            ]
          },
          {
            $set: {
              source: "PHARMACY",
              type: "pharmacy",
              patientName: invoice.patientName,
              customerPhone: invoice.customerPhone,
              amount: invoice.paid,
              paymentMode: invoice.mode,
              status: "completed",
              date: invoice.createdAt || new Date(),
              hospital: invoice.hospital,
              invoiceId: invoice._id,
              invoiceNumber: invoice.invoiceNo,
              updatedAt: new Date()
            }
          },
          { upsert: true, new: true }
        );
      } else if (invoice.status === "PENDING" || invoice.paid === 0) {
        await Transaction.deleteOne({
          $or: [
            { invoiceId: invoice._id },
            { invoiceNumber: invoice.invoiceNo },
            { referenceId: invoice._id }
          ]
        });
      }

      // If linked to IPD admission, update IPDAdvancePayment and IPDExtraCharge
      if (invoice.isIPD || invoice.admission) {
        const IPDExtraCharge = mongoose.model("IPDExtraCharge");
        const IPDAdvancePayment = mongoose.model("IPDAdvancePayment");

        const admDoc = await IPDAdmission.findOne({
          $or: [
            ...(invoice.admission && mongoose.Types.ObjectId.isValid(invoice.admission) ? [{ _id: invoice.admission }] : []),
            ...(invoice.admissionId ? [{ admissionId: invoice.admissionId }] : [])
          ]
        });

        // Sync Advance Payment at Frontdesk
        if (admDoc) {
          if (invoice.status === "PAID" && invoice.paid > 0) {
            await IPDAdvancePayment.findOneAndUpdate(
              {
                admission: admDoc._id,
                reference: invoice.invoiceNo
              },
              {
                $set: {
                  patient: admDoc.patient,
                  admission: admDoc._id,
                  hospital: invoice.hospital || admDoc.hospital,
                  amount: invoice.paid,
                  mode: invoice.mode === "MIXED" ? "Mixed" : (invoice.mode === "UPI" ? "UPI" : (invoice.mode === "CARD" ? "Card" : "Cash")),
                  paymentDetails: invoice.paymentDetails || {},
                  reference: invoice.invoiceNo,
                  receiptNumber: invoice.invoiceNo,
                  transactionType: "Advance",
                  date: invoice.createdAt || new Date(),
                  receivedBy: req.user?._id || invoice.createdBy,
                  notes: `Paid at Pharmacy Counter (${invoice.invoiceNo})`
                }
              },
              { upsert: true, new: true }
            );
          } else {
            await IPDAdvancePayment.deleteOne({
              admission: admDoc._id,
              reference: invoice.invoiceNo
            });
          }
        }

        // Sync Extra Charges
        await IPDExtraCharge.findOneAndUpdate(
          {
            $or: [
              { description: { $regex: invoice.invoiceNo, $options: "i" } },
              { invoiceId: invoice._id }
            ]
          },
          {
            $set: {
              amount: invoice.netPayable,
              medicines: invoice.items.map((it: any) => ({
                medicineName: it.productName,
                rate: it.unitRate,
                quantity: it.qty,
                amount: it.amount,
                batchNo: it.batchNo,
                expiryDate: it.expiryDate
              }))
            }
          }
        );
      }

      return res.json({
        success: true,
        message: "Invoice and financial details updated successfully",
        data: invoice,
      });
    }

    if (ipdIssuance) {
      if (patientName !== undefined) ipdIssuance.patientName = String(patientName).trim();
      if (customerPhone !== undefined) ipdIssuance.customerPhone = String(customerPhone).trim();
      if (status !== undefined) {
        ipdIssuance.status = status === "PAID" ? "CLOSED" : "ISSUED";
      }
      if (mode !== undefined) ipdIssuance.mode = mode.toUpperCase();
      if (paid !== undefined) ipdIssuance.paid = Number(paid);
      if (balance !== undefined) ipdIssuance.balance = Number(balance);
      if (paymentDetails !== undefined) ipdIssuance.paymentDetails = paymentDetails;

      if (Array.isArray(items) && items.length > 0) {
        const existingItems = ipdIssuance.items || [];
        ipdIssuance.items = items.map((it: any, idx: number) => {
          const existingItem = existingItems[idx] || existingItems.find((ex: any) => 
            (ex.productName && it.productName && ex.productName.toLowerCase() === it.productName.toLowerCase())
          );

          const rawProduct = it.drug || it.productId || it.product || existingItem?.product;
          const validProduct = (rawProduct && mongoose.Types.ObjectId.isValid(rawProduct)) ? new mongoose.Types.ObjectId(rawProduct) : undefined;

          const rawBatch = it.batch || it.batchId || existingItem?.batch;
          const validBatch = (rawBatch && mongoose.Types.ObjectId.isValid(rawBatch)) ? new mongoose.Types.ObjectId(rawBatch) : undefined;

          const qty = Number(it.qty || it.issuedQty || 1);
          const rate = Number(it.unitRate || it.rate || 0);
          const totalAmt = Number(it.amount !== undefined ? it.amount : (qty * rate));

          return {
            product: (validProduct || new mongoose.Types.ObjectId()) as any,
            batch: (validBatch || new mongoose.Types.ObjectId()) as any,
            productName: it.productName || it.itemName || it.name || it.medicineName || existingItem?.productName || "",
            batchNo: (it.batchNo || it.batch || existingItem?.batchNo || "").toString(),
            issuedQty: qty,
            returnedQty: Number(it.returnedQty || existingItem?.returnedQty || 0),
            unitRate: Math.round(rate * 100) / 100,
            totalAmount: Math.round(totalAmt * 100) / 100,
            frequency: it.frequency || existingItem?.frequency,
          };
        });
        ipdIssuance.totalAmount = ipdIssuance.items.reduce((s: number, i: any) => s + (i.totalAmount || 0), 0);
      }
      ipdIssuance.updatedAt = new Date();
      await ipdIssuance.save();

      const admDoc = await IPDAdmission.findOne({
        $or: [
          ...(ipdIssuance.admission && mongoose.Types.ObjectId.isValid(ipdIssuance.admission) ? [{ _id: ipdIssuance.admission }] : []),
          ...(ipdIssuance.admissionId ? [{ admissionId: ipdIssuance.admissionId }] : [])
        ]
      });

      const Transaction = mongoose.model("Transaction");
      const IPDAdvancePayment = mongoose.model("IPDAdvancePayment");
      const IPDExtraCharge = mongoose.model("IPDExtraCharge");

      const invNo = ipdIssuance.invoiceNo || ipdIssuance.admissionId;
      const isPaid = status === "PAID" || ipdIssuance.status === "CLOSED";
      const paidAmt = Number(paid !== undefined ? paid : (isPaid ? ipdIssuance.totalAmount : 0));

      if (isPaid && paidAmt > 0) {
        // Upsert Financial Transaction
        await Transaction.findOneAndUpdate(
          {
            $or: [
              { invoiceNumber: invNo },
              { referenceId: ipdIssuance._id }
            ]
          },
          {
            $set: {
              source: "PHARMACY",
              type: "pharmacy",
              patientName: ipdIssuance.patientName,
              customerPhone: ipdIssuance.customerPhone,
              amount: paidAmt,
              paymentMode: (mode || ipdIssuance.mode || "CASH").toUpperCase(),
              status: "completed",
              date: ipdIssuance.issuedAt || new Date(),
              hospital: ipdIssuance.hospital,
              invoiceNumber: invNo,
              referenceId: ipdIssuance._id,
              updatedAt: new Date()
            }
          },
          { upsert: true, new: true }
        );

        // Upsert IPDAdvancePayment so Frontdesk transaction reports and IPDBillingModal immediately see it as a counter payment
        if (admDoc) {
          await IPDAdvancePayment.findOneAndUpdate(
            {
              admission: admDoc._id,
              reference: invNo
            },
            {
              $set: {
                patient: admDoc.patient,
                admission: admDoc._id,
                hospital: ipdIssuance.hospital || admDoc.hospital,
                amount: paidAmt,
                mode: (mode || "CASH").toUpperCase() === "MIXED" ? "Mixed" : ((mode || "CASH").toUpperCase() === "UPI" ? "UPI" : ((mode || "CASH").toUpperCase() === "CARD" ? "Card" : "Cash")),
                paymentDetails: paymentDetails || {},
                reference: invNo,
                receiptNumber: invNo,
                transactionType: "Advance",
                date: ipdIssuance.issuedAt || new Date(),
                receivedBy: req.user?._id || ipdIssuance.issuedBy,
                notes: `Paid at Pharmacy Counter (${invNo})`
              }
            },
            { upsert: true, new: true }
          );
        }
      } else {
        // Remove Transaction and IPDAdvancePayment if marked as PENDING / UNPAID
        await Transaction.deleteOne({
          $or: [
            { invoiceNumber: invNo },
            { referenceId: ipdIssuance._id }
          ]
        });

        if (admDoc) {
          await IPDAdvancePayment.deleteOne({
            admission: admDoc._id,
            reference: invNo
          });
        }
      }

      // Update IPDExtraCharge so medicine charges in Frontdesk match updated items
      if (admDoc) {
        await IPDExtraCharge.findOneAndUpdate(
          {
            admission: admDoc._id,
            $or: [
              { description: { $regex: invNo, $options: "i" } },
              { _id: ipdIssuance._id }
            ]
          },
          {
            $set: {
              amount: ipdIssuance.totalAmount,
              medicines: (ipdIssuance.items || []).map((it: any) => ({
                medicineName: it.productName,
                rate: it.unitRate,
                quantity: it.issuedQty,
                amount: it.totalAmount,
                batchNo: it.batchNo
              }))
            }
          }
        );
      }

      return res.json({
        success: true,
        message: "IPD Issuance details and Frontdesk payments synchronized successfully",
        data: ipdIssuance,
      });
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Check eligibility and admissions for transferring an invoice between OPD and IPD
 * GET /pharmacy/invoices/:id/check-transfer
 */
export const checkTransferEligibility = async (req: PharmaRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hospitalId = req.pharma?.hospital || req.headers["x-hospital-id"];

    let invoice = await PharmaInvoice.findById(id).populate("patient", "name honorific mobile");
    let ipdIssuance: any = null;
    if (!invoice) {
      ipdIssuance = await IPDMedicineIssuance.findById(id)
        .populate("patient", "name honorific mobile")
        .populate({
          path: "admission",
          select: "patient primaryDoctor",
          populate: { path: "patient", select: "name honorific mobile" }
        });
    }

    if (!invoice && !ipdIssuance) {
      invoice = await PharmaInvoice.findOne({ invoiceNo: id }).populate("patient", "name honorific mobile");
      if (!invoice) {
        ipdIssuance = await IPDMedicineIssuance.findOne({ invoiceNo: id })
          .populate("patient", "name honorific mobile")
          .populate({
            path: "admission",
            select: "patient primaryDoctor",
            populate: { path: "patient", select: "name honorific mobile" }
          });
      }
    }

    if (!invoice && !ipdIssuance) {
      return res.status(404).json({ success: false, message: "Invoice / Bill not found" });
    }

    // Resolve patient name & mobile thoroughly
    let patientName = invoice?.patientName;
    let patientPhone = invoice?.customerPhone;

    if (!patientName || patientName === "Patient" || patientName === "IPD Patient") {
      const patObj: any = (invoice?.patient as any) || (ipdIssuance?.patient as any) || (ipdIssuance?.admission as any)?.patient;
      if (patObj?.name) {
        patientName = patObj.honorific ? `${patObj.honorific} ${patObj.name}` : patObj.name;
      }
    }
    if (!patientName) patientName = "Patient";

    if (!patientPhone || patientPhone === "-") {
      const patObj: any = (invoice?.patient as any) || (ipdIssuance?.patient as any) || (ipdIssuance?.admission as any)?.patient;
      if (patObj?.mobile) patientPhone = patObj.mobile;
    }

    const currentType = (invoice?.patientType || (ipdIssuance ? (ipdIssuance.isTransferredToOPD ? "OPD" : "IPD") : "OPD")).toUpperCase();

    const cleanPhone = (patientPhone || "").replace(/[^0-9]/g, "").slice(-10);
    const patientFilter: any[] = [];
    if (invoice?.patient) patientFilter.push({ patient: (invoice.patient as any)?._id || invoice.patient });
    if (ipdIssuance?.patient) patientFilter.push({ patient: (ipdIssuance.patient as any)?._id || ipdIssuance.patient });

    if (cleanPhone) {
      const pat = await Patient.findOne({ mobile: cleanPhone });
      if (pat) patientFilter.push({ patient: pat._id });
    }

    let admissions: any[] = [];
    if (patientFilter.length > 0) {
      admissions = await IPDAdmission.find({
        hospital: hospitalId,
        $or: patientFilter
      })
        .populate({ path: "primaryDoctor", populate: { path: "user", select: "name" } })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
    }

    const consequences: string[] = [];
    if (currentType === "OPD") {
      consequences.push("Ledger: Transfers to Inpatient Stay bill");
      consequences.push("Revenue: Shifts to IPD Pharmacy Analytics");
      consequences.push("Patient App: Shown under Inpatient Stay");
      consequences.push("Discharge: Added to IPD clearance folio");
    } else {
      consequences.push("Ledger: Converts to OPD Counter receipt");
      consequences.push("Revenue: Shifts to OPD Pharmacy Analytics");
      consequences.push("Patient App: Shown under OPD Receipts");
      consequences.push("Inpatient: Deducted from IPD admission folio");
    }

    return res.json({
      success: true,
      currentType,
      patientName,
      customerPhone: patientPhone || "-",
      amount: invoice?.netPayable || ipdIssuance?.totalAmount || 0,
      invoiceNo: invoice?.invoiceNo || ipdIssuance?.invoiceNo || ipdIssuance?.admissionId,
      admissions: admissions.map((a: any) => ({
        _id: a._id,
        admissionId: a.admissionId,
        status: a.status,
        paymentStatus: a.paymentStatus,
        admissionDate: a.admissionDate || a.createdAt,
        dischargeDate: a.dischargeDate,
        doctorName: (a.primaryDoctor as any)?.user?.name || "Attending Doctor",
        roomNo: a.roomNo || a.bed?.roomNo || "General Ward"
      })),
      hasAdmissions: admissions.length > 0,
      consequences
    });
  } catch (error: any) {
    console.error("checkTransferEligibility error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to check transfer eligibility" });
  }
};

/**
 * Transfer an invoice between OPD and IPD
 * POST /pharmacy/invoices/:id/transfer-type
 * Body: { targetType: "OPD" | "IPD", admissionId?: string }
 */
export const transferInvoiceType = async (req: PharmaRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { targetType, admissionId } = req.body;

    if (!targetType || !["OPD", "IPD"].includes(targetType.toUpperCase())) {
      return res.status(400).json({ success: false, message: "Target type must be 'OPD' or 'IPD'" });
    }

    const normalizedTarget = targetType.toUpperCase();
    const hospitalId = req.pharma?.hospital || req.headers["x-hospital-id"];

    // Find invoice in PharmaInvoice or IPDMedicineIssuance
    let invoice = await PharmaInvoice.findById(id);
    let ipdIssuance: any = null;

    if (!invoice) {
      ipdIssuance = await IPDMedicineIssuance.findById(id);
    }

    if (!invoice && !ipdIssuance) {
      invoice = await PharmaInvoice.findOne({ invoiceNo: id });
      if (!invoice) {
        ipdIssuance = await IPDMedicineIssuance.findOne({ invoiceNo: id });
      }
    }

    if (!invoice && !ipdIssuance) {
      return res.status(404).json({ success: false, message: "Invoice / Bill record not found" });
    }

    // Current type
    const currentType = (invoice?.patientType || (ipdIssuance ? (ipdIssuance.isTransferredToOPD ? "OPD" : "IPD") : "OPD")).toUpperCase();
    if (currentType === normalizedTarget) {
      return res.status(400).json({ success: false, message: `Bill is already of type ${normalizedTarget}` });
    }

    if (normalizedTarget === "IPD") {
      // Transferring OPD -> IPD
      let admission: any = null;
      if (admissionId) {
        admission = await IPDAdmission.findOne({
          $or: [
            ...(mongoose.Types.ObjectId.isValid(admissionId) ? [{ _id: new mongoose.Types.ObjectId(admissionId) }] : []),
            { admissionId: admissionId }
          ]
        });
      }

      // If no admissionId provided, auto-detect active admission for this patient
      if (!admission) {
        const patientPhone = (invoice?.customerPhone || ipdIssuance?.customerPhone || "").replace(/[^0-9]/g, "").slice(-10);
        const patientObjId = invoice?.patient || ipdIssuance?.patient;

        const patientFilter: any[] = [];
        if (patientObjId) patientFilter.push({ patient: patientObjId });
        if (patientPhone) {
          const pat = await Patient.findOne({ mobile: patientPhone });
          if (pat) patientFilter.push({ patient: pat._id });
        }

        if (patientFilter.length > 0) {
          admission = await IPDAdmission.findOne({
            hospital: hospitalId,
            $or: patientFilter,
            status: { $in: ["Active", "Admitted", "In Treatment", "Discharge Initiated"] }
          }).sort({ createdAt: -1 });

          if (!admission) {
            admission = await IPDAdmission.findOne({
              hospital: hospitalId,
              $or: patientFilter
            }).sort({ createdAt: -1 });
          }
        }
      }

      const targetAdmId = admission ? admission.admissionId : (admissionId || "IPD-DIRECT");

      // Update invoice
      if (invoice) {
        invoice.patientType = "IPD";
        invoice.isIPD = true;
        if (admission) {
          invoice.admission = admission._id;
          invoice.admissionId = admission.admissionId;
        } else {
          invoice.admissionId = targetAdmId;
        }
        invoice.isEdited = true;
        invoice.editedAt = new Date();
        if (req.user?._id) invoice.editedBy = req.user._id;
        await invoice.save();
      }

      // If an IPD issuance exists for this invoice, mark it restored in IPD
      const invNo = invoice?.invoiceNo || ipdIssuance?.invoiceNo;
      if (invNo) {
        await IPDMedicineIssuance.updateMany(
          { invoiceNo: invNo },
          { $set: { isTransferredToOPD: false, status: "ISSUED" } }
        );
      }

      // Update linked PharmacyOrder if exists
      const linkedOrder = await PharmacyOrder.findOne({
        $or: [
          ...(invoice?._id ? [{ invoiceId: invoice._id }] : []),
          ...(invoice?.invoiceNo ? [{ tokenNumber: invoice.invoiceNo }] : [])
        ]
      });
      if (linkedOrder) {
        if (admission) linkedOrder.admission = admission._id;
        (linkedOrder as any).patientType = "IPD";
        await linkedOrder.save();
      }

      // Update IPD Admission billed amount if admission is present
      if (admission && invoice && invoice.netPayable) {
        admission.totalBilledAmount = (admission.totalBilledAmount || 0) + invoice.netPayable;
        await admission.save();
      }

      return res.json({
        success: true,
        message: admission
          ? `Transferred to IPD (Admission: ${admission.admissionId})`
          : `Transferred to IPD bill`,
        bill: {
          _id: invoice?._id || ipdIssuance?._id,
          patientType: "IPD",
          admissionId: targetAdmId
        }
      });

    } else {
      // Transferring IPD -> OPD
      let linkedAdmId: any = null;

      // Resolve patient name & mobile thoroughly
      let resolvedPatientName = invoice?.patientName || ipdIssuance?.patientName;
      let resolvedPhone = invoice?.customerPhone || ipdIssuance?.customerPhone;
      let honorific = invoice?.honorific || "";

      let patId = invoice?.patient || ipdIssuance?.patient;
      if (patId) {
        const patDoc = await Patient.findById(patId).lean();
        if (patDoc) {
          resolvedPatientName = patDoc.honorific ? `${patDoc.honorific} ${patDoc.name}` : patDoc.name;
          honorific = patDoc.honorific || "";
          if (!resolvedPhone || resolvedPhone === "-") resolvedPhone = patDoc.mobile || "-";
        }
      }
      if (!resolvedPatientName || resolvedPatientName === "Patient" || resolvedPatientName === "IPD Patient") {
        resolvedPatientName = "Patient";
      }

      if (ipdIssuance) {
        linkedAdmId = ipdIssuance.admission;
        ipdIssuance.isTransferredToOPD = true;
        ipdIssuance.status = "TRANSFERRED_TO_OPD";
        ipdIssuance.transferredAt = new Date();
        await ipdIssuance.save();

        if (ipdIssuance.invoiceNo) {
          await IPDMedicineIssuance.updateMany(
            { invoiceNo: ipdIssuance.invoiceNo },
            { $set: { isTransferredToOPD: true, status: "TRANSFERRED_TO_OPD", transferredAt: new Date() } }
          );
        }

        let existingInv = await PharmaInvoice.findOne({ invoiceNo: ipdIssuance.invoiceNo });
        if (!existingInv) {
          existingInv = new PharmaInvoice({
            invoiceNo: ipdIssuance.invoiceNo || `OPD-${ipdIssuance._id.toString().slice(-8).toUpperCase()}`,
            pharmacy: ipdIssuance.pharmacy,
            hospital: ipdIssuance.hospital || hospitalId,
            patient: ipdIssuance.patient,
            patientName: resolvedPatientName,
            honorific: honorific || undefined,
            customerPhone: resolvedPhone || "-",
            patientType: "OPD",
            isIPD: false,
            items: (ipdIssuance.items || []).map((i: any) => ({
              drug: i.product,
              batch: i.batch,
              batchNo: i.batchNo,
              productName: i.productName || "Medicine",
              qty: i.issuedQty || 1,
              freeQty: i.freeQty || 0,
              unitRate: i.unitRate || 0,
              mrp: i.mrp || i.unitRate || 0,
              discountType: i.discountType || "PERCENTAGE",
              discountValue: i.discountValue || 0,
              gstPct: i.gstPct || i.gst || 0,
              hsnCode: i.hsnCode || "",
              amount: i.totalAmount || 0
            })),
            netPayable: ipdIssuance.totalAmount || 0,
            subTotal: ipdIssuance.totalAmount || 0,
            paid: ipdIssuance.totalAmount || 0,
            balance: 0,
            status: "PAID",
            mode: "CASH",
            createdBy: req.user?._id || ipdIssuance.issuedBy || ipdIssuance.pharmacy
          });
          await existingInv.save();
        } else {
          existingInv.patientName = resolvedPatientName;
          if (honorific) existingInv.honorific = honorific;
          if (resolvedPhone && resolvedPhone !== "-") existingInv.customerPhone = resolvedPhone;
          existingInv.patientType = "OPD";
          existingInv.isIPD = false;
          existingInv.admission = undefined;
          existingInv.admissionId = undefined;
          existingInv.isEdited = true;
          existingInv.editedAt = new Date();
          await existingInv.save();
        }
      }

      if (invoice) {
        linkedAdmId = invoice.admission;
        invoice.patientName = resolvedPatientName;
        if (honorific) invoice.honorific = honorific;
        if (resolvedPhone && resolvedPhone !== "-") invoice.customerPhone = resolvedPhone;
        invoice.patientType = "OPD";
        invoice.isIPD = false;
        invoice.admission = undefined;
        invoice.admissionId = undefined;
        invoice.isEdited = true;
        invoice.editedAt = new Date();
        if (req.user?._id) invoice.editedBy = req.user._id;
        await invoice.save();

        if (invoice.invoiceNo) {
          await IPDMedicineIssuance.updateMany(
            { invoiceNo: invoice.invoiceNo },
            { $set: { isTransferredToOPD: true, status: "TRANSFERRED_TO_OPD", transferredAt: new Date() } }
          );
        }
      }

      // Update linked PharmacyOrder
      const linkedOrder = await PharmacyOrder.findOne({
        $or: [
          ...(invoice?._id ? [{ invoiceId: invoice._id }] : []),
          ...(linkedAdmId ? [{ admission: linkedAdmId }] : [])
        ]
      });
      if (linkedOrder) {
        linkedOrder.admission = undefined;
        (linkedOrder as any).patientType = "OPD";
        await linkedOrder.save();
      }

      // Deduct bill from IPD admission folio
      if (linkedAdmId) {
        const admission = await IPDAdmission.findById(linkedAdmId);
        if (admission) {
          const billAmount = invoice?.netPayable || ipdIssuance?.totalAmount || 0;
          admission.totalBilledAmount = Math.max(0, (admission.totalBilledAmount || 0) - billAmount);
          await admission.save();
        }
      }

      return res.json({
        success: true,
        message: "Successfully transferred bill to OPD counter sale",
        bill: {
          _id: invoice?._id || ipdIssuance?._id,
          patientType: "OPD"
        }
      });
    }
  } catch (error: any) {
    console.error("transferInvoiceType error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to transfer bill type" });
  }
};

