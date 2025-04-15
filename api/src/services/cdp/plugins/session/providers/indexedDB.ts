import { Page } from "puppeteer-core";
import { StorageProvider, StorageProviderName, IndexedDBData } from "../types";
import { dexieCore, dexieExportImport } from "../constants/dexie";
import { FastifyBaseLogger } from "fastify";

/**
 * IndexedDB Storage Provider
 *
 * This provider implements full IndexedDB database export/import functionality
 * for session management in the CDPService.
 */
export class IndexedDBStorageProvider extends StorageProvider<StorageProviderName.IndexedDB> {
  public name: StorageProviderName.IndexedDB = StorageProviderName.IndexedDB;

  // Cache of IndexedDB data by security origin and database name
  private indexedDBData: Record<string, IndexedDBData> = {};

  constructor(options: { debugMode?: boolean; logger?: FastifyBaseLogger } = {}) {
    super();
    this.debugMode = options.debugMode || false;
    this.logger = options.logger;
  }

  /**
   * Get IndexedDB data from the page
   *
   * This method:
   * 1. Gets the security origin of the current page
   * 2. Retrieves all database names for that origin using CDP
   * 3. Exports each database using Dexie.js
   * 4. Returns the serialized database data for the current origin only
   */
  public async getCurrentData(page: Page): Promise<IndexedDBData> {
    try {
      if (page.url() === "about:blank") {
        return [];
      }

      this.log("Retrieving IndexedDB data from current page", false, "debug");

      const [securityOrigin, databases] = (await page.evaluate(async () => {
        const results = [];
        let foundDatabases = [];
        try {
          // @ts-ignore
          foundDatabases = await window.indexedDB.databases();
          console.log("Found databases:", foundDatabases);
        } catch (e) {
          console.error("Error getting databases:", e);
        }

        const securityOrigin = window.location.origin;
        console.log("Current security origin:", securityOrigin);

        const connect = (database: any) =>
          new Promise(function (resolve, _) {
            const request = window.indexedDB.open(database.name, database.version);
            request.onsuccess = (_) => resolve(request.result);
            request.onerror = (e) => {
              console.error("Error opening database:", e);
              resolve(null);
            };
          });

        const getAll = (db: any, objectStoreName: string) =>
          new Promise(function (resolve, _) {
            const request = db.transaction([objectStoreName]).objectStore(objectStoreName).getAll();
            request.onsuccess = (_) => resolve(request.result);
            request.onerror = (e) => {
              console.error("Error getting data from store:", e);
              resolve([]);
            };
          });

        for (let i = 0; i < foundDatabases.length; i++) {
          const db = await connect(foundDatabases[i]);
          if (!db) continue;

          // @ts-ignore
          const dbName = db.name;
          let data = [];
          // @ts-ignore
          for (let j = 0; j < db.objectStoreNames.length; j++) {
            // @ts-ignore
            const objectStoreName = db.objectStoreNames[j];
            const values = await getAll(db, objectStoreName);
            // @ts-ignore
            data.push({
              name: objectStoreName,
              values,
            });
          }
          // @ts-ignore
          results.push({
            name: dbName,
            data,
            securityOrigin,
          });
          // @ts-ignore
          if (db.close) db.close();
        }

        return [securityOrigin, results];
      })) as [string, IndexedDBData];

      // Update our cached data
      this.updateCache(securityOrigin, databases);

      this.log(`Retrieved ${databases.length} IndexedDB databases from ${securityOrigin}`, false, "debug");

      // Return only the current origin's data
      return this.indexedDBData[securityOrigin] || [];
    } catch (error) {
      this.log(`Error getting IndexedDB data: ${error}`, true);
      // Try to get origin from URL if evaluate failed
      try {
        const url = page.url();
        if (url && url !== "about:blank") {
          const origin = new URL(url).origin;
          return this.indexedDBData[origin] || [];
        }
      } catch (e) {
        // Ignore error
      }
      return [];
    }
  }

  /**
   * Restore IndexedDB data to the page
   *
   * This method:
   * 1. Parses the provided data if it's a string
   * 2. For each database, checks if it matches the current origin
   * 3. Imports the database using Dexie.js
   */
  public async inject(page: Page): Promise<void> {
    try {
      const url = page.url();
      if (url === "about:blank") {
        return;
      }

      const currentOrigin = new URL(url).origin;

      const databases = this.indexedDBData[currentOrigin];

      // Filter databases to only those matching the current origin
      const currentOriginDatabases = databases.filter((db) => db.securityOrigin === currentOrigin);

      // If no databases to restore for this origin, exit early
      if (!currentOriginDatabases.length) {
        this.log(`No IndexedDB databases to restore for ${currentOrigin}`, false, "debug");
        return;
      }

      this.log(`Restoring ${currentOriginDatabases.length} IndexedDB databases for ${currentOrigin}`, false, "debug");

      // Update our cached data
      databases.forEach((db) => {
        const origin = db.securityOrigin;
        if (!this.indexedDBData[origin]) {
          this.indexedDBData[origin] = [];
        }

        // Replace or add the database in our cache
        const existingDbIndex = this.indexedDBData[origin].findIndex((existingDb) => existingDb.name === db.name);

        if (existingDbIndex >= 0) {
          this.indexedDBData[origin][existingDbIndex] = db;
        } else {
          this.indexedDBData[origin].push(db);
        }
      });

      // Process each database for the current origin
      let processedDatabases = 0;
      for (const db of currentOriginDatabases) {
        // Convert data to string if it's not already
        const dbData = typeof db.data === "string" ? db.data : JSON.stringify(db.data);

        // Import the database using Dexie.js
        await this.setIndexedDB(page, dbData);
        processedDatabases++;
      }

      this.log(`Successfully processed ${processedDatabases} IndexedDB databases for ${currentOrigin}`, false, "info");
    } catch (error) {
      this.log(`Error setting IndexedDB data: ${error}`, true);
    }
  }

  public setAll(data: Record<string, IndexedDBData>): void {
    this.indexedDBData = data;
  }

  /**
   * Update the cache with new data
   */
  private updateCache(securityOrigin: string, databases: IndexedDBData): void {
    if (!this.indexedDBData[securityOrigin]) {
      this.indexedDBData[securityOrigin] = [];
    }

    // Update or add each database
    databases.forEach((db) => {
      const existingDbIndex = this.indexedDBData[securityOrigin].findIndex((existingDb) => existingDb.name === db.name);

      if (existingDbIndex >= 0) {
        this.indexedDBData[securityOrigin][existingDbIndex] = db;
      } else {
        this.indexedDBData[securityOrigin].push(db);
      }
    });

    this.log(
      `Updated cache for ${securityOrigin}, total databases: ${this.indexedDBData[securityOrigin].length}`,
      false,
      "debug",
    );
  }

  /**
   * Import a database using Dexie.js
   */
  private async setIndexedDB(page: Page, data: string): Promise<void> {
    this.log("Importing IndexedDB database", false, "debug");
    await page.evaluate(this.generateSetContentScript(data));
  }

  /**
   * Get all stored data from all origins
   */
  public getAllData(): Record<string, IndexedDBData> {
    const originsCount = Object.keys(this.indexedDBData).length;
    const totalDatabases = Object.values(this.indexedDBData).reduce((sum, dbs) => sum + dbs.length, 0);

    this.log(`Returning ${totalDatabases} IndexedDB databases from ${originsCount} origins`, false, "debug");
    return this.indexedDBData;
  }

  /**
   * Generate JavaScript for importing a database
   */
  private generateSetContentScript(data: string): string {
    return `
    (async() => {
      // Required for some websites to avoid conflicts
      define = undefined;
      exports = undefined;
      if (window.module) module.exports = undefined;

      ${dexieCore}
      ${dexieExportImport}
      
      try {
        const importBlob = new Blob([\`${data}\`], { type: "text/json" });
        const importDB = await Dexie.import(importBlob, { overwriteValues: true });
        return importDB.backendDB();
      } catch (error) {
        console.error("Error importing IndexedDB:", error);
        return null;
      }
    })()`;
  }
}
