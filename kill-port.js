#!/usr/bin/env node

/**
 * Utility script to kill processes running on specific ports
 * Usage: node kill-port.js [port1] [port2] ...
 * Example: node kill-port.js 3001 3002
 */

const { exec } = require('child_process');
const os = require('os');

function killProcessOnPort(port) {
  return new Promise((resolve, reject) => {
    const platform = os.platform();
    let command;

    if (platform === 'win32') {
      // Windows command
      command = `netstat -ano | findstr :${port}`;
    } else {
      // Unix/Linux/Mac command
      command = `lsof -ti:${port}`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.log(`No process found on port ${port}`);
        resolve(false);
        return;
      }

      if (platform === 'win32') {
        // Parse Windows netstat output
        const lines = stdout.trim().split('\n');
        const pids = new Set();
        
        lines.forEach(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            const pid = parts[parts.length - 1];
            if (pid && !isNaN(pid)) {
              pids.add(pid);
            }
          }
        });

        if (pids.size === 0) {
          console.log(`No process found on port ${port}`);
          resolve(false);
          return;
        }

        // Kill each process
        const killPromises = Array.from(pids).map(pid => {
          return new Promise((killResolve, killReject) => {
            exec(`taskkill /F /PID ${pid}`, (killError, killStdout, killStderr) => {
              if (killError) {
                console.error(`Failed to kill process ${pid}:`, killError.message);
                killReject(killError);
              } else {
                console.log(`Successfully killed process ${pid} on port ${port}`);
                killResolve(true);
              }
            });
          });
        });

        Promise.all(killPromises)
          .then(() => resolve(true))
          .catch(reject);

      } else {
        // Unix/Linux/Mac
        const pids = stdout.trim().split('\n').filter(pid => pid && !isNaN(pid));
        
        if (pids.length === 0) {
          console.log(`No process found on port ${port}`);
          resolve(false);
          return;
        }

        // Kill each process
        const killPromises = pids.map(pid => {
          return new Promise((killResolve, killReject) => {
            exec(`kill -9 ${pid}`, (killError, killStdout, killStderr) => {
              if (killError) {
                console.error(`Failed to kill process ${pid}:`, killError.message);
                killReject(killError);
              } else {
                console.log(`Successfully killed process ${pid} on port ${port}`);
                killResolve(true);
              }
            });
          });
        });

        Promise.all(killPromises)
          .then(() => resolve(true))
          .catch(reject);
      }
    });
  });
}

async function main() {
  const ports = process.argv.slice(2);
  
  if (ports.length === 0) {
    console.log('Usage: node kill-port.js [port1] [port2] ...');
    console.log('Example: node kill-port.js 3001 3002');
    process.exit(1);
  }

  console.log(`Attempting to kill processes on ports: ${ports.join(', ')}`);
  
  try {
    const results = await Promise.all(ports.map(port => killProcessOnPort(port)));
    const killedAny = results.some(result => result);
    
    if (killedAny) {
      console.log('Port cleanup completed successfully!');
    } else {
      console.log('No processes were found on the specified ports.');
    }
  } catch (error) {
    console.error('Error during port cleanup:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { killProcessOnPort };
