# Postman Guide: Modules 1-11 (Production Ready)

This guide contains ready-to-use Postman request configurations for the 11 requested modules. 

### 🛡️ Prerequisite Headers
- **Authorization**: `Bearer {{access_token}}`
- **Hospital-Id**: `{{hospital_id}}` (Required for most routes)
- **Content-Type**: `application/json` (unless specifying multipart/form-data)

---

## 📂 Module 1: SOP (Standard Operating Procedures)
**Base Route:** `{{baseUrl}}/api/sop`

### 1.1 Upload SOP (New version or new protocol)
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/sop`
- **Type:** `form-data`
- **Description:** Creates a new SOP or archives the old one to increment the version.
- **Body:**
    - `sopFile`: [File - PDF]
    - `name`: "Hand Hygiene Protocol"
    - `category`: "Infection Control" (Enum: OPD, IPD, Billing, Infection Control, Emergency, HR, Pharmacy, Lab, General)
    - `assignedRole`: "Nurse" (Enum: Staff, Doctor, Nurse)

### 1.2 Get SOP List  
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/sop?category=all&status=Active&search=`
- **Description:** Filters by role automatically for non-admins. Admin can filter by `status=Archived`.

### 1.3 Update SOP Metadata
- **Method:** `PUT`
- **URL:** `{{baseUrl}}/api/sop/:id`
- **Type:** `form-data`
- **Description:** Updates metadata. If a new `sopFile` is provided, a new version is created.

### 1.4 Archive SOP
- **Method:** `PATCH`
- **URL:** `{{baseUrl}}/api/sop/:id/archive`

### 1.5 Get SOP Version History
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/sop/history/:name`

### 1.6 Download SOP (Secure)
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/sop/download/:id?download=true`

### 1.7 Acknowledge SOP
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/sop/:id/acknowledge`

### 1.8 Get Acknowledgment Report (Admin)
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/sop/:id/report`

---

## 📂 Module 2: Internships & Training
**Base Route:** `{{baseUrl}}/api/training`

### 2.1 Log Training/Internship Record
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/training`
- **Type:** `form-data`
- **Body:**
    - `trainingName`: "Summer Internship 2026"
    - `trainingDate`: "2026-06-01"
    - `department`: "Cardiology"
    - `participants`: ["{{userId1}}", "{{userId2}}"]
    - `description`: "Internal medicine training"
    - `status`: "Scheduled"
    - `certificate`: [File - Optional]

### 2.2 Get All Training Records
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/training`

### 2.3 Update Training Record
- **Method:** `PATCH`
- **URL:** `{{baseUrl}}/api/training/:id`
- **Type:** `form-data`

### 2.4 Delete Training
- **Method:** `DELETE`
- **URL:** `{{baseUrl}}/api/training/:id`

### 2.5 Get My Training History
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/training/my-history`

### 2.6 Get Specific Staff History
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/training/staff/:staffId`

---

## 📂 Module 3: Medical Incidents
**Base Route:** `{{baseUrl}}/api/incidents`

### 3.1 Report Incident
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/incidents/report`
- **Type:** `form-data`
- **Body:**
    - `incidentDate`: "2026-02-20T10:00:00Z"
    - `department`: "IPD Ward A"
    - `incidentType`: "Patient Fall"
    - `severity`: "Medium"
    - `description`: "Patient slipped near washroom"
    - `attachments`: [Files - Max 5 Images]
    - `patientFallDetails`: `{"patientName": "John Doe", "mrnNumber": "MRN123", "bedNumber": "B-101"}`

### 3.2 List All Incidents
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/incidents/all?startDate=&endDate=&department=all&status=all`
- **Description:** Returns reports. Admins see all; staff see only their own.

### 3.3 Respond to Incident (Admin)
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/incidents/respond/:incidentId`
- **Body:**
```json
{
  "message": "Reviewed the CCTV footage.",
  "actionTaken": "Anti-slip mats installed.",
  "status": "CLOSED"
}
```

---

## 📂 Module 4: Roster (Shifts & Scheduling)
**Base Route:** `{{baseUrl}}/api/hospital-admin`

### 4.1 Create Shift
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/hospital-admin/shifts`
- **Body:**
```json
{
  "name": "Night Shift",
  "startTime": "22:00",
  "endTime": "06:00",
  "color": "#FF5733"
}
```

### 4.2 Get All Shifts
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/hospital-admin/shifts`

### 4.3 Update Shift
- **Method:** `PUT`
- **URL:** `{{baseUrl}}/api/hospital-admin/shifts/:id`

### 4.4 Delete Shift
- **Method:** `DELETE`
- **URL:** `{{baseUrl}}/api/hospital-admin/shifts/:id`

### 4.5 Assign Staff to Roster
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/hospital-admin/shifts/:id/assign`
- **Body:**
```json
{
  "staffIds": ["{{userId1}}", "{{userId2}}"]
}
```

### 4.6 Get My Schedule & Roster
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/staff/attendance/schedule`
- **Description:** Returns shift timings, weekly off, and monthly attendance stats.

---

## 📂 Module 5: Quality Indicators
**Base Route:** `{{baseUrl}}/api/quality`

### 5.1 Create Indicator
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/quality/indicators`
- **Body:**
```json
{
  "name": "Catheter Associated Urinary Tract Infection (CAUTI) Rate",
  "department": "ICU",
  "problemIdentified": "High infection rate in post-op",
  "baselineValue": 4.5,
  "targetValue": 1.2,
  "unit": "%"
}
```

### 5.2 Get All Indicators
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/quality/indicators`

### 5.3 Update/Delete Indicator
- **Method:** `PATCH/DELETE`
- **URL:** `{{baseUrl}}/api/quality/indicators/:id`

### 5.4 Create Corrective Action (CAPA)
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/quality/actions`
- **Body:**
```json
{
  "indicatorId": "{{indicatorId}}",
  "problemDescription": "Inadequate sterilization of kits",
  "period": { "from": "2026-02-01", "to": "2026-03-01" },
  "actionDescription": "Mandatory re-training on sterilization protocol",
  "responsibleDepartment": "Nursing / Quality",
  "startDate": "2026-02-21",
  "reviewDate": "2026-03-15"
}
```

### 5.5 Update Action Status
- **Method:** `PATCH`
- **URL:** `{{baseUrl}}/api/quality/actions/:id/status`
- **Body:** `{"status": "In Progress"}`

### 5.6 Evaluate Outcome (Close CAPA)
- **Method:** `PATCH`
- **URL:** `{{baseUrl}}/api/quality/actions/:id/evaluate`
- **Body:**
```json
{
  "measurableResultAfter": 1.1,
  "outcomeSummary": "Target achieved after training.",
  "isClosed": true
}
```

---

## 📂 Module 6: Support System
**Base Route:** `{{baseUrl}}/api/support`

### 6.1 Raise Ticket
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/support`
- **Type:** `form-data`
- **Body:**
    - `subject`: "Bug in Billing Module"
    - `message`: "Invoice rounding error in pharmacy"
    - `type`: "bug"
    - `attachments`: [Files]

### 6.2 Get My Tickets
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/support/my-tickets`

### 6.3 Get All Tickets (Admin)
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/support`

### 6.4 Get Ticket Details
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/support/:id`

### 6.5 Reply to Ticket
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/support/:id/reply`
- **Type:** `form-data`

### 6.6 Update Ticket Status (Admin)
- **Method:** `PUT`
- **URL:** `{{baseUrl}}/api/support/:id/status`
- **Body:** `{"status": "resolved"}`

---

## 📂 Module 7: Emergency Request
**Base Route:** `{{baseUrl}}/api/emergency/requests`

### 7.1 Create Emergency Entry (Ambulance)
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/emergency/requests`
- **Body:**
```json
{
  "patientName": "Unknown Male",
  "patientAge": 45,
  "patientGender": "male",
  "emergencyType": "Cardiac Arrest",
  "severity": "critical",
  "currentLocation": "12.9716, 77.5946",
  "vitals": {
    "bloodPressure": "90/60",
    "heartRate": 110,
    "oxygenLevel": 88
  },
  "requestedHospitals": ["{{hospitalId}}"]
}
```

### 7.2 Create Emergency Request (Patient)
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/emergency/requests/patient`
- **Body:**
```json
{
  "emergencyType": "Accident",
  "description": "Leg injury",
  "severity": "high",
  "currentLocation": "12.934, 77.612",
  "hospitalId": "{{hospitalId}}"
}
```

### 7.3 Get My Requests (Ambulance)
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/emergency/requests/my-requests`

### 7.4 Hospital Dashboard View
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/emergency/requests/hospital`

### 7.5 Emergency Statistics
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/emergency/requests/hospital/stats`

### 7.6 Accept Request (Helpdesk)
- **Method:** `PUT`
- **URL:** `{{baseUrl}}/api/emergency/requests/:requestId/accept`

### 7.7 Reject Request (Helpdesk)
- **Method:** `PUT`
- **URL:** `{{baseUrl}}/api/emergency/requests/:requestId/reject`
- **Body:** `{"rejectionReason": "No ICU beds available"}`

---

## 📂 Module 8: Leave Management
**Base Route:** `{{baseUrl}}/api/leaves`

### 8.1 Apply for Leave
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/leaves/request`
- **Body:**
```json
{
  "startDate": "2026-03-01",
  "endDate": "2026-03-03",
  "reason": "Personal work",
  "leaveType": "casual"
}
```

### 8.2 Get Leaves History
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/leaves`

### 8.3 Get Leave Balance
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/leaves/balance`

### 8.4 Delete Leave (Withdraw)
- **Method:** `DELETE`
- **URL:** `{{baseUrl}}/api/leaves/:id`

### 8.5 Update Leave Status (Admin)
- **Method:** `PUT/POST`
- **URL:** `{{baseUrl}}/api/leaves/:id/status`
- **Body:** `{"status": "approved"}`

---

## 📂 Module 9: Announcements
**Base Route:** `{{baseUrl}}/api/announcements`

### 9.1 Publish Announcement
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/announcements`
- **Body:**
```json
{
  "title": "Town Hall Meeting",
  "content": "All staff must attend the meet in the cafeteria at 4 PM.",
  "priority": "high",
  "targetRoles": ["staff", "doctor", "nurse"]
}
```

### 9.2 Get All Announcements
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/announcements`

### 9.3 Get Hospital Announcements
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/announcements/hospital`

### 9.4 Update/Delete Announcement
- **Method:** `PATCH/DELETE`
- **URL:** `{{baseUrl}}/api/announcements/:id`

---

## 📂 Module 10: Doctor's Notes
**Base Route:** `{{baseUrl}}/api/notes`

### 10.1 Save Personal Note
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/notes`
- **Body:**
```json
{
  "doctorId": "{{userId}}",
  "text": "Check labs for patient in Bed 402 tomorrow morning."
}
```

### 10.2 Get My Notes
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/notes/:doctorId`

### 10.3 Delete Note
- **Method:** `DELETE`
- **URL:** `{{baseUrl}}/api/notes/:id`

### 10.4 Delete All My Notes
- **Method:** `DELETE`
- **URL:** `{{baseUrl}}/api/notes/all/:doctorId`

---

## 📂 Module 11: Vital Threshold Template (Bulk Import)
**Base Route:** `{{baseUrl}}/api/ipd`

### 11.1 Bulk Import via CSV
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/import`
- **Type:** `form-data`
- **Body:**
    - `file`: [CSV File]

**CSV Column Structure (Strict):**
`unitType,vitalName,unit,min,lowCritical,lowWarning,targetRange,highWarning,highCritical,max,escalationMinutes`

**Sample CSV Row:**
`ICU,heartRate,bpm,30,40,50,60-100,110,130,220,50`

### 11.2 List All Templates
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/templates`

### 11.3 Create Template
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/templates`
- **Body:** `{"templateName": "ICU Protcol", "wardType": "ICU"}`

### 11.4 Get Template Thresholds
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/templates/:templateId`

### 11.5 Save/Upsert Threshold Rows
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/templates/:templateId/save`
- **Body:**
```json
{
  "monitoringFrequency": { "critical": 1, "warning": 4 },
  "thresholds": [
    {
      "vitalName": "spO2",
      "physicalMin": 0,
      "lowerCritical": 85,
      "lowerWarning": 90,
      "targetMin": 95,
      "targetMax": 100,
      "upperWarning": 100,
      "upperCritical": 100,
      "physicalMax": 100,
      "unit": "%",
      "escalationCriticalMinutes": 60
    }
  ]
}
```

### 11.6 Copy Template
- **Method:** `POST`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/templates/:templateId/copy`
- **Body:** `{"newTemplateName": "Emergency Protcol", "newWardType": "Emergency"}`

### 11.7 Update/Delete Template
- **Method:** `PATCH/DELETE`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/templates/:templateId`

### 11.8 Get Admission Thresholds
- **Method:** `GET`
- **URL:** `{{baseUrl}}/api/ipd/thresholds/admission/:admissionId`
- **Description:** Returns the active thresholds applied to a specific patient.
