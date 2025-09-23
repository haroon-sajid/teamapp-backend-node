#!/usr/bin/env node

/**
 * Test script to verify the WebSocket server fixes
 * Tests: JWT auth, rate limiting, Python backend integration, error handling
 */

const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

// Configuration
const SERVER_URL = 'http://localhost:3001';
const PYTHON_BACKEND_URL = 'http://localhost:8000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(testName, passed, message = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} ${testName}${message ? ': ' + message : ''}`);
  
  testResults.tests.push({ name: testName, passed, message });
  if (passed) {
    testResults.passed++;
  } else {
    testResults.failed++;
  }
}

// Helper function to create test JWT tokens
function createTestToken(userId = 1, email = 'test@example.com', expiresIn = '1h') {
  return jwt.sign(
    {
      user_id: userId,
      email: email,
      role: 'member',
      type: 'access',
      username: email.split('@')[0]
    },
    JWT_SECRET,
    { expiresIn }
  );
}

function createExpiredToken(userId = 1, email = 'test@example.com') {
  return jwt.sign(
    {
      user_id: userId,
      email: email,
      role: 'member',
      type: 'access',
      username: email.split('@')[0]
    },
    JWT_SECRET,
    { expiresIn: '-1h' } // Expired 1 hour ago
  );
}

// Test 1: Valid token authentication
async function testValidTokenAuth() {
  return new Promise((resolve) => {
    const token = createTestToken();
    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket']
    });

    let authenticated = false;
    let errorReceived = false;

    socket.on('authenticated', (data) => {
      authenticated = true;
      logTest('Valid Token Authentication', true, `User: ${data.user.email}`);
      socket.disconnect();
      resolve(true);
    });

    socket.on('authentication_error', (data) => {
      errorReceived = true;
      logTest('Valid Token Authentication', false, `Unexpected auth error: ${data.message}`);
      socket.disconnect();
      resolve(false);
    });

    socket.on('connect_error', (error) => {
      logTest('Valid Token Authentication', false, `Connection error: ${error.message}`);
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!authenticated && !errorReceived) {
        logTest('Valid Token Authentication', false, 'Timeout - no response received');
        socket.disconnect();
        resolve(false);
      }
    }, 5000);
  });
}

// Test 2: Expired token handling
async function testExpiredTokenHandling() {
  return new Promise((resolve) => {
    const expiredToken = createExpiredToken();
    const socket = io(SERVER_URL, {
      auth: { token: expiredToken },
      transports: ['websocket']
    });

    let authErrorReceived = false;
    let disconnected = false;

    socket.on('authentication_error', (data) => {
      if (data.code === 'TOKEN_EXPIRED') {
        authErrorReceived = true;
        logTest('Expired Token Handling', true, `Received TOKEN_EXPIRED: ${data.message}`);
      } else {
        logTest('Expired Token Handling', false, `Wrong error code: ${data.code}`);
      }
    });

    socket.on('disconnect', () => {
      disconnected = true;
      if (authErrorReceived) {
        logTest('Expired Token Disconnect', true, 'Properly disconnected after expired token');
      } else {
        logTest('Expired Token Disconnect', false, 'Disconnected without proper error handling');
      }
      resolve(authErrorReceived);
    });

    socket.on('connect_error', (error) => {
      logTest('Expired Token Handling', false, `Connection error: ${error.message}`);
      resolve(false);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!authErrorReceived) {
        logTest('Expired Token Handling', false, 'Timeout - no auth error received');
        socket.disconnect();
        resolve(false);
      }
    }, 10000);
  });
}

// Test 3: Rate limiting for localhost
async function testLocalhostRateLimit() {
  return new Promise((resolve) => {
    const promises = [];
    const sockets = [];
    
    // Create multiple connections from localhost
    for (let i = 0; i < 5; i++) {
      const promise = new Promise((socketResolve) => {
        const token = createTestToken(i + 1, `test${i}@example.com`);
        const socket = io(SERVER_URL, {
          auth: { token },
          transports: ['websocket']
        });
        
        sockets.push(socket);
        
        socket.on('authenticated', () => {
          socketResolve(true);
        });
        
        socket.on('rate_limit_exceeded', () => {
          socketResolve(false);
        });
        
        socket.on('connect_error', () => {
          socketResolve(false);
        });
        
        // Timeout for individual socket
        setTimeout(() => {
          socketResolve(false);
        }, 3000);
      });
      
      promises.push(promise);
    }
    
    Promise.all(promises).then((results) => {
      const successCount = results.filter(r => r === true).length;
      const rateLimited = results.some(r => r === false);
      
      // Clean up sockets
      sockets.forEach(socket => socket.disconnect());
      
      if (successCount >= 3) {
        logTest('Localhost Rate Limiting', true, `${successCount}/5 connections successful`);
        resolve(true);
      } else {
        logTest('Localhost Rate Limiting', false, `Only ${successCount}/5 connections successful`);
        resolve(false);
      }
    });
  });
}

// Test 4: Token refresh handling
async function testTokenRefresh() {
  return new Promise((resolve) => {
    const token = createTestToken();
    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket']
    });

    let authenticated = false;
    let tokenRefreshed = false;

    socket.on('authenticated', (data) => {
      authenticated = true;
      logTest('Initial Authentication', true, `User: ${data.user.email}`);
      
      // Try to refresh with the same token
      socket.emit('refresh_token', { token });
    });

    socket.on('token_refreshed', (data) => {
      tokenRefreshed = true;
      logTest('Token Refresh', true, `User: ${data.user.email}`);
      socket.disconnect();
      resolve(true);
    });

    socket.on('authentication_error', (data) => {
      logTest('Token Refresh', false, `Auth error: ${data.message}`);
      socket.disconnect();
      resolve(false);
    });

    socket.on('connect_error', (error) => {
      logTest('Token Refresh', false, `Connection error: ${error.message}`);
      resolve(false);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!tokenRefreshed) {
        logTest('Token Refresh', false, 'Timeout - token refresh failed');
        socket.disconnect();
        resolve(false);
      }
    }, 10000);
  });
}

// Test 5: Python backend integration
async function testPythonBackendIntegration() {
  return new Promise((resolve) => {
    const token = createTestToken();
    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket']
    });

    socket.on('authenticated', (data) => {
      const hasTeams = Array.isArray(data.teams);
      const hasTasks = Array.isArray(data.tasks);
      
      logTest('Python Backend Integration', hasTeams && hasTasks, 
        `Teams: ${data.teams.length}, Tasks: ${data.tasks.length}`);
      
      socket.disconnect();
      resolve(hasTeams && hasTasks);
    });

    socket.on('authentication_error', (data) => {
      logTest('Python Backend Integration', false, `Auth error: ${data.message}`);
      socket.disconnect();
      resolve(false);
    });

    socket.on('connect_error', (error) => {
      logTest('Python Backend Integration', false, `Connection error: ${error.message}`);
      resolve(false);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      logTest('Python Backend Integration', false, 'Timeout - no response received');
      socket.disconnect();
      resolve(false);
    }, 10000);
  });
}

// Test 6: Multiple expired token reconnects (should not trigger rate limit)
async function testExpiredTokenReconnects() {
  return new Promise((resolve) => {
    const expiredToken = createExpiredToken();
    let reconnectCount = 0;
    const maxReconnects = 3;
    
    function attemptReconnect() {
      const socket = io(SERVER_URL, {
        auth: { token: expiredToken },
        transports: ['websocket']
      });

      socket.on('authentication_error', (data) => {
        if (data.code === 'TOKEN_EXPIRED') {
          reconnectCount++;
          logTest(`Expired Token Reconnect ${reconnectCount}`, true, 'Properly handled expired token');
          
          if (reconnectCount < maxReconnects) {
            socket.disconnect();
            setTimeout(attemptReconnect, 1000); // Wait 1 second before next attempt
          } else {
            logTest('Multiple Expired Token Reconnects', true, `${reconnectCount} reconnects handled properly`);
            resolve(true);
          }
        } else {
          logTest('Multiple Expired Token Reconnects', false, `Wrong error code: ${data.code}`);
          resolve(false);
        }
      });

      socket.on('rate_limit_exceeded', () => {
        logTest('Multiple Expired Token Reconnects', false, 'Rate limited on expired token reconnects');
        resolve(false);
      });

      socket.on('connect_error', (error) => {
        logTest('Multiple Expired Token Reconnects', false, `Connection error: ${error.message}`);
        resolve(false);
      });

      // Timeout for individual attempt
      setTimeout(() => {
        if (reconnectCount === 0) {
          logTest('Multiple Expired Token Reconnects', false, 'Timeout on first attempt');
          resolve(false);
        }
      }, 5000);
    }
    
    attemptReconnect();
  });
}

// Main test runner
async function runTests() {
  console.log('🧪 Starting WebSocket Server Fix Tests\n');
  console.log('=' .repeat(50));
  
  try {
    // Run all tests
    await testValidTokenAuth();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between tests
    
    await testExpiredTokenHandling();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testLocalhostRateLimit();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testTokenRefresh();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testPythonBackendIntegration();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testExpiredTokenReconnects();
    
  } catch (error) {
    console.error('Test runner error:', error);
  }
  
  // Print results
  console.log('\n' + '=' .repeat(50));
  console.log('📊 Test Results Summary:');
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📈 Success Rate: ${Math.round((testResults.passed / (testResults.passed + testResults.failed)) * 100)}%`);
  
  if (testResults.failed === 0) {
    console.log('\n🎉 All tests passed! The WebSocket server fixes are working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the issues above.');
  }
  
  console.log('\n📝 Test Details:');
  testResults.tests.forEach(test => {
    const status = test.passed ? '✅' : '❌';
    console.log(`  ${status} ${test.name}${test.message ? ': ' + test.message : ''}`);
  });
}

// Check if server is running
async function checkServerHealth() {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    if (response.ok) {
      console.log('✅ WebSocket server is running and healthy');
      return true;
    } else {
      console.log('❌ WebSocket server health check failed');
      return false;
    }
  } catch (error) {
    console.log('❌ WebSocket server is not running or not accessible');
    console.log('   Please start the server with: npm start');
    return false;
  }
}

// Run the tests
async function main() {
  console.log('🔍 Checking server health...');
  const serverHealthy = await checkServerHealth();
  
  if (!serverHealthy) {
    console.log('\n❌ Cannot run tests - server is not healthy');
    process.exit(1);
  }
  
  console.log('\n🚀 Starting tests...\n');
  await runTests();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⏹️  Tests interrupted by user');
  process.exit(0);
});

// Run main function
main().catch(console.error);
