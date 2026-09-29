
fetch('http://localhost:5002/api/health')
    .then(res => res.json())
    .then(data => console.log('Health Check:', data))
    .catch(err => console.error('Health Check Failed:', err));
