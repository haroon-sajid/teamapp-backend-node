const jwt = require('jsonwebtoken');
const axios = require('axios');

// JWT Configuration - must match FastAPI backend
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256';

/**
 * Verify JWT token and extract user information with improved error handling
 * @param {string} token - JWT token to verify
 * @returns {Object|null} - Decoded user object or null if invalid
 * @throws {Error} - Throws error with specific type for better handling
 */
async function verifyToken(token) {
  try {
    if (!token) {
      console.log('No token provided');
      return null;
    }
    
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace('Bearer ', '');
    
    // Verify token with same secret as Python backend
    const decoded = jwt.verify(cleanToken, JWT_SECRET, { 
      algorithms: [JWT_ALGORITHM] 
    });
    
    // Validate token type - only accept access tokens
    if (decoded.type !== 'access') {
      console.log('Invalid token type:', decoded.type);
      const error = new Error('Invalid token type');
      error.name = 'InvalidTokenType';
      throw error;
    }
    
    // Validate required fields
    if (!decoded.user_id || !decoded.email) {
      console.log('Missing required token fields');
      const error = new Error('Missing required token fields');
      error.name = 'MissingFields';
      throw error;
    }
    
    // Check if token is close to expiration (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = decoded.exp - now;
    if (timeUntilExpiry < 300) { // 5 minutes
      console.log(`Token for ${decoded.email} expires in ${timeUntilExpiry} seconds`);
    }
    
    // Extract user information (matching FastAPI JWT payload structure)
    return {
      email: decoded.email,
      userId: decoded.user_id,
      role: decoded.role || 'member', // Default to member if not specified
      exp: decoded.exp,
      iat: decoded.iat,
      type: decoded.type, // Should be "access" for access tokens
      // Additional fields that might be in FastAPI JWT
      username: decoded.username || decoded.email,
      id: decoded.user_id,
      timeUntilExpiry: timeUntilExpiry
    };
  } catch (error) {
    // Handle specific JWT errors with more detailed logging and re-throw for better handling
    if (error.name === 'TokenExpiredError') {
      console.log('Token has expired - user needs to refresh or re-login');
      const expiredError = new Error('Token has expired');
      expiredError.name = 'TokenExpiredError';
      throw expiredError;
    } else if (error.name === 'JsonWebTokenError') {
      console.log('Invalid token format - malformed JWT');
      const invalidError = new Error('Invalid token format');
      invalidError.name = 'JsonWebTokenError';
      throw invalidError;
    } else if (error.name === 'NotBeforeError') {
      console.log('Token not active yet - check system time');
      const notBeforeError = new Error('Token not active yet');
      notBeforeError.name = 'NotBeforeError';
      throw notBeforeError;
    } else {
      console.error('Token verification failed:', error.message);
      throw error; // Re-throw to preserve error type
    }
  }
}

/**
 * Middleware to verify JWT token in HTTP requests with improved error handling
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      message: 'Please provide a valid JWT token in the Authorization header',
      code: 'MISSING_TOKEN'
    });
  }

  verifyToken(token)
    .then(user => {
      if (user) {
        req.user = user;
        next();
      } else {
        res.status(403).json({ 
          error: 'Invalid token',
          message: 'Token verification failed',
          code: 'INVALID_TOKEN'
        });
      }
    })
    .catch(error => {
      console.error('Authentication error:', error.message);
      
      // Handle specific error types
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token expired',
          message: 'Your session has expired. Please refresh your token or log in again.',
          code: 'TOKEN_EXPIRED',
          action: 'REFRESH_TOKEN'
        });
      } else if (error.name === 'JsonWebTokenError') {
        return res.status(403).json({ 
          error: 'Invalid token',
          message: 'Invalid token format. Please log in again.',
          code: 'INVALID_TOKEN',
          action: 'RELOGIN'
        });
      } else {
        return res.status(500).json({ 
          error: 'Authentication failed',
          message: 'Internal server error during authentication',
          code: 'AUTH_ERROR'
        });
      }
    });
}

/**
 * Check if user has required role
 * @param {string} requiredRole - Required role (admin, member)
 * @returns {Function} - Express middleware function
 */
function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'User must be authenticated first'
      });
    }

    if (req.user.role !== requiredRole && req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `Role '${requiredRole}' required`
      });
    }

    next();
  };
}

/**
 * Fetch user's team memberships from Python backend
 * @param {number} userId - User ID
 * @param {string} token - JWT token for authentication
 * @returns {Array} - Array of team IDs user belongs to
 */
async function fetchUserTeams(userId, token) {
  try {
    const pythonBackendUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';
    
    const response = await axios.get(`${pythonBackendUrl}/api/users/${userId}/teams`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    if (response.data && Array.isArray(response.data)) {
      return response.data.map(team => team.id);
    }
    
    return [];
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.warn(`Python backend not available at ${pythonBackendUrl} - teams will be empty`);
    } else if (error.response?.status === 404) {
      console.warn(`User ${userId} not found in Python backend - teams will be empty`);
    } else if (error.response?.status === 403) {
      console.warn(`User ${userId} not authorized to view teams - teams will be empty`);
    } else {
      console.error(`Failed to fetch teams for user ${userId}:`, error.message);
    }
    return [];
  }
}

/**
 * Fetch user's tasks from Python backend
 * @param {number} userId - User ID
 * @param {string} token - JWT token for authentication
 * @returns {Array} - Array of user's tasks
 */
async function fetchUserTasks(userId, token) {
  try {
    const pythonBackendUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';
    
    const response = await axios.get(`${pythonBackendUrl}/api/tasks?assigned_to=${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    }
    
    return [];
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.warn(`Python backend not available at ${pythonBackendUrl} - tasks will be empty`);
    } else if (error.response?.status === 404) {
      console.warn(`No tasks found for user ${userId} - tasks will be empty`);
    } else if (error.response?.status === 403) {
      console.warn(`User ${userId} not authorized to view tasks - tasks will be empty`);
    } else {
      console.error(`Failed to fetch tasks for user ${userId}:`, error.message);
    }
    return [];
  }
}

module.exports = { 
  verifyToken, 
  authenticateToken, 
  requireRole,
  fetchUserTeams,
  fetchUserTasks
};
