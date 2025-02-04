<br />
<p align="center">
<a href="https://steel.dev">
  <img src="images/steel_header_logo.png" alt="Steel Logo" width="100">
</a>
</p>



<h3 align="center"><b>Steel</b></h3>
<p align="center">
    <b>The open-source browser API for AI agents & apps.</b> <br />
    The best way to build live web agents and browser automation tools.
</p>

<div align="center">
  
[![Commit Activity](https://img.shields.io/github/commit-activity/m/steel-dev/steel-browser?color=yellow)](https://github.com/steel-dev/steel-browser/commits/main)
[![License](https://img.shields.io/github/license/steel-dev/steel-browser?color=yellow)](https://github.com/steel-dev/steel-browser/blob/main/LICENSE)
[![Discord](https://img.shields.io/discord/1285696350117167226?label=discord)](https://discord.gg/steel-dev)
[![Twitter Follow](https://img.shields.io/twitter/follow/steeldotdev)](https://twitter.com/steeldotdev)
[![GitHub stars](https://img.shields.io/github/stars/steel-dev/steel-browser)](https://github.com/steel-dev/steel-browser)

</div>

<h4 align="center">
    <a href="https://app.steel.dev/sign-up" target="_blank">
      Get Started
  </a>  ·
    <a href="https://docs.steel.dev/" target="_blank">
      Documentation
  </a>  ·
  <a href="https://steel.dev/" target="_blank">
      Website
  </a> ·
  <a href="https://github.com/steel-dev/steel-cookbook" target="_blank">
      Cookbook
  </a>
</h4>

<p align="center">
  <img src="images/demo.gif" alt="Steel Demo" width="600">
</p>

[Steel.dev](https://steel.dev) is an open-source browser API that makes it easy to build AI apps and agents that interact with the web. Instead of building automation infrastructure from scratch, you can focus on your AI application while Steel handles the complexity.

**This repo is the core building block behind Steel - a production-ready, containerized browser sandbox that you can deploy anywhere.** It includes built-in stealth capabilities, text-to-markdown session management, UI to view/debug sessions, and full browser control through standard automation frameworks like Puppeteer, Playwright, and Selenium 🔥

> Steel is in public beta and evolving every day. Your suggestions, ideas, and reported bugs help us immensely. Do not hesitate to join in the conversation on [Discord](https://discord.gg/steel-dev) or raise a GitHub issue. We read everything, respond to most, and love you.

If you love open-source, AI, and dev tools, [we're hiring across the stack](https://steel-dev.notion.site/jobs-at-steel?pvs=74)!

## ⚡ Installation

The easiest way to get started with Steel is by creating a [Steel Cloud](https://app.steel.dev) account.



| Installation methods | Link                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run locally with GHCR | [![Deploy with Github Container Redistry](https://img.shields.io/badge/GHCR-478CFF?style=for-the-badge&labelColor=478CFF&logo=github&logoColor=white)](https://github.com/steel-dev/steel-browser/pkgs/container/steel-browser) |
| 1-click deploy to Railway | [![Deploy on Railway](https://img.shields.io/badge/Railway-B039CB?style=for-the-badge&labelColor=B039CB&logo=railway&logoColor=white)](https://railway.app/template/FQG9Ca) |
| 1-click deploy to Render | [![Deploy to Render](https://img.shields.io/badge/Render-8A05FF?style=for-the-badge&labelColor=8A05FF&logo=render&logoColor=white)](https://render.com/deploy?repo=https://github.com/steel-dev/steel-browser) |



## ✨ Highlights 

The `steel-browser` provides a REST API to control, run, and manage a production-ready browser environment. Under the hood, it manages browser instances, sessions, and pages, allowing you to perform complex browsing tasks programmatically without any of the headaches:
- **Full Browser Control**: Uses Puppeteer and CDP for complete control over Chrome instances -- allowing you to connect using Puppeteer, Playwright, or Selenium.
- **Session Management**: Maintains browser state, cookies, and local storage across requests
- **Proxy Support**: Built-in proxy chain management for IP rotation
- **Extension Support**: Load custom Chrome extensions for enhanced functionality
- **Debugging Tools**: Built-in request logging and session recording capabilities
- **Anti-Detection**: Includes stealth plugins and fingerprint management
- **Resource Management**: Automatic cleanup and browser lifecycle management
- **Browser Tools**: Exposes APIs to quick convert pages to markdown, readability, screenshots, or PDFs.


For detailed API documentation and examples, check out our [API reference](https://docs.steel.dev/api-reference) or explore the Swagger UI directly at `http://0.0.0.0:3000/documentation`.


### Make sure to give us a star ⭐

<img width="200" alt="Start us on Github!" src="images/star_img.png">



## Getting Started

The fastest way to get started is to build and run the Docker image:

```bash
# Clone and build the Docker image
git clone https://github.com/steel-dev/steel-browser
cd steel-browser
docker compose up

```

**Note for Local Development:** When developing locally, you may need to modify the `docker-compose.yml` environment variables to use localhost instead of the service name api. For example:

```bash
VITE_API_URL: ${VITE_API_URL:-http://localhost:3000}
VITE_WS_URL: ${VITE_WS_URL:-ws://localhost:3000}
```

Alternatively, if you have Node.js and Chrome installed, you can run the server directly:

```bash
npm run install
npm run dev
```

This will start the Steel server on port 3000.

Make sure you have the Chrome executable installed and in one of these paths:


- **Linux**:
  `/usr/bin/google-chrome`

- **MacOS**:
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

- **Windows**:
  - `C:\Program Files\Google\Chrome\Application\chrome.exe` OR
  - `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`

For more details on where this is checked look at [`api/src/utils/browser.ts`](./api/src/utils/browser.ts).

## Usage
The Steel browser provides a REST API to control a headless browser powered by Puppeteer. Under the hood, it manages browser instances, sessions, and pages, allowing you to perform complex browsing tasks programmatically.

The full REST API documentation can be found on your Steel instance at `/documentation` (e.g., `http://0.0.0.0:3000/documentation`).

Steel provides three main ways to let your agents do browser automation:

### Quick Actions API
The `/scrape`, `/screenshot`, and `/pdf` endpoints let you quickly extract clean, well-formatted data from any webpage using the running Steel server. Ideal for simple, read-only, on-demand jobs:

#### Scrape a Web Page
Extract the HTML content of a web page.
```bash
# Example using the Actions API
curl -X POST http://0.0.0.0:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "waitFor": 1000
  }'
```

### Take a Screenshot
Take a screenshot of a web page.
```bash
# Example using the Actions API
curl -X POST http://0.0.0.0:3000/v1/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "fullPage": true
  }' --output screenshot.png
```

### Browser Sessions API
The Browser Sessions API lets you relaunch the browser with custom options or extensions (e.g. with a custom proxy) and also reset the browser state. Perfect for complex, stateful workflows that need fine-grained control:

```bash
# Launch a new browser session
curl -X POST http://0.0.0.0:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "options": {
      "proxy": "user:pass@host:port",
      // Custom launch options
    }
  }'
```

### Selenium Integration
>**Note:** This integration does not support all the features of the CDP-based browser sessions API.

For teams with existing Selenium workflows, the Steel browser provides a drop-in replacement that adds enhanced features while maintaining compatibility:

```bash
# Launch a Selenium session
curl -X POST http://0.0.0.0:3000/v1/selenium/launch \
  -H "Content-Type: application/json" \
  -d '{
    "options": {
      // Selenium-compatible options
    }
  }'
```

The Selenium API is fully compatible with Selenium's WebDriver protocol, so you can use any existing Selenium clients to connect to the Steel browser.

```typescript
// Example using the Selenium API
const builder = new Builder()
      .forBrowser("chrome")
      .usingServer(
        `http://0.0.0.0:3000/selenium`
      );

const driver = await builder.build();

console.log("Navigating to Google");
await driver.get("https://www.google.com");

// The rest of your Selenium code here...
```

## Get involved
The Steel browser is an open-source project, and we welcome contributions!
- Questions/ideas/feedback? Come hangout on [Discord](https://discord.gg/steel-dev)
- Found a bug? Open an issue on [GitHub](https://github.com/steel-dev/steel-browser/issues)

## License
[Apache 2.0](./LICENSE)
