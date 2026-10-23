# Postman Testing Routes - Group 1
## Roles: Super Admin, Patient, Emergency

---

## 🔐 **CRITICAL: Multi-Tenancy & Hospital ID**

> **⚠️ IMPORTANT:** This system is **multi-tenant**. Every API request and database record MUST include a `hospital` ID to ensure complete data isolation between hospitals.

### Key Points:
1. **User Authentication:** When a user logs in, their JWT token contains their `hospital` ID
2. **Automatic Filtering:** Most endpoints automatically filter data by the authenticated user's hospital
3. **Hospital Field Required:** When creating records (appointments, prescriptions, patients, etc.), the `hospital` field is automatically added from `req.user.hospital`
4. **Testing Multi-Tenancy:** Create separate users for different hospitals to verify isolation

### How Hospital ID Works:
```javascript
// Example: User logs in
POST /api/auth/login
{ "email": "doctor@hospital1.com", "password": "pass123" }

// Response includes access token with hospital ID embedded
{
  "user": {
    "_id": "65f8...",
    "hospital": "65f8a1b2c3d4e5f6a7b8c9d0"  // ← Hospital ID
  },
  "accessToken": "eyJhbGci..."
}

// All subsequent requests automatically filter by this hospital
GET /api/patients  // Returns only patients from hospital: 65f8a1b2c3d4e5f6a7b8c9d0
```

### Verification:
- ✅ Users can ONLY see data from their own hospital
- ✅ Users can ONLY create records in their own hospital
- ✅ Cross-hospital data access is BLOCKED
- ✅ Super Admin is the ONLY role that can see multiple hospitals

See **[MULTI_TENANCY_HOSPITAL_ID_GUIDE.md](./MULTI_TENANCY_HOSPITAL_ID_GUIDE.md)** for complete implementation details.

---

## 🔐 Authentication Routes (Common for All)

### 1. Check User Existence
**Route:** `POST /api/auth/check-existence`  
**Access:** Public  
**Description:** Check if email/mobile already exists

**Request Body:**
```json
{
  "email": "test@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "exists": false,
  "message": "Email is available"
}
```

---

### 2. Register User
**Route:** `POST /api/auth/register`  
**Access:** Public  
**Description:** Register new user

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "mobile": "+919876543210",
  "password": "SecurePass@123",
  "role": "patient",
  "hospitalId": "65f8a1b2c3d4e5f6a7b8c9d0"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "patient"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 3. Login
**Route:** `POST /api/auth/login`  
**Access:** Public  
**Description:** Login with credentials

**Request Body:**
```json
{
  "mobile": "9876543210",
  "password": "SecurePass@123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "patient",
      "hospital": "65f8a1b2c3d4e5f6a7b8c9d0"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 4. Refresh Token
**Route:** `POST /api/auth/refresh`  
**Access:** Public  
**Description:** Get new access token using refresh token

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### 5. Logout
**Route:** `POST /api/auth/logout`  
**Access:** Public  
**Description:** Logout user

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### 6. Get My Profile
**Route:** `GET /api/auth/me`  
**Access:** Private (All authenticated users)  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
    "name": "John Doe",
    "email": "john@example.com",
    "mobile": "+919876543210",
    "role": "patient",
    "hospital": "65f8a1b2c3d4e5f6a7b8c9d0"
  }
}
```

---

### 7. Update My Profile
**Route:** `PATCH /api/auth/profile`  
**Access:** Private  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "John Updated",
  "mobile": "+919876543211"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "name": "John Updated",
    "mobile": "+919876543211"
  }
}
```

---

## 👑 SUPER ADMIN ROUTES

### 1. Get Profile
**Route:** `GET /api/super-admin/profile`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d2",
    "name": "Super Admin",
    "email": "admin@mscurechain.com",
    "role": "super-admin"
  }
}
```

---

### 2. Update Profile
**Route:** `PUT /api/super-admin/profile`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Updated Admin",
  "email": "newadmin@mscurechain.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully"
}
```

---

### 3. Get Dashboard Stats
**Route:** `GET /api/super-admin/stats`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalHospitals": 50,
    "activeHospitals": 45,
    "totalUsers": 5000,
    "totalDoctors": 500,
    "totalPatients": 4000,
    "totalRevenue": 1500000
  }
}
```

---

### 4. Get Analytics
**Route:** `GET /api/super-admin/analytics`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "monthlyGrowth": {
      "hospitals": 5,
      "users": 200,
      "revenue": 50000
    },
    "topPerformingHospitals": [
      {
        "hospitalId": "65f8a1b2c3d4e5f6a7b8c9d0",
        "name": "City Hospital",
        "patients": 500,
        "revenue": 200000
      }
    ]
  }
}
```

---

### 5. Get Audit Logs
**Route:** `GET /api/super-admin/audits`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d5",
      "action": "CREATE_HOSPITAL",
      "performedBy": "admin@mscurechain.com",
      "timestamp": "2024-03-15T10:30:00Z",
      "details": {
        "hospitalName": "New Hospital"
      }
    }
  ]
}
```

---

### 6. Broadcast Message
**Route:** `POST /api/super-admin/broadcast`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "title": "System Maintenance",
  "message": "Scheduled maintenance on March 20th",
  "recipients": ["all"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Broadcast sent successfully",
  "sentTo": 5000
}
```

---

### 7. Get All Users
**Route:** `GET /api/super-admin/users?role=doctor&page=1&limit=10`  
**Access:** Super Admin  
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
      "role": "doctor",
      "hospital": "65f8a1b2c3d4e5f6a7b8c9d0",
      "isActive": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100
  }
}
```

---

### 8. Create User
**Route:** `POST /api/super-admin/users`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Dr. New Doctor",
  "email": "newdoc@hospital.com",
  "mobile": "+919876543212",
  "password": "TempPass@123",
  "role": "doctor",
  "hospital": "65f8a1b2c3d4e5f6a7b8c9d0",
  "specialization": "Cardiology"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d7",
    "name": "Dr. New Doctor",
    "email": "newdoc@hospital.com",
    "role": "doctor"
  }
}
```

---

### 9. Update User
**Route:** `PUT /api/super-admin/users/{id}`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Dr. Updated Name",
  "isActive": true,
  "specialization": "Neurology"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User updated successfully"
}
```

---

### 10. Delete User
**Route:** `DELETE /api/super-admin/users/{id}`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

---

### 11. Get All Ambulance Personnel
**Route:** `GET /api/super-admin/emergency-users`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d8",
      "name": "Emergency Staff 1",
      "employeeId": "EMP001",
      "mobile": "+919876543213",
      "vehicleNumber": "DL-01-AB-1234",
      "isActive": true
    }
  ]
}
```

---

### 12. Create Ambulance Personnel
**Route:** `POST /api/super-admin/emergency-users`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Emergency Staff 2",
  "employeeId": "EMP002",
  "mobile": "+919876543214",
  "password": "Emergency@123",
  "vehicleNumber": "DL-01-AB-5678",
  "vehicleType": "Ambulance"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Ambulance personnel created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d9",
    "employeeId": "EMP002"
  }
}
```

---

### 13. Update Ambulance Personnel
**Route:** `PUT /api/super-admin/emergency-users/{id}`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "isActive": false,
  "vehicleNumber": "DL-01-CD-9012"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Personnel updated successfully"
}
```

---

### 14. Delete Ambulance Personnel
**Route:** `DELETE /api/super-admin/emergency-users/{id}`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Personnel deleted successfully"
}
```

---

### 15. Create Hospital
**Route:** `POST /api/super-admin/create-hospital`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "New City Hospital",
  "email": "contact@newcity.com",
  "phone": "+919876543215",
  "address": {
    "street": "123 Main Street",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  },
  "subscriptionPlan": "premium",
  "subscriptionExpiry": "2025-12-31"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Hospital created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9e0",
    "name": "New City Hospital",
    "isActive": true
  }
}
```

---

### 16. Create Hospital Admin
**Route:** `POST /api/super-admin/create-hospital-admin`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Hospital Admin",
  "email": "admin@newcity.com",
  "mobile": "+919876543216",
  "password": "Admin@123",
  "hospital": "65f8a1b2c3d4e5f6a7b8c9e0"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Hospital admin created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9e1",
    "email": "admin@newcity.com",
    "role": "hospital-admin"
  }
}
```

---

### 17. List All Hospitals
**Route:** `GET /api/super-admin/hospitals?status=active&page=1&limit=10`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d0",
      "name": "City Hospital",
      "email": "contact@cityhospital.com",
      "phone": "+919876543210",
      "isActive": true,
      "subscriptionPlan": "premium",
      "subscriptionExpiry": "2025-12-31"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50
  }
}
```

---

### 18. Update Hospital Status
**Route:** `PATCH /api/super-admin/hospitals/{id}/status`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "isActive": false,
  "reason": "Payment pending"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Hospital status updated successfully"
}
```

---

### 19. Bulk Upload Hospitals
**Route:** `POST /api/super-admin/hospitals/upload`  
**Access:** Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
file: hospitals.xlsx
```

**Response:**
```json
{
  "success": true,
  "message": "Bulk upload completed",
  "data": {
    "created": 10,
    "failed": 2,
    "errors": [
      {
        "row": 5,
        "error": "Duplicate email"
      }
    ]
  }
}
```

---

## 👤 PATIENT ROUTES

### 1. Get Patient Profile
**Route:** `GET /api/patients/profile`  
**Access:** Patient, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
    "name": "John Doe",
    "email": "john@example.com",
    "mobile": "+919876543210",
    "age": 35,
    "gender": "male",
    "bloodGroup": "O+",
    "address": "123 Street, City",
    "emergencyContact": {
      "name": "Jane Doe",
      "mobile": "+919876543211",
      "relation": "Spouse"
    }
  }
}
```

---

### 2. Get Patient Profile by ID
**Route:** `GET /api/patients/profile/{id}`  
**Access:** Doctor, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
    "name": "John Doe",
    "email": "john@example.com",
    "medicalHistory": [
      {
        "condition": "Diabetes",
        "diagnosedDate": "2022-01-15",
        "status": "ongoing"
      }
    ]
  }
}
```

---

### 3. Update Patient Profile
**Route:** `PATCH /api/patients/profile`  
**Access:** Patient, Super Admin, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "mobile": "+919876543211",
  "address": "456 New Street, City",
  "bloodGroup": "AB+",
  "emergencyContact": {
    "name": "Jane Doe",
    "mobile": "+919876543212",
    "relation": "Spouse"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully"
}
```

---

### 4. Search Patients
**Route:** `GET /api/patients/search?query=John&limit=10`  
**Access:** Doctor, Nurse, Staff, Hospital Admin  
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
      "mobile": "+919876543210",
      "age": 35,
      "patientId": "P001"
    }
  ]
}
```

---

### 5. Get Patient with Bed Info
**Route:** `GET /api/patients/{patientId}/bed-info`  
**Access:** Doctor, Nurse, Staff, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "patient": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "patientId": "P001"
    },
    "bedAssignment": {
      "bedNumber": "B-101",
      "ward": "ICU",
      "floor": 2,
      "assignedDate": "2024-03-15T10:00:00Z"
    }
  }
}
```

---

### 6. Get Patient Appointments
**Route:** `GET /api/patients/appointments`  
**Access:** Patient, Doctor, Nurse, Staff  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e2",
      "doctor": {
        "_id": "65f8a1b2c3d4e5f6a7b8c9d6",
        "name": "Dr. Smith"
      },
      "date": "2024-03-20T14:00:00Z",
      "status": "scheduled",
      "type": "consultation"
    }
  ]
}
```

---

### 7. Get Patient Prescriptions
**Route:** `GET /api/patients/prescriptions`  
**Access:** Patient, Doctor, Nurse, Staff  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e3",
      "doctor": "Dr. Smith",
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
  ]
}
```

---

### 8. Get Patient Lab Records
**Route:** `GET /api/patients/lab-records`  
**Access:** Patient, Doctor, Nurse, Staff  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e4",
      "testName": "Blood Sugar",
      "date": "2024-03-15",
      "results": {
        "value": 110,
        "unit": "mg/dL",
        "normalRange": "70-100"
      },
      "status": "completed"
    }
  ]
}
```

---

### 9. Get Patient Helpdesk Prescriptions
**Route:** `GET /api/patients/helpdesk-prescriptions`  
**Access:** Patient, Doctor, Nurse, Staff  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e5",
      "prescribedBy": "Dr. John",
      "date": "2024-03-10",
      "medications": ["Aspirin 100mg"]
    }
  ]
}
```

---

### 10. Get Patient Dashboard Data
**Route:** `GET /api/patients/dashboard-data`  
**Access:** Patient, Doctor, Nurse, Staff  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "upcomingAppointments": 2,
    "activePrescriptions": 3,
    "pendingLabTests": 1,
    "recentVisits": 5,
    "healthSummary": {
      "lastCheckup": "2024-03-15",
      "nextCheckup": "2024-04-15"
    }
  }
}
```

---

## 🚑 EMERGENCY ROUTES

### 1. Emergency Login
**Route:** `POST /api/emergency/auth/login`  
**Access:** Public  
**Description:** Login for ambulance personnel

**Request Body:**
```json
{
  "identifier": "EMP001",
  "password": "Emergency@123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "personnel": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d8",
      "employeeId": "EMP001",
      "name": "Emergency Staff 1",
      "vehicleNumber": "DL-01-AB-1234"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 2. Emergency Refresh Token
**Route:** `POST /api/emergency/auth/refresh`  
**Access:** Public

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### 3. Emergency Logout
**Route:** `POST /api/emergency/auth/logout`  
**Access:** Public

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### 4. Get Emergency Personnel Profile
**Route:** `GET /api/emergency/auth/me`  
**Access:** Private (Emergency Personnel)  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9d8",
    "employeeId": "EMP001",
    "name": "Emergency Staff 1",
    "mobile": "+919876543213",
    "vehicleNumber": "DL-01-AB-1234",
    "vehicleType": "Ambulance"
  }
}
```

---

### 5. Create Emergency Request
**Route:** `POST /api/emergency/requests`  
**Access:** Private (Ambulance Personnel)  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "patientName": "Emergency Patient",
  "patientAge": 45,
  "patientGender": "male",
  "emergencyType": "Cardiac Arrest",
  "description": "Patient experiencing severe chest pain",
  "severity": "critical",
  "currentLocation": "Sector 15, Noida",
  "hospitalId": "65f8a1b2c3d4e5f6a7b8c9d0",
  "coordinates": {
    "latitude": 28.5355,
    "longitude": 77.3910
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Emergency request created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9e6",
    "requestId": "EMG001",
    "status": "pending",
    "estimatedArrival": "15 minutes"
  }
}
```

---

### 6. Create Emergency Request by Patient
**Route:** `POST /api/emergency/requests/patient`  
**Access:** Private (Patient)  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "emergencyType": "Accident",
  "description": "Road accident, multiple injuries",
  "severity": "high",
  "currentLocation": "Highway NH-24, Km 15",
  "hospitalId": "65f8a1b2c3d4e5f6a7b8c9d0",
  "coordinates": {
    "latitude": 28.5355,
    "longitude": 77.3910
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Emergency request submitted",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9e7",
    "requestId": "EMG002",
    "status": "pending"
  }
}
```

---

### 7. Get My Emergency Requests
**Route:** `GET /api/emergency/requests/my-requests`  
**Access:** Private (Ambulance Personnel)  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e6",
      "requestId": "EMG001",
      "patientName": "Emergency Patient",
      "emergencyType": "Cardiac Arrest",
      "severity": "critical",
      "status": "in-progress",
      "createdAt": "2024-03-15T10:00:00Z"
    }
  ]
}
```

---

### 8. Get Hospital Emergency Requests
**Route:** `GET /api/emergency/requests/hospital`  
**Access:** Private (Helpdesk)  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9e6",
      "requestId": "EMG001",
      "patientName": "Emergency Patient",
      "emergencyType": "Cardiac Arrest",
      "severity": "critical",
      "status": "pending",
      "personnelName": "Emergency Staff 1",
      "vehicleNumber": "DL-01-AB-1234",
      "createdAt": "2024-03-15T10:00:00Z"
    }
  ]
}
```

---

### 9. Get Emergency Stats
**Route:** `GET /api/emergency/requests/hospital/stats`  
**Access:** Private (Hospital Staff)  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 150,
    "pending": 5,
    "accepted": 10,
    "completed": 130,
    "rejected": 5,
    "todayCount": 8
  }
}
```

---

### 10. Accept Emergency Request
**Route:** `PUT /api/emergency/requests/{requestId}/accept`  
**Access:** Private (Helpdesk)  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "assignedDoctor": "65f8a1b2c3d4e5f6a7b8c9d6",
  "bedNumber": "E-101",
  "notes": "Patient will be admitted to emergency ward"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Emergency request accepted"
}
```

---

### 11. Reject Emergency Request
**Route:** `PUT /api/emergency/requests/{requestId}/reject`  
**Access:** Private (Helpdesk)  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "rejectionReason": "All emergency beds occupied"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Emergency request rejected"
}
```

---

### 12. Get Available Hospitals
**Route:** `GET /api/emergency/requests/hospitals`  
**Access:** Private (Ambulance Personnel)  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d0",
      "name": "City Hospital",
      "address": "123 Main Street, Mumbai",
      "phone": "+919876543210",
      "emergencyAvailable": true,
      "distance": "2.5 km",
      "availableBeds": 10
    }
  ]
}
```

---

## 📝 Testing Tips

1. **Authentication:** Always obtain the access token first using login endpoint
2. **Headers:** Include `Authorization: Bearer {token}` for all protected routes
3. **Hospital ID:** Most routes require a valid hospital ID in the request or user context
4. **Pagination:** Use `page` and `limit` query parameters for list endpoints
5. **Error Handling:** Check for proper error responses (400, 401, 403, 404, 500)
6. **Data Validation:** Test with invalid/missing fields to verify validation

---

## 🧪 Hospital ID Multi-Tenancy Isolation Testing

### Quick Test Flow

#### Setup: Create 2 Hospitals for Testing

**Step 1:** Login as Super Admin → Create Hospital A → Create Hospital B

**Step 2:** Create Hospital Admin in each hospital → Create Doctor in each hospital

**Step 3:** Test isolation - Doctor A should NOT see Doctor B's data

---

### Complete Testing Workflow

#### Phase 1: Setup Hospitals

```http
# 1. Super Admin Login
POST /api/auth/login
{"email": "superadmin@mscurechain.com", "password": "admin123"}
# Save: superadmin_token

# 2. Create Hospital A
POST /api/super-admin/hospitals
Authorization: Bearer {superadmin_token}
{
  "name": "City General Hospital",
  "email": "admin@cityhospital.com",
  "mobile": "+919876543210",
  "licenseNumber": "LIC-001"
}
# Save: hospitalA_id

# 3. Create Hospital B  
POST /api/super-admin/hospitals
Authorization: Bearer {superadmin_token}
{
  "name": "Metro Care Hospital",
  "email": "admin@metrohospital.com",
  "mobile": "+919876543220",
  "licenseNumber": "LIC-002"
}
# Save: hospitalB_id
```

---

#### Phase 2: Create Users in Each Hospital

```http
# 4. Create Doctor in Hospital A
POST /api/super-admin/users
Authorization: Bearer {superadmin_token}
{
  "name": "Dr. Sarah",
  "email": "sarah@cityhospital.com",
  "mobile": "+919876543230",
  "password": "Doctor@123",
  "role": "doctor",
  "hospital": "{hospitalA_id}",
  "specialization": "Cardiology"
}
# Save: doctorA_id

# 5. Create Doctor in Hospital B
POST /api/super-admin/users
Authorization: Bearer {superadmin_token}
{
  "name": "Dr. Mike",
  "email": "mike@metrohospital.com",
  "mobile": "+919876543240",
  "password": "Doctor@123",
  "role": "doctor",
  "hospital": "{hospitalB_id}",
  "specialization": "Neurology"
}
# Save: doctorB_id
```

---

#### Phase 3: Test Isolation

```http
# 6. Login as Doctor A
POST /api/auth/login
{"email": "sarah@cityhospital.com", "password": "Doctor@123"}
# Save: doctorA_token
# Verify response has: "hospital": "{hospitalA_id}"

# 7. Login as Doctor B
POST /api/auth/login
{"email": "mike@metrohospital.com", "password": "Doctor@123"}
# Save: doctorB_token
# Verify response has: "hospital": "{hospitalB_id}"

# 8. Register Patient in Hospital A
POST /api/frontdesk/patients/register
Authorization: Bearer {doctorA_token}
{
  "name": "John Doe",
  "email": "john@example.com",
  "mobile": "+919876543250",
  "age": 45,
  "gender": "male"
}
# Save: patientA_id

# 9. ❌ Doctor B tries to see Patient A (Should FAIL)
GET /api/patients/search?query=John
Authorization: Bearer {doctorB_token}
# Expected: Empty array [] - Doctor B cannot see Hospital A's patients

# 10. ✅ Doctor A can see Patient  A (Should SUCCESS)
GET /api/patients/search?query=John
Authorization: Bearer {doctorA_token}
# Expected: Returns John Doe
```

---

### Quick Isolation Tests

| Test | Expected Result |
|------|----------------|
| Doctor A lists doctors | ✅ See only Hospital A doctors |
| Doctor B lists doctors | ✅ See only Hospital B doctors |
| Doctor A creates appointment | ✅ Auto-tagged with hospitalA_id |
| Doctor B tries to access Hospital A appointment | ❌ 404 Not Found |
| Doctor A lists prescriptions | ✅ See only Hospital A prescriptions |
| Pharmacy A views inventory | ✅ See only Hospital A products |
| Super Admin lists all users | ✅ See users from ALL hospitals |

---

### Testing Checklist

**Basic Isolation:**
- [ ] Users can only access their own hospital's data
- [ ] Cross-hospital queries return empty or 404
- [ ] Records auto-include hospital ID from user's token

**Super Admin:**
- [ ] Can view all hospitals
- [ ] Can create users in any hospital
- [ ] Can see cross-hospital data

**Error Handling:**
- [ ] Cross-hospital access returns 404
- [ ] Hospital ID automatically added (don't manually add it)
- [ ] All responses include hospital field

---

### Common Testing Mistakes

❌ **DON'T:** Manually add hospital ID in request body - it's auto-added from your token

❌ **DON'T:** Expect to see cross-hospital data with regular roles 

✅ **DO:** Use different user tokens for each hospital

✅ **DO:** Verify hospital field is present in all responses
