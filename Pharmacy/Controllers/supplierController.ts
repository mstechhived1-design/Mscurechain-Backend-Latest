import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import Supplier from "../Models/Supplier.js";
import Product from "../Models/Product.js";
import Batch from "../Models/Batch.js";

export const getProductsBySupplier = async (
  req: PharmaRequest,
  res: Response,
) => {
  try {
    const products = await Product.find({
      supplier: req.params.id,
      pharmacy: req.pharma?._id,
      isActive: true,
    }).sort({ brand: 1 });

    res.json({
      success: true,
      data: products,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getSuppliers = async (req: PharmaRequest, res: Response) => {
  try {
    const { search, isActive, page, limit } = req.query;
    const pharmacyId = req.pharma?._id;

    if (!pharmacyId) {
      return res.json({
        success: true,
        count: 0,
        total: 0,
        totalPages: 0,
        currentPage: page ? Number(page) : 1,
        data: [],
      });
    }

    let query: any = { pharmacy: pharmacyId };

    if (search) {
      const escapedSearch = (search as string).replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      query.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { phone: { $regex: escapedSearch, $options: "i" } },
        { email: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const isPaginated = page !== undefined || limit !== undefined;
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 10;
    const skip = (pageNum - 1) * limitNum;

    let suppliersQuery = Supplier.find(query).sort({ name: 1 });
    if (isPaginated) {
      suppliersQuery = suppliersQuery.skip(skip).limit(limitNum);
    }

    const [suppliers, total] = await Promise.all([
      suppliersQuery.lean(),
      Supplier.countDocuments(query),
    ]);

    res.json({
      success: true,
      count: suppliers.length,
      total,
      totalPages: isPaginated ? Math.ceil(total / limitNum) : 1,
      currentPage: pageNum,
      data: suppliers,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getSupplier = async (req: PharmaRequest, res: Response) => {
  try {
    const supplier = await Supplier.findOne({
      _id: req.params.id,
      pharmacy: req.pharma?._id,
    });

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    res.json({
      success: true,
      data: supplier,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createSupplier = async (req: PharmaRequest, res: Response) => {
  try {
    const supplier = await Supplier.create({
      ...req.body,
      pharmacy: req.pharma?._id,
      hospital: req.pharma?.hospital,
    });

    res.status(201).json({
      success: true,
      data: supplier,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateSupplier = async (req: PharmaRequest, res: Response) => {
  try {
    const supplier = await Supplier.findOneAndUpdate(
      { _id: req.params.id, pharmacy: req.pharma?._id },
      req.body,
      { new: true, runValidators: true },
    );

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    res.json({
      success: true,
      data: supplier,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteSupplier = async (req: PharmaRequest, res: Response) => {
  try {
    const supplier = await Supplier.findOneAndDelete({
      _id: req.params.id,
      pharmacy: req.pharma?._id,
    });

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    res.json({
      success: true,
      message: "Supplier deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getSupplierPurchases = async (
  req: PharmaRequest,
  res: Response,
) => {
  try {
    const pharmacyId = req.pharma?._id;
    const {
      supplier: supplierId,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

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

    let query: any = { pharmacy: pharmacyId };

    if (supplierId && supplierId !== "all") {
      query.supplier = supplierId;
    }

    if (startDate || endDate) {
      query.grnDate = {};
      if (startDate) query.grnDate.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        query.grnDate.$lte = end;
      }
    }

    if (search) {
      const escapedSearch = (search as string).replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      query.$or = [
        { batchNo: { $regex: escapedSearch, $options: "i" } },
        { invoiceNo: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [batches, total] = await Promise.all([
      Batch.find(query)
        .populate("product", "name brand generic sku mrp form strength")
        .populate("supplier", "name phone email")
        .sort({ grnDate: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Batch.countDocuments(query),
    ]);

    const data = batches.map((batch: any) => ({
      _id: batch._id,
      batchNo: batch.batchNo,
      grnDate: batch.grnDate || batch.createdAt,
      product: batch.product,
      supplier: batch.supplier,
      qtyReceived: batch.qtyReceived,
      qtySold: batch.qtySold,
      unitCost: batch.unitCost,
      unitGst: batch.unitGst || 0,
      totalCost: batch.qtyReceived * batch.unitCost,
      totalWithGst:
        batch.qtyReceived * batch.unitCost +
        batch.qtyReceived * (batch.unitGst || 0),
      expiry: batch.expiry,
      invoiceNo: batch.invoiceNo,
      createdAt: batch.createdAt,
    }));

    res.json({
      success: true,
      count: data.length,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      data,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
