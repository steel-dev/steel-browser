export const INITIAL_FILES = {
    'index.ts': {
        file: {
            contents: `// run the following commands in the terminal
// 1. \`export STEEL_API_KEY=your_api_key_here\`
// 2. \`npm start\`

import puppeteer from "puppeteer";
import Steel from "steel-sdk";
import dotenv from "dotenv";

dotenv.config();

const STEEL_API_KEY = process.env.STEEL_API_KEY;
// Initialize Steel client with the API key from environment variables
const client = new Steel({
steelAPIKey: STEEL_API_KEY,
});

async function main() {
let session;
let browser;

try {
console.log("Creating Steel session...");

// Create a new Steel session with all available options
session = await client.sessions.create({
// === Basic Options ===
// useProxy: true, // Use Steel's proxy network (residential IPs)
// proxyUrl: 'http://...',         // Use your own proxy (format: protocol://username:password@host:port)
// solveCaptcha: true,             // Enable automatic CAPTCHA solving
// sessionTimeout: 1800000,        // Session timeout in ms (default: 15 mins, max: 60 mins)
// === Browser Configuration ===
// userAgent: 'custom-ua-string',  // Set a custom User-Agent
});

console.log(\`Session created successfully with Session ID: \${session.id}.
You can view the session live at \${session.sessionViewerUrl}
\`);

// Connect Puppeteer to the Steel session
browser = await puppeteer.connect({
browserWSEndpoint: \`wss://connect.steel.dev?apiKey=\${STEEL_API_KEY}&sessionId=\${session.id}\`,
});

console.log("Connected to browser via Puppeteer");

// Create a new page
const page = await browser.newPage();

// ============================================================
// Your Automations Go Here!
// ============================================================

// Example script - Navigate to Hacker News and extract the top 5 stories (you can delete this)
// Navigate to Hacker News
console.log("Navigating to Hacker News...");
await page.goto("https://news.ycombinator.com", {
waitUntil: "networkidle0",
});

// Extract the top 5 stories
const stories = await page.evaluate(() => {
const items = [];
// Get all story items
const storyRows = document.querySelectorAll("tr.athing");

// Loop through first 5 stories
for (let i = 0; i < 5; i++) {
const row = storyRows[i];
const titleElement = row.querySelector(".titleline > a");
const subtext = row.nextElementSibling;
const score = subtext?.querySelector(".score");

items.push({
title: titleElement?.textContent || "",
link: titleElement?.getAttribute("href") || "",
points: score?.textContent?.split(" ")[0] || "0",
});
}
return items;
});

// Print the results
console.log("\\nTop 5 Hacker News Stories:");
stories.forEach((story, index) => {
console.log(\`\\n\${index + 1}. \${story.title}\`);
console.log(\`   Link: \${story.link}\`);
console.log(\`   Points: \${story.points}\`);
});

// ============================================================
// End of Automations
// ============================================================
} catch (error) {
console.error("An error occurred:", error);
} finally {
// Cleanup: Gracefully close browser and release session when done (even when an error occurs)
if (browser) {
await browser.close();
console.log("Browser closed");
}

if (session) {
console.log("Releasing session...");
await client.sessions.release(session.id);
console.log("Session released");
}

console.log("Done!");
}
}

// Run the script
main();
            `
        }
    },
    'package.json': {
        file: {
            contents: `{
"name": "steel-puppeteer-starter",
"version": "1.0.0",
"description": "A starter project for using Puppeteer with Steel on Node.js & TypeScript",
"main": "index.ts",
"scripts": {
"test": "echo \\"Error: no test specified\\" && exit 1",
"start": "ts-node index.ts"
},
"keywords": [],
"author": "",
"license": "ISC",
"dependencies": {
"@types/node": "^22.9.0",
"dotenv": "^16.4.5",
"puppeteer": "^23.8.0",
"steel-sdk": "^0.1.0-beta.2",
"typescript": "^5.6.3",
"uuid": "^11.0.3"
},
"devDependencies": {
"ts-node": "^10.9.2"
}
}`}
    },
    'tsconfig.json': {
        file: {
            contents: `{
"compilerOptions": {
"target": "es2016",
"module": "commonjs",
"esModuleInterop": true,
"forceConsistentCasingInFileNames": true,
"strict": true,
"skipLibCheck": true,
"lib": ["ES2016", "DOM"]
}
}`}
    },
    'main.py': {
        file: {
            contents: `import os
from typing import Optional
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from steel import Steel
import time 

# Load environment variables from .env file
load_dotenv()

STEEL_API_KEY = "hello"

# Initialize Steel client with the API key from environment variables
client = Steel(steel_api_key=STEEL_API_KEY, base_url="http://localhost:3000")


def main():
    session = None
    browser = None

    try:
        print("Creating Steel session...")

        # Create a new Steel session with all available options
        session = client.sessions.create(
            session_id="026a843c-9d90-446a-ae1f-78fd9107acab"
            # === Basic Options ===
            # use_proxy=True,              # Use Steel's proxy network (residential IPs)
            # proxy_url='http://...',      # Use your own proxy (format: protocol://username:password@host:port)
            # solve_captcha=True,          # Enable automatic CAPTCHA solving
            # session_timeout=1800000,     # Session timeout in ms (default: 15 mins, max: 60 mins)
            # === Browser Configuration ===
            # user_agent='custom-ua',      # Set a custom User-Agent
        )

        print(f"""Session created successfully with Session ID: {session.id}.
You can view the session live at {session.session_viewer_url}
        """)

        # Connect Playwright to the Steel session
        playwright = sync_playwright().start()
        browser = playwright.chromium.connect_over_cdp(
            f"ws://localhost:3000?apiKey={STEEL_API_KEY}&sessionId={session.id}"
        )

        print("Connected to browser via Playwright")

        # Create page at existing context to ensure session is recorded.
        currentContext = browser.contexts[0]
        page = currentContext.new_page()

        # ============================================================
        # Your Automations Go Here!
        # ============================================================

        # Example script - Navigate to Hacker News and extract the top 5 stories
        print("Navigating to Hacker News...")
        page.goto("https://news.ycombinator.com", wait_until="networkidle")
        time.sleep(3)
        # Find all story rows
        story_rows = page.locator("tr.athing").all()[:5]  # Get first 5 stories

        # Extract the top 5 stories using Playwright's locators
        print("\\nTop 5 Hacker News Stories:")
        for i, row in enumerate(story_rows, 1):
            # Get the title and link from the story row
            title_element = row.locator(".titleline > a")
            title = title_element.text_content()
            link = title_element.get_attribute("href")

            # Get points from the following row
            points_element = row.locator(
                "xpath=following-sibling::tr[1]").locator(".score")
            points = points_element.text_content().split(
            )[0] if points_element.count() > 0 else "0"

            # Print the story details
            print(f"\\n{i}. {title}")
            print(f"   Link: {link}")
            print(f"   Points: {points}")

        # ============================================================
        # End of Automations
        # ============================================================

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        # Cleanup: Gracefully close browser and release session when done
        if browser:
            browser.close()
            print("Browser closed")

        if session:
            print("Releasing session...")
            client.sessions.release(session.id)
            print("Session released")

        print("Done!")


# Run the script
if __name__ == "__main__":
    main()`
        }
    }
}