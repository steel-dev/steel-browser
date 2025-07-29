# Development Setup Guide

This guide provides comprehensive instructions for setting up a Steel Browser development environment.

## 🎯 Prerequisites

### System Requirements

- **Operating System**: Linux, macOS, or Windows (with WSL2 recommended)
- **RAM**: Minimum 8GB, recommended 16GB+
- **Storage**: At least 10GB free space
- **Network**: Stable internet connection for dependencies

### Required Software

#### 1. Node.js (Version 22+)

**Linux/macOS:**
```bash
# Using Node Version Manager (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# Or using package manager
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm

# macOS with Homebrew
brew install node@22
```

**Windows:**
```powershell
# Using Chocolatey
choco install nodejs --version=22.0.0

# Or download from https://nodejs.org/
```

#### 2. Git

**Linux:**
```bash
sudo apt install git  # Ubuntu/Debian
sudo yum install git   # CentOS/RHEL
```

**macOS:**
```bash
brew install git
# or use Xcode Command Line Tools
xcode-select --install
```

**Windows:**
```powershell
choco install git
# or download from https://git-scm.com/
```

#### 3. Chrome/Chromium Browser

**Linux:**
```bash
# Ubuntu/Debian
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install google-chrome-stable

# Or Chromium
sudo apt install chromium-browser
```

**macOS:**
```bash
brew install --cask google-chrome
# or download from https://www.google.com/chrome/
```

**Windows:**
```powershell
choco install googlechrome
# or download from https://www.google.com/chrome/
```

#### 4. Docker (Optional but Recommended)

**Linux:**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install docker.io docker-compose
sudo usermod -aG docker $USER
newgrp docker

# CentOS/RHEL
sudo yum install docker docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

**macOS:**
```bash
brew install --cask docker
# or download Docker Desktop from https://www.docker.com/products/docker-desktop
```

**Windows:**
```powershell
choco install docker-desktop
# or download Docker Desktop from https://www.docker.com/products/docker-desktop
```

## 🚀 Quick Setup

### 1. Clone the Repository

```bash
# Fork the repository first on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/steel-browser.git
cd steel-browser

# Add upstream remote
git remote add upstream https://github.com/steel-dev/steel-browser.git
```

### 2. Install Dependencies

```bash
# Install all workspace dependencies
npm install

# Verify installation
npm list --depth=0
```

### 3. Build the Project

```bash
# Build all workspaces
npm run build

# Or build individually
npm run build -w api
npm run build -w ui
```

### 4. Start Development Environment

```bash
# Start both API and UI in development mode
npm run dev

# This will start:
# - API server on http://localhost:3000
# - UI server on http://localhost:5173
```

### 5. Verify Setup

```bash
# Test API
curl http://localhost:3000/health

# Test UI
open http://localhost:5173

# Test REPL
cd repl
npm start
```

## 🐳 Docker Development Setup

### 1. Using Docker Compose (Recommended)

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up --build

# Or in detached mode
docker-compose -f docker-compose.dev.yml up -d --build

# View logs
docker-compose -f docker-compose.dev.yml logs -f
```

### 2. Individual Container Setup

```bash
# Build API container
docker build -t steel-browser-api -f ./api/Dockerfile .

# Build UI container
docker build -t steel-browser-ui -f ./ui/Dockerfile .

# Run API container
docker run -p 3000:3000 -p 9223:9223 steel-browser-api

# Run UI container
docker run -p 5173:80 steel-browser-ui
```

## 🔧 Development Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
# .env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
CDP_REDIRECT_PORT=9223

# Chrome Configuration
CHROME_HEADLESS=false  # Set to true for headless mode
CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome  # Adjust path as needed
ENABLE_CDP_LOGGING=true
ENABLE_VERBOSE_LOGGING=true

# Development Features
DEBUG_CHROME_PROCESS=false
LOG_CUSTOM_EMIT_EVENTS=true

# UI Configuration
API_URL=http://localhost:3000
```

### Chrome Configuration

#### Finding Chrome Executable

**Linux:**
```bash
which google-chrome
which chromium-browser
# Common paths:
# /usr/bin/google-chrome
# /usr/bin/chromium-browser
```

**macOS:**
```bash
# Common path:
# /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

**Windows:**
```powershell
# Common paths:
# C:\Program Files\Google\Chrome\Application\chrome.exe
# C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
```

#### Custom Chrome Arguments

```bash
# Add custom Chrome arguments
export CHROME_ARGS="--disable-web-security --disable-features=VizDisplayCompositor"

# Filter out problematic arguments
export FILTER_CHROME_ARGS="--disable-dev-shm-usage"
```

## 🛠️ IDE Setup

### Visual Studio Code

#### Recommended Extensions

```bash
# Install VS Code extensions
code --install-extension ms-typescript.typescript
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
code --install-extension ms-vscode.vscode-typescript-next
code --install-extension ms-vscode.vscode-eslint
```

#### Settings Configuration

Create `.vscode/settings.json`:

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.preferences.includePackageJsonAutoImports": "on",
  "files.exclude": {
    "**/node_modules": true,
    "**/build": true,
    "**/dist": true,
    "**/.cache": true
  }
}
```

#### Debug Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/api/build/index.js",
      "outFiles": ["${workspaceFolder}/api/build/**/*.js"],
      "env": {
        "NODE_ENV": "development",
        "ENABLE_VERBOSE_LOGGING": "true",
        "CHROME_HEADLESS": "false"
      },
      "console": "integratedTerminal",
      "restart": true,
      "runtimeArgs": ["--inspect"]
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": ["run"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    }
  ]
}
```

### WebStorm/IntelliJ IDEA

#### Run Configurations

1. **API Development**
   - Type: Node.js
   - JavaScript file: `api/build/index.js`
   - Environment variables: `NODE_ENV=development;ENABLE_VERBOSE_LOGGING=true`

2. **UI Development**
   - Type: npm
   - Command: `run`
   - Scripts: `dev`
   - Package.json: `ui/package.json`

## 🧪 Testing Setup

### Unit Testing

```bash
# Install testing dependencies (if not already installed)
npm install -D vitest @vitest/ui jsdom

# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with UI
npm test -- --ui
```

### Integration Testing

```bash
# Start test environment
NODE_ENV=test npm run dev -w api

# Run integration tests
npm run test:integration
```

### End-to-End Testing

```bash
# Install E2E testing framework
npm install -D playwright @playwright/test

# Run E2E tests
npx playwright test

# Run E2E tests with UI
npx playwright test --ui
```

## 📊 Development Tools

### Code Quality

```bash
# Format code
npm run pretty -w api
npm run lint -w ui

# Check types
npm run type-check -w api
npm run type-check -w ui

# Pre-commit hooks (automatically set up with Husky)
npm run prepare
```

### Performance Monitoring

```bash
# Start with performance profiling
node --prof ./api/build/index.js

# Generate performance report
node --prof-process isolate-*.log > performance.txt

# Memory usage monitoring
node --inspect --expose-gc ./api/build/index.js
```

### Database/Storage Tools

```bash
# View session storage
ls -la ./db/data/

# View file storage
ls -la ./files/

# Clear storage
rm -rf ./db/data/*
rm -rf ./files/*
```

## 🔄 Development Workflow

### Daily Development

```bash
# 1. Update your fork
git fetch upstream
git checkout main
git merge upstream/main

# 2. Create feature branch
git checkout -b feature/my-new-feature

# 3. Start development environment
npm run dev

# 4. Make changes and test
# ... develop your feature ...

# 5. Run quality checks
npm run pretty -w api
npm run lint -w ui
npm run build

# 6. Commit changes
git add .
git commit -m "feat: add new feature"

# 7. Push and create PR
git push origin feature/my-new-feature
```

### Hot Reloading

The development environment supports hot reloading:

- **API**: Uses `tsx watch` for automatic TypeScript compilation and restart
- **UI**: Uses Vite's hot module replacement (HMR)
- **Extensions**: Require manual rebuild (`npm run prepare:recorder -w api`)

### Debugging Browser Issues

```bash
# Run Chrome in non-headless mode
export CHROME_HEADLESS=false
npm run dev -w api

# Enable Chrome debugging
export DEBUG_CHROME_PROCESS=true

# Connect to Chrome DevTools
# Open http://localhost:9223 in your browser
```

## 🚨 Troubleshooting Development Setup

### Common Issues

#### 1. Node.js Version Mismatch

```bash
# Check current version
node --version

# Switch to correct version
nvm use 22

# Set as default
nvm alias default 22
```

#### 2. Permission Issues (Linux/macOS)

```bash
# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules

# Fix project permissions
sudo chown -R $(whoami) ./node_modules
```

#### 3. Chrome Not Found

```bash
# Find Chrome installation
which google-chrome
which chromium-browser

# Set Chrome path
export CHROME_EXECUTABLE_PATH=/path/to/chrome
```

#### 4. Port Conflicts

```bash
# Check what's using the port
lsof -i :3000
lsof -i :5173

# Kill conflicting processes
kill -9 $(lsof -t -i:3000)

# Use different ports
export PORT=3001
```

#### 5. Memory Issues

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Monitor memory usage
htop
```

### Getting Help

If you encounter issues:

1. Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)
2. Search existing GitHub issues
3. Ask in our Discord community
4. Create a detailed bug report

## 📚 Next Steps

After setting up your development environment:

1. **Read the [Architecture Guide](./ARCHITECTURE.md)** to understand the system design
2. **Explore the [Plugin Development Guide](./PLUGIN_DEVELOPMENT.md)** to create extensions
3. **Check out the [Contributing Guide](../CONTRIBUTING.md)** for contribution guidelines
4. **Browse the [Steel Cookbook](https://github.com/steel-dev/steel-cookbook)** for usage examples

## 🎉 You're Ready!

Your Steel Browser development environment is now set up and ready for development. Happy coding! 🚀

---

**Need help?** Join our [Discord community](https://discord.gg/steel-dev) for real-time support! 