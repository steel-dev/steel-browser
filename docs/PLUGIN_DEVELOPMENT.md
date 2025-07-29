# Plugin Development Guide

This guide walks you through developing custom plugins for Steel Browser's extensible architecture.

## 🚀 Quick Start

### Creating Your First Plugin

```typescript
import { BasePlugin, PluginOptions } from '@steel-browser/api/cdp-plugin';
import { Browser, Page } from 'puppeteer-core';

export class HelloWorldPlugin extends BasePlugin {
  constructor(options: PluginOptions) {
    super({ name: 'hello-world', ...options });
  }

  async onBrowserLaunch(browser: Browser): Promise<void> {
    console.log('Hello from the browser launch event!');
  }

  async onPageCreated(page: Page): Promise<void> {
    console.log(`New page created: ${page.url()}`);
  }
}

// Usage
const plugin = new HelloWorldPlugin({});
cdpService.registerPlugin(plugin);
```

## 🏗️ Plugin Architecture

### Base Plugin Class

All plugins extend the `BasePlugin` abstract class:

```typescript
abstract class BasePlugin {
  public name: string;
  protected options: PluginOptions;
  protected cdpService: CDPService | null;

  constructor(options: PluginOptions);
  public setService(service: CDPService): void;

  // Lifecycle hooks (all optional)
  public async onBrowserLaunch(browser: Browser): Promise<void> {}
  public async onPageCreated(page: Page): Promise<void> {}
  public async onPageNavigate(page: Page): Promise<void> {}
  public async onPageUnload(page: Page): Promise<void> {}
  public async onBrowserClose(browser: Browser): Promise<void> {}
  public async onBeforePageClose(page: Page): Promise<void> {}
  public async onShutdown(): Promise<void> {}
}
```

### Plugin Options

```typescript
interface PluginOptions {
  name: string;
  [key: string]: any; // Additional plugin-specific options
}
```

## 🔄 Lifecycle Events

### Event Order

```
1. onBrowserLaunch    - Browser process starts
2. onPageCreated      - New page/tab created
3. onPageNavigate     - Page navigates to URL
4. onPageUnload       - Page unloads/navigates away
5. onBeforePageClose  - Before page closes
6. onBrowserClose     - Browser process closes
7. onShutdown         - Plugin cleanup
```

### Event Details

#### onBrowserLaunch(browser: Browser)
- Called when the browser process starts
- Use for browser-level configuration
- Access to the Browser instance

#### onPageCreated(page: Page)
- Called when a new page/tab is created
- Perfect for page-level setup (request interception, etc.)
- Access to the Page instance

#### onPageNavigate(page: Page)
- Called before page navigation
- Use for URL-based logic or navigation tracking

#### onPageUnload(page: Page)
- Called when page unloads or navigates away
- Cleanup page-specific resources

#### onBeforePageClose(page: Page)
- Called before a page closes
- Last chance for page cleanup

#### onBrowserClose(browser: Browser)
- Called when browser process closes
- Browser-level cleanup

#### onShutdown()
- Called during plugin shutdown
- Final cleanup opportunity

## 📝 Plugin Examples

### 1. Request Logger Plugin

```typescript
export class RequestLoggerPlugin extends BasePlugin {
  private logFile: string;

  constructor(options: PluginOptions & { logFile?: string }) {
    super({ name: 'request-logger', ...options });
    this.logFile = options.logFile || 'requests.log';
  }

  async onPageCreated(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
        headers: request.headers()
      };
      
      // Log to file or console
      console.log('Request:', logEntry);
      request.continue();
    });
  }
}
```

### 2. Ad Blocker Plugin

```typescript
export class AdBlockerPlugin extends BasePlugin {
  private blockedDomains: Set<string>;
  private blockedCount: number = 0;

  constructor(options: PluginOptions & { blockedDomains?: string[] }) {
    super({ name: 'ad-blocker', ...options });
    this.blockedDomains = new Set(options.blockedDomains || [
      'doubleclick.net',
      'googleadservices.com',
      'googlesyndication.com'
    ]);
  }

  async onPageCreated(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      const url = new URL(request.url());
      
      if (this.blockedDomains.has(url.hostname)) {
        this.blockedCount++;
        console.log(`Blocked ad request: ${url.hostname}`);
        request.abort();
      } else {
        request.continue();
      }
    });
  }

  async onShutdown(): Promise<void> {
    console.log(`Ad Blocker: Blocked ${this.blockedCount} requests`);
  }
}
```

### 3. Screenshot Plugin

```typescript
export class ScreenshotPlugin extends BasePlugin {
  private screenshotDir: string;

  constructor(options: PluginOptions & { screenshotDir?: string }) {
    super({ name: 'screenshot', ...options });
    this.screenshotDir = options.screenshotDir || './screenshots';
  }

  async onPageNavigate(page: Page): Promise<void> {
    // Take screenshot after navigation
    setTimeout(async () => {
      try {
        const url = new URL(page.url());
        const filename = `${url.hostname}-${Date.now()}.png`;
        const filepath = path.join(this.screenshotDir, filename);
        
        await page.screenshot({ path: filepath, fullPage: true });
        console.log(`Screenshot saved: ${filepath}`);
      } catch (error) {
        console.error('Screenshot failed:', error);
      }
    }, 2000);
  }
}
```

### 4. Performance Monitor Plugin

```typescript
export class PerformancePlugin extends BasePlugin {
  private metrics: Map<string, any> = new Map();

  constructor(options: PluginOptions) {
    super({ name: 'performance-monitor', ...options });
  }

  async onPageCreated(page: Page): Promise<void> {
    // Enable performance monitoring
    await page.coverage.startJSCoverage();
    await page.coverage.startCSSCoverage();
    
    page.on('load', async () => {
      const performanceMetrics = await page.evaluate(() => {
        const perfData = performance.getEntriesByType('navigation')[0];
        return {
          domContentLoaded: perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
          loadComplete: perfData.loadEventEnd - perfData.loadEventStart,
          firstPaint: performance.getEntriesByType('paint')[0]?.startTime || 0
        };
      });
      
      this.metrics.set(page.url(), performanceMetrics);
      console.log(`Performance metrics for ${page.url()}:`, performanceMetrics);
    });
  }

  async onShutdown(): Promise<void> {
    console.log('Performance Summary:', Object.fromEntries(this.metrics));
  }
}
```

## 🔧 Advanced Plugin Development

### Accessing CDP Service

```typescript
export class AdvancedPlugin extends BasePlugin {
  async onBrowserLaunch(browser: Browser): Promise<void> {
    // Access the CDP service
    if (this.cdpService) {
      // Get all pages
      const pages = await this.cdpService.getPages();
      
      // Access primary page
      const primaryPage = this.cdpService.primaryPage;
      
      // Register hooks
      this.cdpService.registerLaunchHook(async (config) => {
        console.log('Browser launching with config:', config);
      });
    }
  }
}
```

### Plugin Configuration

```typescript
interface MyPluginOptions extends PluginOptions {
  apiKey?: string;
  endpoint?: string;
  retries?: number;
  timeout?: number;
}

export class ConfigurablePlugin extends BasePlugin {
  private config: MyPluginOptions;

  constructor(options: MyPluginOptions) {
    super(options);
    this.config = {
      apiKey: options.apiKey || process.env.API_KEY,
      endpoint: options.endpoint || 'https://api.example.com',
      retries: options.retries || 3,
      timeout: options.timeout || 5000,
      ...options
    };
  }
}
```

### Error Handling

```typescript
export class RobustPlugin extends BasePlugin {
  async onPageCreated(page: Page): Promise<void> {
    try {
      // Plugin logic here
      await this.setupPageInterception(page);
    } catch (error) {
      console.error(`Error in ${this.name} plugin:`, error);
      // Plugin errors are isolated by the PluginManager
      // but you should handle them gracefully
    }
  }

  private async setupPageInterception(page: Page): Promise<void> {
    // Implementation with proper error handling
  }
}
```

## 🧪 Testing Plugins

### Unit Testing

```typescript
// plugin.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MyPlugin } from './my-plugin';

describe('MyPlugin', () => {
  let plugin: MyPlugin;

  beforeEach(() => {
    plugin = new MyPlugin({ name: 'test-plugin' });
  });

  it('should initialize with correct name', () => {
    expect(plugin.name).toBe('test-plugin');
  });

  it('should handle browser launch', async () => {
    const mockBrowser = {} as any; // Mock browser object
    await expect(plugin.onBrowserLaunch(mockBrowser)).resolves.not.toThrow();
  });
});
```

### Integration Testing

```typescript
// integration.test.ts
import { CDPService } from '@steel-browser/api';
import { MyPlugin } from './my-plugin';

describe('Plugin Integration', () => {
  let cdpService: CDPService;
  let plugin: MyPlugin;

  beforeEach(async () => {
    cdpService = new CDPService({}, console);
    plugin = new MyPlugin({ name: 'test-plugin' });
    cdpService.registerPlugin(plugin);
  });

  afterEach(async () => {
    await cdpService.shutdown();
  });

  it('should work with CDP service', async () => {
    await cdpService.launch();
    // Test plugin behavior
  });
});
```

## 📦 Plugin Distribution

### NPM Package Structure

```
my-steel-plugin/
├── src/
│   ├── index.ts
│   └── plugin.ts
├── dist/
├── package.json
├── README.md
└── tsconfig.json
```

### package.json Example

```json
{
  "name": "steel-plugin-example",
  "version": "1.0.0",
  "description": "Example plugin for Steel Browser",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": ["steel-browser", "plugin", "automation"],
  "peerDependencies": {
    "@steel-browser/api": "^1.0.0",
    "puppeteer-core": "^23.0.0"
  },
  "files": ["dist/**/*"]
}
```

### TypeScript Configuration

```json
{
  "extends": "@steel-browser/api/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

## 🌟 Best Practices

### 1. Error Handling
- Always wrap plugin logic in try-catch blocks
- Log errors with context information
- Don't let plugin errors crash the system

### 2. Resource Management
- Clean up resources in shutdown hooks
- Remove event listeners when done
- Close files and connections properly

### 3. Performance
- Avoid blocking operations in event handlers
- Use async/await properly
- Consider memory usage for long-running plugins

### 4. Configuration
- Provide sensible defaults
- Support environment variables
- Validate configuration options

### 5. Testing
- Write unit tests for plugin logic
- Test with real browser instances
- Mock external dependencies

### 6. Documentation
- Document plugin options and usage
- Provide examples
- Include troubleshooting guides

## 🔍 Debugging Plugins

### Enable Debug Logging

```bash
# Enable verbose logging
ENABLE_VERBOSE_LOGGING=true npm run dev -w api

# Enable CDP logging
ENABLE_CDP_LOGGING=true npm run dev -w api
```

### Debug in VS Code

```json
// .vscode/launch.json
{
  "configurations": [
    {
      "name": "Debug Steel with Plugin",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/api/build/index.js",
      "env": {
        "NODE_ENV": "development",
        "ENABLE_VERBOSE_LOGGING": "true"
      }
    }
  ]
}
```

### Plugin Debug Helper

```typescript
export class DebugPlugin extends BasePlugin {
  private debug: boolean;

  constructor(options: PluginOptions & { debug?: boolean }) {
    super(options);
    this.debug = options.debug || false;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log(`[${this.name}]`, ...args);
    }
  }

  async onPageCreated(page: Page): Promise<void> {
    this.log('Page created:', page.url());
    // Plugin logic...
  }
}
```

## 📚 Plugin Registry (Future)

We're planning a plugin registry where you can:

- Publish plugins for community use
- Discover existing plugins
- Rate and review plugins
- Automatic plugin updates

Stay tuned for updates on this feature!

## 🤝 Contributing Plugins

To contribute a plugin to the Steel Browser ecosystem:

1. Create a well-documented plugin
2. Add comprehensive tests
3. Submit to the community registry
4. Engage with users for feedback

---

Happy plugin development! 🚀 