# 📚 Postman API Testing Documentation - MSCurechain Backend

## Overview
This directory contains comprehensive Postman testing documentation for the MSCurechain multi-tenant healthcare management system backend API. The documentation is organized by user roles with 3 roles per file for easy navigation and testing.

---

## 📂 Documentation Structure

### Group 1: Super Admin, Patient, Emergency
**File:** `POSTMAN_TESTING_GROUP_1_SuperAdmin_Patient_Emergency.md`

**Roles Covered:**
- 👑 **Super Admin** - System-wide administration and hospital management
- 👤 **Patient** - Patient profile, appointments, prescriptions, lab records
- 🚑 **Emergency** - Ambulance personnel and emergency request management

**Key Features:**
- Complete authentication flow (register, login, refresh, logout)
- Hospital creation and management
- User management across all roles
- Patient health records and dashboard
- Emergency request workflows
- Ambulance personnel management

---

### Group 2: Doctor, Hospital Admin, Nurse
**File:** `POSTMAN_TESTING_GROUP_2_Doctor_HospitalAdmin_Nurse.md`

**Roles Covered:**
- 👨‍⚕️ **Doctor** - Doctor profile, patient management, appointments, analytics
- 🏥 **Hospital Admin** - Hospital operations, staff management, financial reports
- 👩‍⚕️ **Nurse** - Patient care, vitals tracking, task management

**Key Features:**
- Doctor dashboard and patient consultations
- Hospital-wide analytics and reporting
- Staff management (doctors, nurses, helpdesk, staff)
- Attendance tracking and payroll management
- Shift scheduling
- Quality metrics (NABH compliance)
- Nurse patient assignment and clinical tasks

---

### Group 3: Staff, Pharmacy, Lab
**File:** `POSTMAN_TESTING_GROUP_3_Staff_Pharmacy_Lab.md`

**Roles Covered:**
- 👔 **Staff** - General staff attendance and profile management
- 💊 **Pharmacy** - Inventory, billing, supplier management
- 🧪 **Lab** - Test catalog, order management, report generation

**Key Features:**
- Staff attendance (check-in/check-out) and payroll
- Pharmacy inventory management with expiry tracking
- Pharmacy order processing and billing
- Supplier management
- Lab test catalog and parameters
- Lab order workflow (collection → results → finalize → billing)
- Lab report generation with customizable settings

---

### Group 4: Frontdesk & Common Routes
**File:** `POSTMAN_TESTING_GROUP_4_Frontdesk_Common_Routes.md`

**Roles Covered:**
- 🏥 **Frontdesk** - Patient registration, visit management

**Common Routes:**
- 📅 **Appointments** - Booking, availability, status management
- 📋 **Prescriptions** - Create, view, manage prescriptions
- 🏨 **IPD** - In-patient admission, bed management, discharge workflows

**Key Features:**
- Patient registration and visit tracking
- Appointment booking with doctor availability
- Prescription management with medication details
- IPD admission workflow
- Bed transfer and discharge management
- Nurse clinical documentation (vitals, medications, diet)
- Patient clinical history tracking

---

## 🔑 Authentication

All protected routes require a Bearer token in the Authorization header:

```
Authorization: Bearer {accessToken}
```

### Getting Started
1. **Register/Login** using the auth routes in Group 1
2. **Copy the accessToken** from the response
3. **Add to Postman** as an Authorization header for subsequent requests

### Token Refresh
When the access token expires, use the refresh token endpoint:
- Endpoint: `POST /api/auth/refresh`
- Body: `{ "refreshToken": "your-refresh-token" }`

---

## 🌐 Base URL

**Development:** `http://localhost:5000` (or your configured port)  
**Production:** `https://your-domain.com`

Add the appropriate base URL to all API endpoints listed in the documentation.

---

## 📋 Testing Workflow

### 1. Authentication Setup
```
1. POST /api/auth/register → Create user
2. POST /api/auth/login → Get access token
3. Use token for all subsequent requests
```

### 2. Hospital Context Setup (for hospital-specific roles)
```
1. Super Admin creates hospital
2. Super Admin creates hospital admin
3. Hospital admin creates doctors, nurses, staff
```

### 3. Role-Based Testing
Test each role with appropriate permissions:
- Use different user accounts for different roles
- Verify authorization errors (403) when accessing unauthorized resources
- Test role-specific features and workflows

### 4. Complete Workflows
Follow realistic scenarios:

**Patient Journey:**
```
Register → Login → Book Appointment → Consultation → 
Prescription → Lab Tests → Pharmacy → Payment
```

**Emergency Flow:**
```
Emergency Personnel Login → Create Emergency Request → 
Hospital Accepts → Patient Admitted → Treatment → Discharge
```

**IPD Workflow:**
```
Admit Patient → Assign Bed → Log Vitals → 
Administer Medication → Lab Tests → Discharge
```

---

## 🗂️ API Endpoint Summary

### Total Endpoints by Category

| Category | Endpoints | Roles |
|----------|-----------|-------|
| **Authentication** | 7 | All |
| **Super Admin** | 19 | Super Admin |
| **Patient** | 10 | Patient, Doctor, Nurse |
| **Emergency** | 12 | Emergency, Helpdesk |
| **Doctor** | 15 | Doctor, Hospital Admin |
| **Hospital Admin** | 25 | Hospital Admin, Super Admin |
| **Nurse** | 13 | Nurse, Staff |
| **Staff** | 10 | Staff, All roles |
| **Pharmacy** | 20 | Pharma Owner, Hospital Admin |
| **Lab** | 23 | Lab, Hospital Admin |
| **Frontdesk** | 9 | Helpdesk, Hospital Admin |
| **Appointments** | 6 | Patient, Doctor, Helpdesk |
| **Prescriptions** | 5 | Doctor, Patient |
| **IPD** | 16 | Nurse, Doctor, Hospital Admin |

**Total: ~190 API endpoints**

---

## 🎯 Testing Tips

### General Guidelines
1. **Start Simple:** Begin with authentication, then move to role-specific features
2. **Follow Dependencies:** Create required data before testing dependent endpoints
3. **Test Permissions:** Verify each role can only access authorized endpoints
4. **Use Valid IDs:** Ensure all referenced IDs (patient, doctor, hospital) exist
5. **Check Pagination:** Test with various page and limit values
6. **Validate Errors:** Test error scenarios (invalid data, missing fields, etc.)

### Data Validation
- Test required fields by omitting them
- Test data type validation (string vs number)
- Test date format validation (ISO 8601)
- Test email and mobile number formats
- Test password strength requirements

### File Uploads
For endpoints with file uploads:
- Use `Content-Type: multipart/form-data`
- Test with various file formats (PDF, images, XLSX)
- Test file size limits
- Verify upload success and URL generation

### Performance Testing
- Test pagination with large datasets
- Verify response times for search queries
- Test concurrent requests (appointments, check-ins)
- Check caching behavior on frequently accessed endpoints

### Error Scenarios
- **401 Unauthorized:** Invalid or expired token
- **403 Forbidden:** Insufficient permissions
- **404 Not Found:** Invalid resource ID
- **400 Bad Request:** Validation errors
- **409 Conflict:** Duplicate entries, business rule violations
- **500 Server Error:** Unexpected errors

---

## 📊 HTTP Methods & Usage

| Method | Purpose | Example |
|--------|---------|---------|
| **GET** | Retrieve data | Get patient profile, list appointments |
| **POST** | Create new resource | Register patient, book appointment |
| **PUT** | Update entire resource | Update doctor profile |
| **PATCH** | Partial update | Update appointment status |
| **DELETE** | Remove resource | Delete prescription |

---

## 🔒 Role-Based Access Control

### Permission Matrix

| Endpoint Type | Super Admin | Hospital Admin | Doctor | Nurse | Patient | Helpdesk | Staff | Pharmacy | Lab | Emergency |
|--------------|-------------|----------------|--------|-------|---------|----------|-------|----------|-----|-----------|
| User Management | ✅ | ✅ (Hospital) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Hospital Settings | ✅ | ✅ | 👁️ | 👁️ | ❌ | 👁️ | ❌ | ❌ | ❌ | ❌ |
| Appointments | ✅ | ✅ | ✅ | 👁️ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Prescriptions | ✅ | 👁️ | ✅ | 👁️ | 👁️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lab Orders | ✅ | ✅ | 👁️ | ❌ | 👁️ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Pharmacy Orders | ✅ | ✅ | ❌ | ❌ | 👁️ | ❌ | ❌ | ✅ | ❌ | ❌ |
| IPD Management | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Emergency | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Attendance | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Reports/Analytics | ✅ | ✅ | 👁️ | ❌ | ❌ | 👁️ | ❌ | 👁️ | 👁️ | ❌ |

Legend: ✅ Full Access | 👁️ Read Only | ❌ No Access

---

## 💡 Common Use Cases

### Use Case 1: New Patient Registration & Consultation
```
1. Frontdesk: POST /api/frontdesk/patients/register
2. Patient: POST /api/auth/login
3. Patient: GET /api/doctors?specialization=Cardiology
4. Patient: POST /api/appointments/book
5. Doctor: GET /api/doctors/dashboard
6. Doctor: POST /api/doctors/start-next
7. Doctor: POST /api/prescriptions
8. Lab: POST /api/lab/orders
```

### Use Case 2: Emergency Admission
```
1. Emergency: POST /api/emergency/auth/login
2. Emergency: POST /api/emergency/requests
3. Helpdesk: GET /api/emergency/requests/hospital
4. Helpdesk: PUT /api/emergency/requests/{id}/accept
5. Doctor: POST /api/ipd (initiate admission)
6. Nurse: POST /api/ipd/log-vitals
```

### Use Case 3: Pharmacy Order Fulfillment
```
1. Doctor: POST /api/prescriptions
2. Pharmacy: GET /api/pharmacy/orders/hospital/{hospitalId}
3. Pharmacy: GET /api/pharmacy/products?search=medicine
4. Pharmacy: POST /api/pharmacy/invoices
5. Patient: POST /api/lab/orders/{id}/pay
```

---

## 🔍 Quick Reference

### Frequently Used Endpoints

**Authentication:**
- Login: `POST /api/auth/login`
- Refresh: `POST /api/auth/refresh`
- Profile: `GET /api/auth/me`

**Appointments:**
- Book: `POST /api/appointments/book`
- Check Availability: `GET /api/appointments/availability`
- My Appointments: `GET /api/appointments/my-appointments`

**Patient Data:**
- Profile: `GET /api/patients/profile`
- Appointments: `GET /api/patients/appointments`
- Prescriptions: `GET /api/patients/prescriptions`

**Hospital Admin:**
- Dashboard: `GET /api/hospital-admin/dashboard`
- Create Doctor: `POST /api/hospital-admin/doctors`
- Attendance Report: `GET /api/hospital-admin/attendance`

---

## 📞 Support & Troubleshooting

### Common Issues

**Issue: 401 Unauthorized**
- Solution: Check if token is valid and not expired
- Action: Use refresh token endpoint or login again

**Issue: 403 Forbidden**
- Solution: Verify user has correct role permissions
- Action: Check role assignment in user profile

**Issue: 404 Not Found**
- Solution: Verify resource ID exists in database
- Action: Use GET endpoints to find valid IDs

**Issue: Hospital ID Missing**
- Solution: Ensure user is assigned to a hospital
- Action: Super admin assigns hospital to user

---

## 📝 Version Information

- **API Version:** v1
- **Documentation Version:** 1.0
- **Last Updated:** March 2024
- **Total Roles Documented:** 10
- **Total Endpoints Documented:** ~190

---

## ✅ Testing Checklist

### Initial Setup
- [ ] Set up base URL in Postman
- [ ] Create environment variables (baseUrl, accessToken, refreshToken)
- [ ] Import all 4 documentation files
- [ ] Create test users for each role

### Authentication Testing
- [ ] Register new users
- [ ] Login with different roles
- [ ] Test token refresh
- [ ] Test logout functionality

### Role-Based Testing
- [ ] Test Super Admin endpoints
- [ ] Test Hospital Admin endpoints
- [ ] Test Doctor endpoints
- [ ] Test Nurse endpoints
- [ ] Test Patient endpoints
- [ ] Test Frontdesk endpoints
- [ ] Test Staff endpoints
- [ ] Test Pharmacy endpoints
- [ ] Test Lab endpoints
- [ ] Test Emergency endpoints

### Workflow Testing
- [ ] Complete patient registration → consultation flow
- [ ] Complete emergency admission workflow
- [ ] Complete IPD admission → discharge flow
- [ ] Complete prescription → pharmacy → payment flow
- [ ] Complete lab order → test → report flow

### Error Testing
- [ ] Test invalid credentials
- [ ] Test unauthorized access
- [ ] Test missing required fields
- [ ] Test invalid data formats
- [ ] Test duplicate entries

---

## 🎓 Training & Onboarding

For new team members:
1. Start with **Group 1** - Learn authentication and basic flows
2. Move to **Group 4** - Understand common workflows (appointments, prescriptions)
3. Explore **Group 2** - Learn hospital administration and clinical features
4. Complete **Group 3** - Master pharmacy and lab integrations

---

## 📖 Additional Resources

- Backend API Source Code: `./`
- Environment Configuration: `.env.example`
- Database Models: `./*/Models/`
- Controllers: `./*/Controllers/`
- Routes: `./*/Routes/`

---

**Happy Testing! 🚀**

For questions or issues, please contact the development team.
