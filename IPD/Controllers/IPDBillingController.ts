import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import IPDAdmission from "../Models/IPDAdmission.js";
import IPDExtraCharge from "../Models/IPDExtraCharge.js";
import IPDAdvancePayment from "../Models/IPDAdvancePayment.js";
import Transaction from "../../Admin/Models/Transaction.js";
import BedOccupancy from "../Models/BedOccupancy.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Bed from "../Models/Bed.js";
import redisService from "../../config/redis.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import PharmacyOrder from "../../Pharmacy/Models/PharmacyOrder.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import IPDMedicineIssuance from "../../Pharmacy/Models/IPDMedicineIssuance.js";
import { generateTransactionId, generateReceiptNumber } from "../../utils/idGenerator.js";
import { formatPatientDisplayName } from "../../utils/identityResolver.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import User from "../../Auth/Models/User.js";

// Helper to calculate total bill breakdown
export const calculateBillBreakdown = async (admissionId: string) => {
  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId).populate("patient");
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId }).populate("patient");
  }

  if (!admission) return null;
  let patientObj: any = admission.patient ? (admission.patient.toObject ? admission.patient.toObject() : { ...admission.patient }) : null;
  const patientId = admission.patient?._id || admission.patient;

  const profile: any = patientId
    ? await PatientProfile.findOne({
        $or: [{ user: patientId }, { _id: patientId }],
      }).lean()
    : null;

  if (profile && (!patientObj || !patientObj.name)) {
    const user = await User.findById(profile.user).select("name mobile honorific gender dateOfBirth age").lean();
    if (user) {
      patientObj = {
        _id: user._id,
        name: user.name,
        mobile: user.mobile,
        honorific: (user as any)?.honorific || (profile as any)?.honorific,
        gender: (user as any)?.gender || (profile as any)?.gender,
        dateOfBirth: (user as any)?.dateOfBirth || (profile as any)?.dateOfBirth,
        age: (user as any)?.age || (profile as any)?.age,
      };
    }
  }

  const rawHonorific = patientObj?.honorific || profile?.honorific || (admission as any)?.honorific || (admission as any)?.patientHonorific || "";
  const rawPatientName = patientObj?.name || profile?.name || "Unknown Patient";
  const formattedPatientName = formatPatientDisplayName(rawPatientName, rawHonorific);

  // 1. Calculate Bed Charges
  const occupancies = await BedOccupancy.find({
    admission: admission._id,
  }).sort({ startDate: 1 }); // Sort by time to find the first occupancy

  const bedIds = occupancies.map((occ) => occ.bed);
  const beds = await Bed.find({ _id: { $in: bedIds } }).lean();
  const bedMap = new Map();
  beds.forEach((b: any) => bedMap.set(b._id.toString(), b));

  const admissionStart = new Date(admission.admissionDate);
  let cutoff = new Date();
  if (admission.billLockedAt) {
    // Use the saved lock timestamp as cutoff regardless of whether the bill is currently
    // locked or temporarily unlocked (e.g. to apply a discount). This ensures bed charges
    // are always calculated up to the ORIGINAL lock time and never creep forward.
    cutoff = new Date(admission.billLockedAt);
  } else if (admission.status === "Discharged") {
    cutoff = admission.updatedAt ? new Date(admission.updatedAt) : new Date();
  }

  let totalBedCharge = 0;
  const bedDetails = occupancies.map((occ, index) => {
    // SECURITY: Use admissionDate for the first occupancy to ensure no gaps from the moment they are admitted
    let start = new Date(occ.startDate);
    if (index === 0 && start > admissionStart) {
      start = admissionStart;
    }

    const rawEnd = occ.endDate ? new Date(occ.endDate) : cutoff;
    const end = rawEnd > cutoff ? cutoff : rawEnd;
    const diffMs = Math.max(0, end.getTime() - start.getTime());
    const diffHours = diffMs / (1000 * 60 * 60);
    const fullDays = Math.floor(diffHours / 24);
    const remainingMs = diffMs % (1000 * 60 * 60 * 24);
    const remainingHours = remainingMs / (1000 * 60 * 60);

    let days: number;
    let charge: number;
    let readableDuration: string;
    const bedInfo: any = bedMap.get(occ.bed.toString());
    const rate = occ.dailyRateAtTime || bedInfo?.pricePerDay || 0;
    const halfDayRate = occ.halfDayRateAtTime !== undefined && occ.halfDayRateAtTime > 0 ? occ.halfDayRateAtTime : (bedInfo?.pricePerHalfDay !== undefined && bedInfo?.pricePerHalfDay > 0 ? bedInfo.pricePerHalfDay : Math.round(rate / 2));
    const hourlyRate = (occ.hourlyRateAtTime !== undefined && occ.hourlyRateAtTime > 0) ? occ.hourlyRateAtTime : (bedInfo?.pricePerHour !== undefined && bedInfo?.pricePerHour > 0 ? bedInfo.pricePerHour : (rate > 0 ? rate / 24 : 0));

    if (diffHours < 1) {
      const chargeableHours = Math.max(1, Math.ceil(diffHours));
      charge = Math.round(chargeableHours * hourlyRate);
      days = parseFloat((diffHours / 24).toFixed(2)) || 0.04;
    } else {
      const ceilRemainingHours = Math.ceil(remainingHours);
      if (ceilRemainingHours === 24) {
        charge = (fullDays + 1) * rate;
        days = fullDays + 1;
      } else {
        const remainderCharge = Math.min(rate, Math.round(ceilRemainingHours * hourlyRate));
        charge = (fullDays * rate) + remainderCharge;
        days = parseFloat((diffHours / 24).toFixed(2));
      }
    }

    // Human readable duration for this occupancy
    readableDuration = "";
    if (fullDays > 0) {
      readableDuration = `${fullDays} Day(s)${remainingHours >= 0.5 ? ` ${Math.ceil(remainingHours)} Hour(s)` : ""}`;
    } else if (remainingHours >= 1) {
      readableDuration = `${Math.ceil(remainingHours)} Hour(s)`;
    } else {
      readableDuration = `${Math.max(1, Math.ceil(remainingMs / (1000 * 60)))} Mins`;
    }

    totalBedCharge += charge;
    return {
      occupancyId: occ._id,
      bedId: bedInfo?.bedId || "Unknown",
      type: bedInfo?.type || "Unknown",
      days,
      readableDuration,
      rate,
      charge,
    };
  });

  // Calculate Total Admission Duration (STRICT READABLE LABEL)
  const totalAdmissionMs = cutoff.getTime() - admissionStart.getTime();
  const totalAdmissionHours = totalAdmissionMs / (1000 * 60 * 60);
  let totalStayReadable = "Less than a minute";

  if (totalAdmissionHours >= 24) {
    const totalDays = Math.floor(totalAdmissionHours / 24);
    const remainingHours = Math.ceil(totalAdmissionHours % 24);
    totalStayReadable = `${totalDays} Day(s)${remainingHours > 0 ? ` ${remainingHours} Hour(s)` : ""}`;
  } else if (totalAdmissionHours >= 1) {
    totalStayReadable = `${Math.ceil(totalAdmissionHours)} Hour(s)`;
  } else {
    const totalMins = Math.max(1, Math.ceil(totalAdmissionMs / (1000 * 60)));
    totalStayReadable = `${totalMins} Mins`;
  }

  // 2. Aggregate Extra Charges (manual charges like Nursing, OT, etc.)
  const extraCharges = await IPDExtraCharge.find({
    admission: admission._id,
    status: "Active",
  }).lean();
  const categoryBreakdown: any = {};
  let totalExtraCharge = 0;
  let totalReturnCredit = 0;

  extraCharges.forEach((charge) => {
    if (charge.category === "Pharmacy" && charge.amount < 0) {
      totalReturnCredit += Math.abs(charge.amount);
    } else {
      if (!categoryBreakdown[charge.category])
        categoryBreakdown[charge.category] = 0;
      categoryBreakdown[charge.category] += charge.amount;
      totalExtraCharge += charge.amount;
    }
  });

  // 2b. Aggregate Pharmacy Charges from PharmacyOrder (linked to this admission)
  const pharmaOrders = await PharmacyOrder.find({
    admission: admission._id,
    isDeleted: { $ne: true }
  }).lean();

  const pharmaOrderItems: any[] = [];
  let totalPharmaCharge = 0;

  pharmaOrders.forEach((order: any) => {
    const amount = order.totalAmount || 0;
    if (amount > 0) {
      // Avoid double-counting (manual pharmacy charges might have order ID)
      // Breakdown individual medicines
      const detailedMedicines = (order.medicines || []).map((m: any) => ({
        medicineName: m.name,
        quantity: m.quantity || 1,
        rate: m.price || 0,
        amount: (parseFloat(m.quantity || '1') * (m.price || 0)) || 0
      }));

      const existingIdx = extraCharges.findIndex(ec => 
        ((ec.category as any) === "Pharmacy" || (ec.category as any) === "Medicine") && 
        ec.description && 
        (
          ec.description.includes(order._id.toString()) ||
          (order.tokenNumber && ec.description.includes(order.tokenNumber)) ||
          ec.description.toLowerCase().includes("pharmacy issuance") ||
          ec.description.toLowerCase().includes("pharmacy order") ||
          ec.description.toLowerCase().includes("pharmacy") ||
          ec.description.toLowerCase().includes("medicine") ||
          detailedMedicines.some((m: any) => m.medicineName && ec.description.toLowerCase().includes(m.medicineName.toLowerCase()))
        )
      );

      if (existingIdx !== -1) {
        const ec = extraCharges[existingIdx];
        categoryBreakdown[ec.category as string] = (categoryBreakdown[ec.category as string] || 0) - ec.amount;
        totalExtraCharge -= ec.amount;
        extraCharges.splice(existingIdx, 1);
      }

      totalPharmaCharge += amount;
      
      pharmaOrderItems.push({
        _id: order._id,
        description: `Pharmacy Order (${order.tokenNumber || order._id})`,
        category: "Pharmacy",
        amount,
        date: order.createdAt,
        status: "Active",
        isPharmaOrder: true,
        medicines: detailedMedicines,
      });
    }
  });

  if (totalPharmaCharge > 0) {
    categoryBreakdown["Pharmacy"] = (categoryBreakdown["Pharmacy"] || 0) + totalPharmaCharge;
    totalExtraCharge += totalPharmaCharge;
  }

  // 2c. Aggregate Lab Charges from LabOrder (linked to this admission)
  const labOrders = await LabOrder.find({
    admission: admission._id,
  }).lean();

  const labOrderItems: any[] = [];
  let totalLabCharge = 0;

  labOrders.forEach((order: any) => {
    const amount = order.totalAmount || 0;
    if (amount > 0) {
      const orderTestNames = (order.tests || []).map((t: any) => {
        if (!t) return "";
        const val = t.testName || t.test?.testName || t.test?.name || (typeof t.test === "string" ? t.test : "");
        return String(val || "").trim();
      }).filter(Boolean);
      
      const orderTestsObjects = (order.tests || []).map((t: any) => {
        if (!t) return null;
        const val = t.testName || t.test?.testName || t.test?.name || (typeof t.test === "string" ? t.test : "");
        return {
           ...(typeof t === 'object' ? t : {}),
           testName: String(val || "").trim(),
           _id: t.testId || t.test?._id || t._id || order._id
        };
      }).filter((t: any) => t && t.testName);

      let unDiscountedAmount = amount;
      if (orderTestsObjects.length > 0) {
          let calcSub = 0;
          orderTestsObjects.forEach((t: any) => {
              const possiblePrices = [t.cost, t.price, t.amount, t.testPrice, t.test?.price, t.test?.cost, t.test?.amount, t.testId?.price, t.testId?.cost];
              const found = possiblePrices.find(val => val !== undefined && val !== null);
              if (found !== undefined) calcSub += Number(found);
          });
          if (calcSub > 0) unDiscountedAmount = calcSub;
      }

      const existingIdx = extraCharges.findIndex(ec => 
        ((ec.category as any) === "Lab" || (ec.category as any) === "Diagnostics" || (ec.category as any) === "Investigation" || ec.description?.toLowerCase().includes("blood") || ec.description?.toLowerCase().includes("test") || ec.description?.toLowerCase().includes("picture")) && 
        ec.description && 
        (
          ec.description.includes(order._id.toString()) ||
          (order.sampleId && ec.description.includes(order.sampleId)) ||
          ((order as any).tokenNumber && ec.description.includes((order as any).tokenNumber)) ||
          ec.description.toLowerCase().includes("lab order") ||
          ec.description.toLowerCase().includes("lab tests") ||
          ec.description.toLowerCase().includes("lab") ||
          ec.description.toLowerCase().includes("diagnostic") ||
          orderTestNames.some((tName: string) => ec.description.toLowerCase().includes(tName.toLowerCase()) || tName.toLowerCase().includes(ec.description.toLowerCase()))
        )
      );

      if (existingIdx !== -1) {
        const ec = extraCharges[existingIdx];
        categoryBreakdown[ec.category as string] = (categoryBreakdown[ec.category as string] || 0) - ec.amount;
        totalExtraCharge -= ec.amount;
        extraCharges.splice(existingIdx, 1);
      }

      totalLabCharge += unDiscountedAmount;
      const testNamesStr = orderTestNames.length > 0 ? orderTestNames.join(", ") : "Lab Tests";
      
      labOrderItems.push({
        _id: order._id,
        description: `${testNamesStr} (${order.sampleId || order._id})`,
        category: "Lab",
        amount: unDiscountedAmount,
        date: order.createdAt,
        status: "Active",
        isLabOrder: true,
        tests: orderTestsObjects.length > 0 ? orderTestsObjects : [testNamesStr],
      });
    }
  });

  if (totalLabCharge > 0) {
    categoryBreakdown["Lab"] = (categoryBreakdown["Lab"] || 0) + totalLabCharge;
    totalExtraCharge += totalLabCharge;
  }

  // 2d. Aggregate Medicine Issuances (Explicitly issued by Pharmacy)
  const medicineIssuances = await IPDMedicineIssuance.find({
    admission: admission._id,
  }).lean();

  medicineIssuances.forEach((issuance: any) => {
    const amount = issuance.totalAmount || 0;
    if (amount > 0) {
      const detailedMedicines = (issuance.items || []).map((m: any) => ({
        medicineName: m.productName,
        quantity: m.issuedQty || 1,
        rate: m.unitRate || 0,
        amount: m.totalAmount || 0
      }));

      // Check if medicines or issuance already exist in extraCharges
      const existingIdx = extraCharges.findIndex(ec => 
        ((ec.category as any) === "Pharmacy" || (ec.category as any) === "Medicine") && 
        ec.description && 
        (
          (issuance.invoiceNo && ec.description.includes(issuance.invoiceNo)) ||
          ec.description.toLowerCase().includes("pharmacy issuance") ||
          ec.description.toLowerCase().includes("pharmacy order") ||
          (ec.amount === amount && Math.abs(new Date(ec.date).getTime() - new Date(issuance.issuedAt).getTime()) < 60000) ||
          detailedMedicines.some((m: any) => m.medicineName && ec.description.toLowerCase().includes(m.medicineName.toLowerCase()))
        )
      );

      if (existingIdx !== -1) {
        const ec = extraCharges[existingIdx];
        categoryBreakdown[ec.category as string] = (categoryBreakdown[ec.category as string] || 0) - ec.amount;
        totalExtraCharge -= ec.amount;
        extraCharges.splice(existingIdx, 1);
      }

      // Check if it's already in pharmaOrderItems (from PharmacyOrder) to avoid duplicates
      const existsInOrders = pharmaOrderItems.some(poi => 
        (poi.amount === amount && Math.abs(new Date(poi.date).getTime() - new Date(issuance.issuedAt).getTime()) < 3600000) || // match by amount within 1 hr
        (poi.medicines && Array.isArray(poi.medicines) && detailedMedicines.some((dm: any) => dm.medicineName && poi.medicines.some((pm: any) => (pm.medicineName || "").toLowerCase() === dm.medicineName.toLowerCase())))
      );

      if (!existsInOrders) {
        pharmaOrderItems.push({
          _id: issuance._id,
          description: `Pharmacy Issuance (${issuance.invoiceNo || 'Manual'})`,
          category: "Pharmacy",
          amount,
          date: issuance.issuedAt,
          status: "Active",
          isPharmaOrder: true,
          medicines: detailedMedicines,
        });
        
        // Update category breakdown and total if we added a new item
        categoryBreakdown["Pharmacy"] = (categoryBreakdown["Pharmacy"] || 0) + amount;
        totalExtraCharge += amount;
      }
    }
  });

  // 3. Aggregate Advances
  const advances = await IPDAdvancePayment.find({ admission: admission._id });
  let totalAdvance = 0;
  let totalSettlementFromAdvances = 0; // Initialize settlement tracker

  advances.forEach((adv) => {
    if (adv.transactionType === "Advance") {
      totalAdvance += adv.amount;
    } else if (adv.transactionType === "Refund") {
      totalAdvance -= adv.amount;
    } else if (adv.transactionType === "Settlement") {
      totalSettlementFromAdvances += adv.amount;
    }
  });

  // 3b. Find transactions for linked orders (Pharmacy/Lab) that were paid at the counter
  // but might not be in IPDAdvancePayment collection
  const orderIds = [
    ...pharmaOrders.map((o) => o._id),
    ...labOrders.map((o) => o._id),
  ];
  
  if (orderIds.length > 0) {
    const externalTransactions = await Transaction.find({
      referenceId: { $in: orderIds },
      status: "completed",
    }).lean();

    externalTransactions.forEach((tx) => {
      // Avoid duplicates if it's already in advances (checked by receipt or reference)
      const exists = advances.some(
        (adv) =>
          adv.reference === tx.receiptNumber ||
          adv.reference === tx.transactionId ||
          (adv as any).transactionId === tx.transactionId
      );

      if (!exists) {
        const virtualPayment = {
          _id: tx._id,
          amount: tx.amount,
          mode: tx.paymentMode || "Other",
          transactionType: "Advance", // Treat as payment towards bill
          date: tx.date || tx.createdAt,
          reference: tx.receiptNumber || tx.transactionId,
          description: tx.type === "pharmacy" ? "Pharmacy Payment (Counter)" : "Lab Payment (Counter)",
          isExternal: true,
        };
        (advances as any).push(virtualPayment);
        totalAdvance += tx.amount;
      }
    });
  }

  // SMART FALLBACK: For existing/legacy patients, handle initial advance from IPDAdmission model
  const initialAdvance =
    admission.paymentStatus === "paid" && admission.amount > 0
      ? admission.amount
      : 0;

  // If the denormalized advancePaid or the initial amount is higher than the sum of records,
  // it means the initial payment wasn't recorded in the IPDAdvancePayment collection (legacy data)
  const denormalizedAdvance = Math.max(
    admission.advancePaid || 0,
    initialAdvance,
  );

  // Sum only direct (non-external) advance records to compare against denormalizedAdvance
  const directAdvanceTotal = advances
    .filter((a: any) => !a.isExternal)
    .reduce((sum: number, a: any) => {
      if (a.transactionType === "Advance") return sum + a.amount;
      if (a.transactionType === "Refund") return sum - a.amount;
      return sum;
    }, 0);

  if (denormalizedAdvance > directAdvanceTotal) {
    // Find the diff
    const diff = denormalizedAdvance - directAdvanceTotal;

    // Try to find the linked Transaction or Appointment to get the actual receipt number and payment mode
    const linkedTx: any = await Transaction.findOne({
      $or: [
        { referenceId: admission._id },
        { transactionId: admission.admissionId },
        { user: admission.patient, type: "ipd_advance", status: "completed" },
      ],
    }).sort({ createdAt: 1 }).lean();

    const resolvedReceipt = linkedTx?.receiptNumber || linkedTx?.transactionId || admission.admissionId || "ADV-INIT";
    const resolvedMode = (linkedTx?.paymentMode || admission.paymentMethod || "Cash").toUpperCase();

    // Add a virtual "Initial Payment" record so it shows up in the ledger
    const virtualAdvance = {
      _id: "virtual-initial-" + admission._id,
      amount: diff,
      mode: resolvedMode,
      paymentMode: resolvedMode,
      transactionType: "Advance",
      date: linkedTx?.date || admission.admissionDate || admission.createdAt,
      reference: resolvedReceipt,
      receiptNumber: resolvedReceipt,
      receiptNo: resolvedReceipt,
      description: "Opening Advance / Admission Fee",
      paymentDetails: linkedTx?.paymentDetails,
      isVirtual: true,
    };

    // Add to list and update total
    (advances as any).push(virtualAdvance);
    totalAdvance += diff;
  }

  // 4. Totals Calculation
  const extraChargesTotal = totalBedCharge + totalExtraCharge;
  const totalBill = extraChargesTotal - totalReturnCredit;
  const discount = admission.discountDetails?.amount || 0;
  const finalAmount = totalBill - discount;

  // Use both the legacy settlementPaid field from admission and the new tracked advances array
  const totalSettlement = Math.max((admission as any).settlementPaid || 0, totalSettlementFromAdvances);

  // Balance is total clinical charges minus all payments (advances + settlements) and discounts
  const balance = totalBill - totalAdvance - totalSettlement - discount;

  const calculateDetailedAge = (dobInput: any, fallbackAge: any, fallbackUnit: any) => {
    if (dobInput) {
      const birthDate = new Date(dobInput);
      if (!isNaN(birthDate.getTime())) {
        const today = new Date();
        let ageYears = today.getFullYear() - birthDate.getFullYear();
        let ageMonths = today.getMonth() - birthDate.getMonth();
        let ageDays = today.getDate() - birthDate.getDate();

        if (ageDays < 0) {
          ageMonths--;
          ageDays += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
        }
        if (ageMonths < 0) {
          ageYears--;
          ageMonths += 12;
        }

        if (ageYears > 0) {
          if (ageMonths > 0 && ageYears < 5) {
            return `${ageYears} ${ageYears === 1 ? 'Year' : 'Years'} ${ageMonths} ${ageMonths === 1 ? 'Month' : 'Months'}`;
          }
          return `${ageYears} ${ageYears === 1 ? 'Year' : 'Years'}`;
        }
        if (ageMonths > 0) {
          return `${ageMonths} ${ageMonths === 1 ? 'Month' : 'Months'}`;
        }
        if (ageDays > 0) {
          return `${ageDays} ${ageDays === 1 ? 'Day' : 'Days'}`;
        }
        return "0 Days";
      }
    }
    if (fallbackAge !== undefined && fallbackAge !== null && fallbackAge !== "" && fallbackAge !== "-") {
      const fallbackStr = String(fallbackAge).trim();
      const dMatch = fallbackStr.match(/^(\d+)\s*d(ays?)?$/i);
      if (dMatch) return `${dMatch[1]} ${dMatch[1] === '1' ? 'Day' : 'Days'}`;
      const mMatch = fallbackStr.match(/^(\d+)\s*m(os?|onths?)?$/i);
      if (mMatch) return `${mMatch[1]} ${mMatch[1] === '1' ? 'Month' : 'Months'}`;
      const yMatch = fallbackStr.match(/^(\d+)\s*y(rs?|ears?)?$/i);
      if (yMatch) return `${yMatch[1]} ${yMatch[1] === '1' ? 'Year' : 'Years'}`;

      const rawUnit = String(fallbackUnit || "").trim().toLowerCase();
      const unit = rawUnit.startsWith("d") ? (fallbackStr === "1" ? "Day" : "Days") :
                   rawUnit.startsWith("m") ? (fallbackStr === "1" ? "Month" : "Months") :
                   (fallbackStr === "1" ? "Year" : "Years");
      if (fallbackStr.match(/(Y|Mos|Days|Month|Day|Yr|Yrs|Years|Months)$/i)) return fallbackStr;
      return `${fallbackAge} ${unit}`;
    }
    return "";
  };

  const patientDob = patientObj?.dob || patientObj?.dateOfBirth || profile?.dob || profile?.dateOfBirth || (admission.patient as any)?.dob || (admission.patient as any)?.dateOfBirth;
  const rawFallbackAge = patientObj?.age ?? profile?.age ?? "";
  const rawFallbackUnit = patientObj?.ageUnit || profile?.ageUnit || "Years";
  const patientAgeString = calculateDetailedAge(patientDob, rawFallbackAge, rawFallbackUnit);

  return {
    admissionId: admission.admissionId,
    patientName: formattedPatientName,
    rawPatientName: rawPatientName,
    patientHonorific: rawHonorific,
    honorific: rawHonorific,
    dob: patientDob || "",
    patientDob: patientDob || "",
    patientAge: patientAgeString,
    patientAgeUnit: rawFallbackUnit,
    patientGender: patientObj?.gender || profile?.gender || "",
    bedCharges: {
      items: bedDetails,
      total: totalBedCharge,
      totalStayReadable,
    },
    extraCharges: {
      // Merge manual extra charges + lab order + pharma order charges into a single flat list
      items: [...extraCharges, ...labOrderItems, ...pharmaOrderItems],
      categoryBreakdown,
      total: totalExtraCharge,
    },
    financials: {
      totalBill,
      discount,
      finalAmount,
      totalAdvance,
      totalSettlement,
      totalPaid: totalAdvance + totalSettlement,
      remainingAmount: Math.max(0, totalBill - totalAdvance), // Amount left to be settled
      balance,
      returnCredits: totalReturnCredit,
    },
    advances: advances.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    ),
    isBillLocked: admission.isBillLocked,
    billLockedAt: admission.billLockedAt,
    status: admission.status,
  };
};

export const addExtraCharge = asyncHandler(async (req: any, res: Response) => {
  const { admissionId, category, description, amount, date } = req.body;

  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId);
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId });
  }

  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.isBillLocked)
    throw new ApiError(400, "Bill is locked. Cannot add charges.");

  const charge = await IPDExtraCharge.create({
    patient: admission.patient,
    globalPatientId: admission.patient,
    admission: admission._id,
    hospital: admission.hospital,
    category,
    description,
    amount,
    date: date || new Date(),
    addedBy: req.user._id,
  });

  // Update aggregate total on admission
  await IPDAdmission.findByIdAndUpdate(admission._id, {
    $inc: { totalBilledAmount: amount },
  });

  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  res.status(201).json(charge);
});

export const removeExtraCharge = asyncHandler(
  async (req: any, res: Response) => {
    const { chargeId } = req.params;

    const charge = await IPDExtraCharge.findById(chargeId);
    if (!charge) throw new ApiError(404, "Charge not found");

    const admission = await IPDAdmission.findById(charge.admission);
    if (!admission) throw new ApiError(404, "Admission not found");
    if (admission.isBillLocked)
      throw new ApiError(400, "Bill is locked. Cannot remove charges.");

    // Decrease the total billed amount
    await IPDAdmission.findByIdAndUpdate(admission._id, {
      $inc: { totalBilledAmount: -charge.amount },
    });

    // Delete the charge
    await IPDExtraCharge.findByIdAndDelete(chargeId);

    // Clear cache
    await redisService.del(`ipd:bill:${admission._id}`);
    await redisService.del(`ipd:bill:${admission.admissionId}`);

    res.json({ message: "Charge removed successfully" });
  },
);

export const updateExtraCharge = asyncHandler(
  async (req: any, res: Response) => {
    const { chargeId } = req.params;
    const { category, description, amount, date } = req.body;

    const charge = await IPDExtraCharge.findById(chargeId);
    if (!charge) throw new ApiError(404, "Charge not found");

    const admission = await IPDAdmission.findById(charge.admission);
    if (!admission) throw new ApiError(404, "Admission not found");
    if (admission.isBillLocked)
      throw new ApiError(400, "Bill is locked. Cannot update charges.");

    // Calculate difference to update the admission total billed amount
    const amountDifference = amount - charge.amount;

    // Update the charge
    charge.category = category || charge.category;
    charge.description = description || charge.description;
    charge.amount = amount !== undefined ? amount : charge.amount;
    charge.date = date || charge.date;
    await charge.save();

    // Update the total billed amount in admission
    if (amountDifference !== 0) {
      await IPDAdmission.findByIdAndUpdate(admission._id, {
        $inc: { totalBilledAmount: amountDifference },
      });
    }

    // Clear cache
    await redisService.del(`ipd:bill:${admission._id}`);
    await redisService.del(`ipd:bill:${admission.admissionId}`);

    res.json({ message: "Charge updated successfully", charge });
  },
);

export const addAdvancePayment = asyncHandler(
  async (req: any, res: Response) => {
    const { admissionId, amount, mode, reference, transactionType, date, paymentDetails } =
      req.body;

    let admission: any = null;
    if (mongoose.Types.ObjectId.isValid(admissionId)) {
      admission = await IPDAdmission.findById(admissionId);
    }

    if (!admission) {
      admission = await IPDAdmission.findOne({ admissionId });
    }

    if (!admission) throw new ApiError(404, "Admission not found");

    const effectiveTransactionType = transactionType || (admission.status === "Discharge Initiated" ? "Settlement" : "Advance");
    
    // Generate Receipt Number
    const receiptNumber = await generateReceiptNumber(admission.hospital);
    
    // Get hospital name for transaction ID
    const hospital = await Hospital.findById(admission.hospital).select("name");
    const hospitalName = hospital?.name || "HOSPITAL";
    
    const typeMap: any = { "Advance": "IPD", "Settlement": "IPD", "Refund": "IPD" };
    const transactionId = await generateTransactionId(admission.hospital, hospitalName, typeMap[effectiveTransactionType] || "IPD");

    // Sanitize and map payment mode to match enum: ["Cash", "Card", "Bank Transfer", "Cheque", "Digital Wallet", "Insurance", "Corporate/Sponsor"]
    let sanitizedMode = mode;
    if (typeof mode === "string") {
      const lowerMode = mode.toLowerCase();
      if (lowerMode === "cash") sanitizedMode = "Cash";
      else if (lowerMode === "card") sanitizedMode = "Card";
      else if (lowerMode === "bank" || lowerMode === "bank transfer" || lowerMode === "bank_transfer") sanitizedMode = "Bank Transfer";
      else if (lowerMode === "cheque") sanitizedMode = "Cheque";
      else if (lowerMode === "upi" || lowerMode === "digital wallet" || lowerMode === "wallet" || lowerMode === "mobile money" || lowerMode === "mobile_money") sanitizedMode = "Digital Wallet";
      else if (lowerMode === "insurance" || lowerMode === "insure" || lowerMode === "tpa") sanitizedMode = "Insurance";
      else if (lowerMode === "corporate" || lowerMode === "sponsor" || lowerMode === "corporate/sponsor") sanitizedMode = "Corporate/Sponsor";
    }

    const payment = await IPDAdvancePayment.create({
      patient: admission.patient,
      globalPatientId: admission.patient,
      admission: admission._id,
      hospital: admission.hospital,
      amount,
      mode: sanitizedMode,
      paymentDetails,
      reference: reference || receiptNumber, // Use generated receipt number as reference if none provided
      transactionType: effectiveTransactionType,
      date: date || new Date(),
      receivedBy: req.user._id,
    });

    // Update aggregate totals on admission
    const updateQuery: any = { $inc: {} };
    if (effectiveTransactionType === "Settlement" || effectiveTransactionType === "Due Recovery") {
      updateQuery.$inc.settlementPaid = amount;

      // ✅ SYNC PHARMACY ORDERS: Mark all linked pharmacy orders as PAID
      try {
        const pharmaUpdate = await PharmacyOrder.updateMany(
          { admission: admission._id, hospital: admission.hospital },
          { $set: { paymentStatus: "paid" } }
        );
        console.log(`[Billing Sync] Marked ${pharmaUpdate.modifiedCount} pharmacy orders as PAID for admission ${admission.admissionId}`);

        // ✅ SYNC LAB ORDERS: Mark all linked lab orders as PAID
        const labUpdate = await LabOrder.updateMany(
          { admission: admission._id, hospital: admission.hospital },
          { $set: { paymentStatus: "paid" } }
        );
        console.log(`[Billing Sync] Marked ${labUpdate.modifiedCount} lab orders as PAID for admission ${admission.admissionId}`);
      } catch (syncErr) {
        console.error("[Billing Sync] Failed to sync payment status:", syncErr);
      }
    } else if (effectiveTransactionType === "Refund") {
      updateQuery.$inc.advancePaid = -amount;
    } else {
      // Default to "Advance" or "Interim Payment"
      updateQuery.$inc.advancePaid = amount;
    }

    await IPDAdmission.findByIdAndUpdate(admission._id, updateQuery);

    const normalizedMode = mode?.toLowerCase() || "cash";
    const validTransactionModes = ["cash", "upi", "card", "mixed", "other"];
    const transactionMode = validTransactionModes.includes(normalizedMode)
      ? normalizedMode
      : "other"; // 'insurance', 'bank transfer' fall into 'other'

    // ✅ RECORD TRANSACTION: For Helpdesk Financial Tracking & Super Admin Revenue
    await Transaction.create({
      user: admission.patient,
      userModel: "Patient",
      hospital: admission.hospital,
      amount: Number(amount),
      type: effectiveTransactionType === "Settlement" ? "ipd_settlement" :
        effectiveTransactionType === "Refund" ? "ipd_refund" : "ipd_advance",
      status: "completed",
      referenceId: admission._id,
      transactionId: transactionId,
      receiptNumber: receiptNumber,
      date: date || new Date(),
      paymentMode: transactionMode,
      paymentDetails: paymentDetails || {
        cash: transactionMode === "cash" ? Number(amount) : 0,
        upi: transactionMode === "upi" ? Number(amount) : 0,
        card: transactionMode === "card" ? Number(amount) : 0,
      },
    });

    await redisService.del(`ipd:bill:${admission._id}`);
    await redisService.del(`ipd:bill:${admission.admissionId}`);

    res.status(201).json(payment);
  },
);

export const getBillSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { admissionId } = req.params;

    // Check cache
    const cached = await redisService.get(`ipd:bill:${admissionId}`);
    if (cached) return res.json(cached);

    const breakdown = await calculateBillBreakdown(admissionId);
    if (!breakdown) throw new ApiError(404, "Admission not found");

    await redisService.set(`ipd:bill:${admissionId}`, breakdown, 60); // Cache for 1 min
    res.json(breakdown);
  },
);

export const applyDiscount = asyncHandler(async (req: any, res: Response) => {
  const { admissionId, amount, reason } = req.body;

  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId);
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId });
  }

  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.isBillLocked) throw new ApiError(400, "Bill is locked.");

  admission.discountDetails = {
    amount,
    reason,
    approvedBy: req.user._id,
  };
  await admission.save();

  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  res.json({
    message: "Discount applied successfully",
    discountDetails: admission.discountDetails,
  });
});

export const lockBill = asyncHandler(async (req: any, res: Response) => {
  const { admissionId } = req.params;
  const { preserveOriginalCutoff } = req.body || {};

  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId);
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId });
  }

  if (!admission) throw new ApiError(404, "Admission not found");

  admission.isBillLocked = true;
  // If preserveOriginalCutoff is requested and a previous billLockedAt exists, keep it
  if (preserveOriginalCutoff && admission.billLockedAt) {
    // Keep existing billLockedAt timestamp
  } else {
    admission.billLockedAt = new Date();
  }
  if (req.user?._id) {
    admission.billLockedBy = req.user._id;
  }
  await admission.save();

  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  res.json({
    message: "Bill locked successfully. Bed charges calculation stopped at lock time. No further changes allowed.",
    isBillLocked: true,
    billLockedAt: admission.billLockedAt,
  });
});

export const unlockBill = asyncHandler(async (req: any, res: Response) => {
  const { admissionId } = req.params;

  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId);
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId });
  }

  if (!admission) throw new ApiError(404, "Admission not found");

  admission.isBillLocked = false;
  // NOTE: billLockedAt is intentionally preserved here.
  // Clearing it would reset the bed-charge cutoff to the current time, causing the
  // patient to be billed for the extra minutes spent unlocked (e.g. while applying a
  // discount). The original lock timestamp remains the charge cutoff until a new lock
  // is explicitly created via lockBill().
  admission.billLockedBy = null;
  await admission.save();

  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  res.json({
    message: "Bill unlocked successfully. Bed charges calculation resumed. Charges and discounts can now be modified.",
    isBillLocked: false,
    billLockedAt: null,
  });
});

export const updateBedOccupancyCharge = asyncHandler(async (req: any, res: Response) => {
  const { occupancyId } = req.params;
  const { dailyRate } = req.body;

  if (dailyRate === undefined || dailyRate < 0) {
    throw new ApiError(400, "Valid daily rate is required");
  }

  const occupancy = await BedOccupancy.findById(occupancyId);
  if (!occupancy) {
    throw new ApiError(404, "Bed occupancy not found");
  }

  const admission = await IPDAdmission.findById(occupancy.admission);
  if (!admission) {
    throw new ApiError(404, "Admission not found");
  }
  
  if (admission.isBillLocked) {
    throw new ApiError(400, "Bill is locked. Cannot update charges.");
  }

  occupancy.dailyRateAtTime = dailyRate;
  occupancy.halfDayRateAtTime = dailyRate / 2;
  occupancy.hourlyRateAtTime = dailyRate / 24;

  await occupancy.save();

  // Clear cache
  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  await redisService.del(`ipd:bed:details:${occupancy.bed}`);

  res.json({ message: "Bed charge updated successfully", occupancy });
});

/**
 * POST /api/v1/ipd/billing/charge/merge
 * Merges multiple extra charge documents into a single consolidated row.
 * Body: { primaryChargeId, mergeChargeIds: string[], mergedDescription, mergedAmount }
 */
export const mergeExtraCharges = asyncHandler(async (req: any, res: Response) => {
  const { primaryChargeId, mergeChargeIds, mergedDescription, mergedAmount } = req.body;

  if (!primaryChargeId || !Array.isArray(mergeChargeIds) || mergeChargeIds.length === 0) {
    throw new ApiError(400, "primaryChargeId and at least one mergeChargeId are required");
  }

  const primaryCharge = await IPDExtraCharge.findById(primaryChargeId);
  if (!primaryCharge) throw new ApiError(404, "Primary charge not found");

  const admission = await IPDAdmission.findById(primaryCharge.admission);
  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.isBillLocked) throw new ApiError(400, "Bill is locked. Cannot merge charges.");

  // Collect secondary charges and validate they belong to the same admission
  const secondaryCharges = await IPDExtraCharge.find({
    _id: { $in: mergeChargeIds },
    admission: admission._id,
  });

  if (secondaryCharges.length !== mergeChargeIds.length) {
    throw new ApiError(400, "One or more secondary charges not found or belong to a different admission");
  }

  // Total amount of secondary charges being removed
  const secondaryTotal = secondaryCharges.reduce((sum: number, c: any) => sum + c.amount, 0);

  // Net adjustment = mergedAmount - primaryCharge.amount - secondaryTotal
  const netAdjustment = Number(mergedAmount) - Number(primaryCharge.amount) - secondaryTotal;

  // Preserve constituent original charges for unmerge
  const originalPrimary = {
    _id: primaryCharge._id,
    patient: primaryCharge.patient,
    globalPatientId: primaryCharge.globalPatientId,
    admission: primaryCharge.admission,
    hospital: primaryCharge.hospital,
    category: primaryCharge.category,
    description: primaryCharge.description,
    amount: primaryCharge.amount,
    date: primaryCharge.date,
    addedBy: primaryCharge.addedBy,
    status: primaryCharge.status,
  };

  const originalSecondaries = secondaryCharges.map((c: any) => ({
    _id: c._id,
    patient: c.patient,
    globalPatientId: c.globalPatientId,
    admission: c.admission,
    hospital: c.hospital,
    category: c.category,
    description: c.description,
    amount: c.amount,
    date: c.date,
    addedBy: c.addedBy,
    status: c.status,
  }));

  // Update primary charge
  primaryCharge.isMerged = true;
  primaryCharge.mergedFrom = [originalPrimary, ...originalSecondaries];
  primaryCharge.description = mergedDescription;
  primaryCharge.amount = Number(mergedAmount);
  await primaryCharge.save();

  // Delete secondary charges
  await IPDExtraCharge.deleteMany({ _id: { $in: mergeChargeIds } });

  // Adjust admission total only if there is a discrepancy (should be 0 in normal use)
  if (netAdjustment !== 0) {
    await IPDAdmission.findByIdAndUpdate(admission._id, {
      $inc: { totalBilledAmount: netAdjustment },
    });
  }

  // Clear cache
  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);

  res.json({
    message: "Charges merged successfully",
    primaryCharge,
    mergedCount: secondaryCharges.length,
  });
});

/**
 * POST /api/v1/ipd/billing/charge/unmerge
 * Restores a merged extra charge back into its original individual charges.
 * Body: { chargeId: string }
 */
export const unmergeExtraCharges = asyncHandler(async (req: any, res: Response) => {
  const { chargeId } = req.body;

  if (!chargeId) {
    throw new ApiError(400, "chargeId is required");
  }

  const mergedCharge = await IPDExtraCharge.findById(chargeId);
  if (!mergedCharge) throw new ApiError(404, "Charge not found");
  const admission = await IPDAdmission.findById(mergedCharge.admission);
  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.isBillLocked) throw new ApiError(400, "Bill is locked. Cannot unmerge charges.");

  if (Array.isArray(mergedCharge.mergedFrom) && mergedCharge.mergedFrom.length >= 2) {
    const [originalPrimary, ...originalSecondaries] = mergedCharge.mergedFrom;

    // Restore primary charge back to its original state
    mergedCharge.description = originalPrimary.description;
    mergedCharge.amount = Number(originalPrimary.amount);
    mergedCharge.category = (originalPrimary.category || mergedCharge.category) as any;
    mergedCharge.isMerged = false;
    mergedCharge.mergedFrom = undefined;
    await mergedCharge.save();

    // Re-create the secondary charges
    const restoredSecondaries = originalSecondaries.map((sec: any) => ({
      patient: sec.patient || mergedCharge.patient,
      globalPatientId: sec.globalPatientId || mergedCharge.globalPatientId,
      admission: sec.admission || mergedCharge.admission,
      hospital: sec.hospital || mergedCharge.hospital,
      category: (sec.category || mergedCharge.category) as any,
      description: sec.description,
      amount: Number(sec.amount),
      date: sec.date || new Date(),
      addedBy: sec.addedBy || mergedCharge.addedBy,
      status: sec.status || "Active",
    }));

    if (restoredSecondaries.length > 0) {
      await IPDExtraCharge.insertMany(restoredSecondaries);
    }
  } else {
    // Dynamic Fallback: unmerge charges based on Qty/Days or multi-duration text
    const desc = mergedCharge.description || "";
    const totalAmt = Number(mergedCharge.amount || 0);

    // 1. Check for (Qty/Days: N) where N > 1
    const qtyMatch = desc.match(/\((?:Qty\/Days|Qty|Days):\s*([0-9.]+)\)/i);
    if (qtyMatch && parseFloat(qtyMatch[1]) > 1) {
      const qty = Math.round(parseFloat(qtyMatch[1]));
      const baseName = desc.replace(/\s*\((?:Qty\/Days|Qty|Days):\s*[0-9.]+\)/i, "").trim();
      const perAmt = Math.round(totalAmt / qty);

      // Primary charge gets 1 portion
      mergedCharge.description = `${baseName} (Qty/Days: 1)`;
      mergedCharge.amount = perAmt;
      mergedCharge.isMerged = false;
      mergedCharge.mergedFrom = undefined;
      await mergedCharge.save();

      // Create remaining secondary charges
      let allocated = perAmt;
      const newCharges: any[] = [];
      for (let i = 1; i < qty; i++) {
        const isLast = i === qty - 1;
        const amt = isLast ? (totalAmt - allocated) : perAmt;
        allocated += amt;
        newCharges.push({
          patient: mergedCharge.patient,
          globalPatientId: mergedCharge.globalPatientId,
          admission: mergedCharge.admission,
          hospital: mergedCharge.hospital,
          category: mergedCharge.category,
          description: `${baseName} (Qty/Days: 1)`,
          amount: amt,
          date: mergedCharge.date || new Date(),
          addedBy: mergedCharge.addedBy,
          status: "Active",
        });
      }
      if (newCharges.length > 0) {
        await IPDExtraCharge.insertMany(newCharges);
      }
    } else {
      // 2. Check for multi-duration text (e.g. "24 HOURS  6HOURS 14MINTUES" or "2DAYS 5HOURS 1DAY")
      const parenMatch = desc.match(/\(([^)]+)\)\s*$/);
      if (parenMatch) {
        const inner = parenMatch[1];
        const baseName = desc.replace(/\s*\([^)]+\)\s*$/, "").trim();

        // Tokenize duration units: DAYS -> HOURS -> MINS
        const tokenRegex = /(\d+)\s*(DAYS?|HOURS?|HRS?|MIN\w*)/gi;
        const tokens: { text: string; val: number; unit: string }[] = [];
        let m: RegExpExecArray | null;
        while ((m = tokenRegex.exec(inner)) !== null) {
          const u = m[2].toUpperCase();
          tokens.push({
            text: m[0],
            val: parseInt(m[1]),
            unit: u.startsWith("D") ? "D" : u.startsWith("H") ? "H" : "M",
          });
        }

        const unitOrder: Record<string, number> = { D: 1, H: 2, M: 3 };
        const segments: string[] = [];
        let currentSeg: string[] = [];
        let lastUnit = 0;

        for (const t of tokens) {
          const ord = unitOrder[t.unit];
          if (currentSeg.length > 0 && ord <= lastUnit) {
            segments.push(currentSeg.join(" "));
            currentSeg = [];
          }
          currentSeg.push(t.text);
          lastUnit = ord;
        }
        if (currentSeg.length > 0) segments.push(currentSeg.join(" "));

        if (segments.length >= 2) {
          const parseMins = (str: string) => {
            const d = parseInt(str.match(/(\d+)\s*DAYS?/i)?.[1] || "0");
            const h = parseInt(str.match(/(\d+)\s*HOURS?/i)?.[1] || "0");
            const min = parseInt(str.match(/(\d+)\s*MIN/i)?.[1] || "0");
            return d * 1440 + h * 60 + min;
          };

          const segMins = segments.map(parseMins);
          const totalMins = segMins.reduce((a, b) => a + b, 0);

          const firstAmt = totalMins > 0 ? Math.round((segMins[0] / totalMins) * totalAmt) : Math.round(totalAmt / segments.length);
          mergedCharge.description = `${baseName} (${segments[0].trim()})`;
          mergedCharge.amount = firstAmt;
          mergedCharge.isMerged = false;
          mergedCharge.mergedFrom = undefined;
          await mergedCharge.save();

          let allocated = firstAmt;
          const newCharges: any[] = [];
          for (let i = 1; i < segments.length; i++) {
            const isLast = i === segments.length - 1;
            const amt = isLast ? (totalAmt - allocated) : (totalMins > 0 ? Math.round((segMins[i] / totalMins) * totalAmt) : Math.round(totalAmt / segments.length));
            allocated += amt;
            newCharges.push({
              patient: mergedCharge.patient,
              globalPatientId: mergedCharge.globalPatientId,
              admission: mergedCharge.admission,
              hospital: mergedCharge.hospital,
              category: mergedCharge.category,
              description: `${baseName} (${segments[i].trim()})`,
              amount: amt,
              date: mergedCharge.date || new Date(),
              addedBy: mergedCharge.addedBy,
              status: "Active",
            });
          }
          if (newCharges.length > 0) {
            await IPDExtraCharge.insertMany(newCharges);
          }
        } else {
          throw new ApiError(400, "Cannot determine individual constituent charges to unmerge");
        }
      } else {
        throw new ApiError(400, "This charge does not contain multiple durations or quantities to unmerge");
      }
    }
  }

  // Clear cache
  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);

  res.json({
    message: "Charges unmerged successfully",
    primaryCharge: mergedCharge,
  });
});
