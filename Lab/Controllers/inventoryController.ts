import { Request, Response } from "express";
import LabInventory from "../Models/LabInventory.js";

// Helper for parsing dates safely
const parseDate = (d: any) => (d ? new Date(d) : undefined);

// Validation helper
const validateInventoryData = (data: any) => {
  const errors: string[] = [];

  if (!data.name || !data.name.trim()) errors.push("Item Name is required");
  if (!data.code || !data.code.trim()) errors.push("Item Code is required");
  if (!data.category) errors.push("Category is required");
  if (!data.unit) errors.push("Unit is required");
  
  if (data.quantity === undefined || data.quantity === null || Number(data.quantity) < 0) {
    errors.push("Quantity cannot be less than 0");
  }
  if (data.purchasePrice === undefined || data.purchasePrice === null || Number(data.purchasePrice) < 0) {
    errors.push("Purchase Price cannot be negative");
  }
  if (data.mrp === undefined || data.mrp === null || Number(data.mrp) < 0) {
    errors.push("MRP cannot be negative");
  } else if (Number(data.mrp) < Number(data.purchasePrice)) {
    errors.push("MRP cannot be less than Purchase Price");
  }
  if (data.reorderLevel === undefined || data.reorderLevel === null || Number(data.reorderLevel) < 0) {
    errors.push("Reorder Level cannot be negative");
  }

  if (data.manufacturingDate && data.expiryDate) {
    const mDate = new Date(data.manufacturingDate);
    const eDate = new Date(data.expiryDate);
    if (eDate <= mDate) {
      errors.push("Expiry Date must be greater than Manufacturing Date");
    }
  }

  return errors;
};

// Create Inventory Item
export const createInventoryItem = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const errors = validateInventoryData(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ message: "Validation failed", errors });
    }

    // Unique code check within this hospital
    const existing = await LabInventory.findOne({ hospital: hospitalId, code: req.body.code.trim() });
    if (existing) {
      return res.status(400).json({ message: "Item Code must be unique within the hospital" });
    }

    const item = await LabInventory.create({
      ...req.body,
      hospital: hospitalId,
      createdBy: (req as any).user?._id,
    });

    res.status(201).json({ success: true, message: "Inventory item created successfully", data: item });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Get Inventory List (Filter, Search, Sort, Pagination)
export const getInventoryList = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const {
      search,
      category,
      status, // "In Stock" | "Low Stock" | "Out of Stock" | "Expired"
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = req.query;

    const query: any = { hospital: hospitalId, isActive: true };

    // Text search
    if (search) {
      const searchRegex = new RegExp(String(search), "i");
      query.$or = [
        { name: searchRegex },
        { code: searchRegex },
        { brand: searchRegex },
      ];
    }

    if (category) {
      query.category = category;
    }

    // Status filter
    const now = new Date();
    if (status === "Expired") {
      query.expiryDate = { $lt: now };
    } else if (status === "Out of Stock") {
      query.quantity = 0;
    } else if (status === "Low Stock") {
      query.quantity = { $gt: 0 };
      query.$expr = { $lte: ["$quantity", "$reorderLevel"] };
    } else if (status === "In Stock") {
      query.quantity = { $gt: 0 };
      query.$expr = { $gt: ["$quantity", "$reorderLevel"] };
    }

    const skipIndex = (Number(page) - 1) * Number(limit);
    const sortParams: any = {};
    sortParams[String(sortBy)] = sortOrder === "asc" ? 1 : -1;

    const list = await LabInventory.find(query)
      .sort(sortParams)
      .skip(skipIndex)
      .limit(Number(limit))
      .lean();

    const total = await LabInventory.countDocuments(query);

    res.json({
      success: true,
      data: list,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
        limit: Number(limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Get Inventory by ID
export const getInventoryById = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const item = await LabInventory.findOne({ _id: req.params.id, hospital: hospitalId }).lean();

    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Update Inventory Item
export const updateInventoryItem = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const errors = validateInventoryData(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ message: "Validation failed", errors });
    }

    // Check unique code if changed
    if (req.body.code) {
      const existing = await LabInventory.findOne({
        hospital: hospitalId,
        code: req.body.code.trim(),
        _id: { $ne: req.params.id },
      });
      if (existing) {
        return res.status(400).json({ message: "Item Code must be unique within the hospital" });
      }
    }

    const item = await LabInventory.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      { ...req.body, updatedBy: (req as any).user?._id },
      { new: true },
    );

    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    res.json({ success: true, message: "Inventory item updated successfully", data: item });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Soft Delete Inventory Item
export const deleteInventoryItem = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const item = await LabInventory.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      { isActive: false, updatedBy: (req as any).user?._id },
      { new: true },
    );

    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    res.json({ success: true, message: "Inventory item soft deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Bulk Soft Delete
export const bulkDeleteInventory = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Invalid or empty IDs list" });
    }

    await LabInventory.updateMany(
      { _id: { $in: ids }, hospital: hospitalId },
      { isActive: false, updatedBy: (req as any).user?._id },
    );

    res.json({ success: true, message: `${ids.length} items soft deleted successfully` });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Bulk Import
export const bulkImportInventory = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const { records } = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ message: "Records array is required" });
    }

    const summary = { total: records.length, success: 0, failed: 0, skipped: 0 };
    const errors: any[] = [];
    const savedItems: any[] = [];

    // Preload existing codes to prevent duplicate imports within the bulk batch
    const existingItems = await LabInventory.find({ hospital: hospitalId }).select("code").lean();
    const existingCodesSet = new Set(existingItems.map(item => item.code.trim().toLowerCase()));

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 2; // Row number in Excel template header + 1-indexed

      // Sanitize fields
      const name = record.name?.toString().trim();
      const code = record.code?.toString().trim();
      const category = record.category?.toString().trim();
      const unit = record.unit?.toString().trim();
      const brand = record.brand?.toString().trim();
      const quantity = record.quantity !== undefined ? Number(record.quantity) : 0;
      const purchasePrice = record.purchasePrice !== undefined ? Number(record.purchasePrice) : 0;
      const mrp = record.mrp !== undefined ? Number(record.mrp) : 0;
      const reorderLevel = record.reorderLevel !== undefined ? Number(record.reorderLevel) : 0;
      
      const manufacturingDate = parseDate(record.manufacturingDate);
      const expiryDate = parseDate(record.expiryDate);
      const description = record.description?.toString().trim();
      const notes = record.notes?.toString().trim();
      const image = record.image?.toString().trim();
      const batchNumber = record.batchNumber?.toString().trim();

      // Check unique constraints & skipped duplicates
      if (code && existingCodesSet.has(code.toLowerCase())) {
        summary.skipped++;
        continue;
      }

      // Format payload for validation
      const itemData = {
        name,
        code,
        category,
        unit,
        brand,
        quantity,
        purchasePrice,
        mrp,
        reorderLevel,
        manufacturingDate,
        expiryDate,
        description,
        notes,
        image,
        batchNumber,
      };

      const recordErrors = validateInventoryData(itemData);
      if (recordErrors.length > 0) {
        summary.failed++;
        errors.push({ row: rowNum, code: code || "UNKNOWN", errors: recordErrors });
        continue;
      }

      // Add to set so subsequent duplicates in same import are skipped
      if (code) {
        existingCodesSet.add(code.toLowerCase());
      }

      savedItems.push({
        ...itemData,
        status: quantity === 0 ? "Out of Stock" : (quantity <= reorderLevel ? "Low Stock" : "In Stock"),
        hospital: hospitalId,
        createdBy: (req as any).user?._id,
      });
      summary.success++;
    }

    if (savedItems.length > 0) {
      await LabInventory.insertMany(savedItems);
    }

    res.json({ success: true, summary, errors });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};
