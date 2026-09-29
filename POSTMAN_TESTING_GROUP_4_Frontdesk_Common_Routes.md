# Postman Testing Routes - Group 4
## Roles: Frontdesk & Common Routes (Appointments, Prescriptions, IPD)

---

## 🔐 **CRITICAL: Multi-Tenancy & Hospital ID**

> **⚠️ IMPORTANT:** This system is **multi-tenant**. Every API request MUST respect hospital boundaries for complete data isolation.

### Key Points:
1. **Patient Registration:** Patients are registered to specific hospitals
2. **Appointments:** Only show appointments within the same hospital
3. **Prescriptions:** Doctors can only create prescriptions for their hospital's patients
4. **IPD Admissions:** Bed management and admissions are hospital-specific

### Example - Patient Registration:
```javascript
// Frontdesk user from Hospital A registers a patient
POST /api/helpdesk/patients/register
{
  "name": "Naseer",
  "mobile": "9876543211"
  // hospital ID is automatically added from req.user.hospital (helpdesk token)
}

// Patient is saved with: hospital: "hospitalA_ID"
// This patient will ONLY be visible to Hospital A's staff
```

### Appointment Multi-Tenancy:
```javascript
// Patient books appointment
POST /api/appointments/book
{
  "doctor": "doctor_id",
  "date": "2024-03-20"
  // hospital is automatically added
}

// Appointment is created with:
// - patient.hospital = Hospital A
// - doctor.hospital = Hospital A  
// - appointment.hospital = Hospital A

// All three MUST match for the appointment to be valid
```

### IPD Multi-Tenancy:
- Bed assignments are per hospital
- Admission records are isolated by hospital
- Patient transfer only within the same hospital
- Discharge records are hospital-specific

### Testing Hospital Isolation:
1. Create Hospital A and Hospital B in the system
2. Create users for both hospitals
3. Create patients/appointments in Hospital A
4. Login as Hospital B user
5. Verify you CANNOT see Hospital A's data

See **[MULTI_TENANCY_HOSPITAL_ID_GUIDE.md](./MULTI_TENANCY_HOSPITAL_ID_GUIDE.md)** for complete implementation details.

---

## 🏥 FRONTDESK ROUTES

### 1. Register Patient + Book Appointment
**Route:** `POST /api/helpdesk/patients/register`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

> ℹ️ This single API registers the patient AND books the OPD/IPD appointment in one call.
> If `doctorId` is omitted, patient is registered only without any appointment.

**Request Body (OPD):**
```json
{
  "name": "Naseer",
  "mobile": "9876543211",
  "email": "naseer@example.com",
  "gender": "male",
  "age": 21,
  "dob": "2003-03-14",
  "address": "123 Healthcare Ave, Banjara Hills, Hyderabad",
  "honorific": "Mr",
  "maritalStatus": "Single",
  "bloodGroup": "O+",
  "emergencyContact": "9876543211",
  "emergencyContactEmail": "guardian@example.com",
  "medicalHistory": "History of mild asthma during childhood.",
  "allergies": "Allergic to dust and pollen.",
  "conditions": "Mild intermittent asthma.",

  "doctorId": "69954c566ee1c1f0c9975912",
  "department": "General Medicine",
  "visitType": "offline",
  "appointmentDate": "2026-02-19",
  "appointmentTime": "04:30 PM",

  "symptoms": ["Fever", "Cough"],
  "reason": "Recurring cough and mild fever for 3 days",

  "amount": 500,
  "paymentMethod": "cash",
  "paymentStatus": "Paid",
  "receiptNumber": "RCP-001"
}
```

**Response:**
```json
{
  "message": "Patient registered successfully with appointment",
  "patient": {
    "id": "6995c32593509f50d35cc13d",
    "_id": "6995c32593509f50d35cc13d",
    "name": "Naseer",
    "mrn": "MRN-1708234567-123",
    "mobile": "9876543211"
  },
  "visitId": "appointment_object_id",
  "appointmentId": "APT-1708234567-456",
  "credentials": {
    "username": "9876543211",
    "password": "140303"
  }
}
```

> 🔑 **Auto-generated password**: Based on DOB → `14-03-2003` → password = `140303`  
> For returning patients, `credentials` will be `null`.

---

### 2. Get All Patients
**Route:** `GET /api/helpdesk/patients/search?search=Naseer&page=1&limit=20`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Query Params:** `search` = name / mobile / MRN | `type` = `opd` / `ipd` (optional)

**Response:**
```json
{
  "data": [
    {
      "_id": "6995c32593509f50d35cc13d",
      "name": "Naseer",
      "email": "naseer@example.com",
      "mobile": "9876543211",
      "age": 21,
      "gender": "male",
      "profile": {
        "mrn": "MRN-1708234567-123",
        "bloodGroup": "O+",
        "gender": "male"
      },
      "isIPD": false,
      "activeAdmission": null,
      "activeConsultation": null
    }
  ],
  "pagination": {
    "page": 1,
    "total": 1,
    "pages": 1
  }
}
```

---

### 3. Get Patient by ID
**Route:** `GET /api/helpdesk/patients/{patientId}`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

> Use `patientId` = `6995c32593509f50d35cc13d` (Naseer's patient ID from registration response)

**Response:**
```json
{
  "user": {
    "_id": "6995c32593509f50d35cc13d",
    "name": "Naseer",
    "email": "naseer@example.com",
    "mobile": "9876543211",
    "role": "patient"
  },
  "profile": {
    "mrn": "MRN-1708234567-123",
    "gender": "male",
    "dob": "2003-03-14",
    "bloodGroup": "O+",
    "address": "123 Healthcare Ave, Banjara Hills, Hyderabad",
    "maritalStatus": "Single",
    "allergies": "Allergic to dust and pollen.",
    "medicalHistory": "History of mild asthma during childhood."
  },
  "lastVisit": { "_id": "appointment_id", "date": "2026-02-19", "status": "Booked" },
  "activeAdmission": null,
  "activeConsultation": null
}
```

---

### 4. Update Patient
**Route:** `PUT /api/helpdesk/patients/{patientId}`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "address": "456 Updated Lane, Hyderabad",
  "bloodGroup": "O+",
  "emergencyContact": "9876543211",
  "medicalHistory": "Mild asthma. Reviewed 2026-02-19.",
  "allergies": "Allergic to dust, pollen, and cold air."
}
```

**Response:**
```json
{
  "message": "Patient updated successfully",
  "profile": { ... }
}
```

---

### 5. Delete Patient
**Route:** `DELETE /api/frontdesk/patients/{patientId}`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Patient deleted successfully"
}
```

---

### 6. Get Today's Visits
**Route:** `GET /api/frontdesk/visits/today`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalVisits": 45,
    "visits": [
      {
        "_id": "65f8a1b2c3d4e5f6a7b8ca01",
        "patient": {
          "patientId": "P001",
          "name": "John Doe"
        },
        "doctor": "Dr. Smith",
        "visitType": "Follow-up",
        "time": "10:00 AM",
        "status": "completed"
      }
    ]
  }
}
```

---

### 7. Get Patient Visit History
**Route:** `GET /api/frontdesk/visits/history/{patientId}?page=1&limit=10`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca02",
      "visitDate": "2024-03-15",
      "doctor": "Dr. Smith",
      "department": "Cardiology",
      "diagnosis": "Hypertension",
      "treatment": "Prescribed medication",
      "nextVisit": "2024-04-15"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25
  }
}
```

---

### 8. Get Active Appointments
**Route:** `GET /api/frontdesk/visits/active`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca03",
      "patient": "John Doe",
      "doctor": "Dr. Smith",
      "time": "14:00",
      "status": "scheduled",
      "type": "Consultation"
    }
  ]
}
```

---

### 9. Get All Appointments
**Route:** `GET /api/frontdesk/visits/all?date=2024-03-15`  
**Access:** Helpdesk, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca03",
      "patient": {
        "patientId": "P001",
        "name": "John Doe"
      },
      "doctor": {
        "name": "Dr. Smith",
        "specialization": "Cardiology"
      },
      "appointmentDate": "2024-03-15",
      "appointmentTime": "14:00",
      "status": "scheduled",
      "type": "Consultation"
    }
  ]
}
```

---

## 📅 APPOINTMENT ROUTES (Common)

### 1. Book Appointment (via Helpdesk — for existing patient)
**Route:** `POST /api/helpdesk/appointments`  
**Access:** Helpdesk  
**Headers:** `Authorization: Bearer {accessToken}`

> ℹ️ Use this when patient is already registered. For new patients, use `/helpdesk/patients/register` instead.

**Request Body:**
```json
{
  "doctorId": "69954c566ee1c1f0c9975912",
  "patientId": "6995c32593509f50d35cc13d",
  "date": "2026-02-19",
  "timeSlot": "04:00 PM - 04:30 PM",
  "startTime": "04:00 PM",
  "endTime": "04:30 PM",
  "type": "offline",
  "urgency": "non-urgent",
  "symptoms": ["Fever", "Cough"],
  "reason": "Recurring cough and mild fever for 3 days",
  "amount": 700,
  "paymentMethod": "upi",
  "paymentStatus": "Paid"
}
```

**Response:**
```json
{
  "success": true,
  "appointment": {
    "_id": "appointment_object_id",
    "appointmentId": "APT-1708234567-789",
    "status": "Booked",
    "date": "2026-02-19T00:00:00.000Z",
    "appointmentTime": "04:00 PM"
  }
}
```

---

### 2. Check Availability
**Route:** `GET /api/appointments/availability?doctor={doctorId}&date=2024-03-20`  
**Access:** Patient, Helpdesk, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "2024-03-20",
    "doctor": "Dr. Smith",
    "availableSlots": [
      {
        "time": "09:00",
        "available": true
      },
      {
        "time": "10:00",
        "available": false
      },
      {
        "time": "11:00",
        "available": true
      },
      {
        "time": "14:00",
        "available": true
      }
    ]
  }
}
```

---

### 3. Update Appointment Status
**Route:** `PATCH /api/appointments/{id}/status`  
**Access:** Doctor, Helpdesk, Patient, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "status": "completed",
  "notes": "Patient consultation completed"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Appointment status updated successfully"
}
```

---

### 4. Get My Appointments
**Route:** `GET /api/appointments/my-appointments?status=scheduled&page=1&limit=10`  
**Access:** Patient, Doctor, Helpdesk, Hospital Admin, Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca04",
      "appointmentNumber": "APT-001",
      "doctor": {
        "name": "Dr. Smith",
        "specialization": "Cardiology"
      },
      "patient": {
        "name": "John Doe",
        "patientId": "P001"
      },
      "appointmentDate": "2024-03-20",
      "appointmentTime": "14:00",
      "status": "scheduled",
      "type": "Consultation"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 20
  }
}
```

---

### 5. Get Hospital Appointment Stats
**Route:** `GET /api/appointments/hospital/stats?startDate=2024-03-01&endDate=2024-03-31`  
**Access:** Hospital Admin, Super Admin, Helpdesk  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalAppointments": 500,
    "scheduled": 100,
    "completed": 350,
    "cancelled": 30,
    "noShow": 20,
    "todayAppointments": 25,
    "departmentWise": [
      {
        "department": "Cardiology",
        "count": 150
      },
      {
        "department": "Neurology",
        "count": 100
      }
    ]
  }
}
```

---

### 6. Get Appointment by ID
**Route:** `GET /api/appointments/{id}`  
**Access:** Patient, Doctor, Helpdesk, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8ca04",
    "appointmentNumber": "APT-001",
    "patient": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "patientId": "P001",
      "mobile": "+919876543210"
    },
    "doctor": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
      "name": "Dr. Smith",
      "specialization": "Cardiology"
    },
    "appointmentDate": "2024-03-20",
    "appointmentTime": "14:00",
    "status": "scheduled",
    "type": "Consultation",
    "reason": "Follow-up checkup",
    "symptoms": ["Headache", "Fever"],
    "createdAt": "2024-03-15T10:00:00Z"
  }
}
```

---

## 📋 PRESCRIPTION ROUTES (Common)

### 1. Create Prescription
**Route:** `POST /api/prescriptions`  
**Access:** Doctor (implied by protect middleware)  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "patient": "65f8a1b2c3d4e5f6a7b8c9d1",
  "appointment": "65f8a1b2c3d4e5f6a7b8ca04",
  "diagnosis": "Viral Fever",
  "medications": [
    {
      "name": "Paracetamol",
      "dosage": "500mg",
      "frequency": "Twice daily",
      "duration": "5 days",
      "instructions": "Take after meals"
    },
    {
      "name": "Cetirizine",
      "dosage": "10mg",
      "frequency": "Once daily",
      "duration": "3 days",
      "instructions": "Take before bedtime"
    }
  ],
  "labTests": [
    {
      "test": "65f8a1b2c3d4e5f6a7b8c9fa",
      "urgency": "normal",
      "instructions": "Fasting required"
    }
  ],
  "advice": "Rest for 3 days, drink plenty of fluids",
  "followUpDate": "2024-03-25"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Prescription created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8ca05",
    "prescriptionNumber": "RX-001",
    "createdAt": "2024-03-15T14:30:00Z"
  }
}
```

---

### 2. Get Prescriptions
**Route:** `GET /api/prescriptions?patientId={patientId}&page=1&limit=10`  
**Access:** Authenticated users  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca05",
      "prescriptionNumber": "RX-001",
      "patient": {
        "name": "John Doe",
        "patientId": "P001"
      },
      "doctor": {
        "name": "Dr. Smith",
        "specialization": "Cardiology"
      },
      "diagnosis": "Viral Fever",
      "date": "2024-03-15",
      "medications": [
        {
          "name": "Paracetamol",
          "dosage": "500mg",
          "frequency": "Twice daily",
          "duration": "5 days"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 15
  }
}
```

---

### 3. Get Prescription by ID
**Route:** `GET /api/prescriptions/{id}`  
**Access:** Authenticated users  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8ca05",
    "prescriptionNumber": "RX-001",
    "patient": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "patientId": "P001",
      "age": 35,
      "gender": "male"
    },
    "doctor": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
      "name": "Dr. Smith",
      "specialization": "Cardiology"
    },
    "diagnosis": "Viral Fever",
    "medications": [
      {
        "name": "Paracetamol",
        "dosage": "500mg",
        "frequency": "Twice daily",
        "duration": "5 days",
        "instructions": "Take after meals"
      }
    ],
    "labTests": [
      {
        "test": {
          "name": "Complete Blood Count",
          "shortName": "CBC"
        },
        "urgency": "normal",
        "status": "pending"
      }
    ],
    "advice": "Rest for 3 days, drink plenty of fluids",
    "followUpDate": "2024-03-25",
    "createdAt": "2024-03-15T14:30:00Z"
  }
}
```

---

### 4. Delete Prescription
**Route:** `DELETE /api/prescriptions/{id}`  
**Access:** Authenticated users  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Prescription deleted successfully"
}
```

---

### 5. Delete Multiple Prescriptions (Batch)
**Route:** `POST /api/prescriptions/delete-batch`  
**Access:** Authenticated users  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "prescriptionIds": [
    "65f8a1b2c3d4e5f6a7b8ca05",
    "65f8a1b2c3d4e5f6a7b8ca06"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Prescriptions deleted successfully",
  "deletedCount": 2
}
```

---

## 🏨 IPD (In-Patient Department) ROUTES (Common)

### 1. Initiate Admission
**Route:** `POST /api/ipd`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "patient": "65f8a1b2c3d4e5f6a7b8c9d1",
  "doctor": "65f8a1b2c3d4e5f6a7b8c9d6",
  "admissionType": "emergency",
  "admissionReason": "Severe chest pain",
  "bedNumber": "ICU-101",
  "ward": "ICU",
  "floor": 2,
  "estimatedDuration": 7,
  "initialDiagnosis": "Suspected heart attack",
  "vitalSigns": {
    "bp": "140/90",
    "pulse": 95,
    "temperature": 99.2,
    "spo2": 94
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Patient admitted successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8ca06",
    "admissionNumber": "ADM-001",
    "admissionDate": "2024-03-15T15:00:00Z",
    "bedNumber": "ICU-101",
    "status": "active"
  }
}
```

---

### 2. Get Active Admissions
**Route:** `GET /api/ipd/active?ward=ICU&page=1&limit=20`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca06",
      "admissionNumber": "ADM-001",
      "patient": {
        "name": "John Doe",
        "patientId": "P001",
        "age": 35
      },
      "doctor": {
        "name": "Dr. Smith"
      },
      "bedNumber": "ICU-101",
      "ward": "ICU",
      "admissionDate": "2024-03-15T15:00:00Z",
      "status": "active",
      "daysAdmitted": 2
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15
  }
}
```

---

### 3. Get Admission Details for Discharge
**Route:** `GET /api/ipd/{admissionId}`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8ca06",
    "admissionNumber": "ADM-001",
    "patient": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "patientId": "P001"
    },
    "doctor": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
      "name": "Dr. Smith"
    },
    "bedNumber": "ICU-101",
    "ward": "ICU",
    "admissionDate": "2024-03-15T15:00:00Z",
    "admissionType": "emergency",
    "diagnosis": "Suspected heart attack",
    "status": "active",
    "vitals": [],
    "medications": [],
    "labReports": [],
    "totalCost": 50000
  }
}
```

---

### 4. Transfer Bed
**Route:** `POST /api/ipd/{id}/transfer`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "newBedNumber": "WARD-201",
  "newWard": "General Ward",
  "newFloor": 2,
  "reason": "Patient condition improved"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bed transfer successful",
  "data": {
    "bedNumber": "WARD-201",
    "ward": "General Ward"
  }
}
```

---

### 5. Request Discharge
**Route:** `POST /api/ipd/{id}/request-discharge`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "reason": "Patient recovered",
  "notes": "Patient showing significant improvement"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Discharge request submitted successfully"
}
```

---

### 6. Request Transfer
**Route:** `POST /api/ipd/{id}/request-transfer`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "newBedNumber": "WARD-202",
  "newWard": "General Ward",
  "reason": "Downgrade from ICU"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transfer request submitted successfully"
}
```

---

### 7. Get Pending Requests
**Route:** `GET /api/ipd/pending-requests`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "dischargeRequests": [
      {
        "_id": "65f8a1b2c3d4e5f6a7b8ca07",
        "admission": {
          "admissionNumber": "ADM-001",
          "patient": "John Doe"
        },
        "reason": "Patient recovered",
        "requestedAt": "2024-03-17T10:00:00Z"
      }
    ],
    "transferRequests": []
  }
}
```

---

### 8. Cancel Discharge Request
**Route:** `POST /api/ipd/{id}/cancel-discharge`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "reason": "Patient condition deteriorated"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Discharge request cancelled successfully"
}
```

---

### 9. Confirm Discharge
**Route:** `POST /api/ipd/{admissionId}/confirm-discharge`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "dischargeDate": "2024-03-17T16:00:00Z",
  "dischargeSummary": "Patient fully recovered",
  "dischargeInstructions": "Continue medication for 7 days, follow-up in 2 weeks",
  "followUpDate": "2024-03-31"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Patient discharged successfully",
  "data": {
    "dischargeNumber": "DIS-001",
    "dischargeDate": "2024-03-17T16:00:00Z"
  }
}
```

---

### 10. Log Vitals (Nurse)
**Route:** `POST /api/ipd/log-vitals`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "admissionId": "65f8a1b2c3d4e5f6a7b8ca06",
  "bp": "120/80",
  "pulse": 72,
  "temperature": 98.6,
  "spo2": 98,
  "respiratoryRate": 16,
  "notes": "Vitals stable"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Vitals logged successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8ca08",
    "recordedAt": "2024-03-17T14:30:00Z"
  }
}
```

---

### 11. Add Clinical Note (Nurse)
**Route:** `POST /api/ipd/add-note`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "admissionId": "65f8a1b2c3d4e5f6a7b8ca06",
  "note": "Patient complained of mild headache",
  "category": "observation",
  "severity": "low"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Clinical note added successfully"
}
```

---

### 12. Administer Medication (Nurse)
**Route:** `POST /api/ipd/administer-med`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "admissionId": "65f8a1b2c3d4e5f6a7b8ca06",
  "medication": "Paracetamol",
  "dosage": "500mg",
  "route": "oral",
  "time": "2024-03-17T14:00:00Z",
  "notes": "Administered as per prescription"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Medication record added successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8ca09"
  }
}
```

---

### 13. Log Diet (Nurse)
**Route:** `POST /api/ipd/log-diet`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "admissionId": "65f8a1b2c3d4e5f6a7b8ca06",
  "mealType": "lunch",
  "items": ["Rice", "Dal", "Vegetables"],
  "quantity": "full",
  "notes": "Patient consumed entire meal"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Diet record added successfully"
}
```

---

### 14. Get Patient Clinical History
**Route:** `GET /api/ipd/{admissionId}/clinical-history`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "admission": {
      "admissionNumber": "ADM-001",
      "patient": "John Doe"
    },
    "vitals": [
      {
        "recordedAt": "2024-03-17T14:30:00Z",
        "bp": "120/80",
        "pulse": 72,
        "temperature": 98.6
      }
    ],
    "clinicalNotes": [
      {
        "note": "Patient complained of mild headache",
        "addedAt": "2024-03-17T15:00:00Z"
      }
    ],
    "medications": [],
    "dietRecords": []
  }
}
```

---

### 15. Get Prescriptions by Admission ID
**Route:** `GET /api/ipd/{admissionId}/prescriptions`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca05",
      "prescriptionNumber": "RX-001",
      "doctor": "Dr. Smith",
      "date": "2024-03-15",
      "medications": [
        {
          "name": "Paracetamol",
          "dosage": "500mg",
          "frequency": "Twice daily"
        }
      ]
    }
  ]
}
```

---

### 16. Get Lab Reports by Admission ID
**Route:** `GET /api/ipd/{admissionId}/lab-reports`  
**Access:** Hospital Admin, Helpdesk, Staff, Nurse, Doctor, Lab, Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8ca0a",
      "testName": "Complete Blood Count",
      "date": "2024-03-16",
      "status": "completed",
      "results": [
        {
          "parameter": "Hemoglobin",
          "value": 14.5,
          "unit": "g/dL"
        }
      ]
    }
  ]
}
```

---

## 📝 Testing Tips

### General Testing Guidelines
1. **Authentication Flow:** Always start with login to obtain access token
2. **Role-Based Testing:** Test each endpoint with appropriate role tokens
3. **Hospital Context:** Ensure hospital ID is properly set in user context
4. **Data Dependencies:** Create required data in sequence (e.g., patient → appointment → prescription)

### Frontdesk Testing
- Test patient registration with various data combinations
- Verify search functionality with partial names/IDs
- Test visit history pagination
- Validate emergency contact information

### Appointment Testing
- Check doctor availability before booking
- Test appointment status transitions (scheduled → in-progress → completed)
- Verify conflict prevention (double-booking)
- Test cancellation and rescheduling flows

### Prescription Testing
- Ensure doctor role is used for creation
- Test with and without lab tests
- Verify medication validation
- Test batch deletion functionality

### IPD Testing
- Follow the complete workflow: Admission → Vitals → Medication → Discharge
- Test bed transfer functionality
- Verify discharge request approval workflow
- Test nurse clinical documentation
- Validate billing integration

### Error Scenarios to Test
1. Invalid/expired tokens (401)
2. Insufficient permissions (403)
3. Missing required fields (400)
4. Non-existent resource IDs (404)
5. Duplicate entries (409)
6. Invalid date formats
7. Business logic violations (e.g., double booking)

### Performance Testing
- Test pagination with large datasets
- Verify query optimization for search endpoints
- Test concurrent appointment bookings
- Validate caching on frequently accessed endpoints
## 🧪 Hospital ID Testing
Frontdesk must register patients with correct hospital context. Test appointment booking across hospitals should be blocked.
