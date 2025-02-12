import puppeteer from "puppeteer-core";

async function run() {
  // WebSocket endpoint to connect Browser using Chrome DevTools Protocol (CDP)
  const wsEndpoint = "ws://0.0.0.0:3000";

  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  const page = await browser.newPage();

  // Navigate to a website and log the title
  await page.goto("https://steel.dev");
  console.log(`Page title: ${await page.title()}`);

  // Cleanup: close all pages and disconnect browser
  await Promise.all((await browser.pages()).map((p) => p.close()));
  await browser.disconnect();
}

run().catch(console.error);
