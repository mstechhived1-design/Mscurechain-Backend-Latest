async function test() {
    try {
        const payload = {
            patientDetails: {
                name: "BABY OF DURGA",
                mobile: "N/A",
                age: 2,
                ageUnit: "Years",
                gender: "Unknown"
            },
            items: [
                { testName: "TSH" },
                { testName: "BLOOD GROUPING,RH TYPE" }
            ],
            totalAmount: 400,
            finalAmount: 400,
            paymentMode: "cash",
            paidAmount: 400,
            balance: 0
        };

        const res = await fetch('http://localhost:5003/api/helpdesk/lab-orders', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                // bypassing auth because I modified the route to just be `router.post("/lab-orders", createLabOrder);` temporarily!
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log("Response:", res.status, data);
    } catch (err) {
        console.error(err);
    }
}
test();
