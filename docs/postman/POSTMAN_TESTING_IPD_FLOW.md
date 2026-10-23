# 🏥 End-to-End IPD Workflow Testing Guide (New Patient)

This guide covers the entire process from creating a **new patient** at the Front Desk to their final discharge from the In-Patient Department (IPD).

---

## 🚀 PHASE 0: Registration (Front Desk / Helpdesk)

### 1. Register New Patient
Before admission, the patient must exist in the system.
**Route:** `POST /api/auth/register-patient`
**Auth:** Helpdesk / Admin Token
**Body:**
```json
{
  "name": "Arjun Reddy",
  "email": "arjun.reddy@example.com",
  "mobile": "9988776655",
  "password": "Password123!",
  "age": 32,
  "gender": "male",
  "dateOfBirth": "1992-05-15"
}
```
**Response:**
- Note the `_id` of the user/patient from the response. Let's call this `NEW_PATIENT_ID`.

---

## 🛠 PHASE 1: System Setup (Hospital Admin)

Before admitting, ensure you have a **Vacant Bed** and a **Doctor**.

### 2. List Doctors (Find a Doctor ID)
**Route:** `GET /api/doctors`
**Auth:** Helpdesk / Admin
**Response:** Copy the `_id` of a doctor (e.g., `DOC-PROFILE-ID`). Let's call this `DOCTOR_ID`.

### 3. List Available Beds (Find a Bed ID)
**Route:** `GET /api/beds?status=Vacant`
**Auth:** Helpdesk / Admin
**Response:** Copy the `_id` of a vacant bed. Let's call this `BED_ID`.

---

## 🏥 PHASE 2: Admission (Front Desk / Helpdesk)

### 4. Admit the New Patient
**Route:** `POST /api/ipd/admissions`
**Auth:** Helpdesk Token
**Body:**
```json
{
  "patientId": "NEW_PATIENT_ID",  <-- Use ID from Step 1
  "doctorId": "DOCTOR_ID",        <-- Use ID from Step 2
  "bedId": "BED_ID",              <-- Use ID from Step 3
  "admissionType": "Emergency",
  "reason": "Severe Fever and Dehydration",
  "amount": 5000,
  "paymentMethod": "cash",
  "paymentStatus": "paid",
  "vitals": {
    "temperature": 102,
    "bloodPressure": "120/80",
    "pulse": 98,
    "spO2": 96
  }
}
```
**Response:**
- Save the `_id` (Admission Object ID). Let's call this `ADMISSION_ID`.
- Save the `admissionId` (e.g., `ADM-170...`).

---

## 👩‍⚕️ PHASE 3: Clinical Care (Nurse / Doctor)

### 5. Nurse Checkup (Log Vitals)
**Route:** `POST /api/ipd/routes/log-vitals`
**Auth:** Nurse Token
**Body:**
```json
{
  "admissionId": "ADMISSION_ID",
  "temperature": 99.5,
  "bloodPressure": "118/78",
  "pulse": 88,
  "spO2": 98,
  "glucose": 110,
  "recordedBy": "Nurse Joy"
}
```

### 6. Doctor Rounds (Add Note)
**Route:** `POST /api/ipd/routes/add-note`
**Auth:** Doctor Token
**Body:**
```json
{
  "admissionId": "ADMISSION_ID",
  "note": "Patient showing improvement. Continue hydration and antibiotics. Prepare for discharge tomorrow.",
  "type": "Progress Note"
}
```

---

## 💰 PHASE 4: Billing & Services (Staff / Lab)

### 7. Add Lab Charge (CBC Test)
**Route:** `POST /api/ipd/billing/charge`
**Auth:** Helpdesk / Staff
**Body:**
```json
{
  "admissionId": "ADMISSION_ID",
  "category": "Lab Test",
  "description": "Complete Blood Count (CBC)",
  "amount": 500,
  "date": "2024-03-20T10:00:00Z"
}
```

### 8. View Running Bill
**Route:** `GET /api/ipd/billing/summary/ADMISSION_ID`
**Auth:** Helpdesk / Admin
**Key Check:** Verify `financials.balance`. It should reflect (Bed Charges + Extra Charges - Advance Paid).

### 9. Make Payment (Clear Dues)
**Route:** `POST /api/ipd/billing/advance`
**Auth:** Helpdesk / Staff
**Body:**
```json
{
  "admissionId": "ADMISSION_ID",
  "amount": 2000,
  "mode": "UPI",
  "transactionType": "Advance",
  "reference": "UPI-PAY-999"
}
```

---

## 🚪 PHASE 5: Discharge Process

### 10. Doctor Requests Discharge
**Route:** `POST /api/ipd/routes/ADMISSION_ID/request-discharge`
**Auth:** Doctor Token
**Body:** `{}` (Empty)

### 11. Admin Confirms Discharge (Releases Bed via Cleaning)
**Route:** `POST /api/ipd/routes/ADMISSION_ID/confirm-discharge`
**Auth:** Admin / Helpdesk
**Body:** `{}`

### 12. Final Discharge (Closes Admission)
**Route:** `POST /api/ipd/routes/ADMISSION_ID/discharge`
**Auth:** Admin / Helpdesk
**Body:** `{}`
**Result:** Admission Status becomes `Discharged`. Bed is marked for cleaning/vacant.
