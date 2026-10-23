# 🏥 Multi-Tenant Hospital ID Implementation Guide

## Overview
This guide ensures **complete data isolation** between hospitals in the MSCurechain system. Most database records MUST include a `hospital` ID to maintain multi-tenancy, with specific exceptions for certain roles.

---

## 🚨 IMPORTANT: Hospital ID Exceptions

### ❌ **EXCEPTIONS - No Hospital ID Required:**
1. **Super Admin** (`superadmins` collection)
   - Manages ALL hospitals across the system
   - Has global access to all data
   - NOT tied to a specific hospital

2. **Patient** (`patients` collection)
   - Patients CAN be registered without a hospital
   - Hospital ID is stored in RELATED records (appointments, admissions, prescriptions)
   - Allows patients to visit multiple hospitals over time

3. **Emergency** (`ambulancepersonnels`, `emergencyrequests` collections)
   - Emergency services may operate across multiple hospitals
   - Hospital is recorded in the emergency REQUEST, not the personnel

### ✅ **REQUIRED - Hospital ID MANDATORY for:**
All other roles and their related data:
- **Doctor, Hospital Admin, Nurse, Staff, Pharmacy, Lab, Frontdesk/Helpdesk**
- **All clinical records:** Appointments, Prescriptions, Lab Orders, Admissions
- **All operational records:** Attendance, Shifts, Payroll, Inventory, Products
- **All management records:** Quality Metrics, SOPs, Incidents, Reports

---

## ✅ Current Implementation Status

Based on code review, the system **ALREADY HAS** hospital ID implementation in place for most collections. Here's what's confirmed:

### ✅ Models with Hospital ID (Verified)
1. ✅ `User` - Line 26: `hospital: { type: Schema.Types.ObjectId, ref: "Hospital" }`
2. ✅ `Patient` - Line 11: `hospital: { type: Schema.Types.ObjectId, ref: "Hospital" }`
3. ✅ `Appointment` - Line 16-20: `hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", required: true }`
4. ✅ `DoctorProfile` - Line 8-12: `hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", required: true }`
5. ✅ `Prescription` - Line 45: `hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true }`
6. ✅ `IPDAdmission` - Line 46: `hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true }`
7. ✅ `LabOrder` - Line 17-21: `hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", required: true }`

### ✅ Indexes Properly Configured
All verified models have proper compound indexes including `hospital`:
- `appointmentSchema.index({ hospital: 1, date: -1, status: 1 })`
- `userSchema.index({ hospital: 1, role: 1, status: 1 })`
- `PrescriptionSchema.index({ hospital: 1, createdAt: -1 })`
- `ipdAdmissionSchema.index({ hospital: 1, status: 1 })`
- `labOrderSchema.index({ hospital: 1, status: 1, createdAt: -1 })`

---

## 📋 Checklist: All 65 Collections

Below is the complete list of all collections. Review each to ensure hospital ID is properly implemented:

**Legend:**
- ✅ = Verified with hospital field
- ❓ = Needs verification
- ❌ = Exception (No hospital ID required)

### Core User & Profile Collections
- [x] 1. `users` - ✅ Verified (has hospital field for all roles except super-admin)
- [x] 2. `patients` - ❌ **EXCEPTION** (No hospital ID - patients can visit multiple hospitals)
- [x] 3. `doctorprofiles` - ✅ Verified (has hospital field, required: true)
- [ ] 4. `helpdesks` - ❓ Needs verification (SHOULD have hospital)
- [ ] 5. `staffprofiles` - ❓ Needs verification (SHOULD have hospital)
- [ ] 6. `patientprofiles` - ❌ **EXCEPTION** (Related to patients collection)
- [x] 7. `ambulancepersonnels` - ❌ **EXCEPTION** (Emergency services - cross-hospital)
- [x] 8. `superadmins` - ❌ **EXCEPTION** (Manages ALL hospitals)

### Clinical & Appointment Collections
- [x] 9. `appointments` - ✅ Verified (has hospital field, required: true)
- [x] 10. `prescriptions` - ✅ Verified (has hospital field, required: true)
- [ ] 11. `clinicalnotes` - ❓ Needs verification (SHOULD have hospital)
- [ ] 12. `vitalsrecords` - ❓ Needs verification (SHOULD have hospital)
- [ ] 13. `vitalsalerts` - ❓ Needs verification (SHOULD have hospital)
- [ ] 14. `vitalsthresholds` - ❓ Needs verification (SHOULD have hospital)
- [ ] 15. `vitalsthresholdtemplates` - ❓ Needs verification (SHOULD have hospital)
- [ ] 16. `vitalthresholds` - ❓ Needs verification (SHOULD have hospital)
- [ ] 17. `feedbacks` - ❓ Needs verification (SHOULD have hospital)

### IPD (In-Patient Department) Collections
- [x] 18. `ipdadmissions` - ✅ Verified (has hospital field, required: true)
- [ ] 19. `bedoccupancies` - ❓ Needs verification (SHOULD have hospital)
- [ ] 20. `beds` - ❓ Needs verification (SHOULD have hospital)
- [ ] 21. `dietlogs` - ❓ Needs verification (SHOULD have hospital)
- [ ] 22. `medicationrecords` - ❓ Needs verification (SHOULD have hospital)
- [ ] 23. `ipdadvancepayments` - ❓ Needs verification (SHOULD have hospital)
- [ ] 24. `ipdextracharges` - ❓ Needs verification (SHOULD have hospital)
- [ ] 25. `pendingdischarges` - ❓ Needs verification (SHOULD have hospital)
- [ ] 26. `dischargerecords` - ❓ Needs verification (SHOULD have hospital)

### Lab Collections
- [x] 27. `laborders` - ✅ Verified (has hospital field, required: true)
- [ ] 28. `labtests` - ❓ Needs verification (Test catalog - could be shared or per-hospital)
- [ ] 29. `labtokens` - ❓ Needs verification (SHOULD have hospital)
- [ ] 30. `directlaborders` - ❓ Needs verification (SHOULD have hospital)
- [ ] 31. `labsettings` - ❓ Needs verification (SHOULD have hospital)
- [ ] 32. `testparameters` - ❓ Needs verification (Could be shared across hospitals)
- [ ] 33. `testgroups` - ❓ Needs verification (Could be shared across hospitals)
- [ ] 34. `departments` - ❓ Needs verification (SHOULD have hospital)
- [ ] 35. `walkinpatients` - ❓ Needs verification (SHOULD have hospital)

### Pharmacy Collections
- [ ] 36. `pharmacyorders` - ❓ Needs verification (SHOULD have hospital)
- [ ] 37. `pharmacytokens` - ❓ Needs verification (SHOULD have hospital)
- [ ] 38. `products` - ❓ Needs verification (SHOULD have hospital - inventory is per-hospital)
- [ ] 39. `suppliers` - ❓ Needs verification (Could be shared or per-hospital)
- [ ] 40. `pharmaprofiles` - ❓ Needs verification (SHOULD have hospital)
- [ ] 41. `pharmainvoices` - ❓ Needs verification (SHOULD have hospital)
- [ ] 42. `pharmaauditlogs` - ❓ Needs verification (SHOULD have hospital)
- [ ] 43. `batches` - ❓ Needs verification (SHOULD have hospital - inventory batches)

### Staff & HR Collections
- [ ] 44. `attendances` - ❓ Needs verification (SHOULD have hospital)
- [ ] 45. `shifts` - ❓ Needs verification (SHOULD have hospital)
- [ ] 46. `leaves` - ❓ Needs verification (SHOULD have hospital)
- [ ] 47. `payrolls` - ❓ Needs verification (SHOULD have hospital)
- [ ] 48. `trainingrecords` - ❓ Needs verification (SHOULD have hospital)

### Emergency Collections
- [x] 49. `emergencyrequests` - ❌ **EXCEPTION** (However, should record target hospital in request)

### Communication Collections
- [ ] 50. `messages` - ❓ Needs verification (SHOULD have hospital)
- [ ] 51. `notifications` - ❓ Needs verification (SHOULD have hospital)
- [ ] 52. `announcements` - ❓ Needs verification (SHOULD have hospital)
- [ ] 53. `notes` - ❓ Needs verification (SHOULD have hospital)

### Quality & SOP Collections
- [ ] 54. `qualitymetrics` - ❓ Needs verification (SHOULD have hospital)
- [ ] 55. `qualityindicators` - ❓ Needs verification (SHOULD have hospital)
- [ ] 56. `qualityactions` - ❓ Needs verification (SHOULD have hospital)
- [ ] 57. `sops` - ❓ Needs verification (SHOULD have hospital)
- [ ] 58. `sopacknowledgements` - ❓ Needs verification (SHOULD have hospital)

### Support & Incident Collections
- [ ] 59. `supportrequests` - ❓ Needs verification (SHOULD have hospital)
- [ ] 60. `incidents` - ❓ Needs verification (SHOULD have hospital)
- [ ] 61. `ticketsyncqueues` - ❓ Needs verification (SHOULD have hospital)

### Finance & Reporting Collections
- [ ] 62. `transactions` - ❓ Needs verification (SHOULD have hospital)
- [ ] 63. `reports` - ❓ Needs verification (SHOULD have hospital)

### System Configuration Collections
- [x] 64. `hospitals` - ❌ **EXCEPTION** (This IS the hospital master table)
- [ ] 65. `reminderconfigurations` - ❓ Needs verification (SHOULD have hospital)

**Summary:**
- ✅ Verified: 7 collections
- ❌ Exceptions: 6 collections (patients, patientprofiles, ambulancepersonnels, emergencyrequests, superadmins, hospitals)
- ❓ Needs Verification: 52 collections

---

## 🔧 Implementation Checklist

For EACH collection that needs the hospital field, follow these steps:

### Step 1: Add Hospital Field to Model Schema

```typescript
// Example: /path/to/Models/YourModel.ts
const yourModelSchema = new Schema({
  // ... other fields ...
  
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,  // Make required for strict isolation
    index: true      // Add index for performance
  },
  
  // ... other fields ...
}, { timestamps: true });

// Add compound index with hospital
yourModelSchema.index({ hospital: 1, createdAt: -1 });
yourModelSchema.index({ hospital: 1, status: 1 }); // If status field exists
```

### Step 2: Update Controller - Always Filter by Hospital

```typescript
// Example: /path/to/Controllers/yourController.ts
export const getItems = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // CRITICAL: Always filter by hospital
    const items = await YourModel.find({
      hospital: user.hospital,  // User's hospital from JWT token
      // ... other filters ...
    });
    
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const createItem = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // CRITICAL: Always include hospital when creating
    const item = await YourModel.create({
      ...req.body,
      hospital: user.hospital,  // Automatically add hospital from authenticated user
    });
    
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const updateItem = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // CRITICAL: Filter by BOTH ID and hospital
    const item = await YourModel.findOneAndUpdate(
      { 
        _id: req.params.id,
        hospital: user.hospital  // Ensure user can only update their hospital's data
      },
      req.body,
      { new: true }
    );
    
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }
    
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
```

### Step 3: Update Routes - Ensure Authentication

```typescript
// Example: /path/to/Routes/yourRoutes.ts
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";

const router = express.Router();

// CRITICAL: Always use protect middleware to get user.hospital
router.use(protect);

router.get("/", authorizeRoles("doctor", "hospital-admin"), getItems);
router.post("/", authorizeRoles("hospital-admin"), createItem);
router.put("/:id", authorizeRoles("hospital-admin"), updateItem);
```

### Step 4: Test Multi-Tenancy Isolation

Create a test to verify isolation:

```typescript
// Example test
describe('Multi-Tenancy Isolation', () => {
  it('should not allow access to other hospital data', async () => {
    // Create item for Hospital A
    const hospitalA = await Hospital.create({ name: "Hospital A" });
    const user1 = await createUser({ hospital: hospitalA._id });
    const item = await YourModel.create({ 
      hospital: hospitalA._id,
      name: "Test Item" 
    });
    
    // Try to access from Hospital B
    const hospitalB = await Hospital.create({ name: "Hospital B" });
    const user2 = await createUser({ hospital: hospitalB._id });
    
    const result = await YourModel.find({ 
      hospital: user2.hospital 
    });
    
    expect(result.length).toBe(0); // Should not find Hospital A's data
  });
});
```

---

## 🔍 Quick Verification Script

Run this script to check which models might be missing hospital field:

```typescript
// scripts/check-hospital-field.ts
import mongoose from 'mongoose';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const modelsWithoutHospital: string[] = [];

// Scan all model files
const modules = readdirSync('./');
modules.forEach(module => {
  const modelsPath = path.join(module, 'Models');
  if (existsSync(modelsPath)) {
    const modelFiles = readdirSync(modelsPath).filter(f => f.endsWith('.ts'));
    
    modelFiles.forEach(file => {
      const content = readFileSync(path.join(modelsPath, file), 'utf-8');
      if (!content.includes('hospital')) {
        modelsWithoutHospital.push(`${module}/Models/${file}`);
      }
    });
  }
});

console.log('Models potentially missing hospital field:');
console.log(modelsWithoutHospital);
```

---

## 🏆 Best Practices

### 1. **Always Use Hospital Filter**
```typescript
// ❌ BAD - No hospital filter
const appointments = await Appointment.find({ status: 'scheduled' });

// ✅ GOOD - Always filter by hospital
const appointments = await Appointment.find({ 
  hospital: req.user.hospital,
  status: 'scheduled' 
});
```

### 2. **Auto-Add Hospital on Create**
```typescript
// ✅ GOOD - Automatically add hospital from authenticated user
const newAppointment = await Appointment.create({
  ...req.body,
  hospital: req.user.hospital, // From JWT token
});
```

### 3. **Validate Hospital Access on Update/Delete**
```typescript
// ✅ GOOD - Ensure user can only modify their hospital's data
const updated = await Appointment.findOneAndUpdate(
  { _id: id, hospital: req.user.hospital },
  updates
);

if (!updated) {
  return res.status(404).json({ message: "Not found or access denied" });
}
```

### 4. **Use Compound Indexes**
```typescript
// ✅ GOOD - Optimize queries that filter by hospital
schema.index({ hospital: 1, createdAt: -1 });
schema.index({ hospital: 1, status: 1, date: -1 });
```

### 5. **Handle Super Admin Differently**
```typescript
// Super admin can see ALL hospitals' data
const filter: any = {};

if (req.user.role !== 'super-admin') {
  filter.hospital = req.user.hospital;
}

const data = await YourModel.find(filter);
```

---

## ⚠️ Common Pitfalls

### Pitfall 1: Forgetting Hospital in Search Queries
```typescript
// ❌ WRONG - Search without hospital filter
const patients = await Patient.find({
  name: { $regex: searchTerm, $options: 'i' }
});

// ✅ CORRECT
const patients = await Patient.find({
  hospital: req.user.hospital,
  name: { $regex: searchTerm, $options: 'i' }
});
```

### Pitfall 2: Population Without Hospital Filter
```typescript
// ❌ WRONG - Might expose other hospital's doctors
await Appointment.find().populate('doctor');

// ✅ CORRECT - Filter doctors by hospital too
await Appointment.find({ hospital: req.user.hospital })
  .populate({
    path: 'doctor',
    match: { hospital: req.user.hospital }
  });
```

### Pitfall 3: Aggregation Pipelines
```typescript
// ❌ WRONG - No hospital filter in aggregation
const stats = await Appointment.aggregate([
  { $group: { _id: "$status", count: { $sum: 1 } } }
]);

// ✅ CORRECT
const stats = await Appointment.aggregate([
  { $match: { hospital: mongoose.Types.ObjectId(req.user.hospital) } },
  { $group: { _id: "$status", count: { $sum: 1 } } }
]);
```

---

## 🧪 Testing Strategy

### Unit Tests
```typescript
describe('Hospital Isolation', () => {
  it('should only return hospital-specific data', async () => {
    // Create data for two hospitals
    const hospital1 = await Hospital.create({ name: 'H1' });
    const hospital2 = await Hospital.create({ name: 'H2' });
    
    await Patient.create({ name: 'P1', hospital: hospital1._id });
    await Patient.create({ name: 'P2', hospital: hospital2._id });
    
    // Query as hospital1
    const h1Patients = await Patient.find({ hospital: hospital1._id });
    expect(h1Patients).toHaveLength(1);
    expect(h1Patients[0].name).toBe('P1');
  });
});
```

### Integration Tests
Test complete workflows to ensure hospital isolation:
1. Create user in Hospital A
2. Create records in Hospital A
3. Login as user from Hospital B
4. Verify cannot access Hospital A's data

---

## 📝 Migration Guide

If you need to add hospital field to existing collections:

### Step 1: Add Field to Schema (as shown above)

### Step 2: Create Migration Script
```typescript
// migrations/add-hospital-to-collection.ts
import mongoose from 'mongoose';
import YourModel from '../path/to/Models/YourModel';

async function migrate() {
  // Get default hospital or create one
  const defaultHospital = await Hospital.findOne();
  
  if (!defaultHospital) {
    console.error('No hospital found for migration');
    return;
  }
  
  // Update all existing records
  const result = await YourModel.updateMany(
    { hospital: { $exists: false } },
    { $set: { hospital: defaultHospital._id } }
  );
  
  console.log(`Updated ${result.modifiedCount} records`);
}

migrate();
```

### Step 3: Verify Migration
```bash
# Check that all records have hospital field
db.yourcollection.find({ hospital: { $exists: false } }).count()
# Should return 0
```

---

## ✅ Final Verification Checklist

Before deploying to production, verify:

- [ ] All models have `hospital` field (except `hospitals` and `superadmins`)
- [ ] All models have indexes including `hospital`
- [ ] All `find()` queries include hospital filter
- [ ] All `create()` operations include hospital from `req.user.hospital`
- [ ] All `update()`/`delete()` operations filter by hospital
- [ ] Super admin routes handle hospital filtering differently
- [ ] Tests verify hospital isolation
- [ ] Migration scripts run successfully
- [ ] Postman tests include hospital ID in requests

---

## 📞 Need Help?

If you encounter any issues implementing hospital ID:
1. Check the verified models for reference patterns
2. Review controller examples in this guide
3. Test with Postman using the updated documentation
4. Create unit tests to verify isolation

---

**Last Updated:** March 2024  
**Status:** Implementation Guide Complete
