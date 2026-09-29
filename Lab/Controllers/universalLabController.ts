import { Request, Response } from "express";
import UniversalLabTest from "../Models/UniversalLabTest.js";
import UniversalTestParameter from "../Models/UniversalTestParameter.js";
import { universalSeedData, MASTER_LIBRARY_VERSION } from "../data/universalSeedData.js";

/**
 * Super Admin APIs for managing the Universal Laboratory Master Library
 */

// GET /lab/universal/tests
export const getUniversalTests = async (req: Request, res: Response) => {
  try {
    const { department, search, limit = 50, page = 1 } = req.query;
    const query: any = { isActive: true };

    if (department) {
      query.departmentName = department;
    }

    if (search) {
      query.$text = { $search: String(search) };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const tests = await UniversalLabTest.find(query)
      .sort({ departmentName: 1, displayOrder: 1, testName: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await UniversalLabTest.countDocuments(query);

    res.json({
      success: true,
      data: tests,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /lab/universal/tests/:id
export const getUniversalTestById = async (req: Request, res: Response) => {
  try {
    const test = await UniversalLabTest.findById(req.params.id).lean();
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }

    const parameters = await UniversalTestParameter.find({
      universalTestId: test._id,
      isActive: true,
    })
      .sort({ displayOrder: 1 })
      .lean();

    res.json({ success: true, data: { ...test, parameters } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /lab/universal/tests
export const createUniversalTest = async (req: Request, res: Response) => {
  try {
    const { parameters, ...testData } = req.body;

    // Basic validation
    if (!testData.testCode || !testData.testName || !testData.departmentName) {
      return res.status(400).json({
        success: false,
        message: "testCode, testName, and departmentName are required",
      });
    }

    // Check code uniqueness
    const existing = await UniversalLabTest.findOne({ testCode: testData.testCode });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Test code ${testData.testCode} already exists`,
      });
    }

    const newTest = await UniversalLabTest.create(testData);

    let createdParams: any[] = [];
    if (parameters && Array.isArray(parameters)) {
      const paramsToCreate = parameters.map((p, idx) => ({
        ...p,
        universalTestId: newTest._id,
        displayOrder: p.displayOrder ?? idx,
      }));
      createdParams = await UniversalTestParameter.insertMany(paramsToCreate);
    }

    res.status(201).json({
      success: true,
      message: "Universal test created successfully",
      data: { test: newTest, parameters: createdParams },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /lab/universal/tests/:id
export const updateUniversalTest = async (req: Request, res: Response) => {
  try {
    const { parameters, ...testData } = req.body;
    const testId = req.params.id;

    const test = await UniversalLabTest.findByIdAndUpdate(
      testId,
      { $set: testData },
      { new: true, runValidators: true }
    );

    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }

    // If parameters provided, completely replace them for simplicity
    if (parameters && Array.isArray(parameters)) {
      await UniversalTestParameter.deleteMany({ universalTestId: testId });
      const paramsToCreate = parameters.map((p, idx) => ({
        ...p,
        universalTestId: test._id,
        displayOrder: p.displayOrder ?? idx,
      }));
      await UniversalTestParameter.insertMany(paramsToCreate);
    }

    res.json({ success: true, message: "Universal test updated successfully", data: test });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /lab/universal/tests/:id
export const deleteUniversalTest = async (req: Request, res: Response) => {
  try {
    const testId = req.params.id;
    const test = await UniversalLabTest.findByIdAndDelete(testId);
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }
    await UniversalTestParameter.deleteMany({ universalTestId: testId });
    res.json({ success: true, message: "Universal test deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- SEED SYSTEM ENDPOINTS ---

// GET /lab/universal/seed/status
export const getSeedStatus = async (req: Request, res: Response) => {
  try {
    const totalTests = await UniversalLabTest.countDocuments();
    const totalParameters = await UniversalTestParameter.countDocuments();
    const tests = await UniversalLabTest.find({}, { departmentName: 1, resultType: 1 }).lean();
    
    const departments = new Set(tests.map(t => t.departmentName));
    const totalProfiles = tests.filter(t => t.resultType === 'multiple').length;

    res.json({
      success: true,
      data: {
        version: MASTER_LIBRARY_VERSION,
        totalTests,
        totalParameters,
        totalDepartments: departments.size,
        totalProfiles,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /lab/universal/seed/sync
export const syncUniversalSeed = async (req: Request, res: Response) => {
  try {
    let testsAdded = 0;
    let parametersAdded = 0;

    for (const seed of universalSeedData) {
      const { parameters, ...testData } = seed;
      
      let test = await UniversalLabTest.findOne({ testCode: testData.testCode });
      
      if (!test) {
        // Create missing test
        test = await UniversalLabTest.create(testData);
        testsAdded++;
      }
      
      // Sync parameters (Add missing ones, do not overwrite existing if they were manually edited)
      if (parameters && Array.isArray(parameters)) {
        for (const p of parameters) {
          const existingParam = await UniversalTestParameter.findOne({ 
            universalTestId: test._id,
            name: p.name
          });
          
          if (!existingParam) {
            await UniversalTestParameter.create({
              ...p,
              universalTestId: test._id
            });
            parametersAdded++;
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Sync complete. Added ${testsAdded} tests and ${parametersAdded} parameters.`,
      data: { testsAdded, parametersAdded }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /lab/universal/seed/reset
export const resetUniversalSeed = async (req: Request, res: Response) => {
  try {
    // 1. Delete ALL existing tests and parameters
    await UniversalLabTest.deleteMany({});
    await UniversalTestParameter.deleteMany({});

    let testsAdded = 0;
    let parametersAdded = 0;

    // 2. Recreate from seed
    for (const seed of universalSeedData) {
      const { parameters, ...testData } = seed;
      
      const newTest = await UniversalLabTest.create(testData);
      testsAdded++;

      if (parameters && Array.isArray(parameters)) {
        const paramsToCreate = parameters.map((p, idx) => ({
          ...p,
          universalTestId: newTest._id,
          displayOrder: p.displayOrder ?? idx,
        }));
        await UniversalTestParameter.insertMany(paramsToCreate);
        parametersAdded += paramsToCreate.length;
      }
    }

    res.json({
      success: true,
      message: `Full reset complete. Created ${testsAdded} tests and ${parametersAdded} parameters from ${MASTER_LIBRARY_VERSION}.`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
