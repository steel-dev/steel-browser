# WebRTC Debugging Guide for Steel Browser

This guide provides comprehensive information on debugging WebRTC functionality in the Steel Browser project.

## Overview

The WebRTC implementation in Steel Browser consists of several key components:

- **WebRTC Server**: Manages peer connections and signaling
- **Stream Capture**: Handles display capture via FFmpeg and RTP streaming  
- **WebSocket Handler**: Manages client connections and message routing
- **Debug Utils**: Provides monitoring, diagnostics, and health checks

## Quick Start

### 1. Enable Debug Mode

Set the environment variable to enable detailed WebRTC logging:

```bash
export WEBRTC_DEBUG=true
```

### 2. Run the Test Script

Use the included test script to check WebRTC functionality:

```bash
# Quick status check
node api/test-webrtc.js status

# Detailed health check  
node api/test-webrtc.js health --detailed

# Run all tests
node api/test-webrtc.js test-all

# Start continuous monitoring
node api/test-webrtc.js monitor --interval 30000
```

### 3. Check Debug Endpoints

The following HTTP endpoints are available for debugging:

- `GET /v1/webrtc/status` - Current WebRTC status
- `GET /v1/webrtc/health` - System health check  
- `GET /v1/webrtc/clients` - List active connections
- `POST /v1/webrtc/test-connectivity` - Test WebRTC connectivity
- `GET /v1/webrtc/debug-report` - Generate comprehensive report

## Common Issues and Solutions

### 1. No RTP Packets Received

**Symptoms:**
- Stream capture shows 0 packets received
- Clients connect but see no video
- FFmpeg appears to be running

**Debug Steps:**
```bash
# Check if FFmpeg is running
node api/test-webrtc.js health --detailed

# Test RTP reception specifically  
node api/test-webrtc.js test-rtp --duration 15000

# Check if RTP port is open
netstat -ln | grep :5004
```

**Common Causes:**
- Display server not available (check DISPLAY environment variable)
- FFmpeg not capturing properly (check X11 permissions)
- RTP port blocked or in use by another process
- FFmpeg started with wrong parameters

**Solutions:**
```bash
# Verify display is available
DISPLAY=:10.0 xdpyinfo

# Check FFmpeg processes
pgrep -f 'ffmpeg.*x11grab'

# Kill stale FFmpeg processes
pkill -f 'ffmpeg.*x11grab'

# Restart with proper display permissions
xhost +local:
```

### 2. WebRTC Connection Failures

**Symptoms:**
- Peer connections fail to establish
- ICE candidates not generated
- Signaling state stuck

**Debug Steps:**
```bash
# Test basic WebRTC connectivity
node api/test-webrtc.js test

# Check active connections
node api/test-webrtc.js clients --detailed

# Get connection diagnostics
curl http://localhost:3000/v1/webrtc/diagnostics/CLIENT_ID
```

**Common Causes:**
- STUN servers not reachable
- Network firewall blocking UDP traffic
- WebRTC library issues
- Browser compatibility problems

**Solutions:**
```bash
# Test STUN server connectivity
nslookup stun.l.google.com
telnet stun.l.google.com 19302

# Check firewall rules
iptables -L | grep -E '(5004|19302)'

# Update WebRTC library if needed
npm update @roamhq/wrtc
```

### 3. High Memory Usage

**Symptoms:**
- Memory usage continuously growing
- Server becomes unresponsive
- Out of memory errors

**Debug Steps:**
```bash
# Monitor memory usage
node api/test-webrtc.js health --detailed

# Start continuous monitoring
node api/test-webrtc.js monitor --interval 10000

# Generate memory report
node --inspect=9229 api/build/index.js
```

**Common Causes:**
- WebRTC connections not properly cleaned up
- FFmpeg process leaks
- Event listeners not removed
- Large RTP packet buffers

**Solutions:**
- Ensure all connections are properly closed
- Monitor connection lifecycle logs
- Implement connection timeouts
- Restart server periodically in production

### 4. Poor Video Quality

**Symptoms:**
- Low framerate or choppy video
- High latency
- Frequent packet loss

**Debug Steps:**
```bash
# Check stream statistics
node api/test-webrtc.js status

# Monitor RTP reception
node api/test-webrtc.js test-rtp --duration 30000

# Generate performance report
node api/test-webrtc.js report --output performance.json
```

**Common Causes:**
- Insufficient CPU resources
- Network bandwidth limitations
- FFmpeg encoding settings too aggressive
- Display resolution too high

**Solutions:**
```bash
# Reduce capture resolution
export CAPTURE_WIDTH=1280
export CAPTURE_HEIGHT=720

# Lower framerate
export CAPTURE_FRAMERATE=15

# Optimize FFmpeg settings
# (Modify entrypoint.sh ffmpeg parameters)
```

## Environment Variables

Key environment variables for WebRTC debugging:

```bash
# Enable detailed logging
WEBRTC_DEBUG=true

# Display server
DISPLAY=:10.0

# RTP streaming port  
RTP_PORT=5004

# Capture settings
CAPTURE_WIDTH=1920
CAPTURE_HEIGHT=1080
CAPTURE_FRAMERATE=30

# Node.js debugging
NODE_ENV=development
```

## Log Analysis

### WebRTC Server Logs

Look for these patterns in the logs:

```
[WebRTCServer] INFO: Creating peer connection for client abc123
[WebRTCServer] DEBUG: ICE candidate event for client abc123
[WebRTCServer] INFO: Connection state changed from "connecting" to "connected"
[WebRTCServer] ERROR: Error adding ICE candidate for client abc123
```

### Stream Capture Logs

Monitor stream capture activity:

```
[StreamCapture] INFO: FFmpeg process detected with PID 12345
[StreamCapture] DEBUG: RTP packet received, length: 1316 bytes
[StreamCapture] INFO: Stream statistics: 850 pps, 12.5 Mbps, 28 fps
[StreamCapture] WARN: No RTP packets received in 15 seconds
```

### WebRTC Casting Logs

Track client connections:

```
[WebRTCCasting] INFO: New WebRTC session request from client
[WebRTCCasting] DEBUG: Message received from client: {"type":"answer"}
[WebRTCCasting] INFO: Session summary: 45s duration, 234 messages
```

## Performance Monitoring

### Built-in Monitoring

Start continuous health monitoring:

```bash
# Start monitoring with 30-second intervals
node api/test-webrtc.js monitor --interval 30000

# Stop monitoring
node api/test-webrtc.js stop-monitor
```

### Custom Monitoring

Create custom monitoring scripts using the debug endpoints:

```bash
#!/bin/bash
while true; do
  echo "=== $(date) ==="
  curl -s http://localhost:3000/v1/webrtc/status | jq '.stream.rtpStats'
  sleep 30
done
```

### Metrics to Monitor

Key metrics for WebRTC health:

- **Connection Count**: Number of active WebRTC connections
- **Packet Rate**: RTP packets received per second
- **Bitrate**: Video stream bitrate in Mbps  
- **Memory Usage**: Heap memory consumption
- **Connection States**: Distribution of WebRTC connection states
- **Error Rates**: Frequency of connection errors

## Debugging Tools

### 1. Test Script

The included test script provides comprehensive debugging:

```bash
# Full test suite
node api/test-webrtc.js test-all --detailed

# Specific component tests
node api/test-webrtc.js test        # WebRTC connectivity
node api/test-webrtc.js test-rtp    # RTP reception
node api/test-webrtc.js validate    # Configuration validation
```

### 2. HTTP Debug Endpoints

Query debug information via HTTP:

```bash
# Get current status
curl http://localhost:3000/v1/webrtc/status

# Detailed system health
curl http://localhost:3000/v1/webrtc/health?detailed=true  

# Test connectivity
curl -X POST http://localhost:3000/v1/webrtc/test-connectivity

# Download debug report
curl http://localhost:3000/v1/webrtc/debug-report?format=download \
  -o webrtc-debug-$(date +%Y%m%d-%H%M%S).json
```

### 3. System Tools

Use standard system tools for additional debugging:

```bash
# Monitor FFmpeg processes
watch 'ps aux | grep ffmpeg'

# Check network connections
netstat -tulpn | grep -E '(3000|5004)'

# Monitor system resources
htop

# Check X11 display
DISPLAY=:10.0 xwininfo -root -tree

# Network packet capture
tcpdump -i lo -p udp port 5004
```

## Troubleshooting Checklist

Before diving deep into debugging, run through this checklist:

### ✅ Basic Requirements
- [ ] Node.js version >= 22
- [ ] Display server running (Xvfb or similar)  
- [ ] FFmpeg installed and accessible
- [ ] Required ports available (3000, 5004)
- [ ] Proper environment variables set

### ✅ Service Health  
- [ ] Steel Browser API server running
- [ ] WebRTC debug endpoints responding
- [ ] FFmpeg processes detected
- [ ] RTP packets being received
- [ ] No critical errors in logs

### ✅ Network Connectivity
- [ ] STUN servers reachable
- [ ] UDP traffic allowed
- [ ] WebSocket connections working
- [ ] No firewall blocking ports

### ✅ Resource Usage
- [ ] Adequate CPU available
- [ ] Memory usage within limits  
- [ ] Disk space sufficient
- [ ] No resource leaks detected

## Advanced Debugging

### WebRTC Statistics

Access detailed WebRTC statistics programmatically:

```javascript
// Get connection statistics  
const stats = webRTCServer.getConnectionStats(clientId);
console.log('RTT:', stats.rtt);
console.log('Packets Lost:', stats.packetsLost);

// Monitor connection state changes
const state = webRTCServer.getConnectionState(clientId);
console.log('Connection State:', state.connectionState);
console.log('ICE State:', state.iceConnectionState);
```

### Custom Debug Logging

Add custom debug points:

```javascript
import webRTCDebugUtils from './debug-utils.js';

// Log custom events
webRTCDebugUtils.logSystemStatus();

// Generate reports programmatically  
const report = await webRTCDebugUtils.generateDebugReport();
```

### Memory Profiling

Profile memory usage with Node.js tools:

```bash
# Start with heap profiling
node --inspect --max-old-space-size=4096 api/build/index.js

# Generate heap snapshot
curl http://localhost:9229/json/list
# Use Chrome DevTools to connect and analyze
```

## Getting Help

If you're still experiencing issues:

1. **Generate a Debug Report**:
   ```bash
   node api/test-webrtc.js report --output debug-report.json
   ```

2. **Collect System Information**:
   ```bash
   # System details
   uname -a
   node --version
   npm list @roamhq/wrtc
   
   # Process information
   ps aux | grep -E '(ffmpeg|node|chrome)'
   
   # Network status
   netstat -tulpn | grep -E '(3000|5004)'
   ```

3. **Check Server Logs**: Look for ERROR and WARN messages in the server output

4. **Verify Configuration**: Run `node api/test-webrtc.js validate` to check setup

5. **Test Incrementally**: Use individual test commands to isolate the issue

## Contributing Debug Features

When adding new debug features:

1. Add logging to key code paths
2. Include error context and stack traces  
3. Create corresponding test script commands
4. Document new debug endpoints
5. Update this guide with troubleshooting steps

## Reference

### Debug Endpoint Reference

| Endpoint | Method | Description |
|----------|---------|------------|
| `/webrtc/status` | GET | Current WebRTC status |
| `/webrtc/health` | GET | System health check |
| `/webrtc/clients` | GET | List active clients |
| `/webrtc/diagnostics/:id` | GET | Client diagnostics |
| `/webrtc/test-connectivity` | POST | Test WebRTC connectivity |  
| `/webrtc/test-rtp` | POST | Test RTP reception |
| `/webrtc/debug-report` | GET | Generate debug report |
| `/webrtc/validate-config` | GET | Validate configuration |
| `/webrtc/start-monitoring` | POST | Start health monitoring |
| `/webrtc/stop-monitoring` | POST | Stop health monitoring |

### Test Script Commands

| Command | Description | Options |
|---------|-------------|---------|
| `status` | Get WebRTC status | `--detailed` |
| `health` | System health check | `--detailed` |  
| `test` | WebRTC connectivity test | |
| `test-rtp` | RTP reception test | `--duration` |
| `test-all` | Run all tests | `--detailed` |
| `monitor` | Start monitoring | `--interval` |
| `report` | Generate debug report | `--output` |
| `validate` | Validate config | |
| `clients` | List active clients | `--detailed` |

### Log Levels

- **ERROR**: Critical issues requiring attention
- **WARN**: Potential problems or degraded performance  
- **INFO**: Important operational events
- **DEBUG**: Detailed diagnostic information (requires WEBRTC_DEBUG=true)

---

For the most up-to-date debugging information, check the [Steel Browser repository](https://github.com/steel-browser/steel-browser) and review recent commits to the WebRTC components.