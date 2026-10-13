import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import PharmaInvoice from "../Models/Invoice.js";
import Product from "../Models/Product.js";
import Batch from "../Models/Batch.js";
import PharmaAuditLog from "../Models/AuditLog.js";
import PharmacyOrder from "../Models/PharmacyOrder.js";
import IPDMedicineIssuance from "../Models/IPDMedicineIssuance.js";
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

    let matchStage: any = {
      pharmacy: new mongoose.Types.ObjectId(pharmacyId?.toString()),
    };

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

    if (search) {
      const escapedSearch = (search as string).replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      matchStage.$or = [
        { invoiceNo: { $regex: escapedSearch, $options: "i" } },
        { patientName: { $regex: escapedSearch, $options: "i" } },
        { customerPhone: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    // IPD Issuances use different dates
    let ipdMatchStage: any = {
      pharmacy: new mongoose.Types.ObjectId(pharmacyId?.toString()),
      status: { $in: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"] }
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
      ipdMatchStage.admissionId = { $regex: search as string, $options: "i" };
    }

    const [totalInvoices, invoices, ipdIssuances] = await Promise.all([
      PharmaInvoice.countDocuments(matchStage),
      PharmaInvoice.find(matchStage)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("createdBy", "name email role")
        .populate("items.batch", "batchNo expiry")
        .lean(),
      IPDMedicineIssuance.find(ipdMatchStage)
        .sort({ issuedAt: -1 })
        // Note: For aggregation to work correctly with pagination, 
        // we fetch all relevant for now or handle via pipeline.
        // Assuming reasonably small set for current patient context.
        .populate("patient", "name mobile")
        .populate("issuedBy", "name email")
        .populate("items.batch", "expiry")
        .populate("items.product", "hsnCode")
        .populate({
          path: "admission",
          select: "primaryDoctor",
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

    // Group IPD Issuances by Admission ID to avoid duplicates in transaction list
    const groupedIpdMap = new Map();
    ipdIssuances.forEach((iss: any) => {
      const key = iss.admissionId;
      if (!groupedIpdMap.has(key)) {
        groupedIpdMap.set(key, {
          _id: iss._id,
          invoiceNo: iss.invoiceNo || iss.admissionId,
          patientName: iss.patient?.name || "IPD Patient",
          customerPhone: iss.patient?.mobile || "-",
          netPayable: 0,
          subTotal: 0,
          taxTotal: 0,
          discountTotal: 0,
          status: iss.status === "CLOSED" ? "PAID" : "PENDING",
          mode: "IPD BILLING",
          createdAt: iss.issuedAt,
          updatedAt: iss.updatedAt,
          items: [],
          createdBy: iss.issuedBy,
          doctorName: (iss.admission as any)?.primaryDoctor?.user?.name || "IPD Admission",
          isIPD: true
        });
      }

      const group = groupedIpdMap.get(key);
      group.netPayable += (iss.totalAmount || 0);
      group.subTotal += (iss.totalAmount || 0);

      // Merge items (optional: consolidate similar items or just list all)
      iss.items.forEach((i: any) => {
        group.items.push({
          productName: i.productName,
          qty: i.issuedQty,
          unitRate: i.unitRate,
          amount: i.totalAmount,
          batchNo: i.batchNo || "-",
          expiryDate: i.batch?.expiry,
          hsnCode: i.product?.hsnCode || "-"
        });
      });

      // Update to latest date if needed
      if (new Date(iss.issuedAt) > new Date(group.createdAt)) {
        group.createdAt = iss.issuedAt;
      }
    });

    const mappedIpd = Array.from(groupedIpdMap.values()).map((group: any) => {
      if (group.status === "PAID") {
        group.paid = group.netPayable;
        group.balance = 0;
      } else {
        group.paid = 0;
        group.balance = group.netPayable;
      }
      return group;
    });

    // Merge and sort
    const allRecords = [...invoices, ...mappedIpd].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const paginatedRecords = allRecords.slice(0, Number(limit));
    const total = totalInvoices + mappedIpd.length;

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
    const isMongoIdVal = (val?: string) => typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val);
    if (!resolvedMrn || resolvedMrn === "N/A" || isMongoIdVal(resolvedMrn) || !resolvedHonorific) {
      if (customerPhone) {
        const cleanPhone = customerPhone.replace(/[^0-9]/g, "").slice(-10);
        const Patient = mongoose.model("Patient");
        const PatientProfile = mongoose.model("PatientProfile");

        const pat: any = await Patient.findOne({
          $or: [
            ...(resolvedMrn && !isMongoIdVal(resolvedMrn) ? [{ mrn: resolvedMrn }] : []),
            { mobile: customerPhone },
            { mobile: cleanPhone },
            { mobile: "91" + cleanPhone },
            { mobile: "+91" + cleanPhone }
          ]
        }).session(session).lean();
        if (pat) {
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

    const invoice = await PharmaInvoice.create(
      [
        {
          ...req.body,
          mrn: resolvedMrn || req.body.mrn || "N/A",
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
          status,
          mode,
          paid: status === "PAID" ? netPayable : (paymentSummary?.paidAmount || 0),
          balance: status === "PAID" ? 0 : (paymentSummary?.balanceDue ?? (netPayable - (paymentSummary?.paidAmount || 0))),
        },
      ],
      { session },
    );

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
