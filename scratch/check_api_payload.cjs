const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5003, // Backend port
  path: '/api/ipd/beds/69a8fd211629c151458c3608', // The current bed ID from our DB check
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const parsed = JSON.parse(data);
    console.log(JSON.stringify(parsed.data.occupancyDetails.bedHistory, null, 2));
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});
req.end();
