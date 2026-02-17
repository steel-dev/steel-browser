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

## ✨ Highlights

[Steel.dev](https://steel.dev) is an open-source browser API that makes it easy to build AI apps and agents that interact with the web. Instead of building automation infrastructure from scratch, you can focus on your AI application while Steel handles the complexity.

Under the hood, it manages sessions, pages, and browser processes, allowing you to perform complex browsing tasks programmatically without any of the headaches:
- **Full Browser Control**: Uses Puppeteer and CDP for complete control over Chrome instances -- allowing you to connect using Puppeteer, Playwright, or Selenium.
- **Session Management**: Maintains browser state, cookies, and local storage across requests
- **Proxy Support**: Built-in proxy chain management for IP rotation
- **Extension Support**: Load custom Chrome extensions for enhanced functionality
- **Debugging Tools**: Built-in request logging and a UI to view/debug sessions with
- **Anti-Detection**: Includes stealth plugins and fingerprint management
- **Resource Management**: Automatic cleanup and browser lifecycle management
- **Browser Tools**: Exposes APIs to quick convert pages to markdown, readability, screenshots, or PDFs.


For detailed API documentation and examples, check out our [API reference](https://docs.steel.dev/api-reference) or explore the Swagger UI directly at `http://0.0.0.0:3000/documentation`.

> Steel is in public beta and evolving every day. Your suggestions, ideas, and reported bugs help us immensely. Do not hesitate to join in the conversation on [Discord](https://discord.gg/steel-dev) or raise a GitHub issue. We read everything, respond to most, and love you.

If you love open-source, AI, and dev tools, [we're hiring across the stack](https://jobs.ashbyhq.com/steel)!

### Make sure to give us a star ⭐

<img width="200" alt="Start us on Github!" src="images/star_img.png">

## 🛠️ Getting Started
The easiest way to get started with Steel is by creating a [Steel Cloud](https://app.steel.dev) account. Otherwise, you can deploy this Steel browser instance to a cloud provider or run it locally.

## ⚡ Quick Deploy
If you're looking to deploy to a cloud provider, we've got you covered.

| Deployment methods | Link |
| -------------------- | ----- |
| Pre-built Docker Image (combined API + UI) | [![Deploy with Github Container Registry](https://img.shields.io/badge/GHCR-478CFF?style=for-the-badge&labelColor=478CFF&logo=github&logoColor=white)](https://github.com/steel-dev/steel-browser/pkgs/container/steel-browser) |
| 1-click deploy to Railway | [![Deploy on Railway](https://img.shields.io/badge/Railway-B039CB?style=for-the-badge&labelColor=B039CB&logo=railway&logoColor=white)](https://railway.app/deploy/steelbrowser) |
| 1-click deploy to Render | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy) |


## 💻 Running Locally

### Docker

The simplest way to deploy/run a Steel browser instance locally is to run the pre-built Docker image:

```bash
# Pull and run the Docker image
docker run -p 3000:3000 -p 9223:9223 ghcr.io/steel-dev/steel-browser
```

This will start the Steel browser server on port 3000 (http://localhost:3000) and the UI at http://localhost:3000/ui. The 9223 port is used for the console debugger.

You can now create sessions, scrape pages, take screenshots, and more. Jump to the [Usage](#usage) section for some quick examples on how you can do that.

Alternatively, you can run the API and UI separately with docker compose:

```bash
docker compose up
```

For Mac Silicon users, you will need to pass this env flag to the Docker compose command to run the images on the correct platform:
```bash
DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose up
```

## Quickstart for Contributors
When developing locally, you will need to run the [`docker-compose.dev.yml`](./docker-compose.dev.yml) file instead of the default [`docker-compose.yml`](./docker-compose.yml) file so that your local changes are reflected. Doing this will build the Docker images from the [`api`](./api) and [`ui`](./ui) directories and run the server and UI on port 3000 and 5173 respectively.

```bash
docker compose -f docker-compose.dev.yml up
```

You will also need to run it with `--build` to ensure the Docker images are re-built every time you make changes:

```bash
docker compose -f docker-compose.dev.yml up --build
```

If you run on a custom host, create a `.env` file (see `docs/DEVELOPMENT_SETUP.md` for variables) or modify the environment variables used by `docker-compose.dev.yml` to use your host.

### Node.js
Alternatively, if you have Node.js and Chrome installed, you can run both the server and the UI directly:

```bash
npm install
npm run dev
```

This will also start the Steel server on port 3000 and the UI on port 5173.

Make sure you have the Chrome executable installed and in one of these paths:

- **Linux**:
  `/usr/bin/google-chrome`

- **MacOS**:
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

- **Windows**:
  - `C:\Program Files\Google\Chrome\Application\chrome.exe` OR
  - `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`

#### Custom Chrome Executable

If you have a custom Chrome executable or a different path, you can set the `CHROME_EXECUTABLE_PATH` environment variable to the path of your Chrome executable:

```bash
export CHROME_EXECUTABLE_PATH=/path/to/your/chrome
npm run dev
```

For more details on where this is checked look at [`api/src/utils/browser.ts`](./api/src/utils/browser.ts).

## 🏄🏽‍♂️ Usage
> If you're looking for quick examples on how to use Steel, check out the [Cookbook](https://github.com/steel-dev/steel-cookbook).
>
> Alternatively you can play with the [REPL package](./repl/README.md) too `cd repl` and `npm run start`

There are two main ways to interact with the Steel browser API:
1. [Using Sessions](#sessions)
2. [Using the Quick Actions Endpoints](#quick-actions-api)

In these examples, we assume your custom Steel API endpoint is `http://localhost:3000`.

The full REST OpenAPI documentation can be found [on our site](https://docs.steel.dev/api-reference) and on your local Steel instance at `http://localhost:3000/documentation`.

#### Using the SDKs
If you prefer to use the our Python and Node SDKs, you can install the `steel-sdk` package for Node or Python.

These SDKs are built on top of the REST API and provide a more convenient way to interact with the Steel browser API. They are fully typed, and are compatible with both Steel Cloud and self-hosted Steel instances (changeable using the `baseURL` option on Node and `base_url` on Python).

For more details on installing and using the SDKs, please see the [Node SDK Reference](https://github.com/steel-dev/steel-node/blob/main/api.md) and the [Python SDK Reference](https://github.com/steel-dev/steel-python/blob/main/api.md).


### Sessions
The `/sessions` endpoint lets you relaunch the browser with custom options or extensions (e.g. with a custom proxy) and also reset the browser state. Perfect for complex, stateful workflows that need fine-grained control.

Once you have a session, you can use the session ID or the root URL to interact with the browser. To do this, you will need to use Puppeteer or Playwright. You can find some examples of how to use Puppeteer and Playwright with Steel in the docs below:
* [Puppeteer Integration](https://docs.steel.dev/overview/guides/connect-with-puppeteer)
* [Playwright with Node](https://docs.steel.dev/overview/guides/connect-with-playwright-node)
* [Playwright with Python](https://docs.steel.dev/overview/guides/connect-with-playwright-python)

<details open>
<summary><b>Creating a Session using the Node SDK</b></summary>
<br>

```typescript
import Steel from 'steel-sdk';

const client = new Steel({
  baseURL: "http://localhost:3000", // Custom API Base URL override
});

(async () => {
  try {
    // Create a new browser session with current API fields
    const session = await client.sessions.create({
      blockAds: true,
      proxyUrl: "user:pass@host:port", // optional
      dimensions: { width: 1280, height: 800 }, // optional
    });
    console.log("Created session with ID:", session.id);
  } catch (error) {
    console.error("Error creating session:", error);
  }
})();
````
</details>

<details>
<summary><b>Creating a Session using the Python SDK</b></summary>
<br>

````python
import os
from steel import Steel

client = Steel(
    base_url="http://localhost:3000",  # Custom API Base URL override
)

try:
    # Create a new browser session with custom options
    session = client.sessions.create(
        block_ads=True,
        proxy_url="user:pass@host:port",  # optional
        dimensions={"width": 1280, "height": 800},  # optional
    )
    print("Created session with ID:", session.id)
except Exception as e:
    print("Error creating session:", e)
````
</details>

<details>
<summary><b>Creating a Session using Curl</b></summary>
<br>

```bash
# Launch a new browser session
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "proxyUrl": "user:pass@host:port",
    "blockAds": true,
    "dimensions": { "width": 1280, "height": 800 }
  }'
```
</details>


#### Selenium Sessions
>**Note:** This integration does not support all the features of the CDP-based browser sessions API.

For teams with existing Selenium workflows, the Steel browser provides a drop-in replacement that adds enhanced features while maintaining compatibility. You can simply use the `isSelenium` option to create a Selenium session:

```typescript
// Using the Node SDK
const session = await client.sessions.create({ isSelenium: true });
```
```python
# Using the Python SDK
session = client.sessions.create(is_selenium=True)
```
<details>
<summary><b>Using Curl</b></summary>
<br>

```bash
# Launch a Selenium session
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "isSelenium": true
  }'
```
</details>
<br>

The Selenium API is fully compatible with Selenium's WebDriver protocol, so you can use any existing Selenium clients to connect to the Steel browser. **For more details on using Selenium with Steel, refer to the [Selenium Docs](https://docs.steel.dev/overview/guides/connect-with-selenium).**

### Quick Actions API
The `/scrape`, `/screenshot`, and `/pdf` endpoints let you quickly extract clean, well-formatted data from any webpage using the running Steel server. Ideal for simple, read-only, on-demand jobs:

<details open>
<summary><b>Scrape a Web Page</b></summary>
<br>

Extract the HTML content of a web page.

```bash
# Example using the Actions API
curl -X POST http://0.0.0.0:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "delay": 1000
  }'
```
</details>

<details>
<summary><b>Take a Screenshot</b></summary>
<br>

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
</details>

<details>
<summary><b>Download a PDF</b></summary>
<br>

Download a PDF of a web page.
```bash
# Example using the Actions API
curl -X POST http://0.0.0.0:3000/v1/pdf \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com"
  }' --output output.pdf
```
</details>

## Get involved
Steel browser is an open-source project, and we welcome contributions!
- Questions/ideas/feedback? Come hangout on [Discord](https://discord.gg/steel-dev)
- Found a bug? Open an issue on [GitHub](https://github.com/steel-dev/steel-browser/issues)

## License
[Apache 2.0](./LICENSE)

---

Made with ❤️ by the Steel team.
