import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import WhatsAppConfig from '../Models/WhatsAppConfig.js';
import useMongoDBAuthState from './useMongoDBAuthState.js';

export const isSocketOpen = (sock: any): boolean => {
  if (!sock) return false;
  if (sock.ws) {
    if (sock.ws.socket && typeof sock.ws.socket.readyState === 'number') {
      return sock.ws.socket.readyState === 1;
    }
    if (typeof sock.ws.readyState === 'number') {
      return sock.ws.readyState === 1;
    }
    if (sock.ws.isOpen === true) return true;
  }
  return false;
};

export class WhatsAppService {
  hospitalId: string;
  hospitalName: string | null;
  sock: WASocket | null = null;
  qrDataUrl: string | null = null;
  status: 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED' = 'DISCONNECTED';
  connectedNumber: string | null = null;
  connectionListeners: Set<Function> = new Set();
  isInitializing: boolean = false;
  _initPromise: Promise<void> | null = null;
  authState: any = null;
  heartbeatInterval: NodeJS.Timeout | null = null;
  _conflictCount: number = 0;
  linkedAt: string | null = null;

  private _sendQueue: Promise<any> = Promise.resolve();

  constructor(hospitalId: string, hospitalName: string | null = null) {
    this.hospitalId = hospitalId;
    this.hospitalName = hospitalName;
    this.startBackgroundHeartbeat();
  }

  setHospitalName(name: string) {
    if (name && typeof name === 'string' && name.trim()) {
      this.hospitalName = name.trim();
    }
  }

  /**
   * Pacing Gatekeeper: ensures all outgoing messages and media are sent
   * strictly one-by-one with an anti-burst delay to prevent Meta rate limits and socket drops.
   */
  enqueueSend<T>(task: () => Promise<T>): Promise<T> {
    const resultPromise = this._sendQueue.then(async () => {
      try {
        const res = await task();
        // Safe 1.5s spacing between outbound transmissions
        await new Promise(r => setTimeout(r, 1500));
        return res;
      } catch (err) {
        await new Promise(r => setTimeout(r, 800));
        throw err;
      }
    });
    this._sendQueue = resultPromise.catch(() => {});
    return resultPromise;
  }

  startBackgroundHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(async () => {
      try {
        // Never interrupt an active handshake or initialization
        if (this._initPromise || this.isInitializing || this.status === 'CONNECTING') return;

        const isOpen = Boolean(this.sock && isSocketOpen(this.sock));
        const hasLinkedNumber = Boolean(this.connectedNumber);

        if (isOpen && this.status === 'CONNECTED') {
          // Socket is healthy and connected. Baileys native keepAlive handles ping frames.
          return;
        } else if (hasLinkedNumber && !isOpen) {
          // Socket truly dropped while linked! Reconnect safely without destroying state
          console.log(`[WhatsApp - ${this.hospitalId}] ⚡ 24/7 Zero-Drop Monitor: Socket disconnected. Reconnecting cleanly...`);
          await this.ensureConnection(false);
        }
      } catch (e: any) {
        console.warn(`[WhatsApp Service - ${this.hospitalId}] Heartbeat check notice:`, e?.message);
      }
    }, 25000);
  }

  getPlatformInfo() {
    const rawName = this.hospitalName || 'MsCurechain Hospital';
    const browserConfig = Browsers.macOS('Desktop');
    return {
      browserConfig,
      platformName: rawName,
      deviceName: `${rawName} Gateway`
    };
  }

  async init() {
    if (this._initPromise) {
      console.log(`[WhatsApp - ${this.hospitalId}] init() called while already initializing — waiting for existing init...`);
      return this._initPromise;
    }
    if (this.status === 'CONNECTED' && this.sock?.user?.id && isSocketOpen(this.sock)) {
      return;
    }
    this.isInitializing = true;
    this._initPromise = this._doInit();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
      this.isInitializing = false;
    }
  }

  async _doInit() {
    try {
      if (this.sock) {
        try {
          (this.sock.ev as any).removeAllListeners();
          this.sock.end(undefined);
        } catch (e) {}
        this.sock = null;
      }

      this.authState = await useMongoDBAuthState(this.hospitalId);
      const { state, saveCreds } = this.authState;

      let version;
      try {
        const vInfo = await Promise.race([
          fetchLatestBaileysVersion(),
          new Promise<any>((_, reject) => setTimeout(() => reject(new Error('version fetch timeout')), 1500))
        ]);
        version = vInfo.version;
      } catch (e) {
        version = [2, 3000, 1043857760];
      }

      const platformInfo = this.getPlatformInfo();

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }) as any,
        printQRInTerminal: false,
        auth: state,
        browser: platformInfo.browserConfig,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 15000,
        retryRequestDelayMs: 300
      });

      this.sock.ev.on('creds.update', async () => {
        try {
          if (this.sock?.user?.id && state?.creds) {
            state.creds.registered = true;
            this.status = 'CONNECTED';
            this.qrDataUrl = null;
            const rawJid = this.sock.user.id;
            this.connectedNumber = rawJid.split(':')[0] || rawJid.split('@')[0] || null;
            this.notifyListeners();
          }
          await saveCreds();
        } catch (e) {}
      });

      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8, color: { dark: '#000000', light: '#FFFFFF' } });
            this.status = 'SCAN_QR';
            this.notifyListeners();
          } catch (qrErr) {}
        }

        if (connection === 'connecting') {
          this.status = 'CONNECTING';
          this.qrDataUrl = null;
          this.notifyListeners();
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const errorPayload = (lastDisconnect?.error as any)?.output?.payload;
          const errorMessage = (lastDisconnect?.error as any)?.message;
          console.warn(`[WhatsApp Diagnostics - ${this.hospitalId}] Connection CLOSED! Code: ${statusCode}, Reason: "${errorMessage || errorPayload?.error || 'Unknown'}"`);

          const isConflict = statusCode === 440;
          const isExplicitLoggedOut = statusCode === 401 || statusCode === DisconnectReason.loggedOut ||
            String(errorMessage).toLowerCase().includes('logged out') ||
            errorPayload?.error === 'Unauthorized';
          const isRestartRequired = statusCode === 515 || statusCode === DisconnectReason.restartRequired || statusCode === 408;

          if (isExplicitLoggedOut) {
            console.log(`[WhatsApp Diagnostics - ${this.hospitalId}] Logged out explicitly. Clearing credentials...`);
            this.status = 'DISCONNECTED';
            this.connectedNumber = null;
            this.qrDataUrl = null;
            this.clearAuth();
            this.notifyListeners();
            await WhatsAppConfig.findOneAndUpdate(
              { hospitalId: this.hospitalId },
              { status: 'DISCONNECTED', connectedNumber: null },
              { upsert: true }
            ).catch(() => {});
          } else if (isConflict) {
            this._conflictCount = (this._conflictCount || 0) + 1;
            const conflictDelay = Math.min(3000 + (this._conflictCount * 1500), 12000);
            console.log(`[WhatsApp Diagnostics - ${this.hospitalId}] Code 440 conflict detected #${this._conflictCount} — pausing ${conflictDelay}ms to let old socket terminate...`);
            this.status = 'CONNECTING';
            this.notifyListeners();
            setTimeout(() => {
              this._initPromise = null;
              this.isInitializing = false;
              this.init();
            }, conflictDelay);
          } else {
            // Stable 24/7 reconnect: wait 2500ms - 3500ms so WhatsApp server releases the old socket
            const delay = isRestartRequired ? 2500 : 3500;
            console.log(`[WhatsApp Diagnostics - ${this.hospitalId}] 24/7 Zero-Drop Auto-reconnecting in ${delay}ms (statusCode: ${statusCode})...`);
            this.status = 'CONNECTING';
            this.notifyListeners();

            setTimeout(() => {
              this._initPromise = null;
              this.isInitializing = false;
              this.init().catch(err => {
                console.warn(`[WhatsApp - ${this.hospitalId}] Auto-reconnect failed, will retry:`, err?.message);
              });
            }, delay);
          }
        } else if (connection === 'open') {
          this.status = 'CONNECTED';
          this.qrDataUrl = null;
          this.linkedAt = this.linkedAt || new Date().toISOString();
          const rawJid = this.sock?.user?.id || state?.creds?.me?.id || '';
          this.connectedNumber = rawJid.split(':')[0] || rawJid.split('@')[0] || null;
          this._conflictCount = 0;
          console.log(`[WhatsApp Diagnostics - ${this.hospitalId}] Connected successfully 24/7 as +${this.connectedNumber} (${platformInfo.deviceName})`);
          this.notifyListeners();

          await WhatsAppConfig.findOneAndUpdate(
            { hospitalId: this.hospitalId },
            {
              status: 'CONNECTED',
              connectedNumber: this.connectedNumber,
              deviceName: platformInfo.deviceName,
              linkedAt: this.linkedAt
            },
            { upsert: true }
          ).catch(() => {});
        }
      });
    } catch (err) {
      console.error(`[WhatsApp Diagnostics - ${this.hospitalId}] Init error:`, err);
      this.status = 'DISCONNECTED';
      this.notifyListeners();
    }
  }

  clearAuth() {
    if (this.authState && this.authState.clearState) {
      this.authState.clearState();
    }
  }

  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock = null;
      }
      this.qrDataUrl = null;
      this.status = 'DISCONNECTED';
      this.connectedNumber = null;
      this.clearAuth();
      this.notifyListeners();
      return { success: true, message: 'Logged out successfully' };
    } catch (err) {
      console.error('[WhatsApp Service] Logout error:', err);
      throw err;
    }
  }

  async requestPairingCode(rawPhone: string) {
    let cleanPhone = (rawPhone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error('Invalid destination phone number. Please enter a valid 10-digit mobile number.');
    }

    if (this.status === 'CONNECTED') {
      throw new Error('WhatsApp is already connected. Please disconnect first to link another device.');
    }

    if (!this.sock || typeof this.sock.requestPairingCode !== 'function' || !isSocketOpen(this.sock)) {
      this.isInitializing = false;
      await this.init();
      let waited = 0;
      while ((!this.sock || typeof this.sock.requestPairingCode !== 'function') && waited < 4000) {
        await new Promise(r => setTimeout(r, 400));
        waited += 400;
      }
    }

    if (this.sock?.waitForSocketOpen) {
      try { await this.sock.waitForSocketOpen(); } catch (e) {}
    }

    if (!this.sock || typeof this.sock.requestPairingCode !== 'function') {
      throw new Error('WhatsApp service is initializing. Please wait 3 seconds and try again.');
    }

    try {
      const code = await this.sock.requestPairingCode(cleanPhone);
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
      return { success: true, pairingCode: formattedCode, rawCode: code };
    } catch (err: any) {
      console.error('[WhatsApp Service] Pairing code error:', err);
      this.isInitializing = false;
      await this.init();
      let waited = 0;
      while ((!this.sock || typeof this.sock.requestPairingCode !== 'function') && waited < 4000) {
        await new Promise(r => setTimeout(r, 400));
        waited += 400;
      }
      if (this.sock?.waitForSocketOpen) {
        try { await this.sock.waitForSocketOpen(); } catch (e) {}
      }
      if (this.sock && typeof this.sock.requestPairingCode === 'function') {
        const code = await this.sock.requestPairingCode(cleanPhone);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        return { success: true, pairingCode: formattedCode, rawCode: code };
      }
      throw new Error(err?.message || 'Failed to generate pairing code. Please refresh QR or try again.');
    }
  }

  async refreshQR() {
    if (this.status === 'CONNECTED' && this.sock?.user?.id && isSocketOpen(this.sock)) {
      console.log(`[WhatsApp Service - ${this.hospitalId}] refreshQR() skipped — socket is already CONNECTED.`);
      return { success: true, message: 'Already connected — no QR refresh needed' };
    }
    this.isInitializing = false;
    this.qrDataUrl = null;
    this.status = 'DISCONNECTED';
    await this.init();
    return { success: true, message: 'QR regeneration triggered' };
  }

  getStatus() {
    const phone = this.connectedNumber || (this.sock?.user?.id ? this.sock.user.id.split(':')[0].replace(/[^0-9]/g, '') : null);
    const isActuallyConnected = (this.status === 'CONNECTED' || Boolean(this.sock?.user?.id)) && (isSocketOpen(this.sock) || Boolean(phone));
    const { platformName, deviceName } = this.getPlatformInfo();

    let currentStatus = this.status;
    if (isActuallyConnected || (phone && currentStatus !== 'SCAN_QR' && currentStatus !== 'DISCONNECTED')) {
      currentStatus = 'CONNECTED';
    } else if (this.status === 'CONNECTING') {
      currentStatus = 'CONNECTING';
    } else if (this.qrDataUrl) {
      currentStatus = 'SCAN_QR';
    }

    const showQr = Boolean(!isActuallyConnected && currentStatus === 'SCAN_QR' && this.qrDataUrl);

    return {
      status: currentStatus,
      connectedNumber: currentStatus === 'CONNECTED' ? phone : null,
      hospitalName: this.hospitalName || null,
      platform: platformName,
      deviceName: deviceName,
      linkedAt: isActuallyConnected ? (this.linkedAt || new Date().toISOString()) : null,
      linkedDevices: isActuallyConnected && phone ? [
        {
          id: 'dev_1',
          name: deviceName,
          platform: `${platformName} Gateway`,
          status: 'Active',
          lastActive: 'Just now',
          phoneNumber: `+${phone}`
        }
      ] : [],
      totalLinkedDevices: isActuallyConnected && phone ? 1 : 0,
      hasQr: showQr,
      qr: showQr ? this.qrDataUrl : null
    };
  }

  notifyListeners() {
    const data = this.getStatus();
    this.connectionListeners.forEach(listener => {
      try { listener(data); } catch (e) {}
    });
  }

  addListener(fn: Function) {
    this.connectionListeners.add(fn);
    return () => this.connectionListeners.delete(fn);
  }

  async ensureConnection(forceReconnect = false) {
    const isReady = this.status === 'CONNECTED' && this.sock && isSocketOpen(this.sock);
    if (!forceReconnect && isReady) return;

    if (forceReconnect || !this.sock || !isSocketOpen(this.sock) || this.status === 'DISCONNECTED') {
      this.isInitializing = false;
      this._initPromise = null;
      await this.init();
    }

    let count = 0;
    while (count < 15) {
      if (this.status === 'CONNECTED' && this.sock && isSocketOpen(this.sock)) {
        return;
      }
      await new Promise(r => setTimeout(r, 350));
      count++;
    }
  }

  async sendTextMessage(rawPhone: string, text: string) {
    return this.enqueueSend(async () => {
      let cleanPhone = (rawPhone || '').replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
        cleanPhone = cleanPhone.slice(1);
      }
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

      if (!cleanPhone || cleanPhone.length < 10) {
        throw new Error('Invalid destination phone number. Must be at least 10 digits.');
      }

      await this.ensureConnection();

      let readyWait = 0;
      while ((!this.sock || !isSocketOpen(this.sock) || this.status !== 'CONNECTED') && readyWait < 8000) {
        await new Promise(r => setTimeout(r, 300));
        readyWait += 300;
      }

      if (!this.sock || !isSocketOpen(this.sock) || this.status !== 'CONNECTED') {
        throw new Error('WhatsApp service is reconnecting. Please wait a moment and try again.');
      }

      const jid = `${cleanPhone}@s.whatsapp.net`;

      try {
        return await this.sock.sendMessage(jid, { text: String(text) });
      } catch (sendErr: any) {
        console.warn('[WhatsApp Diagnostics] Send text message warning:', sendErr?.message || sendErr);
        const errStr = String(sendErr?.message || sendErr).toLowerCase();
        const isAttrsError = errStr.includes('attrs') || errStr.includes('cannot read properties');
        const needsReconnect = isAttrsError || errStr.includes('closed') || errStr.includes('disconnect') ||
          errStr.includes('not connected') || errStr.includes('500') || errStr.includes('timed out');

        if (needsReconnect) {
          if (isAttrsError) {
            console.log('[sendTextMessage] Detected Baileys stale-socket (attrs) error — doing clean reinit...');
            try {
              if (this.sock) { (this.sock.ev as any).removeAllListeners(); this.sock.end(undefined); }
            } catch (e) {}
            this.sock = null;
            this.isInitializing = false;
            this.status = 'DISCONNECTED';
          }
          try {
            await this.ensureConnection(true);
            await new Promise(r => setTimeout(r, 1500));
            if (this.sock && isSocketOpen(this.sock)) {
              return await this.sock.sendMessage(jid, { text: String(text) });
            }
          } catch (retryErr) {
            console.warn('[WhatsApp Diagnostics] Retry text send error:', (retryErr as any)?.message);
            throw retryErr;
          }
        }
        throw sendErr;
      }
    });
  }

  async sendMedia(rawPhone: string, { pdfBase64, imageBase64, caption, fileName, mimetype }: any) {
    return this.enqueueSend(async () => {
      let cleanPhone = (rawPhone || '').replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
        cleanPhone = cleanPhone.slice(1);
      }
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

      if (!cleanPhone || cleanPhone.length < 10) {
        throw new Error('Invalid destination phone number. Must be at least 10 digits.');
      }

      await this.ensureConnection();

      let readyWait = 0;
      while ((!this.sock || !isSocketOpen(this.sock) || this.status !== 'CONNECTED') && readyWait < 8000) {
        await new Promise(r => setTimeout(r, 300));
        readyWait += 300;
      }

      if (!this.sock || !isSocketOpen(this.sock) || this.status !== 'CONNECTED') {
        throw new Error('WhatsApp service is reconnecting. Please wait a moment and try again.');
      }

      const jid = `${cleanPhone}@s.whatsapp.net`;
      let messagePayload: any = {};

      if (pdfBase64) {
        const rawB64 = pdfBase64.includes(';base64,') ? pdfBase64.split(';base64,')[1].trim() : pdfBase64.replace(/^data:[^;]+;base64,/, '').trim();
        const docBuffer = Buffer.from(rawB64, 'base64');
        if (!docBuffer || docBuffer.length === 0) {
          throw new Error('Generated PDF document data is empty.');
        }
        // WhatsApp MMS document captions strictly enforce a 1024 character limit.
        // Safely preserve "Read more" marks (\u200E) while ensuring total caption stays under 1000 characters.
        let sanitizedCaption = String(caption || '').trim();
        if (sanitizedCaption.length > 1000) {
          const excess = sanitizedCaption.length - 980;
          sanitizedCaption = sanitizedCaption.replace(/\u200E{100,}/, (m) => m.slice(0, Math.max(50, m.length - excess)));
          if (sanitizedCaption.length > 1000) {
            sanitizedCaption = sanitizedCaption.slice(0, 995) + '...';
          }
        }

        // Combined Message: document + rich text caption embedded together
        messagePayload = {
          document: docBuffer,
          mimetype: mimetype || 'application/pdf',
          fileName: fileName || 'Document.pdf',
          caption: sanitizedCaption
        };
      } else if (imageBase64) {
        const rawB64 = imageBase64.includes(';base64,') ? imageBase64.split(';base64,')[1].trim() : imageBase64.replace(/^data:[^;]+;base64,/, '').trim();
        const imgBuffer = Buffer.from(rawB64, 'base64');
        if (!imgBuffer || imgBuffer.length === 0) {
          throw new Error('Generated image data is empty.');
        }
        let sanitizedCaption = String(caption || '').replace(/\u200E{10,}/g, '').trim();
        if (sanitizedCaption.length > 1000) {
          sanitizedCaption = sanitizedCaption.slice(0, 995) + '...';
        }
        messagePayload = {
          image: imgBuffer,
          mimetype: mimetype || 'image/jpeg',
          caption: sanitizedCaption
        };
      } else {
        messagePayload = { text: caption || 'Here is your document.' };
      }

      try {
        const timeoutMs = 40000;
        return await Promise.race([
          this.sock.sendMessage(jid, messagePayload),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Send media operation timed out')), timeoutMs))
        ]);
      } catch (sendErr: any) {
        console.error(`[WhatsApp sendMedia error - ${this.hospitalId}]:`, sendErr);
        const errMsg = sendErr?.output?.payload?.message || sendErr?.message || (typeof sendErr === 'string' ? sendErr : '') || 'Connection Closed';
        const errStr = errMsg.toLowerCase();
        const isAttrsError = errStr.includes('attrs') || errStr.includes('cannot read properties');
        const needsReconnect = isAttrsError || errStr.includes('closed') || errStr.includes('disconnect') ||
          errStr.includes('not connected') || errStr.includes('500') || errStr.includes('timed out');

        if (needsReconnect) {
          if (isAttrsError) {
            try {
              if (this.sock) { (this.sock.ev as any).removeAllListeners(); this.sock.end(undefined); }
            } catch (e) {}
            this.sock = null;
            this._initPromise = null;
            this.isInitializing = false;
            this.status = 'DISCONNECTED';
          }

          try {
            await this.ensureConnection(true);
            let waitTime = 0;
            while (!isSocketOpen(this.sock) && waitTime < 8000) {
              await new Promise(r => setTimeout(r, 400));
              waitTime += 400;
            }

            if (this.sock && isSocketOpen(this.sock)) {
              return await Promise.race([
                this.sock.sendMessage(jid, messagePayload),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Retry operation timed out')), 40000))
              ]);
            }
          } catch (retryErr: any) {
            const retryErrMsg = retryErr?.output?.payload?.message || retryErr?.message || 'Failed to reconnect and send media';
            throw new Error(retryErrMsg);
          }
        }
        throw new Error(errMsg);
      }
    });
  }
}

