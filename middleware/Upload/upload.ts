import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    fieldSize: 10 * 1024 * 1024, // 10MB per text field (for long Cloudinary URLs, base64 signatures, etc.)
  },
});

export default upload;
