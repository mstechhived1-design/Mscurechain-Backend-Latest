# <span style="color: #FF6B6B; font-size: 42px; font-weight: 900;">🚀 Project Overview</span>

<p style="font-size: 18px; color: #4A5568; line-height: 1.8;">
This backend system manages:
</p>

<p style="font-size: 16px; color: #2D3748; line-height: 1.8;">
<strong>Authentication</strong> → Patient OTP registration, admin login, doctor login using doctorId<br>
<strong>RBAC (Role-Based Access Control)</strong><br>
<strong>Doctors API</strong> → Profile, availability, search<br>
<strong>Patients API</strong> → Profile CRUD<br>
<strong>Hospitals API</strong> → Create, update, branches<br>
<strong>Admin APIs</strong> → Create doctor, create admin, list users, hospital approval
</p>

<p style="font-size: 16px; color: #E53E3E; font-weight: 600;">
Frontend is NOT included — this documentation is only for backend API testing (Postman).
</p>

---

## <span style="color: #4299E1; font-size: 36px; font-weight: 800;">📁 Folder Structure</span>

```
backend/
│
├── config/
│   └── db.js
│
├── controllers/
│   ├── adminController.js
│   ├── authController.js
│   ├── doctorController.js
│   ├── hospitalController.js
│   └── patientController.js
│
├── middleware/
│   ├── authMiddleware.js
│   └── roleMiddleware.js
│
├── models/
│   ├── DoctorProfile.js
│   ├── Hospital.js
│   ├── OTP.js
│   ├── PatientProfile.js
│   └── User.js
│
├── routes/
│   ├── adminRoutes.js
│   ├── authRoutes.js
│   ├── doctorRoutes.js
│   ├── hospitalRoutes.js
│   └── patientRoutes.js
│
├── templates/
│   └── reset.html
│
├── utils/
│   ├── sendEmail.js
│   └── validators.js
│
├── seedAdmin.js
├── server.js
├── package.json
└── package-lock.json
```

---

## <span style="color: #48BB78; font-size: 36px; font-weight: 800;">🔧 Environment Setup (.env file)</span>

<p style="font-size: 18px; color: #2D3748; font-weight: 600;">
Create .env in backend root:
</p>

```
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
EMAIL_USER_FINAL=your_gmail@gmail.com
EMAIL_PASS_FINAL=your_app_password
FRONTEND_URL=http://localhost:3000
```

---

## <span style="color: #9F7AEA; font-size: 36px; font-weight: 800;">▶️ How to Run Backend (Step by Step)</span>

### <span style="color: #805AD5; font-size: 24px; font-weight: 700;">1️⃣ Install dependencies</span>

```bash
npm install
```

### <span style="color: #805AD5; font-size: 24px; font-weight: 700;">2️⃣ Start MongoDB (if local) or use Atlas URL</span>

<p style="font-size: 16px; color: #4A5568;">
No extra setup needed if using MongoDB Atlas.
</p>

### <span style="color: #805AD5; font-size: 24px; font-weight: 700;">3️⃣ Seed Admin Account (Optional)</span>

```bash
node seedAdmin.js
```

<p style="font-size: 16px; color: #4A5568;">
Creates default admin.
</p>

### <span style="color: #805AD5; font-size: 24px; font-weight: 700;">4️⃣ Start the server</span>

```bash
npm start
```

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">
You will see:
</p>

```
MongoDB Connected
➡ Local : http://localhost:3000
➡ Network: http://your-ip:3000
```

---

## <span style="color: #F6AD55; font-size: 36px; font-weight: 800;">🌐 Base URL</span>

```
http://localhost:3000/api
```

---

## <span style="color: #FC8181; font-size: 36px; font-weight: 800;">🔐 RBAC System Overview</span>

### <span style="color: #E53E3E; font-size: 24px; font-weight: 700;">Roles:</span>

<p style="font-size: 16px; color: #2D3748; line-height: 1.8;">
<strong style="color: #C53030;">admin</strong> → Full access to hospitals, doctors, users<br>
<strong style="color: #C53030;">doctor</strong> → Only doctor profile operations<br>
<strong style="color: #C53030;">patient</strong> → Only patient profile operations
</p>

### <span style="color: #E53E3E; font-size: 24px; font-weight: 700;">Authentication Flow</span>

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">
Login returns:
</p>

<p style="font-size: 16px; color: #4A5568; line-height: 1.8;">
• accessToken (15 min)<br>
• refreshToken (7 days)
</p>

### <span style="color: #E53E3E; font-size: 24px; font-weight: 700;">Protect Middleware</span>

```
Authorization: Bearer <accessToken>
```

---

# <span style="color: #38B2AC; font-size: 42px; font-weight: 900;">📌 API ENDPOINTS DOCUMENTATION</span>

<p style="font-size: 18px; color: #2D3748; font-weight: 600;">
All API routes grouped below.
</p>

---

## <span style="color: #4299E1; font-size: 32px; font-weight: 800;">1️⃣ AUTHENTICATION ROUTES</span>

<p style="font-size: 18px; color: #2D3748; font-weight: 600;">
Base: <code style="color: #D53F8C; font-weight: 700;">/api/auth</code>
</p>

### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">POST /send-otp → Send OTP to email</span>

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Request Body</p>

```json
{
  "mobile": "9381194502",
  "email": "test@gmail.com"
}
```

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Response</p>

```json
{ "message": "OTP sent to email" }
```

### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">POST /verify-otp</span>

```json
{
  "mobile": "9381194502",
  "otp": "123456"
}
```

<p style="font-size: 16px; color: #4A5568;">
→ Verifies OTP and deletes it.
</p>

### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">POST /register (Patient Registration)</span>

```json
{
  "name": "Anand",
  "mobile": "9381194502",
  "email": "test@gmail.com",
  "password": "Anand@123",
  "otp": "123456"
}
```

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Response</p>

```json
{
  "message": "Registration successful",
  "tokens": { "accessToken": "...", "refreshToken": "..." },
  "user": { "id": "...", "name": "...", "mobile": "...", "email": "..." }
}
```
### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">POST /forgot-password</span>

```json
{
"email": "test@gmail.com"
}
```
### <span style="color: #3182CE; font-size: 18px; font-weight: 700;">Response</span>

```json
{ "message": "Reset link has been sent to your email." }
```
### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">PATCH /reset-password</span>

```json
{
"token": "<resetToken>",
"newPwd": "NewPassword123"
}
```
### <span style="color: #3182CE; font-size: 18px; font-weight: 700;">Response</span>
```json
{ "message": "Password reset successful. Please login again." }
```


### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">POST /login</span>

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">For Patients/Admin</p>

```json
{
  "mobile": "9381194502",
  "password": "Anand@123"
}
```

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">For Doctors</p>

```json
{
  "doctorId": "DOC123456",
  "password": "pass123"
}
```

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Response</p>

```json
{
  "tokens": { "accessToken": "...", "refreshToken": "..." },
  "user": { "id": "...", "name": "...", "role": "..." }
}
```

### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">POST /refresh</span>

```json
{
  "refreshToken": "..."
}
```

### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">POST /logout</span>

```json
{
  "refreshToken": "..."
}
```

### <span style="color: #3182CE; font-size: 22px; font-weight: 700;">GET /me (Authenticated)</span>

```
Authorization: Bearer <token>
```

---

## <span style="color: #48BB78; font-size: 32px; font-weight: 800;">2️⃣ PATIENT ROUTES</span>

<p style="font-size: 18px; color: #2D3748; font-weight: 600;">
Base: <code style="color: #D53F8C; font-weight: 700;">/api/patients</code>
</p>

### <span style="color: #38A169; font-size: 22px; font-weight: 700;">GET /profile</span>

<p style="font-size: 16px; color: #4A5568;">
(roles: patient, admin)
</p>

### <span style="color: #38A169; font-size: 22px; font-weight: 700;">PATCH /profile</span>

```json
{
  "dob": "2001-05-11",
  "gender": "male",
  "address": "Hyderabad"
}
```

---

## <span style="color: #9F7AEA; font-size: 32px; font-weight: 800;">3️⃣ DOCTOR ROUTES</span>

<p style="font-size: 18px; color: #2D3748; font-weight: 600;">
Base: <code style="color: #D53F8C; font-weight: 700;">/api/doctors</code>
</p>

### <span style="color: #805AD5; font-size: 22px; font-weight: 700;">GET / (Public Search)</span>

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Optional Query:</p>

```
/api/doctors?speciality=cardiology
```

### <span style="color: #805AD5; font-size: 22px; font-weight: 700;">GET /me (Doctor/Admin only)</span>

<p style="font-size: 16px; color: #4A5568;">
Authorization required.
</p>

### <span style="color: #805AD5; font-size: 22px; font-weight: 700;">PUT /me</span>

<p style="font-size: 16px; color: #4A5568;">
Update doctor profile.
</p>

```json
{
  "specialties": ["Cardiology"],
  "bio": "10 years experience"
}
```

### <span style="color: #805AD5; font-size: 22px; font-weight: 700;">GET /:id (Public)</span>

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Example:</p>

```
GET /api/doctors/6922c607cd557241f89d4156
```

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Response:</p>

```json
{
  "user": { "name": "Dr Ramesh" },
  "specialties": [],
  "availability": []
}
```

---

## <span style="color: #F6AD55; font-size: 32px; font-weight: 800;">4️⃣ HOSPITAL ROUTES</span>

<p style="font-size: 18px; color: #2D3748; font-weight: 600;">
Base: <code style="color: #D53F8C; font-weight: 700;">/api/hospitals</code>
</p>

### <span style="color: #DD6B20; font-size: 22px; font-weight: 700;">POST / (Admin)</span>

```json
{
  "name": "Apollo",
  "address": "Hyderabad",
  "specialities": ["Cardiology"]
}
```

### <span style="color: #DD6B20; font-size: 22px; font-weight: 700;">GET / (Public)</span>

### <span style="color: #DD6B20; font-size: 22px; font-weight: 700;">GET /:id</span>

### <span style="color: #DD6B20; font-size: 22px; font-weight: 700;">PATCH /:id (Admin)</span>

### <span style="color: #DD6B20; font-size: 22px; font-weight: 700;">POST /:id/branches</span>

```json
{
  "name": "Branch 1",
  "address": "City",
  "phone": "9000000000"
}
```

### <span style="color: #DD6B20; font-size: 22px; font-weight: 700;">GET /:id/branches</span>

---

## <span style="color: #FC8181; font-size: 32px; font-weight: 800;">5️⃣ ADMIN ROUTES</span>

<p style="font-size: 18px; color: #2D3748; font-weight: 600;">
Base: <code style="color: #D53F8C; font-weight: 700;">/api/admin</code>
</p>

### <span style="color: #E53E3E; font-size: 22px; font-weight: 700;">POST /create-doctor</span>

```json
{
  "name": "Dr Ramesh",
  "email": "doctor@gmail.com",
  "mobile": "9000000000",
  "password": "doc123"
}
```

<p style="font-size: 16px; color: #2D3748; font-weight: 600;">Response:</p>

```json
{ "doctorId": "DOC296259" }
```

### <span style="color: #E53E3E; font-size: 22px; font-weight: 700;">POST /create-admin</span>

### <span style="color: #E53E3E; font-size: 22px; font-weight: 700;">GET /users (Admin)</span>

### <span style="color: #E53E3E; font-size: 22px; font-weight: 700;">DELETE /users/:id</span>

### <span style="color: #E53E3E; font-size: 22px; font-weight: 700;">GET /hospitals</span>

### <span style="color: #E53E3E; font-size: 22px; font-weight: 700;">PATCH /hospitals/:id/status</span>

```json
{
  "status": "approved"
}
```

---

## <span style="color: #ED8936; font-size: 32px; font-weight: 800;">🛠 Common Error Responses</span>

```json
{ "message": "Invalid or expired OTP" }
{ "message": "Mobile already in use" }
{ "message": "Not authorized" }
{ "errors": [ "...validation errors" ] }
```

---

# <span style="color: #48BB78; font-size: 42px; font-weight: 900;">✔️ Backend Setup Complete</span>

<p style="font-size: 18px; color: #2D3748; line-height: 1.8;">
Use Postman to test all routes using the above docs.
</p>

<p style="font-size: 18px; color: #2D3748; line-height: 1.8;">
If additional routes are added later, update this README accordingly.
</p>