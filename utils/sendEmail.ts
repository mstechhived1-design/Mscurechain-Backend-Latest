// utils/sendEmail.ts
import nodemailer from "nodemailer";

const sendEmail = async (to: string, subject: string, html: string): Promise<any> => {
    const emailUser = (process.env.EMAIL_USER_FINAL || process.env.EMAIL_USER || "").trim();
    const emailPass = (process.env.EMAIL_PASS_FINAL || process.env.EMAIL_PASS || "").trim();

    // Validate required environment variables
    if (!emailUser || !emailPass) {
        console.error("Email configuration missing: EMAIL_USER (or EMAIL_USER_FINAL) and EMAIL_PASS required");
        throw new Error("Email service is not configured");
    }

    // DIAGNOSTIC LOG (SAFE)
    console.log("--- Email Debug ---");
    console.log(`User: ${emailUser ? "Configured" : "Missing"}`);
    console.log(`User Length: ${emailUser.length}`);
    console.log(`Pass Length: ${emailPass.length}`);
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
                user: emailUser,
                pass: emailPass,
            },
        }
        : {
            service: emailService,
            auth: {
                user: emailUser,
                pass: emailPass,
            },
        };

    const transporter = nodemailer.createTransport(transporterConfig);

    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER_FINAL || (emailUser ? `"MS CureChain" <${emailUser}>` : '"MS CureChain" <mscurechain@gmail.com>'),
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
