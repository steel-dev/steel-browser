import { Page } from "puppeteer-core";
import {
  SessionData,
  IndexedDBDatabase,
  IndexedDBObjectStore,
  IndexedDBRecord,
  SessionStorageData,
  LocalStorageData,
} from "../services/context/types.js";
import { FastifyBaseLogger } from "fastify";
import { BrowserLauncherOptions } from "../types/index.js";
/**
 * Extract storage data for a single origin
 * @param client CDP session
 * @param origin Origin to process
 * @returns Storage data for the origin
 */
export async function extractStorageForPage(page: Page, logger: FastifyBaseLogger): Promise<SessionData> {
  const result: SessionData = {
    localStorage: {},
    sessionStorage: {},
    indexedDB: {},
  };

  try {
    // Skip pages that aren't valid or don't have a proper URL
    const url = page.url();
    if (!url || !url.startsWith("http")) {
      return result;
    }

    // Extract origin and domain from URL
    const origin = new URL(url).origin;
    const domain = new URL(url).hostname;

    const client = await page.target().createCDPSession();

    try {
      // Check if the page has a valid main frame
      const { frameTree } = await client.send("Page.getFrameTree").catch(() => ({ frameTree: null }));
      if (!frameTree) {
        logger.debug(`[CDPService] Page has no valid frame tree for ${domain}`);
        return result;
      }

      // Get localStorage using CDP
      try {
        const localStorageResponse = await client.send("DOMStorage.getDOMStorageItems", {
          storageId: { securityOrigin: origin, isLocalStorage: true },
        });

        if (localStorageResponse?.entries?.length) {
          result.localStorage![domain] = {};
          for (const [key, value] of localStorageResponse.entries) {
            result.localStorage![domain][key] = value;
          }
        }
      } catch (err) {
        // Lower log level to avoid flooding logs with expected errors
        logger.trace(`[CDPService] Could not get localStorage for ${domain}: ${err}`);
      }

      // Get sessionStorage (note: only works for active pages)
      try {
        const sessionStorageResponse = await client.send("DOMStorage.getDOMStorageItems", {
          storageId: { securityOrigin: origin, isLocalStorage: false },
        });

        if (sessionStorageResponse?.entries?.length) {
          result.sessionStorage![domain] = {};
          for (const [key, value] of sessionStorageResponse.entries) {
            result.sessionStorage![domain][key] = value;
          }
        }
      } catch (err) {
        // Lower log level to avoid flooding logs with expected errors
        logger.trace(`[CDPService] Could not get sessionStorage for ${domain}: ${err}`);
      }

      // Get IndexedDB databases
      try {
        const dbResponse = await client.send("IndexedDB.requestDatabaseNames", {
          securityOrigin: origin,
        });

        const databaseNames = dbResponse?.databaseNames || [];

        if (databaseNames.length) {
          result.indexedDB![domain] = [];

          // Process each database
          for (let dbIndex = 0; dbIndex < databaseNames.length; dbIndex++) {
            const dbName = databaseNames[dbIndex];

            // Create a properly structured database object
            const database: IndexedDBDatabase = {
              id: dbIndex,
              name: dbName,
              data: [],
            };

            // Get database schema
            const dbSchemaResponse = await client.send("IndexedDB.requestDatabase", {
              securityOrigin: origin,
              databaseName: dbName,
            });

            // Access object stores safely
            const objectStores = dbSchemaResponse?.databaseWithObjectStores?.objectStores || [];

            // Process each object store
            for (let storeIndex = 0; storeIndex < objectStores.length; storeIndex++) {
              const store = objectStores[storeIndex];

              // Create a properly structured object store
              const objectStore: IndexedDBObjectStore = {
                id: storeIndex,
                name: store.name,
                records: [],
              };

              // Paginate through all records
              let hasMoreData = true;
              let skipCount = 0;
              const pageSize = 1000;

              while (hasMoreData) {
                const dataResponse = await client.send("IndexedDB.requestData", {
                  securityOrigin: origin,
                  databaseName: dbName,
                  objectStoreName: store.name,
                  indexName: "", // Empty string means use primary key
                  skipCount,
                  pageSize,
                });

                // Add the retrieved data
                const objectStoreData = dataResponse?.objectStoreDataEntries || [];
                if (objectStoreData.length) {
                  // Map the data to the correct record format
                  const records: IndexedDBRecord[] = objectStoreData.map((entry) => ({
                    key: entry.key,
                    value: entry.value,
                    // TODO: Add blob files
                  }));

                  objectStore.records.push(...records);
                }

                // Check if we need to continue pagination
                hasMoreData = !!dataResponse?.hasMore;
                skipCount += objectStoreData.length;

                // Safety check to prevent infinite loops
                if (objectStoreData.length === 0) break;
              }

              // Add the object store to the database
              database.data.push(objectStore);
            }

            // Add the database to the result
            result.indexedDB![domain].push(database);
          }
        }
      } catch (err) {
        // Lower log level to avoid flooding logs with expected errors
        logger.trace(`[CDPService] Could not get IndexedDB for ${domain}: ${err}`);
      }
    } finally {
      // Always ensure the client session is detached
      await client.detach().catch(() => {});
    }
  } catch (err) {
    logger.warn(`[CDPService] Error extracting storage for page: ${err}`);
  }

  return result;
}

// Create our frameNavigated handler
export const handleFrameNavigated = async (
  frame: any,
  storageByOrigin: Map<
    string,
    {
      localStorage?: LocalStorageData;
      sessionStorage?: SessionStorageData;
      indexedDB?: IndexedDBDatabase[];
    }
  >,
  logger: FastifyBaseLogger,
) => {
  // Only process top-level frames
  if (frame.parentFrame()) return;

  try {
    const url = frame.url();
    if (!url || !url.startsWith("http")) return;

    // Extract the origin from the URL
    const origin = new URL(url).origin;

    // Check if we have storage for this origin
    const storage = storageByOrigin.get(origin);
    if (!storage) return;

    logger.debug(`[CDPService] Injecting storage for navigated origin: ${origin}`);

    // Set localStorage if available
    if (storage.localStorage) {
      await frame.evaluate((items) => {
        for (const [key, value] of Object.entries(items)) {
          try {
            if (typeof value === "string") {
              localStorage.setItem(key, value);
            }
          } catch (e) {
            console.error(`Error setting localStorage: ${e}`);
          }
        }
      }, storage.localStorage);
    }

    // Set sessionStorage if available
    if (storage.sessionStorage) {
      await frame.evaluate((items) => {
        for (const [key, value] of Object.entries(items)) {
          try {
            if (typeof value === "string") {
              sessionStorage.setItem(key, value);
            }
          } catch (e) {
            console.error(`Error setting sessionStorage: ${e}`);
          }
        }
      }, storage.sessionStorage);
    }

    // Set IndexedDB if available
    if (storage.indexedDB && storage.indexedDB.length > 0) {
      for (const database of storage.indexedDB) {
        if (!database.name || !database.data) continue;

        // Create a store map for this database
        const storeMap = {};

        for (const store of database.data) {
          if (!store.name || !store.records || store.records.length === 0) continue;

          storeMap[store.name] = store.records.map((record) => {
            try {
              // Parse the key and value if they're stored as strings
              const parsedKey = typeof record.key === "string" ? JSON.parse(record.key) : record.key;
              const parsedValue = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
              return { key: parsedKey, value: parsedValue };
            } catch (e) {
              // Fall back to original values if parsing fails
              return { key: record.key, value: record.value };
            }
          });
        }

        if (Object.keys(storeMap).length === 0) continue;

        await frame.evaluate(
          async (dbName, stores) => {
            return new Promise((resolve, reject) => {
              try {
                const openRequest = indexedDB.open(dbName, 1);

                openRequest.onupgradeneeded = function (event) {
                  const db = (event.target as IDBOpenDBRequest).result;

                  // Create object stores from our data
                  for (const storeName of Object.keys(stores)) {
                    if (!db.objectStoreNames.contains(storeName)) {
                      db.createObjectStore(storeName, { keyPath: "key" });
                    }
                  }
                };

                openRequest.onsuccess = function (event) {
                  const db = (event.target as IDBOpenDBRequest).result;
                  let completedStores = 0;
                  const totalStores = Object.keys(stores).length;

                  for (const [storeName, storeData] of Object.entries(stores)) {
                    if (!db.objectStoreNames.contains(storeName)) {
                      // Skip if object store doesn't exist and can't be created
                      completedStores++;
                      continue;
                    }

                    const transaction = db.transaction(storeName, "readwrite");
                    const objectStore = transaction.objectStore(storeName);

                    // Add all items
                    for (const item of storeData as any[]) {
                      try {
                        objectStore.put(item);
                      } catch (e) {
                        console.error(`Error adding item to IndexedDB: ${e}`);
                      }
                    }

                    transaction.oncomplete = function () {
                      completedStores++;
                      if (completedStores === totalStores) {
                        resolve(true);
                      }
                    };

                    transaction.onerror = function (err) {
                      console.error(`Transaction error: ${err}`);
                      completedStores++;
                      if (completedStores === totalStores) {
                        resolve(false);
                      }
                    };
                  }

                  // Handle case with no stores
                  if (totalStores === 0) {
                    resolve(true);
                  }
                };

                openRequest.onerror = function (event) {
                  reject(`Error opening IndexedDB: ${(event.target as IDBOpenDBRequest).error}`);
                };
              } catch (e) {
                reject(`IndexedDB restore error: ${e}`);
              }
            });
          },
          database.name,
          storeMap,
        );
      }
    }
  } catch (err) {
    logger.error(`[CDPService] Error injecting storage during navigation: ${err}`);
  }
};

/**
 * Organizes session storage data by origin for efficient lookup
 * @param context Session context data from BrowserLauncherOptions
 * @returns Map of origins to their storage data
 */
export function groupSessionStorageByOrigin(context?: BrowserLauncherOptions["sessionContext"]): Map<
  string,
  {
    localStorage?: LocalStorageData;
    sessionStorage?: SessionStorageData;
    indexedDB?: IndexedDBDatabase[];
  }
> {
  // Set up origin maps for quick lookups
  const storageByOrigin = new Map<
    string,
    {
      localStorage?: LocalStorageData;
      sessionStorage?: SessionStorageData;
      indexedDB?: IndexedDBDatabase[];
    }
  >();

  if (!context) return storageByOrigin;

  // Prepare data for lookup by origin
  if (context.localStorage) {
    Object.entries(context.localStorage).forEach(([origin, data]) => {
      if (!storageByOrigin.has(origin)) {
        storageByOrigin.set(origin, {});
      }
      storageByOrigin.get(origin)!.localStorage = data;
    });
  }

  if (context.sessionStorage) {
    Object.entries(context.sessionStorage).forEach(([origin, data]) => {
      if (!storageByOrigin.has(origin)) {
        storageByOrigin.set(origin, {});
      }
      storageByOrigin.get(origin)!.sessionStorage = data;
    });
  }

  if (context.indexedDB) {
    Object.entries(context.indexedDB).forEach(([origin, data]) => {
      if (!storageByOrigin.has(origin)) {
        storageByOrigin.set(origin, {});
      }
      storageByOrigin.get(origin)!.indexedDB = data;
    });
  }

  return storageByOrigin;
}
