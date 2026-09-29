# 🏥 PATIENT PORTAL — COMPLETE POSTMAN TESTING GUIDE

> **Who uses this:** The Patient themselves (logged in with auto-generated credentials given at registration by Helpdesk)
> **Base path:** All routes under `/api/patients` and `/api/auth`
> ⚠️ **Patient credentials** are auto-generated at registration:
> - **Username:** Mobile number (e.g., `9876543211`)
> - **Password:** DOB-based (e.g., DOB `14-03-2003` → `140303`) OR if no DOB → `Pass6543211@` (last 7 of mobile)

---

## 🔗 Base URL
```
http://localhost:5003/api
```

Set these as **Postman Collection Variables**:

| Variable | Value | Set When |
|---|---|---|
| `baseUrl` | `http://localhost:5003/api` | Manual |
| `patientToken` | *(from Step 1 login)* | After Step 1 |
| `patientId` | *(from Step 1 me)* | After Step 2 |

---

## ✅ STEP 1 — PATIENT LOGIN

Patient logs in using the **general auth login** (same endpoint as doctor/nurse but with patient credentials).

### 1.1 Patient Login
```
POST {{baseUrl}}/auth/login
```
**Headers:**
```
Content-Type: application/json
```
**Body (raw JSON):**
```json
{
  "mobile": "9876543211",
  "password": "140303"
}
```
> 💡 Password format: DOB `14-03-2003` → `140303` (DDMMYY)
> If no DOB was provided at registration → password is `Pass` + last 7 digits of mobile (e.g., `Pass6543211@`)

**Response:**
```json
{
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR...",
    "refreshToken": "abc123def..."
  },
  "user": {
    "_id": "699690074e86afa9f9f6b6af",
    "name": "Naseer",
    "mobile": "9876543211",
    "role": "patient"
  }
}
```
> ✅ **Save:** `tokens.accessToken` → set as `{{patientToken}}`
> ✅ **Save:** `user._id` → set as `{{patientId}}`

---

## ✅ STEP 2 — GET PATIENT IDENTITY (Me)

### 2.1 Get Logged-in Patient Info
```
GET {{baseUrl}}/auth/me
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Response:**
```json
{
  "_id": "699690074e86afa9f9f6b6af",
  "name": "Naseer",
  "mobile": "9876543211",
  "email": "naseer@example.com",
  "role": "patient"
}
```

---

## ✅ STEP 3 — GET PATIENT PROFILE (Full Medical Profile)

### 3.1 Get Own Profile
```
GET {{baseUrl}}/patients/profile
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Response:**
```json
{
  "_id": "patient_profile_id",
  "user": {
    "_id": "699690074e86afa9f9f6b6af",
    "name": "Naseer",
    "email": "naseer@example.com",
    "mobile": "9876543211"
  },
  "mrn": "MRN-1708234567-123",
  "gender": "male",
  "dob": "2003-03-14",
  "age": 21,
  "bloodGroup": "O+",
  "address": "123 Healthcare Ave, Banjara Hills, Hyderabad",
  "honorific": "Mr",
  "maritalStatus": "Single",
  "emergencyContact": "9876543211",
  "emergencyContactEmail": "guardian@example.com",
  "medicalHistory": "History of mild asthma during childhood.",
  "allergies": "Allergic to dust and pollen.",
  "conditions": "Mild intermittent asthma.",
  "hospital": { "name": "City Hospital" }
}
```

---

## ✅ STEP 4 — PATIENT DASHBOARD (All Data in ONE Call)

> 🚀 **This is the MAIN API** for the patient dashboard — one call returns everything:
> appointments, prescriptions, medicines, lab records, discharge records, and helpdesk-booked visits.

### 4.1 Get Full Dashboard Data
```
GET {{baseUrl}}/patients/dashboard-data
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Response Structure:**
```json
{
  "success": true,
  "data": {
    "profile": {
      "mrn": "MRN-1708234567-123",
      "bloodGroup": "O+",
      "allergies": "Allergic to dust and pollen.",
      "user": { "name": "Naseer", "mobile": "9876543211" },
      "hospital": { "name": "City Hospital", "logo": "..." }
    },
    "appointments": {
      "count": 3,
      "data": [
        {
          "_id": "appointment_id",
          "date": "2026-02-19",
          "appointmentTime": "04:30 PM",
          "status": "completed",
          "type": "offline",
          "symptoms": ["Fever", "Cough"],
          "doctor": {
            "user": { "name": "Dr. Priya Sharma" },
            "specialties": ["General Physician"]
          },
          "hospital": { "name": "City Hospital" },
          "prescription": { "diagnosis": "Viral Fever" },
          "labToken": { "tokenNumber": "LAB-234567-1", "status": "pending" }
        }
      ]
    },
    "prescriptions": {
      "count": 2,
      "data": [
        {
          "_id": "prescription_id",
          "prescriptionDate": "2026-02-19T10:00:00Z",
          "diagnosis": "Viral Fever with mild headache",
          "medicines": [
            {
              "name": "Paracetamol 500mg",
              "dosage": "1 tablet",
              "frequency": "3 times a day",
              "duration": "5 days",
              "timing": "After food"
            }
          ],
          "doctor": { "user": { "name": "Dr. Priya Sharma" } }
        }
      ]
    },
    "labRecords": {
      "count": 1,
      "data": [
        {
          "_id": "lab_token_id",
          "tokenNumber": "LAB-234567-1",
          "tests": [
            {
              "name": "Complete Blood Count",
              "category": "Hematology",
              "price": 250
            }
          ],
          "status": "pending",
          "priority": "routine",
          "doctor": { "user": { "name": "Dr. Priya Sharma" } }
        }
      ]
    },
    "dischargeRecords": {
      "count": 0,
      "data": []
    },
    "helpdeskPrescriptions": {
      "count": 1,
      "data": [
        {
          "_id": "appointment_id",
          "date": "2026-02-19",
          "status": "Booked",
          "createdBy": { "name": "Ravi Kumar" },
          "doctor": { "user": { "name": "Dr. Priya Sharma" } }
        }
      ]
    }
  }
}
```
> ✅ **Response includes:**
> - `profile` — Full patient medical profile
> - `appointments` — All OPD/IPD appointments (last 20, sorted by date)
> - `prescriptions` — OPD prescriptions + IPD medication records (merged, last 50)
> - `labRecords` — All lab tokens/tests ordered by doctor (last 20)
> - `dischargeRecords` — Completed IPD discharge summaries
> - `helpdeskPrescriptions` — Appointments booked on patient's behalf by frontdesk

---

## ✅ STEP 5 — VIEW APPOINTMENTS ONLY

### 5.1 Get All Appointments
```
GET {{baseUrl}}/patients/appointments
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Returns:** All appointments sorted by date (newest first), with doctor name, hospital, prescription summary, lab token status. Limit: 50.

---

## ✅ STEP 6 — VIEW MEDICINES / PRESCRIPTIONS

### 6.1 Get All Prescriptions + Medicines
```
GET {{baseUrl}}/patients/prescriptions
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Returns (merged list of):**
- ✅ OPD prescriptions (from doctor consultation)
- ✅ Pharmacy tokens (medicines sent to pharmacy from doctor)
- ✅ Pharmacy orders (IPD/pharmacy dispensing orders)
- ✅ IPD medication administrations (inpatient drug given by nurse)

**Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "prescription_id",
      "prescriptionDate": "2026-02-19T10:00:00Z",
      "diagnosis": "Viral Fever with mild headache",
      "medicines": [
        {
          "name": "Paracetamol 500mg",
          "dosage": "1 tablet",
          "frequency": "3 times a day",
          "duration": "5 days",
          "timing": "After food",
          "notes": "Take with warm water"
        },
        {
          "name": "ORS Sachet",
          "dosage": "1 sachet in 1L water",
          "frequency": "2 times a day",
          "duration": "3 days"
        }
      ],
      "doctor": { "user": { "name": "Dr. Priya Sharma" } },
      "hospital": { "name": "City Hospital" }
    },
    {
      "_id": "pharmacy_order_id",
      "prescriptionDate": "2026-02-19T10:05:00Z",
      "diagnosis": "Pharmacy Order",
      "displayType": "Pharmacy Order",
      "medicines": [
        {
          "name": "Paracetamol 500mg",
          "dosage": "1 tablet",
          "frequency": "1-1-1",
          "duration": "5 days",
          "instructions": "Qty: 15 | 1 tablet | Status: PENDING | PRESCRIBED [PENDING]"
        }
      ],
      "tokenNumber": "PHARMA-938727-1",
      "status": "prescribed",
      "type": "pharma"
    }
  ]
}
```

---

## ✅ STEP 7 — VIEW LAB RECORDS / TEST RESULTS

### 7.1 Get All Lab Records
```
GET {{baseUrl}}/patients/lab-records
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
**Response:**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "lab_token_id",
      "tokenNumber": "LAB-234567-1",
      "tests": [
        {
          "name": "Complete Blood Count",
          "category": "Hematology",
          "price": 250,
          "instructions": "No special preparation needed"
        },
        {
          "name": "Liver Function Test",
          "category": "Biochemistry",
          "price": 650,
          "instructions": "Fasting 8 hours required"
        }
      ],
      "priority": "routine",
      "status": "pending",
      "notes": "Patient has 2-day fever. Rule out dengue.",
      "doctor": {
        "user": { "name": "Dr. Priya Sharma", "mobile": "9876543210" }
      },
      "hospital": { "name": "City Hospital" },
      "appointment": { "date": "2026-02-19" },
      "createdAt": "2026-02-19T10:15:00Z"
    }
  ]
}
```
> 📌 Lab token `status` values: `pending` → `collected` → `processing` → `completed`

---

## ✅ STEP 8 — VIEW HELPDESK-BOOKED APPOINTMENTS

### 8.1 Get Appointments Booked by Frontdesk
```
GET {{baseUrl}}/patients/helpdesk-prescriptions
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
> Returns all appointments where `createdBy` is set (i.e., frontdesk staff booked it on the patient's behalf). Includes doctor, hospital, prescription, lab token.

---

## ✅ STEP 9 — UPDATE PATIENT PROFILE

### 9.1 Update Own Profile
```
PATCH {{baseUrl}}/patients/profile
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
Content-Type: application/json
```
**Body (raw JSON) — Update any fields:**
```json
{
  "name": "Naseer Ahmed",
  "email": "naseer.updated@example.com",
  "address": "456 New Street, Jubilee Hills, Hyderabad",
  "bloodGroup": "O+",
  "allergies": "Allergic to dust, pollen, and penicillin.",
  "medicalHistory": "History of mild asthma. Diagnosed with seasonal allergies 2025.",
  "emergencyContact": "9876543200",
  "maritalStatus": "Single"
}
```
**Response:** Updated patient profile object.

> ⚠️ `name` and `email` update the **User** model. All other fields update **PatientProfile**.

---

## ✅ STEP 10 — CHANGE PASSWORD

### 10.1 Change Own Password
```
POST {{baseUrl}}/auth/change-password
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
Content-Type: application/json
```
**Body (raw JSON):**
```json
{
  "currentPassword": "140303",
  "newPassword": "MyNewPass@123"
}
```
> ⚠️ Changing password revokes ALL active sessions (refresh tokens). Patient must log in again.

---

## ✅ STEP 11 — LOGOUT

### 11.1 Logout (Current Device)
```
POST {{baseUrl}}/auth/logout
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
Content-Type: application/json
```
**Body (raw JSON):**
```json
{
  "refreshToken": "the_refresh_token_from_login"
}
```

### 11.2 Logout All Devices
```
POST {{baseUrl}}/auth/logout-all
```
**Headers:**
```
Authorization: Bearer {{patientToken}}
```
> No body needed — revokes all refresh tokens for this patient.

---

## 📋 COMPLETE QUICK REFERENCE — ALL PATIENT ROUTES

| # | Method | Endpoint | Description |
|---|---|---|---|
| 1 | POST | `/auth/login` | Patient login (mobile + DOB password) |
| 2 | GET | `/auth/me` | Get current patient info |
| 3 | GET | `/patients/profile` | Get full medical profile (MRN, blood group, allergies) |
| 4 | **GET** | **`/patients/dashboard-data`** | **ALL-IN-ONE: appointments + medicines + labs + discharge** |
| 5 | GET | `/patients/appointments` | All appointments (OPD + IPD) |
| 6 | GET | `/patients/prescriptions` | All medicines (OPD prescriptions + pharmacy orders + IPD meds) |
| 7 | GET | `/patients/lab-records` | All lab tests ordered by doctor |
| 8 | GET | `/patients/helpdesk-prescriptions` | Appointments booked by frontdesk |
| 9 | PATCH | `/patients/profile` | Update own profile info |
| 10 | POST | `/auth/change-password` | Change password |
| 11 | POST | `/auth/logout` | Logout current device |
| 12 | POST | `/auth/logout-all` | Logout all devices |

---

## 🔄 PATIENT DATA FLOW

```
Helpdesk registers patient (POST /helpdesk/patients/register)
        ↓
Patient gets credentials (mobile + DOB password)
        ↓
Patient logs in (POST /auth/login)
        ↓
Patient views dashboard (GET /patients/dashboard-data)
        ↓ shows all of:
┌─────────────────────────────────────────────┐
│  Appointments  │  Prescriptions  │  Lab Records  │
│  (OPD + IPD)   │  (medicines)    │  (test results) │
├─────────────────────────────────────────────┤
│  Discharge Records  │  Helpdesk Bookings   │
└─────────────────────────────────────────────┘
```

---

## ⚠️ IMPORTANT NOTES

1. **Patient login** uses `POST /auth/login` (NOT `/helpdesk/login` — that's for frontdesk staff)
2. **All `/patients/*` routes** require `role: "patient"` in the JWT — doctor/nurse tokens won't work
3. **Dashboard is cached** for 30 seconds — if you just registered and data isn't showing, wait 30s or call the individual endpoints
4. **Prescriptions endpoint** returns a merged list of:
   - OPD prescriptions (doctor wrote during consultation)
   - Pharmacy tokens (doctor sent medicines to pharmacy)
   - Pharmacy orders (pharmacy dispensed)
   - IPD medication records (nurse administered drugs)
5. **Lab records** show the `status` of each test — `pending` until lab staff collects and processes
6. **Profile update** (`PATCH /patients/profile`) can update both user info (name, email) and medical profile (allergies, blood group) in one call
