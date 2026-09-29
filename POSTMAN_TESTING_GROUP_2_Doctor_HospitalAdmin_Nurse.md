# Postman Testing Routes - Group 2
## Roles: Doctor, Hospital Admin, Nurse

---

## 🔐 **CRITICAL: Multi-Tenancy & Hospital ID**

> **⚠️ IMPORTANT:** This system is **multi-tenant**. Every API request and database record MUST include a `hospital` ID to ensure complete data isolation between hospitals.

### Key Points:
1. **User Authentication:** When a user logs in, their JWT token contains their `hospital` ID
2. **Automatic Filtering:** All endpoints automatically filter data by the authenticated user's hospital
3. **Hospital Field Required:** When creating records, the `hospital` field is automatically added from `req.user.hospital`
4. **Testing Multi-Tenancy:** Create separate users for different hospitals to verify isolation

### Example - Doctor Dashboard:
```javascript
// Doctor logs in to Hospital A
POST /api/auth/login
{ "email": "doctor@hospitalA.com", "password": "pass123" }

// Gets dashboard - shows ONLY Hospital A's data
GET /api/doctors/dashboard
Response: { 
  "todayAppointments": 8,  // Only from Hospital A
  "totalPatients": 150     // Only from Hospital A
}

// Doctor from Hospital B cannot see Hospital A's patients
// Their queries are automatically filtered by hospital: hospitalB_ID
```

### Hospital Admin Testing:
- Hospital Admin can only manage users/data within their hospital
- Cross-hospital operations are blocked automatically
- Super Admin is the only role that can manage multiple hospitals

See **[MULTI_TENANCY_HOSPITAL_ID_GUIDE.md](./MULTI_TENANCY_HOSPITAL_ID_GUIDE.md)** for complete implementation details.

---

## 👨‍⚕️ DOCTOR ROUTES

### 1. Search Doctors
**Route:** `GET /api/doctors?specialization=Cardiology&limit=10`  
**Access:** Public  

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
      "name": "Dr. Smith",
      "email": "smith@hospital.com",
      "specialization": "Cardiology",
      "experience": 10,
      "qualifications": ["MBBS", "MD"],
      "rating": 4.5
    }
  ]
}
```

---

### 2. Get Doctor Profile (Self)
**Route:** `GET /api/doctors/me`  
**Access:** Doctor, Hospital Admin, Super Admin, Helpdesk  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
    "name": "Dr. Smith",
    "email": "smith@hospital.com",
    "mobile": "+919876543220",
    "specialization": "Cardiology",
    "qualifications": ["MBBS", "MD"],
    "experience": 10,
    "consultationFee": 500,
    "availableDays": ["Monday", "Tuesday", "Wednesday"],
    "hospital": "65f8a1b2c3d4e5f6a7b8c9d0"
  }
}
```

---

### 3. Get Doctor Dashboard
**Route:** `GET /api/doctors/dashboard`  
**Access:** Doctor, Hospital Admin, Super Admin, Helpdesk  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "todayAppointments": 8,
    "completedToday": 5,
    "pendingAppointments": 3,
    "totalPatients": 150,
    "upcomingAppointments": [
      {
        "_id": "65f8a1b2c3d4e5f6a7b8c9e8",
        "patient": "John Doe",
        "time": "14:00",
        "type": "Follow-up"
      }
    ]
  }
}
```

---

### 4. Update Doctor Profile
**Route:** `PUT /api/doctors/me`  
**Access:** Doctor, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
name: Dr. Updated Name
mobile: +919876543221
consultationFee: 600
availableDays: ["Monday","Tuesday","Wednesday","Thursday"]
photo: [file upload]
```

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully"
}
```

---

### 5. Start Next Appointment
**Route:** `POST /api/doctors/start-next`  
**Access:** Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "appointmentId": "65f8a1b2c3d4e5f6a7b8c9e8"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "appointment": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e8",
      "patient": {
        "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
        "name": "John Doe",
        "age": 35,
        "gender": "male"
      },
      "status": "in-progress"
    }
  }
}
```

---

### 6. Upload Doctor Photo
**Route:** `POST /api/doctors/upload-photo`  
**Access:** Doctor, Hospital Admin, Super Admin, Helpdesk  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
photo: [image file]
```

**Response:**
```json
{
  "success": true,
  "message": "Photo uploaded successfully",
  "url": "https://storage.example.com/doctors/photo.jpg"
}
```

---

### 7. Get Doctor's Patients
**Route:** `GET /api/doctors/my-patients?page=1&limit=20`  
**Access:** Doctor, Hospital Admin, Super Admin, Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "patientId": "P001",
      "lastVisit": "2024-03-15",
      "totalVisits": 5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

---

### 8. Get Patient Details
**Route:** `GET /api/doctors/patient/{patientId}`  
**Access:** Doctor, Hospital Admin, Super Admin, Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "patient": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "age": 35,
      "gender": "male",
      "bloodGroup": "O+"
    },
    "medicalHistory": [
      {
        "condition": "Diabetes",
        "diagnosedDate": "2022-01-15"
      }
    ],
    "prescriptions": [],
    "appointments": []
  }
}
```

---

### 9. Get Doctor Calendar Stats
**Route:** `GET /api/doctors/calendar/stats?month=3&year=2024`  
**Access:** Doctor, Hospital Admin, Super Admin, Helpdesk  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalAppointments": 100,
    "completed": 85,
    "cancelled": 10,
    "pending": 5,
    "dailyStats": [
      {
        "date": "2024-03-01",
        "count": 8
      }
    ]
  }
}
```

---

### 10. Get Doctor Appointments by Date
**Route:** `GET /api/doctors/calendar/appointments?date=2024-03-20`  
**Access:** Doctor, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e8",
      "patient": {
        "name": "John Doe",
        "patientId": "P001"
      },
      "time": "14:00",
      "type": "Consultation",
      "status": "scheduled"
    }
  ]
}
```

---

### 11. Get Doctor Analytics
**Route:** `GET /api/doctors/analytics`  
**Access:** Doctor, Hospital Admin, Super Admin, Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "thisMonth": {
      "appointments": 50,
      "revenue": 25000
    },
    "lastMonth": {
      "appointments": 45,
      "revenue": 22500
    },
    "patientSatisfaction": 4.5
  }
}
```

---

### 12. Add Quick Note
**Route:** `POST /api/doctors/quick-notes`  
**Access:** Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "patient": "65f8a1b2c3d4e5f6a7b8c9d1",
  "note": "Patient shows improvement in blood pressure",
  "category": "observation"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Note added successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9e9"
  }
}
```

---

### 13. Get Quick Notes
**Route:** `GET /api/doctors/quick-notes?patientId=65f8a1b2c3d4e5f6a7b8c9d1`  
**Access:** Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e9",
      "note": "Patient shows improvement in blood pressure",
      "category": "observation",
      "createdAt": "2024-03-15T10:00:00Z"
    }
  ]
}
```

---

### 14. Delete Quick Note
**Route:** `DELETE /api/doctors/quick-notes/{id}`  
**Access:** Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Note deleted successfully"
}
```

---

### 15. Get Doctor by ID
**Route:** `GET /api/doctors/{id}`  
**Access:** Public

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
    "name": "Dr. Smith",
    "specialization": "Cardiology",
    "qualifications": ["MBBS", "MD"],
    "experience": 10,
    "consultationFee": 500,
    "rating": 4.5
  }
}
```

---

## 🏥 HOSPITAL ADMIN ROUTES

### 1. Get Hospital Admin Dashboard
**Route:** `GET /api/hospital-admin/dashboard`  
**Access:** Hospital Admin, Super Admin, Admin, Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalDoctors": 50,
    "totalPatients": 1000,
    "totalStaff": 100,
    "todayAppointments": 80,
    "revenue": {
      "today": 50000,
      "thisMonth": 1500000
    },
    "bedOccupancy": {
      "total": 200,
      "occupied": 150,
      "available": 50
    }
  }
}
```

---

### 2. Get Dashboard Stats
**Route:** `GET /api/hospital-admin/stats`  
**Access:** Hospital Admin, Super Admin, Admin, Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "patients": 1000,
    "doctors": 50,
    "nurses": 80,
    "staff": 100,
    "appointments": {
      "today": 80,
      "thisWeek": 500,
      "thisMonth": 2000
    }
  }
}
```

---

### 3. Get Hospital Analytics
**Route:** `GET /api/hospital-admin/analytics`  
**Access:** Hospital Admin, Super Admin, Admin, Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "revenue": {
      "daily": [50000, 55000, 60000],
      "monthly": [1500000, 1600000]
    },
    "patientFlow": {
      "inflow": 100,
      "outflow": 80
    },
    "departmentPerformance": [
      {
        "department": "Cardiology",
        "patients": 200,
        "revenue": 500000
      }
    ]
  }
}
```

---

### 4. Get Hospital Profile
**Route:** `GET /api/hospital-admin/hospital`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d0",
    "name": "City Hospital",
    "email": "contact@cityhospital.com",
    "phone": "+919876543210",
    "address": {
      "street": "123 Main Street",
      "city": "Mumbai",
      "state": "Maharashtra",
      "pincode": "400001"
    },
    "logo": "https://storage.example.com/logo.png",
    "subscriptionPlan": "premium"
  }
}
```

---

### 5. Update Hospital Profile
**Route:** `PUT /api/hospital-admin/hospital`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
name: Updated Hospital Name
phone: +919876543211
address: {"street":"456 New Street","city":"Mumbai","state":"Maharashtra","pincode":"400002"}
logo: [image file]
```

**Response:**
```json
{
  "success": true,
  "message": "Hospital profile updated successfully"
}
```

---

### 6. Get Transactions
**Route:** `GET /api/hospital-admin/transactions?page=1&limit=20`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9ea",
      "type": "payment",
      "amount": 500,
      "patient": "John Doe",
      "service": "Consultation",
      "date": "2024-03-15T10:00:00Z",
      "status": "completed"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 500
  }
}
```

---

### 7. Get All Doctors
**Route:** `GET /api/hospital-admin/doctors?page=1&limit=20`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
      "name": "Dr. Smith",
      "email": "smith@hospital.com",
      "specialization": "Cardiology",
      "isActive": true
    }
  ]
}
```

---

### 8. Create Doctor
**Route:** `POST /api/hospital-admin/doctors`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Dr. New Doctor1",
  "email": "newdoc@hospital.com",
  "mobile": "9888888881",
  "password": "Doctor1@123",
  "specialization": "Neurology",
  "qualifications": ["MBBS", "MD"],
  "experience": 5,
  "consultationFee": 700
}
```

**Response:**
```json
{
  "success": true,
  "message": "Doctor created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9eb"
  }
}
```

---

### 9. Get Doctor by ID
**Route:** `GET /api/hospital-admin/doctors/{id}`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
    "name": "Dr. Smith",
    "email": "smith@hospital.com",
    "specialization": "Cardiology",
    "qualifications": ["MBBS", "MD"],
    "experience": 10
  }
}
```

---

### 10. Update Doctor
**Route:** `PUT /api/hospital-admin/doctors/{id}`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "consultationFee": 700,
  "isActive": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Doctor updated successfully"
}
```

---

### 11. Delete Doctor
**Route:** `DELETE /api/hospital-admin/doctors/{id}`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Doctor deleted successfully"
}
```

---

### 12. Get All Helpdesks
**Route:** `GET /api/hospital-admin/helpdesks`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9ec",
      "name": "Helpdesk 1",
      "email": "helpdesk1@hospital.com",
      "isActive": true
    }
  ]
}
```

---

### 13. Create Helpdesk
**Route:** `POST /api/hospital-admin/helpdesks`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "New Helpdesk1",
  "email": "newhelpdesk@hospital.com",
  "mobile": "9777777771",
  "password": "Helpdesk1@123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Helpdesk created successfully"
}
```

---

### 14. Get All Patients
**Route:** `GET /api/hospital-admin/patients?page=1&limit=20`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "email": "john@example.com",
      "patientId": "P001",
      "age": 35
    }
  ]
}
```

---

### 15. Get All Staff
**Route:** `GET /api/hospital-admin/staff`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9ed",
      "name": "Staff Member",
      "email": "staff@hospital.com",
      "role": "staff",
      "isActive": true
    }
  ]
}
```

---

### 16. Create Staff
**Route:** `POST /api/hospital-admin/staff`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "New Staff1",
  "email": "newstaff@hospital.com",
  "mobile": "9999999991",
  "password": "Staff1@123",
  "department": "Administration"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Staff created successfully"
}
```

---

### 17. Get Staff by ID
**Route:** `GET /api/hospital-admin/staff/{id}`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9ed",
    "name": "Staff Member",
    "email": "staff@hospital.com",
    "department": "Administration"
  }
}
```

---

### 18. Get All Nurses
**Route:** `GET /api/hospital-admin/nurses`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9ee",
      "name": "Nurse Jane",
      "email": "nurse@hospital.com",
      "isActive": true
    }
  ]
}
```

---

### 19. Create Nurse
**Route:** `POST /api/hospital-admin/nurses`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

> **🔑 Hospital ID Note:**  
> You do NOT need to include `hospital` or `hospitalId` in the request body.  
> When Hospital Admin creates a nurse, the backend automatically uses:  
> `hospital = req.user.hospital` (from your JWT token)

**Request Body:**
```json
{
  "name": "New Nurse1",
  "email": "newnurse@hospital.com",
  "mobile": "9000000001",
  "password": "Nurse1@123",
  "department": "ICU"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Nurse created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9ee",
    "user": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9ef",
      "hospital": "65f8a1b2c3d4e5f6a7b8c9d0",
      "role": "nurse"
    }
  }
}
```

**How it works:**
1. Hospital Admin logs in → Token contains `hospital: hospitalA_id`
2. Calls POST /api/hospital-admin/nurses → Backend reads `req.user.hospital`
3. Nurse is created and assigned to Hospital A automatically

---

### 20. Get Attendance Report
**Route:** `GET /api/hospital-admin/attendance?month=3&year=2024`  
**Access:** Hospital Admin, Super Admin, Admin, Helpdesk, Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalWorkingDays": 26,
    "staff": [
      {
        "name": "Staff Member",
        "present": 24,
        "absent": 2,
        "percentage": 92.3
      }
    ]
  }
}
```

---

### 21. Get Shifts
**Route:** `GET /api/hospital-admin/shifts`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9ef",
      "name": "Morning Shift",
      "startTime": "08:00",
      "endTime": "16:00",
      "assignedStaff": 20
    }
  ]
}
```

---

### 22. Create Shift
**Route:** `POST /api/hospital-admin/shifts`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

> **🔑 Hospital ID Note:**  
> You do NOT need to include `hospital` in the request body.  
> The backend automatically extracts it from your JWT token: `req.user.hospital`

**Request Body:**
```json
{
  "name": "Night Shift",
  "startTime": "20:00",
  "endTime": "08:00",
  "color": "blue"
}
```

**Response:**
```json
{
  "_id": "65f8a1b2c3d4e5f6a7b8c9f2",
  "name": "Night Shift",
  "startTime": "20:00",
  "endTime": "08:00",
  "hospital": "65f8a1b2c3d4e5f6a7b8c9d0",
  "color": "blue",
  "status": "active"
}
```

**How it works:**
1. You login as Hospital Admin → JWT token contains `hospital: hospitalA_id`
2. You call create shift → Backend reads `req.user.hospital` from your token
3. Shift is created with `hospital: hospitalA_id` automatically

**Response:**
```json
{
  "success": true,
  "message": "Shift created successfully"
}
```

---

### 23. Get Payroll List
**Route:** `GET /api/hospital-admin/payroll?month=3&year=2024`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f0",
      "employee": "Staff Member",
      "basicSalary": 30000,
      "deductions": 2000,
      "netSalary": 28000,
      "status": "paid"
    }
  ]
}
```

---

### 24. Generate Payroll
**Route:** `POST /api/hospital-admin/payroll/generate`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "month": 3,
  "year": 2024,
  "employees": ["65f8a1b2c3d4e5f6a7b8c9ed"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payroll generated successfully",
  "count": 1
}
```

---

### 25. Get Quality Metrics
**Route:** `GET /api/hospital-admin/quality-metrics?month=3&year=2024`  
**Access:** Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "patientSatisfaction": 4.5,
    "mortalityRate": 0.5,
    "infectionRate": 1.2,
    "readmissionRate": 3.5
  }
}
```

---

## 👩‍⚕️ NURSE ROUTES

### 1. Get Nurse Dashboard Stats
**Route:** `GET /api/nurses/dashboard/stats`  
**Access:** Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "assignedPatients": 15,
    "criticalPatients": 3,
    "tasksCompleted": 20,
    "tasksPending": 5,
    "shift": {
      "name": "Morning Shift",
      "startTime": "08:00",
      "endTime": "16:00"
    }
  }
}
```

---

### 2. Get Nurse Patients
**Route:** `GET /api/nurses/patients`  
**Access:** Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "patientId": "P001",
      "bedNumber": "B-101",
      "ward": "ICU",
      "condition": "Critical",
      "lastVitals": {
        "bp": "120/80",
        "pulse": 75,
        "temp": 98.6,
        "recordedAt": "2024-03-15T10:00:00Z"
      }
    }
  ]
}
```

---

### 3. Get Nurse Tasks
**Route:** `GET /api/nurses/tasks?status=pending`  
**Access:** Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f1",
      "patient": "John Doe",
      "task": "Administer medication",
      "time": "14:00",
      "priority": "high",
      "status": "pending"
    }
  ]
}
```

---

### 4. Update Task
**Route:** `PUT /api/nurses/tasks/{id}`  
**Access:** Nurse  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "status": "completed",
  "notes": "Medication administered successfully"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Task updated"
}
```

---

### 5. Check In
**Route:** `POST /api/attendance/check-in`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "location": {
    "latitude": 28.5355,
    "longitude": 77.3910
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Checked in successfully",
  "data": {
    "checkInTime": "2024-03-15T08:00:00Z"
  }
}
```

---

### 6. Check Out
**Route:** `POST /api/attendance/check-out`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "location": {
    "latitude": 28.5355,
    "longitude": 77.3910
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Checked out successfully",
  "data": {
    "checkOutTime": "2024-03-15T16:00:00Z",
    "totalHours": 8
  }
}
```

---

### 7. Get Self Attendance
**Route:** `GET /api/attendance/me?month=3&year=2024`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "month": "March 2024",
    "totalDays": 26,
    "present": 24,
    "absent": 2,
    "records": [
      {
        "date": "2024-03-15",
        "checkIn": "08:00:00",
        "checkOut": "16:00:00",
        "hours": 8
      }
    ]
  }
}
```

---

### 8. Get Staff Dashboard
**Route:** `GET /api/attendance/dashboard`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "todayStatus": "checked-in",
    "checkInTime": "08:00:00",
    "currentShift": "Morning Shift",
    "monthlyAttendance": {
      "present": 15,
      "absent": 1
    }
  }
}
```

---

### 9. Get Today Attendance Status
**Route:** `GET /api/attendance/today-status`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "isCheckedIn": true,
    "checkInTime": "08:00:00",
    "checkOutTime": null,
    "currentHours": 6
  }
}
```

---

### 10. Get Self Payroll
**Route:** `GET /api/attendance/self-payroll`  
**Access:** Staff, Nurse, Helpdesk, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f0",
      "month": "March 2024",
      "basicSalary": 30000,
      "allowances": 5000,
      "deductions": 2000,
      "netSalary": 33000,
      "status": "paid",
      "paidDate": "2024-03-31"
    }
  ]
}
```

---

### 11. Get Staff Schedule
**Route:** `GET /api/attendance/schedule`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "currentWeek": [
      {
        "date": "2024-03-18",
        "shift": "Morning Shift",
        "startTime": "08:00",
        "endTime": "16:00"
      }
    ]
  }
}
```

---

### 12. Get Staff Profile
**Route:** `GET /api/attendance/profile`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9ed",
    "name": "Staff Member",
    "email": "staff@hospital.com",
    "employeeId": "EMP123",
    "department": "Administration",
    "designation": "Staff",
    "dateOfJoining": "2023-01-01"
  }
}
```

---

### 13. Update Staff Profile
**Route:** `PATCH /api/attendance/profile`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
mobile: +919876543226
emergencyContact: {"name":"Contact Person","phone":"+919876543227"}
degreeCertificate: [file upload]
```

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully"
}
```

---

## 📝 Testing Tips

1. **Role Authorization:** Ensure correct role is assigned in the JWT token
2. **Hospital Context:** Most routes require a valid hospital ID in user context
3. **File Uploads:** Use `Content-Type: multipart/form-data` for file upload endpoints
4. **Date Formats:** Use ISO 8601 format for dates (YYYY-MM-DD)
5. **Pagination:** Test with different page and limit values
6. **Validation:** Test required fields by omitting them to verify validation

---

## 🧪 Hospital ID Isolation Testing

### Test Workflow for Doctor/Hospital Admin/Nurse Roles

```http
# Setup: Create 2 hospitals (use Super Admin routes from Group 1)

# Login as Doctor from Hospital A
POST /api/auth/login
{"email": "doctor.a@hospital-a.com", "password": "pass123"}
# Save: doctorA_token (verify hospital field in response)

# Login as Doctor from Hospital B  
POST /api/auth/login
{"email": "doctor.b@hospital-b.com", "password": "pass123"}
# Save: doctorB_token (verify different hospital field)

# Test 1: List Own Appointments
GET /api/appointments/my-appointments
Authorization: Bearer {doctorA_token}
# Expected: Only Hospital A appointments

# Test 2: Cross-Hospital Access (Should FAIL)
GET /api/appointments/my-appointments
Authorization: Bearer {doctorB_token}
# Expected: Different set - only Hospital B appointments

# Test 3: Create Prescription
POST /api/prescriptions
Authorization: Bearer {doctorA_token}
{
  "patient": "{patientA_id}",
  "diagnosis": "Test",
  "medicines": [...]
}
# Verify: Response includes hospital: hospitalA_id

# Test 4: Doctor B Cannot Access Prescription A
GET /api/prescriptions/{prescriptionA_id}
Authorization: Bearer {doctorB_token}
# Expected: 404 Not Found
```

### Isolation Checklist
- [ ] Doctor A sees only Hospital A appointments
- [ ] Doctor B sees only Hospital B appointments  
- [ ] Hospital Admin A sees only Hospital A staff
- [ ] Nurse A sees only Hospital A admissions
- [ ] Cross-hospital access blocked (404 or empty)
- [ ] All created records auto-include hospital ID

**DON'T:** Manually add hospital ID in requests - it's auto-added from token
