// Native fetch is used

const BASE_URL = 'http://localhost:5003/api';

async function runConcurrencyTest() {
  console.log("Starting concurrency test...");

  try {
    // 1. Login to Helpdesk
    const loginRes = await fetch(`${BASE_URL}/helpdesk/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': 'dummy_token',
        'Cookie': 'csrf_token=dummy_token'
      },
      body: JSON.stringify({ mobile: '6546546544', password: 'Mani@123' })
    });
    
    if (!loginRes.ok) {
      const errorText = await loginRes.text();
      throw new Error(`Login failed: ${loginRes.status} ${errorText}`);
    }
    
    const loginData = await loginRes.json();
    const token = loginData.accessToken;
    const csrfToken = loginData.csrfToken || 'dummy_token';
    
    if (!token) {
      throw new Error("No token received after login. Response: " + JSON.stringify(loginData));
    }
    console.log("Login successful. Token acquired.");

    // 2. Fetch a doctor to book with
    const docsRes = await fetch(`${BASE_URL}/helpdesk/doctors`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!docsRes.ok) {
      throw new Error(`Failed to fetch doctors: ${docsRes.status}`);
    }
    
    const docsData = await docsRes.json();
    const doctors = docsData.doctors || docsData.data || docsData;
    if (!doctors || doctors.length === 0) {
      throw new Error("No doctors found to book an appointment with.");
    }
    
    const targetDoctor = doctors[0];
    const doctorId = targetDoctor._id || targetDoctor.id;
    console.log(`Target Doctor selected: ${targetDoctor?.user?.name || 'Doctor'} (${doctorId})`);

    // 3. Prepare exactly the same appointment time for all 10 requests
    const appointmentDate = new Date();
    appointmentDate.setDate(appointmentDate.getDate() + 1); // Tomorrow
    const formattedDate = appointmentDate.toISOString().split('T')[0];
    const appointmentTime = "10:30 AM";

    console.log(`Attempting to book 10 concurrent appointments for: ${formattedDate} at ${appointmentTime}`);

    // 4. Register 10 patients sequentially to avoid MRN generation write conflicts
    console.log("Pre-registering 10 patients sequentially...");
    const patientIds = [];
    for (let i = 1; i <= 10; i++) {
      const randomPhone = `98765${Math.floor(10000 + Math.random() * 90000)}`;
      const reqBody = {
        name: `Test Patient ${i}`,
        mobile: randomPhone,
        gender: "male",
        age: 30,
        bloodGroup: "O+",
        // Omit doctorId/appointmentDate to only register
      };

      const res = await fetch(`${BASE_URL}/helpdesk/patients/register`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-csrf-token': csrfToken,
          'Cookie': `csrf_token=${csrfToken}`
        },
        body: JSON.stringify(reqBody)
      });
      
      const body = await res.json();
      if (res.ok && body.patient?._id) {
        patientIds.push(body.patient._id);
      } else {
        console.error(`Failed to register patient ${i}:`, body);
      }
    }

    console.log(`Successfully registered ${patientIds.length} patients.`);
    console.log(`Attempting to book 10 concurrent appointments for: ${formattedDate} at ${appointmentTime}`);

    // 5. Create 10 concurrent booking requests
    const tasks = patientIds.map((patientId, index) => {
      const reqBody = {
        patientId: patientId,
        doctorId: doctorId,
        date: formattedDate,
        time: appointmentTime,
        appointmentType: "OPD",
        paymentMethod: "cash"
      };

      return fetch(`${BASE_URL}/helpdesk/appointments`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-csrf-token': csrfToken,
          'Cookie': `csrf_token=${csrfToken}`
        },
        body: JSON.stringify(reqBody)
      }).then(async res => {
        const body = await res.json().catch(() => ({}));
        return { index: index + 1, status: res.status, body };
      }).catch(err => {
        return { index: index + 1, status: "Network/System Error", error: err.message };
      });
    });

    // 6. Execute all requests concurrently
    const results = await Promise.all(tasks);

    // 7. Analyze and output results
    console.log("\n--- CONCURRENCY TEST RESULTS ---");
    let successCount = 0;
    let conflictCount = 0;
    let otherErrorCount = 0;

    results.forEach(res => {
      if (res.status === 200 || res.status === 201) {
        successCount++;
        console.log(`Task ${res.index}: SUCCESS - Appointment Booked`);
      } else if (res.status === 400 && res.body?.message?.includes("booked by another patient")) {
        conflictCount++;
        console.log(`Task ${res.index}: FAILED - Concurrency conflict correctly triggered (${res.body.message})`);
      } else if (res.status === 400 && res.body?.message?.includes("already exists for this patient")) {
         conflictCount++;
         console.log(`Task ${res.index}: FAILED - Concurrency conflict correctly triggered (${res.body.message})`);
      } else {
        otherErrorCount++;
        console.log(`Task ${res.index}: FAILED - Other Error [${res.status}]:`, res.body || res.error);
      }
    });

    console.log("\n--- SUMMARY ---");
    console.log(`Total Requests: ${tasks.length}`);
    console.log(`Successful Bookings: ${successCount} (Should be exactly 1)`);
    console.log(`Concurrency Blocked: ${conflictCount} (Should be exactly ${tasks.length - 1})`);
    console.log(`Other Errors: ${otherErrorCount}`);

  } catch (error) {
    console.error("Test execution failed:", error);
  }
}

runConcurrencyTest();
