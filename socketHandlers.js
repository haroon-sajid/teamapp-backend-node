const { verifyToken } = require('./auth');

// In-memory storage for active rooms and users
const activeRooms = new Map(); // projectId -> Set of userIds
const userSockets = new Map(); // userId -> Set of socketIds
const socketUsers = new Map(); // socketId -> userInfo

/**
 * Handle new socket connection
 * @param {Object} socket - Socket.IO socket instance
 * @param {Object} io - Socket.IO server instance
 */
function handleConnection(socket, io) {
  console.log(`New connection: ${socket.id}`);
  
  // Handle user authentication
  socket.on('authenticate', async (data) => {
    try {
      const { token } = data;
      
      if (!token) {
        socket.emit('authentication_error', { 
          message: 'Token is required',
          code: 'MISSING_TOKEN',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const user = await verifyToken(token);
      
      if (user) {
        // Store user info on socket
        socket.userId = user.userId;
        socket.userEmail = user.email;
        socket.userRole = user.role;
        socket.authenticated = true;
        socket.authenticatedAt = new Date().toISOString();
        
        // Track user's sockets
        if (!userSockets.has(user.userId)) {
          userSockets.set(user.userId, new Set());
        }
        userSockets.get(user.userId).add(socket.id);
        socketUsers.set(socket.id, user);
        
        socket.emit('authenticated', { 
          success: true,
          user: {
            id: user.userId,
            email: user.email,
            role: user.role,
            username: user.username
          },
          timestamp: new Date().toISOString()
        });
        
        console.log(`User authenticated: ${user.email} (${user.userId}) via socket ${socket.id}`);
      } else {
        socket.emit('authentication_error', { 
          message: 'Invalid or expired token',
          code: 'INVALID_TOKEN',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('authentication_error', { 
        message: 'Authentication failed',
        code: 'AUTH_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Join a project room
  socket.on('join_project', (data) => {
    if (!socket.authenticated) {
      socket.emit('error', { 
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const { projectId } = data;
    
    if (!projectId) {
      socket.emit('error', { 
        message: 'Project ID is required',
        code: 'MISSING_PROJECT_ID',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Leave previous project rooms (but keep personal room)
    socket.rooms.forEach(room => {
      if (room !== socket.id && room.startsWith('project_')) {
        socket.leave(room);
        removeUserFromRoom(room.replace('project_', ''), socket.userId);
      }
    });
    
    // Join new project room
    const roomName = `project_${projectId}`;
    socket.join(roomName);
    
    // Track active users in room
    if (!activeRooms.has(projectId)) {
      activeRooms.set(projectId, new Set());
    }
    activeRooms.get(projectId).add(socket.userId);
    
    // Notify others in the room
    socket.to(roomName).emit('user_joined', {
      userId: socket.userId,
      userEmail: socket.userEmail,
      projectId: projectId,
      timestamp: new Date().toISOString()
    });
    
    // Send current room members to the joining user
    const roomMembers = Array.from(activeRooms.get(projectId) || []);
    socket.emit('room_members', {
      projectId: projectId,
      members: roomMembers,
      count: roomMembers.length
    });
    
    console.log(`User ${socket.userEmail} joined project ${projectId}`);
  });

  // Leave a project room
  socket.on('leave_project', (data) => {
    if (!socket.authenticated) {
      return;
    }

    const { projectId } = data;
    
    if (!projectId) {
      socket.emit('error', { 
        message: 'Project ID is required',
        code: 'MISSING_PROJECT_ID'
      });
      return;
    }

    const roomName = `project_${projectId}`;
    socket.leave(roomName);
    removeUserFromRoom(projectId, socket.userId);
    
    // Notify others in the room
    socket.to(roomName).emit('user_left', {
      userId: socket.userId,
      userEmail: socket.userEmail,
      projectId: projectId,
      timestamp: new Date().toISOString()
    });
    
    console.log(`User ${socket.userEmail} left project ${projectId}`);
  });

  // Handle task updates
  socket.on('task_updated', (data) => {
    if (!socket.authenticated) {
      socket.emit('error', { 
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    const { taskId, projectId, taskData, action } = data;
    
    if (!taskId || !projectId) {
      socket.emit('error', { 
        message: 'Task ID and Project ID are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const roomName = `project_${projectId}`;
    
    // Broadcast to all users in the project room (except sender)
    socket.to(roomName).emit('task_updated', {
      taskId,
      projectId,
      taskData,
      action: action || 'update',
      updatedBy: {
        userId: socket.userId,
        userEmail: socket.userEmail
      },
      timestamp: new Date().toISOString()
    });
    
    console.log(`Task ${taskId} ${action || 'updated'} in project ${projectId} by ${socket.userEmail}`);
  });

  // Handle task creation
  socket.on('task_created', (data) => {
    if (!socket.authenticated) {
      socket.emit('error', { 
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    const { taskId, projectId, taskData } = data;
    
    if (!taskId || !projectId || !taskData) {
      socket.emit('error', { 
        message: 'Task ID, Project ID, and Task Data are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const roomName = `project_${projectId}`;
    
    // Broadcast to all users in the project room (except sender)
    socket.to(roomName).emit('task_created', {
      taskId,
      projectId,
      taskData,
      createdBy: {
        userId: socket.userId,
        userEmail: socket.userEmail
      },
      timestamp: new Date().toISOString()
    });
    
    console.log(`Task ${taskId} created in project ${projectId} by ${socket.userEmail}`);
  });

  // Handle task deletion
  socket.on('task_deleted', (data) => {
    if (!socket.authenticated) {
      socket.emit('error', { 
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    const { taskId, projectId } = data;
    
    if (!taskId || !projectId) {
      socket.emit('error', { 
        message: 'Task ID and Project ID are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const roomName = `project_${projectId}`;
    
    // Broadcast to all users in the project room (except sender)
    socket.to(roomName).emit('task_deleted', {
      taskId,
      projectId,
      deletedBy: {
        userId: socket.userId,
        userEmail: socket.userEmail
      },
      timestamp: new Date().toISOString()
    });
    
    console.log(`Task ${taskId} deleted in project ${projectId} by ${socket.userEmail}`);
  });

  // Handle typing indicators
  socket.on('user_typing', (data) => {
    if (!socket.authenticated) {
      return;
    }

    const { projectId, isTyping, field } = data;
    
    if (!projectId) {
      return;
    }

    const roomName = `project_${projectId}`;
    
    socket.to(roomName).emit('typing_indicator', {
      userId: socket.userId,
      userEmail: socket.userEmail,
      isTyping: Boolean(isTyping),
      field: field || 'general',
      projectId,
      timestamp: new Date().toISOString()
    });
  });

  // Handle cursor position sharing
  socket.on('cursor_position', (data) => {
    if (!socket.authenticated) {
      return;
    }

    const { projectId, position } = data;
    
    if (!projectId || !position) {
      return;
    }

    const roomName = `project_${projectId}`;
    
    socket.to(roomName).emit('user_cursor', {
      userId: socket.userId,
      userEmail: socket.userEmail,
      position,
      projectId,
      timestamp: new Date().toISOString()
    });
  });

  // Handle project updates
  socket.on('project_updated', (data) => {
    if (!socket.authenticated) {
      socket.emit('error', { 
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    const { projectId, projectData, action } = data;
    
    if (!projectId) {
      socket.emit('error', { 
        message: 'Project ID is required',
        code: 'MISSING_PROJECT_ID'
      });
      return;
    }

    const roomName = `project_${projectId}`;
    
    // Broadcast to all users in the project room (except sender)
    socket.to(roomName).emit('project_updated', {
      projectId,
      projectData,
      action: action || 'update',
      updatedBy: {
        userId: socket.userId,
        userEmail: socket.userEmail
      },
      timestamp: new Date().toISOString()
    });
    
    console.log(`Project ${projectId} ${action || 'updated'} by ${socket.userEmail}`);
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id} (${reason})`);
    
    if (socket.authenticated && socket.userId) {
      // Remove from all active rooms
      activeRooms.forEach((users, projectId) => {
        if (users.has(socket.userId)) {
          users.delete(socket.userId);
          
          // Notify others in the room
          const roomName = `project_${projectId}`;
          socket.to(roomName).emit('user_left', {
            userId: socket.userId,
            userEmail: socket.userEmail,
            projectId: projectId,
            timestamp: new Date().toISOString(),
            reason: 'disconnected'
          });
        }
      });
      
      // Remove from user sockets tracking
      if (userSockets.has(socket.userId)) {
        userSockets.get(socket.userId).delete(socket.id);
        if (userSockets.get(socket.userId).size === 0) {
          userSockets.delete(socket.userId);
        }
      }
    }
    
    // Remove from socket users tracking
    socketUsers.delete(socket.id);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
}

/**
 * Remove user from room tracking
 * @param {string} projectId - Project ID
 * @param {string} userId - User ID
 */
function removeUserFromRoom(projectId, userId) {
  if (activeRooms.has(projectId)) {
    activeRooms.get(projectId).delete(userId);
    
    // Clean up empty rooms
    if (activeRooms.get(projectId).size === 0) {
      activeRooms.delete(projectId);
    }
  }
}

/**
 * Get active users in a project
 * @param {string} projectId - Project ID
 * @returns {Array} - Array of user IDs
 */
function getActiveUsers(projectId) {
  return Array.from(activeRooms.get(projectId) || []);
}

/**
 * Get all active rooms
 * @returns {Object} - Map of project IDs to user counts
 */
function getActiveRooms() {
  const rooms = {};
  activeRooms.forEach((users, projectId) => {
    rooms[projectId] = users.size;
  });
  return rooms;
}

/**
 * Get user's active sockets
 * @param {string} userId - User ID
 * @returns {Array} - Array of socket IDs
 */
function getUserSockets(userId) {
  return Array.from(userSockets.get(userId) || []);
}

module.exports = { 
  handleConnection, 
  getActiveUsers, 
  getActiveRooms, 
  getUserSockets 
};
