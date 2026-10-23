# Comprehensive Test Cases for IPD and OPD Workflows

This document outlines the end-to-end testing scenarios for the Inpatient Department (IPD) and Outpatient Department (OPD) workflows across all relevant roles in the multi-tenant MsCurechain Backend.

## 1. Outpatient Department (OPD) Test Cases

### 1.1 Role: Patient
*   **TC_OPD_PAT_01 (Registration/Login):** Verify a patient can register successfully using mobile number and receive credentials. Verify successful login.
*   **TC_OPD_PAT_02 (Booking Appointment):** Verify a patient can view available doctor slots and book a new OPD appointment for a specific date and time.
*   **TC_OPD_PAT_03 (View Tokens/Queue):** Verify a patient can view their live queue number or token for the current OPD visit.
*   **TC_OPD_PAT_04 (View Prescription & Reports):** Verify a patient can view and download their digital prescription and lab reports post-consultation.

### 1.2 Role: Frontdesk / Receptionist
*   **TC_OPD_REC_01 (Walk-in Registration):** Verify receptionist can register a walk-in patient and assign them a doctor's queue token.
*   **TC_OPD_REC_02 (Appointment Management):** Verify receptionist can view all booked appointments for the day, mark patients as "Arrived", and cancel/reschedule appointments.
*   **TC_OPD_REC_03 (Billing):** Verify receptionist can collect consultation fees and generate an invoice/receipt for the OPD visit.

### 1.3 Role: Doctor
*   **TC_OPD_DOC_01 (View Queue):** Verify doctor can view their patient queue for the day in correct order.
*   **TC_OPD_DOC_02 (Consultation & Prescription):** Verify doctor can open a patient's profile, enter vitals (if not done by nurse), and write a digital prescription (medicines, tests, advice).
*   **TC_OPD_DOC_03 (Mark Completed):** Verify doctor can mark the consultation as "Completed", which updates the patient's queue status.

### 1.4 Role: Lab Technician (If Tests Prescribed)
*   **TC_OPD_LAB_01 (View Pending Tests):** Verify lab technician can see the prescribed lab tests linked to the patient's OPD case.
*   **TC_OPD_LAB_02 (Upload Results):** Verify lab technician can upload test results and mark the lab order as "Completed."

### 1.5 Role: Pharmacist
*   **TC_OPD_PHARM_01 (View Prescriptions):** Verify pharmacist can view the pending medication prescriptions for OPD patients.
*   **TC_OPD_PHARM_02 (Dispense & Bill):** Verify pharmacist can select available inventory, dispense the medicines, and generate a pharmacy bill for the patient.


---

## 2. Inpatient Department (IPD) Test Cases

### 2.1 Role: Frontdesk / IPD Receptionist
*   **TC_IPD_REC_01 (Initiate Admission):** Verify receptionist can create a new IPD admission record from a doctor's recommendation or emergency ward.
*   **TC_IPD_REC_02 (Bed Allocation):** Verify receptionist can view the interactive bed map, select an available bed/ward, and allocate it to the patient.
*   **TC_IPD_REC_03 (Advance Payment):** Verify receptionist can process an advance deposit payment for the IPD admission.

### 2.2 Role: Nurse
*   **TC_IPD_NURSE_01 (Record Vitals):** Verify nurse can navigate to an admitted patient's profile and record periodic vitals (HR, BP, Temp, SpO2).
*   **TC_IPD_NURSE_02 (Medication Administration):** Verify nurse can view the IPD medication chart prescribed by the doctor and mark medicines as "Given" with timestamp.
*   **TC_IPD_NURSE_03 (Nursing Notes):** Verify nurse can add nursing notes and handover notes at the end of a shift.

### 2.3 Role: Doctor (IPD Rounds)
*   **TC_IPD_DOC_01 (Ward View):** Verify doctor can view the list of admitted patients under their care.
*   **TC_IPD_DOC_02 (Daily Notes):** Verify doctor can add daily examination round notes to the IPD patient's chart.
*   **TC_IPD_DOC_03 (Modify Treatment/Diet):** Verify doctor can update the IPD prescription, lab orders, or dietary requirements.
*   **TC_IPD_DOC_04 (Initiate Discharge):** Verify doctor can write the Discharge Summary and change the patient's status to "Ready for Discharge."

### 2.4 Role: IPD Billing
*   **TC_IPD_BILL_01 (Calculate Total):** Verify the billing module automatically aggregats ward charges (days * room rate), doctor visit charges, pharmacy, and lab charges.
*   **TC_IPD_BILL_02 (Final Settlement):** Verify the billing admin can deduct the advance paid, apply insurance/discounts, and generate the final IPD bill.

### 2.5 Role: Admin/Super Admin
*   **TC_IPD_ADMIN_01 (Bed Management):** Verify admin can add, block (for maintenance), or remove beds in the system.
*   **TC_IPD_ADMIN_02 (Discharge Approval):** Verify admin can authorize the physical exit of the patient once the final bill is settled (gate pass generation).


## 3. General Cross-Cutting Concerns
*   **TC_GEN_01 (Multi-Tenancy):** Verify that Staff/Doctors from Hospital A cannot view or access OPD/IPD data of Hospital B.
*   **TC_GEN_02 (Role Access Control):** Verify that a Lab Technician cannot access IPD Bed Allocation endpoints (should receive 403 Forbidden).
