/**
 * 10-Minute Deep WhatsApp Connection Stability Monitor
 * Tests connection persistence, latency, state transitions, and drops for Horizin Hospital.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOSPITAL_ID = '69a7b003c84f8f6e66180872';
const DURATION_SECONDS = 600; // 10 minutes
const INTERVAL_SECONDS = 10;  // sample every 10s -> 60 samples
const PORT = 5003;

// Allowed test numbers from user
const ALLOWED_TEST_NUMBERS = [
  '9701800140',
  '8340964732',
  '6302237009',
  '9502425359'
];

function fetchEndpoint(urlPath) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(
      {
        host: 'localhost',
        port: PORT,
        path: urlPath,
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const latency = Date.now() - start;
          try {
            const data = JSON.parse(body);
            resolve({ success: true, statusCode: res.statusCode, data, latency });
          } catch (e) {
            resolve({ success: false, statusCode: res.statusCode, error: 'JSON parse error', latency });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({ success: false, error: err.message, latency: Date.now() - start });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout (>5000ms)', latency: Date.now() - start });
    });
  });
}

async function runMonitor() {
  console.log('='.repeat(80));
  console.log('  MSCURECHAIN 10-MINUTE WHATSAPP DEEP CONNECTION MONITOR');
  console.log(`  Target Hospital: Horizin Hospital (${HOSPITAL_ID})`);
  console.log(`  Duration: ${DURATION_SECONDS}s (${DURATION_SECONDS / 60} mins) | Interval: Every ${INTERVAL_SECONDS}s`);
  console.log(`  Allowed numbers (if dispatching): ${ALLOWED_TEST_NUMBERS.join(', ')}`);
  console.log('='.repeat(80));
  console.log('');

  const stats = {
    totalChecks: 0,
    main: {
      connected: 0,
      disconnected: 0,
      latencies: [],
      drops: [],
      lastStatus: null,
      number: null,
    },
    pharma: {
      connected: 0,
      disconnected: 0,
      latencies: [],
      drops: [],
      lastStatus: null,
      number: null,
    },
  };

  const startTime = Date.now();
  let sampleIndex = 0;

  const intervalId = setInterval(async () => {
    sampleIndex++;
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const remainingSec = Math.max(0, DURATION_SECONDS - elapsedSec);
    const timeStr = new Date().toLocaleTimeString();

    // Check Main Hospital and Dedicated Pharmacy status concurrently
    const [mainRes, pharmaRes] = await Promise.all([
      fetchEndpoint(`/api/hospital/${HOSPITAL_ID}/whatsapp/status`),
      fetchEndpoint(`/api/hospital/${HOSPITAL_ID}/whatsapp/status?department=pharma`),
    ]);

    stats.totalChecks++;

    // Process Main Status
    const mainConnected = mainRes.success && mainRes.data?.status === 'CONNECTED';
    const mainNum = mainRes.data?.connectedNumber || 'None';
    stats.main.number = mainNum;
    if (mainRes.latency) stats.main.latencies.push(mainRes.latency);

    if (mainConnected) {
      stats.main.connected++;
    } else {
      stats.main.disconnected++;
      if (stats.main.lastStatus === 'CONNECTED' || sampleIndex === 1) {
        stats.main.drops.push({ time: timeStr, elapsed: elapsedSec, reason: mainRes.error || mainRes.data?.status });
        console.warn(`  [!] ALERT: Main WhatsApp DROPPED at ${timeStr} (+${elapsedSec}s) -> ${mainRes.error || mainRes.data?.status}`);
      }
    }
    stats.main.lastStatus = mainRes.data?.status || 'ERROR';

    // Process Pharma Status
    const pharmaConnected = pharmaRes.success && pharmaRes.data?.status === 'CONNECTED';
    const pharmaNum = pharmaRes.data?.connectedNumber || 'None';
    stats.pharma.number = pharmaNum;
    if (pharmaRes.latency) stats.pharma.latencies.push(pharmaRes.latency);

    if (pharmaConnected) {
      stats.pharma.connected++;
    } else {
      stats.pharma.disconnected++;
      if (stats.pharma.lastStatus === 'CONNECTED' || sampleIndex === 1) {
        stats.pharma.drops.push({ time: timeStr, elapsed: elapsedSec, reason: pharmaRes.error || pharmaRes.data?.status });
        console.warn(`  [!] ALERT: Pharmacy WhatsApp DROPPED at ${timeStr} (+${elapsedSec}s) -> ${pharmaRes.error || pharmaRes.data?.status}`);
      }
    }
    stats.pharma.lastStatus = pharmaRes.data?.status || 'ERROR';

    // Log progress line
    const mainStatusIcon = mainConnected ? '🟢 CONNECTED' : '🔴 ' + stats.main.lastStatus;
    const pharmaStatusIcon = pharmaConnected ? '🟢 CONNECTED' : '🔴 ' + stats.pharma.lastStatus;
    
    console.log(
      `[#${String(sampleIndex).padStart(2, '0')}|+${String(elapsedSec).padStart(3, ' ')}s|rem:${String(remainingSec).padStart(3, ' ')}s] ` +
      `Main: ${mainStatusIcon} (+${mainNum}, ${mainRes.latency}ms) | ` +
      `Pharma: ${pharmaStatusIcon} (+${pharmaNum}, ${pharmaRes.latency}ms)`
    );

    // Stop when 10 minutes reached
    if (elapsedSec >= DURATION_SECONDS) {
      clearInterval(intervalId);
      printSummary(stats, elapsedSec);
    }
  }, INTERVAL_SECONDS * 1000);
}

function printSummary(stats, totalElapsed) {
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const min = (arr) => (arr.length ? Math.min(...arr) : 0);
  const max = (arr) => (arr.length ? Math.max(...arr) : 0);

  const mainUptime = stats.totalChecks ? ((stats.main.connected / stats.totalChecks) * 100).toFixed(2) : 0;
  const pharmaUptime = stats.totalChecks ? ((stats.pharma.connected / stats.totalChecks) * 100).toFixed(2) : 0;

  console.log('\n' + '='.repeat(80));
  console.log('  10-MINUTE DEEP STABILITY TEST COMPLETED');
  console.log('='.repeat(80));
  console.log(`  Total Duration Tested: ${totalElapsed} seconds (~${Math.round(totalElapsed / 60)} minutes)`);
  console.log(`  Total Heartbeat Checks: ${stats.totalChecks} checks per instance (every ${INTERVAL_SECONDS}s)`);
  console.log('');
  console.log(`  1. MAIN HOSPITAL WHATSAPP (+${stats.main.number})`);
  console.log(`     - Uptime:             ${mainUptime}% (${stats.main.connected}/${stats.totalChecks} checks healthy)`);
  console.log(`     - Drops Detected:     ${stats.main.drops.length}`);
  console.log(`     - Response Latency:   avg: ${avg(stats.main.latencies)}ms | min: ${min(stats.main.latencies)}ms | max: ${max(stats.main.latencies)}ms`);
  if (stats.main.drops.length > 0) {
    console.log(`     - Drop Events:`, JSON.stringify(stats.main.drops, null, 2));
  } else {
    console.log(`     - Verdict:            PERFECT (0 drops, 100% stable uninterrupted Baileys session)`);
  }
  console.log('');
  console.log(`  2. DEDICATED PHARMACY WHATSAPP (+${stats.pharma.number})`);
  console.log(`     - Uptime:             ${pharmaUptime}% (${stats.pharma.connected}/${stats.totalChecks} checks healthy)`);
  console.log(`     - Drops Detected:     ${stats.pharma.drops.length}`);
  console.log(`     - Response Latency:   avg: ${avg(stats.pharma.latencies)}ms | min: ${min(stats.pharma.latencies)}ms | max: ${max(stats.pharma.latencies)}ms`);
  if (stats.pharma.drops.length > 0) {
    console.log(`     - Drop Events:`, JSON.stringify(stats.pharma.drops, null, 2));
  } else {
    console.log(`     - Verdict:            PERFECT (0 drops, 100% stable uninterrupted Baileys session)`);
  }
  console.log('='.repeat(80));
  process.exit(0);
}

runMonitor().catch((err) => {
  console.error('Monitor run error:', err);
  process.exit(1);
});
