import WhatsAppAuth from "../Models/WhatsAppAuth.js";
import {
  initAuthCreds,
  BufferJSON,
  proto,
  AuthenticationState,
  AuthenticationCreds,
} from "@whiskeysockets/baileys";

const globalAuthCache = new Map<string, Map<string, any>>();

const useMongoDBAuthState = async (
  hospitalId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void> }> => {
  if (!globalAuthCache.has(hospitalId)) {
    globalAuthCache.set(hospitalId, new Map());
  }
  const memoryCache = globalAuthCache.get(hospitalId)!;

  const writeData = async (data: any, id: string) => {
    try {
      memoryCache.set(id, data);
      const stringifiedData = JSON.stringify(data, BufferJSON.replacer);
      await WhatsAppAuth.findOneAndUpdate(
        { hospitalId, id },
        { data: stringifiedData },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`[WhatsApp Auth] Error writing data for hospital ${hospitalId}, id ${id}:`, error);
    }
  };

  const readData = async (id: string) => {
    if (memoryCache.has(id)) {
      return memoryCache.get(id);
    }
    try {
      const document = await WhatsAppAuth.findOne({ hospitalId, id }).lean();
      if (document && document.data) {
        const parsed = JSON.parse(document.data, BufferJSON.reviver);
        memoryCache.set(id, parsed);
        return parsed;
      }
      return null;
    } catch (error) {
      console.error(`[WhatsApp Auth] Error reading data for hospital ${hospitalId}, id ${id}:`, error);
      return null;
    }
  };

  const removeData = async (id: string) => {
    memoryCache.delete(id);
    try {
      await WhatsAppAuth.findOneAndDelete({ hospitalId, id });
    } catch (error) {
      console.error(`[WhatsApp Auth] Error removing data for hospital ${hospitalId}, id ${id}:`, error);
    }
  };

  const clearState = async () => {
    memoryCache.clear();
    try {
      await WhatsAppAuth.deleteMany({ hospitalId });
    } catch (error) {
      console.error(`[WhatsApp Auth] Error clearing state for hospital ${hospitalId}:`, error);
    }
  };

  const credsData = await readData("creds");
  const creds: AuthenticationCreds = credsData || initAuthCreds();
  memoryCache.set("creds", creds);

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: { [key: string]: any } = {};
          const missingKeys: string[] = [];
          const keyToIdMap = new Map<string, string>();

          // 1. Check in-memory cache first (0ms latency)
          for (const id of ids) {
            const key = `${type}-${id}`;
            if (memoryCache.has(key)) {
              let val = memoryCache.get(key);
              if (type === "app-state-sync-key" && val && proto?.Message?.AppStateSyncKeyData) {
                val = proto.Message.AppStateSyncKeyData.fromObject(val);
              }
              data[id] = val;
            } else {
              missingKeys.push(key);
              keyToIdMap.set(key, id);
            }
          }

          // 2. Fetch all missing keys in a SINGLE batch query instead of N individual queries
          if (missingKeys.length > 0) {
            try {
              const docs = await WhatsAppAuth.find({ hospitalId, id: { $in: missingKeys } }).lean();
              for (const doc of docs) {
                if (doc && doc.data) {
                  try {
                    let parsed = JSON.parse(doc.data, BufferJSON.reviver);
                    memoryCache.set(doc.id, parsed);
                    const originalId = keyToIdMap.get(doc.id);
                    if (originalId) {
                      if (type === "app-state-sync-key" && parsed && proto?.Message?.AppStateSyncKeyData) {
                        parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
                      }
                      data[originalId] = parsed;
                    }
                  } catch (parseErr: any) {
                    console.warn(`[MongoDB Auth] Failed to parse key ${doc.id}:`, parseErr.message);
                  }
                }
              }
            } catch (queryErr: any) {
              console.error("[MongoDB Auth] Batch query error:", queryErr.message);
            }
          }

          return data;
        },
        set: async (data: any) => {
          const bulkOps: any[] = [];

          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;

              if (value) {
                memoryCache.set(key, value);
                try {
                  const stringified = JSON.stringify(value, BufferJSON.replacer);
                  bulkOps.push({
                    updateOne: {
                      filter: { hospitalId, id: key },
                      update: { $set: { data: stringified } },
                      upsert: true,
                    },
                  });
                } catch (e) {}
              } else {
                memoryCache.delete(key);
                bulkOps.push({
                  deleteOne: {
                    filter: { hospitalId, id: key },
                  },
                });
              }
            }
          }

          // Non-blocking background bulkWrite for fast message processing
          if (bulkOps.length > 0) {
            WhatsAppAuth.bulkWrite(bulkOps, { ordered: false }).catch((err: any) => {
              console.warn("[MongoDB Auth] Background bulkWrite warning:", err.message);
            });
          }
        },
      },
    },
    saveCreds: () => {
      memoryCache.set("creds", creds);
      return writeData(creds, "creds");
    },
    clearState,
  };
};

export default useMongoDBAuthState;

