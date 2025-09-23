# WebSocket Server Testing Guide

This guide provides comprehensive testing instructions for the Team Collaboration WebSocket server to verify that all authentication, rate limiting, and connection issues have been resolved.

## Prerequisites

1. **Backend Server Running**: Ensure your Python FastAPI backend is running on `http://localhost:8000`
2. **WebSocket Server Running**: Start the Node.js WebSocket server with `npm start`
3. **Valid JWT Tokens**: Have valid access tokens for testing different user scenarios

## Test Environment Setup

### 1. Start the WebSocket Server

```bash
cd D:\TeamCollaborationApp\teamapp-backend-node
npm start
```

The server should start on port 3001 (or fallback ports 3002-3005 if 3001 is busy).

### 2. Verify Server Health

```bash
# Test health endpoint
curl http://localhost:3001/health

# Expected response:
{
  "status": "OK",
  "timestamp": "2024-01-XX...",
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

## Testing Scenarios

### Test 1: Basic Connection and Authentication

**Objective**: Verify that valid tokens allow successful WebSocket connections.

**Steps**:
1. Open browser developer tools
2. Connect to WebSocket with valid token:
```javascript
const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-valid-jwt-token-here'
  }
});

socket.on('connected', (data) => {
  console.log('Connected:', data);
});

socket.on('authenticated', (data) => {
  console.log('Authenticated:', data);
});
```

**Expected Results**:
- ✅ Connection established
- ✅ Authentication successful
- ✅ User receives `authenticated` event with user data and teams
- ✅ No rate limiting errors

### Test 2: Multiple Connections from Localhost

**Objective**: Verify that localhost connections are not rate-limited aggressively.

**Steps**:
1. Open multiple browser tabs (5-10 tabs)
2. Connect each tab to the WebSocket server with the same valid token
3. Monitor server logs for rate limiting messages

**Expected Results**:
- ✅ All connections should succeed (up to 20 concurrent localhost connections)
- ✅ No "rate limit exceeded" messages in server logs
- ✅ Short cooldown period (500ms) between localhost connections

### Test 3: Token Expiration Handling

**Objective**: Verify graceful handling of expired tokens.

**Steps**:
1. Use an expired JWT token
2. Attempt to connect to WebSocket
3. Test token refresh functionality

```javascript
// Test with expired token
const socket = io('http://localhost:3001', {
  auth: {
    token: 'expired-jwt-token-here'
  }
});

socket.on('authentication_error', (data) => {
  console.log('Auth Error:', data);
  // Should receive TOKEN_EXPIRED code with REFRESH_TOKEN action
});

// Test token refresh
socket.emit('refresh_token', {
  token: 'new-valid-token-here'
});

socket.on('token_refreshed', (data) => {
  console.log('Token refreshed:', data);
});
```

**Expected Results**:
- ✅ Receives `authentication_error` with `TOKEN_EXPIRED` code
- ✅ Action is `REFRESH_TOKEN`
- ✅ Socket is not immediately disconnected (5-second grace period)
- ✅ Token refresh works when valid token is provided

### Test 4: Invalid Token Handling

**Objective**: Verify proper handling of malformed or invalid tokens.

**Steps**:
1. Test with malformed JWT token
2. Test with completely invalid token
3. Test with missing token

```javascript
// Test malformed token
const socket1 = io('http://localhost:3001', {
  auth: { token: 'invalid.jwt.token' }
});

// Test missing token
const socket2 = io('http://localhost:3001', {
  auth: {}
});

socket1.on('authentication_error', (data) => {
  console.log('Malformed token error:', data);
});

socket2.on('authentication_required', (data) => {
  console.log('Missing token:', data);
});
```

**Expected Results**:
- ✅ Malformed tokens receive `INVALID_TOKEN` code with `RELOGIN` action
- ✅ Missing tokens receive `MISSING_TOKEN` code with `PROVIDE_TOKEN` action
- ✅ 10-second grace period for missing tokens
- ✅ Immediate disconnect for invalid tokens

### Test 5: Rate Limiting for External IPs

**Objective**: Verify that external IPs are properly rate-limited.

**Steps**:
1. Connect from a different IP (or simulate with different user agent)
2. Attempt rapid connections (more than 10 in 1 minute)
3. Monitor server logs

**Expected Results**:
- ✅ First 10 connections succeed
- ✅ Subsequent connections receive `RATE_LIMIT_EXCEEDED` error
- ✅ 2-second cooldown between attempts for external IPs
- ✅ Rate limit resets after 1 minute

### Test 6: Concurrent Connection Limits

**Objective**: Verify concurrent connection limits work properly.

**Steps**:
1. Open 25 browser tabs (exceeding localhost limit of 20)
2. Connect all tabs simultaneously
3. Monitor which connections succeed/fail

**Expected Results**:
- ✅ First 20 connections succeed
- ✅ Connections 21-25 receive `CONNECTION_LIMIT_EXCEEDED` error
- ✅ Clear error message with current/max connection counts

### Test 7: Reconnection Scenarios

**Objective**: Verify that legitimate reconnections are not blocked.

**Steps**:
1. Connect to WebSocket
2. Disconnect (close tab)
3. Immediately reconnect
4. Repeat multiple times

**Expected Results**:
- ✅ Reconnections succeed without rate limiting
- ✅ Connection attempt count decreases on disconnect
- ✅ No false positive rate limiting

### Test 8: Task and Project Updates

**Objective**: Verify that authenticated users can send and receive real-time updates.

**Steps**:
1. Connect two authenticated users to the same project
2. Send task updates from one user
3. Verify the other user receives the updates

```javascript
// User 1: Join project and send task update
socket.emit('join_project', { projectId: '123' });
socket.emit('task_updated', {
  taskId: 'task-1',
  projectId: '123',
  taskData: { status: 'completed' },
  action: 'update'
});

// User 2: Listen for updates
socket.on('task_updated', (data) => {
  console.log('Task updated:', data);
});
```

**Expected Results**:
- ✅ Both users can join project rooms
- ✅ Task updates are broadcast to team members
- ✅ No authentication errors during updates
- ✅ Proper error handling if team ID cannot be fetched

### Test 9: Error Recovery

**Objective**: Verify that the server handles errors gracefully without crashing.

**Steps**:
1. Send malformed data to various socket events
2. Test with invalid project IDs
3. Monitor server stability

```javascript
// Test malformed data
socket.emit('task_updated', { invalid: 'data' });
socket.emit('join_project', { projectId: null });
```

**Expected Results**:
- ✅ Server remains stable
- ✅ Appropriate error messages sent to client
- ✅ No server crashes or unhandled exceptions
- ✅ Graceful error logging

### Test 10: CORS and Health Check

**Objective**: Verify CORS settings and health endpoint work correctly.

**Steps**:
1. Test health endpoint from different origins
2. Verify CORS headers in responses
3. Test WebSocket connection from allowed origins

```bash
# Test CORS headers
curl -H "Origin: http://localhost:3000" -v http://localhost:3001/health

# Test from different origin (should be blocked)
curl -H "Origin: http://malicious-site.com" -v http://localhost:3001/health
```

**Expected Results**:
- ✅ `http://localhost:3000` origin is allowed
- ✅ `http://127.0.0.1:3000` origin is allowed
- ✅ Malicious origins are blocked
- ✅ Health endpoint returns proper CORS headers

## Performance Testing

### Load Testing with Multiple Users

**Objective**: Verify server performance under load.

**Steps**:
1. Use a WebSocket load testing tool (like Artillery.io or custom script)
2. Simulate 50+ concurrent connections
3. Monitor server memory usage and response times

```bash
# Install artillery for load testing
npm install -g artillery

# Create artillery config file (artillery-config.yml)
# Run load test
artillery run artillery-config.yml
```

**Expected Results**:
- ✅ Server handles 50+ concurrent connections
- ✅ Memory usage remains stable
- ✅ No connection drops or timeouts
- ✅ Response times remain under 100ms

## Monitoring and Logging

### Server Logs to Monitor

During testing, watch for these log messages:

**Good Signs**:
- `Socket authenticated on connection: user@example.com (123) from localhost`
- `User user@example.com joined team room: team:456`
- `Task task-1 updated in project 123 by user@example.com`

**Warning Signs**:
- `Rate limit exceeded for IP...` (should be rare for localhost)
- `Too many concurrent connections...` (should only happen at limits)
- `Failed to fetch teams for user...` (backend connectivity issues)

**Error Signs**:
- `Uncaught Exception` or `Unhandled Rejection`
- Server crashes or restarts
- Memory leaks (continuously increasing memory usage)

## Troubleshooting Common Issues

### Issue: "Connection rate limit exceeded"
**Solution**: Wait 2 seconds (localhost) or 5 seconds (external IP) before reconnecting

### Issue: "Too many concurrent connections"
**Solution**: Close some browser tabs or wait for other connections to disconnect

### Issue: "Token has expired"
**Solution**: Refresh the token using the `refresh_token` event or re-login

### Issue: "Python backend not available"
**Solution**: Ensure the FastAPI backend is running on `http://localhost:8000`

### Issue: CORS errors in browser
**Solution**: Verify the frontend URL is in the CORS origins list in server.js

## Success Criteria

The WebSocket server is working correctly when:

1. ✅ **Authentication**: Valid tokens allow immediate connection
2. ✅ **Rate Limiting**: Localhost users can connect freely, external IPs are properly limited
3. ✅ **Token Handling**: Expired tokens prompt refresh, invalid tokens prompt re-login
4. ✅ **Error Recovery**: Server remains stable under error conditions
5. ✅ **Real-time Features**: Task/project updates are broadcast correctly
6. ✅ **Performance**: Server handles 50+ concurrent connections
7. ✅ **CORS**: Frontend can connect from allowed origins
8. ✅ **Health Check**: `/health` endpoint returns proper status

## Next Steps

After successful testing:

1. **Production Deployment**: Follow the deployment guide
2. **Monitoring Setup**: Implement proper logging and monitoring
3. **Load Balancing**: Consider load balancing for high-traffic scenarios
4. **Security Review**: Review JWT secrets and CORS settings for production

---

**Note**: This testing guide assumes you have valid JWT tokens from your FastAPI backend. If you need to generate test tokens, refer to your backend authentication documentation.
