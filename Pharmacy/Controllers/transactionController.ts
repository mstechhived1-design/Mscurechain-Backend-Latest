import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import PharmaInvoice from "../Models/Invoice.js";
import Batch from "../Models/Batch.js";
import IPDMedicineIssuance from "../Models/IPDMedicineIssuance.js";

export const getAllTransactions = async (req: PharmaRequest, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      type,
      search,
      page = 1,
      limit = 10,
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

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skipNum = (pageNum - 1) * limitNum;

    let purchaseQuery: any = { pharmacy: pharmacyId };
    let invoiceQuery: any = { pharmacy: pharmacyId };

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }

      purchaseQuery.grnDate = dateFilter;
      invoiceQuery.createdAt = dateFilter;
    }

    const fetchPurchases = !type || type === "all" || type === "purchase";
    const fetchSales = !type || type === "all" || type === "sale";

    if (search) {
      purchaseQuery.$or = [
        { batchNo: { $regex: search, $options: "i" } },
        { invoiceNo: { $regex: search, $options: "i" } },
      ];
      invoiceQuery.$or = [
        { invoiceNo: { $regex: search, $options: "i" } },
        { patientName: { $regex: search, $options: "i" } },
        { customerPhone: { $regex: search, $options: "i" } },
      ];
    }

    // IPD Issuances use different dates
    let ipdQuery: any = { pharmacy: pharmacyId, status: { $in: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"] } };
    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
      ipdQuery.issuedAt = dateFilter;
    }
    if (search) {
       // Since patientName isn't denormalized directly inside IPD (it's populated), search by admissionId
       ipdQuery.$or = [
         { admissionId: { $regex: search, $options: "i" } }
       ]
    }

    // ✅ PERFORMANCE FIX: Fetch enough records to satisfy pagination
    // We fetch (skip + limit) for both to ensure we have the correct top items after merging
    const fetchLimit = skipNum + limitNum;

    const [batches, invoices, ipdIssuances, totalBatches, totalInvoices, totalIpd] = await Promise.all([
      fetchPurchases
        ? Batch.find(purchaseQuery)
            .populate("product", "name brand generic sku mrp")
            .populate("supplier", "name phone email")
            .sort({ grnDate: -1 })
            .limit(fetchLimit)
            .lean()
        : Promise.resolve([]),
      fetchSales
        ? PharmaInvoice.find(invoiceQuery)
            .populate("createdBy", "name email")
            .sort({ createdAt: -1 })
            .limit(fetchLimit)
            .lean()
        : Promise.resolve([]),
      fetchSales
        ? IPDMedicineIssuance.find(ipdQuery)
            .populate("patient", "name mobile")
            .populate("issuedBy", "name email")
            .sort({ issuedAt: -1 })
            .limit(fetchLimit)
            .lean()
        : Promise.resolve([]),
      fetchPurchases ? Batch.countDocuments(purchaseQuery) : Promise.resolve(0),
      fetchSales ? PharmaInvoice.countDocuments(invoiceQuery) : Promise.resolve(0),
      fetchSales ? IPDMedicineIssuance.countDocuments(ipdQuery) : Promise.resolve(0),
    ]);

    // Transform to unified transaction format
    const purchaseTransactions = batches.map((batch: any) => ({
      _id: batch._id,
      type: "PURCHASE",
      date: batch.grnDate || batch.createdAt,
      referenceNo: batch.batchNo,
      invoiceNo: batch.invoiceNo,
      supplier: batch.supplier,
      product: batch.product,
      quantity: batch.qtyReceived,
      amount: batch.qtyReceived * batch.unitCost,
      totalAmount:
        batch.qtyReceived * batch.unitCost +
        batch.qtyReceived * (batch.unitGst || 0),
      paymentMethod: "CASH",
      status: "COMPLETED",
    }));

    const saleTransactions = invoices.map((invoice: any) => ({
      _id: invoice._id,
      type: "SALE",
      orderType: "OPD",
      date: invoice.createdAt,
      referenceNo: invoice.invoiceNo,
      invoiceNo: invoice.invoiceNo,
      customer: {
        name: invoice.patientName,
        phone: invoice.customerPhone,
      },
      amount: invoice.subTotal,
      totalAmount: invoice.netPayable,
      paymentMethod: invoice.mode,
      status: invoice.status,
      createdBy: invoice.createdBy,
    }));

    const ipdTransactions = ipdIssuances.map((issuance: any) => ({
      _id: issuance._id,
      type: "SALE",
      orderType: "IPD",
      date: issuance.issuedAt,
      referenceNo: issuance.admissionId,
      invoiceNo: issuance.admissionId,
      customer: {
        name: issuance.patient?.name || "IPD Patient",
        phone: issuance.patient?.mobile || "N/A",
      },
      amount: issuance.totalAmount,
      totalAmount: issuance.totalAmount,
      paymentMethod: "IPD BILLING",
      status: issuance.status === "CLOSED" ? "PAID" : "PENDING",
      createdBy: issuance.issuedBy,
    }));

    // Merge and sort
    const allTransactions = [...purchaseTransactions, ...saleTransactions, ...ipdTransactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    // Slice for current page
    const paginatedData = allTransactions.slice(skipNum, skipNum + limitNum);
    const total = totalBatches + totalInvoices + totalIpd;

    res.json({
      success: true,
      count: paginatedData.length,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: paginatedData,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
