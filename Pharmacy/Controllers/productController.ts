import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import Product from "../Models/Product.js";
import Supplier from "../Models/Supplier.js";
import Batch from "../Models/Batch.js";
import mongoose from "mongoose";
import redisService from "../../config/redis.js";

export const getProducts = async (req: PharmaRequest, res: Response) => {
  try {
    const {
      search,
      status,
      supplier,
      lowStock,
      schedule,
      startDate,
      endDate,
      expiryStatus,
      page = 1,
      limit = 50,
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

    let query: any = { isActive: true, pharmacy: pharmacyId };

    // Search Filter
    if (search) {
      const escapedSearch = (search as string).replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      query.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { brand: { $regex: escapedSearch, $options: "i" } },
        { generic: { $regex: escapedSearch, $options: "i" } },
        { sku: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    // Status Filter
    if (status === "In Stock") {
      query.$expr = { $gt: ["$stock", "$minStock"] };
      query.stock = { $gt: 0 };
    } else if (status === "Out of Stock") {
      query.stock = 0;
    } else if (status === "Low Stock" || lowStock === "true") {
      query.$expr = { $lte: ["$stock", "$minStock"] };
      query.stock = { $gt: 0 };
    }

    // Supplier Filter
    if (supplier && supplier !== "All Suppliers") {
      if (mongoose.Types.ObjectId.isValid(supplier as string)) {
        query.supplier = supplier;
      } else {
        // If it's a name, we might need to find the supplier ID first
        const foundSupplier = await Supplier.findOne({
          pharmacy: pharmacyId,
          name: { $regex: new RegExp("^" + supplier + "$", "i") },
        });
        if (foundSupplier) {
          query.supplier = foundSupplier._id;
        }
      }
    }

    // Expiry Status Filter
    const now = new Date();
    if (expiryStatus === "Expired") {
      query.expiryDate = { $lt: now };
    } else if (expiryStatus === "Expiring Soon (30 days)") {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      query.expiryDate = { $gte: now, $lte: thirtyDaysFromNow };
    } else if (expiryStatus === "Expiring in 3 months") {
      const threeMonthsFromNow = new Date();
      threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
      query.expiryDate = { $gte: now, $lte: threeMonthsFromNow };
    }

    if (schedule) {
      query.schedule = schedule;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("supplier", "name")
        .lean(),
      Product.countDocuments(query),
    ]);

    res.json({
      success: true,
      count: products.length,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      data: products,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getProduct = async (req: PharmaRequest, res: Response) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      pharmacy: req.pharma?._id,
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createProduct = async (req: PharmaRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const pharmacyId = req.pharma?._id;
    const hospitalId = req.pharma?.hospital;

    const { batchNumber, expiryDate, stock, unitCost, supplier, ...rest } =
      req.body;

    let supplierId: any = undefined;
    if (supplier) {
      if (mongoose.Types.ObjectId.isValid(supplier)) {
        supplierId = supplier;
      } else {
        const foundSupplier = await Supplier.findOne({
          pharmacy: pharmacyId,
          name: { $regex: new RegExp("^" + supplier + "$", "i") },
        });
        if (foundSupplier) supplierId = foundSupplier._id;
      }
    }

    const productData = {
      brand: rest.brand || rest.brandName,
      generic: rest.generic || rest.genericName,
      sku: rest.sku,
      form: rest.form,
      strength: rest.strength,
      schedule: rest.schedule,
      gstPercent: rest.gstPercent !== undefined ? Number(rest.gstPercent) : (rest.gst !== undefined ? Number(rest.gst) : 12),
      hsnCode: rest.hsnCode,
      minStock: rest.minStock || rest.minStockLevel || 10,
      unitsPerPack: rest.unitsPerPack || 1,
      mrp: rest.mrp,
      batchNumber,
      expiryDate,
      stock: stock || 0,
      unitCost: unitCost || 0,
      supplier: supplierId,
      pharmacy: pharmacyId,
      hospital: hospitalId,
    };

    const product = await Product.create([productData], { session });

    // If initial stock and batch info provided, create initial batch
    if (stock > 0 && batchNumber && expiryDate) {
      await Batch.create(
        [
          {
            product: product[0]._id,
            batchNo: batchNumber,
            expiry: expiryDate,
            qtyReceived: stock,
            qtySold: 0,
            unitCost: unitCost || 0,
            supplier,
            pharmacy: pharmacyId,
            hospital: hospitalId,
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();

    // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
    await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

    res.status(201).json({
      success: true,
      data: product[0],
    });
  } catch (error: any) {
    await session.abortTransaction();
    res.status(500).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const updateProduct = async (req: PharmaRequest, res: Response) => {
  try {
    const { supplier, ...rest } = req.body;
    const pharmacyId = req.pharma?._id;

    let updateData: any = { ...rest };

    if (supplier) {
      if (mongoose.Types.ObjectId.isValid(supplier)) {
        updateData.supplier = supplier;
      } else {
        const foundSupplier = await Supplier.findOne({
          pharmacy: pharmacyId,
          name: { $regex: new RegExp("^" + supplier + "$", "i") },
        });
        if (foundSupplier) updateData.supplier = foundSupplier._id;
      }
    }

    // Map aliases
    if (rest.brandName) updateData.brand = rest.brandName;
    if (rest.genericName) updateData.generic = rest.genericName;
    if (rest.currentStock !== undefined) updateData.stock = rest.currentStock;
    if (rest.minStockLevel !== undefined)
      updateData.minStock = rest.minStockLevel;
    if (rest.gst !== undefined) {
      updateData.gstPercent = Number(rest.gst);
    } else if (rest.gstPercent !== undefined) {
      updateData.gstPercent = Number(rest.gstPercent);
    }

    // Find existing to compute new name if brand/strength/form changes
    const existingProduct = await Product.findOne({
      _id: req.params.id,
      pharmacy: pharmacyId,
    });
    if (!existingProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    const newBrand = updateData.brand || existingProduct.brand;
    const newStrength = updateData.strength || existingProduct.strength;
    const newForm = updateData.form || existingProduct.form;
    updateData.name = `${newBrand} ${newStrength} ${newForm}`;

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, pharmacy: pharmacyId },
      updateData,
      { new: true, runValidators: true },
    );

    // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
    await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteProduct = async (req: PharmaRequest, res: Response) => {
  try {
    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      pharmacy: req.pharma?._id,
    });

    if (product) {
      // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
      await redisService.del(`pharma:dashboard:stats:${req.pharma?._id}`);
    }

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      success: true,
      message: "Product permanently deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteAllProducts = async (req: PharmaRequest, res: Response) => {
  try {
    const pharmacyId = req.pharma?._id;

    if (!pharmacyId) {
      return res.status(400).json({ success: false, message: "Pharmacy context missing" });
    }

    const result = await Product.deleteMany({ pharmacy: pharmacyId });
    await Batch.deleteMany({ pharmacy: pharmacyId });

    await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} products.`,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Resolve expiry date for import: if the date is in the past or less than
 * 6 months from now, advance it by full years until it clears the threshold.
 * Returns undefined if no date is provided.
 */
const resolveExpiryDate = (raw: string | Date | undefined | null): Date | undefined => {
  if (!raw) return undefined;
  const parsed = new Date(raw as string);
  if (isNaN(parsed.getTime())) return undefined;

  const minFuture = new Date();
  minFuture.setMonth(minFuture.getMonth() + 6);

  if (parsed >= minFuture) return parsed;

  // Advance by full years until it clears the 6-month minimum
  const result = new Date(parsed);
  while (result < minFuture) {
    result.setFullYear(result.getFullYear() + 1);
  }
  return result;
};

export const bulkCreateProducts = async (req: PharmaRequest, res: Response) => {
  const productsData = req.body;
  if (!Array.isArray(productsData)) {
    return res.status(400).json({
      success: false,
      message: "Invalid data format. Expected an array of products.",
    });
  }

  const pharmacyId = req.pharma?._id;
  const hospitalId = req.pharma?.hospital;

  let addedCount = 0;
  let errorCount = 0;
  const errors: any[] = [];

  // Helper to normalize schedule
  const normalizeSchedule = (val: string): any => {
    if (!val) return "OTC";
    const v = val.toUpperCase();
    if (v.includes("H1")) return "H1";
    if (v.includes("X")) return "X";
    if (v.startsWith("H") || v.includes("PRESCRIPTION")) return "H";
    return "OTC";
  };

  // Helper to normalize form
  const normalizeForm = (val: string): any => {
    const validForms = [
      "TAB",
      "CAP",
      "SYR",
      "INJ",
      "CRM",
      "ONT",
      "DRP",
      "PWD",
      "SR TAB",
      "SR CAP",
      "TABLET",
      "CAPSULE",
      "SYRUP",
      "INJECTION",
      "CREAM",
      "DROPS",
      "SUSPENSION",
      "SUSP",
    ];
    if (!val) return "TABLET";
    const v = val.toUpperCase().trim();
    if (validForms.includes(v)) return v;
    // Check partial matches or variations
    if (v.includes("TAB")) return "TABLET";
    if (v.includes("CAP")) return "CAPSULE";
    if (v.includes("SYR")) return "SYRUP";
    if (v.includes("INJ")) return "INJECTION";
    return "TABLET";
  };

  try {
    // 1. Fetch all suppliers for this pharmacy upfront
    const suppliers = await Supplier.find({ pharmacy: pharmacyId }).lean();
    const supplierMap = new Map<string, any>();
    for (const s of suppliers) {
      if (s.name) {
        supplierMap.set(s.name.trim().toLowerCase(), s._id);
      }
      supplierMap.set(s._id.toString(), s._id);
    }
    const fallbackSupplier = suppliers[0]?._id;

    // 2. Fetch all existing products for the provided SKUs
    const skus = productsData
      .map((item) => item.sku?.toString().trim())
      .filter(Boolean);

    const existingProducts = await (Product.find({
      pharmacy: pharmacyId,
      sku: { $in: skus },
    }) as any).unscoped().lean();

    const productMap = new Map<string, any>();
    for (const p of existingProducts) {
      productMap.set(p.sku.toUpperCase().trim(), p);
    }

    // 3. Fetch all existing batches for these products
    const productIds = existingProducts.map((p) => p._id);
    const existingBatches = await (Batch.find({
      pharmacy: pharmacyId,
      product: { $in: productIds },
    }) as any).unscoped().lean();

    const batchMap = new Map<string, any>();
    for (const b of existingBatches) {
      const key = `${b.product.toString()}_${b.batchNo.toUpperCase().trim()}`;
      batchMap.set(key, b);
    }

    // 4. Process each product
    for (const item of productsData) {
      try {
        const brand = item.brandName || item.brand;
        const generic = item.genericName || item.generic;
        const sku = item.sku?.toString().trim();

        if (!brand || !generic || !sku) {
          throw new Error("SKU, Brand Name, and Generic Name are required");
        }

        const skuUpper = sku.toUpperCase();
        let product = productMap.get(skuUpper);

        if (product) {
          const stockToAdd = Number(item.currentStock) || Number(item.stock) || 0;
          await (Product.updateOne(
            { _id: product._id },
            { $inc: { stock: stockToAdd } }
          ) as any).unscoped();
          // Update local stock in productMap
          product.stock = (product.stock || 0) + stockToAdd;
        } else {
          let supplierId: any = undefined;
          if (item.supplier) {
            const supplierStr = String(item.supplier).trim();
            if (mongoose.Types.ObjectId.isValid(supplierStr)) {
              supplierId = supplierMap.get(supplierStr) || supplierStr;
            } else {
              supplierId = supplierMap.get(supplierStr.toLowerCase());
            }
          }

          const productData = {
            brand: brand.trim(),
            generic: generic.trim(),
            sku: sku,
            strength: item.strength?.trim() || "N/A",
            form: normalizeForm(item.form),
            schedule: normalizeSchedule(item.schedule),
            mrp: Number(item.mrp) || 0,
            gstPercent: Number(item.gst) || Number(item.gstPercent) || 12,
            hsnCode: item.hsnCode?.trim() || undefined,
            batchNumber: item.batchNumber?.trim() || undefined,
            expiryDate: resolveExpiryDate(item.expiryDate),
            unitCost: Number(item.unitCost) || 0,
            minStock: Number(item.minStockLevel) || Number(item.minStock) || 10,
            stock: Number(item.currentStock) || Number(item.stock) || 0,
            unitsPerPack: Number(item.unitsPerPack) || 1,
            supplier: supplierId,
            pharmacy: pharmacyId,
            hospital: hospitalId,
            isActive: true,
          };

          const created = await Product.create(productData);
          product = created.toObject ? created.toObject() : created;
          productMap.set(skuUpper, product);
        }

        const addedStock = Number(item.currentStock) || Number(item.stock) || 0;
        if (addedStock > 0) {
          let batchSupplier = product.supplier;
          if (!batchSupplier) {
            batchSupplier = fallbackSupplier;
          }

          let expiryDate = resolveExpiryDate(item.expiryDate);
          if (!expiryDate) {
            expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 5);
          }

          if (batchSupplier) {
            const targetBatchNo = (item.batchNumber || "INITIAL").toUpperCase().trim();
            const key = `${product._id.toString()}_${targetBatchNo}`;
            const existingBatch = batchMap.get(key);

            if (existingBatch) {
              await (Batch.updateOne(
                { _id: existingBatch._id },
                { $inc: { qtyReceived: addedStock } }
              ) as any).unscoped();
              existingBatch.qtyReceived = (existingBatch.qtyReceived || 0) + addedStock;
            } else {
              const createdBatch = await Batch.create({
                product: product._id,
                batchNo: targetBatchNo,
                expiry: expiryDate,
                qtyReceived: addedStock,
                qtySold: 0,
                unitCost: Number(item.unitCost) || Number(item.mrp) * 0.7,
                supplier: batchSupplier,
                pharmacy: pharmacyId,
                hospital: hospitalId,
                grnDate: new Date(),
              });
              batchMap.set(key, createdBatch.toObject ? createdBatch.toObject() : createdBatch);
            }
          }
        }

        addedCount++;
      } catch (err: any) {
        errorCount++;
        errors.push({
          sku: item.sku,
          brandName: item.brandName || item.brand,
          message: err.message,
        });
      }
    }
  } catch (outerErr: any) {
    return res.status(500).json({ success: false, message: outerErr.message });
  }

  // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache once after bulk operation
  await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

  res.status(200).json({
    success: true,
    addedCount,
    errorCount,
    errors,
  });
};

import fs from "fs";
import csv from "csv-parser";
import ExcelJS from "exceljs";

export const bulkImportProducts = async (req: PharmaRequest, res: Response) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "Please upload a CSV file" });
  }

  const results: any[] = [];
  const errors: any[] = [];
  let successCount = 0;
  const pharmacyId = req.pharma?._id;
  const hospitalId = req.pharma?.hospital;

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      try {
        for (let i = 0; i < results.length; i++) {
          const row = results[i];
          try {
            let supplierId: any = undefined;
            const supplierVal = row.supplier?.trim();

            if (supplierVal) {
              if (mongoose.Types.ObjectId.isValid(supplierVal)) {
                supplierId = supplierVal;
              } else {
                const foundSupplier = await Supplier.findOne({
                  pharmacy: pharmacyId,
                  name: { $regex: new RegExp("^" + supplierVal + "$", "i") },
                });
                if (foundSupplier) supplierId = foundSupplier._id;
              }
            }

            const productData = {
              brand: row.brand?.trim(),
              generic: row.generic?.trim(),
              name: row.name?.trim() || row.brand?.trim(),
              sku: row.sku?.trim(),
              strength: row.strength?.trim(),
              form: row.form?.toUpperCase().trim() || "TABLET",
              mrp: parseFloat(row.mrp) || 0,
              gstPercent:
                parseInt(row.gstPercent) || parseInt(row.gstPct) || 12,
              hsnCode: row.hsnCode?.trim(),
              batchNumber: row.batchNumber?.trim(),
              expiryDate: resolveExpiryDate(row.expiryDate),
              minStock: parseInt(row.minStock) || 10,
              stock: parseInt(row.stock) || 0,
              unitCost: parseFloat(row.unitCost) || 0,
              unitsPerPack: parseInt(row.unitsPerPack) || 1,
              pharmacy: pharmacyId,
              hospital: hospitalId,
              supplier: supplierId,
              isActive: true,
            };

            if (!productData.brand || !productData.generic) {
              throw new Error(
                `Row ${i + 1}: Brand and Generic Name are required`,
              );
            }

            const product = await Product.create(productData);

            // Create initial batch if stock > 0
            if (
              productData.stock > 0 &&
              productData.batchNumber &&
              productData.expiryDate
            ) {
              await Batch.create({
                product: product._id,
                batchNo: productData.batchNumber,
                expiry: productData.expiryDate,
                qtyReceived: productData.stock,
                qtySold: 0,
                unitCost: productData.unitCost,
                supplier: supplierId,
                pharmacy: pharmacyId,
                hospital: hospitalId,
              });
            }

            successCount++;
          } catch (err: any) {
            errors.push({ row: i + 1, error: err.message });
          }
        }

        fs.unlinkSync(req.file!.path);

        // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
        await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

        res.status(200).json({
          success: true,
          message: `Import completed: ${successCount} successful, ${errors.length} failed`,
          data: {
            total: results.length,
            success: successCount,
            failed: errors.length,
            errors,
          },
        });
      } catch (error: any) {
        if (fs.existsSync(req.file!.path)) fs.unlinkSync(req.file!.path);
        res.status(500).json({ message: error.message });
      }
    });
};

export const exportProductsToExcel = async (
  req: PharmaRequest,
  res: Response,
) => {
  try {
    const pharmacyId = req.pharma?._id;
    const products = await Product.find({
      pharmacy: pharmacyId,
      isActive: true,
    })
      .populate("supplier", "name")
      .lean();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Products");

    worksheet.columns = [
      { header: "Brand Name", key: "brand", width: 20 },
      { header: "Generic Name", key: "generic", width: 20 },
      { header: "SKU", key: "sku", width: 15 },
      { header: "Form", key: "form", width: 10 },
      { header: "MRP", key: "mrp", width: 10 },
      { header: "Stock", key: "stock", width: 10 },
      { header: "Min Stock", key: "minStock", width: 10 },
      { header: "Expiry", key: "expiryDate", width: 15 },
      { header: "Supplier", key: "supplierName", width: 20 },
    ];

    products.forEach((p: any) => {
      worksheet.addRow({
        brand: p.brand,
        generic: p.generic,
        sku: p.sku,
        form: p.form,
        mrp: p.mrp,
        stock: p.stock,
        minStock: p.minStock,
        expiryDate: p.expiryDate
          ? new Date(p.expiryDate).toLocaleDateString()
          : "N/A",
        supplierName: p.supplier?.name || "N/A",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getGenericSubstitutes = async (req: PharmaRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pharmacyId = req.pharma?._id;

    const baseProduct = await Product.findOne({ _id: id, pharmacy: pharmacyId }).lean();

    if (!baseProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (!baseProduct.generic) {
      return res.json({ success: true, data: [] });
    }

    const substitutes = await Product.find({
      pharmacy: pharmacyId,
      generic: baseProduct.generic,
      _id: { $ne: baseProduct._id },
      stock: { $gt: 0 },
      isActive: true
    }).select("name brand generic stock mrp unitCost form strength sku").lean();

    res.json({
      success: true,
      data: substitutes
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
