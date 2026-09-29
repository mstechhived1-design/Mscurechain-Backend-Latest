---
description: Implementation plan for IPD Billing & Management System
---

# IPD Billing & Management System Implementation Plan

## Overview
This plan outlines the steps to implement a comprehensive IPD billing system, including configurable bed pricing, miscellaneous charges, real-time calculations, and audit-compliant settlement workflows.

## Phase 1: Model & Type Updates
1.  **Bed Model Enhancement**:
    *   Add `pricePerDay: number` to `IBed` interface and `Bed` schema.
2.  **IPD Admission Enhancement**:
    *   Add billing related fields:
        *   `advancePaid: number`
        *   `discountDetails: { amount: number, reason: string, approvedBy: ObjectId }`
        *   `isBillLocked: boolean`
        *   `totalAmount: number`
3.  **New Model: IPDExtraCharge**:
    *   Fields: `patient`, `admission`, `category`, `description`, `amount`, `date`, `addedBy`, `status` (Active/Reversed).
    *   Categories: Nursing, Doctor Fee, OT, Radiology, Pharmacy, Consumables, Lab, Misc.
4.  **New Model: IPDAdvancePayment**:
    *   Fields: `patient`, `admission`, `amount`, `mode` (Cash/UPI/Card/Insurance), `reference`, `transactionType` (Advance/Refund), `date`.

## Phase 2: Configuration & Management APIs
1.  **Hospital Admin: Bed Pricing**:
    *   `PUT /api/v1/ipd/beds/:id/price`: Update bed pricing.
2.  **Billing Rules**:
    *   Implement logic for partial-day billing (e.g., >12h = full day, <12h = half day).

## Phase 3: Transactional APIs
1.  **Extra Charges**:
    *   `POST /api/v1/ipd/billing/charges`: Add miscellaneous charges.
    *   `GET /api/v1/ipd/billing/charges/:admissionId`: View charge breakdown.
2.  **Advances/Refunds**:
    *   `POST /api/v1/ipd/billing/advances`: Record advance payment.
    *   `GET /api/v1/ipd/billing/summary/:admissionId`: Calculate live total including bed days.

## Phase 4: Frontend Integration (Helpdesk & Admin)
1.  **Bed Inventory**: Display `pricePerDay` in bed cards.
2.  **IPD Center**: Add a "Billing" tab for active patients.
3.  **Charge Modal**: For doctors/nurses to add services.

## Phase 5: Discharge & Audit logic
1.  **Discharge Request**: Verify billing status.
2.  **Settlement**: Lock bill, generate final receipt, move admission to "Discharged".
3.  **Auditing**: Ensure all discount overrides have mandatory justification and user logs.

## Technical Details
- **Bed Days Calculation Logic**: 
  `days = Math.max(1, Math.ceil((currentDate - startDate) / (1000 * 60 * 60 * 24)))`
- **RBAC**: Middleware checks for roles `hospital-admin` (for configuration) and `doctor/nurse/staff` (for adding charges).
