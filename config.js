// Configuration file for the WebSocket server
module.exports = {
  // Server configuration
  server: {
    port: process.env.PORT || 3001,
    environment: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '0.0.0.0'
  },

  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
  },

  // JWT configuration (must match FastAPI backend)
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-here',
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },

  // Socket.IO configuration
  socketio: {
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6, // 1MB
    allowEIO3: true
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined'
  },

  // Rate limiting (if needed in future)
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },

  // Room management
  rooms: {
    maxUsersPerRoom: 50,
    cleanupInterval: 300000, // 5 minutes
    inactiveTimeout: 1800000 // 30 minutes
  }
};
