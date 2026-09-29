export const MASTER_LIBRARY_VERSION = "v1.1";

export const universalSeedData = [
  // --- HEMATOLOGY ---
  {
    testCode: "CBC",
    testName: "Complete Blood Count (CBC)",
    departmentName: "Hematology",
    suggestedPrice: 350,
    isActive: true,
    displayOrder: 10,
    resultType: "multiple",
    sampleType: "EDTA Blood",
    methodology: "Automated Cell Counter",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Hemoglobin (Hb)", inputType: "numeric", unit: "g/dL", referenceRange: "13.0 - 17.0", displayOrder: 1 },
      { name: "Total RBC Count", inputType: "numeric", unit: "mill/c.mm", referenceRange: "4.5 - 5.5", displayOrder: 2 },
      { name: "Total WBC Count", inputType: "numeric", unit: "cells/c.mm", referenceRange: "4000 - 11000", displayOrder: 3 },
      { name: "Neutrophils", inputType: "numeric", unit: "%", referenceRange: "40 - 75", displayOrder: 4 },
      { name: "Lymphocytes", inputType: "numeric", unit: "%", referenceRange: "20 - 45", displayOrder: 5 },
      { name: "Eosinophils", inputType: "numeric", unit: "%", referenceRange: "01 - 06", displayOrder: 6 },
      { name: "Monocytes", inputType: "numeric", unit: "%", referenceRange: "02 - 10", displayOrder: 7 },
      { name: "Basophils", inputType: "numeric", unit: "%", referenceRange: "00 - 01", displayOrder: 8 },
      { name: "Platelet Count", inputType: "numeric", unit: "lacs/c.mm", referenceRange: "1.5 - 4.5", displayOrder: 9 },
      { name: "Packed Cell Volume (PCV)", inputType: "numeric", unit: "%", referenceRange: "40 - 50", displayOrder: 10 },
      { name: "Mean Corpuscular Vol (MCV)", inputType: "numeric", unit: "fl", referenceRange: "83 - 101", displayOrder: 11 },
      { name: "MCH", inputType: "numeric", unit: "pg", referenceRange: "27 - 32", displayOrder: 12 },
      { name: "MCHC", inputType: "numeric", unit: "g/dL", referenceRange: "31.5 - 34.5", displayOrder: 13 }
    ]
  },
  {
    testCode: "ESR",
    testName: "Erythrocyte Sedimentation Rate (ESR)",
    departmentName: "Hematology",
    suggestedPrice: 100,
    isActive: true,
    displayOrder: 20,
    resultType: "numeric",
    sampleType: "EDTA Blood",
    methodology: "Westergren",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "ESR", inputType: "numeric", unit: "mm/hr", referenceRange: "0 - 15", displayOrder: 1 }
    ]
  },
  {
    testCode: "AEC",
    testName: "Absolute Eosinophil Count (AEC)",
    departmentName: "Hematology",
    suggestedPrice: 150,
    isActive: true,
    displayOrder: 25,
    resultType: "numeric",
    sampleType: "EDTA Blood",
    methodology: "Microscopy",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "AEC", inputType: "numeric", unit: "cells/c.mm", referenceRange: "40 - 440", displayOrder: 1 }
    ]
  },
  {
    testCode: "PT_INR",
    testName: "Prothrombin Time (PT) & INR",
    departmentName: "Hematology",
    suggestedPrice: 250,
    isActive: true,
    displayOrder: 40,
    resultType: "multiple",
    sampleType: "Citrate Plasma",
    methodology: "Coagulometry",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Patient PT", inputType: "numeric", unit: "sec", referenceRange: "11.0 - 15.0", displayOrder: 1 },
      { name: "Control PT", inputType: "numeric", unit: "sec", referenceRange: "11.0 - 13.0", displayOrder: 2 },
      { name: "INR", inputType: "numeric", referenceRange: "0.8 - 1.2", displayOrder: 3 }
    ]
  },
  {
    testCode: "APTT",
    testName: "Activated Partial Thromboplastin Time (APTT)",
    departmentName: "Hematology",
    suggestedPrice: 300,
    isActive: true,
    displayOrder: 45,
    resultType: "multiple",
    sampleType: "Citrate Plasma",
    methodology: "Coagulometry",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Patient APTT", inputType: "numeric", unit: "sec", referenceRange: "26.0 - 40.0", displayOrder: 1 },
      { name: "Control APTT", inputType: "numeric", unit: "sec", referenceRange: "26.0 - 34.0", displayOrder: 2 }
    ]
  },

  // --- BLOOD BANK ---
  {
    testCode: "BG_RH",
    testName: "Blood Group & Rh Typing",
    departmentName: "Blood Bank",
    suggestedPrice: 150,
    isActive: true,
    displayOrder: 30,
    resultType: "multiple",
    sampleType: "EDTA Blood",
    methodology: "Agglutination",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Blood Group", inputType: "select", options: ["A", "B", "AB", "O"], displayOrder: 1 },
      { name: "Rh Type", inputType: "select", options: ["Positive", "Negative"], displayOrder: 2 }
    ]
  },

  // --- BIOCHEMISTRY ---
  {
    testCode: "LFT",
    testName: "Liver Function Test (LFT)",
    departmentName: "Biochemistry",
    suggestedPrice: 600,
    isActive: true,
    displayOrder: 100,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "Automated Chemistry",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Total Bilirubin", inputType: "numeric", unit: "mg/dL", referenceRange: "0.1 - 1.2", displayOrder: 1 },
      { name: "Direct Bilirubin", inputType: "numeric", unit: "mg/dL", referenceRange: "0.0 - 0.3", displayOrder: 2 },
      { name: "Indirect Bilirubin", inputType: "numeric", unit: "mg/dL", referenceRange: "0.1 - 0.9", displayOrder: 3 },
      { name: "SGOT (AST)", inputType: "numeric", unit: "U/L", referenceRange: "0 - 40", displayOrder: 4 },
      { name: "SGPT (ALT)", inputType: "numeric", unit: "U/L", referenceRange: "0 - 40", displayOrder: 5 },
      { name: "Alkaline Phosphatase", inputType: "numeric", unit: "U/L", referenceRange: "40 - 129", displayOrder: 6 },
      { name: "Total Protein", inputType: "numeric", unit: "g/dL", referenceRange: "6.4 - 8.3", displayOrder: 7 },
      { name: "Albumin", inputType: "numeric", unit: "g/dL", referenceRange: "3.5 - 5.2", displayOrder: 8 },
      { name: "Globulin", inputType: "numeric", unit: "g/dL", referenceRange: "2.3 - 3.5", displayOrder: 9 },
      { name: "A/G Ratio", inputType: "numeric", referenceRange: "1.2 - 2.2", displayOrder: 10 }
    ]
  },
  {
    testCode: "RFT",
    testName: "Renal Function Test (RFT)",
    departmentName: "Biochemistry",
    suggestedPrice: 500,
    isActive: true,
    displayOrder: 110,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "Automated Chemistry",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Blood Urea", inputType: "numeric", unit: "mg/dL", referenceRange: "15 - 40", displayOrder: 1 },
      { name: "Serum Creatinine", inputType: "numeric", unit: "mg/dL", referenceRange: "0.6 - 1.4", displayOrder: 2 },
      { name: "BUN", inputType: "numeric", unit: "mg/dL", referenceRange: "7 - 20", displayOrder: 3 },
      { name: "Uric Acid", inputType: "numeric", unit: "mg/dL", referenceRange: "3.4 - 7.0", displayOrder: 4 }
    ]
  },
  {
    testCode: "LIPID",
    testName: "Lipid Profile",
    departmentName: "Biochemistry",
    suggestedPrice: 650,
    isActive: true,
    displayOrder: 120,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "Enzymatic",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Total Cholesterol", inputType: "numeric", unit: "mg/dL", referenceRange: "< 200", displayOrder: 1 },
      { name: "Triglycerides", inputType: "numeric", unit: "mg/dL", referenceRange: "< 150", displayOrder: 2 },
      { name: "HDL Cholesterol", inputType: "numeric", unit: "mg/dL", referenceRange: "> 40", displayOrder: 3 },
      { name: "LDL Cholesterol", inputType: "numeric", unit: "mg/dL", referenceRange: "< 100", displayOrder: 4 },
      { name: "VLDL Cholesterol", inputType: "numeric", unit: "mg/dL", referenceRange: "10 - 30", displayOrder: 5 },
      { name: "TC/HDL Ratio", inputType: "numeric", referenceRange: "3.5 - 5.0", displayOrder: 6 }
    ]
  },
  {
    testCode: "ELECTROLYTES",
    testName: "Serum Electrolytes",
    departmentName: "Biochemistry",
    suggestedPrice: 400,
    isActive: true,
    displayOrder: 130,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "ISE",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Sodium (Na+)", inputType: "numeric", unit: "mEq/L", referenceRange: "135 - 145", displayOrder: 1 },
      { name: "Potassium (K+)", inputType: "numeric", unit: "mEq/L", referenceRange: "3.5 - 5.1", displayOrder: 2 },
      { name: "Chloride (Cl-)", inputType: "numeric", unit: "mEq/L", referenceRange: "98 - 107", displayOrder: 3 }
    ]
  },
  {
    testCode: "HBA1C",
    testName: "HbA1c (Glycosylated Hemoglobin)",
    departmentName: "Biochemistry",
    suggestedPrice: 450,
    isActive: true,
    displayOrder: 140,
    resultType: "numeric",
    sampleType: "EDTA Blood",
    methodology: "HPLC",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "HbA1c", inputType: "numeric", unit: "%", referenceRange: "4.0 - 5.6 (Normal) | >= 6.5 (Diabetes)", displayOrder: 1 }
    ]
  },
  {
    testCode: "FBS",
    testName: "Fasting Blood Sugar (FBS)",
    departmentName: "Biochemistry",
    suggestedPrice: 100,
    isActive: true,
    displayOrder: 141,
    resultType: "numeric",
    sampleType: "Fluoride Plasma",
    methodology: "GOD-POD",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Fasting Blood Sugar", inputType: "numeric", unit: "mg/dL", referenceRange: "70 - 100", displayOrder: 1 }
    ]
  },
  {
    testCode: "PPBS",
    testName: "Post Prandial Blood Sugar (PPBS)",
    departmentName: "Biochemistry",
    suggestedPrice: 100,
    isActive: true,
    displayOrder: 142,
    resultType: "numeric",
    sampleType: "Fluoride Plasma",
    methodology: "GOD-POD",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Post Prandial Blood Sugar", inputType: "numeric", unit: "mg/dL", referenceRange: "< 140", displayOrder: 1 }
    ]
  },
  {
    testCode: "RBS",
    testName: "Random Blood Sugar (RBS)",
    departmentName: "Biochemistry",
    suggestedPrice: 100,
    isActive: true,
    displayOrder: 143,
    resultType: "numeric",
    sampleType: "Fluoride Plasma",
    methodology: "GOD-POD",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Random Blood Sugar", inputType: "numeric", unit: "mg/dL", referenceRange: "70 - 140", displayOrder: 1 }
    ]
  },

  // --- SEROLOGY / IMMUNOLOGY ---
  {
    testCode: "CRP",
    testName: "C-Reactive Protein (CRP)",
    departmentName: "Serology",
    suggestedPrice: 350,
    isActive: true,
    displayOrder: 180,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "Turbidimetry",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "CRP", inputType: "numeric", unit: "mg/L", referenceRange: "< 6.0", displayOrder: 1 }
    ]
  },
  {
    testCode: "RA_FACTOR",
    testName: "Rheumatoid Factor (RA Factor)",
    departmentName: "Serology",
    suggestedPrice: 400,
    isActive: true,
    displayOrder: 185,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "Turbidimetry",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "RA Factor", inputType: "numeric", unit: "IU/mL", referenceRange: "< 20", displayOrder: 1 }
    ]
  },
  {
    testCode: "ASO",
    testName: "Anti Streptolysin O (ASO)",
    departmentName: "Serology",
    suggestedPrice: 350,
    isActive: true,
    displayOrder: 190,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "Turbidimetry",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "ASO Titre", inputType: "numeric", unit: "IU/mL", referenceRange: "< 200", displayOrder: 1 }
    ]
  },
  {
    testCode: "WIDAL",
    testName: "Widal Test (Slide Agglutination)",
    departmentName: "Serology",
    suggestedPrice: 200,
    isActive: true,
    displayOrder: 200,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "Slide Agglutination",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Salmonella Typhi 'O'", inputType: "select", options: ["Non-Reactive", "Reactive 1:40", "Reactive 1:80", "Reactive 1:160", "Reactive 1:320"], displayOrder: 1 },
      { name: "Salmonella Typhi 'H'", inputType: "select", options: ["Non-Reactive", "Reactive 1:40", "Reactive 1:80", "Reactive 1:160", "Reactive 1:320"], displayOrder: 2 },
      { name: "Salmonella Paratyphi 'AH'", inputType: "select", options: ["Non-Reactive", "Reactive 1:40", "Reactive 1:80", "Reactive 1:160", "Reactive 1:320"], displayOrder: 3 },
      { name: "Salmonella Paratyphi 'BH'", inputType: "select", options: ["Non-Reactive", "Reactive 1:40", "Reactive 1:80", "Reactive 1:160", "Reactive 1:320"], displayOrder: 4 }
    ]
  },
  {
    testCode: "DENGUE_NS1",
    testName: "Dengue NS1 Antigen",
    departmentName: "Serology",
    suggestedPrice: 400,
    isActive: true,
    displayOrder: 210,
    resultType: "boolean",
    sampleType: "Serum",
    methodology: "Immunochromatography",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Dengue NS1 Antigen", inputType: "select", options: ["Negative", "Positive"], referenceRange: "Negative", displayOrder: 1 }
    ]
  },
  {
    testCode: "DENGUE_IGG_IGM",
    testName: "Dengue IgG & IgM Antibodies",
    departmentName: "Serology",
    suggestedPrice: 500,
    isActive: true,
    displayOrder: 212,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "Immunochromatography",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Dengue IgG", inputType: "select", options: ["Negative", "Positive"], referenceRange: "Negative", displayOrder: 1 },
      { name: "Dengue IgM", inputType: "select", options: ["Negative", "Positive"], referenceRange: "Negative", displayOrder: 2 }
    ]
  },
  {
    testCode: "HIV_1_2",
    testName: "HIV 1 & 2 (Rapid)",
    departmentName: "Serology",
    suggestedPrice: 300,
    isActive: true,
    displayOrder: 220,
    resultType: "boolean",
    sampleType: "Serum",
    methodology: "Immunochromatography",
    turnaroundTime: "1 Hour",
    parameters: [
      { name: "HIV 1 & 2 Antibodies", inputType: "select", options: ["Non-Reactive", "Reactive"], referenceRange: "Non-Reactive", displayOrder: 1 }
    ]
  },
  {
    testCode: "HBSAG",
    testName: "HBsAg (Hepatitis B Surface Antigen)",
    departmentName: "Serology",
    suggestedPrice: 300,
    isActive: true,
    displayOrder: 222,
    resultType: "boolean",
    sampleType: "Serum",
    methodology: "Immunochromatography",
    turnaroundTime: "1 Hour",
    parameters: [
      { name: "HBsAg", inputType: "select", options: ["Non-Reactive", "Reactive"], referenceRange: "Non-Reactive", displayOrder: 1 }
    ]
  },
  {
    testCode: "HCV",
    testName: "Anti-HCV (Rapid)",
    departmentName: "Serology",
    suggestedPrice: 400,
    isActive: true,
    displayOrder: 224,
    resultType: "boolean",
    sampleType: "Serum",
    methodology: "Immunochromatography",
    turnaroundTime: "1 Hour",
    parameters: [
      { name: "Anti-HCV Antibodies", inputType: "select", options: ["Non-Reactive", "Reactive"], referenceRange: "Non-Reactive", displayOrder: 1 }
    ]
  },
  {
    testCode: "VDRL",
    testName: "VDRL / RPR",
    departmentName: "Serology",
    suggestedPrice: 200,
    isActive: true,
    displayOrder: 226,
    resultType: "boolean",
    sampleType: "Serum",
    methodology: "Flocculation",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "VDRL (RPR)", inputType: "select", options: ["Non-Reactive", "Reactive"], referenceRange: "Non-Reactive", displayOrder: 1 }
    ]
  },
  {
    testCode: "TPHA",
    testName: "TPHA (Treponema Pallidum Hemagglutination)",
    departmentName: "Serology",
    suggestedPrice: 350,
    isActive: true,
    displayOrder: 228,
    resultType: "boolean",
    sampleType: "Serum",
    methodology: "Hemagglutination",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "TPHA", inputType: "select", options: ["Negative", "Positive"], referenceRange: "Negative", displayOrder: 1 }
    ]
  },
  {
    testCode: "MALARIA_AG",
    testName: "Malaria Antigen (Pf/Pv)",
    departmentName: "Serology",
    suggestedPrice: 300,
    isActive: true,
    displayOrder: 230,
    resultType: "multiple",
    sampleType: "Whole Blood",
    methodology: "Immunochromatography",
    turnaroundTime: "1 Hour",
    parameters: [
      { name: "Plasmodium falciparum (Pf)", inputType: "select", options: ["Negative", "Positive"], referenceRange: "Negative", displayOrder: 1 },
      { name: "Plasmodium vivax (Pv)", inputType: "select", options: ["Negative", "Positive"], referenceRange: "Negative", displayOrder: 2 }
    ]
  },

  // --- ENDOCRINOLOGY / HORMONES ---
  {
    testCode: "THYROID_PROF",
    testName: "Thyroid Profile (T3, T4, TSH)",
    departmentName: "Endocrinology",
    suggestedPrice: 700,
    isActive: true,
    displayOrder: 300,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Total T3", inputType: "numeric", unit: "ng/dL", referenceRange: "80 - 200", displayOrder: 1 },
      { name: "Total T4", inputType: "numeric", unit: "ug/dL", referenceRange: "5.1 - 14.1", displayOrder: 2 },
      { name: "TSH (Ultrasensitive)", inputType: "numeric", unit: "uIU/mL", referenceRange: "0.27 - 4.2", displayOrder: 3 }
    ]
  },
  {
    testCode: "T3",
    testName: "Total T3 (Triiodothyronine)",
    departmentName: "Endocrinology",
    suggestedPrice: 250,
    isActive: true,
    displayOrder: 301,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Total T3", inputType: "numeric", unit: "ng/dL", referenceRange: "80 - 200", displayOrder: 1 }
    ]
  },
  {
    testCode: "T4",
    testName: "Total T4 (Thyroxine)",
    departmentName: "Endocrinology",
    suggestedPrice: 250,
    isActive: true,
    displayOrder: 302,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Total T4", inputType: "numeric", unit: "ug/dL", referenceRange: "5.1 - 14.1", displayOrder: 1 }
    ]
  },
  {
    testCode: "TSH",
    testName: "TSH (Thyroid Stimulating Hormone)",
    departmentName: "Endocrinology",
    suggestedPrice: 250,
    isActive: true,
    displayOrder: 303,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "TSH (Ultrasensitive)", inputType: "numeric", unit: "uIU/mL", referenceRange: "0.27 - 4.2", displayOrder: 1 }
    ]
  },

  // --- CARDIOLOGY ---
  {
    testCode: "TROP_I",
    testName: "Troponin I",
    departmentName: "Cardiology",
    suggestedPrice: 800,
    isActive: true,
    displayOrder: 350,
    resultType: "numeric",
    sampleType: "Serum/Plasma",
    methodology: "CLIA/ECLIA",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Troponin I", inputType: "numeric", unit: "ng/mL", referenceRange: "< 0.04", displayOrder: 1 }
    ]
  },
  {
    testCode: "TROP_T",
    testName: "Troponin T",
    departmentName: "Cardiology",
    suggestedPrice: 900,
    isActive: true,
    displayOrder: 351,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "ECLIA",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Troponin T (hs)", inputType: "numeric", unit: "ng/L", referenceRange: "< 14", displayOrder: 1 }
    ]
  },
  {
    testCode: "CKMB",
    testName: "CK-MB",
    departmentName: "Cardiology",
    suggestedPrice: 500,
    isActive: true,
    displayOrder: 352,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "Immunoinhibition",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "CK-MB Mass", inputType: "numeric", unit: "U/L", referenceRange: "< 24", displayOrder: 1 }
    ]
  },
  {
    testCode: "D_DIMER",
    testName: "D-Dimer",
    departmentName: "Cardiology",
    suggestedPrice: 1200,
    isActive: true,
    displayOrder: 353,
    resultType: "numeric",
    sampleType: "Citrate Plasma",
    methodology: "Immunoturbidimetry",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "D-Dimer", inputType: "numeric", unit: "ng/mL FEU", referenceRange: "< 500", displayOrder: 1 }
    ]
  },

  // --- TUMOR MARKERS ---
  {
    testCode: "PSA",
    testName: "PSA (Prostate Specific Antigen) Total",
    departmentName: "Tumor Markers",
    suggestedPrice: 800,
    isActive: true,
    displayOrder: 380,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Total PSA", inputType: "numeric", unit: "ng/mL", referenceRange: "< 4.0", displayOrder: 1 }
    ]
  },
  {
    testCode: "CEA",
    testName: "Carcinoembryonic Antigen (CEA)",
    departmentName: "Tumor Markers",
    suggestedPrice: 750,
    isActive: true,
    displayOrder: 381,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "CEA", inputType: "numeric", unit: "ng/mL", referenceRange: "< 5.0", displayOrder: 1 }
    ]
  },
  {
    testCode: "AFP",
    testName: "Alpha Fetoprotein (AFP)",
    departmentName: "Tumor Markers",
    suggestedPrice: 850,
    isActive: true,
    displayOrder: 382,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "AFP", inputType: "numeric", unit: "ng/mL", referenceRange: "< 7.0", displayOrder: 1 }
    ]
  },
  {
    testCode: "CA125",
    testName: "CA-125 (Ovarian Cancer Marker)",
    departmentName: "Tumor Markers",
    suggestedPrice: 1000,
    isActive: true,
    displayOrder: 383,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "CA-125", inputType: "numeric", unit: "U/mL", referenceRange: "< 35.0", displayOrder: 1 }
    ]
  },
  {
    testCode: "CA199",
    testName: "CA 19-9 (Pancreatic Marker)",
    departmentName: "Tumor Markers",
    suggestedPrice: 1000,
    isActive: true,
    displayOrder: 384,
    resultType: "numeric",
    sampleType: "Serum",
    methodology: "CLIA",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "CA 19-9", inputType: "numeric", unit: "U/mL", referenceRange: "< 37.0", displayOrder: 1 }
    ]
  },

  // --- CLINICAL PATHOLOGY ---
  {
    testCode: "URINE_R_M",
    testName: "Urine Routine & Microscopy",
    departmentName: "Clinical Pathology",
    suggestedPrice: 150,
    isActive: true,
    displayOrder: 400,
    resultType: "multiple",
    sampleType: "Urine",
    methodology: "Physical, Chemical & Microscopic",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Quantity", inputType: "text", unit: "ml", displayOrder: 1 },
      { name: "Color", inputType: "text", referenceRange: "Pale Yellow", displayOrder: 2 },
      { name: "Appearance", inputType: "select", options: ["Clear", "Hazy", "Cloudy", "Turbid"], referenceRange: "Clear", displayOrder: 3 },
      { name: "Specific Gravity", inputType: "numeric", referenceRange: "1.005 - 1.030", displayOrder: 4 },
      { name: "pH", inputType: "numeric", referenceRange: "5.0 - 8.0", displayOrder: 5 },
      { name: "Protein", inputType: "select", options: ["Nil", "Trace", "+", "++", "+++", "++++"], referenceRange: "Nil", displayOrder: 6 },
      { name: "Glucose", inputType: "select", options: ["Nil", "Trace", "+", "++", "+++", "++++"], referenceRange: "Nil", displayOrder: 7 },
      { name: "Ketones", inputType: "select", options: ["Negative", "Positive"], referenceRange: "Negative", displayOrder: 8 },
      { name: "Pus Cells", inputType: "text", unit: "/HPF", referenceRange: "0 - 4", displayOrder: 9 },
      { name: "Epithelial Cells", inputType: "text", unit: "/HPF", referenceRange: "0 - 4", displayOrder: 10 },
      { name: "RBCs", inputType: "text", unit: "/HPF", referenceRange: "Nil", displayOrder: 11 },
      { name: "Bacteria", inputType: "select", options: ["Absent", "Present"], referenceRange: "Absent", displayOrder: 12 }
    ]
  },
  {
    testCode: "STOOL_R_M",
    testName: "Stool Routine & Microscopy",
    departmentName: "Clinical Pathology",
    suggestedPrice: 150,
    isActive: true,
    displayOrder: 410,
    resultType: "multiple",
    sampleType: "Stool",
    methodology: "Microscopy",
    turnaroundTime: "2 Hours",
    parameters: [
      { name: "Color", inputType: "text", displayOrder: 1 },
      { name: "Consistency", inputType: "text", displayOrder: 2 },
      { name: "Mucus", inputType: "select", options: ["Absent", "Present"], displayOrder: 3 },
      { name: "Blood", inputType: "select", options: ["Absent", "Present"], displayOrder: 4 },
      { name: "Pus Cells", inputType: "text", unit: "/HPF", displayOrder: 5 },
      { name: "RBCs", inputType: "text", unit: "/HPF", displayOrder: 6 },
      { name: "Ova/Cysts", inputType: "text", displayOrder: 7 },
      { name: "Macrophages", inputType: "text", displayOrder: 8 }
    ]
  },
  {
    testCode: "SEMEN_ANALYSIS",
    testName: "Semen Analysis",
    departmentName: "Clinical Pathology",
    suggestedPrice: 400,
    isActive: true,
    displayOrder: 420,
    resultType: "multiple",
    sampleType: "Semen",
    methodology: "Microscopy",
    turnaroundTime: "4 Hours",
    parameters: [
      { name: "Volume", inputType: "numeric", unit: "ml", referenceRange: "1.5 - 5.0", displayOrder: 1 },
      { name: "Liquefaction Time", inputType: "numeric", unit: "mins", referenceRange: "15 - 30", displayOrder: 2 },
      { name: "Sperm Count", inputType: "numeric", unit: "mill/ml", referenceRange: "> 15", displayOrder: 3 },
      { name: "Total Motility", inputType: "numeric", unit: "%", referenceRange: "> 40", displayOrder: 4 },
      { name: "Active Motility", inputType: "numeric", unit: "%", referenceRange: "> 32", displayOrder: 5 },
      { name: "Normal Morphology", inputType: "numeric", unit: "%", referenceRange: "> 4", displayOrder: 6 }
    ]
  },

  // --- MICROBIOLOGY ---
  {
    testCode: "URINE_CULTURE",
    testName: "Urine Culture and Sensitivity",
    departmentName: "Microbiology",
    suggestedPrice: 600,
    isActive: true,
    displayOrder: 500,
    resultType: "multiple",
    sampleType: "Urine (Mid-stream)",
    methodology: "Culture",
    turnaroundTime: "48-72 Hours",
    parameters: [
      { name: "Result", inputType: "select", options: ["No Growth", "Growth Of", "Mixed Flora"], displayOrder: 1 },
      { name: "Organism Isolated", inputType: "text", displayOrder: 2 },
      { name: "Colony Count", inputType: "text", unit: "CFU/ml", displayOrder: 3 },
      { name: "Sensitive To", inputType: "text", displayOrder: 4 },
      { name: "Intermediate To", inputType: "text", displayOrder: 5 },
      { name: "Resistant To", inputType: "text", displayOrder: 6 }
    ]
  },

  // --- PROFILES / PACKAGES ---
  {
    testCode: "PROF_FEVER",
    testName: "Fever Profile",
    departmentName: "Profiles",
    suggestedPrice: 1200,
    isActive: true,
    displayOrder: 900,
    resultType: "multiple",
    sampleType: "Blood, Urine",
    methodology: "Multiple",
    turnaroundTime: "6 Hours",
    parameters: [
      { name: "Includes CBC, ESR", isHeading: true, displayOrder: 1 },
      { name: "Includes Widal, Dengue NS1", isHeading: true, displayOrder: 2 },
      { name: "Includes Malaria Antigen", isHeading: true, displayOrder: 3 },
      { name: "Includes Urine R/M", isHeading: true, displayOrder: 4 }
    ]
  },
  {
    testCode: "PROF_DIABETIC",
    testName: "Diabetic Profile",
    departmentName: "Profiles",
    suggestedPrice: 1500,
    isActive: true,
    displayOrder: 910,
    resultType: "multiple",
    sampleType: "Blood, Urine",
    methodology: "Multiple",
    turnaroundTime: "6 Hours",
    parameters: [
      { name: "Includes FBS, PPBS", isHeading: true, displayOrder: 1 },
      { name: "Includes HbA1c", isHeading: true, displayOrder: 2 },
      { name: "Includes Lipid Profile", isHeading: true, displayOrder: 3 },
      { name: "Includes Serum Creatinine", isHeading: true, displayOrder: 4 },
      { name: "Includes Urine Microalbumin", isHeading: true, displayOrder: 5 }
    ]
  },
  {
    testCode: "PROF_CARDIAC",
    testName: "Cardiac Risk Profile",
    departmentName: "Profiles",
    suggestedPrice: 2000,
    isActive: true,
    displayOrder: 920,
    resultType: "multiple",
    sampleType: "Serum",
    methodology: "Multiple",
    turnaroundTime: "6 Hours",
    parameters: [
      { name: "Includes Lipid Profile", isHeading: true, displayOrder: 1 },
      { name: "Includes hs-CRP", isHeading: true, displayOrder: 2 },
      { name: "Includes Homocysteine", isHeading: true, displayOrder: 3 },
      { name: "Includes Lp(a)", isHeading: true, displayOrder: 4 }
    ]
  },
  {
    testCode: "PROF_EXEC_HEALTH",
    testName: "Executive Health Checkup",
    departmentName: "Profiles",
    suggestedPrice: 3500,
    isActive: true,
    displayOrder: 930,
    resultType: "multiple",
    sampleType: "Blood, Urine",
    methodology: "Multiple",
    turnaroundTime: "8 Hours",
    parameters: [
      { name: "Includes CBC, ESR", isHeading: true, displayOrder: 1 },
      { name: "Includes LFT, RFT", isHeading: true, displayOrder: 2 },
      { name: "Includes Lipid Profile, Thyroid Profile", isHeading: true, displayOrder: 3 },
      { name: "Includes FBS, HbA1c", isHeading: true, displayOrder: 4 },
      { name: "Includes Urine R/M", isHeading: true, displayOrder: 5 }
    ]
  },
  {
    testCode: "PROF_ANTENATAL",
    testName: "Antenatal Profile",
    departmentName: "Profiles",
    suggestedPrice: 1800,
    isActive: true,
    displayOrder: 940,
    resultType: "multiple",
    sampleType: "Blood, Urine",
    methodology: "Multiple",
    turnaroundTime: "6 Hours",
    parameters: [
      { name: "Includes CBC, Blood Group", isHeading: true, displayOrder: 1 },
      { name: "Includes VDRL, HIV, HBsAg, HCV", isHeading: true, displayOrder: 2 },
      { name: "Includes Random Blood Sugar", isHeading: true, displayOrder: 3 },
      { name: "Includes Urine R/M", isHeading: true, displayOrder: 4 }
    ]
  }
];
