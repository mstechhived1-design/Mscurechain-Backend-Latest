import { Response } from "express";
import axios from "axios";
import https from "https";
import http from "http";
import cloudinary from "../../config/cloudinary.js";
import SOPModel from "../Models/SOP.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";
import SOPAcknowledgement from "../Models/SOPAcknowledgement.js";
import User from "../../Auth/Models/User.js";

/**
 * @desc    Upload a new SOP or a new version of an existing SOP
 * @route   POST /api/sop
 * @access  Private (Admin only)
 */
export const uploadSOP = asyncHandler(async (req: any, res: Response) => {
  const { name, category, assignedRole } = req.body;
  const hospitalId = req.user.hospital;
  const userId = req.user._id;

  // upload.any() puts files in req.files array; pick the first one
  const filesArray = req.files as Express.Multer.File[] | undefined;
  const uploadedFile = req.file || (filesArray && filesArray[0]);

  if (!uploadedFile) throw new ApiError(400, "Please upload a PDF document");
  // Accept by mimetype OR by .pdf extension (Postman sometimes sends PDFs as application/octet-stream)
  const isPDF =
    uploadedFile.mimetype === "application/pdf" ||
    uploadedFile.originalname?.toLowerCase().endsWith(".pdf");
  if (!isPDF) throw new ApiError(400, "Only PDF files are allowed");
  if (!name || !category)
    throw new ApiError(400, "SOP name and category are required");

  // Standardized Public ID: Folder/Role_Name_Timestamp (no extension)
  const sanitizedName = name.replace(/\s+/g, "_").toLowerCase();
  const publicId = `sop_documents/${assignedRole.toLowerCase()}_${sanitizedName}_v${Date.now()}`;

  console.log(`[SOP UPLOAD] Uploading with publicId: ${publicId}`);

  const cloudinaryResult = await uploadToCloudinary(uploadedFile.buffer, {
    public_id: publicId,
    resource_type: "raw",
    type: "authenticated",
    use_filename: false, // Don't use original filename
    unique_filename: false, // Use our exact public_id
  });

  console.log(
    `[SOP UPLOAD] Cloudinary returned publicId: ${cloudinaryResult.public_id}`,
  );

  // Version Control: Archive previous version with same name
  const existingActiveSOP = await (
    SOPModel.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      hospital: hospitalId,
      status: "Active",
    }) as any
  ).unscoped();

  let version = 1;
  if (existingActiveSOP) {
    version = existingActiveSOP.version + 1;
    existingActiveSOP.status = "Archived";
    await existingActiveSOP.save();
  }

  const newSOP = await SOPModel.create({
    name,
    category,
    version,
    fileUrl: cloudinaryResult.secure_url,
    publicId: cloudinaryResult.public_id,
    resourceType: "raw",
    accessType: cloudinaryResult.type || "upload",
    fileName: uploadedFile.originalname,
    status: "Active",
    hospital: hospitalId,
    uploadedBy: userId,
    assignedRole: assignedRole || "Staff",
    lastUpdated: new Date(),
  });

  res.status(201).json({
    success: true,
    message: existingActiveSOP
      ? `Version ${version} published.`
      : "Protocol published.",
    sop: newSOP,
  });
});

/**
 * @desc    Get all SOPs for the hospital (filtered by category/status)
 * @route   GET /api/sop
 * @access  Private (All Roles - but status filtered for non-admins)
 */
export const getSOPs = asyncHandler(async (req: any, res: Response) => {
  const hospitalId = req.user.hospital;
  const { category, status, search } = req.query;

  let query: any = { hospital: hospitalId };

  // Strict access control: Non-admins can only see Active SOPs assigned to their role
  if (req.user.role !== "hospital-admin" && req.user.role !== "super-admin") {
    query.status = "Active";

    // Map user role to assignedRole enum
    let targetRole = "Staff";
    if (req.user.role === "doctor") targetRole = "Doctor";
    else if (req.user.role === "nurse") targetRole = "Nurse";

    query.assignedRole = targetRole;
  } else if (status && status !== "all") {
    query.status = status;
  }

  if (category && category !== "all") {
    query.category = category;
  }

  if (search) {
    query.name = { $regex: search, $options: "i" };
  }

  const sops = await (SOPModel.find(query) as any)
    .unscoped()
    .populate({
      path: "uploadedBy",
      select: "name",
      options: { unscoped: true },
    })
    .sort({ createdAt: -1 });

  // If non-admin, check acknowledgment for each SOP
  let sopsWithAck: any[] = [];
  if (req.user.role !== "hospital-admin" && req.user.role !== "super-admin") {
    const acknowledgments = await (
      SOPAcknowledgement.find({
        userId: req.user._id,
        sopId: { $in: sops.map((s: any) => s._id) },
      }) as any
    ).unscoped();
    const ackIds = acknowledgments.map((a) => a.sopId.toString());

    sopsWithAck = sops.map((sop) => ({
      ...(sop as any).toObject(),
      isAcknowledged: ackIds.includes(sop._id.toString()),
    }));
  } else {
    sopsWithAck = sops.map((s) => s.toObject());
  }

  res.json({
    success: true,
    count: sops.length,
    sops: sopsWithAck,
  });
});

/**
 * @desc    Archive an SOP manually
 * @route   PATCH /api/sop/:id/archive
 * @access  Private (Admin only)
 */
export const archiveSOP = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const hospitalId = req.user.hospital;

  const sop = await (
    SOPModel.findOne({ _id: id, hospital: hospitalId }) as any
  ).unscoped();

  if (!sop) {
    throw new ApiError(404, "SOP not found");
  }

  if (sop.status === "Archived") {
    throw new ApiError(400, "SOP is already archived");
  }

  sop.status = "Archived";
  await sop.save();

  res.json({
    success: true,
    message: "SOP archived successfully",
    sop,
  });
});

/**
 * @desc    Update an existing SOP's metadata and optionally replace the document
 * @route   PUT /api/sop/:id
 * @access  Private (Admin only)
 */
export const updateSOP = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const { name, category, assignedRole } = req.body;
  const hospitalId = req.user.hospital;
  const userId = req.user._id;

  const existingSOP = await (
    SOPModel.findOne({ _id: id, hospital: hospitalId }) as any
  ).unscoped();
  if (!existingSOP) {
    throw new ApiError(404, "SOP not found");
  }

  // upload.any() puts files in req.files array; pick the first one
  const updateFilesArray = req.files as Express.Multer.File[] | undefined;
  const updateUploadedFile =
    req.file || (updateFilesArray && updateFilesArray[0]);

  // If a new file is uploaded, validate it is a PDF and create a new version
  if (updateUploadedFile) {
    // Accept by mimetype OR by .pdf extension (Postman sometimes sends PDFs as application/octet-stream)
    const isUpdatePDF =
      updateUploadedFile.mimetype === "application/pdf" ||
      updateUploadedFile.originalname?.toLowerCase().endsWith(".pdf");
    if (!isUpdatePDF) {
      throw new ApiError(400, "Only PDF files are allowed");
    }
    // Archive the current SOP
    existingSOP.status = "Archived";
    await existingSOP.save();

    // Create new version with updated file
    const sanitizedName = (name || existingSOP.name)
      .replace(/\s+/g, "_")
      .toLowerCase();
    const publicId = `sop_documents/${(assignedRole || existingSOP.assignedRole).toLowerCase()}_${sanitizedName}_v${Date.now()}`;

    console.log(
      `[SOP UPDATE] Uploading new version with publicId: ${publicId}`,
    );

    const cloudinaryResult = await uploadToCloudinary(
      updateUploadedFile.buffer,
      {
        public_id: publicId,
        resource_type: "raw",
        type: "authenticated",
        use_filename: false,
        unique_filename: false,
      },
    );

    const newSOP = await SOPModel.create({
      name: name || existingSOP.name,
      category: category || existingSOP.category,
      version: existingSOP.version + 1,
      fileUrl: cloudinaryResult.secure_url,
      publicId: cloudinaryResult.public_id,
      resourceType: "raw",
      accessType: cloudinaryResult.type || "authenticated",
      fileName: updateUploadedFile.originalname,
      status: "Active",
      hospital: hospitalId,
      uploadedBy: userId,
      assignedRole: assignedRole || existingSOP.assignedRole,
      lastUpdated: new Date(),
    });

    return res.json({
      success: true,
      message: `Protocol updated with new document. Version ${newSOP.version} published.`,
      sop: newSOP,
    });
  }

  // Metadata-only update (no new file)
  const updateData: any = {
    lastUpdated: new Date(),
  };

  if (name && name !== existingSOP.name) {
    updateData.name = name;
    // Also update the name in historical versions to maintain audit trail grouping
    await (
      SOPModel.updateMany(
        {
          name: existingSOP.name,
          hospital: hospitalId,
          _id: { $ne: id },
        },
        { name: name },
      ) as any
    ).unscoped();
  }

  if (category) updateData.category = category;
  if (assignedRole) updateData.assignedRole = assignedRole;

  const updatedSOP = await (
    SOPModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }) as any
  )
    .unscoped()
    .populate({
      path: "uploadedBy",
      select: "name",
      options: { unscoped: true },
    });

  res.json({
    success: true,
    message: "Protocol updated successfully",
    sop: updatedSOP,
  });
});

/**
 * @desc    Get version history for a specific SOP name
 * @route   GET /api/sop/history/:name
 * @access  Private (Admin only)
 */
export const getSOPHistory = asyncHandler(async (req: any, res: Response) => {
  const { name } = req.params;
  const hospitalId = req.user.hospital;

  // Escape special regex characters in the name to prevent search failures
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const history = await (
    SOPModel.find({
      name: { $regex: new RegExp(`^${escapedName}$`, "i") },
      hospital: hospitalId,
    }) as any
  )
    .unscoped()
    .populate({
      path: "uploadedBy",
      select: "name",
      options: { unscoped: true },
    })
    .sort({ version: -1 });

  res.json({
    success: true,
    history,
  });
});

/**
 * @desc    Get signed Cloudinary URL for direct download/viewing
 * @route   GET /api/sop/download/:id
 * @access  Private
 */
export const downloadSOP = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const { download } = req.query;
  const hospitalId = req.user.hospital;

  const sop = await (
    SOPModel.findOne({
      _id: id,
      hospital: hospitalId,
    }) as any
  ).unscoped();
  if (!sop) throw new ApiError(404, "SOP not found");

  const cloudName = cloudinary.config().cloud_name;
  const isPublic = sop.accessType === "upload";
  const isAuthenticated = sop.accessType === "authenticated";

  // Extract version (v...) from fileUrl or default to empty
  const versionMatch = sop.fileUrl ? sop.fileUrl.match(/\/v(\d+)\//) : null;
  const version = versionMatch ? `v${versionMatch[1]}` : "";

  let publicId = sop.publicId;

  // Force download logic
  const isDownload = download === "true";

  // For authenticated resources, always use signed URLs
  if (isAuthenticated || !isPublic) {
    console.log(
      `[SOP DEBUG] Generating signed URL for authenticated resource:`,
    );
    console.log(`  - publicId: ${publicId}`);
    console.log(`  - accessType: ${sop.accessType}`);
    console.log(`  - version: ${version}`);
    console.log(`  - fileUrl: ${sop.fileUrl}`);

    const signedUrl = cloudinary.url(publicId, {
      sign_url: true,
      resource_type: "raw",
      type: sop.accessType || "authenticated",
      secure: true,
      version: version.replace("v", ""),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      flags: isDownload ? "attachment" : undefined,
    });

    console.log(`[SOP DEBUG] Generated Signed URL: ${signedUrl}`);
    return res.json({ success: true, downloadUrl: signedUrl });
  }

  // For public resources (fallback)
  const resourcePath = isDownload
    ? `upload/fl_attachment/${version}`
    : `upload/${version}`;
  const baseUrl = `https://res.cloudinary.com/${cloudName}/raw/${resourcePath}/${publicId}`;
  const finalUrl = `${baseUrl}?t=${Date.now()}#toolbar=0`;

  console.log(
    `[SOP DEBUG] Serving Manual URL (Public, DL=${isDownload}): ${finalUrl}`,
  );
  res.json({ success: true, downloadUrl: finalUrl });
});

/**
 * @desc    Acknowledge an SOP
 * @route   POST /api/sop/:id/acknowledge
 * @access  Private
 */
export const acknowledgeSOP = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const userId = req.user._id;
  const hospitalId = req.user.hospital;

  const sop = await (
    SOPModel.findOne({
      _id: id,
      hospital: hospitalId,
    }) as any
  ).unscoped();
  if (!sop) {
    throw new ApiError(404, "SOP not found");
  }

  const existing = await (
    SOPAcknowledgement.findOne({
      sopId: id,
      userId,
    }) as any
  ).unscoped();
  if (existing) {
    return res.json({ success: true, message: "Already acknowledged" });
  }

  await SOPAcknowledgement.create({
    sopId: id,
    userId,
    hospitalId,
    acknowledgedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    message: "Protocol acknowledged successfully",
  });
});

/**
 * @desc    Get acknowledgment report for an SOP
 * @route   GET /api/sop/:id/report
 * @access  Private (Admin only)
 */
export const getSOPReport = asyncHandler(async (req: any, res: Response) => {
  const { id } = req.params;
  const hospitalId = req.user.hospital;

  const sop = await (
    SOPModel.findOne({
      _id: id,
      hospital: hospitalId,
    }) as any
  ).unscoped();
  if (!sop) {
    throw new ApiError(404, "SOP not found");
  }

  // Map SOP assignedRole to User role
  let userRole = "staff";
  if (sop.assignedRole === "Doctor") userRole = "doctor";
  else if (sop.assignedRole === "Nurse") userRole = "nurse";

  // Get all users with that role in the hospital (no status filter — include all active/inactive for full audit)
  const users = await (
    User.find({
      hospital: hospitalId,
      role: userRole,
    }) as any
  )
    .unscoped()
    .select("name email employeeId");

  // Get all acknowledgments for this SOP — explicitly pass hospitalId so tenant plugin doesn't auto-scope incorrectly
  const acknowledgments = await (
    SOPAcknowledgement.find({
      sopId: id,
      hospitalId,
    }) as any
  ).unscoped();
  const acknowledgedUserIds = acknowledgments.map((a) => a.userId.toString());

  const report = users.map((user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
    hasAcknowledged: acknowledgedUserIds.includes(user._id.toString()),
    acknowledgedAt: acknowledgments.find(
      (a) => a.userId.toString() === user._id.toString(),
    )?.acknowledgedAt,
  }));

  res.json({
    success: true,
    sopName: sop.name,
    assignedRole: sop.assignedRole,
    stats: {
      total: report.length,
      acknowledged: report.filter((r) => r.hasAcknowledged).length,
      pending: report.filter((r) => !r.hasAcknowledged).length,
    },
    report,
  });
});
