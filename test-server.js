#!/usr/bin/env node

/**
 * Test script to verify server startup
 * This script tests the server startup without actually running it
 */

const { spawn } = require('child_process');
const http = require('http');

function testServerStartup() {
  return new Promise((resolve, reject) => {
    console.log('Testing server startup...');
    
    // Start the server
    const serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverStarted = false;
    let serverPort = null;
    let output = '';

    // Capture server output
    serverProcess.stdout.on('data', (data) => {
      const message = data.toString();
      output += message;
      console.log('Server output:', message.trim());
      
      // Look for successful startup message
      if (message.includes('Team Collaboration WebSocket Server Started!')) {
        serverStarted = true;
        
        // Extract port from the message
        const portMatch = message.match(/Server: http:\/\/localhost:(\d+)/);
        if (portMatch) {
          serverPort = parseInt(portMatch[1]);
        }
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.error('Server error:', error.trim());
    });

    // Wait for server to start or fail
    setTimeout(() => {
      if (serverStarted && serverPort) {
        console.log(`✅ Server started successfully on port ${serverPort}`);
        
        // Test health endpoint
        testHealthEndpoint(serverPort)
          .then(() => {
            console.log('✅ Health endpoint is responding');
            serverProcess.kill();
            resolve({ success: true, port: serverPort });
          })
          .catch((err) => {
            console.error('❌ Health endpoint test failed:', err.message);
            serverProcess.kill();
            reject(err);
          });
      } else {
        console.error('❌ Server failed to start within timeout');
        serverProcess.kill();
        reject(new Error('Server startup timeout'));
      }
    }, 5000); // 5 second timeout

    serverProcess.on('close', (code) => {
      if (code !== 0 && !serverStarted) {
        reject(new Error(`Server process exited with code ${code}`));
      }
    });
  });
}

function testHealthEndpoint(port) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: '/health',
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.status === 'OK') {
            resolve(response);
          } else {
            reject(new Error(`Health check failed: ${response.status}`));
          }
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Health endpoint request timeout'));
    });

    req.end();
  });
}

// Run the test
if (require.main === module) {
  testServerStartup()
    .then((result) => {
      console.log('\n🎉 Server test completed successfully!');
      console.log(`Server is running on port ${result.port}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ Server test failed:', err.message);
      process.exit(1);
    });
}

module.exports = { testServerStartup, testHealthEndpoint };

