import { WhatsAppService } from "./whatsappService.js";
import WhatsAppConfig from "../Models/WhatsAppConfig.js";
import WhatsAppAuth from "../Models/WhatsAppAuth.js";

class WhatsAppManager {
  private instances: Map<string, WhatsAppService>;

  constructor() {
    this.instances = new Map();
    // Auto-restore all 24/7 linked hospital sessions on server startup
    setTimeout(() => {
      this.autoRestoreAllSessions().catch(err => {
        console.warn("[WhatsAppManager] Auto-restore warning:", err?.message);
      });
    }, 4000);
  }

  async autoRestoreAllSessions() {
    try {
      const activeConfigs = await WhatsAppConfig.find({
        $or: [{ status: "CONNECTED" }, { connectedNumber: { $ne: null } }]
      }).select("hospitalId");

      const authHospitalIds = await WhatsAppAuth.distinct("hospitalId", {
        id: "creds"
      });

      const uniqueIds = Array.from(new Set([
        ...activeConfigs.map(c => c.hospitalId),
        ...authHospitalIds
      ])).filter(Boolean);

      console.log(`[WhatsAppManager] 24/7 Service: Auto-restoring ${uniqueIds.length} hospital WhatsApp sessions...`);
      for (const hId of uniqueIds) {
        if (hId) {
          const inst = this.getInstance(hId);
          await inst.init().catch(e => {
            console.warn(`[WhatsAppManager] Init failed for hospital ${hId}:`, e?.message);
          });
        }
      }
    } catch (e: any) {
      console.warn("[WhatsAppManager] Failed to auto-restore sessions:", e?.message);
    }
  }

  hasInstance(hospitalId: string): boolean {
    return this.instances.has(hospitalId);
  }

  getInstance(hospitalId: string, hospitalName?: string): WhatsAppService {
    if (!this.instances.has(hospitalId)) {
      const instance = new WhatsAppService(hospitalId, hospitalName);
      this.instances.set(hospitalId, instance);
      // Auto initialize in background so WhatsApp socket is pre-connected & warm 24/7
      instance.init().catch(() => {});
    } else if (hospitalName) {
      this.instances.get(hospitalId)?.setHospitalName(hospitalName);
    }
    return this.instances.get(hospitalId)!;
  }
}

const whatsappManager = new WhatsAppManager();
export default whatsappManager;
