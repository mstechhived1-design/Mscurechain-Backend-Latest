import { Request, Response } from "express";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import IPDChargeCategory from "../Models/IPDChargeCategory.js";

// @desc    Get all custom charge categories for hospital
// @route   GET /api/ipd/billing/categories
// @access  Private
export const getChargeCategories = asyncHandler(async (req: Request, res: Response) => {
  const hospital = (req as any).user.hospital;
  
  const categories = await IPDChargeCategory.find({ hospital }).sort({ name: 1 });
  
  res.status(200).json({
    success: true,
    data: categories,
  });
});

// @desc    Add a new custom charge category
// @route   POST /api/ipd/billing/categories
// @access  Private
export const addChargeCategory = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  const hospital = (req as any).user.hospital;
  const userId = (req as any).user._id;

  if (!name || name.trim() === "") {
    res.status(400);
    throw new Error("Category name is required");
  }

  // Case-insensitive check handled by DB unique index, but we can do a quick check to return a better error
  const existing = await IPDChargeCategory.findOne({
    hospital,
    name: { $regex: new RegExp(`^${name.trim()}$`, "i") }
  });

  if (existing) {
    res.status(400);
    throw new Error("Category already exists");
  }

  const category = await IPDChargeCategory.create({
    name: name.trim(),
    hospital,
    createdBy: userId,
  });

  res.status(201).json({
    success: true,
    data: category,
  });
});

// @desc    Update a custom charge category
// @route   PUT /api/ipd/billing/categories/:id
// @access  Private
export const updateChargeCategory = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  const { id } = req.params;
  const hospital = (req as any).user.hospital;

  if (!name || name.trim() === "") {
    res.status(400);
    throw new Error("Category name is required");
  }

  const category = await IPDChargeCategory.findOne({ _id: id, hospital });

  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  // Check for duplicate name
  if (name.trim().toLowerCase() !== category.name.toLowerCase()) {
    const existing = await IPDChargeCategory.findOne({
      hospital,
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") }
    });
    if (existing) {
      res.status(400);
      throw new Error("Another category with this name already exists");
    }
  }

  category.name = name.trim();
  await category.save();

  res.status(200).json({
    success: true,
    data: category,
  });
});

// @desc    Delete a custom charge category
// @route   DELETE /api/ipd/billing/categories/:id
// @access  Private
export const deleteChargeCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const hospital = (req as any).user.hospital;

  const category = await IPDChargeCategory.findOneAndDelete({ _id: id, hospital });

  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  res.status(200).json({
    success: true,
    message: "Category deleted",
  });
});
