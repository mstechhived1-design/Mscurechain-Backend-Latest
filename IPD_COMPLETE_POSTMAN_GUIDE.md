# 🏥 IPD COMPLETE POSTMAN GUIDE
## Inpatient Department — Full End-to-End Testing

> **All roles covered:** Frontdesk → Doctor → Nurse → Lab → Pharmacy → Patient Portal  
> **Flow:** Patient Registration → IPD Booking → Admission → Bed Assignment → Nursing Care → Doctor Rounds → Discharge

---

## ⚙️ GLOBAL SETUP

### Postman Environment Variables

| Variable | Description | Example Value |
|---|---|---|
| `baseUrl` | Backend base URL | `http://localhost:5000/api` |
| `helpdeskToken` | Frontdesk JWT | _(set after login)_ |
| `doctorToken` | Doctor JWT | _(set after login)_ |
| `nurseToken` | Nurse JWT | _(set after login)_ |
| `labToken` | Lab staff JWT | _(set after login)_ |
| `pharmaToken` | Pharmacy staff JWT | _(set after login)_ |
| `patientToken` | Patient JWT | _(set after login)_ |
| `hospitalId` | Hospital ObjectId | _(from /helpdesk/me)_ |
| `patientId` | Patient User ObjectId | _(from registration)_ |
| `appointmentId` | IPD Appointment ObjectId | _(from booking)_ |
| `admissionId` | Admission string ID (e.g. ADM-xxx) | _(from initiateAdmission)_ |
| `admissionObjectId` | Admission MongoDB `_id` | _(from initiateAdmission)_ |
| `bedId` | Bed ObjectId | _(from bed list)_ |

---

## 🔵 PHASE 1 — FRONTDESK (IPD BOOKING & ADMISSION)

### STEP 1 — Frontdesk Login

```
POST {{baseUrl}}/helpdesk/login
```
**Body:**
```json
{
  "email": "frontdesk@yourhospital.com",
  "password": "YourPassword123"
}
```
> ✅ Save `token` → `{{helpdeskToken}}`

---

### STEP 2 — Get Hospital ID

```
GET {{baseUrl}}/helpdesk/me
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

> ✅ Save `user.hospital` → `{{hospitalId}}`

---

### STEP 3 — Get Available Beds

```
GET {{baseUrl}}/ipd/beds?status=Vacant
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

**Response:**
```json
[
  {
    "_id": "bed_object_id",
    "bedId": "BED-101",
    "type": "General Ward",
    "floor": "1",
    "room": "101",
    "department": "General",
    "status": "Vacant",
    "pricePerDay": 1500
  }
]
```
> ✅ Save `_id` → `{{bedId}}` (Note: This is the sub-document `_id` inside the hospital.beds array)

---

### STEP 4 — Get All Doctors

```
GET {{baseUrl}}/helpdesk/doctors
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

> ✅ Save doctor `_id` → `{{doctorProfileId}}`

---

### STEP 5 — Register Patient + Book IPD Appointment

```
POST {{baseUrl}}/helpdesk/patients/register
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "name": "Ravi Kumar",
  "mobile": "9876543200",
  "email": "ravi@example.com",
  "age": 55,
  "gender": "Male",
  "dob": "1970-03-20",
  "address": "45 Gandhi Nagar, Hyderabad",
  "bloodGroup": "B+",
  "allergies": "Sulfa drugs",
  "emergencyContact": "9000000001",
  "visitType": "IPD",
  "doctorId": "{{doctorProfileId}}",
  "date": "2026-02-19",
  "reason": "Chest pain evaluation, planned cardiac workup",
  "amount": 5000,
  "paymentMethod": "cash",
  "paymentStatus": "paid"
}
```

**Response:**
```json
{
  "success": true,
  "patient": {
    "_id": "patient_user_id",
    "name": "Ravi Kumar",
    "mrn": "MRN-20260219-007"
  },
  "appointment": {
    "_id": "appointment_id",
    "type": "IPD",
    "status": "confirmed",
    "amount": 5000,
    "paymentStatus": "paid"
  }
}
```
> ✅ Save `patient._id` → `{{patientId}}`  
> ✅ Save `appointment._id` → `{{appointmentId}}`

---

### STEP 6 — Initiate IPD Admission (Assign Bed)

> 🎯 **This is the core IPD endpoint.** Assigns a bed, creates the admission record, and optionally records advance payment.

```
POST {{baseUrl}}/ipd
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "patientId": "{{patientId}}",
  "doctorId": "{{doctorProfileId}}",
  "bedId": "{{bedId}}",
  "admissionType": "General Ward",
  "diet": "Low sodium, no spicy foods",
  "clinicalNotes": "Patient admitted for cardiac evaluation. History of hypertension.",
  "reason": "Chest pain evaluation",
  "vitals": {
    "bloodPressure": "150/95",
    "temperature": "37.2",
    "pulse": "92",
    "spO2": "96",
    "height": "168",
    "weight": "78",
    "glucose": "110"
  },
  "amount": 5000,
  "paymentMethod": "cash",
  "paymentStatus": "paid"
}
```

**`admissionType` values:** `General Ward` | `ICU` | `Emergency` | `Private Room` | `Semi-Private`

**Response:**
```json
{
  "admission": {
    "_id": "admission_object_id",
    "admissionId": "ADM-1234567890-001",
    "patient": "patient_user_id",
    "primaryDoctor": "doctor_profile_id",
    "admissionType": "General Ward",
    "status": "Active",
    "admissionDate": "2026-02-19T05:00:00.000Z",
    "advancePaid": 5000
  },
  "occupancy": {
    "_id": "occupancy_id",
    "bed": "bed_id",
    "admission": "admission_object_id",
    "startDate": "2026-02-19T05:00:00.000Z",
    "dailyRateAtTime": 1500
  }
}
```
> ✅ Save `admission.admissionId` → `{{admissionId}}` (string like `ADM-xxx`)  
> ✅ Save `admission._id` → `{{admissionObjectId}}`

---

### STEP 7 — View All Active IPD Admissions

```
GET {{baseUrl}}/ipd/active
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

**Query Params (optional):**
| Param | Example | Description |
|---|---|---|
| `department` | `General Ward` | Filter by ward/department |
| `doctorId` | `doctor_profile_id` | Filter by doctor |

**Response:** Array of active admissions with patient info, bed details, and latest vitals.

---

### STEP 8 — Get Pending Discharge/Transfer Requests

```
GET {{baseUrl}}/ipd/pending-requests
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

**Response:**
```json
[
  {
    "type": "discharge",
    "admissionId": "ADM-xxx",
    "patientName": "Ravi Kumar",
    "requestedBy": "Dr. Arjun Sharma",
    "requestedAt": "2026-02-22T10:00:00.000Z"
  }
]
```

---

### STEP 9 — Add Advance Payment (Helpdesk)

```
POST {{baseUrl}}/ipd/billing/advance
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "amount": 10000,
  "mode": "Cash",
  "transactionType": "Advance",
  "date": "2026-02-20T10:00:00.000Z",
  "reference": "Cash receipt"
}
```
> **`mode` values:** `Cash` | `UPI` | `Card`  
> **`transactionType` values:** `Advance` | `Refund`

---

### STEP 10 — View IPD Bill Summary

```
GET {{baseUrl}}/ipd/billing/summary/{{admissionId}}
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

**Response:**
```json
{
  "admissionId": "ADM-xxx",
  "patientName": "Ravi Kumar",
  "bedCharges": {
    "items": [{ "bedId": "BED-101", "type": "General Ward", "days": 3, "rate": 1500, "charge": 4500 }],
    "total": 4500
  },
  "extraCharges": {
    "items": [...],
    "categoryBreakdown": { "Procedure": 1200, "Nursing": 600 },
    "total": 1800
  },
  "financials": {
    "totalBill": 6300,
    "discount": 500,
    "finalAmount": 5800,
    "totalAdvance": 5000,
    "balance": 800
  },
  "advances": [...],
  "isBillLocked": false
}
```

---

### STEP 11 — Transfer Patient to Another Bed

```
POST {{baseUrl}}/ipd/{{admissionId}}/transfer
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "newBedId": "new_vacant_bed_object_id"
}
```
> ✅ Old bed → status: `Cleaning` | New bed → status: `Occupied`

---

### STEP 12 — Update Bed Status (Quick)

```
PATCH {{baseUrl}}/ipd/beds/{{bedId}}/quick-status
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "status": "Vacant"
}
```
**Allowed Transitions:**
| Current | Can Move To |
|---|---|
| `Cleaning` | `Vacant` |
| `Vacant` | `Occupied`, `Blocked`, `Cleaning` |
| `Blocked` | `Vacant` |
| `Occupied` | `Cleaning`, `Vacant` |

---

### STEP 13 — Get Helpdesk IPD Admission Receipts

```
GET {{baseUrl}}/helpdesk/patients/{{patientId}}/ipd-admissions
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

---

## 🟢 PHASE 2 — DOCTOR (IPD ROUNDS)

### STEP 14 — Doctor Login

```
POST {{baseUrl}}/auth/login
```
**Body:** `{ "email": "doctor@hospital.com", "password": "DoctorPass123" }`
> ✅ Save `token` → `{{doctorToken}}`

---

### STEP 15 — View Doctor's IPD Patients

```
GET {{baseUrl}}/ipd/active
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

> 🔒 **Doctor Security:** Doctors only see their own assigned patients automatically.

---

### STEP 16 — Get Single Admission Details (Pre-discharge autofill)

```
GET {{baseUrl}}/ipd/{{admissionId}}
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

**Response:** Full admission details including patient demographics, vitals snapshot, MRN, suggested discharge data.

---

### STEP 17 — Get Patient Clinical History (Vitals + Notes + Meds + Diet)

```
GET {{baseUrl}}/ipd/{{admissionId}}/clinical-history
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

**Response:**
```json
{
  "vitals": [
    {
      "_id": "vitals_record_id",
      "heartRate": 88,
      "systolicBP": 145,
      "diastolicBP": 90,
      "spO2": 96,
      "temperature": 37.2,
      "respiratoryRate": 18,
      "glucose": 115,
      "glucoseType": "Random",
      "status": "Warning",
      "condition": "Fair",
      "notes": "Patient stable, mild hypertension",
      "timestamp": "2026-02-19T06:00:00.000Z"
    }
  ],
  "notes": [...],
  "meds": [...],
  "diet": [...]
}
```

---

### STEP 18 — Get IPD Prescriptions for Admission

```
GET {{baseUrl}}/ipd/{{admissionId}}/prescriptions
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

**Response:** Combined OPD prescriptions + pharmacy orders linked to this admission.

---

### STEP 19 — Get IPD Lab Reports for Admission

```
GET {{baseUrl}}/ipd/{{admissionId}}/lab-reports
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

---

### STEP 20 — Create IPD Prescription (Doctor Round Order)

```
POST {{baseUrl}}/doctor/prescriptions
```
**Headers:** `Authorization: Bearer {{doctorToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "appointmentId": "{{appointmentId}}",
  "patientId": "{{patientId}}",
  "diagnosis": "Hypertensive heart disease, controlled",
  "clinicalNotes": "Chest pain resolved. ECG: sinus rhythm. Echo: mild LV hypertrophy.",
  "plan": "Continue antihypertensives. Repeat Echo in 3 months.",
  "followUpDate": "2026-05-20",
  "medicines": [
    {
      "name": "Amlodipine 5mg",
      "generic": "Amlodipine",
      "dose": "5mg",
      "frequency": "Once daily morning",
      "freq": "OD",
      "duration": "30 days",
      "qty": 30,
      "instructions": "After breakfast"
    },
    {
      "name": "Telmisartan 40mg",
      "generic": "Telmisartan",
      "dose": "40mg",
      "frequency": "Once daily",
      "freq": "OD",
      "duration": "30 days",
      "qty": 30,
      "instructions": "Before breakfast"
    }
  ]
}
```

---

### STEP 21 — Order Lab Tests (IPD)

```
POST {{baseUrl}}/doctor/lab-tokens
```
**Headers:** `Authorization: Bearer {{doctorToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "appointmentId": "{{appointmentId}}",
  "patientId": "{{patientId}}",
  "tests": [
    { "test": "ecg_test_id", "instructions": "12-lead ECG" },
    { "test": "echo_test_id", "instructions": "2D Echo with Doppler" },
    { "test": "lipid_test_id", "instructions": "Fasting 12 hours" }
  ],
  "priority": "urgent",
  "notes": "Cardiac workup for IPD patient"
}
```

---

### STEP 22 — Order Medicines (IPD Pharmacy)

```
POST {{baseUrl}}/doctor/pharmacy-tokens
```
**Headers:** `Authorization: Bearer {{doctorToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "appointmentId": "{{appointmentId}}",
  "patientId": "{{patientId}}",
  "medicines": [
    {
      "name": "Amlodipine 5mg",
      "generic": "Amlodipine",
      "dose": "5mg",
      "freq": "OD",
      "duration": "30 days",
      "qty": 30,
      "instructions": "After breakfast"
    }
  ],
  "notes": "IPD cardiac medication"
}
```

---

### STEP 23 — Doctor Requests Discharge

> 🔔 **Doctor sends discharge request to Helpdesk/Nurse for processing**

```
POST {{baseUrl}}/ipd/{{admissionObjectId}}/request-discharge
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

> ✅ **Sets:** `dischargeRequested: true`, emits `ipd:request_updated` WebSocket event to helpdesk

---

### STEP 24 — Doctor Requests Bed Transfer

```
POST {{baseUrl}}/ipd/{{admissionObjectId}}/request-transfer
```
**Headers:** `Authorization: Bearer {{doctorToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "roomType": "ICU",
  "room": "ICU-1",
  "notes": "Patient condition deteriorated. Needs ICU monitoring.",
  "targetBedId": "icu_bed_object_id"
}
```

---

### STEP 25 — Cancel Discharge Request

```
POST {{baseUrl}}/ipd/{{admissionObjectId}}/cancel-discharge
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

---

### STEP 26 — Cancel Transfer Request

```
POST {{baseUrl}}/ipd/{{admissionObjectId}}/cancel-transfer
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

---

### STEP 27 — Add Extra Charge (Doctor)

```
POST {{baseUrl}}/ipd/billing/charge
```
**Headers:** `Authorization: Bearer {{doctorToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "category": "Procedure",
  "description": "Echocardiography - 2D Echo",
  "amount": 2500,
  "date": "2026-02-20T10:00:00.000Z"
}
```
**`category` values:** `Procedure` | `Nursing` | `Consultation` | `Medication` | `Lab` | `Other`

---

## 🟠 PHASE 3 — NURSE (IPD WARD CARE)

### STEP 28 — Nurse Login

```
POST {{baseUrl}}/auth/login
```
**Body:** `{ "email": "nurse@hospital.com", "password": "NursePass123" }`
> ✅ Save `token` → `{{nurseToken}}`

---

### STEP 29 — View Nurse's Ward Patients

```
GET {{baseUrl}}/ipd/active?department=General Ward
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

> 🔒 **Nurse Security:** Nurses auto-filtered to their own assigned department via `StaffProfile.department`

---

### STEP 30 — Log Patient Vitals

> 📊 **Core nursing task — triggers threshold alerts and real-time doctor notifications**

```
POST {{baseUrl}}/ipd/log-vitals
```
**Headers:** `Authorization: Bearer {{nurseToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "heartRate": 88,
  "systolicBP": 145,
  "diastolicBP": 92,
  "spO2": 96,
  "temperature": 37.2,
  "respiratoryRate": 18,
  "glucose": 115,
  "glucoseType": "Random",
  "condition": "Fair",
  "notes": "Patient stable. Mild hypertension. Resting comfortably."
}
```

**`glucoseType` values:** `Fasting` | `After Meal` | `Random`  
**`condition` values:** `Stable` | `Fair` | `Serious` | `Critical`

**Response:**
```json
{
  "success": true,
  "record": {
    "_id": "vitals_record_id",
    "heartRate": 88,
    "systolicBP": 145,
    "diastolicBP": 92,
    "spO2": 96,
    "temperature": 37.2,
    "status": "Warning",
    "condition": "Fair",
    "timestamp": "2026-02-19T06:00:00.000Z"
  }
}
```

> 🚨 **Auto-alerts triggered when values exceed thresholds:**
> - `Warning` → Doctor gets in-app notification
> - `Critical` → Doctor gets urgent notification + `doctoral_vital_alert` WebSocket event

---

### STEP 31 — Get Hourly Monitoring Chart

```
GET {{baseUrl}}/ipd/hourly-monitoring/{{admissionId}}
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

**Response:** Hourly vitals charted for ICU/Critical patients.

---

### STEP 32 — Add Clinical Note (SOAP Format)

```
POST {{baseUrl}}/ipd/add-note
```
**Headers:** `Authorization: Bearer {{nurseToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "type": "Nursing",
  "subjective": "Patient reports mild chest tightness. No respiratory distress.",
  "objective": "BP 145/90, HR 88, SpO2 96%, RR 18. Afebrile.",
  "assessment": "Hypertensive patient, vitals mildly elevated. Condition: Fair.",
  "plan": "Continue prescribed medications. Monitor BP every 4 hours. Notify doctor if BP >160/100.",
  "visibility": "all"
}
```

**`type` values:** `Nursing` | `Physician` | `General`  
**`visibility` values:** `all` | `doctors-only`

---

### STEP 33 — Administer Medication (MAR — Medication Administration Record)

```
POST {{baseUrl}}/ipd/administer-med
```
**Headers:** `Authorization: Bearer {{nurseToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "prescriptionId": "{{prescriptionId}}",
  "medicineId": "medicine_item_id",
  "drugName": "Amlodipine 5mg",
  "dose": "5mg",
  "route": "Oral",
  "status": "Given",
  "timeSlot": "08:00",
  "notes": "Administered as prescribed after breakfast"
}
```

**`route` values:** `Oral` | `IV` | `IM` | `SC` | `Topical` | `Sublingual`  
**`status` values:** `Given` | `Held` | `Refused` | `Not Available`

---

### STEP 34 — Delete/Undo Medication Admin Record

```
DELETE {{baseUrl}}/ipd/administer-med/{{recordId}}
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

---

### STEP 35 — Log Diet Intake

```
POST {{baseUrl}}/ipd/log-diet
```
**Headers:** `Authorization: Bearer {{nurseToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "category": "Breakfast",
  "items": [
    { "name": "Idli", "quantity": "2 pieces", "calories": 140 },
    { "name": "Sambar", "quantity": "100ml", "calories": 60 }
  ],
  "recordedDate": "2026-02-20",
  "recordedTime": "08:30",
  "notes": "Patient ate 70% of breakfast. Low appetite."
}
```

**`category` values:** `Breakfast` | `Lunch` | `Dinner` | `Snack` | `Fluid` | `General`

---

### STEP 36 — Delete Diet Record

```
DELETE {{baseUrl}}/ipd/delete-diet/{{recordId}}
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

---

### STEP 37 — Get Clinical History (Nurse View)

```
GET {{baseUrl}}/ipd/{{admissionId}}/clinical-history
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

Same as Doctor view — returns vitals, notes, meds, diet history.

---

### STEP 38 — Get Active Vitals Alerts

```
GET {{baseUrl}}/ipd/alerts
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

**Response:**
```json
[
  {
    "_id": "alert_id",
    "vitalName": "Systolic BP",
    "value": 180,
    "severity": "Critical",
    "status": "Active",
    "patient": { "name": "Ravi Kumar" },
    "admissionId": "ADM-xxx"
  }
]
```

---

### STEP 39 — Acknowledge/Update Alert Status

```
PATCH {{baseUrl}}/ipd/alerts/{{alertId}}
```
**Headers:** `Authorization: Bearer {{nurseToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "status": "Acknowledged",
  "notes": "Notified Dr. Sharma. Patient reassessed. BP coming down."
}
```

**`status` values:** `Active` | `Acknowledged` | `Resolved`

---

### STEP 40 — Get Patient Alert History

```
GET {{baseUrl}}/ipd/alerts/history/{{patientId}}
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

---

### STEP 41 — Add Extra Charge (Nursing Procedure)

```
POST {{baseUrl}}/ipd/billing/charge
```
**Headers:** `Authorization: Bearer {{nurseToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "category": "Nursing",
  "description": "IV line insertion + dressing",
  "amount": 300,
  "date": "2026-02-20T09:00:00.000Z"
}
```

---

## 🟡 PHASE 4 — LAB (IPD TESTS)

### STEP 42 — Lab Login

```
POST {{baseUrl}}/auth/lab/login
```
**Body:** `{ "email": "lab@hospital.com", "password": "LabPass123" }`
> ✅ Save `token` → `{{labToken}}`

---

### STEP 43 — View Lab Queue (Urgent IPD tests appear here)

```
GET {{baseUrl}}/lab/orders?priority=urgent
```
**Headers:** `Authorization: Bearer {{labToken}}`

---

### STEP 44 — Collect Sample

```
PUT {{baseUrl}}/lab/orders/{{labOrderId}}/collect
```
**Headers:** `Authorization: Bearer {{labToken}}` | `Content-Type: application/json`

**Body:**
```json
{ "sampleType": "Blood", "collectedAt": "2026-02-19T07:00:00.000Z" }
```

---

### STEP 45 — Enter Results

```
PUT {{baseUrl}}/lab/orders/{{labOrderId}}/results
```
**Headers:** `Authorization: Bearer {{labToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "results": [
    {
      "testId": "lipid_test_id",
      "value": "220",
      "unit": "mg/dL",
      "referenceRange": "<200",
      "status": "abnormal",
      "findings": "Borderline high cholesterol"
    }
  ]
}
```

---

### STEP 46 — Notify Doctor + Finalize + Pay

```
POST {{baseUrl}}/lab/orders/{{labOrderId}}/notify-doctor
PUT  {{baseUrl}}/lab/orders/{{labOrderId}}/finalize
POST {{baseUrl}}/lab/orders/{{labOrderId}}/pay
```
*(Same as OPD — see OPD Guide Steps 33-35)*

---

## 🔴 PHASE 5 — PHARMACY (IPD MEDICINES)

### STEP 47 — Pharmacy Login & Dispense

*(Same as OPD — see OPD Guide Steps 37-43)*

For IPD, the `orderId` comes from the IPD pharmacy order. Process is identical.

---

## 🏁 PHASE 6 — DISCHARGE FLOW

> **IPD Discharge is a 3-step workflow:**  
> `Doctor requests` → `Helpdesk confirms` → `Final discharge record created`

---

### STEP 48 — Step 1: Doctor Requests Discharge

*(Already covered in Step 23 above)*

```
POST {{baseUrl}}/ipd/{{admissionObjectId}}/request-discharge
```
**Headers:** `Authorization: Bearer {{doctorToken}}`

> 🔔 **Emits:** `ipd:request_updated` WebSocket → Helpdesk sees notification

---

### STEP 49 — Step 2: Helpdesk Confirms Discharge (Creates Discharge Record)

```
POST {{baseUrl}}/ipd/{{admissionId}}/confirm-discharge
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

> **Note:** Uses `admissionId` string (e.g. `ADM-xxx`), NOT the MongoDB `_id`

**Response:**
```json
{
  "success": true,
  "message": "Discharge initiated. Notifications sent to 5 users.",
  "data": {
    "admissionId": "ADM-xxx",
    "notificationCount": 5,
    "mrn": "MRN-20260219-007"
  }
}
```

> ✅ **Automatically:**
> - Admission status → `Discharge Initiated`
> - Bed status → `Cleaning`
> - BedOccupancy `endDate` → set to now
> - `PendingDischarge` record created
> - Notifications sent to all nurses, helpdesk, hospital-admin, doctor
> - `ipd:bed_updated` WebSocket emitted

---

### STEP 50 — Apply Discount Before Final Settlement

```
POST {{baseUrl}}/ipd/billing/discount
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "admissionId": "{{admissionId}}",
  "amount": 500,
  "reason": "Staff discount approved by Dr. Sharma"
}
```

---

### STEP 51 — Remove Extra Charge (If Error)

```
DELETE {{baseUrl}}/ipd/billing/charge/{{chargeId}}
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

---

### STEP 52 — Lock Bill (Finalize — No Further Changes)

```
PATCH {{baseUrl}}/ipd/billing/lock/{{admissionId}}
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

> ⚠️ **Once locked, no charges can be added or removed.**

---

### STEP 53 — Step 3: Final Discharge Patient (Basic)

```
POST {{baseUrl}}/ipd/{{admissionId}}/discharge
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

> **Note:** This is a simpler discharge that sets status to `Discharged` directly.  
> Use `confirm-discharge` (Step 49) for the full workflow with PDF generation.

---

## 🟣 PHASE 7 — PATIENT PORTAL (IPD RECORDS)

### STEP 54 — Patient Login

```
POST {{baseUrl}}/auth/login
```
**Body:**
```json
{ "mobile": "9876543200", "password": "200370" }
```
> **Password:** `DDMMYY` of DOB (`20-03-1970` → `200370`)
> ✅ Save `token` → `{{patientToken}}`

---

### STEP 55 — Patient Dashboard

```
GET {{baseUrl}}/patients/dashboard-data
```
**Headers:** `Authorization: Bearer {{patientToken}}`

---

### STEP 56 — Patient's Appointment History (Shows IPD)

```
GET {{baseUrl}}/patients/appointments
```
**Headers:** `Authorization: Bearer {{patientToken}}`

---

### STEP 57 — Patient's Prescriptions (IPD + OPD merged)

```
GET {{baseUrl}}/patients/prescriptions
```
**Headers:** `Authorization: Bearer {{patientToken}}`

---

### STEP 58 — Patient's Lab Records

```
GET {{baseUrl}}/patients/lab-records
```
**Headers:** `Authorization: Bearer {{patientToken}}`

---

## 🖥️ VITALS THRESHOLD SYSTEM (Hospital Admin)

### STEP 59 — List Vitals Threshold Templates

```
GET {{baseUrl}}/ipd/thresholds/templates
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

---

### STEP 60 — Create Threshold Template

```
POST {{baseUrl}}/ipd/thresholds/templates
```
**Headers:** `Authorization: Bearer {{adminToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "templateName": "ICU Template",
  "wardType": "ICU",
  "monitoringFrequency": { "critical": 1, "warning": 2 }
}
```

---

### STEP 61 — Get Admission Thresholds

```
GET {{baseUrl}}/ipd/thresholds/admission/{{admissionId}}
```
**Headers:** `Authorization: Bearer {{nurseToken}}`

---

## 🛏️ BED MANAGEMENT (Hospital Admin)

> **Base path:** `{{baseUrl}}/ipd/beds`  
> **Auth required for ALL bed routes:** `Authorization: Bearer {{adminToken}}`  
> **Role:** `hospital-admin` (write operations) | `helpdesk`, `nurse`, `doctor` (read operations)

---

### STEP 62 — List All Beds (with filters)

```
GET {{baseUrl}}/ipd/beds
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

**Query Params (all optional):**
| Param | Example | Description |
|---|---|---|
| `status` | `Vacant` | Filter: `Vacant` \| `Occupied` \| `Cleaning` \| `Blocked` |
| `type` | `ICU` | Filter by bed/unit type |
| `department` | `Cardiology` | Filter by department or ward |
| `room` | `ICU-1` | Filter by room label (comma-separated for multiple) |

**Examples:**
```
GET {{baseUrl}}/ipd/beds?status=Vacant
GET {{baseUrl}}/ipd/beds?status=Vacant&type=ICU
GET {{baseUrl}}/ipd/beds?department=Cardiology
GET {{baseUrl}}/ipd/beds?room=ICU-1,ICU-2
```

**Response:**
```json
[
  {
    "_id": "bed_object_id",
    "bedId": "B-ICU1-01",
    "type": "ICU",
    "floor": "1",
    "room": "ICU-1",
    "department": "Cardiology",
    "ward": "ICU-A",
    "status": "Vacant",
    "pricePerDay": 5000,
    "hospital": "hospital_object_id",
    "currentOccupancy": null
  }
]
```
> ✅ Save `_id` → `{{bedId}}`

---

### STEP 63 — Get Single Bed Details

```
GET {{baseUrl}}/ipd/beds/{{bedId}}
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

**Response:** Full bed details including active occupancy info (patient name, admission ID, vitals, billing) if `status: Occupied`.

---

### STEP 64 — Create Single Bed

```
POST {{baseUrl}}/ipd/beds
```
**Headers:** `Authorization: Bearer {{adminToken}}` | `Content-Type: application/json`

**Body:**
```json
{
  "bedId": "B-ICU1-01",
  "type": "ICU",
  "floor": "1",
  "room": "ICU-1",
  "department": "Cardiology",
  "ward": "ICU-A",
  "pricePerDay": 5000
}
```

**Field Reference:**
| Field | Required | Description |
|---|---|---|
| `bedId` | ✅ Yes | Unique bed code (e.g. `B-ICU1-01`) — unique per hospital |
| `type` | ✅ Yes | Unit type — auto-normalized to UPPERCASE. Also added to `hospital.unitTypes` |
| `floor` | ✅ Yes | Floor number as string (`"0"`, `"1"`, `"2"`, etc.) |
| `room` | ✅ Yes | Room label (e.g. `"ICU-1"`, `"GEN-101"`, `"PVT-201"`) |
| `department` | ❌ Optional | Department name (e.g. `"Cardiology"`) |
| `ward` | ❌ Optional | Ward label (e.g. `"ICU-A"`, `"WARD-1"`) |
| `pricePerDay` | ❌ Optional | Bed charge per day in ₹. Default: `0` |

**Response:**
```json
{
  "_id": "bed_object_id",
  "bedId": "B-ICU1-01",
  "type": "ICU",
  "floor": "1",
  "room": "ICU-1",
  "department": "Cardiology",
  "ward": "ICU-A",
  "status": "Vacant",
  "pricePerDay": 5000,
  "hospital": "hospital_object_id",
  "createdAt": "2026-02-19T09:05:55.218Z"
}
```
> ✅ **Embedded Architecture:** Bed is created directly within the `hospital.beds[]` array. Uniqueness of `bedId` is enforced per hospital.

---

### STEP 65 — Bulk Import Beds via CSV

> 🚀 **Most efficient way to add 100s of beds at once**

```
POST {{baseUrl}}/ipd/beds/import/beds
```
**Headers:** `Authorization: Bearer {{adminToken}}`  
**Body:** `form-data` → Key: `file` | Type: `File` | Value: `beds_hospital1.csv`

**CSV Format (exact column order required):**
```csv
bedId,type,floor,room,department,ward,pricePerDay
B-ICU1-01,ICU,1,ICU-1,Cardiology,ICU-A,5000
B-ICU1-02,ICU,1,ICU-1,Cardiology,ICU-A,5000
B-G101-01,GENERAL WARD,1,GEN-101,Pediatrics,WARD-1,1000
B-G101-02,GENERAL WARD,1,GEN-101,Pediatrics,WARD-1,1000
B-P201-01,PRIVATE,2,PVT-201,Cardiology,PVT-A,3000
B-E1-01,EMERGENCY,0,EMR-1,Emergency,ER-1,1500
```

**CSV Column Rules:**
| Column | Required | Notes |
|---|---|---|
| `bedId` | ✅ Yes | Unique per hospital. Existing = **update**. New = **insert** |
| `type` | ✅ Yes | Auto-normalized to UPPERCASE (e.g. `ICU`, `GENERAL WARD`, `PRIVATE`, `EMERGENCY`) |
| `floor` | ✅ Yes | Floor as number string. Use `0` for ground/emergency |
| `room` | ✅ Yes | Room label must match a room in `hospital.rooms[]` |
| `department` | ❌ Optional | Department name |
| `ward` | ❌ Optional | Ward label |
| `pricePerDay` | ❌ Optional | Numeric — defaults to `0` if blank |

**Import Logic:**
- ✅ **Existing `bedId`** → Updates `type`, `floor`, `room`, `department`, `ward`, `pricePerDay`
- ✅ **New `bedId`** → Appends a new sub-document to `hospital.beds[]`
- ✅ **Unit types** are auto-synced to `hospital.unitTypes[]`
- ❌ **Missing required fields** → Row is skipped and listed in `errors[]`

**Postman Setup (form-data):**
```
Key: file
Type: File
Value: [select your .csv file]
```

**Response:**
```json
{
  "message": "Import completed. 236 new entries created, 0 entries updated.",
  "errors": []
}
```

> ⚠️ **If partial errors occur**, valid rows are still imported. Check `errors[]` in response.

---

### STEP 66 — Bulk Import Rooms via CSV

```
POST {{baseUrl}}/ipd/beds/import/rooms
```
**Headers:** `Authorization: Bearer {{adminToken}}`  
**Body:** `form-data` → `file` = rooms CSV

**CSV Format:**
```csv
label,type
ICU-1,ICU
ICU-2,ICU
GEN-101,GENERAL WARD
PVT-201,PRIVATE
EMR-1,EMERGENCY
```

---

### STEP 67 — Bulk Import Departments via CSV

```
POST {{baseUrl}}/ipd/beds/import/departments
```
**Headers:** `Authorization: Bearer {{adminToken}}`  
**Body:** `form-data` → `file` = departments CSV

**CSV Format:**
```csv
name,code
Cardiology,CARDIO
Neurology,NEURO
Pediatrics,PEDS
General Medicine,GENMED
```

---

### STEP 68 — Update Bed Details

```
PATCH {{baseUrl}}/ipd/beds/{{bedId}}
```
**Headers:** `Authorization: Bearer {{adminToken}}` | `Content-Type: application/json`

**Body (send only fields to update):**
```json
{
  "type": "ICU",
  "floor": "2",
  "room": "ICU-2",
  "department": "Neurology",
  "ward": "ICU-B",
  "pricePerDay": 5500
}
```

---

### STEP 69 — Update Bed Status (Full — Admin)

```
PATCH {{baseUrl}}/ipd/beds/{{bedId}}/status
```
**Headers:** `Authorization: Bearer {{adminToken}}` | `Content-Type: application/json`

**Body:**
```json
{ "status": "Blocked" }
```
**Allowed values:** `Vacant` | `Occupied` | `Cleaning` | `Blocked`

---

### STEP 70 — Quick Bed Status Update (Helpdesk/Nurse)

```
PATCH {{baseUrl}}/ipd/beds/{{bedId}}/quick-status
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}` | `Content-Type: application/json`

**Body:**
```json
{ "status": "Vacant" }
```

**Allowed Transitions:**
| Current Status | Can Move To |
|---|---|
| `Cleaning` | `Vacant` |
| `Vacant` | `Occupied`, `Blocked`, `Cleaning` |
| `Blocked` | `Vacant` |
| `Occupied` | `Cleaning`, `Vacant` |

---

### STEP 71 — Delete Bed

```
DELETE {{baseUrl}}/ipd/beds/{{bedId}}
```
**Headers:** `Authorization: Bearer {{adminToken}}`

> ✅ **Auto-synced:** Bed `_id` is pulled from `hospital.beds[]` automatically.

---

### STEP 72 — List Rooms

```
GET {{baseUrl}}/ipd/beds/rooms
```
**Headers:** `Authorization: Bearer {{helpdeskToken}}`

**Optional:** `?type=ICU` to filter by unit type

---

### STEP 73 — Create Single Room

```
POST {{baseUrl}}/ipd/beds/rooms
```
**Headers:** `Authorization: Bearer {{adminToken}}` | `Content-Type: application/json`

**Body:**
```json
{ "label": "ICU-1", "type": "ICU" }
```

---

### STEP 74 — Update Room

```
PATCH {{baseUrl}}/ipd/beds/rooms/{{roomId}}
```
**Body:** `{ "label": "ICU-1-Updated", "type": "ICU" }`

---

### STEP 75 — Delete Room

```
DELETE {{baseUrl}}/ipd/beds/rooms/{{roomId}}
```

---

### STEP 76 — List IPD Departments

```
GET {{baseUrl}}/ipd/beds/departments
```

---

### STEP 77 — Create IPD Department

```
POST {{baseUrl}}/ipd/beds/departments
```
**Body:** `{ "name": "Cardiology", "code": "CARDIO" }`

---

### STEP 78 — Update Department

```
PATCH {{baseUrl}}/ipd/beds/departments/{{departmentId}}
```
**Body:** `{ "name": "Cardiology Updated", "code": "CARDIO" }`

---

### STEP 79 — Delete Department

```
DELETE {{baseUrl}}/ipd/beds/departments/{{departmentId}}
```

---

### STEP 80 — List Unit Types

```
GET {{baseUrl}}/ipd/beds/unit-types
```

**Response:** `["EMERGENCY", "GENERAL WARD", "ICU", "PRIVATE"]`

---

### STEP 81 — Add Unit Type

```
POST {{baseUrl}}/ipd/beds/unit-types
```
**Body:** `{ "type": "Semi-Private" }`

---

### STEP 82 — Update Unit Type

```
PATCH {{baseUrl}}/ipd/beds/unit-types
```
**Body:** `{ "oldType": "GENERAL WARD", "newType": "GENERAL" }`
> ⚠️ Updates ALL beds of this type + embedded rooms in the hospital document.

---

### STEP 83 — Delete Unit Type

```
DELETE {{baseUrl}}/ipd/beds/unit-types/:type
```
**Example:** `DELETE {{baseUrl}}/ipd/beds/unit-types/SEMI-PRIVATE`

---

### STEP 84 — Sync Existing Beds into Hospital Document (Migration)

> 🔧 **One-time migration** — run after first deployment to backfill `hospital.beds[]` from existing Bed records. Safe to re-run.

```
POST {{baseUrl}}/ipd/beds/sync-beds
```
**Headers:** `Authorization: Bearer {{adminToken}}`

**Response:**
```json
{
  "message": "✅ Synced 236 bed(s) into hospital document.",
  "synced": 236
}
```

---

## 📊 COMPLETE IPD FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────┐
│                    FRONTDESK                        │
├─────────────────────────────────────────────────────┤
│ Login → Get Doctors → Get Vacant Beds               │
│ Register Patient + Book IPD Appointment             │
│ POST /ipd → Assign Bed → Create Admission           │
│ Add Advance Payment                                 │
└────────────────┬────────────────────────────────────┘
                 │ Patient admitted to ward
                 ▼
┌─────────────────────────────────────────────────────┐
│               NURSE (Ward Care)                     │
├─────────────────────────────────────────────────────┤
│ Log Vitals (every 4-12 hrs) → Alert if abnormal     │
│ Add Clinical Notes (SOAP)                           │
│ Administer Medications (MAR)                        │
│ Log Diet Intake                                     │
│ Add Nursing Charges                                 │
└────────────────┬────────────────────────────────────┘
                 │ Doctor does rounds
                 ▼
┌─────────────────────────────────────────────────────┐
│                    DOCTOR                           │
├─────────────────────────────────────────────────────┤
│ View Assigned Patients & Clinical History           │
│ Create IPD Prescriptions                            │
│ Order IPD Lab Tests                                 │
│ Order IPD Medicines                                 │
│ Add Procedure Charges                               │
│ Request Discharge / Transfer                        │
└────────────────┬────────────────────────────────────┘
        ┌────────┴─────────┐
        ▼                  ▼
┌────────────────┐  ┌────────────────┐
│   LAB STAFF    │  │PHARMACY STAFF  │
│ Collect Sample │  │ Dispense Meds  │
│ Enter Results  │  │ Create Invoice │
│ Finalize+Pay   │  └────────────────┘
└────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│              DISCHARGE WORKFLOW                     │
├─────────────────────────────────────────────────────┤
│ 1. Doctor: POST /ipd/:id/request-discharge          │
│    → Helpdesk notified via WebSocket                │
│ 2. Helpdesk: View Bill → Apply Discount (Optional)  │
│    → POST /ipd/:admissionId/confirm-discharge       │
│    → Bed → Cleaning, Admission → Discharge Initiated│
│    → Notifications sent to all staff               │
│ 3. Lock Bill → Collect Final Balance                │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│                PATIENT PORTAL                       │
│ View IPD Admission History                          │
│ View Prescriptions & Lab Records                    │
└─────────────────────────────────────────────────────┘
```

---

## 📋 COMPLETE QUICK REFERENCE TABLE — IPD ENDPOINTS

### 🛏️ Bed & Room Management

| # | Method | Endpoint | Auth Role | Description |
|---|---|---|---|---|
| B1 | GET | `/ipd/beds` | Helpdesk/Nurse/Doctor | List beds — filter by `?status=` `?type=` `?department=` `?room=` |
| B2 | GET | `/ipd/beds/:id` | Helpdesk/Nurse/Doctor | Single bed details with occupancy |
| **B3** | **POST** | **`/ipd/beds`** | **hospital-admin** | **Create single bed** |
| B4 | PATCH | `/ipd/beds/:id` | hospital-admin | Update bed details |
| B5 | PATCH | `/ipd/beds/:id/status` | hospital-admin/helpdesk | Full status update |
| B6 | PATCH | `/ipd/beds/:id/quick-status` | helpdesk/nurse | Quick status transition |
| B7 | DELETE | `/ipd/beds/:id` | hospital-admin | Delete bed (removes from hospital.beds[] array) |
| **B8** | **POST** | **`/ipd/beds/import/beds`** | **hospital-admin** | **Bulk import beds via CSV** (`form-data: file`) |
| B9 | POST | `/ipd/beds/import/rooms` | hospital-admin | Bulk import rooms via CSV |
| B10 | POST | `/ipd/beds/import/departments` | hospital-admin | Bulk import departments via CSV |
| B11 | GET | `/ipd/beds/rooms` | Helpdesk/Nurse/Doctor | List rooms (optional `?type=ICU`) |
| B12 | POST | `/ipd/beds/rooms` | hospital-admin | Create single room |
| B13 | PATCH | `/ipd/beds/rooms/:id` | hospital-admin | Update room |
| B14 | DELETE | `/ipd/beds/rooms/:id` | hospital-admin | Delete room |
| B15 | GET | `/ipd/beds/departments` | Helpdesk/Nurse/Doctor | List IPD departments |
| B16 | POST | `/ipd/beds/departments` | hospital-admin | Create department |
| B17 | PATCH | `/ipd/beds/departments/:id` | hospital-admin | Update department |
| B18 | DELETE | `/ipd/beds/departments/:id` | hospital-admin | Delete department |
| B19 | GET | `/ipd/beds/unit-types` | Helpdesk/Nurse/Doctor | List unit types |
| B20 | POST | `/ipd/beds/unit-types` | hospital-admin | Add unit type |
| B21 | PATCH | `/ipd/beds/unit-types` | hospital-admin | Rename unit type (updates all beds) |
| B22 | DELETE | `/ipd/beds/unit-types/:type` | hospital-admin | Delete unit type |
| B23 | POST | `/ipd/beds/sync-beds` | hospital-admin | **REMOVED** (No longer needed with embedded architecture) |

---

### 🏥 IPD Admission & Clinical

| # | Method | Endpoint | Auth Role | Description |
|---|---|---|---|---|
| 1 | POST | `/helpdesk/login` | None | Frontdesk login |
| 2 | GET | `/helpdesk/me` | Helpdesk | Get profile + hospitalId |
| 3 | GET | `/helpdesk/doctors` | Helpdesk | All doctors in hospital |
| 4 | **POST** | **`/helpdesk/patients/register`** | **Helpdesk** | **Register + Book IPD** |
| 5 | GET | `/helpdesk/patients/search` | Helpdesk | Search patients |
| 6 | GET | `/helpdesk/patients/:id` | Helpdesk | Patient details |
| 7 | GET | `/helpdesk/patients/:id/ipd-admissions` | Helpdesk | IPD admission receipts |
| 8 | **POST** | **`/ipd`** | **Helpdesk** | **Initiate Admission + Assign Bed** |
| 9 | GET | `/ipd/active` | All | View active admissions |
| 10 | GET | `/ipd/pending-requests` | Helpdesk | Discharge/transfer requests |
| 11 | GET | `/ipd/{{admissionId}}` | All | Admission details |
| 12 | GET | `/ipd/:admissionId/clinical-history` | Doctor/Nurse | Full clinical history |
| 13 | GET | `/ipd/:admissionId/prescriptions` | Doctor/Nurse | IPD prescriptions |
| 14 | GET | `/ipd/:admissionId/lab-reports` | Doctor/Nurse | IPD lab reports |
| 15 | POST | `/ipd/:id/transfer` | Helpdesk | Transfer to another bed |
| 16 | POST | `/ipd/:id/request-discharge` | Doctor | Request discharge |
| 17 | POST | `/ipd/:id/request-transfer` | Doctor | Request bed transfer |
| 18 | POST | `/ipd/:id/cancel-discharge` | Doctor/Helpdesk | Cancel discharge request |
| 19 | POST | `/ipd/:id/cancel-transfer` | Doctor/Helpdesk | Cancel transfer request |
| 20 | POST | `/ipd/:admissionId/confirm-discharge` | Helpdesk | Confirm discharge |
| 21 | POST | `/ipd/:id/discharge` | Helpdesk | Final discharge |
| 22 | POST | `/auth/login` | None | Doctor/Nurse login |
| 23 | POST | `/doctor/prescriptions` | Doctor | Create IPD prescription |
| 24 | POST | `/doctor/lab-tokens` | Doctor | Order lab tests |
| 25 | POST | `/doctor/pharmacy-tokens` | Doctor | Order medicines |
| 26 | **POST** | **`/ipd/log-vitals`** | **Nurse** | **Log patient vitals** |
| 27 | **POST** | **`/ipd/add-note`** | **Nurse/Doctor** | **Add clinical note (SOAP)** |
| 28 | **POST** | **`/ipd/administer-med`** | **Nurse** | **Record medication admin (MAR)** |
| 29 | DELETE | `/ipd/administer-med/:id` | Nurse | Undo med admin record |
| 30 | **POST** | **`/ipd/log-diet`** | **Nurse** | **Log diet intake** |
| 31 | DELETE | `/ipd/delete-diet/:id` | Nurse | Delete diet record |

---

### 📊 Vitals & Alerts

| # | Method | Endpoint | Auth | Description |
|---|---|---|---|---|
| V1 | GET | `/ipd/hourly-monitoring/:admissionId` | Nurse/Doctor | Hourly monitoring chart |
| V2 | GET | `/ipd/alerts` | Nurse/Doctor | Active vitals alerts |
| V3 | PATCH | `/ipd/alerts/:alertId` | Nurse/Doctor | Update alert status |
| V4 | GET | `/ipd/alerts/history/:patientId` | Nurse/Doctor | Patient alert history |
| V5 | GET | `/ipd/thresholds/templates` | All | List threshold templates |
| V6 | POST | `/ipd/thresholds/templates` | Admin | Create template |
| V7 | GET | `/ipd/thresholds/admission/:admissionId` | All | Admission thresholds |

---

### 💰 Billing

| # | Method | Endpoint | Auth | Description |
|---|---|---|---|---|
| F1 | GET | `/ipd/billing/summary/:admissionId` | All | Full bill summary |
| F2 | POST | `/ipd/billing/charge` | Helpdesk/Nurse/Doctor | Add extra charge |
| F3 | DELETE | `/ipd/billing/charge/:chargeId` | Helpdesk | Remove charge |
| F4 | POST | `/ipd/billing/advance` | Helpdesk | Add advance payment |
| F5 | POST | `/ipd/billing/discount` | Helpdesk/Admin | Apply discount |
| F6 | PATCH | `/ipd/billing/lock/:admissionId` | Helpdesk/Admin | Lock bill |

---

### 🔬 Lab & 💊 Pharmacy & 🧑‍⚕️ Patient

| # | Method | Endpoint | Auth | Description |
|---|---|---|---|---|
| L1 | POST | `/auth/lab/login` | None | Lab login |
| L2 | GET | `/lab/orders?priority=urgent` | Lab | Lab queue |
| L3 | PUT | `/lab/orders/:id/collect` | Lab | Collect sample |
| L4 | PUT | `/lab/orders/:id/results` | Lab | Enter results |
| L5 | POST | `/lab/orders/:id/notify-doctor` | Lab | Notify doctor |
| L6 | PUT | `/lab/orders/:id/finalize` | Lab | Finalize report |
| L7 | POST | `/lab/orders/:id/pay` | Lab | Accept payment |
| P1 | POST | `/auth/pharmacy/login` | None | Pharmacy login |
| P2 | GET | `/pharmacy/orders/hospital/:id` | Pharma | Pharmacy queue |
| P3 | GET | `/pharmacy/products` | Pharma | Product catalog |
| P4 | POST | `/pharmacy/invoices` | Pharma | Create invoice |
| PT1 | POST | `/auth/login` | None | Patient login |
| PT2 | GET | `/patients/dashboard-data` | Patient | Patient dashboard |
| PT3 | GET | `/patients/appointments` | Patient | Appointment history |
| PT4 | GET | `/patients/prescriptions` | Patient | Prescriptions |
| PT5 | GET | `/patients/lab-records` | Patient | Lab records |

---

## ⚠️ IPD KEY RULES

| Rule | Detail |
|---|---|
| **One active admission per patient** | Cannot admit a patient already having `status: Active` admission |
| **Bed must be Vacant** | `bed.status !== "Vacant"` → 400 error on admission |
| **admissionId vs _id** | Most endpoints use string `admissionId` (e.g. `ADM-xxx`). `request-discharge` uses MongoDB `_id` |
| **Nurse department filter** | Nurses only see patients in their department (auto from StaffProfile) |
| **Doctor isolation** | Doctors only see their own patients (forced via DoctorProfile lookup) |
| **Critical vitals** | Auto-alerts + WebSocket `doctoral_vital_alert` sent to doctor's room |
| **Discharge flow** | `request-discharge` (doctor) → `confirm-discharge` (helpdesk) → `lock bill` → `discharge` |