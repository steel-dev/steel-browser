import { chromium, Browser, Page } from "playwright";
import fetch from "node-fetch";
import assert from "assert";
import buildFastifyServer from "../src/build-server";
// import { IndexedDBData } from "../src/services/cdp/plugins/session/types";
import { FastifyInstance } from "fastify";

async function setLocalStorage(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("test-key1", "test-value1");
    localStorage.setItem("test-key2", "test-value2");
    console.log("localStorage set successfully");
  });
}

async function setSessionStorage(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem("session-key1", "session-value1");
    sessionStorage.setItem("session-key2", "session-value2");
    console.log("sessionStorage set successfully");
  });
}

async function setCookies(page: Page) {
  await page.context().addCookies([
    {
      name: "test-cookie1",
      value: "cookie-value1",
      domain: "example.com",
      path: "/",
    },
    {
      name: "test-cookie2",
      value: "cookie-value2",
      domain: "example.com",
      path: "/",
    },
  ]);
  console.log("Cookies set successfully");
}

async function setupIndexedDB(page: Page) {
  return page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const dbName = "testDatabase";
      const request = indexedDB.deleteDatabase(dbName);

      request.onsuccess = () => {
        console.log("Previous database deleted successfully");
        const openRequest = indexedDB.open(dbName, 1);

        openRequest.onerror = (event) => {
          console.error("IndexedDB error:", event);
          reject(new Error("Failed to open IndexedDB"));
        };

        openRequest.onupgradeneeded = (event) => {
          // @ts-ignore
          const db = event.target.result;
          // Create an object store
          const store = db.createObjectStore("testStore", { keyPath: "id" });
          store.createIndex("name", "name", { unique: false });
          console.log("Object store created successfully");
        };

        openRequest.onsuccess = (event) => {
          // @ts-ignore
          const db = event.target.result;

          const transaction = db.transaction(["testStore"], "readwrite");
          const store = transaction.objectStore("testStore");

          // Add some data
          const item1Request = store.put({ id: 1, name: "Item 1", value: "Example value 1" });
          const item2Request = store.put({ id: 2, name: "Item 2", value: "Example value 2" });

          transaction.oncomplete = () => {
            console.log("IndexedDB data added successfully");
            db.close();
            // Wait a bit to ensure the data is committed
            setTimeout(resolve, 500);
          };

          transaction.onerror = (event) => {
            console.error("IndexedDB transaction error:", event);
            reject(new Error("Failed to add data to IndexedDB"));
          };
        };
      };

      request.onerror = (event) => {
        console.error("Failed to delete previous database:", event);
        // Continue anyway
        reject(new Error("Failed to delete previous database"));
      };
    });
  });
}

async function getIndexedDBData(page: Page) {
  const data = await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const dbName = "testDatabase";
      const request = indexedDB.open(dbName, 1);

      request.onerror = (event) => {
        console.error("IndexedDB error:", event);
        reject(new Error("Failed to get IndexedDB data"));
      };

      request.onsuccess = (event) => {
        // @ts-ignore
        const db = event.target.result;
        const transaction = db.transaction(["testStore"], "readonly");
        const store = transaction.objectStore("testStore");
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
          console.log("Retrieved IndexedDB data:", JSON.stringify(getAllRequest.result));
          db.close();
          resolve(getAllRequest.result);
        };

        getAllRequest.onerror = (event) => {
          console.error("Failed to get all items:", event);
          db.close();
          reject(new Error("Failed to get all items"));
        };
      };
    });
  });

  return data;
}

async function validateIndexedDBData(contextData: any) {
  assert(contextData.indexedDB && typeof contextData.indexedDB === "object", "indexedDB data missing");

  const indexedDBOrigin = Object.keys(contextData.indexedDB).find((origin) => origin.includes("example.com"));
  assert(indexedDBOrigin, "example.com origin not found in indexedDB data");
}

async function validateStorageData(contextData: any) {
  // Validate localStorage
  assert(contextData.localStorage && typeof contextData.localStorage === "object", "localStorage data missing");
  const exampleDomain = Object.keys(contextData.localStorage).find((domain) => domain.includes("example.com"));
  assert(exampleDomain, "example.com domain not found in localStorage data");

  const localStorageData = contextData.localStorage[exampleDomain];
  assert(localStorageData["test-key1"] === "test-value1", "localStorage test-key1 not found or has wrong value");
  assert(localStorageData["test-key2"] === "test-value2", "localStorage test-key2 not found or has wrong value");

  // Validate sessionStorage
  assert(contextData.sessionStorage && typeof contextData.sessionStorage === "object", "sessionStorage data missing");
  const sessionDomain = Object.keys(contextData.sessionStorage).find((domain) => domain.includes("example.com"));
  assert(sessionDomain, "example.com domain not found in sessionStorage data");

  const sessionStorageData = contextData.sessionStorage[sessionDomain];
  assert(
    sessionStorageData["session-key1"] === "session-value1",
    "sessionStorage session-key1 not found or has wrong value",
  );
  assert(
    sessionStorageData["session-key2"] === "session-value2",
    "sessionStorage session-key2 not found or has wrong value",
  );

  // Validate cookies
  assert(Array.isArray(contextData.cookies), "cookies array missing");
  const exampleCookies = contextData.cookies.filter((cookie: any) => cookie.domain.includes("example.com"));
  assert(exampleCookies.length >= 2, "Expected at least 2 cookies for example.com");

  const cookie1 = exampleCookies.find((c: any) => c.name === "test-cookie1");
  const cookie2 = exampleCookies.find((c: any) => c.name === "test-cookie2");

  assert(cookie1 && cookie1.value === "cookie-value1", "Cookie test-cookie1 not found or has wrong value");
  assert(cookie2 && cookie2.value === "cookie-value2", "Cookie test-cookie2 not found or has wrong value");

  // Validate IndexedDB
  assert(contextData.indexedDB && typeof contextData.indexedDB === "object", "indexedDB data missing");

  const indexedDBOrigin = Object.keys(contextData.indexedDB).find((origin) => origin.includes("example.com"));
  assert(indexedDBOrigin, "example.com origin not found in indexedDB data");

  const databases = contextData.indexedDB[indexedDBOrigin];
  assert(Array.isArray(databases), "indexedDB databases should be an array");

  const testDb = databases.find((db: any) => db.name === "testDatabase");
  assert(testDb, "testDatabase not found in IndexedDB data");
}

async function runTest() {
  console.log("Starting storage API test...");

  let browser: Browser | null = null;
  let contextData: any;
  let server: FastifyInstance | null = null;

  try {
    // Start server
    server = await buildFastifyServer({
      logger: false,
      disableRequestLogging: true,
      trustProxy: true,
      bodyLimit: 100000000,
    });

    await server.listen({ port: 3000 });

    console.log("Server started on http://127.0.0.1:3000");

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const sessionResponse = await fetch("http://127.0.0.1:3000/v1/sessions", {
      method: "POST",
      body: JSON.stringify({}),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const sessionId = (await sessionResponse.json()).id;

    // Launch browser
    browser = await chromium.connectOverCDP("ws://127.0.0.1:3000");
    const context = await browser.contexts()[0];
    const page = (await context.pages()[0]) ?? (await context.newPage());

    console.log("Navigating to example.com...");
    await page.goto("https://example.com");

    // Set up all storage mechanisms
    console.log("Setting localStorage values...");
    await setLocalStorage(page);

    console.log("Setting sessionStorage values...");
    await setSessionStorage(page);

    console.log("Setting cookies...");
    await setCookies(page);

    console.log("Setting up IndexedDB...");
    await setupIndexedDB(page);

    // Wait to ensure all storage operations are complete
    await page.waitForTimeout(2000);

    // Call the API to get context data
    console.log("Fetching browser context data from API...");
    const response = await fetch(`http://127.0.0.1:3000/v1/sessions/${sessionId}/context`);

    if (!response.ok) {
      console.log("sessionId", sessionId);
      throw new Error(`API request failed with status ${response.status}`);
    }

    contextData = await response.json();

    // Validate that the API retrieves the correct storage data
    await validateStorageData(contextData);

    console.log("✅ All validation checks passed!");
  } catch (error) {
    console.error("Test failed:", error);
    console.log("Context data:", JSON.stringify(contextData, null, 2));
    process.exit(1);
  } finally {
    // Clean up
    if (browser) {
      await browser.close();
    }

    if (server) {
      await server.close();
    }
  }
}

// Run the test
runTest().catch(console.error);
