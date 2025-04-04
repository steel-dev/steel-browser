import { Page, CDPSession } from "puppeteer-core";
import {
  StorageProvider,
  StorageProviderName,
  CDPIndexedDBDatabaseNames,
  IndexedDBDatabaseSchema,
  IndexedDBSchema,
} from "../types";
import { dexieCore, dexieExportImport } from "../constants/dexie";

/**
 * IndexedDB Storage Provider using Dexie.js for database operations
 *
 * This provider implements full IndexedDB database export/import functionality
 * for session management in the CDPService.
 */
export class IndexedDBStorageProvider implements StorageProvider {
  public name: StorageProviderName = StorageProviderName.IndexedDB;
  private debugMode: boolean;

  constructor(options: { debugMode?: boolean } = {}) {
    this.debugMode = options.debugMode || false;
  }

  /**
   * Get IndexedDB data from the page
   *
   * This method:
   * 1. Gets the security origin of the current page
   * 2. Retrieves all database names for that origin using CDP
   * 3. Exports each database using Dexie.js
   * 4. Returns the serialized database data
   */
  public async get(page: Page): Promise<string> {
    try {
      // Get current page origin
      const securityOrigin = await page.evaluate(() => location.origin);

      // Get all database names for this origin using CDP
      const dbNames = await this.getDatabaseNames(page, securityOrigin);

      // If no databases found, return empty array
      if (!dbNames.length) {
        return "[]";
      }

      // Export each database using Dexie.js
      const indexedDBs = await Promise.all(dbNames.map((db) => this.getIndexedDB(page, db)));

      // Format the results as expected by the session manager
      return JSON.stringify(
        dbNames.map((db, index) => ({
          name: db,
          data: indexedDBs[index],
          securityOrigin,
        })),
      );
    } catch (error) {
      console.error("[IndexedDBStorageProvider] Error getting IndexedDB data:", error);
      return "[]";
    }
  }

  /**
   * Restore IndexedDB data to the page
   *
   * This method:
   * 1. Parses the provided data
   * 2. For each database, navigates to the correct origin if necessary
   * 3. Imports the database using Dexie.js
   */
  public async set(page: Page, data: string): Promise<void> {
    try {
      // Parse the database data
      const databases = IndexedDBDatabaseSchema.array().parse(JSON.parse(data));

      // If no databases to restore, exit early
      if (!databases.length) {
        return;
      }

      // Process each database
      for (const db of databases) {
        // Navigate to the correct origin if necessary
        if (!page.url().includes(db.securityOrigin)) {
          if (this.debugMode) console.log(`[IndexedDBStorageProvider] Navigating to ${db.securityOrigin}`);
          await page.goto(db.securityOrigin);
        }

        // Import the database using Dexie.js
        await this.setIndexedDB(page, db.data);
      }
    } catch (error) {
      console.error("[IndexedDBStorageProvider] Error setting IndexedDB data:", error);
    }
  }

  /**
   * Get all database names for a specific origin using CDP
   */
  private async getDatabaseNames(page: Page, securityOrigin: string): Promise<string[]> {
    let session: CDPSession | null = null;

    try {
      // Create CDP session
      session = await page.target().createCDPSession();

      // Request database names from CDP
      const response = await session.send("IndexedDB.requestDatabaseNames", {
        securityOrigin,
      });

      // Parse and validate the response
      const { databaseNames } = CDPIndexedDBDatabaseNames.parse(response);

      if (this.debugMode && databaseNames.length > 0) {
        console.log(`[IndexedDBStorageProvider] Found databases: ${databaseNames.join(", ")}`);
      }

      return databaseNames;
    } catch (err) {
      if ((err as Error).message.includes("No document for given frame found")) {
        // This is an expected error when the page hasn't loaded yet
        return [];
      }

      // Rethrow other errors
      throw err;
    } finally {
      // Always detach the session when done
      if (session) await session.detach().catch(() => {});
    }
  }

  /**
   * Export a database using Dexie.js
   */
  private async getIndexedDB(page: Page, dbName: string): Promise<string> {
    if (this.debugMode) console.log(`[IndexedDBStorageProvider] Exporting database: ${dbName}`);

    const result = await page.evaluate(this.generateGetContentScript(dbName));
    return IndexedDBSchema.parse(result);
  }

  /**
   * Import a database using Dexie.js
   */
  private async setIndexedDB(page: Page, data: string): Promise<void> {
    if (this.debugMode) console.log("[IndexedDBStorageProvider] Importing database");

    await page.evaluate(this.generateSetContentScript(data));
  }

  /**
   * Generate JavaScript for exporting a database
   */
  private generateGetContentScript(dbName: string): string {
    return `
    (async() => {
      // Required for some websites to avoid conflicts
      define = undefined;
      exports = undefined;
      if (window.module) module.exports = undefined;

      ${dexieCore}
      ${dexieExportImport}
      
      try {
        const db = await new Dexie("${dbName}").open();
        const blob = await db.export();
        const text = await blob.text();
        return text;
      } catch (error) {
        console.error("Error exporting IndexedDB:", error);
        return "{}";
      }
    })()`;
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
