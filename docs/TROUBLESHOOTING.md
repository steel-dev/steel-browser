# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with Steel Browser.

## 🚀 Quick Diagnostics

### Health Check Commands

```bash
# Check if services are running
curl http://localhost:3000/health

# Check API documentation
curl http://localhost:3000/documentation

# Test basic functionality
cd repl && npm start
```

### Environment Verification

```bash
# Check Node.js version (should be 22+)
node --version

# Check npm version
npm --version

# Check Chrome/Chromium
google-chrome --version
# or
chromium --version

# Check Docker (if using containers)
docker --version
docker-compose --version
```

## 🔧 Common Issues

### 1. Browser Launch Failures

#### Symptoms
- "Failed to launch browser" errors
- Chrome executable not found
- Permission denied errors

#### Solutions

**Chrome Not Found:**
```bash
# Set Chrome executable path
export CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome
# or for macOS
export CHROME_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# or for Windows
set CHROME_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

**Permission Issues (Linux):**
```bash
# Add user to necessary groups
sudo usermod -a -G audio,video $USER

# Install required dependencies
sudo apt-get update
sudo apt-get install -y \
  libnss3-dev \
  libatk-bridge2.0-dev \
  libdrm-dev \
  libxcomposite-dev \
  libxdamage-dev \
  libxrandr-dev \
  libgbm-dev \
  libxss-dev \
  libasound2-dev
```

**Headless Mode Issues:**
```bash
# Disable headless mode for debugging
export CHROME_HEADLESS=false

# Or run with virtual display
export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x24 &
```

### 2. Port Conflicts

#### Symptoms
- "Port already in use" errors
- Cannot connect to API
- Services fail to start

#### Solutions

```bash
# Check what's using the ports
lsof -i :3000  # API port
lsof -i :5173  # UI port
lsof -i :9223  # CDP port

# Kill processes using the ports
kill -9 $(lsof -t -i:3000)

# Use different ports
export PORT=3001
export CDP_REDIRECT_PORT=9224
```

### 3. Memory Issues

#### Symptoms
- Browser crashes
- "Out of memory" errors
- Slow performance

#### Solutions

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Monitor memory usage
docker stats  # if using Docker
htop          # system monitor

# Reduce concurrent sessions
# Limit browser instances in your code
```

### 4. Network/Proxy Issues

#### Symptoms
- Cannot reach external websites
- Proxy authentication failures
- SSL/TLS errors

#### Solutions

```bash
# Set proxy configuration
export PROXY_URL="http://proxy.company.com:8080"
export PROXY_URL="http://username:password@proxy.company.com:8080"

# Disable SSL verification (development only)
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Check network connectivity
curl -I https://google.com
```

### 5. File Permission Issues

#### Symptoms
- Cannot write files
- Session storage errors
- Extension loading failures

#### Solutions

```bash
# Fix file permissions
chmod -R 755 ./files
chmod -R 755 ./.cache

# Check disk space
df -h

# Create required directories
mkdir -p ./files
mkdir -p ./.cache
mkdir -p ./api/extensions/recorder/dist
```

### 6. Docker Issues

#### Symptoms
- Container fails to start
- Cannot access services
- Build failures

#### Solutions

```bash
# Clean Docker cache
docker system prune -a

# Rebuild without cache
docker-compose build --no-cache

# Check container logs
docker-compose logs api
docker-compose logs ui

# Fix volume permissions
sudo chown -R $USER:$USER ./.cache
```

## 🐛 Debugging Techniques

### 1. Enable Debug Logging

```bash
# Enable all debug logging
export NODE_ENV=development
export ENABLE_VERBOSE_LOGGING=true
export ENABLE_CDP_LOGGING=true
export LOG_CUSTOM_EMIT_EVENTS=true

# Start with debug logging
npm run dev -w api
```

### 2. Chrome DevTools Debugging

```bash
# Start API with inspector
node --inspect ./api/build/index.js

# Or with specific port
node --inspect=0.0.0.0:9229 ./api/build/index.js

# Then open Chrome and go to:
# chrome://inspect
```

### 3. Browser Debugging

```bash
# Run Chrome in non-headless mode
export CHROME_HEADLESS=false

# Enable Chrome debugging
export DEBUG_CHROME_PROCESS=true

# Connect to browser DevTools
# Open http://localhost:9223 in your browser
```

### 4. Network Debugging

```bash
# Monitor network requests
export ENABLE_CDP_LOGGING=true

# Use network debugging tools
tcpdump -i any port 3000
wireshark  # GUI network analyzer
```

### 5. Performance Debugging

```bash
# Enable performance monitoring
node --prof ./api/build/index.js

# Generate performance report
node --prof-process isolate-*.log > performance.txt

# Memory profiling
node --inspect --expose-gc ./api/build/index.js
```

## 📊 Log Analysis

### Understanding Log Levels

```
ERROR - Critical issues requiring immediate attention
WARN  - Potential issues that might cause problems
INFO  - General information about system operation
DEBUG - Detailed information for troubleshooting
TRACE - Very detailed execution information
```

### Common Log Patterns

**Successful Session Creation:**
```
INFO: Session created successfully {sessionId: "abc123"}
INFO: Browser launched {pid: 12345}
INFO: Primary page created {url: "about:blank"}
```

**Connection Issues:**
```
ERROR: Failed to connect to Chrome {error: "ECONNREFUSED"}
WARN: Retrying browser launch {attempt: 2}
```

**Memory Warnings:**
```
WARN: High memory usage detected {usage: "85%"}
INFO: Garbage collection triggered
```

## 🔍 Diagnostic Commands

### System Information

```bash
# Get system info
uname -a                    # System information
free -h                     # Memory usage
df -h                       # Disk usage
ps aux | grep chrome        # Chrome processes
ps aux | grep node          # Node processes
```

### Steel Browser Specific

```bash
# Check API health
curl -s http://localhost:3000/health | jq

# List active sessions
curl -s http://localhost:3000/v1/sessions | jq

# Get session details
curl -s http://localhost:3000/v1/sessions/SESSION_ID | jq

# Check file service
ls -la ./files/

# Check cache
ls -la ./.cache/
```

### Docker Diagnostics

```bash
# Container status
docker-compose ps

# Container logs
docker-compose logs --tail=50 api
docker-compose logs --tail=50 ui

# Container resource usage
docker stats

# Network information
docker network ls
docker network inspect steel-network
```

## 🚨 Error Codes

### HTTP Status Codes

- **400 Bad Request**: Invalid request parameters
- **404 Not Found**: Session or resource not found
- **408 Request Timeout**: Operation timed out
- **409 Conflict**: Resource conflict (e.g., session already exists)
- **500 Internal Server Error**: Server-side error
- **503 Service Unavailable**: Browser not available

### Custom Error Codes

- **BROWSER_LAUNCH_FAILED**: Cannot start browser process
- **SESSION_NOT_FOUND**: Session ID doesn't exist
- **PAGE_LOAD_TIMEOUT**: Page failed to load within timeout
- **CHROME_EXECUTABLE_NOT_FOUND**: Chrome binary not found
- **INSUFFICIENT_MEMORY**: Not enough memory to start browser

## 🛠️ Recovery Procedures

### 1. Restart Services

```bash
# Graceful restart
npm run dev  # Ctrl+C then restart

# Force restart
pkill -f "node.*steel"
npm run dev

# Docker restart
docker-compose restart
```

### 2. Clear Cache and Temp Files

```bash
# Clear application cache
rm -rf ./.cache/*
rm -rf ./files/*

# Clear npm cache
npm cache clean --force

# Clear Docker cache
docker system prune -f
```

### 3. Reset to Clean State

```bash
# Stop all services
docker-compose down

# Remove volumes
docker-compose down -v

# Rebuild everything
docker-compose build --no-cache
docker-compose up
```

### 4. Database/Storage Recovery

```bash
# Clear session storage
rm -rf ./db/data/*

# Reset file storage
rm -rf ./files/*
mkdir -p ./files

# Fix permissions
chmod -R 755 ./files
chmod -R 755 ./.cache
```

## 📞 Getting Help

### Before Asking for Help

1. **Check this troubleshooting guide**
2. **Search existing GitHub issues**
3. **Enable debug logging and collect logs**
4. **Try the basic recovery procedures**
5. **Prepare a minimal reproduction case**

### Information to Include

When reporting issues, include:

```bash
# System information
uname -a
node --version
npm --version
google-chrome --version

# Steel Browser logs (last 50 lines)
tail -50 steel-browser.log

# Configuration
env | grep -E "(CHROME|PORT|HOST|NODE)"

# Steps to reproduce
1. Start Steel Browser
2. Create session with X configuration
3. Navigate to Y URL
4. Error occurs
```

### Support Channels

- **GitHub Issues**: Bug reports and feature requests
- **Discord**: Real-time community support
- **Documentation**: Comprehensive guides and API reference
- **Stack Overflow**: Tag questions with `steel-browser`

### Creating Good Bug Reports

```markdown
## Bug Description
Clear description of what's wrong

## Steps to Reproduce
1. Step one
2. Step two
3. Error occurs

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- OS: Ubuntu 20.04
- Node: v22.0.0
- Steel Browser: v1.0.0
- Chrome: 91.0.4472.124

## Logs
```
Include relevant log output
```

## Additional Context
Any other relevant information
```

## 🔧 Advanced Troubleshooting

### Core Dumps

```bash
# Enable core dumps
ulimit -c unlimited

# Analyze core dump
gdb node core.12345
```

### Memory Leaks

```bash
# Use heap profiler
node --inspect --expose-gc ./api/build/index.js

# Take heap snapshots
kill -USR2 <node_pid>
```

### Network Issues

```bash
# Test network connectivity
ping google.com
nslookup google.com
traceroute google.com

# Check proxy settings
echo $HTTP_PROXY
echo $HTTPS_PROXY
echo $NO_PROXY
```

---

Still having issues? Don't hesitate to reach out to our community for help! 🤝 