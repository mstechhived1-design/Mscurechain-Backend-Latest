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

  startBackgroundHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(async () => {
      try {
        if (this._initPromise) return;
        if (this.status === 'CONNECTED') {
          if (!this.sock || !isSocketOpen(this.sock)) {
            console.log(`[WhatsApp Service - ${this.hospitalId}] 24/7 Heartbeat detected socket drop! Reconnecting...`);
            await this.ensureConnection(true);
          } else {
            // Actively maintain 24/7 presence with WhatsApp infrastructure
            try {
              await this.sock.sendPresenceUpdate('available');
            } catch (pErr) {}
          }
        }
      } catch (e: any) {
        console.warn(`[WhatsApp Service - ${this.hospitalId}] Heartbeat warning:`, e?.message);
      }
    }, 15000);
  }

  getPlatformInfo() {
    const rawName = this.hospitalName || 'MsCurechain Hospital';
    const browserConfig = Browsers.windows('Chrome');
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
            // Code 440: WhatsApp server kicked us out due to a session conflict (e.g., WhatsApp Web open elsewhere)
            // SILENT RECOVERY: Keep status as CONNECTED, do NOT notify listeners, do NOT update DB.
            this._conflictCount = (this._conflictCount || 0) + 1;
            const conflictDelay = Math.min(8000 + (this._conflictCount - 1) * 3000, 20000);
            console.log(`[WhatsApp Diagnostics - ${this.hospitalId}] Code 440 silent recovery #${this._conflictCount} — reconnecting in ${conflictDelay}ms (status kept CONNECTED)...`);
            setTimeout(() => {
              this._initPromise = null;
              this.isInitializing = false;
              this.init();
            }, conflictDelay);
          } else {
            console.log(`[WhatsApp Diagnostics - ${this.hospitalId}] Auto-reconnecting background socket (statusCode: ${statusCode})...`);
            this.status = isRestartRequired ? 'CONNECTING' : 'DISCONNECTED';
            this.notifyListeners();

            const delay = isRestartRequired ? 600 : 2000;
            setTimeout(() => {
              this._initPromise = null;
              this.isInitializing = false;
              this.init();
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
    const isActuallyConnected = (this.status === 'CONNECTED' || Boolean(this.sock?.user?.id)) && isSocketOpen(this.sock);
    const phone = isActuallyConnected ? (this.connectedNumber || (this.sock?.user?.id ? this.sock.user.id.split(':')[0].replace(/[^0-9]/g, '') : null)) : null;
    const { platformName, deviceName } = this.getPlatformInfo();

    let currentStatus = this.status;
    if (isActuallyConnected) {
      currentStatus = 'CONNECTED';
    } else if (this.status === 'CONNECTING') {
      currentStatus = 'CONNECTING';
    } else if (this.qrDataUrl) {
      currentStatus = 'SCAN_QR';
    }

    const showQr = Boolean(!isActuallyConnected && currentStatus === 'SCAN_QR' && this.qrDataUrl);

    return {
      status: currentStatus,
      connectedNumber: isActuallyConnected ? phone : null,
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
    const isReady = (this.status === 'CONNECTED' || Boolean(this.sock?.user?.id)) && isSocketOpen(this.sock);
    if (!forceReconnect && isReady) return;

    if (forceReconnect || !this.sock || !isSocketOpen(this.sock) || this.status === 'DISCONNECTED') {
      this.isInitializing = false;
      await this.init();
    }

    let count = 0;
    while (count < 50) {
      if ((this.status === 'CONNECTED' || Boolean(this.sock?.user?.id)) && isSocketOpen(this.sock)) {
        return;
      }
      await new Promise(r => setTimeout(r, 200));
      count++;
    }
  }

  async sendTextMessage(rawPhone: string, text: string) {
    let cleanPhone = (rawPhone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error('Invalid destination phone number.');
    }

    await this.ensureConnection();

    if (!this.sock || !this.sock.user?.id || !isSocketOpen(this.sock)) {
      console.warn(`[WhatsApp Diagnostics - ${this.hospitalId}] Socket not open before sendTextMessage. Triggering forceReconnect...`);
      await this.ensureConnection(true);
    }

    if (!this.sock || !this.sock.user?.id || !isSocketOpen(this.sock)) {
      throw new Error('WhatsApp bot connection is opening. Please try sending again in 2 seconds.');
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
          console.log('[sendTextMessage] Detected Baileys stale-socket (attrs) error — doing FULL teardown + reinit...');
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
  }

  async sendMedia(rawPhone: string, { pdfBase64, imageBase64, caption, fileName, mimetype }: any) {
    let cleanPhone = (rawPhone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error('Invalid destination phone number.');
    }

    await this.ensureConnection();

    if (!this.sock || !this.sock.user?.id || !isSocketOpen(this.sock)) {
      console.warn(`[WhatsApp Diagnostics - ${this.hospitalId}] Socket not open before sendMedia. Triggering forceReconnect...`);
      await this.ensureConnection(true);
    }

    if (!this.sock || !this.sock.user?.id || !isSocketOpen(this.sock)) {
      throw new Error('WhatsApp bot connection is opening. Please try sending again in 2 seconds.');
    }

    const jid = `${cleanPhone}@s.whatsapp.net`;
    let messagePayload: any = {};

    if (pdfBase64) {
      const rawB64 = pdfBase64.replace(/^data:application\/pdf(?:;[^,]*)?;base64,/, '').trim();
      messagePayload = {
        document: Buffer.from(rawB64, 'base64'),
        mimetype: mimetype || 'application/pdf',
        fileName: fileName || 'Document.pdf',
        caption: caption || ''
      };
    } else if (imageBase64) {
      const rawB64 = imageBase64.replace(/^data:image\/\w+(?:;[^,]*)?;base64,/, '').trim();
      messagePayload = {
        image: Buffer.from(rawB64, 'base64'),
        mimetype: mimetype || 'image/jpeg',
        caption: caption || ''
      };
    } else {
      messagePayload = { text: caption || 'Here is your document.' };
    }

    try {
      const timeoutMs = 35000;
      return await Promise.race([
        this.sock.sendMessage(jid, messagePayload),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Send media operation timed out')), timeoutMs))
      ]);
    } catch (sendErr: any) {
      const errMsg = sendErr?.message || (typeof sendErr === 'string' ? sendErr : '') || 'Connection Closed';
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
        } catch (retryErr) {
          throw retryErr;
        }
      }
      throw sendErr;
    }
  }
}

