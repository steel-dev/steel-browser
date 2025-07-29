# Contributing to Steel Browser

Welcome to Steel Browser! 🎉 We're excited that you're interested in contributing to our open-source browser API. This guide will help you get started and make your first contribution.

## 🚀 Quick Start

### Prerequisites

- **Node.js**: Version 22 or higher
- **npm**: Version 10 or higher  
- **Docker**: For containerized development (optional but recommended)
- **Git**: For version control
- **Chrome/Chromium**: Required for browser automation

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/steel-dev/steel-browser.git
   cd steel-browser
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Start Development Environment**
   ```bash
   # Start both API and UI in development mode
   npm run dev
   
   # Or start individually:
   npm run dev -w api    # API server on http://localhost:3000
   npm run dev -w ui     # UI server on http://localhost:5173
   ```

4. **Verify Setup**
   - API: Visit http://localhost:3000/documentation
   - UI: Visit http://localhost:5173
   - Test REPL: `cd repl && npm start`

### Docker Development (Alternative)

```bash
# Build and run with Docker Compose
docker-compose -f docker-compose.dev.yml up --build

# Or use production images
docker-compose up
```

## 📁 Project Structure

```
steel-browser/
├── api/                    # Backend API (Fastify + Puppeteer)
│   ├── src/
│   │   ├── modules/        # API modules (actions, sessions, etc.)
│   │   ├── plugins/        # Fastify plugins
│   │   ├── services/       # Core services (CDP, file, session)
│   │   └── types/          # TypeScript type definitions
│   └── extensions/         # Browser extensions (must pass name as param to session creation)
├── ui/                     # Frontend UI (React + Vite)
│   └── src/
│       ├── components/     # Reusable UI components
│       ├── containers/     # Page containers
│       └── contexts/       # React contexts
├── repl/                   # Interactive REPL for testing
└── docs/                   # Documentation
```

## 🏗️ Architecture Overview

Steel Browser follows a plugin-based architecture:

### Core Components

1. **Steel Browser Plugin** (`api/src/steel-browser-plugin.ts`)
   - Registers all the necessary services, routes, and hooks
   - Can be used as a standalone plugin or integrated into your own application
   - Provides the core functionality of Steel Browser

2. **CDP Service** (`api/src/services/cdp/cdp.service.ts`)
   - Manages Chrome DevTools Protocol connections
   - Handles browser lifecycle and page management
   - Supports plugin system for extensibility

2. **CDP Plugin System** (`api/src/services/cdp/plugins/`)
   - **BasePlugin**: Abstract base class for all plugins
   - **PluginManager**: Manages plugin lifecycle and events
   - Plugins can hook into browser events (launch, page creation, navigation, etc.)

3. **Session Management** (`api/src/services/session.service.ts`)
   - Manages browser sessions and their state
   - Handles session persistence and cleanup

4. **File Storage** (`api/src/services/file.service.ts`)
   - Manages file uploads, downloads, and storage
   - Supports session-scoped file management


### Using Steel Browser as a Plugin

```typescript
import Fastify from 'fastify';
import steelBrowserPlugin, { SteelBrowserConfig } from './api/src/steel-browser-plugin.js';

const fastify = Fastify({ logger: true });

// Register Steel Browser plugin with configuration
const config: SteelBrowserConfig = {
  fileStorage: {
    maxSizePerSession: 100 * 1024 * 1024, // 100MB
  },
  customWsHandlers: [
    // Your custom WebSocket handlers
  ],
};

await fastify.register(steelBrowserPlugin, config);

// Your additional routes and plugins
await fastify.register(myCustomPlugin);

await fastify.listen({ port: 3000 });
```

### Configuration Options

The `SteelBrowserConfig` interface allows you to customize:

- **fileStorage**: Configure file storage limits per session
- **customWsHandlers**: Add custom WebSocket handlers for real-time features

### CDP Plugin Development

Using the CDP Plugin System, you can create plugins that hook into browser lifecycle events:

```typescript
import { BasePlugin, PluginOptions } from './api/src/services/cdp/plugins/core/base-plugin.js';
import { Browser, Page } from 'puppeteer-core';

export class MyCustomPlugin extends BasePlugin {
  constructor(options: PluginOptions) {
    super({ name: 'my-custom-plugin', ...options });
  }

  async onBrowserLaunch(browser: Browser): Promise<void> {
    this.cdpService?.logger.info('Custom plugin: Browser launched');
    // Your custom logic here
  }

  async onPageCreated(page: Page): Promise<void> {
    this.cdpService?.logger.info('Custom plugin: New page created');
    // Handle new page creation
    await page.setUserAgent('MyCustomBot/1.0');
  }

  async onPageNavigate(page: Page): Promise<void> {
    // Handle page navigation
    const url = page.url();
    this.cdpService?.logger.info(`Custom plugin: Navigated to ${url}`);
  }

  async onBrowserClose(browser: Browser): Promise<void> {
    // Cleanup when browser closes
    this.cdpService?.logger.info('Custom plugin: Browser closed');
  }

  async onShutdown(): Promise<void> {
    // Cleanup when service shuts down
    this.cdpService?.logger.info('Custom plugin: Service shutting down');
  }
}

// Register the plugin
fastify.cdpService.registerPlugin(new MyCustomPlugin({}));
```

### Available Plugin Hooks

The `BasePlugin` class provides these lifecycle hooks:

- `onBrowserLaunch(browser)`: Called when browser instance starts
- `onPageCreated(page)`: Called when a new page is created
- `onPageNavigate(page)`: Called when a page navigates to a new URL
- `onPageUnload(page)`: Called when a page is about to unload
- `onBeforePageClose(page)`: Called before a page is closed
- `onBrowserClose(browser)`: Called when browser instance closes
- `onShutdown()`: Called during service shutdown
- `onSessionEnd(sessionConfig)`: Called when a session ends

## 🛠️ Development Workflow

### Branch Naming Convention

- `feature/description` - New features
- `fix/description` - Bug fixes  
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test additions/updates

### Commit Message Format

We use [Conventional Commits](https://conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(api): add session timeout configuration
fix(ui): resolve session list refresh issue  
docs: update plugin development guide
test(api): add CDP service unit tests
```

### Code Style & Formatting

We use automated formatting and linting:

```bash
# Format code (API)
npm run pretty -w api

# Lint code (UI)  
npm run lint -w ui

# These run automatically on commit via Husky
```

**Style Guidelines:**
- Use TypeScript for all new code
- Follow existing patterns and conventions
- Add JSDoc comments for public APIs
- Use descriptive variable and function names
- Keep functions small and focused

### Testing

> **Note**: We're currently building out our test suite! This is a great area for contributions.

```bash
# Tests are currently being set up - for now run these checks:
npm run build  # Type checking for both API and UI
npm run lint -w ui  # UI linting  
npm run pretty -w api  # API code formatting

# When tests become available:
# npm test -w api
# npm test -w ui
```

**Testing Guidelines:**
- Write unit tests for new functions and classes
- Add integration tests for API endpoints
- Include end-to-end tests for critical user flows
- Mock external dependencies appropriately
- Aim for meaningful test coverage, not just high percentages

## 🔄 Pull Request Process

### Before Submitting

1. **Create an Issue** (for non-trivial changes)
   - Describe the problem or feature request
   - Discuss the approach with maintainers
   - Reference the issue in your PR

2. **Test Your Changes**
   ```bash
   # Build and test locally
   npm run build
   # npm test  # tests coming soon
   
   # Test with Docker
   docker-compose -f docker-compose.dev.yml up --build
   ```

3. **Update Documentation**
   - Update relevant README sections
   - Add/update JSDoc comments
   - Update API documentation if needed

### PR Checklist

- [ ] Branch is up-to-date with main
- [ ] Code follows project style guidelines
- [ ] Tests pass (when available)
- [ ] Documentation is updated
- [ ] Commit messages follow conventional format
- [ ] PR description clearly explains changes
- [ ] Breaking changes are documented

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature  
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested locally
- [ ] Added/updated tests
- [ ] Tested with Docker

## Related Issues
Fixes #(issue number)
```

## 🐛 Reporting Issues

### Bug Reports

Use our [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- Screenshots/logs if applicable

### Feature Requests

- Check existing issues first
- Describe the use case and motivation
- Provide examples of how it would work
- Consider implementation complexity

## 🌟 Good First Issues

Looking for ways to contribute? Check out issues labeled:

- `good first issue` - Perfect for newcomers
- `help wanted` - We'd love community help
- `documentation` - Improve our docs
- `testing` - Help build our test suite

## 📚 Resources

### Learning Resources

- [Puppeteer Documentation](https://pptr.dev/)
- [Fastify Documentation](https://www.fastify.io/)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Project Resources

- [API Documentation](http://localhost:3000/documentation)
- [Steel Cookbook](https://github.com/steel-dev/steel-cookbook) - Usage examples
- [Discord Community](https://discord.gg/steel-dev) - Get help and discuss

## 🤝 Community Guidelines

### Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors. Please:

- Be respectful and constructive in discussions
- Help newcomers and answer questions
- Provide helpful feedback in code reviews
- Report any unacceptable behavior to maintainers

### Getting Help

- **Discord**: Join our [Discord server](https://discord.gg/steel-dev) for real-time help
- **GitHub Issues**: For bug reports and feature requests
- **GitHub Discussions**: For questions and general discussion

### Recognition

We appreciate all contributions! Contributors are recognized:

- In our README contributors section
- In our Discord server + Changelog announcements
- Through GitHub's contribution tracking
- In release notes for significant contributions
- Potential invitation to join the core team

## 🔧 Advanced Development

### Environment Variables

Key environment variables for development:

```bash
# API Configuration
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
CHROME_HEADLESS=false  # For debugging
ENABLE_CDP_LOGGING=true  # For detailed logs

# UI Configuration  
API_URL=http://localhost:3000
```

### Debugging

```bash
# Debug API with Chrome DevTools
node --inspect ./api/build/index.js

# Debug with VS Code
# Use the provided launch configurations

# Enable verbose logging
ENABLE_VERBOSE_LOGGING=true npm run dev -w api
```

## 📝 Documentation

### Writing Documentation

- Use clear, concise language
- Include code examples
- Add screenshots for UI features
- Keep examples up-to-date
- Follow markdown best practices

### Documentation Structure

- **README.md**: Project overview and quick start
- **CONTRIBUTING.md**: This file - contribution guidelines
- **API docs**: Auto-generated from OpenAPI schemas
- **Architecture docs**: High-level system design
- **Plugin docs**: Plugin development guides

## 🚀 Release Process

### Automated Releases

We use automated semantic versioning based on conventional commits:

- **Automatic Version Bumping**: Versions are automatically bumped based on commit messages
  - `patch`: Commits with `patch`, `fix`, `fixes`, or `docs` 
  - `minor`: Commits with `feat`, `feature`, or `minor`
  - `major`: Commits with `breaking`, `breaking-change`, or `major`

- **Beta Releases**: All releases are tagged with `-beta` suffix initially
- **Automatic Changelog**: Generated from commit history with categorized changes
- **GitHub Releases**: Automatically created with changelog and community links

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes (triggered by `breaking`, `breaking-change`, `major` in commits)
- **MINOR**: New features, backwards compatible (triggered by `feat`, `feature`, `minor`)
- **PATCH**: Bug fixes, backwards compatible (triggered by `patch`, `fix`, `fixes`, `docs`)

### Release Workflow

The release process is fully automated via GitHub Actions:

1. **Push to main**: Any push to the main branch triggers the release workflow
2. **Version bump**: Automatically determines version based on commit messages
3. **Changelog generation**: Creates categorized changelog from commits
4. **GitHub release**: Creates release with changelog and community links
5. **Tag creation**: Tags the release with the new version

### Manual Release Steps (if needed)

If manual intervention is required:

1. Ensure commit messages follow conventional format
2. Push changes to main branch
3. Monitor the GitHub Actions workflow
4. Verify the release was created successfully
5. Announce on Discord/social media

---

## Thank You! 🙏

Thank you for contributing to Steel Browser! Your contributions help make browser automation more accessible and powerful for developers worldwide.

**Happy hacking!** 🎉 