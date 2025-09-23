#!/usr/bin/env node

/**
 * WebSocket connection test script
 * This script tests WebSocket connections to identify issues
 */

const { io } = require('socket.io-client');

// Test configuration
const SERVER_URL = 'http://localhost:3001';
const TEST_TOKEN = 'test-token-123'; // This will fail authentication, but we can see the error

console.log('🔍 Testing WebSocket connection...');
console.log(`Server URL: ${SERVER_URL}`);

// Test 1: Connection without token
console.log('\n📡 Test 1: Connection without token');
const socket1 = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  timeout: 5000
});

socket1.on('connect', () => {
  console.log('✅ Connected without token');
  console.log('Socket ID:', socket1.id);
});

socket1.on('connected', (data) => {
  console.log('✅ Received connected event:', data);
});

socket1.on('authentication_required', (data) => {
  console.log('✅ Received authentication_required event:', data);
});

socket1.on('authentication_error', (data) => {
  console.log('❌ Received authentication_error event:', data);
});

socket1.on('connect_error', (error) => {
  console.log('❌ Connection error:', error.message);
});

socket1.on('disconnect', (reason) => {
  console.log('🔌 Disconnected:', reason);
});

// Test 2: Connection with invalid token
setTimeout(() => {
  console.log('\n📡 Test 2: Connection with invalid token');
  const socket2 = io(SERVER_URL, {
    auth: {
      token: TEST_TOKEN
    },
    transports: ['websocket', 'polling'],
    timeout: 5000
  });

  socket2.on('connect', () => {
    console.log('✅ Connected with invalid token');
    console.log('Socket ID:', socket2.id);
  });

  socket2.on('authenticated', (data) => {
    console.log('✅ Received authenticated event:', data);
  });

  socket2.on('authentication_error', (data) => {
    console.log('❌ Received authentication_error event:', data);
  });

  socket2.on('connect_error', (error) => {
    console.log('❌ Connection error:', error.message);
  });

  socket2.on('disconnect', (reason) => {
    console.log('🔌 Disconnected:', reason);
  });

  // Test token refresh
  setTimeout(() => {
    console.log('\n🔄 Test 3: Token refresh attempt');
    socket2.emit('refresh_token', { token: 'new-test-token' });
  }, 2000);

}, 3000);

// Test 3: Multiple connections (rate limiting test)
setTimeout(() => {
  console.log('\n📡 Test 3: Multiple connections (rate limiting test)');
  
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const socket = io(SERVER_URL, {
        auth: { token: `test-token-${i}` },
        transports: ['websocket', 'polling'],
        timeout: 5000
      });

      socket.on('connect', () => {
        console.log(`✅ Connection ${i + 1} established`);
      });

      socket.on('authentication_error', (data) => {
        console.log(`❌ Connection ${i + 1} auth error:`, data.code);
      });

      socket.on('rate_limit_exceeded', (data) => {
        console.log(`⚠️ Connection ${i + 1} rate limited:`, data.message);
      });

      socket.on('connection_limit_exceeded', (data) => {
        console.log(`⚠️ Connection ${i + 1} connection limit exceeded:`, data.message);
      });
    }, i * 100); // 100ms between connections
  }
}, 6000);

// Cleanup after 15 seconds
setTimeout(() => {
  console.log('\n🧹 Cleaning up test connections...');
  process.exit(0);
}, 15000);
