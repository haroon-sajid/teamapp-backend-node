const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// Import our modules
const { verifyToken, authenticateToken } = require('./auth');
const { handleConnection, getActiveUsers, getActiveRooms, getUserSockets } = require('./socketHandlers');

// Load environment variables
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuration
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// CORS configuration for Socket.IO
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000", 
      "http://127.0.0.1:3000",
      "https://your-frontend-domain.com", // Add your production frontend URL
      process.env.FRONTEND_URL || "http://localhost:3000"
    ],
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
  origin: [
    CORS_ORIGIN,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.FRONTEND_URL || "http://localhost:3000"
  ],
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
io.on('connection', (socket) => {
  console.log("New connection:", socket.id, "transport=", socket.conn.transport.name);
  
  // Add connection metadata
  socket.connectedAt = new Date().toISOString();
  socket.userAgent = socket.handshake.headers['user-agent'];
  socket.ip = socket.handshake.address;
  
  socket.on('disconnect', (reason) => {
    console.log("User disconnected:", socket.id, "reason=", reason);
  });

  socket.on('error', (err) => {
    console.error("Socket error:", socket.id, err);
  });

  socket.on('connect_error', (err) => {
    console.error("connect_error for", socket.id, err.message);
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

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
Team Collaboration WebSocket Server Started!
==========================================
Server: http://localhost:${PORT}
Environment: ${NODE_ENV}
CORS Origin: ${CORS_ORIGIN}
Health Check: http://localhost:${PORT}/health
WebSocket: ws://localhost:${PORT}
==========================================
  `);
});

// Export for testing
module.exports = { app, server, io };
