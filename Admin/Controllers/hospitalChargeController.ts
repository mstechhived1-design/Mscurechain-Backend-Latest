import { Request, Response } from 'express';
import { HospitalCharge } from '../../Hospital/Models/HospitalCharge.js';
import { getCurrentTenantId } from '../../middleware/tenantMiddleware.js';

// Default system presets
export const DEFAULT_CHARGES_PRESETS: Record<string, { desc: string; amount: number }[]> = {
  'Room Charges': [
    { desc: 'General Ward Room Rent (1 Day)', amount: 1500 },
    { desc: 'Semi-Private Room Rent (1 Day)', amount: 2500 },
    { desc: 'Private Deluxe Room Rent (1 Day)', amount: 4500 },
    { desc: 'ICU / ITU Bed Rent (1 Day)', amount: 8000 },
    { desc: 'NICU Incubator Bed Rent (1 Day)', amount: 6000 },
  ],
  'Nursing Charges': [
    { desc: 'General Ward Nursing Care (Per Day)', amount: 500 },
    { desc: 'ICU Intensive Nursing Care (Per Day)', amount: 1500 },
    { desc: 'Special 1-on-1 Nurse Assistance (12 Hrs)', amount: 2000 },
    { desc: 'Routine Injection & Dressing Fee', amount: 300 },
  ],
  'Consumables': [
    { desc: 'IV Fluids & Cannulation Kit', amount: 450 },
    { desc: 'Surgical Gloves & PPE Kit', amount: 350 },
    { desc: 'Nebulization Mask & Tubing Kit', amount: 250 },
    { desc: 'Catheterization Kit Complete', amount: 650 },
    { desc: 'Daily Hygiene & Bedding Kit', amount: 300 },
  ],
  'Procedure Charges': [
    { desc: 'Minor Wound Suturing / Dressing', amount: 1200 },
    { desc: 'Major Surgical Dressing Change', amount: 2500 },
    { desc: 'Central Line / CVC Insertion', amount: 4500 },
    { desc: 'Endo / Tracheostomy Care', amount: 3000 },
    { desc: 'Plaster / Cast Application', amount: 1800 },
  ],
  'Equipment Charges': [
    { desc: 'Oxygen Cylinder Support (Per Day)', amount: 1200 },
    { desc: 'Multi-Para Vital Monitor (Per Day)', amount: 1000 },
    { desc: 'Ventilator Life Support (Per Day)', amount: 5000 },
    { desc: 'Syringe / Infusion Pump Usage', amount: 800 },
    { desc: 'BiPAP / CPAP Machine Usage', amount: 2500 },
  ],
  'Doctor Visit': [
    { desc: 'Resident Doctor Daily Ward Round', amount: 600 },
    { desc: 'Senior Consultant Daily Round', amount: 1500 },
    { desc: 'Specialist / Surgeon Emergency Consultation', amount: 2500 },
    { desc: 'Night / On-Call Doctor Emergency Visit', amount: 1800 },
  ],
  'Physiotherapy': [
    { desc: 'Chest Physiotherapy Session', amount: 700 },
    { desc: 'Limb & Mobility Rehab Session', amount: 900 },
    { desc: 'Post-Op Neuro / Gait Rehab', amount: 1200 },
  ],
  'Emergency Services': [
    { desc: 'Emergency ER Triage & Resuscitation', amount: 3500 },
    { desc: 'Emergency Defibrillation / CPR', amount: 5000 },
    { desc: 'Emergency Stomach Wash / Gastric Lavage', amount: 2500 },
  ],
  'Ambulance': [
    { desc: 'Basic Life Support (BLS) Ambulance Transit', amount: 2000 },
    { desc: 'Advanced Life Support (ALS / ICU) Ambulance', amount: 4500 },
    { desc: 'Inter-Hospital Patient Transfer', amount: 3500 },
  ],
  'Blood Bank': [
    { desc: 'Packed Red Blood Cells (PRBC) - 1 Unit', amount: 3500 },
    { desc: 'Fresh Frozen Plasma (FFP) - 1 Unit', amount: 1800 },
    { desc: 'Single Donor Platelets (SDP) - 1 Unit', amount: 11000 },
    { desc: 'Random Donor Platelets (RDP) - 1 Unit', amount: 2000 },
  ],
  'Other': [
    { desc: 'Hospital Admission & Registration Fee', amount: 500 },
    { desc: 'Inpatient Diet & Nutrition (Per Day)', amount: 600 },
    { desc: 'Bio-Medical Waste Disposal Charge', amount: 200 },
    { desc: 'Medical Certificate / Documentation Fee', amount: 300 },
  ]
};

// Seed helper function
async function seedDefaultCharges(hospitalId: any) {
  const chargesToInsert: any[] = [];
  for (const [category, items] of Object.entries(DEFAULT_CHARGES_PRESETS)) {
    for (const item of items) {
      chargesToInsert.push({
        hospital: hospitalId,
        category,
        description: item.desc,
        amount: item.amount,
        isActive: true
      });
    }
  }
  return await HospitalCharge.insertMany(chargesToInsert);
}

// GET /hospital/charges
export const getCharges = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    let charges = await HospitalCharge.find({ hospital: hospitalId }).sort({ category: 1, createdAt: 1 });
    
    // Auto-seed on first fetch
    if (charges.length === 0) {
      await seedDefaultCharges(hospitalId);
      charges = await HospitalCharge.find({ hospital: hospitalId }).sort({ category: 1, createdAt: 1 });
    }

    return res.status(200).json({ success: true, data: charges });
  } catch (error: any) {
    console.error('Error getting charges:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /hospital/charges
export const createCharge = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const { category, description, amount, isActive } = req.body;
    if (!category || !description || amount === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields: category, description, amount' });
    }

    // Check duplication
    const existing = await HospitalCharge.findOne({
      hospital: hospitalId,
      category: category.trim(),
      description: description.trim()
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'A charge with this description already exists in this category' });
    }

    const newCharge = new HospitalCharge({
      hospital: hospitalId,
      category: category.trim(),
      description: description.trim(),
      amount,
      isActive: isActive !== undefined ? isActive : true
    });

    await newCharge.save();
    return res.status(201).json({ success: true, data: newCharge });
  } catch (error: any) {
    console.error('Error creating charge:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /hospital/charges/:id
export const updateCharge = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const updatedCharge = await HospitalCharge.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedCharge) {
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    return res.status(200).json({ success: true, data: updatedCharge });
  } catch (error: any) {
    console.error('Error updating charge:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /hospital/charges/:id
export const deleteCharge = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const deletedCharge = await HospitalCharge.findOneAndDelete({
      _id: req.params.id,
      hospital: hospitalId
    });

    if (!deletedCharge) {
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    return res.status(200).json({ success: true, message: 'Charge deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting charge:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /hospital/charges/reset
export const resetCharges = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    // Delete existing custom charges
    await HospitalCharge.deleteMany({ hospital: hospitalId });
    // Seed default presets
    await seedDefaultCharges(hospitalId);

    const charges = await HospitalCharge.find({ hospital: hospitalId }).sort({ category: 1, createdAt: 1 });
    return res.status(200).json({ success: true, message: 'Charges reset to default presets', data: charges });
  } catch (error: any) {
    console.error('Error resetting charges:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
