# Postman Testing Routes - Group 3
## Roles: Staff, Pharmacy, Lab

---

## 🔐 **CRITICAL: Multi-Tenancy & Hospital ID**

> **⚠️ IMPORTANT:** This system is **multi-tenant**. Every database record MUST include a `hospital` ID to ensure complete data isolation between hospitals.

### Key Points:
1. **Pharmacy Inventory:** Each hospital has its own separate inventory
2. **Lab Orders:** Lab tests and orders are hospital-specific
3. **Staff Records:** Attendance and payroll are isolated by hospital
4. **Automatic Hospital Assignment:** All records are automatically tagged with the user's hospital ID

### Example - Pharmacy Inventory:
```javascript
// Pharmacy user from Hospital A
GET /api/pharmacy/products

// Returns ONLY Hospital A's inventory
Response: {
  "data": [
    { "_id": "...", "name": "Paracetamol", "stock": 500, "hospital": "hospitalA_ID" }
  ]
}

// Pharmacy from Hospital B sees completely different inventory
// Even if both hospitals stock the same medicine, they are separate records
```

### Lab Multi-Tenancy:
- Lab tests catalog can be hospital-specific or shared
- Lab orders are ALWAYS hospital-specific
- Lab reports only accessible within the same hospital
- Cross-hospital lab data is completely isolated

### Staff Multi-Tenancy:
- Staff attendance records are per hospital
- Payroll calculations are hospital-specific
- Staff schedules are unique to each hospital

See **[MULTI_TENANCY_HOSPITAL_ID_GUIDE.md](./MULTI_TENANCY_HOSPITAL_ID_GUIDE.md)** for complete implementation details.

---

## 👔 STAFF ROUTES

**Note:** Staff members primarily use attendance and general routes. Most staff-specific functionality is covered in the Attendance routes (shared with Nurse role in Group 2).

### 1. Check In
**Route:** `POST /api/attendance/check-in`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "location": {
    "latitude": 28.5355,
    "longitude": 77.3910
  },
  "notes": "Regular check-in"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Checked in successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9f2",
    "checkInTime": "2024-03-15T08:00:00Z",
    "shift": "Morning Shift"
  }
}
```

---

### 2. Check Out
**Route:** `POST /api/attendance/check-out`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "location": {
    "latitude": 28.5355,
    "longitude": 77.3910
  },
  "notes": "End of shift"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Checked out successfully",
  "data": {
    "checkOutTime": "2024-03-15T16:00:00Z",
    "totalHours": 8,
    "overtime": 0
  }
}
```

---

### 3. Get Staff Attendance
**Route:** `GET /api/attendance/me?month=3&year=2024`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "employee": {
      "name": "Staff Member",
      "employeeId": "EMP123"
    },
    "month": "March 2024",
    "totalWorkingDays": 26,
    "present": 24,
    "absent": 2,
    "lateCheckIns": 1,
    "earlyCheckOuts": 0,
    "totalHours": 192,
    "records": [
      {
        "date": "2024-03-15",
        "checkIn": "08:00:00",
        "checkOut": "16:00:00",
        "hours": 8,
        "status": "present"
      }
    ]
  }
}
```

---

### 4. Get Staff Dashboard
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
    "currentShift": {
      "name": "Morning Shift",
      "startTime": "08:00",
      "endTime": "16:00"
    },
    "monthlyAttendance": {
      "present": 15,
      "absent": 1,
      "leaves": 2
    },
    "upcomingLeaves": []
  }
}
```

---

### 5. Get Today Attendance Status
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
    "currentHours": 6.5,
    "shift": "Morning Shift"
  }
}
```

---

### 6. Get Self Payroll
**Route:** `GET /api/attendance/self-payroll?year=2024`  
**Access:** Staff, Nurse, Helpdesk, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f3",
      "month": "March 2024",
      "basicSalary": 30000,
      "hra": 5000,
      "ta": 2000,
      "otherAllowances": 1000,
      "grossSalary": 38000,
      "pf": 3600,
      "tax": 2000,
      "otherDeductions": 400,
      "totalDeductions": 6000,
      "netSalary": 32000,
      "status": "paid",
      "paidDate": "2024-03-31T10:00:00Z"
    }
  ]
}
```

---

### 7. Get Staff Schedule
**Route:** `GET /api/attendance/schedule?week=current`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "weekStartDate": "2024-03-18",
    "weekEndDate": "2024-03-24",
    "schedule": [
      {
        "date": "2024-03-18",
        "day": "Monday",
        "shift": {
          "name": "Morning Shift",
          "startTime": "08:00",
          "endTime": "16:00"
        },
        "isWorkingDay": true
      },
      {
        "date": "2024-03-19",
        "day": "Tuesday",
        "shift": {
          "name": "Morning Shift",
          "startTime": "08:00",
          "endTime": "16:00"
        },
        "isWorkingDay": true
      }
    ]
  }
}
```

---

### 8. Get Staff Profile
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
    "mobile": "+919876543224",
    "employeeId": "EMP123",
    "role": "staff",
    "department": "Administration",
    "designation": "Administrative Staff",
    "dateOfJoining": "2023-01-01",
    "salary": 30000,
    "emergencyContact": {
      "name": "Contact Person",
      "phone": "+919876543227",
      "relation": "Spouse"
    }
  }
}
```

---

### 9. Update Staff Profile
**Route:** `PATCH /api/attendance/profile`  
**Access:** Staff, Doctor, Nurse, Helpdesk, Hospital Admin, Super Admin, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
mobile: +919876543228
address: {"street":"456 New Street","city":"Mumbai","state":"Maharashtra","pincode":"400001"}
emergencyContact: {"name":"Updated Contact","phone":"+919876543229","relation":"Spouse"}
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

### 10. Upload Staff Document
**Route:** `POST /api/attendance/upload-document`  
**Access:** Staff, Nurse, Emergency  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
document: [file upload]
documentType: "ID_PROOF"
documentName: "Aadhar Card"
```

**Response:**
```json
{
  "success": true,
  "message": "Document uploaded successfully",
  "data": {
    "documentUrl": "https://storage.example.com/staff/documents/aadhar.pdf",
    "documentType": "ID_PROOF"
  }
}
```

---

## 💊 PHARMACY ROUTES

### 1. Upload Pharmacy Document
**Route:** `POST /api/pharmacy/upload-document`  
**Access:** Pharma Owner  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
document: [file upload]
documentType: "DRUG_LICENSE"
```

**Response:**
```json
{
  "success": true,
  "message": "Document uploaded successfully",
  "url": "https://storage.example.com/pharmacy/license.pdf"
}
```

---

### 2. Get Hospital Pharmacy Orders
**Route:** `GET /api/pharmacy/orders/hospital/{hospitalId}?status=active&page=1&limit=20`  
**Access:** Pharma Owner, Hospital Admin, Staff, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f4",
      "orderNumber": "PH-001",
      "patient": {
        "name": "John Doe",
        "patientId": "P001"
      },
      "medications": [
        {
          "name": "Paracetamol",
          "quantity": 10,
          "price": 50
        }
      ],
      "totalAmount": 50,
      "status": "pending",
      "createdAt": "2024-03-15T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

---

### 3. Get Active Orders Count
**Route:** `GET /api/pharmacy/orders/hospital/{hospitalId}/count`  
**Access:** Pharma Owner, Hospital Admin, Staff, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "activeOrders": 15,
    "pendingOrders": 8,
    "completedToday": 20
  }
}
```

---

### 4. Get Pharmacy Order
**Route:** `GET /api/pharmacy/orders/{id}`  
**Access:** Pharma Owner, Hospital Admin, Staff, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9f4",
    "orderNumber": "PH-001",
    "patient": {
      "_id": "65f8a1b2c3d4e5f6a7b8c9d1",
      "name": "John Doe",
      "patientId": "P001"
    },
    "medications": [
      {
        "productId": "65f8a1b2c3d4e5f6a7b8c9f5",
        "name": "Paracetamol",
        "dosage": "500mg",
        "quantity": 10,
        "price": 5,
        "totalPrice": 50
      }
    ],
    "totalAmount": 50,
    "discount": 0,
    "netAmount": 50,
    "status": "pending",
    "createdAt": "2024-03-15T10:00:00Z"
  }
}
```

---

### 5. Delete Pharmacy Order
**Route:** `DELETE /api/pharmacy/orders/{id}`  
**Access:** Pharma Owner, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Order deleted successfully"
}
```

---

### 6. Get Products
**Route:** `GET /api/pharmacy/products?search=Para&category=Analgesics&page=1&limit=20`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f5",
      "name": "Paracetamol",
      "genericName": "Acetaminophen",
      "category": "Analgesics",
      "manufacturer": "ABC Pharma",
      "batchNumber": "BATCH001",
      "expiryDate": "2025-12-31",
      "stock": 500,
      "price": 5,
      "mrp": 7
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50
  }
}
```

---

### 7. Get Product by ID
**Route:** `GET /api/pharmacy/products/{id}`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9f5",
    "name": "Paracetamol",
    "genericName": "Acetaminophen",
    "category": "Analgesics",
    "manufacturer": "ABC Pharma",
    "batchNumber": "BATCH001",
    "manufacturingDate": "2024-01-01",
    "expiryDate": "2025-12-31",
    "stock": 500,
    "price": 5,
    "mrp": 7,
    "gst": 12,
    "supplier": "XYZ Suppliers"
  }
}
```

---

### 8. Create Product
**Route:** `POST /api/pharmacy/products`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Aspirin",
  "genericName": "Acetylsalicylic Acid",
  "category": "Analgesics",
  "manufacturer": "XYZ Pharma",
  "batchNumber": "BATCH002",
  "manufacturingDate": "2024-02-01",
  "expiryDate": "2026-01-31",
  "stock": 300,
  "price": 3,
  "mrp": 5,
  "gst": 12,
  "supplier": "65f8a1b2c3d4e5f6a7b8c9f6"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Product created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9f7"
  }
}
```

---

### 9. Update Product
**Route:** `PUT /api/pharmacy/products/{id}`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "stock": 450,
  "price": 5.5,
  "mrp": 7.5
}
```

**Response:**
```json
{
  "success": true,
  "message": "Product updated successfully"
}
```

---

### 10. Delete Product
**Route:** `DELETE /api/pharmacy/products/{id}`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

---

### 11. Bulk Import Products
**Route:** `POST /api/pharmacy/products/import`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
file: products.xlsx
```

**Response:**
```json
{
  "success": true,
  "message": "Bulk import completed",
  "data": {
    "imported": 45,
    "failed": 5,
    "errors": [
      {
        "row": 10,
        "error": "Invalid expiry date"
      }
    ]
  }
}
```

---

### 12. Bulk Create Products
**Route:** `POST /api/pharmacy/products/bulk`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "products": [
    {
      "name": "Product 1",
      "price": 10,
      "stock": 100
    },
    {
      "name": "Product 2",
      "price": 15,
      "stock": 150
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Products created successfully",
  "count": 2
}
```

---

### 13. Export Products
**Route:** `GET /api/pharmacy/products/export?format=excel`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:** Excel file download

---

### 14. Get Suppliers
**Route:** `GET /api/pharmacy/suppliers?page=1&limit=20`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f6",
      "name": "ABC Suppliers",
      "contact": "+919876543230",
      "email": "abc@suppliers.com",
      "address": "123 Supply Street",
      "gstNumber": "29ABCDE1234F1Z5"
    }
  ]
}
```

---

### 15. Create Supplier
**Route:** `POST /api/pharmacy/suppliers`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "XYZ Suppliers",
  "contact": "+919876543231",
  "email": "xyz@suppliers.com",
  "address": "456 Supply Avenue",
  "gstNumber": "29XYZAB5678G2H9"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Supplier created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9f8"
  }
}
```

---

### 16. Get Invoices
**Route:** `GET /api/pharmacy/invoices?startDate=2024-03-01&endDate=2024-03-31&page=1&limit=20`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9f9",
      "invoiceNumber": "INV-001",
      "patient": "John Doe",
      "totalAmount": 500,
      "date": "2024-03-15",
      "status": "paid"
    }
  ]
}
```

---

### 17. Create Invoice
**Route:** `POST /api/pharmacy/invoices`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "patient": "65f8a1b2c3d4e5f6a7b8c9d1",
  "items": [
    {
      "product": "65f8a1b2c3d4e5f6a7b8c9f5",
      "quantity": 10,
      "price": 5
    }
  ],
  "discount": 5,
  "paymentMethod": "cash"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Invoice created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9f9",
    "invoiceNumber": "INV-002"
  }
}
```

---

### 18. Get Dashboard Stats
**Route:** `GET /api/pharmacy/reports/dashboard`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalProducts": 500,
    "lowStockProducts": 25,
    "expiringSoon": 10,
    "todaySales": 5000,
    "monthSales": 150000,
    "pendingOrders": 15
  }
}
```

---

### 19. Get Sales Report
**Route:** `GET /api/pharmacy/reports/sales?startDate=2024-03-01&endDate=2024-03-31`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalSales": 150000,
    "totalInvoices": 300,
    "averageInvoiceValue": 500,
    "topSellingProducts": [
      {
        "product": "Paracetamol",
        "quantity": 500,
        "revenue": 2500
      }
    ]
  }
}
```

---

### 20. Get Inventory Report
**Route:** `GET /api/pharmacy/reports/inventory`  
**Access:** Pharma Owner, Hospital Admin, Super Admin, Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalValue": 500000,
    "lowStockItems": [
      {
        "name": "Aspirin",
        "currentStock": 10,
        "minStock": 50
      }
    ],
    "expiringItems": [
      {
        "name": "Antibiotics",
        "expiryDate": "2024-04-30",
        "stock": 20
      }
    ]
  }
}
```

---

## 🧪 LAB ROUTES

### 1. Create Lab Test
**Route:** `POST /api/lab/tests`  
**Access:** Super Admin, Hospital Admin, Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Complete Blood Count",
  "shortName": "CBC",
  "department": "Hematology",
  "price": 500,
  "duration": "2 hours",
  "parameters": [
    {
      "name": "Hemoglobin",
      "unit": "g/dL",
      "normalRange": {
        "min": 12,
        "max": 16
      }
    },
    {
      "name": "WBC Count",
      "unit": "cells/mcL",
      "normalRange": {
        "min": 4000,
        "max": 11000
      }
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lab test created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9fa"
  }
}
```

---

### 2. Get Lab Tests
**Route:** `GET /api/lab/tests?department=Hematology&search=CBC`  
**Access:** Public

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9fa",
      "name": "Complete Blood Count",
      "shortName": "CBC",
      "department": "Hematology",
      "price": 500,
      "duration": "2 hours"
    }
  ]
}
```

---

### 3. Get Lab Test by ID
**Route:** `GET /api/lab/tests/{id}`  
**Access:** Public

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9fa",
    "name": "Complete Blood Count",
    "shortName": "CBC",
    "department": "Hematology",
    "price": 500,
    "duration": "2 hours",
    "parameters": [
      {
        "name": "Hemoglobin",
        "unit": "g/dL",
        "normalRange": {
          "min": 12,
          "max": 16
        }
      }
    ]
  }
}
```

---

### 4. Update Lab Test
**Route:** `PUT /api/lab/tests/{id}`  
**Access:** Super Admin, Hospital Admin, Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "price": 550,
  "duration": "1.5 hours"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lab test updated successfully"
}
```

---

### 5. Delete Lab Test
**Route:** `DELETE /api/lab/tests/{id}`  
**Access:** Super Admin, Hospital Admin, Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Lab test deleted successfully"
}
```

---

### 6. Create Lab Order
**Route:** `POST /api/lab/orders`  
**Access:** Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "patient": "65f8a1b2c3d4e5f6a7b8c9d1",
  "prescription": "65f8a1b2c3d4e5f6a7b8c9e3",
  "tests": [
    {
      "test": "65f8a1b2c3d4e5f6a7b8c9fa",
      "urgency": "normal"
    }
  ],
  "remarks": "Fasting required"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lab order created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9fb",
    "orderNumber": "LAB-001",
    "sampleId": "SAMPLE-001"
  }
}
```

---

### 7. Get Lab Orders
**Route:** `GET /api/lab/orders?status=pending&page=1&limit=20`  
**Access:** Lab, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9fb",
      "orderNumber": "LAB-001",
      "sampleId": "SAMPLE-001",
      "patient": {
        "name": "John Doe",
        "patientId": "P001"
      },
      "tests": [
        {
          "name": "Complete Blood Count",
          "status": "pending"
        }
      ],
      "status": "pending",
      "createdAt": "2024-03-15T10:00:00Z"
    }
  ]
}
```

---

### 8. Collect Sample
**Route:** `PUT /api/lab/orders/{id}/collect`  
**Access:** Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "collectedBy": "Lab Technician 1",
  "collectionTime": "2024-03-15T11:00:00Z",
  "notes": "Sample collected successfully"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Sample collected successfully",
  "data": {
    "status": "sample-collected"
  }
}
```

---

### 9. Enter Results
**Route:** `PUT /api/lab/orders/{id}/results`  
**Access:** Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "results": [
    {
      "parameter": "Hemoglobin",
      "value": 14.5,
      "unit": "g/dL",
      "normalRange": {
        "min": 12,
        "max": 16
      },
      "status": "normal"
    },
    {
      "parameter": "WBC Count",
      "value": 7500,
      "unit": "cells/mcL",
      "normalRange": {
        "min": 4000,
        "max": 11000
      },
      "status": "normal"
    }
  ],
  "remarks": "All parameters within normal range"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Results entered successfully",
  "data": {
    "status": "results-entered"
  }
}
```

---

### 10. Notify Doctor about Results
**Route:** `POST /api/lab/orders/{id}/notify-doctor`  
**Access:** Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "message": "Lab results are ready for review"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Doctor notified successfully"
}
```

---

### 11. Finalize Order
**Route:** `PUT /api/lab/orders/{id}/finalize`  
**Access:** Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "verifiedBy": "Dr. Lab Head",
  "remarks": "Results verified and approved"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order finalized successfully",
  "data": {
    "status": "finalized",
    "invoiceGenerated": true
  }
}
```

---

### 12. Pay Lab Order
**Route:** `POST /api/lab/orders/{id}/pay`  
**Access:** Lab, Patient, Hospital Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "paymentMethod": "cash",
  "amount": 500,
  "transactionId": "TXN123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment recorded successfully",
  "data": {
    "status": "paid",
    "receiptNumber": "REC-001"
  }
}
```

---

### 13. Generate Invoice
**Route:** `GET /api/lab/orders/{id}/invoice`  
**Access:** Lab, Patient, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "invoiceNumber": "INV-LAB-001",
    "patient": "John Doe",
    "tests": [
      {
        "name": "Complete Blood Count",
        "price": 500
      }
    ],
    "subtotal": 500,
    "tax": 60,
    "total": 560,
    "paymentStatus": "paid",
    "date": "2024-03-15"
  }
}
```

---

### 14. Delete Lab Order
**Route:** `DELETE /api/lab/orders/{id}`  
**Access:** Lab, Hospital Admin, Super Admin, Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Lab order deleted successfully"
}
```

---

### 15. Get All Invoices
**Route:** `GET /api/lab/invoices?startDate=2024-03-01&endDate=2024-03-31`  
**Access:** Lab, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9fc",
      "invoiceNumber": "INV-LAB-001",
      "patient": "John Doe",
      "totalAmount": 560,
      "status": "paid",
      "date": "2024-03-15"
    }
  ]
}
```

---

### 16. Delete Invoice
**Route:** `DELETE /api/lab/invoices/{id}`  
**Access:** Lab, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "message": "Invoice deleted successfully"
}
```

---

### 17. Generate Lab Report
**Route:** `GET /api/lab/reports/{sampleId}?format=pdf`  
**Access:** Lab, Patient, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:** PDF file download or JSON data
```json
{
  "success": true,
  "data": {
    "sampleId": "SAMPLE-001",
    "patient": "John Doe",
    "tests": [
      {
        "name": "Complete Blood Count",
        "results": [
          {
            "parameter": "Hemoglobin",
            "value": 14.5,
            "unit": "g/dL",
            "status": "normal"
          }
        ]
      }
    ],
    "reportDate": "2024-03-15",
    "verifiedBy": "Dr. Lab Head"
  }
}
```

---

### 18. Get Dashboard Stats
**Route:** `GET /api/lab/dashboard-stats`  
**Access:** Lab, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "todayOrders": 25,
    "pendingSamples": 5,
    "resultsReady": 15,
    "completedToday": 10,
    "revenue": {
      "today": 12500,
      "thisMonth": 375000
    }
  }
}
```

---

### 19. Get Departments
**Route:** `GET /api/lab/departments`  
**Access:** Public

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9fd",
      "name": "Hematology",
      "description": "Blood tests",
      "testsCount": 25
    },
    {
      "_id": "65f8a1b2c3d4e5f6a7b8c9fe",
      "name": "Biochemistry",
      "description": "Chemical analysis",
      "testsCount": 40
    }
  ]
}
```

---

### 20. Create Department
**Route:** `POST /api/lab/departments`  
**Access:** Super Admin, Hospital Admin, Lab  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "name": "Microbiology",
  "description": "Bacterial and viral tests",
  "headOfDepartment": "Dr. Microbiologist"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Department created successfully",
  "data": {
    "_id": "65f8a1b2c3d4e5f6a7b8c9ff"
  }
}
```

---

### 21. Upload Lab Logo
**Route:** `POST /api/lab/settings/logo`  
**Access:** Lab, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`, `Content-Type: multipart/form-data`

**Request Body:** (Form Data)
```
logo: [image file]
```

**Response:**
```json
{
  "success": true,
  "message": "Logo uploaded successfully",
  "url": "https://storage.example.com/lab/logo.png"
}
```

---

### 22. Get Lab Settings
**Route:** `GET /api/lab/settings`  
**Access:** Lab, Hospital Admin, Super Admin, Doctor  
**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true,
  "data": {
    "labName": "Central Lab",
    "logo": "https://storage.example.com/lab/logo.png",
    "address": "123 Lab Street",
    "phone": "+919876543232",
    "email": "lab@hospital.com",
    "reportHeader": "Custom header text",
    "reportFooter": "Custom footer text"
  }
}
```

---

### 23. Update Lab Settings
**Route:** `PUT /api/lab/settings`  
**Access:** Lab, Hospital Admin, Super Admin  
**Headers:** `Authorization: Bearer {accessToken}`

**Request Body:**
```json
{
  "labName": "Updated Lab Name",
  "phone": "+919876543233",
  "reportHeader": "New header text"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Settings updated successfully"
}
```

---

## 📝 Testing Tips

1. **Pharmacy Context:** Ensure pharmacy profile exists for the hospital before testing pharmacy routes
2. **Lab Orders:** Follow the workflow: Create → Collect → Enter Results → Finalize → Pay
3. **File Uploads:** Use proper file formats (XLSX for imports, PDF for documents, images for logos)
4. **Product Management:** Test stock updates and expiry date validations
5. **Lab Reports:** Generate reports only for finalized orders
6. **Permissions:** Some routes require specific roles - verify authorization carefully
7. **Date Ranges:** Use proper date formats for reports and filtering
## 🧪 Hospital ID Testing
Pharmacy/Lab/Staff inventory is hospital-specific. Test by logging into each hospital and verifying data isolation.
