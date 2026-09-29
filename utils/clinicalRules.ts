/**
 * Lab Interpretation Engine
 * Centralized clinical validation rules for lab results
 */

export interface CBCData {
  hb: number;
  tlc: number;
  platelets: number;
  esr?: number;
}

export interface RBCIndices {
  mcv?: number;
  mch?: number;
  mchc?: number;
}

export interface CoagulationData {
  pt?: number;
  inr: number;
  aptt?: number;
}

export const interpretCBC = (data: CBCData) => {
  const alerts: string[] = [];
  const interpretation: string[] = [];

  // Hemoglobin
  if (data.hb < 7) {
    alerts.push("CRITICAL: Severe Anemia! Transfusion may be required.");
    interpretation.push("Severe Anemia");
  } else if (data.hb < 10) {
    alerts.push("Alert: Significant Anemia detected.");
    interpretation.push("Anemia");
  } else if (data.hb < 12) {
    interpretation.push("Mildly Low Hemoglobin");
  }

  // Platelets
  if (data.platelets < 20000) {
    alerts.push("EMERGENCY: Platelet transfusion required! (Critical Thrombocytopenia)");
    interpretation.push("Critical Thrombocytopenia");
  } else if (data.platelets < 50000) {
    alerts.push("Warning: High bleeding risk (Platelets < 50k)");
    interpretation.push("High Bleeding Risk");
  } else if (data.platelets < 100000) {
    interpretation.push("Low Platelet Count");
  }

  // TLC
  if (data.tlc > 50000) {
    alerts.push("Caution: Possible Leukemia suspicion (TLC > 50k)");
    interpretation.push("Severe Leukocytosis");
  } else if (data.tlc > 20000) {
    interpretation.push("Significant Infection/Inflammation");
  } else if (data.tlc < 4000) {
    interpretation.push("Leukopenia");
  }

  return { alerts, interpretation };
};

export const interpretRBCIndices = (indices: RBCIndices, cbc: CBCData) => {
  const suggestions: string[] = [];

  if (cbc.hb < 12) {
    if (indices.mcv && indices.mcv < 80) {
      suggestions.push("Microcytic Anemia (Suggests Iron Deficiency Anemia)");
    } else if (indices.mcv && indices.mcv > 100) {
      suggestions.push("Macrocytic Anemia (Suggests B12/Folate Deficiency)");
    }
  }

  return suggestions;
};

export const interpretCoagulation = (data: CoagulationData) => {
  const alerts: string[] = [];

  if (data.inr > 4) {
    alerts.push("CRITICAL: Severe bleeding risk! INR > 4.");
  } else if (data.inr > 3) {
    alerts.push("Warning: Elevated bleeding risk (INR > 3).");
  }

  return alerts;
};

/**
 * Combined Hematology Assessment
 */
export const validateHematology = (data: any) => {
  const { cbc, rbcIndices, coagulation, transfusion } = data;
  const criticalAlerts: string[] = [];
  const clinicalNotes: string[] = [];

  const cbcResult = interpretCBC(cbc);
  criticalAlerts.push(...cbcResult.alerts);
  clinicalNotes.push(...cbcResult.interpretation);

  const rbcResult = interpretRBCIndices(rbcIndices, cbc);
  clinicalNotes.push(...rbcResult);

  const coagResult = interpretCoagulation(coagulation);
  criticalAlerts.push(...coagResult);

  // Cross-field logic
  // Bone marrow failure: Hb low + TLC low + Platelets low
  if (cbc.hb < 10 && cbc.tlc < 4000 && cbc.platelets < 100000) {
    criticalAlerts.push("ALERT: Possible Bone Marrow Failure / Aplastic Anemia!");
  }

  // Leukemia: TLC high + symptoms
  if (cbc.tlc > 50000 && (data.symptoms?.includes("Fever") || data.symptoms?.includes("Weight loss"))) {
    criticalAlerts.push("CRITICAL ALERT: Possible Leukemia! Immediate investigation required.");
  }

  // Transfusion check
  if (cbc.hb < 7 && (!transfusion || transfusion.units <= 0)) {
    criticalAlerts.push("CLINICAL ALERT: Consider PRBC transfusion (Hb < 7)");
  }

  return { criticalAlerts, clinicalNotes };
};
