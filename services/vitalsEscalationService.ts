import VitalsAlert from "../IPD/Models/VitalsAlert.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import VitalsThresholdTemplate from "../IPD/Models/VitalsThresholdTemplate.js";
import VitalThreshold from "../IPD/Models/VitalThreshold.js";
import { createNotification } from "../Notification/Controllers/notificationController.js";
import User from "../Auth/Models/User.js";

/**
 * Periodically check for alerts that need escalation
 */
export const initEscalationService = () => {
  console.log("🚀 Vitals Escalation Service Initialized");

  // Run every 5 minutes
  setInterval(
    async () => {
      try {
        await runEscalationCheck();
      } catch (error) {
        console.error("Escalation check failed:", error);
      }
    },
    5 * 60 * 1000,
  );
};

const runEscalationCheck = async () => {
  // Find active alerts that are not yet escalated
  // NOTE: Do NOT use .populate() here — populate triggers internal sub-queries
  // that run without tenant context and get blocked by the MT security plugin.
  // Instead, manually fetch related documents with .unscoped().
  const activeAlerts = await (
    VitalsAlert.find({
      status: "Active",
      isEscalated: false,
    }) as any
  ).unscoped();

  for (const alert of activeAlerts) {
    if (!alert.admission) continue;

    // Manually fetch the admission with unscoped to bypass tenant middleware
    const admission: any = await (IPDAdmission.findById(alert.admission) as any)
      .unscoped()
      .lean();
    if (!admission) continue;

    // 1. Get the patient's ward template
    let template = await (
      VitalsThresholdTemplate.findOne({
        hospital: alert.hospital,
        wardType: admission.admissionType,
        isActive: true,
      }) as any
    ).unscoped();

    if (!template) {
      template = await (
        VitalsThresholdTemplate.findOne({
          hospital: alert.hospital,
          templateName: /General/i,
          isActive: true,
        }) as any
      ).unscoped();
    }

    if (!template) continue;

    // 2. Get the specific threshold for this vital
    // Handle glucose naming convention
    const threshold = await (
      VitalThreshold.findOne({
        templateId: template._id,
        vitalName: alert.vitalName,
      }) as any
    ).unscoped();

    if (!threshold) continue;

    // 3. Check time elapsed
    const escalationMinutes =
      alert.severity === "Critical"
        ? threshold.escalationCriticalMinutes
        : threshold.escalationWarningMinutes;

    const minutesActive =
      (Date.now() - (alert as any).createdAt.getTime()) / (1000 * 60);

    if (minutesActive >= escalationMinutes) {
      await escalatedAlert(alert, admission, escalationMinutes);
    }
  }
};

const escalatedAlert = async (alert: any, admission: any, mins: number) => {
  console.log(
    `📡 Escalating alert for ${alert.vitalName} - Active for ${Math.floor(mins)} mins`,
  );

  // Fetch patient name
  const Patient = (await import("../Patient/Models/Patient.js")).default;
  const patientData = await (Patient.findById(admission.patient) as any)
    .unscoped()
    .select("name")
    .lean();
  const patientName = (patientData as any)?.name || "Patient";
  const patientIdentifier = `${patientName} (${admission.admissionId})`;

  // 1. Mark as escalated
  alert.isEscalated = true;
  alert.auditLog.push({
    action: "System Escalated",
    user: alert.hospital, // System action
    notes: `Vital remained in ${alert.severity} state beyond ${mins} minutes.`,
  });
  await alert.save();

  // 2. Trigger High-Priority Notification
  // Notify primary doctor and nursing supervisor (role based)
  const clinicians = await (
    User.find({
      hospital: alert.hospital,
      role: { $in: ["doctor", "hospital-admin"] },
      isActive: true,
    }) as any
  )
    .unscoped()
    .select("_id");

  for (const clinician of clinicians) {
    await createNotification(null, {
      hospital: alert.hospital,
      recipient: clinician._id,
      sender: alert.hospital, // System ID
      type: "Emergency",
      message: `🆘 ESCALATION [${patientIdentifier}]: ${alert.vitalName} is ${alert.value} (${alert.severity}). Persistent for > ${mins} mins.`,
      relatedId: alert._id,
    });
  }
};
