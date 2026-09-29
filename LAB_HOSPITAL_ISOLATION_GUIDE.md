# 🏥 Lab Module - Hospital Isolation Guide

## Overview
Lab Tests and Departments now have **complete multi-tenancy support** with automatic hospital isolation. When you create lab tests or departments, they are **automatically scoped to your hospital**.

---

## 🔑 Key Requirements

### Hospital ID Requirement
- **✅ Required**: `hospital` ID must be included when creating lab tests and departments
- **Automatic Extraction**: Hospital ID is extracted from the authenticated user's hospital by default
- **Manual Override**: Can pass `hospitalId` in request body if needed (for Super Admin testing)

---

## 📝 Postman Examples

### 1️⃣ Create Lab Test for a Specific Hospital

**Endpoint:** `POST /api/lab/tests`

**Headers:**
```json
{
  "Authorization": "Bearer YOUR_TOKEN",
  "Content-Type": "application/json"
}
```

**Request Body (Option A - Automatic from Auth Token):**
```json
{
  "testName": "Complete Blood Count",
  "testCode": "CBC",
  "sampleType": "Blood",
  "price": 250,
  "departmentId": "67ab1234567890abcd123456",
  "turnaroundTime": "24 hours",
  "fastingRequired": false,
  "normalRanges": {
    "male": {
      "min": 4.5,
      "max": 5.9,
      "text": "4.5 - 5.9 M/µL"
    },
    "female": {
      "min": 4.1,
      "max": 5.1,
      "text": "4.1 - 5.1 M/µL"
    }
  }
}
```

**Request Body (Option B - Manual Hospital ID for Super Admin Testing):**
```json
{
  "hospitalId": "67ab9999999999abcd999999",
  "testName": "Complete Blood Count",
  "testCode": "CBC",
  "sampleType": "Blood",
  "price": 250,
  "departmentId": "67ab1234567890abcd123456",
  "turnaroundTime": "24 hours",
  "fastingRequired": false
}
```

**Response (Success):**
```json
{
  "message": "Test created successfully",
  "test": {
    "_id": "67ab5678901234abcd567890",
    "hospital": "67ab1111111111abcd111111",
    "testName": "Complete Blood Count",
    "testCode": "CBC",
    "sampleType": "Blood",
    "price": 250,
    "departmentIds": ["67ab1234567890abcd123456"],
    "departmentId": "67ab1234567890abcd123456",
    "isActive": true,
    "createdAt": "2026-02-18T10:30:00Z"
  }
}
```

**Response (Error - Missing Hospital):**
```json
{
  "message": "Hospital ID is required for lab test creation"
}
```

---

### 2️⃣ Create Department for a Specific Hospital

**Endpoint:** `POST /api/lab/departments`

**Headers:**
```json
{
  "Authorization": "Bearer YOUR_TOKEN",
  "Content-Type": "application/json"
}
```

**Request Body (Automatic from Auth Token):**
```json
{
  "name": "Pathology",
  "description": "Clinical Pathology Department"
}
```

**Request Body (Manual for Testing):**
```json
{
  "hospitalId": "67ab9999999999abcd999999",
  "name": "Pathology",
  "description": "Clinical Pathology Department"
}
```

**Response (Success):**
```json
{
  "message": "Department created",
  "department": {
    "_id": "67ab1234567890abcd123456",
    "hospital": "67ab1111111111abcd111111",
    "name": "Pathology",
    "description": "Clinical Pathology Department",
    "isActive": true,
    "createdAt": "2026-02-18T10:30:00Z"
  }
}
```

**Response (Error - Duplicate):**
```json
{
  "message": "Department already exists in this hospital"
}
```

---

### 3️⃣ Get Lab Tests (Hospital-Scoped)

**Endpoint:** `GET /api/lab/tests`

**Headers:**
```json
{
  "Authorization": "Bearer YOUR_TOKEN"
}
```

**Response:**
```json
[
  {
    "_id": "67ab5678901234abcd567890",
    "hospital": "67ab1111111111abcd111111",
    "testName": "Complete Blood Count",
    "name": "Complete Blood Count",
    "testCode": "CBC",
    "sampleType": "Blood",
    "price": 250,
    "departments": [
      {
        "_id": "67ab1234567890abcd123456",
        "name": "Pathology"
      }
    ],
    "departmentId": {
      "_id": "67ab1234567890abcd123456",
      "name": "Pathology"
    },
    "isActive": true
  }
]
```

---

### 4️⃣ Get Departments (Hospital-Scoped)

**Endpoint:** `GET /api/lab/departments`

**Headers:**
```json
{
  "Authorization": "Bearer YOUR_TOKEN"
}
```

**Response:**
```json
[
  {
    "_id": "67ab1234567890abcd123456",
    "hospital": "67ab1111111111abcd111111",
    "name": "Pathology",
    "description": "Clinical Pathology Department",
    "isActive": true,
    "tests": [
      {
        "_id": "67ab5678901234abcd567890",
        "testName": "Complete Blood Count",
        "price": 250
      },
      {
        "_id": "67ab5678901234abcd567891",
        "testName": "Thyroid Profile",
        "price": 350
      }
    ],
    "testCount": 2
  },
  {
    "_id": "67ab1234567890abcd123457",
    "hospital": "67ab1111111111abcd111111",
    "name": "Microbiology",
    "description": "Microbiology Department",
    "isActive": true,
    "tests": [],
    "testCount": 0
  }
]
```

---

### 5️⃣ Update Lab Test (Hospital-Scoped)

**Endpoint:** `PUT /api/lab/tests/:testId`

**Headers:**
```json
{
  "Authorization": "Bearer YOUR_TOKEN",
  "Content-Type": "application/json"
}
```

**Request Body:**
```json
{
  "price": 300,
  "turnaroundTime": "48 hours",
  "fastingRequired": true
}
```

**Response (Success):**
```json
{
  "message": "Test updated successfully",
  "test": {
    "_id": "67ab5678901234abcd567890",
    "hospital": "67ab1111111111abcd111111",
    "testName": "Complete Blood Count",
    "price": 300,
    "turnaroundTime": "48 hours",
    "fastingRequired": true,
    "isActive": true
  }
}
```

**Response (Error - Not Found or Not Authorized):**
```json
{
  "message": "Test not found or not authorized"
}
```

---

### 6️⃣ Delete Lab Test (Hospital-Scoped - Soft Delete)

**Endpoint:** `DELETE /api/lab/tests/:testId`

**Headers:**
```json
{
  "Authorization": "Bearer YOUR_TOKEN"
}
```

**Response (Success):**
```json
{
  "message": "Test deleted successfully"
}
```

---

### 7️⃣ Update Department (Hospital-Scoped)

**Endpoint:** `PUT /api/lab/departments/:departmentId`

**Headers:**
```json
{
  "Authorization": "Bearer YOUR_TOKEN",
  "Content-Type": "application/json"
}
```

**Request Body:**
```json
{
  "description": "Updated Clinical Pathology Department"
}
```

---

### 8️⃣ Delete Department (Hospital-Scoped - Soft Delete)

**Endpoint:** `DELETE /api/lab/departments/:departmentId`

---

## 🔐 Data Isolation Mechanism

### How It Works:
1. **User Authentication**: When you authenticate, your hospital ID is extracted from the JWT token
2. **Automatic Filtering**: All queries are automatically filtered by your hospital
3. **Write Protection**: Creating/updating tests or departments saves your hospital ID
4. **Read Protection**: You can only see tests/departments from your hospital

### Example Scenario:

```
Hospital A (ID: 1111) Lab Staff:
├─ Can create tests → Stored with hospital: 1111
├─ Can see only tests with hospital: 1111
├─ Cannot see Hospital B's tests
└─ Cannot modify Hospital B's tests

Hospital B (ID: 2222) Lab Staff:
├─ Can create tests → Stored with hospital: 2222
├─ Can see only tests with hospital: 2222
├─ Cannot see Hospital A's tests
└─ Cannot modify Hospital A's tests

Super Admin:
├─ Can create tests for any hospital (by passing hospitalId)
├─ Can see tests from all hospitals
└─ Can manage tests across hospitals
```

---

## 🛡️ Authorization & Roles

### Who Can Create Lab Tests?
- ✅ `super-admin` - Can create for any hospital
- ✅ `hospital-admin` - Can create for their hospital only
- ✅ `lab` - Can create for their hospital only

### Who Can Create Departments?
- ✅ `super-admin` - Can create for any hospital
- ✅ `hospital-admin` - Can create for their hospital only
- ✅ `lab` - Can create for their hospital only

---

## 🚀 Postman Setup Steps

### Step 1: Get Authentication Token
1. Run: `POST /api/auth/login` with lab staff credentials
2. Copy the `token` from response

### Step 2: Set Postman Environment Variable
1. In Postman, go to **Environment** settings
2. Add variable: `authToken` = `<your_token_from_step_1>`
3. In request headers, use: `Authorization: Bearer {{authToken}}`

### Step 3: Create Department First
1. `POST /api/lab/departments` with name and description
2. Copy the returned `_id`

### Step 4: Create Lab Test
1. `POST /api/lab/tests` with test details
2. Use the department `_id` in `departmentId` field

### Step 5: Verify Hospital Isolation
1. Login as Lab Staff from Hospital A
2. Create a test → Check it has Hospital A's ID
3. Logout and login as Lab Staff from Hospital B
4. Create another test → Check it has Hospital B's ID
5. Query `/api/lab/tests` from Hospital A → Should see ONLY Hospital A's tests
6. Query `/api/lab/tests` from Hospital B → Should see ONLY Hospital B's tests

---

## ✅ Verification Checklist

- [ ] Lab test created with correct `hospital` ID
- [ ] Department created with correct `hospital` ID
- [ ] Hospital A staff cannot see Hospital B's tests
- [ ] Hospital B staff cannot see Hospital A's tests
- [ ] Update operations verify hospital ownership
- [ ] Delete operations verify hospital ownership
- [ ] Cache is hospital-specific (`lab:tests:{hospitalId}`)
- [ ] Duplicate department check filters by hospital
- [ ] Super admin can manage all hospitals

---

## 📊 Database Verification

To verify data isolation in MongoDB:

```javascript
// Check tests for Hospital A
db.labtests.find({ hospital: ObjectId("67ab1111111111abcd111111") })

// Check tests for Hospital B
db.labtests.find({ hospital: ObjectId("67ab2222222222abcd222222") })

// Check departments for Hospital A
db.departments.find({ hospital: ObjectId("67ab1111111111abcd111111") })

// Check departments for Hospital B
db.departments.find({ hospital: ObjectId("67ab2222222222abcd222222") })
```

---

## 🐛 Troubleshooting

### Issue: "Hospital ID is required for lab test creation"
**Solution:** Ensure your JWT token is valid and contains hospital ID, or pass `hospitalId` in request body

### Issue: "Test not found or not authorized"
**Solution:** The test either doesn't exist or belongs to a different hospital. Verify the test ID and your hospital authorization

### Issue: "Department already exists in this hospital"
**Solution:** This department name is already used in your hospital. Use a unique name

### Issue: Tests from other hospitals are showing up
**Solution:** Clear Redis cache by restarting the server or manually invalidating cache keys

---

## 📚 Model Structure

### LabTest Model:
```typescript
{
  hospital: ObjectId (required) ← **HOSPITAL ISOLATION**
  testName: String
  testCode: String
  sampleType: String
  price: Number
  departmentIds: [ObjectId]
  departmentId: ObjectId
  isActive: Boolean
  ...
}
```

### Department Model:
```typescript
{
  hospital: ObjectId (required) ← **HOSPITAL ISOLATION**
  name: String
  description: String
  isActive: Boolean
  ...
}
```

---

## 🎯 Summary

✅ **Hospital Isolation Implementation:**
- Lab tests are scoped to hospitals
- Departments are scoped to hospitals
- Automatic hospital extraction from JWT token
- Manual hospital ID support for Super Admin testing
- Hospital-specific caching
- Hospital-validated CRUD operations
- Different hospitals cannot see each other's data

This ensures **complete data isolation** between hospitals! 🔐
