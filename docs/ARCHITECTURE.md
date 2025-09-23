# Steel Browser Architecture

This document provides a comprehensive overview of Steel Browser's architecture, design decisions, and how the various components work together.

## 🏗️ High-Level Architecture

Steel Browser follows a modular, plugin-based architecture designed for extensibility and maintainability:

```
┌─────────────────────────────────────────────────────────────┐
│                        Steel Browser                        │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React UI)           │  Backend (Fastify API)     │
│  ├── Session Management        │  ├── CDP Service           │
│  ├── Real-time Viewing         │  ├── Session Management    │
│  ├── DevTools Integration      │  ├── File Storage          │
│  └── Configuration UI          │  └── Plugin System         │
├─────────────────────────────────────────────────────────────┤
│                    Chrome/Chromium Browser                  │
│  ├── Chrome DevTools Protocol (CDP)                         │
│  ├── Browser Extensions                                     │
│  └── Page Contexts                                          │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 Core Components

### 1. CDP Service (`api/src/services/cdp/cdp.service.ts`)

The Chrome DevTools Protocol (CDP) Service is the heart of Steel Browser, managing all browser interactions:

**Responsibilities:**
- Browser lifecycle management (launch, close, restart)
- Page creation and navigation
- WebSocket proxy for CDP connections
- Plugin system coordination
- Session state management
- Context isolation and fingerprinting

**Key Features:**
```typescript
class CDPService extends EventEmitter {
  // Browser management
  async launch(options?: BrowserLauncherOptions): Promise<Browser>
  async shutdown(): Promise<void>
  async refreshPrimaryPage(): Promise<void>
  
  // Plugin system
  registerPlugin(plugin: BasePlugin): void
  unregisterPlugin(pluginName: string): boolean
  
  // Page management
  async createPage(): Promise<Page>
  async getPages(): Promise<Page[]>
}
```

### 2. Plugin System

Steel Browser's plugin architecture allows for extensible functionality without modifying core code.

#### Base Plugin (`api/src/services/cdp/plugins/core/base-plugin.ts`)

```typescript
abstract class BasePlugin {
  // Lifecycle hooks
  async onBrowserLaunch(browser: Browser): Promise<void>
  async onPageCreated(page: Page): Promise<void>
  async onPageNavigate(page: Page): Promise<void>
  async onPageUnload(page: Page): Promise<void>
  async onBrowserClose(browser: Browser): Promise<void>
  async onBeforePageClose(page: Page): Promise<void>
  async onShutdown(): Promise<void>
}
```

#### Plugin Manager (`api/src/services/cdp/plugins/core/plugin-manager.ts`)

Coordinates plugin lifecycle and ensures error isolation:

- **Registration**: Manages plugin registration and dependency injection
- **Event Distribution**: Notifies all plugins of browser events
- **Error Handling**: Isolates plugin errors to prevent system crashes
- **Lifecycle Management**: Coordinates plugin startup and shutdown

### 3. Session Management (`api/src/services/session.service.ts`)

Manages browser sessions with isolated contexts:

**Features:**
- Session creation with custom configurations
- Context isolation (cookies, localStorage, sessionStorage)
- Resource cleanup and garbage collection
- Session persistence and restoration
- Concurrent session management

```typescript
interface SessionConfig {
  proxy?: ProxyConfig;
  userAgent?: string;
  viewport?: { width: number; height: number };
  extensions?: string[];
  fingerprint?: FingerprintOptions;
}
```

### 4. File Storage Service (`api/src/services/file.service.ts`)

Handles file operations with session-scoped storage:

- **Upload Management**: Handles multipart file uploads
- **Download Coordination**: Manages browser downloads
- **Storage Isolation**: Session-scoped file storage
- **Cleanup**: Automatic file cleanup on session end

## 🔌 Plugin Architecture Deep Dive

### Plugin Lifecycle

1. **Registration**: Plugins register with the PluginManager
2. **Initialization**: Service dependency injection
3. **Event Handling**: Respond to browser lifecycle events
4. **Cleanup**: Graceful shutdown and resource cleanup

### Event Flow

```
Browser Launch → Plugin.onBrowserLaunch()
     ↓
Page Created → Plugin.onPageCreated()
     ↓
Page Navigate → Plugin.onPageNavigate()
     ↓
Page Unload → Plugin.onPageUnload()
     ↓
Page Close → Plugin.onBeforePageClose()
     ↓
Browser Close → Plugin.onBrowserClose()
     ↓
System Shutdown → Plugin.onShutdown()
```

### Example Plugin Implementation

```typescript
import { BasePlugin, PluginOptions } from '@steel-browser/api/cdp-plugin';
import { Browser, Page } from 'puppeteer-core';

export class AdBlockPlugin extends BasePlugin {
  private blockedDomains: Set<string>;

  constructor(options: PluginOptions & { blockedDomains?: string[] }) {
    super({ name: 'ad-blocker', ...options });
    this.blockedDomains = new Set(options.blockedDomains || []);
  }

  async onPageCreated(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (this.blockedDomains.has(url.hostname)) {
        request.abort();
      } else {
        request.continue();
      }
    });
  }
}
```

## 🌐 API Architecture

### Fastify Plugin System

Steel Browser uses Fastify's plugin architecture for modular API design:

```typescript
// Main plugin registration
await fastify.register(steelBrowserPlugin, {
  fileStorage: { maxSizePerSession: 100 * MB }
});

// Individual plugins
await fastify.register(browserInstancePlugin);
await fastify.register(sessionPlugin);
await fastify.register(fileStoragePlugin);
```

### Route Organization

Routes are organized by functionality:

- **Actions** (`/v1/*`): Browser automation actions (scrape, screenshot, PDF)
- **Sessions** (`/v1/sessions/*`): Session management
- **CDP** (`/v1/cdp/*`): Direct CDP access
- **Files** (`/v1/files/*`): File upload/download
- **Selenium** (`/selenium/*`): Selenium WebDriver compatibility

### Schema Validation

All API endpoints use Zod schemas for validation:

```typescript
const ScrapeRequestSchema = z.object({
  url: z.string().url().optional(),
  delay: z.number().optional(),
  format: z.array(z.enum(['html','cleaned_html','markdown','readability'])).optional(),
  screenshot: z.boolean().optional(),
  pdf: z.boolean().optional(),
});
```

## 🎨 Frontend Architecture

### React Component Structure

```
src/
├── components/           # Reusable UI components
│   ├── ui/              # Base UI components (buttons, inputs)
│   ├── badges/          # Status badges
│   ├── icons/           # Icon components
│   └── sessions/        # Session-specific components
├── containers/          # Page-level containers
├── contexts/           # React contexts for state management
├── hooks/              # Custom React hooks
└── steel-client/       # Auto-generated API client
```

### State Management

- **React Query**: Server state management and caching
- **React Context**: Global application state
- **Local State**: Component-specific state with hooks

### Real-time Updates

WebSocket connections provide real-time updates:

```typescript
// Session monitoring
const { data: sessions } = useQuery({
  queryKey: ['sessions'],
  queryFn: () => steelClient.sessions.getSessions(),
  refetchInterval: 1000 // Real-time updates
});
```

## 🔒 Security Architecture

### Input Validation

- **API Level**: Zod schema validation for all inputs
- **Browser Level**: Content Security Policy (CSP) headers
- **File Level**: File type validation and size limits

### Context Isolation

Each session runs in an isolated browser context:

```typescript
const context = await browser.createIncognitoBrowserContext();
context.setDefaultNavigationTimeout(30000);
context.setDefaultTimeout(30000);
```

### Resource Limits

- **Memory**: Browser process memory limits
- **CPU**: Process CPU throttling
- **Storage**: Session-scoped file storage limits
- **Network**: Request rate limiting and proxy support

## 📊 Performance Considerations

### Browser Resource Management

- **Process Isolation**: Each session in separate browser context
- **Memory Cleanup**: Automatic page and context cleanup
- **Connection Pooling**: Reuse CDP connections where possible

### Caching Strategy

- **Static Assets**: Long-term caching for UI assets
- **API Responses**: Short-term caching for session data
- **Browser Cache**: Configurable per-session browser caching

### Scaling Considerations

Current architecture supports:
- **Vertical Scaling**: Multi-core CPU utilization
- **Session Concurrency**: Multiple simultaneous sessions
- **Resource Monitoring**: Memory and CPU usage tracking

Future scaling options:
- **Horizontal Scaling**: Multiple Steel instances
- **Load Balancing**: Session distribution
- **Distributed Storage**: Shared file storage

## 🧪 Testing Architecture

### Test Structure (Planned)

```
tests/
├── unit/               # Unit tests for individual components
├── integration/        # API endpoint integration tests
├── e2e/               # End-to-end browser automation tests
└── performance/       # Load and performance tests
```

### Testing Strategy

- **Unit Tests**: Core services and utilities
- **Integration Tests**: API endpoints and database interactions
- **E2E Tests**: Full browser automation workflows
- **Performance Tests**: Load testing and benchmarking

## 🔧 Configuration Management

### Environment Variables

Configuration through environment variables:

```typescript
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.string().default('3000'),
  CHROME_EXECUTABLE_PATH: z.string().optional(),
  CHROME_HEADLESS: z.boolean().default(true),
  // ... more configuration options
});
```

### Runtime Configuration

- **Browser Options**: Per-session browser configuration
- **Plugin Configuration**: Dynamic plugin options
- **Feature Flags**: Runtime feature toggling

## 🚀 Deployment Architecture

### Containerization

Multi-stage Docker builds for optimization:

```dockerfile
# Build stage
FROM node:22-slim AS build
# ... build steps

# Production stage  
FROM node:22-slim AS production
# ... production setup
```

### Service Dependencies

- **Chrome/Chromium**: Browser engine
- **Node.js**: Runtime environment
- **Nginx**: Reverse proxy (in containers)
- **File System**: Session storage

## 🔄 Development Workflow

### Hot Reloading

Development environment supports hot reloading:

```bash
npm run dev  # Starts both API and UI with hot reload
```

### Debug Configuration

Built-in debugging support:

```bash
# API debugging
node --inspect ./api/build/index.js

# Enable verbose logging
ENABLE_VERBOSE_LOGGING=true npm run dev -w api
```

## 📈 Monitoring and Observability

### Logging

Structured logging with Pino:

```typescript
fastify.log.info({ 
  sessionId, 
  action: 'page_created',
  url: page.url() 
}, 'New page created');
```

### Metrics (Planned)

- **Session Metrics**: Creation, duration, success rates
- **Performance Metrics**: Response times, resource usage
- **Error Tracking**: Error rates and categorization

### Health Checks

Built-in health check endpoints:

```typescript
// Basic health check
GET /health

// Detailed readiness check
GET /ready
```

---

This architecture provides a solid foundation for browser automation while maintaining flexibility for future enhancements and scaling requirements. 