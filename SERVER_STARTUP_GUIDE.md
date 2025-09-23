# Node.js Backend Server Startup Guide

## Problem
The server throws `EADDRINUSE` error when trying to start on port 3001, indicating the port is already in use.

## Solutions Implemented

### 1. Automatic Port Fallback
The server now automatically tries fallback ports (3002, 3003, 3004, 3005) if port 3001 is busy.

### 2. Port Cleanup Utility
A utility script `kill-port.js` has been added to kill processes on specific ports.

### 3. Enhanced Error Handling
Better error messages and graceful handling of port conflicts.

## Step-by-Step Fix Instructions

### Method 1: Use the Enhanced Server (Recommended)
The server now handles port conflicts automatically:

```bash
cd teamapp-backend-node
npm start
```

The server will:
1. Try port 3001 first
2. If busy, automatically try ports 3002, 3003, 3004, 3005
3. Display the actual port it's running on
4. Provide helpful error messages if all ports are busy

### Method 2: Clean Start (Kill processes first)
If you want to ensure port 3001 is free:

```bash
cd teamapp-backend-node
npm run clean-start
```

This will:
1. Kill any processes on ports 3001-3005
2. Start the server on port 3001

### Method 3: Manual Port Cleanup
To manually kill processes on specific ports:

```bash
cd teamapp-backend-node

# Kill processes on specific ports
npm run kill-port 3001 3002 3003

# Or use the script directly
node kill-port.js 3001 3002 3003
```

### Method 4: Windows Command Line (Alternative)
If the npm scripts don't work, use Windows commands directly:

```cmd
# Check what's using port 3001
netstat -ano | findstr :3001

# Kill all Node.js processes (use with caution)
taskkill /F /IM node.exe

# Kill specific process by PID
taskkill /F /PID [PID_NUMBER]
```

## Verification Steps

### 1. Check Server Status
After starting the server, verify it's running:

```bash
# Check if server is responding
curl http://localhost:3001/health

# Or check in browser
# Navigate to: http://localhost:3001/health
```

Expected response:
```json
{
  "status": "OK",
  "timestamp": "2025-01-XX...",
  "environment": "development",
  "connections": {
    "total": 0,
    "activeRooms": 0,
    "rooms": {}
  },
  "uptime": 0.123,
  "memory": {...}
}
```

### 2. Check Port Usage
Verify the server is listening on the correct port:

```cmd
# Windows
netstat -an | findstr :3001

# Should show something like:
# TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING
```

### 3. Test WebSocket Connection
The server should accept WebSocket connections on the same port.

### 4. Check Server Logs
Look for the startup message:
```
Team Collaboration WebSocket Server Started!
==========================================
Server: http://localhost:3001
Environment: development
CORS Origin: http://localhost:3000
Health Check: http://localhost:3001/health
WebSocket: ws://localhost:3001
==========================================
```

## Troubleshooting

### If All Ports Are Busy
1. Check for zombie Node.js processes:
   ```cmd
   tasklist | findstr node
   ```

2. Kill all Node.js processes:
   ```cmd
   taskkill /F /IM node.exe
   ```

3. Restart your terminal/command prompt

4. Try starting the server again

### If Server Starts But Can't Connect
1. Check firewall settings
2. Verify the port is not blocked
3. Check if another service is using the port
4. Try a different port by setting environment variable:
   ```cmd
   set PORT=3002
   npm start
   ```

### If You Get Permission Errors
1. Run command prompt as Administrator
2. Check if antivirus is blocking the port
3. Verify Node.js has necessary permissions

## Environment Variables

You can customize the server behavior with these environment variables:

```bash
# Set custom port
PORT=3002

# Set environment
NODE_ENV=production

# Set CORS origin
CORS_ORIGIN=http://localhost:3000

# Set Python backend URL
PYTHON_BACKEND_URL=http://localhost:8000
```

## Available NPM Scripts

- `npm start` - Start the server with automatic port fallback
- `npm run dev` - Start with nodemon for development
- `npm run kill-port [ports]` - Kill processes on specific ports
- `npm run clean-start` - Kill processes on common ports and start server

## Success Indicators

✅ Server starts without errors  
✅ Health endpoint responds with status "OK"  
✅ No "EADDRINUSE" errors  
✅ WebSocket connections can be established  
✅ Server logs show successful startup message  

## Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| EADDRINUSE error | Use `npm run clean-start` or let server try fallback ports |
| Permission denied | Run as Administrator |
| Port still busy after cleanup | Restart computer or check for system services |
| Server starts but won't respond | Check firewall and antivirus settings |
| WebSocket connection fails | Verify CORS settings and frontend URL |

## Support

If you continue to have issues:
1. Check the server logs for specific error messages
2. Verify all dependencies are installed: `npm install`
3. Check Node.js version: `node --version` (should be >= 16.0.0)
4. Try running in a fresh terminal window

