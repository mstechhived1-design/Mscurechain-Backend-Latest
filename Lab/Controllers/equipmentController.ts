import { Request, Response } from "express";
import LabEquipment from "../Models/LabEquipment.js";
import Department from "../Models/Department.js";

// Helper for parsing dates safely
const parseDate = (d: any) => (d ? new Date(d) : undefined);

// Validation helper
const validateEquipmentData = (data: any) => {
  const errors: string[] = [];

  if (!data.name || !data.name.trim()) errors.push("Equipment Name is required");
  if (!data.code || !data.code.trim()) errors.push("Equipment Code is required");
  if (!data.category) errors.push("Category is required");
  if (!data.brand || !data.brand.trim()) errors.push("Brand is required");
  if (!data.model || !data.model.trim()) errors.push("Model is required");
  if (data.quantity === undefined || data.quantity === null || Number(data.quantity) < 0) {
    errors.push("Quantity cannot be less than 0");
  }
  if (!data.unit || !data.unit.trim()) errors.push("Unit is required");
  if (data.purchasePrice === undefined || data.purchasePrice === null || Number(data.purchasePrice) < 0) {
    errors.push("Purchase Price cannot be negative");
  }
  if (!data.purchaseDate) {
    errors.push("Purchase Date is required");
  } else {
    const pDate = new Date(data.purchaseDate);
    if (pDate > new Date()) {
      errors.push("Purchase Date cannot be a future date");
    }
  }

  return errors;
};

// Strip empty-string ObjectId fields so Mongoose doesn't throw a cast error
const sanitizePayload = (body: any) => {
  const cleaned = { ...body };
  if (cleaned.department === '' || cleaned.department === null) {
    delete cleaned.department;
  }
  return cleaned;
};

// Create Equipment
export const createEquipment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const errors = validateEquipmentData(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ message: "Validation failed", errors });
    }

    // Check code uniqueness within this hospital
    const existing = await LabEquipment.findOne({ hospital: hospitalId, code: req.body.code.trim() });
    if (existing) {
      return res.status(400).json({ message: "Equipment Code must be unique within the hospital" });
    }

    const equipment = await LabEquipment.create({
      ...sanitizePayload(req.body),
      hospital: hospitalId,
      createdBy: (req as any).user?._id,
    });

    res.status(201).json({ success: true, message: "Equipment created successfully", data: equipment });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Get Equipment List (Filter, Search, Sort, Pagination)
export const getEquipmentList = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const {
      search,
      category,
      department,
      status,
      brand,
      showDeleted, // "true" or "only" or default undefined (only show active)
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = req.query;

    const query: any = { hospital: hospitalId };

    // Handle soft delete filter
    if (showDeleted === "only") {
      query.isActive = false;
    } else if (showDeleted === "true") {
      // return both active and inactive
    } else {
      query.isActive = true;
    }

    // Text search
    if (search) {
      const searchRegex = new RegExp(String(search), "i");
      query.$or = [
        { name: searchRegex },
        { code: searchRegex },
        { brand: searchRegex },
        { model: searchRegex },
      ];
    }

    // Category, Department, Status, Brand filters
    if (category) query.category = category;
    if (department) query.department = department;
    if (status) query.status = status;
    if (brand) query.brand = brand;

    const skipIndex = (Number(page) - 1) * Number(limit);
    const sortParams: any = {};
    sortParams[String(sortBy)] = sortOrder === "asc" ? 1 : -1;

    const list = await LabEquipment.find(query)
      .populate("department", "name")
      .sort(sortParams)
      .skip(skipIndex)
      .limit(Number(limit))
      .lean();

    const total = await LabEquipment.countDocuments(query);

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

// Get Equipment by ID
export const getEquipmentById = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const equipment = await LabEquipment.findOne({ _id: req.params.id, hospital: hospitalId })
      .populate("department", "name")
      .lean();

    if (!equipment) {
      return res.status(404).json({ message: "Equipment not found" });
    }

    res.json({ success: true, data: equipment });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Update Equipment
export const updateEquipment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const errors = validateEquipmentData(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ message: "Validation failed", errors });
    }

    // Check code uniqueness if changing code
    if (req.body.code) {
      const existing = await LabEquipment.findOne({
        hospital: hospitalId,
        code: req.body.code.trim(),
        _id: { $ne: req.params.id },
      });
      if (existing) {
        return res.status(400).json({ message: "Equipment Code must be unique within the hospital" });
      }
    }

    const equipment = await LabEquipment.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      { ...sanitizePayload(req.body), updatedBy: (req as any).user?._id },
      { new: true },
    );

    if (!equipment) {
      return res.status(404).json({ message: "Equipment not found" });
    }

    res.json({ success: true, message: "Equipment updated successfully", data: equipment });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Soft Delete Equipment
export const deleteEquipment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const equipment = await LabEquipment.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      { isActive: false, updatedBy: (req as any).user?._id },
      { new: true },
    );

    if (!equipment) {
      return res.status(404).json({ message: "Equipment not found" });
    }

    res.json({ success: true, message: "Equipment soft deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Restore Soft Deleted Equipment (Admin Only)
export const restoreEquipment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const userRole = (req as any).user?.role;

    if (!["super-admin", "hospital-admin"].includes(userRole)) {
      return res.status(403).json({ message: "Unauthorized. Admin role required to restore records." });
    }

    const equipment = await LabEquipment.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      { isActive: true, updatedBy: (req as any).user?._id },
      { new: true },
    );

    if (!equipment) {
      return res.status(404).json({ message: "Equipment not found" });
    }

    res.json({ success: true, message: "Equipment restored successfully", data: equipment });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Bulk Soft Delete
export const bulkDeleteEquipment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Invalid or empty IDs list" });
    }

    await LabEquipment.updateMany(
      { _id: { $in: ids }, hospital: hospitalId },
      { isActive: false, updatedBy: (req as any).user?._id },
    );

    res.json({ success: true, message: `${ids.length} items soft deleted successfully` });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Bulk Restore (Admin Only)
export const bulkRestoreEquipment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const userRole = (req as any).user?.role;

    if (!["super-admin", "hospital-admin"].includes(userRole)) {
      return res.status(403).json({ message: "Unauthorized. Admin role required to restore records." });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Invalid or empty IDs list" });
    }

    await LabEquipment.updateMany(
      { _id: { $in: ids }, hospital: hospitalId },
      { isActive: true, updatedBy: (req as any).user?._id },
    );

    res.json({ success: true, message: `${ids.length} items restored successfully` });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Bulk Status Update
export const bulkStatusUpdate = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Invalid or empty IDs list" });
    }

    const validStatuses = ["Working", "Under Maintenance", "Repairing", "Out of Service", "Inactive", "Disposed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status option" });
    }

    await LabEquipment.updateMany(
      { _id: { $in: ids }, hospital: hospitalId },
      { status, updatedBy: (req as any).user?._id },
    );

    res.json({ success: true, message: `Status updated for ${ids.length} items successfully` });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Bulk Import
export const bulkImportEquipment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: "No records to import" });
    }

    const summary = {
      total: records.length,
      success: 0,
      failed: 0,
      skipped: 0,
    };

    const rowErrors: Array<{ row: number; errors: string[] }> = [];
    const departments = await Department.find({ hospital: hospitalId }).lean();
    const deptMap = new Map(departments.map((d) => [d.name.toLowerCase().trim(), d._id]));

    // Pre-fetch all active equipment codes in the hospital to avoid multiple queries
    const activeEquipment = await LabEquipment.find({ hospital: hospitalId }).select("code").lean();
    const existingCodes = new Set(activeEquipment.map((e) => e.code.toLowerCase().trim()));

    const toInsert: any[] = [];

    for (let i = 0; i < records.length; i++) {
      const rowNum = i + 2; // Assume header is row 1
      const rec = records[i];

      // Match department dynamically by name
      const deptId = rec.department
        ? deptMap.get(String(rec.department).toLowerCase().trim())
        : undefined;
        
      const parsedRecord = {
        ...rec,
        department: deptId,
        quantity: rec.quantity !== undefined ? Number(rec.quantity) : undefined,
        purchasePrice: rec.purchasePrice !== undefined ? Number(rec.purchasePrice) : undefined,
        purchaseDate: parseDate(rec.purchaseDate),
        warrantyExpiry: parseDate(rec.warrantyExpiry),
        installationDate: parseDate(rec.installationDate),
        lastServiceDate: parseDate(rec.lastServiceDate),
        nextServiceDate: parseDate(rec.nextServiceDate),
        calibrationDate: parseDate(rec.calibrationDate),
        calibrationDueDate: parseDate(rec.calibrationDueDate),
      };

      const valErrors = validateEquipmentData(parsedRecord);

      // Check dynamic department resolving error
      if (rec.department && !deptId) {
        valErrors.push(`Department "${rec.department}" not found in database`);
      }

      if (valErrors.length > 0) {
        rowErrors.push({ row: rowNum, errors: valErrors });
        summary.failed++;
        continue;
      }

      // Check code duplicate
      const codeKey = String(rec.code).toLowerCase().trim();
      if (existingCodes.has(codeKey)) {
        summary.skipped++;
        continue;
      }

      // Add to insert queue
      toInsert.push({
        ...parsedRecord,
        hospital: hospitalId,
        createdBy: (req as any).user?._id,
      });
      existingCodes.add(codeKey); // Prevent duplicate codes within the same import file
    }

    if (toInsert.length > 0) {
      await LabEquipment.insertMany(toInsert);
      summary.success = toInsert.length;
    }

    res.json({
      success: true,
      summary,
      errors: rowErrors,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};
