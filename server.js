const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// Import our modules
const { verifyToken, authenticateToken, fetchUserTeams, fetchUserTasks } = require('./auth');
const { handleConnection, getActiveUsers, getActiveRooms, getUserSockets } = require('./socketHandlers');

// Load environment variables
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuration
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
// Parse CORS origins from environment variable
const corsOriginEnv = process.env.CORS_ORIGIN || 'http://localhost:3000';
const corsOrigins = corsOriginEnv.split(',').map(origin => origin.trim());

// Connection rate limiting - improved for localhost and legitimate users
const connectionAttempts = new Map(); // IP -> { count, lastAttempt, isLocalhost, expiredTokenAttempts }
const activeConnections = new Map(); // IP -> Set of socket IDs
const MAX_CONNECTIONS_PER_IP = 10; // Increased for legitimate users
const MAX_CONNECTIONS_LOCALHOST = 20; // Higher limit for localhost development
const CONNECTION_WINDOW = 60000; // 1 minute window
const CONNECTION_COOLDOWN = 2000; // Reduced to 2 seconds for better UX
const CONNECTION_COOLDOWN_LOCALHOST = 500; // Very short cooldown for localhost
const EXPIRED_TOKEN_COOLDOWN = 1000; // Special cooldown for expired token reconnects

// Function to check connection rate limits - improved for localhost and expired tokens
function checkConnectionRateLimit(ip, isExpiredToken = false) {
  const now = Date.now();
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
  const attempts = connectionAttempts.get(ip) || { count: 0, lastAttempt: 0, isLocalhost, expiredTokenAttempts: 0 };
  
  // Update localhost status
  attempts.isLocalhost = isLocalhost;
  
  // Reset count if window has passed
  if (now - attempts.lastAttempt > CONNECTION_WINDOW) {
    attempts.count = 0;
    attempts.expiredTokenAttempts = 0;
  }
  
  // Special handling for expired token reconnects
  if (isExpiredToken) {
    attempts.expiredTokenAttempts = (attempts.expiredTokenAttempts || 0) + 1;
    
    // Allow more expired token attempts for localhost
    const maxExpiredAttempts = isLocalhost ? 50 : 10;
    if (attempts.expiredTokenAttempts > maxExpiredAttempts) {
      console.log(`Too many expired token attempts for ${isLocalhost ? 'localhost' : 'IP'} ${ip}: ${attempts.expiredTokenAttempts}/${maxExpiredAttempts}`);
      return false;
    }
    
    // Use shorter cooldown for expired token reconnects
    const expiredCooldown = isLocalhost ? EXPIRED_TOKEN_COOLDOWN : EXPIRED_TOKEN_COOLDOWN * 2;
    if (now - attempts.lastAttempt < expiredCooldown) {
      console.log(`Expired token cooldown active for ${isLocalhost ? 'localhost' : 'IP'} ${ip}: ${expiredCooldown - (now - attempts.lastAttempt)}ms remaining`);
      return false;
    }
    
    attempts.lastAttempt = now;
    connectionAttempts.set(ip, attempts);
    return true;
  }
  
  // Check if too many connections (different limits for localhost)
  const maxConnections = isLocalhost ? MAX_CONNECTIONS_LOCALHOST : MAX_CONNECTIONS_PER_IP;
  if (attempts.count >= maxConnections) {
    console.log(`Rate limit exceeded for ${isLocalhost ? 'localhost' : 'IP'} ${ip}: ${attempts.count}/${maxConnections} connections`);
    return false;
  }
  
  // Check cooldown period (different for localhost)
  const cooldown = isLocalhost ? CONNECTION_COOLDOWN_LOCALHOST : CONNECTION_COOLDOWN;
  if (now - attempts.lastAttempt < cooldown) {
    console.log(`Cooldown active for ${isLocalhost ? 'localhost' : 'IP'} ${ip}: ${cooldown - (now - attempts.lastAttempt)}ms remaining`);
    return false;
  }
  
  // Update attempts
  attempts.count++;
  attempts.lastAttempt = now;
  connectionAttempts.set(ip, attempts);
  
  return true;
}

// Cleanup old connection attempts periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempts] of connectionAttempts.entries()) {
    if (now - attempts.lastAttempt > CONNECTION_WINDOW * 2) {
      connectionAttempts.delete(ip);
    }
  }
}, CONNECTION_WINDOW); // Clean up every minute

// CORS configuration for Socket.IO
const io = socketIo(server, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"]
  },
  pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000,
  pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT) || 60000,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Routes

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Team Collaboration WebSocket Server',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    endpoints: {
      health: '/health - Server health check',
      auth: '/auth/test - Authentication test',
      projects: '/projects/:projectId/users - Get active users in project',
      rooms: '/rooms - Get all active rooms',
      connections: '/users/:userId/connections - Get user connections'
    }
  });
});

// Health check with detailed status
app.get('/health', (req, res) => {
  const activeRooms = getActiveRooms();
  const totalConnections = io.engine.clientsCount;
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    connections: {
      total: totalConnections,
      activeRooms: Object.keys(activeRooms).length,
      rooms: activeRooms
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Authentication test endpoint
app.get('/auth/test', authenticateToken, (req, res) => {
  res.json({
    message: 'Authentication successful',
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

// Get active users in a project
app.get('/projects/:projectId/users', authenticateToken, (req, res) => {
  try {
    const { projectId } = req.params;
    
    if (!projectId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Project ID is required'
      });
    }
    
    const activeUsers = getActiveUsers(projectId);
    
    res.json({
      success: true,
      projectId,
      activeUsers,
      count: activeUsers.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting active users:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get active users'
    });
  }
});

// Get all active rooms
app.get('/rooms', authenticateToken, (req, res) => {
  try {
    const activeRooms = getActiveRooms();
    
    res.json({
      success: true,
      rooms: activeRooms,
      totalRooms: Object.keys(activeRooms).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting active rooms:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get active rooms'
    });
  }
});

// Get user's active connections
app.get('/users/:userId/connections', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'User ID is required'
      });
    }
    
    // Only allow users to check their own connections or admin users
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only check your own connections'
      });
    }
    
    const userSockets = getUserSockets(userId);
    
    res.json({
      success: true,
      userId,
      activeConnections: userSockets.length,
      connections: userSockets,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting user connections:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user connections'
    });
  }
});

// WebSocket connection handling
io.on('connection', async (socket) => {
  const clientIP = socket.handshake.address;
  
  // Check connection rate limit (will be updated based on token status)
  let isExpiredTokenAttempt = false;
  
  // Add connection metadata
  socket.connectedAt = new Date().toISOString();
  socket.userAgent = socket.handshake.headers['user-agent'];
  socket.ip = clientIP;
  
  // Check concurrent connections limit (different for localhost)
  const isLocalhost = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1' || clientIP === 'localhost';
  const maxConcurrent = isLocalhost ? MAX_CONNECTIONS_LOCALHOST : MAX_CONNECTIONS_PER_IP;
  const existingConnections = activeConnections.get(clientIP) || new Set();
  
  if (existingConnections.size >= maxConcurrent) {
    console.log(`Too many concurrent connections for ${isLocalhost ? 'localhost' : 'IP'} ${clientIP}: ${existingConnections.size}/${maxConcurrent}, disconnecting socket ${socket.id}`);
    socket.emit('connection_limit_exceeded', {
      message: `Too many concurrent connections. Please close other tabs or wait. (${existingConnections.size}/${maxConcurrent})`,
      code: 'CONNECTION_LIMIT_EXCEEDED',
      maxConnections: maxConcurrent,
      currentConnections: existingConnections.size,
      isLocalhost: isLocalhost,
      timestamp: new Date().toISOString()
    });
    socket.disconnect(true);
    return;
  }
  
  // Add to active connections
  existingConnections.add(socket.id);
  activeConnections.set(clientIP, existingConnections);
  
  console.log("New connection:", socket.id, "transport=", socket.conn.transport.name, "IP=", clientIP);

  // Handle authentication during connection with improved error handling
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const user = await verifyToken(token);
      
      if (user) {
        // Check rate limit for successful authentication
        if (!checkConnectionRateLimit(clientIP)) {
          console.log(`Connection rate limit exceeded for IP ${clientIP}, disconnecting socket ${socket.id}`);
          socket.emit('rate_limit_exceeded', {
            message: 'Too many connection attempts. Please wait before reconnecting.',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: CONNECTION_COOLDOWN / 1000,
            timestamp: new Date().toISOString()
          });
          socket.disconnect(true);
          return;
        }
        
        socket.userId = user.userId;
        socket.userEmail = user.email;
        socket.userRole = user.role;
        socket.authenticated = true;
        socket.authenticatedAt = new Date().toISOString();
        socket.token = token; // Store token for later use
        
        console.log(`Socket authenticated on connection: ${user.email} (${user.userId}) from ${isLocalhost ? 'localhost' : clientIP}`);
        
        // Fetch user's teams and tasks from Python backend
        try {
          const [teamIds, userTasks] = await Promise.all([
            fetchUserTeams(user.userId, token),
            fetchUserTasks(user.userId, token)
          ]);
          
          socket.teamIds = teamIds;
          socket.userTasks = userTasks;
          
          // Join team rooms
          teamIds.forEach(teamId => {
            const teamRoom = `team:${teamId}`;
            socket.join(teamRoom);
            console.log(`User ${user.email} joined team room: ${teamRoom}`);
          });
          
          socket.emit('authenticated', { 
            success: true,
            user: {
              id: user.userId,
              email: user.email,
              role: user.role,
              username: user.username
            },
            teams: teamIds,
            tasks: userTasks,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Failed to fetch user data for user ${user.userId}:`, error);
          
          // Still emit authenticated but without teams and tasks
          socket.emit('authenticated', { 
            success: true,
            user: {
              id: user.userId,
              email: user.email,
              role: user.role,
              username: user.username
            },
            teams: [],
            tasks: [],
            timestamp: new Date().toISOString()
          });
        }
      } else {
        console.log(`Socket authentication failed for ${socket.id}: invalid token`);
        socket.emit('authentication_error', { 
          message: 'Invalid or expired token. Please refresh your session or log in again.',
          code: 'INVALID_TOKEN',
          timestamp: new Date().toISOString(),
          action: 'REFRESH_TOKEN',
          retryAfter: 2000 // Allow retry after 2 seconds
        });
        // Don't disconnect immediately - let client handle refresh
        setTimeout(() => {
          if (!socket.authenticated) {
            socket.disconnect(true);
          }
        }, 5000); // Give 5 seconds for token refresh
      }
    } catch (error) {
      console.error(`Socket authentication error for ${socket.id}:`, error.message);
      
      // Determine if it's a token expiration issue
      const isTokenExpired = error.message.includes('expired') || error.message.includes('TokenExpiredError');
      const isInvalidToken = error.message.includes('invalid') || error.message.includes('JsonWebTokenError');
      
      // For expired tokens, use special rate limiting
      if (isTokenExpired) {
        isExpiredTokenAttempt = true;
        if (!checkConnectionRateLimit(clientIP, true)) {
          console.log(`Expired token rate limit exceeded for IP ${clientIP}, disconnecting socket ${socket.id}`);
          socket.emit('rate_limit_exceeded', {
            message: 'Too many expired token reconnection attempts. Please wait before reconnecting.',
            code: 'EXPIRED_TOKEN_RATE_LIMIT_EXCEEDED',
            retryAfter: EXPIRED_TOKEN_COOLDOWN / 1000,
            timestamp: new Date().toISOString()
          });
          socket.disconnect(true);
          return;
        }
      } else {
        // For invalid tokens, use normal rate limiting
        if (!checkConnectionRateLimit(clientIP)) {
          console.log(`Connection rate limit exceeded for IP ${clientIP}, disconnecting socket ${socket.id}`);
          socket.emit('rate_limit_exceeded', {
            message: 'Too many connection attempts. Please wait before reconnecting.',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: CONNECTION_COOLDOWN / 1000,
            timestamp: new Date().toISOString()
          });
          socket.disconnect(true);
          return;
        }
      }
      
      socket.emit('authentication_error', { 
        message: isTokenExpired ? 'Token has expired. Please refresh your session or log in again.' : 
                isInvalidToken ? 'Invalid token format. Please log in again.' : 'Authentication failed',
        code: isTokenExpired ? 'TOKEN_EXPIRED' : isInvalidToken ? 'INVALID_TOKEN' : 'AUTH_ERROR',
        timestamp: new Date().toISOString(),
        action: isTokenExpired ? 'REFRESH_TOKEN' : 'RELOGIN',
        retryAfter: isTokenExpired ? 2000 : 5000
      });
      
      // For expired tokens, give time for refresh; for invalid tokens, disconnect immediately
      if (isTokenExpired) {
        setTimeout(() => {
          if (!socket.authenticated) {
            socket.disconnect(true);
          }
        }, 5000);
      } else {
        socket.disconnect(true);
      }
    }
  } else {
    // Check rate limit for connections without tokens
    if (!checkConnectionRateLimit(clientIP)) {
      console.log(`Connection rate limit exceeded for IP ${clientIP}, disconnecting socket ${socket.id}`);
      socket.emit('rate_limit_exceeded', {
        message: 'Too many connection attempts. Please wait before reconnecting.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: CONNECTION_COOLDOWN / 1000,
        timestamp: new Date().toISOString()
      });
      socket.disconnect(true);
      return;
    }
    
    console.log(`Socket ${socket.id} connected without auth token - allowing temporary connection`);
    socket.emit('authentication_required', { 
      message: 'Authentication token required',
      code: 'MISSING_TOKEN',
      timestamp: new Date().toISOString(),
      action: 'PROVIDE_TOKEN'
    });
    // Don't disconnect immediately - allow client to provide token
    setTimeout(() => {
      if (!socket.authenticated) {
        socket.disconnect(true);
      }
    }, 10000); // Give 10 seconds to provide token
  }
  
  socket.on('disconnect', (reason) => {
    console.log("User disconnected:", socket.id, "reason=", reason, "authenticated=", socket.authenticated);
    
    // Remove from active connections
    const clientIP = socket.ip;
    if (clientIP && activeConnections.has(clientIP)) {
      const connections = activeConnections.get(clientIP);
      connections.delete(socket.id);
      if (connections.size === 0) {
        activeConnections.delete(clientIP);
      } else {
        activeConnections.set(clientIP, connections);
      }
    }
    
    // Clean up connection attempts for this socket
    if (clientIP && connectionAttempts.has(clientIP)) {
      const attempts = connectionAttempts.get(clientIP);
      // Reduce count when socket disconnects (helps with legitimate reconnections)
      if (attempts.count > 0) {
        attempts.count = Math.max(0, attempts.count - 1);
      }
      // Also reduce expired token attempts if this was an expired token disconnect
      if (isExpiredTokenAttempt && attempts.expiredTokenAttempts > 0) {
        attempts.expiredTokenAttempts = Math.max(0, attempts.expiredTokenAttempts - 1);
      }
      connectionAttempts.set(clientIP, attempts);
    }
  });

  socket.on('error', (err) => {
    console.error("Socket error:", socket.id, err.message || err);
    // Don't disconnect on socket errors - let the client handle reconnection
  });

  socket.on('connect_error', (err) => {
    console.error("connect_error for", socket.id, err.message || err);
    // This is handled by the client-side connection logic
  });
  
  // Handle token refresh requests
  socket.on('refresh_token', async (data) => {
    const { token } = data;
    if (!token) {
      socket.emit('authentication_error', {
        message: 'No token provided for refresh',
        code: 'MISSING_TOKEN',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    try {
      const user = await verifyToken(token);
      if (user) {
        socket.userId = user.userId;
        socket.userEmail = user.email;
        socket.userRole = user.role;
        socket.authenticated = true;
        socket.authenticatedAt = new Date().toISOString();
        socket.token = token;
        
        console.log(`Socket token refreshed: ${user.email} (${user.userId})`);
        
        // Fetch user's teams and tasks after token refresh
        try {
          const [teamIds, userTasks] = await Promise.all([
            fetchUserTeams(user.userId, token),
            fetchUserTasks(user.userId, token)
          ]);
          
          socket.teamIds = teamIds;
          socket.userTasks = userTasks;
          
          // Join team rooms
          teamIds.forEach(teamId => {
            const teamRoom = `team:${teamId}`;
            socket.join(teamRoom);
            console.log(`User ${user.email} joined team room after refresh: ${teamRoom}`);
          });
          
          socket.emit('token_refreshed', {
            success: true,
            user: {
              id: user.userId,
              email: user.email,
              role: user.role,
              username: user.username
            },
            teams: teamIds,
            tasks: userTasks,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Failed to fetch user data after token refresh for user ${user.userId}:`, error);
          
          // Still emit token refreshed but without teams and tasks
          socket.emit('token_refreshed', {
            success: true,
            user: {
              id: user.userId,
              email: user.email,
              role: user.role,
              username: user.username
            },
            teams: [],
            tasks: [],
            timestamp: new Date().toISOString()
          });
        }
      } else {
        socket.emit('authentication_error', {
          message: 'Invalid refresh token',
          code: 'INVALID_REFRESH_TOKEN',
          timestamp: new Date().toISOString(),
          action: 'RELOGIN'
        });
      }
    } catch (error) {
      console.error(`Token refresh failed for ${socket.id}:`, error.message);
      
      // Determine if it's a token expiration issue
      const isTokenExpired = error.message.includes('expired') || error.message.includes('TokenExpiredError');
      
      socket.emit('authentication_error', {
        message: isTokenExpired ? 'Refresh token has also expired. Please log in again.' : 'Token refresh failed',
        code: isTokenExpired ? 'REFRESH_TOKEN_EXPIRED' : 'REFRESH_FAILED',
        timestamp: new Date().toISOString(),
        action: 'RELOGIN'
      });
    }
  });
  
  // Handle the connection
  handleConnection(socket, io);
  
  // Send welcome message
  socket.emit('connected', {
    socketId: socket.id,
    timestamp: socket.connectedAt,
    message: 'Connected to Team Collaboration WebSocket Server'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Handle uncaught exceptions with better logging
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
  
  // Don't exit immediately in development - allow for debugging
  if (NODE_ENV === 'development') {
    console.error('Development mode: Server will continue running. Fix the error and restart.');
  } else {
    console.error('Production mode: Server will exit.');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', {
    reason: reason,
    promise: promise,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
  
  // Don't exit immediately in development - allow for debugging
  if (NODE_ENV === 'development') {
    console.error('Development mode: Server will continue running. Fix the error and restart.');
  } else {
    console.error('Production mode: Server will exit.');
    process.exit(1);
  }
});

// Function to start server with port fallback
async function startServer(port, fallbackPorts = [3002, 3003, 3004, 3005]) {
  const tryPort = (currentPort) => {
    return new Promise((resolve, reject) => {
      const serverInstance = server.listen(currentPort, "0.0.0.0", () => {
        console.log(`
Team Collaboration WebSocket Server Started!
==========================================
Server: http://localhost:${currentPort}
Environment: ${NODE_ENV}
CORS Origins: ${corsOrigins.join(', ')}
Health Check: http://localhost:${currentPort}/health
WebSocket: ws://localhost:${currentPort}
==========================================
        `);
        resolve(currentPort);
      });

      serverInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`Port ${currentPort} is already in use, trying next port...`);
          reject(err);
        } else {
          console.error(`Server error on port ${currentPort}:`, err);
          reject(err);
        }
      });
    });
  };

  // Try the primary port first
  try {
    await tryPort(port);
    return port;
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.log(`Primary port ${port} is busy, trying fallback ports...`);
      
      // Try fallback ports
      for (const fallbackPort of fallbackPorts) {
        try {
          await tryPort(fallbackPort);
          console.log(`Successfully started server on fallback port ${fallbackPort}`);
          return fallbackPort;
        } catch (fallbackErr) {
          if (fallbackErr.code === 'EADDRINUSE') {
            console.warn(`Fallback port ${fallbackPort} is also busy, trying next...`);
            continue;
          } else {
            throw fallbackErr;
          }
        }
      }
      
      // If all ports are busy
      console.error('All ports are busy. Please free up a port or check for zombie processes.');
      console.error('You can kill Node.js processes with: taskkill /F /IM node.exe');
      process.exit(1);
    } else {
      throw err;
    }
  }
}

// Start server with port fallback
startServer(PORT).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Export for testing
module.exports = { app, server, io };
