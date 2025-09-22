const jwt = require('jsonwebtoken');

// JWT Configuration - must match FastAPI backend
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256';

/**
 * Verify JWT token and extract user information
 * @param {string} token - JWT token to verify
 * @returns {Object|null} - Decoded user object or null if invalid
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
    
    // Extract user information (adjust based on your FastAPI JWT payload structure)
    return {
      email: decoded.sub || decoded.email,
      userId: decoded.user_id || decoded.sub || decoded.email,
      role: decoded.role || 'member', // Default to member if not specified
      exp: decoded.exp,
      iat: decoded.iat,
      // Additional fields that might be in FastAPI JWT
      username: decoded.username || decoded.sub,
      id: decoded.id || decoded.user_id || decoded.sub
    };
  } catch (error) {
    console.error('Token verification failed:', error.message);
    
    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      console.log('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      console.log('Invalid token format');
    } else if (error.name === 'NotBeforeError') {
      console.log('Token not active yet');
    }
    
    return null;
  }
}

/**
 * Middleware to verify JWT token in HTTP requests
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
      message: 'Please provide a valid JWT token in the Authorization header'
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
          message: 'Token verification failed'
        });
      }
    })
    .catch(error => {
      console.error('Authentication error:', error);
      res.status(500).json({ 
        error: 'Authentication failed',
        message: 'Internal server error during authentication'
      });
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

module.exports = { 
  verifyToken, 
  authenticateToken, 
  requireRole 
};
