// utils/sendEmail.ts
import nodemailer from "nodemailer";

const sendEmail = async (to: string, subject: string, html: string): Promise<any> => {
    // Validate required environment variables
    if (!process.env.EMAIL_USER_FINAL || !process.env.EMAIL_PASS_FINAL) {
        console.error("Email configuration missing: EMAIL_USER_FINAL and EMAIL_PASS_FINAL required");
        throw new Error("Email service is not configured");
    }

    // DIAGNOSTIC LOG (SAFE)
    console.log("--- Email Debug ---");
    console.log(`User: ${process.env.EMAIL_USER_FINAL.trim() === process.env.EMAIL_USER_FINAL ? "No spaces" : "HAS SPACES!"}`);
    console.log(`User Length: ${process.env.EMAIL_USER_FINAL.length}`);
    console.log(`Pass Length: ${process.env.EMAIL_PASS_FINAL.length}`);
    console.log(`Pass Start/End: ${process.env.EMAIL_PASS_FINAL[0]}...${process.env.EMAIL_PASS_FINAL.slice(-1)}`);
    console.log("-------------------");

    // Use EMAIL_SERVICE if provided, otherwise default to 'gmail'
    const emailService = process.env.EMAIL_SERVICE || "gmail";
    const emailHost = process.env.EMAIL_HOST;
    const emailPort = process.env.EMAIL_PORT ? parseInt(process.env.EMAIL_PORT) : 587;

    // Configure transporter based on service or custom host
    const transporterConfig: any = emailHost
        ? {
            host: emailHost,
            port: emailPort,
            secure: emailPort === 465, // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER_FINAL,
                pass: process.env.EMAIL_PASS_FINAL,
            },
        }
        : {
            service: emailService,
            auth: {
                user: process.env.EMAIL_USER_FINAL,
                pass: process.env.EMAIL_PASS_FINAL,
            },
        };

    const transporter = nodemailer.createTransport(transporterConfig);

    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER_FINAL,
            to,
            subject,
            html,
        });

        if (process.env.NODE_ENV === "development") {
            console.log("Email sent successfully:", info.messageId);
        }
        return info;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};

export default sendEmail;
