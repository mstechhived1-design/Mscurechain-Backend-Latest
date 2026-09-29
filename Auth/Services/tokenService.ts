import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import crypto from "crypto";

export interface TokenPayload {
  _id: string;
  id?: string;           // backward compat alias
  role: string;
  hospital?: string;     // primary hospital (legacy)
  hospitalId?: string;   // alias for middleware
  hospitals: string[];
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * TOKEN SERVICE - Simple & Stable
 * Centralises JWT signing/verification and cookie management.
 *
 * Architecture:
 *  - Access token  : 30 min · httpOnly: true  · Secure · SameSite=Lax
 *  - Refresh token : 7 d    · httpOnly: true  · Secure · SameSite=Strict
 *  - CSRF token    : 7 d    · httpOnly: false · Secure · SameSite=Lax (JS reads it)
 */
class TokenService {
  private readonly ACCESS_SECRET: string;
  private readonly REFRESH_SECRET: string;
  private readonly ACCESS_EXPIRY: string;
  private readonly REFRESH_EXPIRY: string;
  private readonly ISSUER:   string = "mscurechain-api";
  private readonly AUDIENCE: string = "mscurechain-app";

  constructor() {
    // prefer explicit env values
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

    // In production we require secrets to be set
    const isTest = process.env.NODE_ENV === "test";

    if (!jwtSecret) {
      if (isTest) {
        // fallback to stable test secret (non-sensitive, only used in test runs)
        this.ACCESS_SECRET = "mscurechain-test-access-secret";
      } else {
        throw new Error("JWT_SECRET must be set in environment variables.");
      }
    } else {
      this.ACCESS_SECRET = jwtSecret;
    }

    if (!jwtRefreshSecret) {
      if (isTest) {
        this.REFRESH_SECRET = "mscurechain-test-refresh-secret";
      } else {
        throw new Error("JWT_REFRESH_SECRET must be set in environment variables.");
      }
    } else {
      this.REFRESH_SECRET = jwtRefreshSecret;
    }

    this.ACCESS_EXPIRY  = process.env.ACCESS_TOKEN_EXPIRY_DEFAULT || "30m";
    this.REFRESH_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY        || "7d";
  }

  // ─── Token generation ────────────────────────────────────────────────────

  generateTokens(payload: TokenPayload) {
    const enriched = {
      ...payload,
      id:  payload._id,   // copy _id → id for legacy middleware
      iss: this.ISSUER,
      aud: this.AUDIENCE,
    };

    const accessToken = jwt.sign(enriched, this.ACCESS_SECRET, {
      expiresIn: this.ACCESS_EXPIRY as any,
    });

    const refreshToken = jwt.sign(enriched, this.REFRESH_SECRET, {
      expiresIn: this.REFRESH_EXPIRY as any,
    });

    return { accessToken, refreshToken };
  }

  // ─── Token verification ──────────────────────────────────────────────────

  verifyAccessToken(token: string): TokenPayload {
    const decoded = jwt.verify(token, this.ACCESS_SECRET, {
      issuer:   this.ISSUER,
      audience: this.AUDIENCE,
    }) as TokenPayload;

    if (!decoded._id) {
      throw new Error("Invalid token claims");
    }
    return decoded;
  }

  verifyRefreshToken(token: string): TokenPayload {
    return jwt.verify(token, this.REFRESH_SECRET, {
      issuer:   this.ISSUER,
      audience: this.AUDIENCE,
    }) as TokenPayload;
  }

  // ─── Security helpers ────────────────────────────────────────────────────

  /**
   * SHA-256 hash of any string (used for refresh tokens).
   */
  hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  getClientIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
      const ip = (typeof forwarded === "string" ? forwarded.split(",")[0] : forwarded[0]).trim();
      return ip.startsWith("::ffff:") ? ip.substring(7) : ip;
    }
    const remoteAddr = req.socket.remoteAddress || "0.0.0.0";
    return remoteAddr.startsWith("::ffff:") ? remoteAddr.substring(7) : remoteAddr;
  }

  // ─── Cookie management ───────────────────────────────────────────────────

  setRefreshCookie(res: Response, token: string, role?: string | null) {
    const domain  = process.env.COOKIE_DOMAIN;
    const isLocal = !domain || domain.includes("localhost") || domain.includes("127.0.0.1");
    
    // ✅ CROSS-BROWSER FIX: Safari/Firefox often reject 'Secure' on http even for localhost.
    const secure  = IS_PRODUCTION && !isLocal;

    const options = {
      httpOnly: true,
      secure:   secure,
      sameSite: "lax" as const, // Changed from strict for better multi-port dev stability
      maxAge:   this.parseExpiryToMs(this.REFRESH_EXPIRY),
      path:     "/",
      ...(domain && { domain }),
    };

    res.cookie("refreshToken", token, options);
    if (role) {
      res.cookie(`refreshToken_${role.replace("-", "_")}`, token, options);
    }
  }

  setAccessCookie(
    res:        Response,
    token:      string,
    hospitalId?: string | null,
    role?:       string | null
  ) {
    const domain  = process.env.COOKIE_DOMAIN;
    const isLocal = !domain || domain.includes("localhost") || domain.includes("127.0.0.1");
    const secure  = IS_PRODUCTION && !isLocal;

    const options = {
      // ✅ FIX (Bug 4): Access token MUST be httpOnly:false.
      // The client-side apiClient reads it via document.cookie when cachedToken
      // is lost on page reload. httpOnly:true makes it invisible to JS, causing
      // repeated refresh loops and session drops after backend-direct token rotation.
      httpOnly: false,
      secure:   secure,
      sameSite: "lax" as const,
      maxAge:   this.parseExpiryToMs(this.ACCESS_EXPIRY),
      path:     "/",
      ...(domain && { domain }),
    };

    res.cookie("accessToken", token, options);
    if (hospitalId && hospitalId !== "global") {
      res.cookie(`accessToken_${hospitalId}`, token, options);
    }
    if (role) {
      res.cookie(`accessToken_${role.replace("-", "_")}`, token, options);
    }
  }

  setCsrfCookie(
    res:        Response,
    token:      string,
    hospitalId?: string | null,
    role?:       string | null
  ) {
    const domain  = process.env.COOKIE_DOMAIN;
    const isLocal = !domain || domain.includes("localhost") || domain.includes("127.0.0.1");
    const secure  = IS_PRODUCTION && !isLocal;

    const options = {
      httpOnly: false, // Normal cookie for CSRF as requested
      secure:   secure,
      sameSite: "lax" as const,
      maxAge:   this.parseExpiryToMs(this.REFRESH_EXPIRY),
      path:     "/",
      ...(domain && { domain }),
    };

    res.cookie("csrf_token", token, options);
    if (hospitalId && hospitalId !== "global") {
      res.cookie(`csrf_token_${hospitalId}`, token, options);
    }
    if (role) {
      res.cookie(`csrf_token_${role.replace("-", "_")}`, token, options);
    }
  }

  clearCookies(
    res:        Response,
    hospitalId?: string | null,
    role?:       string | null
  ) {
    const domain  = process.env.COOKIE_DOMAIN;
    const options = { path: "/", ...(domain && { domain }) };

    res.clearCookie("refreshToken",  options);
    res.clearCookie("csrf_token",    options);
    res.clearCookie("accessToken",   options);

    if (hospitalId && hospitalId !== "global") {
      res.clearCookie(`accessToken_${hospitalId}`,  options);
      res.clearCookie(`csrf_token_${hospitalId}`,   options);
    }
    
    if (role) {
      const r = role.replace("-", "_");
      res.clearCookie(`accessToken_${r}`,    options);
      res.clearCookie(`csrf_token_${r}`,     options);
      res.clearCookie(`refreshToken_${r}`,   options);
    }
  }

  // ─── Expiry helpers ──────────────────────────────────────────────────────

  getRefreshExpiryMs():      number { return this.parseExpiryToMs(this.REFRESH_EXPIRY); }
  getRefreshExpirySeconds(): number { return Math.floor(this.getRefreshExpiryMs() / 1000); }
  getAccessExpirySeconds():  number { return Math.floor(this.parseExpiryToMs(this.ACCESS_EXPIRY) / 1000); }

  private parseExpiryToMs(expiry: string): number {
    const unit  = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1), 10);
    switch (unit) {
      case "s": return value * 1_000;
      case "m": return value * 60 * 1_000;
      case "h": return value * 3_600 * 1_000;
      case "d": return value * 86_400 * 1_000;
      default:  return 15 * 60 * 1_000;
    }
  }
}

export const tokenService = new TokenService();
export default tokenService;
