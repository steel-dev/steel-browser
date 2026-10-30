# Contributing to Steel Browser

Welcome to Steel Browser! 🎉 We're excited that you're interested in contributing to our open-source browser API. This guide will help you get started and make your first contribution.

## 🚀 Quick Start

### Prerequisites

- **Node.js**: Version 22 or higher
- **npm**: Version 10 or higher
- **Docker**: For containerized development (optional but recommended)
- **Git**: For version control
- **Chrome/Chromium**: Required to run the API outside Docker

The [Development Setup Guide](docs/DEVELOPMENT_SETUP.md) has install steps for each platform.

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/steel-browser.git
   cd steel-browser
   git remote add upstream https://github.com/steel-dev/steel-browser.git
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
   - REPL: Run `npm start -w repl` (see [repl/README.md](repl/README.md))

### Docker Development (Alternative)

```bash
# Build and run your local changes
docker compose -f docker-compose.dev.yml up --build

# Or use production images
docker compose up
```

## 📁 Project Structure

```
steel-browser/
├── api/                    # Backend API (Fastify + Puppeteer)
│   ├── src/
│   │   ├── modules/        # Route modules (actions, sessions, commands, etc.)
│   │   ├── plugins/        # Fastify plugins
│   │   ├── services/       # Core services (CDP, session, file, commands)
│   │   └── types/          # TypeScript type definitions
│   └── extensions/         # Browser extensions (must pass name as param to session creation)
├── ui/                     # Frontend UI (React + Vite)
│   └── src/
│       ├── components/     # Reusable UI components
│       ├── containers/     # Page containers
│       └── contexts/       # React contexts
├── repl/                   # Example scripts to try a running server
└── docs/                   # Guides and references
```

## 🏗️ Architecture Overview

Steel Browser follows a plugin-based architecture. The [Architecture Overview](docs/ARCHITECTURE.md) covers it in depth.

### Core Components

1. **Steel Browser Plugin** (`api/src/steel-browser-plugin.ts`)
   - Registers all the necessary services, routes, and hooks
   - Can be used as a standalone plugin or registered in your own Fastify app (`SteelBrowserConfig` in the same file lists the options)

2. **CDP Service** (`api/src/services/cdp/cdp.service.ts`)
   - Manages Chrome DevTools Protocol connections
   - Handles browser lifecycle and page management
   - Supports plugin system for extensibility

3. **CDP Plugin System** (`api/src/services/cdp/plugins/`)
   - **BasePlugin**: Abstract base class for all plugins
   - **PluginManager**: Manages plugin lifecycle and events
   - Plugins can hook into browser events (launch, page creation, navigation, etc.)

4. **Session Management** (`api/src/services/session.service.ts`)
   - Manages browser sessions and their state
   - Handles session persistence and cleanup

5. **File Storage** (`api/src/services/file.service.ts`)
   - Manages file uploads, downloads, and storage
   - Supports session-scoped file management

6. **Commands API** (`api/src/services/commands/`)
   - Drives the browser with high-level commands, built for AI agents
   - Experimental and off by default (`ENABLE_COMMANDS_API=true`)

### Going Deeper

- **CDP plugins**: The [Plugin Development Guide](docs/PLUGIN_DEVELOPMENT.md) shows how to write one. `BasePlugin` in `api/src/services/cdp/plugins/core/base-plugin.ts` defines every lifecycle hook.
- **Commands API**: [docs/COMMANDS.md](docs/COMMANDS.md) documents every command, the response format, and error codes.

## 🛠️ Development Workflow

### Branch Naming Convention

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test additions/updates
- `chore/description` - Maintenance and dependency updates

### PR Titles and Commit Messages

We squash merge pull requests, so the PR title becomes the commit message on `main`. PR titles must follow [Conventional Commits](https://conventionalcommits.org/), and CI checks them ([`pr-checks.yml`](.github/workflows/pr-checks.yml)):

```
type(scope): description
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Maintenance tasks, such as dependency updates
- `revert`: Reverting an earlier change

The scope is optional, for example `api`, `cdp`, `docker`, or `deps`.

**Examples:**
```
feat(api): add session timeout configuration
fix(cdp): keep mobile emulation overrides alive
chore(deps): refresh dependencies
docs: update plugin development guide
```

Release notes group changes by type, so pick the one that fits best.

### Code Style & Formatting

We use automated formatting and type checking:

```bash
# Format code (API)
npm run pretty -w api

# Check types (UI)
npm run typecheck -w ui
```

A pre-commit hook formats your changes before each commit.

**Style Guidelines:**
- Use TypeScript for all new code
- Follow existing patterns and conventions
- Add JSDoc comments for public APIs
- Use descriptive variable and function names
- Keep functions small and focused

### Testing

The API has unit and integration tests written with [Vitest](https://vitest.dev/):

```bash
npm test         # Run the API tests
npm run build    # Type-check and build the API and UI
```

Most tests that drive a real browser are skipped unless `CHROME_EXECUTABLE_PATH` points to Chrome or Chromium. Some always launch the browser from its default install path, so install Chrome or Chromium before you run the suite. CI sets the variable, so set it locally too when you change browser code:

```bash
CHROME_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test
```

`npm run test:heavy -w api` also runs the large, slow pages in the scrape evaluation.

**Testing Guidelines:**
- Put tests next to the code they cover, as `*.test.ts` files
- Write unit tests for new functions and classes
- Add integration tests for API endpoints
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
   npm test

   # Test with Docker
   docker compose -f docker-compose.dev.yml up --build
   ```

3. **Update Documentation**
   - Update relevant README and `docs/` sections
   - Add/update JSDoc comments
   - Keep route schemas accurate, since they generate the API docs at `/documentation`

### PR Checklist

- [ ] Branch is up-to-date with main
- [ ] PR title follows Conventional Commits
- [ ] Code follows project style guidelines
- [ ] Tests pass (`npm test`)
- [ ] Documentation is updated
- [ ] PR description clearly explains changes
- [ ] Breaking changes are documented

CI runs the API tests ([`test.yml`](.github/workflows/test.yml)), builds the Docker images ([`check-build.yml`](.github/workflows/check-build.yml)), and checks the PR title ([`pr-checks.yml`](.github/workflows/pr-checks.yml)).

### PR Template

When you open a pull request, GitHub fills in our [PR template](.github/pull_request_template.md). Fill in the sections that apply to your change.

## 🐛 Reporting Issues

### Bug Reports

Use our [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- Screenshots/logs if applicable

### Feature Requests

Use our [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) and:

- Check existing issues first
- Describe the use case and motivation
- Provide examples of how it would work
- Consider implementation complexity

### Security Issues

Please don't report security vulnerabilities in public issues. Email security@steel.dev instead.

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

- [API Documentation](http://localhost:3000/documentation) (when the API runs locally)
- [Documentation Index](docs/README.md)
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

- In our Discord server + Changelog announcements
- Through GitHub's contribution tracking
- In release notes, which credit the author of every merged PR
- Potential invitation to join the core team

## 🔧 Advanced Development

### Environment Variables

The API reads `api/.env` when you run it locally. [`api/.env.example`](api/.env.example) lists the common variables, and [`api/src/env.ts`](api/src/env.ts) defines all of them with their defaults. These are handy while developing:

```bash
CHROME_HEADLESS=false        # Show the browser window
ENABLE_VERBOSE_LOGGING=true  # Include extra log arguments in development logs
ENABLE_COMMANDS_API=true     # Turn on the experimental Commands API
```

The UI dev server proxies `/api` and `/ws` to `http://localhost:3000`, so it needs no configuration. `API_URL` only applies to the UI Docker image.

### Debugging

```bash
# Debug the built API with the Node.js inspector
npm run build -w api
cd api && node --inspect build/index.js

# Enable verbose logging
ENABLE_VERBOSE_LOGGING=true npm run dev -w api
```

Then attach a debugger, for example Chrome DevTools at `chrome://inspect`. The [Troubleshooting Guide](docs/TROUBLESHOOTING.md) covers common problems.

## 📝 Documentation

### Writing Documentation

- Use clear, concise language
- Include code examples
- Add screenshots for UI features
- Keep examples up-to-date
- Follow markdown best practices

### Documentation Structure

- **[README.md](README.md)**: Project overview and quick start
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: This file - contribution guidelines
- **[docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md)**: Development environment setup
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: High-level system design
- **[docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md)**: Plugin development guide
- **[docs/COMMANDS.md](docs/COMMANDS.md)**: Commands API reference
- **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**: Common issues and solutions
- **API docs**: Generated from the route schemas and served at `/documentation`

## 🚀 Release Process

Releases are automated by [`release.yml`](.github/workflows/release.yml), which runs on every push to `main`:

1. **Version bump**: Picks the next version from commit messages. `breaking`, `breaking-change`, or `major` bumps the major version. Anything else, including `feat`, bumps the patch version.
2. **Tag**: Tags the version with a `-beta` suffix, such as `v0.5.4-beta`. If that tag already exists, the release is skipped.
3. **Changelog**: Builds the changelog from commit titles, with sections for `feat`, `fix`, and `docs` changes.
4. **GitHub release**: Publishes the release with the changelog and community links.

The workflow doesn't commit the new version back. Every run starts from the version in the root `package.json`, so a new release only goes out after a PR raises that version.

---

## Thank You! 🙏

Thank you for contributing to Steel Browser! Your contributions help make browser automation more accessible and powerful for developers worldwide.

**Happy hacking!** 🎉
