import mongoose from "mongoose";
import User from "../../Auth/Models/User.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";
import PharmacyOrder from "../../Pharmacy/Models/PharmacyOrder.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import LabTest from "../../Lab/Models/LabTest.js";
import { Request, Response } from "express";
import Prescription from "../Models/Prescription.js";
import CustomMedicine from "../../Doctor/Models/CustomMedicine.js";
import CardiologyPrescription from "../Models/CardiologyPrescription.js";
import DermatologyPrescription from "../Models/DermatologyPrescription.js";
import ENTExamination from "../Models/ENTExamination.js";
import PediatricsExamination from "../Models/PediatricsExamination.js";
import GynecologyExamination from "../Models/GynecologyExamination.js";
import NeurologyExamination from "../Models/NeurologyExamination.js";
import GastroExamination from "../Models/GastroExamination.js";
import NephrologyExamination from "../Models/NephrologyExamination.js";
import OphthalmologyExamination from "../Models/OphthalmologyExamination.js";
import OrthopedicExamination from "../Models/OrthopedicExamination.js";
import PulmonologyExamination from "../Models/PulmonologyExamination.js";
import PsychiatryExamination from "../Models/PsychiatryExamination.js";
import EndocrinologyExamination from "../Models/EndocrinologyExamination.js";
import HematologyExamination from "../Models/HematologyExamination.js";
import OncologyExamination from "../Models/OncologyExamination.js";
import DentistryExamination from "../Models/DentistryExamination.js";
import UrologyExamination from "../Models/UrologyExamination.js";
import GeneralSurgeryExamination from "../Models/GeneralSurgeryExamination.js";
import RadiologyOrder from "../Models/RadiologyOrder.js";
import RadiologyReport from "../Models/RadiologyReport.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import PharmacyToken from "../../Pharmacy/Models/PharmacyToken.js";
import LabToken from "../../Lab/Models/LabToken.js";
import Patient from "../../Patient/Models/Patient.js";
import IPDExtraCharge from "../../IPD/Models/IPDExtraCharge.js";
import redisService from "../../config/redis.js";

interface PrescriptionRequest extends Request {
  user?: any;
}

// Sanitization Helpers to prevent Mongoose Enum Validation Errors
const sanitizeEnum = (val: any, allowed: string[]) => (allowed.includes(val) ? val : undefined);
const sanitizeArray = (arr: any[], allowed: string[]) => (Array.isArray(arr) ? arr.filter(v => allowed.includes(v)) : []);

// Create prescription
export const createPrescription = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      appointmentId,
      diagnosis,
      symptoms,
      medicines,
      advice,
      dietAdvice,
      suggestedTests,
      avoid,
      followUpDate,
      notes,
      aiGenerated,
      admissionId,
      age,
      gender,
      sendToPharma = true,
      dermatologyData,
      cardiologyData,
      entData,
      pediatricData,
      gynaecData,
      gastroData,
      nephroData,
      ophthaData,
      orthopedicData: orthoData,
      pulmoData,
      psychiatryData,
      endocrinologyData,
      hematologyData,
      oncologyData,
      dentistryData,
      urologyData,
      generalSurgeryData,
    } = req.body;
    const doctorId = req.user?._id;

    console.log(
      `[CreatePrescription] Initiated. AdmissionId: ${admissionId}, ApptId: ${appointmentId}`,
    );

    if (!appointmentId && !req.body.patientId) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ message: "Appointment ID or Patient ID is required" });
    }

    let patient: any, doctor: any, hospital: any;
    let appointment: any = null;
    let patientName = "Patient";

    if (appointmentId) {
      appointment = await (Appointment.findById(appointmentId) as any)
        .unscoped()
        .populate("patient", "name")
        .session(session);
      if (!appointment) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Appointment not found" });
      }
      patient = appointment.patient?._id || appointment.patient;
      patientName = appointment.patient?.name || "Patient";
      doctor = appointment.doctor;
      hospital = appointment.hospital;
    } else {
      // Direct prescription
      patient = req.body.patientId;
      const patientData = await (Patient.findById(patient) as any).unscoped().select("name").lean();
      if (patientData) patientName = patientData.name;
      
      const doctorProfile = await DoctorProfile.findOne({
        user: doctorId,
      }).session(session);
      if (!doctorProfile) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Doctor profile not found" });
      }
      doctor = doctorProfile._id;
      hospital = doctorProfile.hospital;
    }

    // Logic for Admission (IPD) linking
    let admissionObjectId: any = null;
    if (admissionId) {
      const admissionRecord = await IPDAdmission.findOne({
        admissionId,
      }).session(session);
      if (admissionRecord) {
        if (admissionRecord.status !== "Active") {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            message:
              "Cannot add prescription for a non-active admission (Discharged/Cancelled)",
          });
        }
        admissionObjectId = admissionRecord._id;
      }
    } else {
      const activeAdmission = await IPDAdmission.findOne({
        patient: patient,
        status: "Active",
        hospital: hospital,
      }).session(session);
      if (activeAdmission) {
        admissionObjectId = activeAdmission._id;
      }
    }

    // 1. Create Prescription
    const prescription = new Prescription({
      appointment: appointmentId || undefined,
      patient,
      globalPatientId: patient,
      doctor,
      hospital,
      admission: admissionObjectId || undefined,
      diagnosis,
      symptoms: symptoms || [],
      medicines: (medicines || []).map((m: any) => ({
        ...m,
        duration: (typeof m.duration === 'string' && m.duration.trim() !== '') ? m.duration.trim() : 'As directed',
      })),
      advice: advice || "",
      dietAdvice: dietAdvice || [],
      suggestedTests: suggestedTests || [],
      avoid: avoid || [],
      followUpDate: followUpDate || null,
      notes: notes || "",
      aiGenerated: aiGenerated || false,
    });

    await prescription.save({ session });

    // Collect non-blocking specialty save warnings to surface to frontend
    const specialtyWarnings: string[] = [];

    // 1b. Create DermatologyPrescription (if dermatology data provided)
    if (dermatologyData && (dermatologyData.lesionType || dermatologyData.location?.length > 0 || dermatologyData.notes)) {
      try {
        const dermPrescription = new DermatologyPrescription({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          lesionType: dermatologyData.lesionType,
          lesionCount: dermatologyData.lesionCount || undefined,
          size: dermatologyData.size || undefined,
          location: dermatologyData.location || [],
          distribution: dermatologyData.distribution || undefined,
          color: dermatologyData.color || [],
          surfaceChanges: dermatologyData.surfaceChanges || [],
          itchingSeverity: dermatologyData.itchingSeverity || "None",
          painSeverity: dermatologyData.painSeverity || "None",
          burning: dermatologyData.burning || false,
          duration: dermatologyData.duration || undefined,
          onset: dermatologyData.onset || undefined,
          progression: dermatologyData.progression || undefined,
          provisionalDiagnosis: dermatologyData.provisionalDiagnosis || undefined,
          notes: dermatologyData.notes || undefined,
        });
        await dermPrescription.save({ session });
        console.log(`[CreatePrescription] DermatologyPrescription saved: ${dermPrescription._id}`);
      } catch (dermErr: any) {
        console.error("[CreatePrescription] Failed to save DermatologyPrescription:", dermErr.message);
        specialtyWarnings.push(`Dermatology: ${dermErr.message}`);
      }
    }

    // 1c. Create CardiologyPrescription (if cardiology data provided)
    if (cardiologyData && (cardiologyData.bpSystolic || cardiologyData.heartRate || cardiologyData.ecgType || cardiologyData.symptoms?.length > 0)) {
      try {
        const cardioPrescription = new CardiologyPrescription({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          bpSystolic: cardiologyData.bpSystolic,
          bpDiastolic: cardiologyData.bpDiastolic,
          heartRate: cardiologyData.heartRate,
          rhythm: cardiologyData.rhythm,
          symptoms: cardiologyData.symptoms || [],
          riskFactors: cardiologyData.riskFactors || [],
          ecgType: cardiologyData.ecgType,
          ecgLeads: cardiologyData.ecgLeads || [],
          ecgNotes: cardiologyData.ecgNotes,
          s1: cardiologyData.s1,
          s2: cardiologyData.s2,
          murmur: cardiologyData.murmur,
          murmurType: cardiologyData.murmurType,
          riskLevel: cardiologyData.riskLevel,
          nyhaClass: cardiologyData.nyhaClass,
          notes: cardiologyData.notes,
        });
        await cardioPrescription.save({ session });
        console.log(`[CreatePrescription] CardiologyPrescription saved: ${cardioPrescription._id}`);
      } catch (cardioErr: any) {
        console.error("[CreatePrescription] Failed to save CardiologyPrescription:", cardioErr.message);
        specialtyWarnings.push(`Cardiology: ${cardioErr.message}`);
      }
    }

    // 1d. Create ENTExamination (if ENT data provided)
    // Broad check: any ear, hearing, nose, throat, voice, symptom, or duration field filled
    const entHasData = entData && (
      entData.symptoms?.length > 0 ||
      entData.ear?.left?.externalEar   || entData.ear?.left?.earCanal?.length > 0  || entData.ear?.left?.tympanicMembrane  ||
      entData.ear?.right?.externalEar  || entData.ear?.right?.earCanal?.length > 0 || entData.ear?.right?.tympanicMembrane ||
      entData.hearing?.status          || entData.hearing?.tuningForkTest?.length > 0 ||
      entData.nose?.mucosa             || entData.nose?.septum     || entData.nose?.discharge ||
      entData.throat?.tonsils          || entData.throat?.pharynx  || entData.throat?.uvula  ||
      entData.lymphNodes?.cervical     ||
      entData.voice?.quality           || entData.voice?.airway    ||
      entData.duration                 || entData.notes
    );

    if (entHasData) {
      try {
        // Sanitize earCanal arrays — only keep valid enum values to prevent Mongoose validation failure
        const VALID_EAR_CANAL = ["Clear", "Wax", "Discharge", "Foreign Body"];
        const sanitizeCanal = (arr: any[]) =>
          (arr || []).filter((v: string) => VALID_EAR_CANAL.includes(v));

        const entExamination = new ENTExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          ear: {
            left: {
              externalEar:       entData.ear?.left?.externalEar       || undefined,
              earCanal:          sanitizeCanal(entData.ear?.left?.earCanal),
              tympanicMembrane:  entData.ear?.left?.tympanicMembrane  || undefined,
            },
            right: {
              externalEar:       entData.ear?.right?.externalEar      || undefined,
              earCanal:          sanitizeCanal(entData.ear?.right?.earCanal),
              tympanicMembrane:  entData.ear?.right?.tympanicMembrane || undefined,
            },
          },
          hearing: {
            status:        entData.hearing?.status        || undefined,
            tuningForkTest: entData.hearing?.tuningForkTest || [],
          },
          nose: {
            mucosa:    entData.nose?.mucosa    || undefined,
            septum:    entData.nose?.septum    || undefined,
            discharge: entData.nose?.discharge || undefined,
          },
          throat: {
            tonsils: entData.throat?.tonsils || undefined,
            pharynx: entData.throat?.pharynx || undefined,
            uvula:   entData.throat?.uvula   || undefined,
          },
          lymphNodes: {
            cervical:  entData.lymphNodes?.cervical  || undefined,
            sizeCm:    entData.lymphNodes?.sizeCm    ? parseFloat(entData.lymphNodes.sizeCm) : undefined,
            tender:    entData.lymphNodes?.tender    || undefined,
            mobility:  entData.lymphNodes?.mobility  || undefined,
          },
          voice: {
            quality: entData.voice?.quality || undefined,
            airway:  entData.voice?.airway  || undefined,
          },
          symptoms: entData.symptoms || [],
          duration: entData.duration || undefined,
          notes:    entData.notes    || undefined,
        });
        await entExamination.save({ session });
        console.log(`[CreatePrescription] ENTExamination saved: ${entExamination._id}`);
      } catch (entErr: any) {
        console.error("[CreatePrescription] Failed to save ENTExamination:", entErr.message);
        specialtyWarnings.push(`ENT: ${entErr.message}`);
      }
    }

    // 1e. Create PediatricsExamination (if pediatric data provided)
    if (pediatricData && (pediatricData.weight || pediatricData.height || pediatricData.temperature || pediatricData.heartRate || pediatricData.respRate || pediatricData.milestones || pediatricData.symptoms?.length > 0 || pediatricData.notes)) {
      try {
        const pediatricExamination = new PediatricsExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          weight: pediatricData.weight,
          height: pediatricData.height,
          headCircumference: pediatricData.headCircumference,
          temperature: pediatricData.temperature,
          heartRate: pediatricData.heartRate,
          respRate: pediatricData.respRate,
          growth: pediatricData.growth || {},
          milestones: pediatricData.milestones,
          milestoneNotes: pediatricData.milestoneNotes,
          immunizationStatus: pediatricData.immunizationStatus,
          dueVaccines: pediatricData.dueVaccines || [],
          symptoms: pediatricData.symptoms || [],
          redFlags: pediatricData.redFlags || [],
          notes: pediatricData.notes,
        });
        await pediatricExamination.save({ session });
        console.log(`[CreatePrescription] PediatricsExamination saved: ${pediatricExamination._id}`);
      } catch (pedsErr: any) {
        console.error("[CreatePrescription] Failed to save PediatricsExamination:", pedsErr.message);
        specialtyWarnings.push(`Pediatrics: ${pedsErr.message}`);
      }
    }

    // 1f. Create GynecologyExamination (if gynaec data provided)
    if (gynaecData && (gynaecData.lmp || gynaecData.pregnant || gynaecData.symptoms?.length > 0 || gynaecData.gestationalAge || gynaecData.notes)) {
      try {
        const gynExamination = new GynecologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          lmp: new Date(gynaecData.lmp),
          cycleLength: gynaecData.cycleLength || undefined,
          cycleRegularity: gynaecData.cycleRegularity || undefined,
          flowDuration: gynaecData.flowDuration || undefined,
          flowType: gynaecData.flowType || undefined,
          obstetric: gynaecData.obstetric || {},
          pregnant: gynaecData.pregnant,
          gestationalAge: gynaecData.pregnant === "Yes" ? gynaecData.gestationalAge : undefined,
          edd: gynaecData.pregnant === "Yes" && gynaecData.edd ? new Date(gynaecData.edd) : undefined,
          symptoms: gynaecData.symptoms || [],
          vitals: gynaecData.vitals || {},
          obstetricExam: gynaecData.pregnant === "Yes" ? (gynaecData.obstetricExam || {}) : undefined,
          gynExam: gynaecData.gynExam || {},
          investigations: gynaecData.investigations || [],
          notes: gynaecData.notes || undefined,
        });
        await gynExamination.save({ session });
        console.log(`[CreatePrescription] GynecologyExamination saved: ${gynExamination._id}`);
      } catch (gynErr: any) {
        console.error("[CreatePrescription] Failed to save GynecologyExamination:", gynErr.message);
        specialtyWarnings.push(`Gynecology: ${gynErr.message}`);
      }
    }

    // 1g. Create NeurologyExamination (if neuro data provided)
    const { neuroData } = req.body;
    if (
      neuroData &&
      (neuroData.symptoms?.length > 0 || neuroData.gcs?.eye || neuroData.mentalStatus || neuroData.notes)
    ) {
      try {
        // Auto-calculate GCS total
        const gcsTotal =
          (parseInt(neuroData.gcs.eye) || 0) +
          (parseInt(neuroData.gcs.verbal) || 0) +
          (parseInt(neuroData.gcs.motor) || 0);

        const neuroExamination = new NeurologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          gcs: {
            eye:    parseInt(neuroData.gcs.eye),
            verbal: parseInt(neuroData.gcs.verbal),
            motor:  parseInt(neuroData.gcs.motor),
            total:  gcsTotal,
          },
          mentalStatus:       neuroData.mentalStatus,
          motorPower: {
            ru: parseInt(neuroData.motorPower.ru),
            lu: parseInt(neuroData.motorPower.lu),
            rl: parseInt(neuroData.motorPower.rl),
            ll: parseInt(neuroData.motorPower.ll),
          },
          reflexes:              neuroData.reflexes,
          cranialNerves:         neuroData.cranialNerves,
          cranialNerveDeficits:  neuroData.cranialNerves === "Abnormal" ? (neuroData.cranialNerveDeficits || []) : [],
          sensory:               neuroData.sensory,
          coordination:          neuroData.coordination,
          symptoms:              neuroData.symptoms || [],
          onset:                 neuroData.onset,
          notes:                 neuroData.notes || undefined,
        });
        await neuroExamination.save({ session });
        console.log(`[CreatePrescription] NeurologyExamination saved: ${neuroExamination._id}`);
      } catch (neuroErr: any) {
        console.error("[CreatePrescription] Failed to save NeurologyExamination:", neuroErr.message);
        specialtyWarnings.push(`Neurology: ${neuroErr.message}`);
      }
    }

    // 1h. Create GastroExamination (if gastro data provided)
    if (gastroData && (gastroData.symptoms?.length > 0 || gastroData.diagnosis || gastroData.notes || gastroData.painLocation || gastroData.bowelHabits)) {
      try {
        const gastroExam = new GastroExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          symptoms:     gastroData.symptoms || [],
          painLocation: gastroData.painLocation || "",
          painType:     gastroData.painType     || "",
          bowelHabits:  gastroData.bowelHabits  || "Normal",
          stoolType:    gastroData.stoolType    || "Normal",
          bowelSounds:  gastroData.bowelSounds  || "Normal",
          distention:   gastroData.distention   || "None",
          tenderness:   gastroData.tenderness   || "None",
          liver: {
            status: gastroData.liver?.status || "Not palpable",
            size:   gastroData.liver?.status === "Enlarged" && gastroData.liver?.size !== "" ? parseFloat(gastroData.liver?.size) : undefined,
          },
          spleen: { status: gastroData.spleen?.status || "Not palpable" },
          guarding:     gastroData.guarding     || "None",
          diagnosis:    gastroData.diagnosis    || "",
          notes:        gastroData.notes        || undefined,
        });
        await gastroExam.save({ session });
        console.log(`[CreatePrescription] GastroExamination saved: ${gastroExam._id}`);
      } catch (gastroErr: any) {
        console.error("[CreatePrescription] Failed to save GastroExamination:", gastroErr.message);
        specialtyWarnings.push(`Gastroenterology: ${gastroErr.message}`);
      }
    }

    // 1i. Create NephrologyExamination (if nephro data provided)
    if (nephroData && (nephroData.creatinine || nephroData.egfr || nephroData.urineOutput || nephroData.symptoms?.length > 0)) {
      try {
        const nephroExam = new NephrologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          // A. Renal Function
          creatinine: parseFloat(nephroData.creatinine),
          urea:       nephroData.urea ? parseFloat(nephroData.urea) : undefined,
          egfr:       parseFloat(nephroData.egfr),
          // B. Electrolytes
          electrolytes: {
            sodium:      nephroData.electrolytes?.sodium      ? parseFloat(nephroData.electrolytes.sodium)      : undefined,
            potassium:   nephroData.electrolytes?.potassium   ? parseFloat(nephroData.electrolytes.potassium)   : undefined,
            bicarbonate: nephroData.electrolytes?.bicarbonate ? parseFloat(nephroData.electrolytes.bicarbonate) : undefined,
          },
          // C. Urine Output
          urineOutput: parseFloat(nephroData.urineOutput),
          // D. Urine Analysis
          urineAnalysis: {
            protein: nephroData.urineAnalysis?.protein || "Nil",
            sugar:   nephroData.urineAnalysis?.sugar   || "Nil",
            rbc:     nephroData.urineAnalysis?.rbc     || "Nil",
          },
          // E. Fluid Balance
          fluidBalance: {
            intake: nephroData.fluidBalance?.intake ? parseFloat(nephroData.fluidBalance.intake) : undefined,
            output: nephroData.fluidBalance?.output ? parseFloat(nephroData.fluidBalance.output) : undefined,
          },
          // F. Edema
          edema: nephroData.edema || "None",
          // G. Dialysis
          dialysis: {
            status:      nephroData.dialysis?.status      || "Not on dialysis",
            frequency:   nephroData.dialysis?.frequency   || undefined,
            lastSession: nephroData.dialysis?.lastSession ? new Date(nephroData.dialysis.lastSession) : undefined,
            access:      nephroData.dialysis?.access      || "",
          },
          // H. Symptoms
          symptoms: nephroData.symptoms || [],
          // I. CKD Stage
          ckdStage: nephroData.ckdStage || "",
          notes:    nephroData.notes    || undefined,
        });
        await nephroExam.save({ session });
        console.log(`[CreatePrescription] NephrologyExamination saved: ${nephroExam._id}`);
      } catch (nephroErr: any) {
        console.error("[CreatePrescription] Failed to save NephrologyExamination:", nephroErr.message);
        specialtyWarnings.push(`Nephrology: ${nephroErr.message}`);
      }
    }

    // 1j. Create OphthalmologyExamination (if ophtha data provided)
    if (ophthaData && (ophthaData.vision?.od?.unaided || ophthaData.symptoms?.length > 0 || ophthaData.diagnosis || ophthaData.notes)) {
      try {
        const ophthalmologyExam = new OphthalmologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          // A. Vision
          vision: {
            od: { unaided: ophthaData.vision.od.unaided, corrected: ophthaData.vision.od.corrected || "" },
            os: { unaided: ophthaData.vision.os.unaided, corrected: ophthaData.vision.os.corrected || "" },
          },
          // B. Refraction
          refraction: {
            od: {
              sph:  ophthaData.refraction?.od?.sph  ? parseFloat(ophthaData.refraction.od.sph)  : undefined,
              cyl:  ophthaData.refraction?.od?.cyl  ? parseFloat(ophthaData.refraction.od.cyl)  : undefined,
              axis: ophthaData.refraction?.od?.axis ? parseFloat(ophthaData.refraction.od.axis) : undefined,
            },
            os: {
              sph:  ophthaData.refraction?.os?.sph  ? parseFloat(ophthaData.refraction.os.sph)  : undefined,
              cyl:  ophthaData.refraction?.os?.cyl  ? parseFloat(ophthaData.refraction.os.cyl)  : undefined,
              axis: ophthaData.refraction?.os?.axis ? parseFloat(ophthaData.refraction.os.axis) : undefined,
            },
          },
          // C. IOP
          iop: {
            od: ophthaData.iop?.od ? parseFloat(ophthaData.iop.od) : undefined,
            os: ophthaData.iop?.os ? parseFloat(ophthaData.iop.os) : undefined,
          },
          // D. Pupils
          pupils: ophthaData.pupils || "",
          // E. Symptoms
          symptoms: ophthaData.symptoms || [],
          // F. Slit Lamp
          slitLamp: {
            conjunctiva:     ophthaData.slitLamp?.conjunctiva     || "",
            cornea:          ophthaData.slitLamp?.cornea          || "",
            anteriorChamber: ophthaData.slitLamp?.anteriorChamber || "",
            lens:            ophthaData.slitLamp?.lens            || "",
          },
          // G. Fundus
          fundus: {
            retina:    ophthaData.fundus?.retina    || "",
            opticDisc: ophthaData.fundus?.opticDisc || "",
            macula:    ophthaData.fundus?.macula    || "",
          },
          // H. Diagnosis
          diagnosis: ophthaData.diagnosis || "",
          notes:     ophthaData.notes     || undefined,
        });
        await ophthalmologyExam.save({ session });
        console.log(`[CreatePrescription] OphthalmologyExamination saved: ${ophthalmologyExam._id}`);
      } catch (ophthaErr: any) {
        console.error("[CreatePrescription] Failed to save OphthalmologyExamination:", ophthaErr.message);
        specialtyWarnings.push(`Ophthalmology: ${ophthaErr.message}`);
      }
    }

    // 1k. Create OrthopedicExamination (if orthopedic data provided)
    if (orthoData && (orthoData.joint || orthoData.symptoms?.length > 0 || orthoData.diagnosis || orthoData.notes)) { // orthoData is aliased from orthopedicData (sent by frontend)
      try {
        const orthoExam = new OrthopedicExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          joint: orthoData.joint,
          side:  orthoData.side,
          pain: {
            score: parseInt(orthoData.pain?.score) || 0,
            type:  orthoData.pain?.type  || "",
          },
          rom: orthoData.rom,
          exam: {
            swelling:   orthoData.exam?.swelling   || "",
            tenderness: orthoData.exam?.tenderness || "",
            deformity:  orthoData.exam?.deformity  || "",
            spasm:      orthoData.exam?.spasm      || "",
          },
          motorPower: orthoData.motorPower !== undefined ? parseInt(orthoData.motorPower) : undefined,
          neurovascular: {
            sensation: orthoData.neurovascular?.sensation || "",
            pulse:     orthoData.neurovascular?.pulse     || "",
          },
          specialTests: orthoData.specialTests || [],
          imaging: {
            xray: orthoData.imaging?.xray || "",
            mri:  orthoData.imaging?.mri  || "",
          },
          diagnosis: orthoData.diagnosis || "",
          notes:     orthoData.notes     || undefined,
        });
        await orthoExam.save({ session });
        console.log(`[CreatePrescription] OrthopedicExamination saved: ${orthoExam._id}`);
      } catch (orthoErr: any) {
        console.error("[CreatePrescription] Failed to save OrthopedicExamination:", orthoErr.message);
        specialtyWarnings.push(`Orthopedics: ${orthoErr.message}`);
      }
    }

    // 1l. Create PulmonologyExamination (if pulmonology data provided)
    if (pulmoData && (pulmoData.vitals?.respRate || pulmoData.vitals?.spo2 || pulmoData.symptoms?.length > 0 || pulmoData.notes)) {
      try {
        const pulmoExam = new PulmonologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          vitals: {
            respRate:      parseInt(pulmoData.vitals.respRate) || 0,
            spo2:          parseInt(pulmoData.vitals.spo2)     || 0,
            oxygenSupport: pulmoData.vitals.oxygenSupport      || "Room Air",
          },
          symptoms:  pulmoData.symptoms || [],
          mmrcGrade: pulmoData.mmrcGrade !== undefined ? parseInt(pulmoData.mmrcGrade) : undefined,
          exam: {
            chestExpansion:   pulmoData.exam?.chestExpansion,
            accessoryMuscles: pulmoData.exam?.accessoryMuscles,
          },
          auscultation: {
            airEntry: pulmoData.auscultation?.airEntry,
            sounds:   pulmoData.auscultation?.sounds || [],
          },
          peakFlow:  pulmoData.peakFlow ? parseInt(pulmoData.peakFlow) : undefined,
          diagnosis: pulmoData.diagnosis,
          severity:  pulmoData.severity,
          notes:     pulmoData.notes,
        });
        await pulmoExam.save({ session });
        console.log(`[CreatePrescription] PulmonologyExamination saved: ${pulmoExam._id}`);
      } catch (pulmoErr: any) {
        console.error("[CreatePrescription] Failed to save PulmonologyExamination:", pulmoErr.message);
        specialtyWarnings.push(`Pulmonology: ${pulmoErr.message}`);
      }
    }

    // 1n. Create PsychiatryExamination (if psychiatry data provided)
    if (psychiatryData && (psychiatryData.complaints?.length > 0 || psychiatryData.suicideRisk || psychiatryData.mse?.mood || psychiatryData.notes)) {
      try {
        const psychExam = new PsychiatryExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          complaints: psychiatryData.complaints || [],
          severity:   psychiatryData.severity,
          duration:   parseInt(psychiatryData.duration),
          mse: {
            behavior:   psychiatryData.mse?.behavior,
            speech:     psychiatryData.mse?.speech,
            mood:       psychiatryData.mse?.mood,
            thought:    psychiatryData.mse?.thought || [],
            perception: psychiatryData.mse?.perception,
            insight:    parseInt(psychiatryData.mse?.insight),
            judgment:   parseInt(psychiatryData.mse?.judgment),
          },
          suicideRisk: psychiatryData.suicideRisk || "None",
          scores: {
            phq9: parseInt(psychiatryData.scores?.phq9),
            gad7: parseInt(psychiatryData.scores?.gad7),
          },
          substanceUse: psychiatryData.substanceUse || [],
          medicationCompliance: psychiatryData.medicationCompliance,
          sideEffects: psychiatryData.sideEffects || [],
          counseling:  psychiatryData.counseling,
          notes:       psychiatryData.notes,
        });
        await psychExam.save({ session });
        console.log(`[CreatePrescription] PsychiatryExamination saved: ${psychExam._id}`);
      } catch (psychErr: any) {
        console.error("[CreatePrescription] Failed to save PsychiatryExamination:", psychErr.message);
        specialtyWarnings.push(`Psychiatry: ${psychErr.message}`);
      }
    }

    // 1o. Create EndocrinologyExamination (if endocrinology data provided)
    if (endocrinologyData && (endocrinologyData.glycemic?.fbs || endocrinologyData.thyroid?.tsh || endocrinologyData.symptoms?.length > 0 || endocrinologyData.notes)) {
      try {
        const endoExam = new EndocrinologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          glycemic: {
            fbs:   parseFloat(endocrinologyData.glycemic?.fbs)   || 0,
            ppbs:  parseFloat(endocrinologyData.glycemic?.ppbs)  || 0,
            hba1c: parseFloat(endocrinologyData.glycemic?.hba1c) || 0,
          },
          thyroid: {
            tsh: parseFloat(endocrinologyData.thyroid?.tsh) || 0,
            t3:  parseFloat(endocrinologyData.thyroid?.t3)  || 0,
            t4:  parseFloat(endocrinologyData.thyroid?.t4)  || 0,
          },
          weight: parseFloat(endocrinologyData.weight),
          height: parseFloat(endocrinologyData.height),
          bmi:    parseFloat(endocrinologyData.bmi),
          symptoms: endocrinologyData.symptoms || [],
          pcos: {
            irregularCycles: !!endocrinologyData.pcos?.irregularCycles,
            hirsutism:       !!endocrinologyData.pcos?.hirsutism,
            acne:            !!endocrinologyData.pcos?.acne,
            infertility:     !!endocrinologyData.pcos?.infertility,
          },
          complications: endocrinologyData.complications || [],
          medicationType: endocrinologyData.medicationType || [],
          notes: endocrinologyData.notes,
        });
        await endoExam.save({ session });
        console.log(`[CreatePrescription] EndocrinologyExamination saved: ${endoExam._id}`);
      } catch (endoErr: any) {
        console.error("[CreatePrescription] Failed to save EndocrinologyExamination:", endoErr.message);
        specialtyWarnings.push(`Endocrinology: ${endoErr.message}`);
      }
    }
    
    // 1p. Create HematologyExamination (if hematology data provided)
    if (hematologyData && (hematologyData.cbc?.hb || hematologyData.symptoms?.length > 0 || hematologyData.diagnosis || hematologyData.notes)) {
      try {
        const hematologyExam = new HematologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          cbc: {
            hb:        parseFloat(hematologyData.cbc.hb),
            tlc:       parseFloat(hematologyData.cbc.tlc),
            platelets: parseFloat(hematologyData.cbc.platelets),
            esr:       hematologyData.cbc.esr ? parseFloat(hematologyData.cbc.esr) : undefined,
          },
          rbcIndices: {
            mcv:  hematologyData.rbcIndices?.mcv  ? parseFloat(hematologyData.rbcIndices.mcv)  : undefined,
            mch:  hematologyData.rbcIndices?.mch  ? parseFloat(hematologyData.rbcIndices.mch)  : undefined,
            mchc: hematologyData.rbcIndices?.mchc ? parseFloat(hematologyData.rbcIndices.mchc) : undefined,
          },
          coagulation: {
            pt:   hematologyData.coagulation?.pt   ? parseFloat(hematologyData.coagulation.pt)   : undefined,
            inr:  parseFloat(hematologyData.coagulation.inr),
            aptt: hematologyData.coagulation?.aptt ? parseFloat(hematologyData.coagulation.aptt) : undefined,
          },
          symptoms:    hematologyData.symptoms || [],
          transfusion: {
            product:    hematologyData.transfusion?.product    || "",
            units:      hematologyData.transfusion?.units      ? parseInt(hematologyData.transfusion.units) : 0,
            indication: hematologyData.transfusion?.indication || "",
          },
          diagnosis:   hematologyData.diagnosis || "",
          notes:       hematologyData.notes     || undefined,
        });
        await hematologyExam.save({ session });
        console.log(`[CreatePrescription] HematologyExamination saved: ${hematologyExam._id}`);
      } catch (hemaErr: any) {
        console.error("[CreatePrescription] Failed to save HematologyExamination:", hemaErr.message);
        specialtyWarnings.push(`Hematology: ${hemaErr.message}`);
      }
    }

    // 1q. Create OncologyExamination (if oncology data provided)
    if (oncologyData && (oncologyData.diagnosis || oncologyData.site || oncologyData.notes)) {
      try {
        const oncologyExam = new OncologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          body: {
            weight: parseFloat(oncologyData.body.weight),
            height: parseFloat(oncologyData.body.height),
            bsa:    parseFloat(oncologyData.body.bsa),
          },
          diagnosis:  oncologyData.diagnosis,
          site:       oncologyData.site,
          ecog:       parseInt(oncologyData.ecog),
          biomarkers: oncologyData.biomarkers || [],
          tnm: {
            t:     oncologyData.tnm?.t || "",
            n:     oncologyData.tnm?.n || "",
            m:     oncologyData.tnm?.m || "",
            stage: oncologyData.tnm?.stage || "",
          },
          treatment: {
            intent:   oncologyData.treatment?.intent || "",
            modality: oncologyData.treatment?.modality || [],
            regimen:  oncologyData.treatment?.regimen || "",
          },
          chemo: (oncologyData.chemo || []).map((c: any) => ({
            drug:      c.drug,
            dosePerM2: parseFloat(c.dosePerM2),
            totalDose: parseFloat(c.totalDose),
            cycle:     parseInt(c.cycle),
            day:       parseInt(c.day),
            route:     c.route,
            preMeds:   c.preMeds,
            notes:     c.notes,
          })),
          labs: {
            hb:         parseFloat(oncologyData.labs?.hb),
            anc:        parseFloat(oncologyData.labs?.anc),
            platelets:  parseFloat(oncologyData.labs?.platelets),
            creatinine: parseFloat(oncologyData.labs?.creatinine),
            lft:        parseFloat(oncologyData.labs?.lft),
          },
          toxicity: oncologyData.toxicity || [],
          notes:    oncologyData.notes || undefined,
        });
        await oncologyExam.save({ session });
        console.log(`[CreatePrescription] OncologyExamination saved: ${oncologyExam._id}`);
      } catch (oncoErr: any) {
        console.error("[CreatePrescription] Failed to save OncologyExamination:", oncoErr.message);
        specialtyWarnings.push(`Oncology: ${oncoErr.message}`);
      }
    }

    // 1r. Create DentistryExamination (if dentistry data provided)
    if (dentistryData && (dentistryData.teeth?.length > 0 || dentistryData.procedure || dentistryData.notes)) {
      try {
        const dentistryExam = new DentistryExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          painScale: dentistryData.painScale || 0,
          duration: dentistryData.duration || "",
          teeth: (dentistryData.teeth || []).map((t: any) => ({
            toothNumber: t.toothNumber,
            condition: t.condition,
            mobilityGrade: parseInt(t.mobilityGrade) || 0,
            tenderness: !!t.tenderness,
            cariesDepth: t.cariesDepth || "None",
            diagnosis: t.diagnosis,
          })),
          oralFindings: {
            caries: dentistryData.oralFindings?.caries || "None",
            gingivitis: dentistryData.oralFindings?.gingivitis || "None",
            abscess: !!dentistryData.oralFindings?.abscess,
            mobility: dentistryData.oralFindings?.mobility || "None",
            plaqueIndex: dentistryData.oralFindings?.plaqueIndex || "Low",
          },
          extraOral: {
            facialSwelling: !!dentistryData.extraOral?.facialSwelling,
            lymphNodes: !!dentistryData.extraOral?.lymphNodes,
            tmjPain: !!dentistryData.extraOral?.tmjPain,
          },
          systemicRisks: {
            onBloodThinners: !!dentistryData.systemicRisks?.onBloodThinners,
            diabetic: !!dentistryData.systemicRisks?.diabetic,
            diabetesControl: dentistryData.systemicRisks?.diabetesControl || "N/A",
          },
          procedure: dentistryData.procedure,
          medications: dentistryData.medications || [],
          notes: dentistryData.notes || undefined,
        });
        await dentistryExam.save({ session });
        console.log(`[CreatePrescription] DentistryExamination saved: ${dentistryExam._id}`);
      } catch (dentErr: any) {
        console.error("[CreatePrescription] Failed to save DentistryExamination:", dentErr.message);
        specialtyWarnings.push(`Dentistry: ${dentErr.message}`);
      }
    }

    // 1s. Create UrologyExamination (if urology data provided)
    if (urologyData && (
      urologyData.diagnosis || 
      (urologyData.symptoms && urologyData.symptoms.length > 0) || 
      urologyData.pvr || 
      urologyData.notes || 
      urologyData.ipss?.score || 
      urologyData.renal?.creatinine ||
      urologyData.stone?.size ||
      urologyData.prostate?.size ||
      urologyData.catheter?.present
    )) {
      try {
        const urologyExam = new UrologyExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          symptoms: urologyData.symptoms || [],
          ipss: {
            score: parseInt(urologyData.ipss?.score) || 0,
            category: (parseInt(urologyData.ipss?.score) || 0) <= 7 ? "Mild" : (parseInt(urologyData.ipss?.score) || 0) <= 19 ? "Moderate" : "Severe",
          },
          urine: {
            pusCells: parseInt(urologyData.urine?.pusCells) || 0,
            rbc:      parseInt(urologyData.urine?.rbc) || 0,
            protein:  urologyData.urine?.protein || "Nil",
            nitrite:  !!urologyData.urine?.nitrite,
          },
          renal: {
            creatinine: parseFloat(urologyData.renal?.creatinine) || 0,
            urea:       parseFloat(urologyData.renal?.urea) || 0,
          },
          stone: {
            size:     parseFloat(urologyData.stone?.size) || 0,
            location: urologyData.stone?.location || "",
          },
          prostate: {
            size:        urologyData.prostate?.size || "",
            consistency: urologyData.prostate?.consistency || "",
            nodules:     !!urologyData.prostate?.nodules,
          },
          pvr: parseFloat(urologyData.pvr) || 0,
          catheter: {
            present:  !!urologyData.catheter?.present,
            type:     urologyData.catheter?.type || "",
            duration: urologyData.catheter?.duration || "",
            reason:   urologyData.catheter?.reason || "",
          },
          diagnosis: urologyData.diagnosis || diagnosis || "Urology Clearance",
          notes:     urologyData.notes || undefined,
        });
        await urologyExam.save({ session });
        console.log(`[CreatePrescription] UrologyExamination saved: ${urologyExam._id}`);
      } catch (uroErr: any) {
        console.error("[CreatePrescription] Failed to save UrologyExamination:", uroErr.message);
        specialtyWarnings.push(`Urology: ${uroErr.message}`);
      }
    }

    // 1u. Create GeneralSurgeryExamination (if general surgery data provided)
    if (generalSurgeryData && (generalSurgeryData.symptoms?.length > 0 || generalSurgeryData.diagnosis || generalSurgeryData.plan || generalSurgeryData.notes)) {
      try {
        const surgeryExam = new GeneralSurgeryExamination({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          symptoms:    generalSurgeryData.symptoms || [],
          abdomen:     generalSurgeryData.abdomen  || {},
          hernia:      generalSurgeryData.hernia   || {},
          surgicalSite: generalSurgeryData.surgicalSite || undefined,
          diagnosis:   generalSurgeryData.diagnosis || "",
          plan:        generalSurgeryData.plan      || "Conservative",
          notes:       generalSurgeryData.notes     || undefined,
        });
        await surgeryExam.save({ session });
        console.log(`[CreatePrescription] GeneralSurgeryExamination saved: ${surgeryExam._id}`);
      } catch (surgErr: any) {
        console.error("[CreatePrescription] Failed to save GeneralSurgeryExamination:", surgErr.message);
        specialtyWarnings.push(`GeneralSurgery: ${surgErr.message}`);
      }
    }

    // 1t. Create RadiologyOrder (if radiology data provided)
    if (req.body.radiologyOrder) {
      const r = req.body.radiologyOrder;

      // --- VALIDATION ENGINE ---
      // 1. Justification
      if (!r.clinicalIndication) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Radiology Error: Imaging requires clinical justification (Indication is mandatory)." });
      }

      // 2. Modality requirements
      if (!r.modality || !r.bodyPart) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Radiology Error: Modality and Body Part are required." });
      }

      // 3. Radiation Safety (CT/X-ray + Pregnancy)
      if ((r.modality === "CT" || r.modality === "X-ray") && r.safety?.pregnancy) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "CRITICAL SAFETY BLOCK: Radiation is contraindicated in pregnancy for CT/X-ray." });
      }

      // 4. MRI Safety (MRI + Implants)
      if (r.modality === "MRI" && r.safety?.implants) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "CRITICAL SAFETY BLOCK: MRI is unsafe with metallic implants." });
      }

      // 5. Contrast Safety
      if (r.contrast?.requested && !r.contrast?.creatinine) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Radiology Error: Serum Creatinine value is mandatory for contrast studies." });
      }

      try {
        const radiologyOrder = new RadiologyOrder({
          prescriptionId: prescription._id,
          patientId: patient,
          doctorId: doctor,
          hospital: hospital,
          priority: r.priority || "Routine",
          modality: r.modality,
          bodyPart: r.bodyPart,
          protocol: r.protocol || `${r.modality} ${r.bodyPart}`,
          contrast: {
            requested:  !!r.contrast?.requested,
            type:       r.contrast?.type || "",
            creatinine: parseFloat(r.contrast?.creatinine) || 0,
            allergy:    !!r.contrast?.allergy,
          },
          safety: {
            pregnancy: !!r.safety?.pregnancy,
            implants:  !!r.safety?.implants,
          },
          clinicalIndication: r.clinicalIndication,
          notes: r.notes || undefined,
          status: "Pending",
        });

        await radiologyOrder.save({ session });
        console.log(`[CreatePrescription] RadiologyOrder saved: ${radiologyOrder._id}`);
      } catch (radErr: any) {
        console.error("[CreatePrescription] Failed to save RadiologyOrder:", radErr.message);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Radiology Order persistence failed: " + radErr.message });
      }
    }

    // 2. Create Pharmacy Token (Integration)
    let pharmacyTokenId: any = null;
    if (medicines && medicines.length > 0 && sendToPharma) {
      const pharmacyToken = new PharmacyToken({
        appointment: appointmentId,
        patient,
        globalPatientId: patient,
        doctor,
        hospital,
        medicines: medicines.map((m: any) => ({
          productId: m.drug || m.productId,
          name: m.name,
          dosage: m.dosage,
          freq: m.frequency, // Note: Prescription has 'frequency', Token has 'freq'
          duration: m.duration,
          quantity: m.quantity || "1", // Default
          price: 0, // Pricing decided by pharmacy
        })),
        priority: "routine",
        status: "pending",
        pharmaWarning: req.body.pharmaWarning,
      });
      await pharmacyToken.save({ session });
      pharmacyTokenId = pharmacyToken._id;
      console.log(
        `[CreatePrescription] Pharmacy Token Created: ${pharmacyToken.tokenNumber}`,
      );

      // Create Pharmacy Order (Integration for Staff Dashboard)
      const pharmacyOrder = new PharmacyOrder({
        patient,
        globalPatientId: patient,
        doctor,
        hospital,
        tokenNumber: pharmacyToken.tokenNumber,
        medicines: medicines.map((m: any) => ({
          productId: m.drug || m.productId,
          name: m.name,
          dosage: m.dosage,
          freq: m.frequency,
          duration: m.duration,
          quantity: m.quantity,
          price: 0,
          status: "pending",
        })),
        status: "prescribed",
        patientAge: age ? String(age) : appointment?.patientDetails?.age,
        patientGender: gender || appointment?.patientDetails?.gender,
        totalAmount: 0,
        paymentStatus: "pending",
        prescription: prescription._id,
        admission: admissionObjectId || undefined,
        pharmaWarning: req.body.pharmaWarning,
      });
      await pharmacyOrder.save({ session });
      console.log(
        `[CreatePrescription] Pharmacy Order Created: ${pharmacyOrder.tokenNumber}`,
      );
    }

    // 3. Create Lab Token (Integration)
    let labTokenId: any = null;
    if (suggestedTests && suggestedTests.length > 0) {
      const labToken = new LabToken({
        appointment: appointmentId,
        patient,
        globalPatientId: patient,
        doctor,
        hospital,
        tests: suggestedTests.map((t: string) => ({
          name: t,
          category: "General",
          price: 0,
        })),
        priority: "routine",
        status: "pending",
      });
      await labToken.save({ session });
      labTokenId = labToken._id;
      console.log(
        `[CreatePrescription] Lab Token Created: ${labToken.tokenNumber}`,
      );

      // Create Lab Order (Integration for Lab Staff Dashboard)
      const matchedTests = await LabTest.find({
        $or: [
          { testName: { $in: suggestedTests } },
          { name: { $in: suggestedTests } },
        ],
        hospital: hospital, // Enforce hospital isolation
      }).session(session);

      if (matchedTests.length > 0) {
        const tests = matchedTests.map((test) => ({
          test: test._id,
          status: "pending",
          result: "",
          remarks: "",
          isAbnormal: false,
          subTests: [],
        }));

        const totalAmount = matchedTests.reduce(
          (sum, t: any) => sum + (t.price || 0),
          0,
        );

        const labOrder = new LabOrder({
          patient,
          globalPatientId: patient,
          doctor,
          hospital,
          tokenNumber: labToken.tokenNumber,
          tests: tests,
          status: "prescribed",
          totalAmount: totalAmount,
          paymentStatus: "pending",
          prescription: prescription._id,
          admission: admissionObjectId, // Link if exists
          priority: req.body.priority || "routine",
          clinicalAnnotations: req.body.clinicalAnnotations || req.body.notes || req.body.advice || "",
        });
        await labOrder.save({ session });
        console.log(
          `[CreatePrescription] Lab Order Created: ${labOrder.tokenNumber}`,
        );

        // --- IPD Integration: Create Extra Charge for Lab ---
        if (admissionObjectId && totalAmount > 0) {
          await IPDExtraCharge.create([{
            patient,
            admission: admissionObjectId,
            hospital,
            category: "Lab",
            description: `Lab Order (${labOrder._id})`, // Use _id for reliable dedup in billing controller
            amount: totalAmount,
            date: new Date(),
            addedBy: doctorId,
            status: "Active",
          }], { session });
        }
        // ---------------------------------------------------

        // Notify Lab via Socket for real-time count updates
        const io = (req as any).io;
        if (io && hospital) {
          io.to(`hospital_${hospital}_lab`).emit("new_lab_order", { orderId: labOrder._id, priority: labOrder.priority, clinicalAnnotations: labOrder.clinicalAnnotations });
          io.to(`hospital_${hospital}`).emit("new_lab_order", { orderId: labOrder._id, priority: labOrder.priority, clinicalAnnotations: labOrder.clinicalAnnotations });
        }
      }
    }

    // 4. Update Appointment
    if (appointment) {
      appointment.prescription = prescription._id;
      if (pharmacyTokenId) appointment.pharmacyToken = pharmacyTokenId;
      if (labTokenId) appointment.labToken = labTokenId;

      // NOTE: Do NOT mark as completed here. The doctor will explicitly end the
      // consultation from the consultation page (using the "Complete Session" button).
      // Automatically completing here causes the timer and Pause button to freeze
      // when the doctor navigates back to the consultation page after writing a prescription.

      // Update snapshot
      if (age || gender) {
        appointment.patientDetails = {
          ...appointment.patientDetails,
          age: age ? String(age) : appointment.patientDetails?.age,
          gender: gender || appointment.patientDetails?.gender,
        };
      }

      await appointment.save({ session });
    }

    // --- Sync Patient Demographics ---
    if (patient && (age || gender)) {
      await Patient.findByIdAndUpdate(patient, {
        $set: {
          ...(age && { age: parseInt(String(age)) }),
          ...(gender && { gender: String(gender).charAt(0).toUpperCase() + String(gender).slice(1).toLowerCase() }) // Normalize to "Male"/"Female"
        }
      }).session(session);
      console.log(`[CreatePrescription] Synced demographics for Patient: ${patient}`);
    }

    // --- Sync Symptoms to IPD Admission (so inpatient page shows latest symptoms) ---
    if (admissionObjectId && symptoms && symptoms.length > 0) {
      const symptomsText = Array.isArray(symptoms) ? symptoms.join(', ') : String(symptoms);
      await IPDAdmission.findByIdAndUpdate(
        admissionObjectId,
        {
          $set: {
            reason: symptomsText,
            clinicalNotes: symptomsText,
          }
        },
        { session }
      );
      console.log(`[CreatePrescription] Synced symptoms to IPD Admission: ${admissionObjectId}`);

      // Emit socket event for real-time refresh on inpatient page
      const io = (req as any).io;
      if (io && hospital) {
        io.to(`hospital_${hospital}`).emit('ipd:bed_updated', { 
           admissionId: admissionObjectId,
           hospitalId: hospital,
           reason: symptomsText,
           updatedBy: doctorId 
        });
      }
    }

    await session.commitTransaction();
    session.endSession();

    // --- Auto-Learn Non-Pharmacy Custom Medicines for Future Autocomplete Suggestions ---
    if (medicines && Array.isArray(medicines) && hospital) {
      (async () => {
        for (const med of medicines) {
          if (med && med.name && String(med.name).trim() && !med.productId && !med.drug) {
            try {
              const medName = String(med.name).trim();
              await CustomMedicine.updateOne(
                { hospital: hospital, name: medName },
                {
                  $inc: { timesPrescribed: 1 },
                  $set: {
                    form: med.form || 'Tablet',
                    dosage: med.dosage || '',
                    lastUsedAt: new Date(),
                  },
                },
                { upsert: true }
              );
            } catch (cErr) {
              console.warn("[CreatePrescription] CustomMedicine auto-save notice:", cErr);
            }
          }
        }
      })();
    }

    // Invalidate IPD billing cache if this was an admission prescription
    if (admissionObjectId) {
      await redisService.del(`ipd:bill:${admissionObjectId.toString()}`);
    }

    // --- Notifications (Post-Transaction) ---
    try {
      const staffQueries: any[] = [];

      if (pharmacyTokenId) {
        // Notify Pharmacists
        staffQueries.push(
          (async () => {
            const pharmacists = await User.find({
              hospital: hospital,
              role: "pharma-owner",
              status: "active",
            }).select("_id");

            for (const p of pharmacists) {
              await createNotification(req, {
                hospital,
                recipient: p._id,
                sender: doctorId,
                type: "pharmacy_request",
                message: `New Medicine Request for ${patientName}`,
              });
            }

            // Emit socket event for real-time refresh on pharmacy queue
            const io = (req as any).io;
            if (io && hospital) {
              io.to(`hospital_${hospital}_pharma`).emit("new_pharmacy_order", { orderId: pharmacyTokenId });
              io.to(`hospital_${hospital}`).emit("new_pharmacy_order", { orderId: pharmacyTokenId });
            }
          })(),
        );
      }

      if (labTokenId) {
        // Notify Lab Technicians
        staffQueries.push(
          (async () => {
            const labTechs = await User.find({
              hospital: hospital,
              role: "lab",
              status: "active",
            }).select("_id");

            for (const l of labTechs) {
              await createNotification(req, {
                hospital,
                recipient: l._id,
                sender: doctorId,
                type: "lab_request",
                message: `New Lab Test Request for ${patientName}`,
                relatedId: labTokenId,
              });
            }
          })(),
        );
      }

      await Promise.all(staffQueries);
      console.log("[CreatePrescription] Notifications sent to staff.");
    } catch (notifError) {
      console.error("[CreatePrescription] Notification Error:", notifError);
    }

    res.status(201).json({
      success: true,
      prescription,
      specialtyWarnings,
      message: specialtyWarnings.length > 0
        ? `Prescription saved. ${specialtyWarnings.length} specialty module(s) had save errors.`
        : "Prescription created successfully with integrated tokens.",
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    console.error("Create prescription error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get prescription by ID
export const getPrescription = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;

    const prescription = await Prescription.findById(id)
      .populate("patient", "name mobile email age gender mrn")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
        select: "specialization medicalRegistrationNumber signature",
      })
      .populate("hospital", "name address")
      .populate({
        path: "appointment",
        select:
          "date mrn appointmentTime vitals patientDetails diagnosis advice symptoms dietAdvice suggestedTests avoid",
      });

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    res.json({
      success: true,
      prescription,
    });
  } catch (error: any) {
    console.error("Get prescription error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get prescriptions by appointment
export const getPrescriptionsByAppointment = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;

    const prescriptions = await Prescription.find({
      appointment: appointmentId,
    })
      .populate("patient", "name mobile email age gender")
      .populate("doctor", "name specialization")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      prescriptions,
    });
  } catch (error: any) {
    console.error("Get prescriptions error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update prescription
export const updatePrescription = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { prescriptionId } = req.params;
    const updates = req.body;

    const prescription = await Prescription.findByIdAndUpdate(
      prescriptionId,
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    res.json({
      success: true,
      prescription,
      message: "Prescription updated successfully",
    });
  } catch (error: any) {
    console.error("Update prescription error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all prescriptions (for existing routes)
export const getPrescriptions = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const prescriptions = await Prescription.find()
      .populate("patient", "name mobile email")
      .populate("doctor", "name specialization")
      .populate("hospital", "name")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      prescriptions,
    });
  } catch (error: any) {
    console.error("Get prescriptions error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get prescription by ID (alias for getPrescription)
export const getPrescriptionById = getPrescription;

// Delete single prescription
export const deletePrescription = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;

    const prescription = await Prescription.findByIdAndDelete(id);

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    res.json({
      success: true,
      message: "Prescription deleted successfully",
    });
  } catch (error: any) {
    console.error("Delete prescription error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete multiple prescriptions
export const deletePrescriptions = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ message: "Invalid prescription IDs" });
    }

    const result = await Prescription.deleteMany({ _id: { $in: ids } });

    res.json({
      success: true,
      message: `${result.deletedCount} prescriptions deleted successfully`,
      deletedCount: result.deletedCount,
    });
  } catch (error: any) {
    console.error("Delete prescriptions error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get DermatologyPrescription supplement by Prescription ID
export const getDermatologyByPrescriptionId = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { prescriptionId } = req.params;

    const dermPrescription = await DermatologyPrescription.findOne({
      prescriptionId,
    });

    if (!dermPrescription) {
      return res.json({ success: true, dermatologyData: null });
    }

    res.json({
      success: true,
      dermatologyData: dermPrescription,
    });
  } catch (error: any) {
    console.error("Get dermatology prescription error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get CardiologyPrescription supplement by Prescription ID
export const getCardiologyByPrescriptionId = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { prescriptionId } = req.params;

    const cardioPrescription = await CardiologyPrescription.findOne({
      prescriptionId,
    });

    if (!cardioPrescription) {
      return res.json({ success: true, cardiologyData: null });
    }

    res.json({
      success: true,
      cardiologyData: cardioPrescription,
    });
  } catch (error: any) {
    console.error("Get cardiology prescription error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get ENTExamination supplement by Prescription ID
export const getENTByPrescriptionId = async (
  req: PrescriptionRequest,
  res: Response,
) => {
  try {
    const { prescriptionId } = req.params;

    const entExamination = await ENTExamination.findOne({ prescriptionId });

    if (!entExamination) {
      return res.json({ success: true, entData: null });
    }

    res.json({
      success: true,
      entData: entExamination,
    });
  } catch (error: any) {
    console.error("Get ENT examination error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// Get Pediatrics Examination by Prescription ID
export const getPedsByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const peds = await PediatricsExamination.findOne({ prescriptionId });

    if (!peds) {
      return res.status(404).json({
        success: false,
        message: "Pediatrics data not found for this prescription",
      });
    }

    res.status(200).json({
      success: true,
      data: peds,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get GynecologyExamination supplement by Prescription ID
export const getGynecologyByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const gynData = await GynecologyExamination.findOne({ prescriptionId });

    if (!gynData) {
      return res.json({ success: true, gynaecData: null });
    }

    res.status(200).json({
      success: true,
      gynaecData: gynData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get NeurologyExamination supplement by Prescription ID
export const getNeuroByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const neuroData = await NeurologyExamination.findOne({ prescriptionId });

    if (!neuroData) {
      return res.json({ success: true, neuroData: null });
    }

    res.status(200).json({
      success: true,
      neuroData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get GastroExamination supplement by Prescription ID
export const getGastroByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const gastroData = await GastroExamination.findOne({ prescriptionId });

    if (!gastroData) {
      return res.json({ success: true, gastroData: null });
    }

    res.status(200).json({
      success: true,
      gastroData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get NephrologyExamination supplement by Prescription ID
export const getNephroByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const nephroData = await NephrologyExamination.findOne({ prescriptionId });

    if (!nephroData) {
      return res.json({ success: true, nephroData: null });
    }

    res.status(200).json({
      success: true,
      nephroData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get OphthalmologyExamination supplement by Prescription ID
export const getOphthaByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const ophthaData = await OphthalmologyExamination.findOne({ prescriptionId });

    if (!ophthaData) {
      return res.json({ success: true, ophthaData: null });
    }

    res.status(200).json({
      success: true,
      ophthaData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get OrthopedicExamination supplement by Prescription ID
export const getOrthoByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const orthoData = await OrthopedicExamination.findOne({ prescriptionId });

    if (!orthoData) {
      return res.json({ success: true, orthoData: null });
    }

    res.status(200).json({
      success: true,
      orthoData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get PulmonologyExamination supplement by Prescription ID
export const getPulmoByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const pulmoData = await PulmonologyExamination.findOne({ prescriptionId });

    if (!pulmoData) {
      return res.json({ success: true, pulmoData: null });
    }

    res.status(200).json({
      success: true,
      pulmoData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// Get PsychiatryExamination supplement by Prescription ID
export const getPsychByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const psychData = await PsychiatryExamination.findOne({ prescriptionId });

    if (!psychData) {
      return res.json({ success: true, psychData: null });
    }

    res.status(200).json({
      success: true,
      psychData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get EndocrinologyExamination supplement by Prescription ID
export const getEndoByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const endoData = await EndocrinologyExamination.findOne({ prescriptionId });

    if (!endoData) {
      return res.json({ success: true, endoData: null });
    }

    res.status(200).json({
      success: true,
      endoData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get HematologyExamination supplement by Prescription ID
export const getHemaByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const hemaData = await HematologyExamination.findOne({ prescriptionId });

    if (!hemaData) {
      return res.json({ success: true, hemaData: null });
    }

    res.status(200).json({
      success: true,
      hemaData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get OncologyExamination supplement by Prescription ID
export const getOncoByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const oncoData = await OncologyExamination.findOne({ prescriptionId });

    if (!oncoData) {
      return res.json({ success: true, oncologyData: null });
    }

    res.status(200).json({
      success: true,
      oncologyData: oncoData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get DentistryExamination supplement by Prescription ID
export const getDentistryByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const dentData = await DentistryExamination.findOne({ prescriptionId });

    if (!dentData) {
      return res.json({ success: true, dentistryData: null });
    }

    res.status(200).json({
      success: true,
      dentistryData: dentData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// Get UrologyExamination supplement by Prescription ID
export const getUrologyByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;
    const urologyData = await UrologyExamination.findOne({ prescriptionId });

    if (!urologyData) {
      return res.json({ success: true, urologyData: null });
    }

    res.status(200).json({
      success: true,
      urologyData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// --- RADIOLOGY SPECIFIC CONTROLLERS ---

/**
 * Get Radiology Data by Prescription ID
 */
export const getRadiologyByPrescriptionId = async (req: Request, res: Response) => {
  try {
    const { prescriptionId } = req.params;

    const order = await RadiologyOrder.findOne({ prescriptionId });
    if (!order) {
      return res.json({ success: true, radiology: null });
    }

    const report = await RadiologyReport.findOne({ orderId: order._id });

    res.status(200).json({
      success: true,
      radiology: {
        order,
        report: report || null
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create Radiology Report
 */
export const createRadiologyReport = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { technique, findings, impression, conclusion, critical, reportedBy } = req.body;

    const order = await RadiologyOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Radiology Order not found." });
    }

    // Validation: Report completeness
    if (!findings || !findings.organWise || findings.organWise.length === 0) {
      return res.status(400).json({ message: "Report incomplete: Structured organ-wise findings are required." });
    }

    const report = new RadiologyReport({
      orderId,
      prescriptionId: order.prescriptionId,
      patientId:      order.patientId,
      hospital:       order.hospital,
      technique,
      findings,
      impression,
      conclusion,
      critical: !!critical,
      reportedBy,
      reportedAt: new Date(),
    });

    await report.save();

    // Update order status
    order.status = "Reported";
    await order.save();

    res.status(201).json({
      success: true,
      message: "Radiology Report saved successfully.",
      report,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
