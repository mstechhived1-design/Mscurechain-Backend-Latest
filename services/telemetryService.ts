/**
 * SaaS Telemetry & Real-Time Performance Monitor
 * 
 * Provides:
 * - Sliding-window Global RPM, Average Latency, and API Error rates
 * - Daily Inbound/Outbound Data Transfer (TX/RX)
 * - Per-hospital Live Activity Matrix (RPM, data transfer, status, last ping)
 * - Time-series traffic history for real-time charting
 * - Live WebSocket/SSE connections integration
 */

import { Request, Response, NextFunction } from "express";

interface RequestRecord {
  timestamp: number;
  duration: number;
  statusCode: number;
  isError: boolean;
  hospitalId: string;
  bytesIn: number;
  bytesOut: number;
}

interface HospitalStats {
  hospitalId: string;
  name?: string;
  rpm: number;
  dailyBytesIn: number;
  dailyBytesOut: number;
  lastPing: number;
  status: "Active Now" | "Idle";
}

export interface HospitalLookupItem {
  hospitalId: string;
  name: string;
  mongoId?: string;
  aliases?: string[];
}

class TelemetryService {
  // 60-second sliding window for instantaneous RPM, Latency, Errors
  private recentRequests: RequestRecord[] = [];
  private readonly WINDOW_MS = 60_000;

  // 15-minute history buckets for RPM graph (1-minute intervals)
  private trafficHistory: { timestamp: string; rpm: number }[] = [];
  private lastHistoryBucket: number = 0;

  // Daily bandwidth tracking (resets daily)
  private currentDay: string = "";
  private dailyBytesIn: number = 0;
  private dailyBytesOut: number = 0;

  // Per-hospital daily stats
  private hospitalStatsMap: Map<string, {
    dailyBytesIn: number;
    dailyBytesOut: number;
    lastPing: number;
  }> = new Map();

  constructor() {
    this.currentDay = this.getTodayDateString();
    
    // Prune stale sliding window records every 5 seconds
    setInterval(() => {
      this.pruneOldRequests();
      this.updateTrafficHistory();
    }, 5000);
  }

  private getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private checkDayRollover() {
    const today = this.getTodayDateString();
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailyBytesIn = 0;
      this.dailyBytesOut = 0;
      this.hospitalStatsMap.clear();
    }
  }

  /**
   * Record an incoming request after it completes
   */
  public recordRequest(record: RequestRecord) {
    this.checkDayRollover();

    // 1. Add to sliding window
    this.recentRequests.push(record);

    // 2. Aggregate global daily bandwidth
    this.dailyBytesIn += record.bytesIn;
    this.dailyBytesOut += record.bytesOut;

    // 3. Aggregate per-hospital daily stats
    const hid = record.hospitalId || "global";
    const existing = this.hospitalStatsMap.get(hid) || {
      dailyBytesIn: 0,
      dailyBytesOut: 0,
      lastPing: record.timestamp,
    };

    existing.dailyBytesIn += record.bytesIn;
    existing.dailyBytesOut += record.bytesOut;
    existing.lastPing = record.timestamp;
    this.hospitalStatsMap.set(hid, existing);
  }

  /**
   * Remove records older than 60 seconds
   */
  private pruneOldRequests() {
    const cutoff = Date.now() - this.WINDOW_MS;
    this.recentRequests = this.recentRequests.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Format timestamp in 12-hour IST format (e.g., 06:39:19 pm)
   */
  private formatTimestampIST(timestampMs: number = Date.now()): string {
    return new Date(timestampMs).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).toLowerCase();
  }

  /**
   * Sample RPM every 10 seconds into a rolling 15-minute buffer
   */
  private updateTrafficHistory() {
    const now = Date.now();
    // Record bucket every 15 seconds
    if (now - this.lastHistoryBucket >= 15_000) {
      this.lastHistoryBucket = now;
      const rpm = this.getGlobalRPM();
      const timeStr = this.formatTimestampIST(now);

      this.trafficHistory.push({ timestamp: timeStr, rpm });

      // Keep maximum 60 data points (15 minutes of history)
      if (this.trafficHistory.length > 60) {
        this.trafficHistory.shift();
      }
    }
  }

  /**
   * Current global Requests Per Minute
   */
  public getGlobalRPM(): number {
    this.pruneOldRequests();
    return this.recentRequests.length;
  }

  /**
   * Current average latency in milliseconds (last 60s)
   */
  public getAvgLatency(): number {
    this.pruneOldRequests();
    if (this.recentRequests.length === 0) return 0;
    const sum = this.recentRequests.reduce((acc, r) => acc + r.duration, 0);
    return Math.round(sum / this.recentRequests.length);
  }

  /**
   * Total API errors (status >= 400) in the last 60s
   */
  public getApiErrors(): number {
    this.pruneOldRequests();
    return this.recentRequests.filter((r) => r.isError).length;
  }

  /**
   * Daily payload bandwidth formatted
   */
  public getDailyTransfer() {
    this.checkDayRollover();
    const totalBytes = this.dailyBytesIn + this.dailyBytesOut;
    return {
      bytesIn: this.dailyBytesIn,
      bytesOut: this.dailyBytesOut,
      totalBytes,
      formattedTotal: this.formatBytes(totalBytes),
      formattedIn: this.formatBytes(this.dailyBytesIn),
      formattedOut: this.formatBytes(this.dailyBytesOut),
    };
  }

  /**
   * Telemetry chart time-series data
   */
  public getTrafficHistory() {
    // If empty or initial, return current point
    if (this.trafficHistory.length === 0) {
      const now = this.formatTimestampIST();
      return [{ timestamp: now, rpm: this.getGlobalRPM() }];
    }
    // Ensure all timestamps are formatted in 12-hour IST format
    return this.trafficHistory.map((item) => {
      let ts = item.timestamp;
      if (!/am|pm/i.test(ts)) {
        const parts = ts.split(":");
        if (parts.length >= 2) {
          let h = parseInt(parts[0], 10);
          const m = parts[1];
          const s = parts[2] ? parts[2].split(" ")[0] : "00";
          const ampm = h >= 12 ? "pm" : "am";
          h = h % 12 || 12;
          const hh = h < 10 ? `0${h}` : `${h}`;
          ts = `${hh}:${m}:${s} ${ampm}`;
        }
      }
      return { ...item, timestamp: ts };
    });
  }

  /**
   * Per-hospital live matrix with alias resolution (matches mongoId, custom hospitalId, and names)
   */
  public getHospitalLiveMatrix(allHospitals: HospitalLookupItem[] = []) {
    this.pruneOldRequests();
    const now = Date.now();

    // Calculate RPM per identifier in current 60s window
    const rpmByIdentifier = new Map<string, number>();
    for (const r of this.recentRequests) {
      const hid = r.hospitalId || "global";
      rpmByIdentifier.set(hid, (rpmByIdentifier.get(hid) || 0) + 1);
    }

    const results: HospitalStats[] = [];
    const claimedKeys = new Set<string>(["global"]);

    // Aggregate stats for each registered hospital using its primary ID and all aliases
    for (const h of allHospitals) {
      const keysToMatch = new Set<string>();
      if (h.hospitalId) keysToMatch.add(h.hospitalId);
      if (h.mongoId) keysToMatch.add(h.mongoId);
      if (h.aliases) {
        h.aliases.forEach((a) => a && keysToMatch.add(a));
      }

      let rpm = 0;
      let dailyBytesIn = 0;
      let dailyBytesOut = 0;
      let lastPing = 0;

      keysToMatch.forEach((key) => {
        claimedKeys.add(key);
        if (rpmByIdentifier.has(key)) {
          rpm += rpmByIdentifier.get(key) || 0;
        }
        if (this.hospitalStatsMap.has(key)) {
          const stats = this.hospitalStatsMap.get(key)!;
          dailyBytesIn += stats.dailyBytesIn || 0;
          dailyBytesOut += stats.dailyBytesOut || 0;
          if (stats.lastPing > lastPing) {
            lastPing = stats.lastPing;
          }
        }
      });

      const isOnline = lastPing > 0 && (now - lastPing < 120_000);

      results.push({
        hospitalId: h.hospitalId || h.mongoId || "unknown",
        name: h.name,
        rpm,
        dailyBytesIn,
        dailyBytesOut,
        lastPing,
        status: isOnline ? "Active Now" : "Idle",
      });
    }

    // Check any remaining entries in hospitalStatsMap that weren't claimed
    this.hospitalStatsMap.forEach((stats, hid) => {
      if (claimedKeys.has(hid) || hid === "global") return;

      // Check if hid matches any hospital's name, mongoId or hospitalId case-insensitively
      const matched = allHospitals.find(
        (h) =>
          (h.hospitalId && h.hospitalId.toLowerCase() === hid.toLowerCase()) ||
          (h.mongoId && h.mongoId.toLowerCase() === hid.toLowerCase()) ||
          (h.aliases && h.aliases.some((a) => a.toLowerCase() === hid.toLowerCase()))
      );

      if (matched) return;

      const rpm = rpmByIdentifier.get(hid) || 0;
      const isOnline = stats.lastPing > 0 && (now - stats.lastPing < 120_000);
      results.push({
        hospitalId: hid,
        name: hid.startsWith("Hospital ") ? hid : `Hospital ${hid}`,
        rpm,
        dailyBytesIn: stats.dailyBytesIn,
        dailyBytesOut: stats.dailyBytesOut,
        lastPing: stats.lastPing,
        status: isOnline ? "Active Now" : "Idle",
      });
    });

    return results.sort((a, b) => b.rpm - a.rpm || b.lastPing - a.lastPing);
  }

  /**
   * Top hospitals sorted by RPM for horizontal bar chart
   */
  public getTopHospitalsByRpm(allHospitals: HospitalLookupItem[] = []) {
    const matrix = this.getHospitalLiveMatrix(allHospitals);
    return matrix.slice(0, 5).map((h) => ({
      name: h.name || h.hospitalId,
      rpm: h.rpm,
      status: h.status,
    }));
  }

  /**
   * Byte formatter utility
   */
  public formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }
}

export const telemetryService = new TelemetryService();

/**
 * Express Telemetry Middleware
 */
export const telemetryMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const bytesIn = parseInt(req.headers["content-length"] || "0", 10) || 0;

  // Intercept write and end to estimate outbound payload size
  let bytesOut = 0;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = function (chunk: any, ...args: any[]): boolean {
    if (chunk) {
      bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    }
    return originalWrite(chunk, ...args);
  };

  res.end = function (chunk: any, ...args: any[]): any {
    if (chunk) {
      bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    }
    return originalEnd(chunk, ...args);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode || 200;
    const isError = statusCode >= 400;

    // Resolve hospital identifier safely
    const hospitalId = (
      req.headers["x-hospital-id"] ||
      (req as any).user?.hospital ||
      (req as any).user?.hospitalId ||
      "global"
    ).toString();

    telemetryService.recordRequest({
      timestamp: Date.now(),
      duration,
      statusCode,
      isError,
      hospitalId,
      bytesIn,
      bytesOut,
    });
  });

  next();
};

export default telemetryService;
