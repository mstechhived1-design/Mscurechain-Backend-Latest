# 🏥 OPD COMPLETE POSTMAN GUIDE
## Outpatient Department — Full End-to-End Testing

> **All roles covered:** Frontdesk/Helpdesk → Doctor → Lab → Pharmacy → Patient Portal  
> **Flow:** Patient Registration → Appointment → Consultation (with Pause/Resume) → Prescription → Lab → Pharmacy → Invoice

---

## ⚙️ GLOBAL SETUP

### Postman Environment Variables

| Variable | Description | Example Value |
|---|---|---|
| `baseUrl` | Backend base URL | `http://localhost:5000/api` |
| `helpdeskToken` | Frontdesk JWT | _(set after login)_ |
| `doctorToken` | Doctor JWT | _(set after login)_ |
| `labToken` | Lab staff JWT | _(set after login)_ |
| `pharmaToken` | Pharmacy staff JWT | _(set after login)_ |
| `patientToken` | Patient JWT | _(set after login)_ |
| `hospitalId` | Hospital ObjectId | _(from /helpdesk/me)_ |
| `patientId` | Patient User ObjectId | _(from registration)_ |
| `appointmentId` | Appointment ObjectId | _(from booking)_ |
| `prescriptionId` | Prescription ObjectId | _(from doctor)_ |
| `labTokenId` | Lab Token ObjectId | _(from doctor)_ |
| `labOrderId` | Lab Order ObjectId | _(from lab queue)_ |
| `pharmacyOrderId` | Pharmacy Order ObjectId | _(from doctor)_ |
| `invoiceId` | Pharmacy Invoice ObjectId | _(from invoice creation)_ |

---

## 🔵 PHASE 1 — FRONTDESK / HELPDESK

### STEP 1 — Frontdesk Login

```
POST {{baseUrl}}/helpdesk/login
```
**Body (raw JSON):**
```json
{
  "email": "frontdesk@yourhospital.com",
  "password": "YourPassword123"
}
```
**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "user_object_id",
    "name": "Frontdesk Staff",
    "role": "helpdesk",
    "hospital": "hospital_object_id"
  }
}
```
> ✅ **Save:** `token` → `{{helpdeskToken}}`

---

### STEP 2 — Get Frontdesk Profile & Hospital ID

```
GET {{baseUrl}}/helpdesk/me
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```
**Response:**
```json
{
  "user": {
    "_id": "user_object_id",
    "name": "Frontdesk Staff",
    "role": "helpdesk",
    "hospital": "hospital_object_id",
    "email": "frontdesk@hospital.com"
  }
}
```
> ✅ **Save:** `hospital` → `{{hospitalId}}`

---

### STEP 3 — View Helpdesk Dashboard

```
GET {{baseUrl}}/helpdesk/dashboard
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```
**Response:** Today's appointment counts, patient registrations, revenue summary.

---

### STEP 4 — Get All Doctors in the Hospital

```
GET {{baseUrl}}/helpdesk/doctors
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```
**Response:**
```json
[
  {
    "_id": "doctor_profile_id",
    "user": {
      "_id": "doctor_user_id",
      "name": "Dr. Arjun Sharma"
    },
    "specialties": ["General Medicine"],
    "consultationFee": 700,
    "department": "OPD"
  }
]
```
> ✅ **Save:** `_id` of the doctor profile → `{{doctorProfileId}}`

---

### STEP 5 — Check Doctor Availability (Optional)

```
GET {{baseUrl}}/bookings/availability?doctorId={{doctorProfileId}}&date=2026-02-19
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```
**Response:**
```json
{
  "availableSlots": ["09:00", "09:30", "10:00", "11:00"],
  "bookedSlots": ["09:30"],
  "doctorAvailable": true
}
```

---

### STEP 6 — Register New Patient + Book OPD Appointment (Main API)

> 🎯 **This is the single most important OPD endpoint.** It handles patient registration AND appointment booking in one call.

```
POST {{baseUrl}}/helpdesk/patients/register
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
Content-Type: application/json
```
**Body (OPD - New Patient):**
```json
{
  "name": "Naseer Ahmed",
  "mobile": "9876543210",
  "email": "naseer@example.com",
  "age": 35,
  "gender": "Male",
  "dob": "1990-05-15",
  "address": "123 Main Street, Hyderabad",
  "bloodGroup": "O+",
  "allergies": "Penicillin",
  "emergencyContact": "9876543211",
  "appointmentType": "OPD",
  "doctorId": "{{doctorProfileId}}",
  "date": "2026-02-19",
  "time": "10:00",
  "reason": "Fever and headache for 3 days",
  "vitals": {
    "bloodPressure": "120/80",
    "temperature": "38.5",
    "pulse": "88",
    "spO2": "98",
    "height": "175",
    "weight": "72",
    "glucose": ""
  },
  "amount": 700,
  "paymentMethod": "cash",
  "paymentStatus": "paid"
}
```
**Body (OPD — Existing Patient, booking by mobile):**
```json
{
  "mobile": "9876543210",
  "appointmentType": "OPD",
  "doctorId": "{{doctorProfileId}}",
  "date": "2026-02-19",
  "time": "10:30",
  "reason": "Follow-up visit",
  "amount": 700,
  "paymentMethod": "upi",
  "paymentStatus": "paid"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Patient registered and appointment booked successfully",
  "patient": {
    "_id": "patient_user_id",
    "name": "Naseer Ahmed",
    "mobile": "9876543210",
    "mrn": "MRN-20260219-001"
  },
  "appointment": {
    "_id": "appointment_object_id",
    "appointmentId": "APT-1234567890",
    "status": "booked",
    "date": "2026-02-19",
    "startTime": "10:00",
    "doctor": "doctor_profile_id",
    "type": "OPD",
    "amount": 700,
    "paymentStatus": "paid"
  }
}
```
> ✅ **Save:** `patient._id` → `{{patientId}}`  
> ✅ **Save:** `appointment._id` → `{{appointmentId}}`

---

### STEP 7 — Search Patient (Verify Registration)

```
GET {{baseUrl}}/helpdesk/patients/search?query=Naseer
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```
**Query Params:**
| Param | Description |
|---|---|
| `query` | Patient name, mobile number, or MRN |

> Also supports: `GET {{baseUrl}}/helpdesk/patients/search?query=9876543210`

---

### STEP 8 — Get Patient Details

```
GET {{baseUrl}}/helpdesk/patients/{{patientId}}
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```
**Response:** Full patient profile including vitals, appointment history.

---

### STEP 9 — View Today's Appointment Queue

```
GET {{baseUrl}}/helpdesk/visits/today
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```

---

### STEP 10 — View Active Queue (Currently in Waiting/Consultation)

```
GET {{baseUrl}}/helpdesk/visits/active
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```

---

### STEP 11 — Update Appointment Status (Frontdesk Control)

```
PATCH {{baseUrl}}/helpdesk/appointments/{{appointmentId}}/status
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "status": "confirmed"
}
```
**Valid Status Values:** `booked` → `confirmed` → `in-progress` → `completed` / `cancelled`

---

### STEP 12 — View Transaction History

```
GET {{baseUrl}}/helpdesk/transactions?page=1&limit=20&startDate=2026-02-19&endDate=2026-02-19
```
**Headers:**
```
Authorization: Bearer {{helpdeskToken}}
```

---

## 🟢 PHASE 2 — DOCTOR (OPD CONSULTATION)

### STEP 13 — Doctor Login

```
POST {{baseUrl}}/auth/login
```
**Body (raw JSON):**
```json
{
  "email": "doctor@yourhospital.com",
  "password": "DoctorPassword123"
}
```
**Response:**
```json
{
  "token": "eyJhbGci...",
  "user": {
    "_id": "doctor_user_id",
    "name": "Dr. Arjun Sharma",
    "role": "doctor"
  }
}
```
> ✅ **Save:** `token` → `{{doctorToken}}`

---

### STEP 14 — Doctor Dashboard

```
GET {{baseUrl}}/doctors/dashboard
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**Response:** Today's appointments, consultation stats, pending lab results.

---

### STEP 15 — Start Consultation

> ⏱️ **This sets `status: "in-progress"` and records `consultationStartTime`**

```
POST {{baseUrl}}/doctor/appointments/{{appointmentId}}/start
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**No Body Required.**

**Response:**
```json
{
  "success": true,
  "appointment": {
    "_id": "appointment_id",
    "status": "in-progress",
    "consultationStartTime": "2026-02-19T04:30:00.000Z",
    "isPaused": false,
    "pausedDuration": 0,
    "patient": {
      "_id": "patient_user_id",
      "name": "Naseer Ahmed",
      "mobile": "9876543210",
      "age": 35,
      "gender": "Male",
      "mrn": "MRN-20260219-001",
      "bloodGroup": "O+",
      "allergies": "Penicillin",
      "address": "123 Main Street, Hyderabad"
    },
    "vitals": {
      "bloodPressure": "120/80",
      "temperature": "38.5",
      "pulse": "88",
      "spO2": "98",
      "height": "175",
      "weight": "72",
      "glucose": ""
    },
    "ipdDetails": null,
    "labResults": []
  }
}
```
> ✅ **Timer starts automatically** — frontend calculates `consultationDuration` from `consultationStartTime`

---

### STEP 16 — ⏸️ PAUSE Consultation (Mid-session)

> 🆕 **Use when doctor needs to step away mid-consultation (emergency, break, etc.)**

```
POST {{baseUrl}}/doctor/appointments/{{appointmentId}}/pause
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**No Body Required.**

**Response:**
```json
{
  "success": true,
  "message": "Consultation paused successfully",
  "appointment": {
    "_id": "appointment_id",
    "status": "in-progress",
    "isPaused": true,
    "pausedAt": "2026-02-19T04:45:00.000Z",
    "pausedDuration": 0
  }
}
```
> ✅ **Timer pauses** — `isPaused: true`, `pausedAt` stores pause timestamp  
> ✅ **Appointment stays `in-progress`** — not moved to queue

---

### STEP 17 — ▶️ RESUME Consultation

> 🆕 **Use when doctor returns to continue the paused consultation**

```
POST {{baseUrl}}/doctor/appointments/{{appointmentId}}/resume
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**No Body Required.**

**Response:**
```json
{
  "success": true,
  "message": "Consultation resumed successfully",
  "appointment": {
    "_id": "appointment_id",
    "status": "in-progress",
    "isPaused": false,
    "resumedAt": "2026-02-19T05:00:00.000Z",
    "pausedDuration": 900
  }
}
```
> ✅ **`pausedDuration`** is auto-calculated in seconds and cumulative across multiple pauses  
> ✅ **Timer resumes** — final `consultationDuration = totalTime - pausedDuration`

---

### STEP 18 — Get All Paused Appointments (Doctor's Paused Queue)

```
GET {{baseUrl}}/doctor/appointments/paused
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**Response:**
```json
{
  "success": true,
  "appointments": [
    {
      "_id": "appointment_id",
      "patient": {
        "name": "Naseer Ahmed",
        "age": 35,
        "mrn": "MRN-20260219-001"
      },
      "isPaused": true,
      "pausedAt": "2026-02-19T04:45:00.000Z",
      "status": "in-progress"
    }
  ]
}
```

---

### STEP 19 — Save Consultation Draft

> 🔄 **Auto-saves while typing — call frequently without completing the consultation**

```
POST {{baseUrl}}/doctor/appointments/{{appointmentId}}/draft
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "diagnosis": "Viral fever with mild pharyngitis",
  "clinicalNotes": "Patient presented with fever (38.5°C) for 3 days, sore throat, and body aches. No respiratory distress.",
  "plan": "Antipyretics, rest, fluids. Review in 3 days if no improvement."
}
```
**Response:**
```json
{
  "success": true,
  "message": "Draft saved successfully",
  "appointment": { ... }
}
```

---

### STEP 20 — Search Medicines (Pharmacy Inventory)

```
GET {{baseUrl}}/doctor/medicines/search?query=paracetamol
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "product_id",
      "name": "Paracetamol 500mg",
      "brand": "Calpol",
      "generic": "Paracetamol",
      "strength": "500mg",
      "form": "TAB",
      "stock": 500,
      "mrp": 2.5
    }
  ]
}
```

---

### STEP 21 — Get Lab Test Catalog

```
GET {{baseUrl}}/lab/tests
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**Response:**
```json
[
  {
    "_id": "test_id",
    "testName": "Complete Blood Count",
    "name": "CBC",
    "price": 350,
    "category": "Haematology",
    "sampleType": "Blood"
  }
]
```

---

### STEP 22 — Create Lab Token (Order Lab Tests)

```
POST {{baseUrl}}/doctor/lab-tokens
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "appointmentId": "{{appointmentId}}",
  "patientId": "{{patientId}}",
  "tests": [
    {
      "test": "lab_test_id_from_catalog",
      "instructions": "Fasting required"
    },
    {
      "test": "another_test_id",
      "instructions": ""
    }
  ],
  "priority": "routine",
  "notes": "Patient has fever - check for dengue NS1"
}
```
**Priority values:** `routine` | `urgent` | `emergency`

**Response:**
```json
{
  "_id": "lab_token_id",
  "tokenNumber": "LAB-001",
  "status": "prescribed",
  "tests": [...],
  "priority": "routine",
  "patient": "patient_id",
  "appointment": "appointment_id"
}
```
> ✅ **Save:** `_id` → `{{labTokenId}}`

---

### STEP 23 — Create Pharmacy Token (Order Medicines)

```
POST {{baseUrl}}/doctor/pharmacy-tokens
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "appointmentId": "{{appointmentId}}",
  "patientId": "{{patientId}}",
  "medicines": [
    {
      "name": "Paracetamol 500mg",
      "generic": "Paracetamol",
      "dose": "500mg",
      "freq": "TID",
      "duration": "5 days",
      "qty": 15,
      "instructions": "Take after food"
    },
    {
      "name": "Cetirizine 10mg",
      "generic": "Cetirizine",
      "dose": "10mg",
      "freq": "OD",
      "duration": "3 days",
      "qty": 3,
      "instructions": "Take at bedtime"
    }
  ],
  "notes": "Patient allergic to Penicillin"
}
```
**Response:**
```json
{
  "_id": "pharmacy_token_id",
  "status": "prescribed",
  "medicines": [
    {
      "_id": "medicine_subdoc_id",
      "name": "Paracetamol 500mg",
      "qty": 15,
      "freq": "TID"
    }
  ],
  "patient": "patient_id",
  "appointment": "appointment_id"
}
```
> ✅ **Save:** `_id` → `{{pharmacyOrderId}}`

---

### STEP 24 — Create Prescription (Full Prescription Document)

```
POST {{baseUrl}}/doctor/prescriptions
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "appointmentId": "{{appointmentId}}",
  "patientId": "{{patientId}}",
  "diagnosis": "Viral fever with mild pharyngitis",
  "clinicalNotes": "Fever 38.5°C for 3 days, sore throat, body aches. No respiratory distress.",
  "plan": "Supportive care. Review in 3 days.",
  "followUpDate": "2026-02-22",
  "medicines": [
    {
      "name": "Paracetamol 500mg",
      "generic": "Paracetamol",
      "dose": "500mg",
      "frequency": "Three times daily",
      "freq": "TID",
      "duration": "5 days",
      "qty": 15,
      "instructions": "After food"
    },
    {
      "name": "Cetirizine 10mg",
      "generic": "Cetirizine",
      "dose": "10mg",
      "frequency": "Once daily at bedtime",
      "freq": "OD",
      "duration": "3 days",
      "qty": 3,
      "instructions": "Bedtime"
    }
  ],
  "labTests": ["lab_token_id"],
  "vitals": {
    "bloodPressure": "120/80",
    "temperature": "38.5",
    "pulse": "88",
    "spO2": "98"
  }
}
```
**Response:**
```json
{
  "_id": "prescription_id",
  "prescriptionId": "RX-001",
  "diagnosis": "Viral fever with mild pharyngitis",
  "medicines": [...],
  "followUpDate": "2026-02-22",
  "createdAt": "2026-02-19T04:30:00.000Z"
}
```
> ✅ **Save:** `_id` → `{{prescriptionId}}`

---

### STEP 25 — End Consultation

> ✅ **Final step — marks appointment `completed`, records duration**

```
POST {{baseUrl}}/doctor/appointments/{{appointmentId}}/end
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "duration": 1200,
  "diagnosis": "Viral fever with mild pharyngitis",
  "clinicalNotes": "Patient presented with fever for 3 days. Examination normal except elevated temperature.",
  "plan": "Antipyretics. Review in 3 days."
}
```
> **`duration`** is in **seconds** (1200 = 20 minutes). Subtract `pausedDuration` if consultation was paused.

**Response:**
```json
{
  "success": true,
  "message": "Consultation completed successfully",
  "appointment": {
    "_id": "appointment_id",
    "status": "completed",
    "consultationEndTime": "2026-02-19T04:50:00.000Z",
    "consultationDuration": 1200
  },
  "prescriptions": [...],
  "labTokens": [...]
}
```

---

### STEP 26 — Get Full Consultation Summary

```
GET {{baseUrl}}/doctor/appointments/{{appointmentId}}/summary
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**Response:** Complete appointment with patient, doctor, vitals, prescriptions, lab tokens, pharmacy tokens.

---

### STEP 27 — Get Doctor's Lab Results

```
GET {{baseUrl}}/doctor/lab-results
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```
**Response:** All completed lab results for this doctor's patients.

---

### STEP 28 — Delete Appointment (If Needed)

```
DELETE {{baseUrl}}/doctor/appointments/{{appointmentId}}
```
**Headers:**
```
Authorization: Bearer {{doctorToken}}
```

---

## 🟡 PHASE 3 — LAB STAFF

### STEP 29 — Lab Login

```
POST {{baseUrl}}/auth/lab/login
```
**Body:**
```json
{
  "email": "lab@yourhospital.com",
  "password": "LabPassword123"
}
```
> ✅ **Save:** `token` → `{{labToken}}`

---

### STEP 30 — View Lab Work Queue

```
GET {{baseUrl}}/lab/orders?status=prescribed
```
**Headers:**
```
Authorization: Bearer {{labToken}}
```
**Response:**
```json
[
  {
    "_id": "lab_order_id",
    "tokenNumber": "LAB-001",
    "status": "prescribed",
    "patient": { "name": "Naseer Ahmed" },
    "tests": [
      { "test": { "testName": "CBC" }, "status": "pending" }
    ],
    "priority": "routine",
    "createdAt": "..."
  }
]
```
> ✅ **Save:** `_id` → `{{labOrderId}}`

---

### STEP 31 — Collect Sample

```
PUT {{baseUrl}}/lab/orders/{{labOrderId}}/collect
```
**Headers:**
```
Authorization: Bearer {{labToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "sampleType": "Blood",
  "collectedAt": "2026-02-19T05:00:00.000Z"
}
```

---

### STEP 32 — Enter Lab Results

```
PUT {{baseUrl}}/lab/orders/{{labOrderId}}/results
```
**Headers:**
```
Authorization: Bearer {{labToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "results": [
    {
      "testId": "lab_test_id",
      "value": "14.5",
      "unit": "g/dL",
      "referenceRange": "12-16",
      "status": "normal",
      "findings": "Hemoglobin within normal limits"
    }
  ]
}
```

---

### STEP 33 — Notify Doctor

```
POST {{baseUrl}}/lab/orders/{{labOrderId}}/notify-doctor
```
**Headers:**
```
Authorization: Bearer {{labToken}}
```

---

### STEP 34 — Finalize Lab Order (Mark Complete + Generate Invoice)

```
PUT {{baseUrl}}/lab/orders/{{labOrderId}}/finalize
```
**Headers:**
```
Authorization: Bearer {{labToken}}
```

---

### STEP 35 — Accept Lab Payment

```
POST {{baseUrl}}/lab/orders/{{labOrderId}}/pay
```
**Headers:**
```
Authorization: Bearer {{labToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "amount": 350,
  "paymentMode": "cash"
}
```

---

### STEP 36 — Get Lab Report (PDF-ready)

```
GET {{baseUrl}}/lab/reports/{{labOrderId}}
```
**Headers:**
```
Authorization: Bearer {{labToken}}
```

---

## 🔴 PHASE 4 — PHARMACY STAFF

### STEP 37 — Pharmacy Login

```
POST {{baseUrl}}/auth/pharmacy/login
```
**Body:**
```json
{
  "email": "pharmacy@yourhospital.com",
  "password": "PharmaPassword123"
}
```
> ✅ **Save:** `token` → `{{pharmaToken}}`

---

### STEP 38 — View Pharmacy Queue

```
GET {{baseUrl}}/pharmacy/orders/hospital/{{hospitalId}}?status=prescribed
```
**Headers:**
```
Authorization: Bearer {{pharmaToken}}
```
**Response:**
```json
[
  {
    "_id": "pharmacy_order_id",
    "status": "prescribed",
    "patient": { "name": "Naseer Ahmed" },
    "medicines": [
      {
        "_id": "medicine_subdoc_id",
        "name": "Paracetamol 500mg",
        "qty": 15,
        "freq": "TID"
      }
    ],
    "createdAt": "..."
  }
]
```

---

### STEP 39 — Get Single Pharmacy Order

```
GET {{baseUrl}}/pharmacy/orders/{{pharmacyOrderId}}
```
**Headers:**
```
Authorization: Bearer {{pharmaToken}}
```

---

### STEP 40 — Search Products in Pharmacy Catalog

> 🚨 **Critical:** Get the Product `_id` here — use it in invoice `drug` field (NOT the medicine subdoc `_id`!)

```
GET {{baseUrl}}/pharmacy/products?search=paracetamol
```
**Headers:**
```
Authorization: Bearer {{pharmaToken}}
```
**Response:**
```json
[
  {
    "_id": "PRODUCT_CATALOG_ID",
    "brand": "Calpol",
    "generic": "Paracetamol",
    "name": "Paracetamol 500mg",
    "form": "TAB",
    "strength": "500mg",
    "mrp": 2.5,
    "stock": 500,
    "gstPercent": 12,
    "hsnCode": "30049099"
  }
]
```
> ✅ **Save:** `_id` → use as `drug` in invoice items

---

### STEP 41 — Create Pharmacy Invoice (Payment Receipt)

> 🚨 **CRITICAL:** `drug` must be the Product catalog `_id` from Step 40, NOT the pharmacy order medicine subdocument `_id`!

```
POST {{baseUrl}}/pharmacy/invoices
```
**Headers:**
```
Authorization: Bearer {{pharmaToken}}
Content-Type: application/json
```
**Body (Cash Payment):**
```json
{
  "patientName": "Naseer Ahmed",
  "customerPhone": "9876543210",
  "orderId": "{{pharmacyOrderId}}",
  "mode": "CASH",
  "status": "PAID",
  "items": [
    {
      "drug": "PRODUCT_CATALOG_ID_for_paracetamol",
      "productName": "Paracetamol 500mg",
      "qty": 15,
      "unitRate": 2.5,
      "gstPct": 12,
      "discountType": "PERCENTAGE",
      "discountValue": 0
    },
    {
      "drug": "PRODUCT_CATALOG_ID_for_cetirizine",
      "productName": "Cetirizine 10mg",
      "qty": 3,
      "unitRate": 3.0,
      "gstPct": 12,
      "discountType": "PERCENTAGE",
      "discountValue": 0
    }
  ]
}
```
**Body (Mixed Payment — Cash + UPI):**
```json
{
  "patientName": "Naseer Ahmed",
  "customerPhone": "9876543210",
  "orderId": "{{pharmacyOrderId}}",
  "mode": "MIXED",
  "status": "PAID",
  "paymentDetails": {
    "cash": 30,
    "upi": 12,
    "card": 0
  },
  "items": [
    {
      "drug": "PRODUCT_CATALOG_ID",
      "productName": "Paracetamol 500mg",
      "qty": 15,
      "unitRate": 2.5,
      "gstPct": 12,
      "discountType": "PERCENTAGE",
      "discountValue": 0
    }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "invoice_id",
    "invoiceNo": "PH/26/000001",
    "patientName": "Naseer Ahmed",
    "subTotal": 46.5,
    "taxTotal": 5.58,
    "netPayable": 52,
    "paid": 52,
    "balance": 0,
    "mode": "CASH",
    "status": "PAID",
    "items": [...],
    "createdAt": "2026-02-19T05:30:00.000Z"
  }
}
```
> ✅ **Save:** `data._id` → `{{invoiceId}}`  
> 🤖 **Automatically:** Stock deducted, order → `completed`, revenue transaction logged

---

### STEP 42 — Get Invoice by ID (Print Receipt)

```
GET {{baseUrl}}/pharmacy/invoices/{{invoiceId}}
```
**Headers:**
```
Authorization: Bearer {{pharmaToken}}
```

---

### STEP 43 — Get All Pharmacy Invoices

```
GET {{baseUrl}}/pharmacy/invoices?page=1&limit=10&status=PAID
```
**Headers:**
```
Authorization: Bearer {{pharmaToken}}
```
**Query Params:**
| Param | Values | Description |
|---|---|---|
| `status` | `PAID` / `PENDING` | Filter by payment status |
| `mode` | `CASH` / `UPI` / `MIXED` | Filter by payment mode |
| `search` | Patient name or phone | Search |
| `startDate` | `2026-02-19` | Date filter |
| `endDate` | `2026-02-19` | Date filter |

---

## 🟣 PHASE 5 — PATIENT PORTAL

> 🏥 **Hospital-Aware Dashboard:** The patient portal supports multi-hospital filtering. Call `/patients/hospitals` first to get the list of hospitals the patient has visited, then pass `?hospitalId=` to any data endpoint to scope results to that hospital.

### STEP 44 — Patient Login

```
POST {{baseUrl}}/auth/login
```
**Body:**
```json
{
  "mobile": "9876543210",
  "password": "150590"
}
```
> **Default Patient Password:** `DDMMYY` format of date of birth (e.g., DOB 15-05-1990 → password `150590`)
> ✅ **Save:** `token` → `{{patientToken}}`

---

### STEP 44a — 🏥 Get Patient's Visited Hospitals (Hospital Selector)

> 🆕 **Call this first** to build the hospital switcher/dropdown in the patient UI. Returns all hospitals the patient has ever visited with visit counts sorted by most recent.

```
GET {{baseUrl}}/patients/hospitals
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "hospital_object_id_1",
      "name": "Sunrise Multi Specialty Hospital",
      "address": "12-4-56, Main Road",
      "city": "Hyderabad",
      "phone": "040-22334455",
      "logo": "https://example.com/logo.png",
      "visitCount": 5,
      "lastVisit": "2026-02-19T00:00:00.000Z"
    },
    {
      "_id": "hospital_object_id_2",
      "name": "Apollo Diagnostics",
      "address": "45 Banjara Hills",
      "city": "Hyderabad",
      "phone": "040-99887766",
      "logo": "https://apollo.com/logo.png",
      "visitCount": 2,
      "lastVisit": "2025-12-10T00:00:00.000Z"
    }
  ]
}
```
> ✅ **Save:** `data[0]._id` → `{{selectedHospitalId}}`  
> 💡 If patient has only visited 1 hospital, auto-select it. If multiple, show dropdown.

---

### STEP 44b — 🏥 Dashboard for Selected Hospital

> Pass `?hospitalId=` to scope the entire dashboard to one hospital.

```
GET {{baseUrl}}/patients/dashboard-data?hospitalId={{selectedHospitalId}}
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
> Without `?hospitalId` → returns data from **ALL hospitals** (original behavior)  
> With `?hospitalId` → returns only data from that hospital

---

### STEP 45 — Patient Dashboard (All Hospitals)

```
GET {{baseUrl}}/patients/dashboard-data
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Response:** Aggregated patient data — recent appointments, prescriptions, lab records from all hospitals.

---

### STEP 46 — Get Patient Profile

```
GET {{baseUrl}}/patients/profile
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```

---

### STEP 47 — Get Patient Appointments (with optional hospital filter)

```
GET {{baseUrl}}/patients/appointments
GET {{baseUrl}}/patients/appointments?hospitalId={{selectedHospitalId}}
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```

**Response (field-optimized):**
```json
[
  {
    "_id": "appointment_id",
    "status": "completed",
    "date": "2026-02-19",
    "hospital": {
      "name": "Sunrise Hospital",
      "address": "12 Main Road",
      "logo": "...",
      "phone": "040-12345678",
      "city": "Hyderabad"
    },
    "doctor": {
      "user": { "name": "Dr. Arjun Sharma" },
      "specialties": ["General Medicine"],
      "consultationFee": 700
    },
    "prescription": {
      "diagnosis": "Viral fever",
      "medicines": [...],
      "prescriptionDate": "..."
    },
    "labToken": {
      "tokenNumber": "LAB-001",
      "status": "completed"
    }
  }
]
```

---

### STEP 48 — Get Prescriptions & Medicines

```
GET {{baseUrl}}/patients/prescriptions
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Response:** Combined list of OPD prescriptions + pharmacy orders (merged by patient).

---

### STEP 49 — Get Lab Records

```
GET {{baseUrl}}/patients/lab-records
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```

---

### STEP 50 — Get Helpdesk Bookings

```
GET {{baseUrl}}/patients/helpdesk-prescriptions
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```

---

### STEP 51 — Update Patient Profile

```
PUT {{baseUrl}}/patients/profile
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "address": "456 New Street, Hyderabad",
  "bloodGroup": "O+",
  "allergies": "Penicillin, Amoxicillin",
  "emergencyContact": "9876543211"
}
```

---

### STEP 52 — Change Password

```
POST {{baseUrl}}/auth/change-password
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "currentPassword": "150590",
  "newPassword": "SecurePass@123"
}
```

---

## 📊 COMPLETE OPD FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────┐
│                    FRONTDESK                        │
├─────────────────────────────────────────────────────┤
│ Login → Get Hospital ID → Get Doctors               │
│ Register Patient + Book OPD Appointment             │
│ View Queue → Manage Appointment Status              │
└────────────────┬────────────────────────────────────┘
                 │ Patient arrives for consultation
                 ▼
┌─────────────────────────────────────────────────────┐
│                     DOCTOR                          │
├─────────────────────────────────────────────────────┤
│ Login → View Dashboard                              │
│ START Consultation → [Save Draft] → [PAUSE if needed]│
│          ↓                             ↓            │
│    Write Notes                    Step away         │
│          ↓                             ↓            │
│    RESUME Consultation ←──────────────┘             │
│          ↓                                          │
│ Order Lab Tests (lab-token)                         │
│ Order Medicines (pharmacy-token)                    │
│ Create Prescription                                 │
│ END Consultation → status: "completed"              │
└────────────────┬────────────────────────────────────┘
                 │ Simultaneously
        ┌────────┴─────────┐
        ▼                  ▼
┌────────────────┐  ┌────────────────┐
│   LAB STAFF    │  │PHARMACY STAFF  │
├────────────────┤  ├────────────────┤
│ View Queue     │  │ View Queue     │
│ Collect Sample │  │ Get Products   │
│ Enter Results  │  │ Create Invoice │
│ Notify Doctor  │  │ Deduct Stock   │
│ Finalize+Pay   │  └────────────────┘
└────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│                  PATIENT PORTAL                     │
├─────────────────────────────────────────────────────┤
│ Login (mobile + DOB password)                       │
│ View Dashboard → Appointments → Prescriptions       │
│ View Lab Records → Download Reports                 │
└─────────────────────────────────────────────────────┘
```

---

## 📋 COMPLETE QUICK REFERENCE TABLE — OPD ENDPOINTS

| # | Method | Endpoint | Auth Role | Description |
|---|---|---|---|---|
| 1 | POST | `/helpdesk/login` | None | Frontdesk login |
| 2 | GET | `/helpdesk/me` | Helpdesk | Get profile + hospitalId |
| 3 | GET | `/helpdesk/dashboard` | Helpdesk | Today's OPD stats |
| 4 | GET | `/helpdesk/doctors` | Helpdesk | All doctors in hospital |
| 5 | GET | `/bookings/availability` | Helpdesk | Doctor slot availability |
| 6 | **POST** | **`/helpdesk/patients/register`** | **Helpdesk** | **Register + Book OPD (Main)** |
| 7 | GET | `/helpdesk/patients/search` | Helpdesk | Search patients |
| 8 | GET | `/helpdesk/patients/:id` | Helpdesk | Patient details |
| 9 | PUT | `/helpdesk/patients/:id` | Helpdesk | Update patient info |
| 10 | GET | `/helpdesk/visits/today` | Helpdesk | Today's visits |
| 11 | GET | `/helpdesk/visits/active` | Helpdesk | Active queue |
| 12 | GET | `/helpdesk/visits/all` | Helpdesk | All visits |
| 13 | GET | `/helpdesk/visits/history/:patientId` | Helpdesk | Patient visit history |
| 14 | POST | `/helpdesk/appointments` | Helpdesk | Book for existing patient |
| 15 | PATCH | `/helpdesk/appointments/:id/status` | Helpdesk | Update appointment status |
| 16 | GET | `/helpdesk/transactions` | Helpdesk | Transaction history |
| 17 | POST | `/auth/login` | None | Doctor login |
| 18 | GET | `/doctors/dashboard` | Doctor | Doctor dashboard |
| 19 | POST | `/doctor/appointments/:id/start` | Doctor | Start consultation ⏱️ |
| 20 | **POST** | **`/doctor/appointments/:id/pause`** | **Doctor** | **⏸️ Pause consultation** |
| 21 | **POST** | **`/doctor/appointments/:id/resume`** | **Doctor** | **▶️ Resume consultation** |
| 22 | **GET** | **`/doctor/appointments/paused`** | **Doctor** | **Get paused queue** |
| 23 | POST | `/doctor/appointments/:id/draft` | Doctor | Auto-save draft |
| 24 | GET | `/doctor/medicines/search` | Doctor | Search pharmacy stock |
| 25 | GET | `/lab/tests` | Doctor | Lab test catalog |
| 26 | POST | `/doctor/lab-tokens` | Doctor | Order lab tests |
| 27 | POST | `/doctor/pharmacy-tokens` | Doctor | Order medicines |
| 28 | POST | `/doctor/prescriptions` | Doctor | Create prescription |
| 29 | POST | `/doctor/appointments/:id/end` | Doctor | End consultation ✅ |
| 30 | GET | `/doctor/appointments/:id/summary` | Doctor | Full summary |
| 31 | GET | `/doctor/lab-results` | Doctor | Lab results |
| 32 | PATCH | `/doctor/appointments/:id/status` | Doctor | Update appointment status |
| 33 | DELETE | `/doctor/appointments/:id` | Doctor | Delete appointment |
| 34 | POST | `/auth/lab/login` | None | Lab staff login |
| 35 | GET | `/lab/orders` | Lab | Lab work queue |
| 36 | PUT | `/lab/orders/:id/collect` | Lab | Collect sample |
| 37 | PUT | `/lab/orders/:id/results` | Lab | Enter results |
| 38 | POST | `/lab/orders/:id/notify-doctor` | Lab | Notify doctor |
| 39 | PUT | `/lab/orders/:id/finalize` | Lab | Finalize order |
| 40 | POST | `/lab/orders/:id/pay` | Lab | Accept payment |
| 41 | GET | `/lab/reports/:id` | Lab | Generate report |
| 42 | POST | `/auth/pharmacy/login` | None | Pharmacy login |
| 43 | GET | `/pharmacy/orders/hospital/:id` | Pharma | View pharmacy queue |
| 44 | GET | `/pharmacy/orders/:id` | Pharma | Single order details |
| 45 | GET | `/pharmacy/products` | Pharma | Search product catalog |
| 46 | **POST** | **`/pharmacy/invoices`** | **Pharma** | **Create invoice + deduct stock** |
| 47 | GET | `/pharmacy/invoices/:id` | Pharma | Get invoice by ID |
| 48 | GET | `/pharmacy/invoices` | Pharma | Invoice history |
| 49 | POST | `/auth/login` | None | Patient login |
| **50** | **GET** | **`/patients/hospitals`** | **Patient** | **🆕 Get visited hospitals (hospital selector)** |
| 51 | GET | `/patients/dashboard-data` | Patient | Patient dashboard (all hospitals) |
| 51a | GET | `/patients/dashboard-data?hospitalId=` | Patient | 🆕 Dashboard scoped to selected hospital |
| 52 | GET | `/patients/profile` | Patient | Patient profile |
| 53 | GET | `/patients/appointments` | Patient | All appointments |
| 53a | GET | `/patients/appointments?hospitalId=` | Patient | 🆕 Appointments by hospital |
| 54 | GET | `/patients/prescriptions` | Patient | Prescriptions + medicines |
| 55 | GET | `/patients/lab-records` | Patient | Lab records (real results from LabOrder) |
| 56 | GET | `/patients/helpdesk-prescriptions` | Patient | Helpdesk bookings |
| 57 | PUT | `/patients/profile` | Patient | Update profile |
| 58 | POST | `/auth/change-password` | Patient | Change password |

---

## ⏱️ STATUS & TIMING VERIFICATION

### 🔵 OPD Appointment Status Flow
```
booked → confirmed → in-progress (with isPaused toggle) → completed
                                ↑              ↓
                           PAUSED         RESUMED
```

### 🟡 Lab Order Status Flow
```
prescribed → sample_collected → processing → completed → finalized
```

### 🔴 Pharmacy Order Status Flow
```
prescribed → processing → ready → completed (after invoice created)
```

### ⏸️ Pause/Resume Fields to Verify
| Field | Type | Description |
|---|---|---|
| `isPaused` | Boolean | Is consultation currently paused? |
| `pausedAt` | DateTime | Timestamp of last pause |
| `resumedAt` | DateTime | Timestamp of last resume |
| `pausedDuration` | Number (seconds) | Total cumulative paused time |
| `consultationStartTime` | DateTime | When START was called |
| `consultationEndTime` | DateTime | When END was called |
| `consultationDuration` | Number (seconds) | Total clock time (END to START) |

> **Actual consultation time = `consultationDuration` - `pausedDuration`**

---

## 🔒 AUTH & TOKENS

### Auth Check
```
GET {{baseUrl}}/auth/me
Authorization: Bearer {{anyToken}}
```

### Logout Current Session
```
POST {{baseUrl}}/auth/logout
Authorization: Bearer {{anyToken}}
```

### Logout All Sessions
```
POST {{baseUrl}}/auth/logout-all
Authorization: Bearer {{anyToken}}
```
