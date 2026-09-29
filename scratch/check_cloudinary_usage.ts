import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: "dnjxgcl3f",
  api_key: "842839579248378",
  api_secret: "0UJR6xxBLO1BOkGTQfozg4NgDzc",
  secure: true
});

async function checkUsage() {
  try {
    console.log("Connecting to Cloudinary Admin API...");
    const usage = await cloudinary.api.usage();

    const formatBytes = (bytes: number) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    console.log("\n=============================================");
    console.log("        CLOUDINARY FREE TIER USAGE REPORT    ");
    console.log("=============================================");
    console.log(`Plan Name:          ${usage.plan}`);
    console.log(`Last Updated:       ${usage.last_updated}`);
    console.log("---------------------------------------------");
    console.log("FREE TIER LIMITS EXPLAINED:");
    console.log("  • Total Credit Pool: 25 Credits per month");
    console.log("  • 1 Credit is equivalent to:");
    console.log("    - 1.00 GB of Managed Storage");
    console.log("    - 1.00 GB of Monthly Bandwidth");
    console.log("    - 1,000 Transformations");
    console.log("---------------------------------------------");

    // 1. Overall Credit Pool
    const credUsed = usage.credits.usage;
    const credLimit = usage.credits.limit;
    const credRemaining = credLimit - credUsed;
    const credPercent = usage.credits.used_percent;

    console.log("OVERALL PLAN CREDITS:");
    console.log(`  Used Credits:      ${credUsed} / ${credLimit}`);
    console.log(`  Remaining Credits: ${credRemaining.toFixed(2)}`);
    console.log(`  Usage Percentage:  ${credPercent.toFixed(2)}%`);
    console.log(`  Potential Remaining Storage:   ${credRemaining.toFixed(2)} GB`);
    console.log(`  Potential Remaining Bandwidth: ${credRemaining.toFixed(2)} GB`);
    console.log("---------------------------------------------");

    // 2. Storage Breakdown
    const storageUsed = usage.storage.usage;
    const storageCredit = usage.storage.credits_usage;
    console.log("STORAGE:");
    console.log(`  Occupied Storage:  ${formatBytes(storageUsed)}`);
    console.log(`  Credit Weight:     ${storageCredit} credits`);
    console.log("---------------------------------------------");

    // 3. Bandwidth Breakdown
    const bandwidthUsed = usage.bandwidth.usage;
    const bandwidthCredit = usage.bandwidth.credits_usage;
    console.log("BANDWIDTH:");
    console.log(`  Bandwidth Used:    ${formatBytes(bandwidthUsed)}`);
    console.log(`  Credit Weight:     ${bandwidthCredit} credits`);
    console.log("---------------------------------------------");

    // 4. Transformations Breakdown
    const transUsed = usage.transformations.usage;
    const transCredit = usage.transformations.credits_usage;
    console.log("TRANSFORMATIONS:");
    console.log(`  Count Executed:    ${transUsed} transformations`);
    console.log(`  Credit Weight:     ${transCredit} credits`);
    console.log("=============================================");

  } catch (error) {
    console.error("Error fetching Cloudinary usage stats:", error);
  }
}

checkUsage();
