import { Request, Response } from 'express';
import LabOrder from '../Models/LabOrder.js';
import DirectLabOrder from '../Models/DirectLabOrder.js';
import Hospital from '../../Hospital/Models/Hospital.js';
import LabSettings from '../Models/LabSettings.js';

/**
 * Generate HTML report for a lab order
 * @route GET /api/lab/reports/:orderId
 */
export const generateLabReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sampleId: orderId } = req.params;

    // Fetch the order with populated data
    const order = await LabOrder.findById(orderId)
      .populate('hospital', 'name address phone email logo')
      .populate('patient', 'name age gender mobile')
      .populate('tests.test', 'name code department price unit method normalRange normalRanges')
      .lean();

    if (!order) {
      res.status(404).json({ message: 'Lab order not found' });
      return;
    }

    // Check if order is ready for report
    if (order.status !== 'completed' && order.status !== 'processing') {
      res.status(400).json({
        message: 'Order is not ready for report generation',
        status: order.status
      });
      return;
    }

    // Get hospital/lab information
    // Get Lab Settings
    const settings = await LabSettings.findOne();

    const hospital = order.hospital as any;
    const labInfo = {
      name: settings?.name || hospital?.name || 'MS Cure Chain Laboratory',
      tagline: settings?.tagline || 'Advanced Diagnostic Services',
      address: settings?.address || hospital?.address || 'Laboratory Address',
      phone: settings?.phone || hospital?.phone || '+91 1234567890',
      email: settings?.email || hospital?.email || 'lab@mscurechain.com',
      logoUrl: settings?.logo || hospital?.logo || undefined
    };

    // Transform order to sample-like structure for report
    const patient = order.patient as any;
    const sampleData = {
      _id: order._id,
      sampleId: order.tokenNumber || order._id.toString().slice(-6),
      patientDetails: {
        name: patient?.name || 'Unknown Patient',
        age: patient?.age || 0,
        gender: patient?.gender || 'Unknown',
        mobile: patient?.mobile || 'N/A',
        patientId: patient?._id?.toString() || 'N/A'
      },
      tests: order.tests.map((testItem: any) => {
        const testData = testItem.test;
        return {
          testName: testData?.name || 'Unknown Test',
          testCode: testData?.code || 'N/A',
          departmentName: testData?.department || 'General',
          price: testData?.price || 0,
          unit: testData?.unit || '',
          method: testData?.method || 'N/A',
          resultValue: testItem.result || '',
          normalRange: testData?.normalRange || '',
          normalRanges: testData?.normalRanges || null,
          remarks: testItem.remarks || '',
          isAbnormal: testItem.isAbnormal || false,
          subTests: testItem.subTests || []
        };
      }),
      sampleType: 'Blood',
      reportDate: order.completedAt || new Date(),
      referredBy: 'Self'
    };

    // Generate HTML report
    const reportHtml = generateReportHTML(sampleData, labInfo);

    // Return HTML
    res.setHeader('Content-Type', 'text/html');
    res.send(reportHtml);

  } catch (error) {
    console.error('Error generating lab report:', error);
    res.status(500).json({ message: 'Failed to generate report', error });
  }
};

/**
 * Generate report with billing details
 * @route GET /api/lab/reports/:orderId/with-billing
 */
export const generateReportWithBilling = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sampleId: orderId } = req.params;

    const order = await LabOrder.findById(orderId)
      .populate('hospital', 'name address phone email logo')
      .populate('patient', 'name age gender mobile')
      .populate('tests.test', 'name code department price unit method normalRange normalRanges')
      .lean();

    if (!order) {
      res.status(404).json({ message: 'Lab order not found' });
      return;
    }

    // Get Lab Settings
    const settings = await LabSettings.findOne();

    const hospital = order.hospital as any;
    const labInfo = {
      name: settings?.name || hospital?.name || 'MS Cure Chain Laboratory',
      tagline: settings?.tagline || 'Advanced Diagnostic Services',
      address: settings?.address || hospital?.address || 'Laboratory Address',
      phone: settings?.phone || hospital?.phone || '+91 1234567890',
      email: settings?.email || hospital?.email || 'lab@mscurechain.com',
      logoUrl: settings?.logo || hospital?.logo || undefined
    };

    // Transform order to sample structure
    const patient = order.patient as any;
    const sampleData = {
      _id: order._id,
      sampleId: order.tokenNumber || order._id.toString().slice(-6),
      patientDetails: {
        name: patient?.name || 'Unknown Patient',
        age: patient?.age || 0,
        gender: patient?.gender || 'Unknown',
        mobile: patient?.mobile || 'N/A',
        patientId: patient?._id?.toString() || 'N/A'
      },
      tests: order.tests.map((testItem: any) => {
        const testData = testItem.test;
        return {
          testName: testData?.name || 'Unknown Test',
          testCode: testData?.code || 'N/A',
          departmentName: testData?.department || 'General',
          price: testData?.price || 0,
          unit: testData?.unit || '',
          method: testData?.method || 'N/A',
          resultValue: testItem.result || '',
          normalRange: testData?.normalRange || '',
          normalRanges: testData?.normalRanges || null,
          remarks: testItem.remarks || '',
          isAbnormal: testItem.isAbnormal || false,
          subTests: testItem.subTests || []
        };
      }),
      sampleType: 'Blood',
      reportDate: order.completedAt || new Date(),
      referredBy: 'Self'
    };

    // Calculate billing summary
    const totalAmount = order.totalAmount || 0;
    const discount = 0; // Can be calculated based on business logic
    const finalAmount = totalAmount - discount;

    // Generate HTML with billing
    const reportHtml = generateReportWithBillingHTML(sampleData, labInfo, {
      totalAmount,
      discount,
      finalAmount
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(reportHtml);

  } catch (error) {
    console.error('Error generating report with billing:', error);
    res.status(500).json({ message: 'Failed to generate report', error });
  }
};

/**
 * Internal function to generate HTML report
 */
function generateReportHTML(sample: any, labInfo: any): string {
  const testTitle = sample.tests.map((t: any) => t.testName).join(', ');
  const testResultsRows = generateTestResultsRows(sample);
  const interpretation = generateInterpretation(sample);

  const logoHtml = labInfo.logoUrl
    ? `<img src="${labInfo.logoUrl}" alt="${labInfo.name}" />`
    : `<div style="width:100%;height:100%;background:#0a5aa8;color:white;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:bold;border-radius:8px;">${labInfo.name.charAt(0)}</div>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Lab Report - ${testTitle}</title>
  <style>
    body {
      font-family: "Segoe UI", Arial, sans-serif;
      background: #ffffff;
      padding: 20px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report {
      position: relative;
      max-width: 800px;
      margin: auto;
      background: #ffffff;
      padding: 30px;
      border: 2px solid #000;
    }
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: 70px;
      color: rgba(0, 0, 0, 0.06);
      font-weight: 700;
      letter-spacing: 4px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 0;
    }
    .header {
      display: flex;
      align-items: center;
      border-bottom: 3px solid #0a5aa8;
      padding-bottom: 15px;
      position: relative;
      z-index: 1;
    }
    .logo {
      width: 80px;
      height: 80px;
      margin-right: 15px;
    }
    .logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .lab-details {
      flex: 1;
    }
    .lab-name {
      font-size: 28px;
      font-weight: 700;
      color: #0a5aa8;
    }
    .lab-tagline {
      font-size: 14px;
      color: #555;
    }
    .lab-address {
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    }
    .patient-info {
      display: flex;
      justify-content: space-between;
      margin: 25px 0;
      font-size: 14px;
      position: relative;
      z-index: 1;
    }
    .patient-info div {
      width: 48%;
      line-height: 1.6;
    }
    h2 {
      text-align: center;
      margin: 25px 0 15px;
      font-size: 22px;
      border-bottom: 2px solid #ddd;
      padding-bottom: 6px;
      position: relative;
      z-index: 1;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      position: relative;
      z-index: 1;
    }
    th, td {
      border: 1px solid #d0d0d0;
      padding: 8px 10px;
    }
    th {
      background: #f2f6fb;
      text-align: left;
      font-weight: 600;
    }
    .high {
      color: #d93025;
      font-weight: 600;
    }
    .footer {
      margin-top: 25px;
      font-size: 13px;
      line-height: 1.6;
      position: relative;
      z-index: 1;
    }
    .end {
      text-align: center;
      margin-top: 20px;
      font-weight: bold;
      position: relative;
      z-index: 1;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .report { border: none; }
    }
  </style>
</head>
<body>
  <div class="report">
    <div class="watermark">${labInfo.name}</div>
    <div class="header">
      <div class="logo">${logoHtml}</div>
      <div class="lab-details">
        <div class="lab-name">${labInfo.name}</div>
        <div class="lab-tagline">${labInfo.tagline}</div>
        <div class="lab-address">
          ${labInfo.address}<br>
          Phone: ${labInfo.phone} | Email: ${labInfo.email}
        </div>
      </div>
    </div>
    <div class="patient-info">
      <div>
        <strong>Patient Name:</strong> ${sample.patientDetails.name}<br>
        <strong>Age / Sex:</strong> ${sample.patientDetails.age} Years / ${sample.patientDetails.gender}<br>
        <strong>Patient ID:</strong> ${sample.patientDetails.patientId || 'N/A'}
      </div>
      <div>
        <strong>Sample Collected At:</strong> ${sample.sampleType || 'Lab Collection'}<br>
        <strong>Referred By:</strong> Dr. ${sample.referredBy || 'Self'}<br>
        <strong>Report Date:</strong> ${sample.reportDate ? new Date(sample.reportDate).toLocaleDateString() : new Date().toLocaleDateString()}
      </div>
    </div>
    <h2>${testTitle}</h2>
    <table>
      <tr>
        <th>Investigation</th>
        <th>Result</th>
        <th>Unit</th>
        <th>Reference Range</th>
      </tr>
      ${testResultsRows}
    </table>
    <div class="footer">
      <strong>Interpretation:</strong> ${interpretation}
    </div>
    <div class="end">**** End of Report ****</div>
  </div>
</body>
</html>`;
}

/**
 * Generate HTML with billing information
 */
function generateReportWithBillingHTML(sample: any, labInfo: any, billing: any): string {
  const baseReport = generateReportHTML(sample, labInfo);

  const billingSection = `
    <div style="margin-top: 30px; padding: 20px; border: 2px solid #0a5aa8; border-radius: 8px; position: relative; z-index: 1;">
      <h3 style="margin: 0 0 15px; color: #0a5aa8; text-align: center;">Billing Summary</h3>
      <table style="width: 100%; border: none;">
        <tr>
          <td style="border: none; padding: 8px;"><strong>Total Amount:</strong></td>
          <td style="border: none; padding: 8px; text-align: right;">₹${billing.totalAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="border: none; padding: 8px;"><strong>Discount:</strong></td>
          <td style="border: none; padding: 8px; text-align: right;">₹${billing.discount.toFixed(2)}</td>
        </tr>
        <tr style="border-top: 2px solid #0a5aa8;">
          <td style="border: none; padding: 8px;"><strong>Final Amount:</strong></td>
          <td style="border: none; padding: 8px; text-align: right; font-size: 18px; color: #0a5aa8;"><strong>₹${billing.finalAmount.toFixed(2)}</strong></td>
        </tr>
      </table>
    </div>`;

  return baseReport.replace('</div>\n</body>', `${billingSection}\n  </div>\n</body>`);
}

/**
 * Generate test results rows for the table
 */
function generateTestResultsRows(sample: any): string {
  let rows = '';

  for (const test of sample.tests) {
    if (test.resultValue) {
      const resultClass = test.isAbnormal ? 'high' : '';
      const range = getDisplayRange(test, sample);

      rows += `
      <tr>
        <td><strong>${test.testName}</strong></td>
        <td class="${resultClass}">${test.resultValue}</td>
        <td>${test.unit || '-'}</td>
        <td>${range}</td>
      </tr>`;
    }

    if (test.subTests && test.subTests.length > 0) {
      for (const subTest of test.subTests) {
        if (subTest.name && subTest.result) {
          rows += `
      <tr>
        <td style="padding-left: 30px;">${subTest.name}</td>
        <td>${subTest.result}</td>
        <td>${subTest.unit || '-'}</td>
        <td>${subTest.range || '-'}</td>
      </tr>`;
        }
      }
    }

    if (test.remarks) {
      rows += `
      <tr>
        <td colspan="4" style="font-style: italic; color: #666;">
          <strong>Remarks:</strong> ${test.remarks}
        </td>
      </tr>`;
    }
  }

  return rows;
}

/**
 * Get display range based on patient demographics
 */
function getDisplayRange(test: any, sample: any): string {
  if (!test.normalRanges) return test.normalRange || 'N/A';

  const { age, gender } = sample.patientDetails;
  const ranges = test.normalRanges;
  let range;

  if (age === 0) {
    range = ranges.newborn || ranges.infant;
  } else if (age < 1) {
    range = ranges.infant;
  } else if (age < 12) {
    range = ranges.child;
  } else if (age > 60) {
    range = ranges.geriatric;
  } else if (gender?.toLowerCase() === 'male') {
    range = ranges.male;
  } else {
    range = ranges.female;
  }

  if (!range) {
    range = gender?.toLowerCase() === 'male' ? ranges.male : ranges.female;
  }

  if (range) {
    if (range.text) return range.text;
    if (range.min !== undefined || range.max !== undefined) {
      return `${range.min || ''} - ${range.max || ''}`;
    }
  }

  return test.normalRange || 'N/A';
}

/**
 * Generate interpretation text
 */
function generateInterpretation(sample: any): string {
  const abnormalTests = sample.tests.filter((t: any) => t.isAbnormal);

  if (abnormalTests.length === 0) {
    return 'All parameters are within normal limits.';
  }

  const abnormalNames = abnormalTests.map((t: any) => t.testName).join(', ');
  return `Abnormal values detected in: ${abnormalNames}. Please correlate clinically and consult with your physician for further evaluation.`;
}

/**
 * Generate HTML report for a walk-in patient lab order
 * @route GET /api/lab/walk-in/reports/:orderId
 */
export const generateWalkInLabReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;

    // Fetch the order with populated data
    const order = await DirectLabOrder.findById(orderId)
      .populate('hospital', 'name address phone email logo')
      .populate('walkInPatient')
      .populate('tests.test', 'name code department price unit method normalRange normalRanges')
      .lean();

    if (!order) {
      res.status(404).json({ message: 'Lab order not found' });
      return;
    }

    // Check if order is ready for report
    if (order.status !== 'completed' && order.status !== 'processing') {
      res.status(400).json({
        message: 'Order is not ready for report generation',
        status: order.status
      });
      return;
    }

    // Get hospital/lab information
    // Get Lab Settings
    const settings = await LabSettings.findOne();

    const hospital = order.hospital as any;
    const labInfo = {
      name: settings?.name || hospital?.name || 'MS Cure Chain Laboratory',
      tagline: settings?.tagline || 'Advanced Diagnostic Services',
      address: settings?.address || hospital?.address || 'Laboratory Address',
      phone: settings?.phone || hospital?.phone || '+91 1234567890',
      email: settings?.email || hospital?.email || 'lab@mscurechain.com',
      logoUrl: settings?.logo || hospital?.logo || undefined
    };

    // Transform order to sample-like structure for report
    const patient = order.walkInPatient as any;
    const sampleData = {
      _id: order._id,
      sampleId: order.orderNumber || order._id.toString().slice(-6),
      patientDetails: {
        name: patient?.name || 'Unknown Patient',
        age: patient?.age || 0,
        gender: patient?.gender || 'Unknown',
        mobile: patient?.mobile || 'N/A',
        patientId: patient?.registrationId || 'N/A'
      },
      tests: order.tests.map((testItem: any) => {
        const testData = testItem.test;
        return {
          testName: testData?.name || 'Unknown Test',
          testCode: testData?.code || 'N/A',
          departmentName: testData?.department || 'General',
          price: testData?.price || 0,
          unit: testData?.unit || '',
          method: testData?.method || 'N/A',
          resultValue: testItem.result || '',
          normalRange: testData?.normalRange || '',
          normalRanges: testData?.normalRanges || null,
          remarks: testItem.remarks || '',
          isAbnormal: testItem.isAbnormal || false,
          subTests: testItem.subTests || []
        };
      }),
      sampleType: order.sampleType || 'Blood',
      reportDate: order.reportGeneratedAt || order.completedAt || new Date(),
      referredBy: order.referredBy || 'Self'
    };

    // Generate HTML report
    const reportHtml = generateReportHTML(sampleData, labInfo);

    // Update report generated timestamp
    await DirectLabOrder.findByIdAndUpdate(orderId, {
      reportGeneratedAt: new Date()
    });

    // Return HTML
    res.setHeader('Content-Type', 'text/html');
    res.send(reportHtml);

  } catch (error) {
    console.error('Error generating walk-in lab report:', error);
    res.status(500).json({ message: 'Failed to generate report', error });
  }
};

/**
 * Generate report with billing for walk-in patient
 * @route GET /api/lab/walk-in/reports/:orderId/with-billing
 */
export const generateWalkInReportWithBilling = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;

    const order = await DirectLabOrder.findById(orderId)
      .populate('hospital', 'name address phone email logo')
      .populate('walkInPatient')
      .populate('tests.test', 'name code department price unit method normalRange normalRanges')
      .lean();

    if (!order) {
      res.status(404).json({ message: 'Lab order not found' });
      return;
    }

    // Get Lab Settings
    const settings = await LabSettings.findOne();

    const hospital = order.hospital as any;
    const labInfo = {
      name: settings?.name || hospital?.name || 'MS Cure Chain Laboratory',
      tagline: settings?.tagline || 'Advanced Diagnostic Services',
      address: settings?.address || hospital?.address || 'Laboratory Address',
      phone: settings?.phone || hospital?.phone || '+91 1234567890',
      email: settings?.email || hospital?.email || 'lab@mscurechain.com',
      logoUrl: settings?.logo || hospital?.logo || undefined
    };

    // Transform order to sample structure
    const patient = order.walkInPatient as any;
    const sampleData = {
      _id: order._id,
      sampleId: order.orderNumber || order._id.toString().slice(-6),
      patientDetails: {
        name: patient?.name || 'Unknown Patient',
        age: patient?.age || 0,
        gender: patient?.gender || 'Unknown',
        mobile: patient?.mobile || 'N/A',
        patientId: patient?.registrationId || 'N/A'
      },
      tests: order.tests.map((testItem: any) => {
        const testData = testItem.test;
        return {
          testName: testData?.name || 'Unknown Test',
          testCode: testData?.code || 'N/A',
          departmentName: testData?.department || 'General',
          price: testData?.price || 0,
          unit: testData?.unit || '',
          method: testData?.method || 'N/A',
          resultValue: testItem.result || '',
          normalRange: testData?.normalRange || '',
          normalRanges: testData?.normalRanges || null,
          remarks: testItem.remarks || '',
          isAbnormal: testItem.isAbnormal || false,
          subTests: testItem.subTests || []
        };
      }),
      sampleType: order.sampleType || 'Blood',
      reportDate: order.reportGeneratedAt || order.completedAt || new Date(),
      referredBy: order.referredBy || 'Self'
    };

    // Calculate billing summary
    const totalAmount = order.totalAmount || 0;
    const discount = order.discount || 0;
    const finalAmount = order.finalAmount || 0;

    // Generate HTML with billing
    const reportHtml = generateReportWithBillingHTML(sampleData, labInfo, {
      totalAmount,
      discount,
      finalAmount
    });

    // Update report generated timestamp
    await DirectLabOrder.findByIdAndUpdate(orderId, {
      reportGeneratedAt: new Date()
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(reportHtml);

  } catch (error) {
    console.error('Error generating walk-in report with billing:', error);
    res.status(500).json({ message: 'Failed to generate report', error });
  }
};
