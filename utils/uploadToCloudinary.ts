import cloudinary from "../config/cloudinary.js";

export const uploadToCloudinary = (buffer: Buffer, options: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
        console.log("Starting Cloudinary upload stream...");
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "auto",
                ...options
            },
            (error, result) => {
                if (error) {
                    console.error("Cloudinary Stream Error:", error);
                    return reject(error);
                }
                console.log("Cloudinary Upload Success:", result?.secure_url);
                resolve(result);
            }
        );

        stream.end(buffer);
    });
};
