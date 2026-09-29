import { Request, Response } from 'express';
import { HospitalPackage } from '../../Hospital/Models/HospitalPackage.js';
import { getCurrentTenantId } from '../../middleware/tenantMiddleware.js';

export const createPackage = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const newPackage = new HospitalPackage({
      ...req.body,
      hospital: hospitalId
    });

    await newPackage.save();
    return res.status(201).json({ success: true, data: newPackage });
  } catch (error: any) {
    console.error('Error creating package:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPackages = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const filter: any = { hospital: hospitalId };
    if (req.query.activeOnly === 'true') {
      filter.isActive = true;
    }

    const packages = await HospitalPackage.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: packages });
  } catch (error: any) {
    console.error('Error getting packages:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePackage = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const updatedPackage = await HospitalPackage.findOneAndUpdate(
      { _id: req.params.id, hospital: hospitalId },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedPackage) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    return res.status(200).json({ success: true, data: updatedPackage });
  } catch (error: any) {
    console.error('Error updating package:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePackage = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const deletedPackage = await HospitalPackage.findOneAndDelete({
      _id: req.params.id,
      hospital: hospitalId
    });

    if (!deletedPackage) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    return res.status(200).json({ success: true, message: 'Package deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting package:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const togglePackageStatus = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const pkg = await HospitalPackage.findOne({ _id: req.params.id, hospital: hospitalId });
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    pkg.isActive = !pkg.isActive;
    await pkg.save();

    return res.status(200).json({ success: true, data: pkg });
  } catch (error: any) {
    console.error('Error toggling package status:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const submitPackageBill = async (req: Request, res: Response) => {
  try {
    const hospitalId = getCurrentTenantId(req);
    if (!hospitalId) {
      return res.status(400).json({ success: false, message: 'Hospital context required' });
    }

    const { patientId, packageId, paymentMethod, items } = req.body;
    if (!patientId || !packageId) {
      return res.status(400).json({ success: false, message: 'patientId and packageId are required' });
    }

    const pkg = await HospitalPackage.findOne({ _id: packageId, hospital: hospitalId });
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    // Import Transaction model
    const { default: Transaction } = await import('../../Admin/Models/Transaction.js');

    const transaction = new Transaction({
      user: patientId,
      userModel: 'Patient',
      hospital: hospitalId,
      amount: pkg.totalPrice,
      type: 'package',
      status: 'completed',
      referenceId: pkg._id,
      date: new Date(),
      paymentMode: paymentMethod || 'cash',
      paidAmount: pkg.totalPrice,
      balance: 0,
    });

    await transaction.save();

    return res.status(201).json({
      success: true,
      message: `Package "${pkg.name}" billed successfully`,
      data: {
        transaction,
        packageName: pkg.name,
        breakdown: pkg.breakdown,
        totalPrice: pkg.totalPrice,
      },
    });
  } catch (error: any) {
    console.error('Error submitting package bill:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
