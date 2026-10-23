# Postman Testing Guide: Group 5 - Medical Incidents & SOP

### 🔑 Important Postman Setup Instructions
1. **Authentication:** All requests require a valid JWT `Bearer Token` in the **Headers** tab:
    * `Authorization` : `Bearer <your_token>`
2. **Tenant ID:** Depending on your setup (especially for super admins), you may need to pass the `x-hospital-id` header. For standard staff/nurses/doctors, their hospital ID is extracted from their JWT token automatically.

---

## 🚨 1. Medical Incidents (`/api/incidents`)

These endpoints allow hospital staff to confidentially report incidents like patient falls, equipment failures, or medication errors, while allowing Hospital Admins to trace and resolve them.

### 1.1 Report an Incident (Create)
* **Method:** `POST`
* **URL:** `{{BASE_URL}}/api/incidents/report`
* **Role required:** Any Authenticated User (Nurse, Staff, Doctor, etc.)
* **Body Type:** `raw` -> `JSON` *(⚠️ Note: If you want to attach an image, you MUST use `form-data` instead of JSON. See instructions below).*
* **Dummy JSON payload (No attachments):**
```json
{
  "incidentDate": "2024-05-10T10:30:00Z",
  "department": "IPD",
  "incidentType": "Patient Fall",
  "severity": "Medium",
  "description": "Patient slipped in the bathroom taking an unassisted shower.",
  "patientFallDetails": {
    "location": "Bathroom 204",
    "activity": "Showering",
    "injury": "Minor bruise on left arm"
  }
}
```

* **If you want to attach an image instead of using JSON:**
  1. In the **Body** tab, select **form-data** instead of `raw`.
  2. Map out the keys identical to the JSON fields above (e.g. key `department`, value `IPD`).
  3. Ensure nested objects like `patientFallDetails` are passed as stringified JSON in the value column.
  4. For the image, type `attachments` in the `KEY` column.
  5. Hover over the right edge of the `KEY` input box until you see a hidden dropdown that says `Text`. Click it and select `File`.
  6. In the `VALUE` column, a **"Select Files"** button will appear. Click it to browse and select an image from your PC.
  7. To upload multiple files, simply add another row with the exact same key name `attachments`, change it to `File`, and select the next image.

### 1.2 Get All Incidents
* **Method:** `GET`
* **URL (Get Everything):** `{{BASE_URL}}/api/incidents/all`
* **URL (Filtered Example):** `{{BASE_URL}}/api/incidents/all?department=IPD&status=OPEN`
* **Role required:** Any *(Non-admins only see incidents they reported; Admins see all for their hospital)*
* **Query Params (Optional):**
    * `startDate`: `2024-05-01`
    * `endDate`: `2024-05-15`
    * `department`: `IPD`
    * `status`: `OPEN` (or `IN REVIEW`, `CLOSED`)

### 1.3 Respond to an Incident (Admin Only)
* **Method:** `POST`
* **URL:** `{{BASE_URL}}/api/incidents/respond/:incidentId` *(Replace `:incidentId` with the ID string from Step 1.2, like `INC-20240510-001` - note this is the string ID, not the Mongo ObjectId)*
* **Role required:** `hospital-admin` or `super-admin`
* **Body Type:** `raw` -> `JSON`
* **Dummy JSON payload:**
```json
{
  "status": "CLOSED",
  "message": "Floor manager has been instructed to install additional grab bars.",
  "actionTaken": "Grab bars installed in bathroom 204."
}
```

---

## 📜 2. Standard Operating Procedures (SOP) (`/api/sop`)

These routes handle the upload of official protocols (PDFs), version control, distributions, and staff acknowledgments.

### 2.1 Upload a new SOP (Admin Only)
* **Method:** `POST`
* **URL:** `{{BASE_URL}}/api/sop`
* **Role required:** `hospital-admin`
* **Body Type:** `form-data`
* **⚠️ IMPORTANT NOTE:** The API requires a PDF file upload to create an SOP. Because you cannot upload files via a raw JSON body in Postman, **you MUST use `form-data`** for this endpoint. If you send JSON, the server will reject it with a "Please upload a PDF document" error.
* **Form-data Parameters:**
    * `name`: `Fire Safety Protocol 2024`
    * `category`: `Safety`
    * `assignedRole`: `Nurse` *(Can be Nurse, Doctor, Staff, etc.)*
    * `sopFile`: `[Select a dummy PDF file from your PC]` *(Must be a PDF file)*
      * **How to attach the PDF in Postman:**
        1. In the **Body** tab, select **form-data**.
        2. In the `KEY` column, type `sopFile`.
        3. Hover over the right edge of the `KEY` input box until a hidden dropdown appears. Change it from `Text` to `File`.
        4. In the `VALUE` column, click **"Select Files"** and pick a `.pdf` document from your PC.

### 2.2 Get all SOPs
* **Method:** `GET`
* **URL:** `{{BASE_URL}}/api/sop`
* **Role required:** Any *(Admins see all; Nurses/Doctors only see 'Active' SOPs assigned specifically to their role)*
* **Response Output:** By default, it returns the SOPs. For non-admins, it will dynamically include an `"isAcknowledged"` true/false flag on each SOP!

### 2.3 Download/View SOP Document
* **Method:** `GET`
* **URL:** `{{BASE_URL}}/api/sop/download/<MongoDB_ObjectId_Here>?download=true`
* **Role required:** Any
* **Notes:** This won't actually send the PDF via Postman straight away; instead, it returns a secure signed Cloudinary URL.

### 2.4 Acknowledge an SOP
* **Method:** `POST`
* **URL:** `{{BASE_URL}}/api/sop/<MongoDB_ObjectId_Here>/acknowledge`
* **Role required:** Any (Usually Staff/Nurse/Doctor)
* **Description:** Used when a staff member reads the protocol and clicks "I have read and agree to this SOP".
* **Body Type:** None required

### 2.5 Get SOP Compliance Report (Admin Only)
* **Method:** `GET`
* **URL:** `{{BASE_URL}}/api/sop/<MongoDB_ObjectId_Here>/report`
* **Role required:** `hospital-admin`
* **Description:** Allows the admin to see which nurses/doctors have read the protocol and who is still pending acknowledgment.

### 2.6 Update an SOP to a New Version (Admin Only)
* **Method:** `PUT`
* **URL:** `{{BASE_URL}}/api/sop/<MongoDB_ObjectId_Here>`
* **Role required:** `hospital-admin`
* **Body Type:** `raw` -> `JSON` *(To update text data only. Send as `form-data` to replace the PDF file!)*
* **Dummy JSON payload:**
```json
{
  "name": "Updated Fire Safety Protocol 2024",
  "category": "Safety",
  "assignedRole": "Nurse"
}
```
* **Notes:** If you attach a new `sopFile` (PDF) in `form-data` retaining the same `name`, the system will automatically mark the old one as "Archived", bump the Version from `v1` to `v2`, and publish the new document.

### 2.7 Manually Archive an SOP (Admin Only)
* **Method:** `PATCH`
* **URL:** `{{BASE_URL}}/api/sop/<MongoDB_ObjectId_Here>/archive`
* **Role required:** `hospital-admin`

### 2.8 View Version History of a Protocol
* **Method:** `GET`
* **URL:** `{{BASE_URL}}/api/sop/history/Fire Safety Protocol 2024`
* **Role required:** `hospital-admin`
* **Response:** Shows `v1`, `v2`, etc.
