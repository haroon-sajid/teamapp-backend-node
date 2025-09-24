const { verifyToken, fetchUserTeams } = require('./auth');
const axios = require('axios');

// In-memory storage for active rooms and users
const activeRooms = new Map(); // projectId -> Set of userIds
const userSockets = new Map(); // userId -> Set of socketIds
const socketUsers = new Map(); // socketId -> userInfo

/**
 * Get team ID for a project from Python backend
 * @param {number} projectId - Project ID
 * @param {string} token - JWT token for authentication
 * @returns {number|null} - Team ID or null if not found
 */
async function getProjectTeamId(projectId, token) {
  try {
    const pythonBackendUrl = process.env.PYTHON_BACKEND_URL;
    if (!pythonBackendUrl) {
        throw new Error('PYTHON_BACKEND_URL environment variable is required');
    }
    
    const response = await axios.get(`${pythonBackendUrl}/api/projects/${projectId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    return response.data?.team_id || null;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.warn(`Python backend not available at ${pythonBackendUrl} - cannot get team ID for project ${projectId}`);
    } else if (error.response?.status === 404) {
      console.warn(`Project ${projectId} not found in Python backend`);
    } else {
      console.error(`Failed to fetch team ID for project ${projectId}:`, error.message);
    }
    return null;
  }
}

/**
 * Handle new socket connection
 * @param {Object} socket - Socket.IO socket instance
 * @param {Object} io - Socket.IO server instance
 */
function handleConnection(socket, io) {
  console.log(`New connection: ${socket.id}`);
  
  // Track authenticated sockets
  if (socket.authenticated && socket.userId) {
    // Track user's sockets
    if (!userSockets.has(socket.userId)) {
      userSockets.set(socket.userId, new Set());
    }
    userSockets.get(socket.userId).add(socket.id);
    socketUsers.set(socket.id, {
      userId: socket.userId,
      email: socket.userEmail,
      role: socket.userRole
    });
    
    console.log(`User tracked: ${socket.userEmail} (${socket.userId}) via socket ${socket.id}`);
  }

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

  // Handle task updates with improved error handling and role-based filtering
  socket.on('task_updated', async (data) => {
    try {
      if (!socket.authenticated) {
        socket.emit('error', { 
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { taskId, projectId, taskData, action } = data;
      
      if (!taskId || !projectId) {
        socket.emit('error', { 
          message: 'Task ID and Project ID are required',
          code: 'MISSING_REQUIRED_FIELDS',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Get project's team ID and emit to team room
      const teamId = await getProjectTeamId(projectId, socket.token);
      if (teamId) {
        const teamRoom = `team:${teamId}`;
        
        // Create the update event
        const updateEvent = {
          taskId,
          projectId,
          taskData,
          action: action || 'update',
          updatedBy: {
            userId: socket.userId,
            userEmail: socket.userEmail
          },
          timestamp: new Date().toISOString()
        };

        // For member users, only broadcast to the assignee if the task is assigned
        if (socket.userRole === 'member' && taskData?.assigneeId) {
          // Find sockets for the assigned user
          const assigneeSockets = Array.from(io.sockets.sockets.values())
            .filter(s => s.authenticated && s.userId === taskData.assigneeId);
          
          // Emit to assignee's sockets
          assigneeSockets.forEach(s => s.emit('task_updated', updateEvent));
          
          // Also emit to the sender
          socket.emit('task_updated', updateEvent);
        } else {
          // For admins or unassigned tasks, broadcast to all team members
          io.to(teamRoom).emit('task_updated', updateEvent);
        }
        
        console.log(`Task ${taskId} ${action || 'updated'} in project ${projectId} by ${socket.userEmail}`);
      } else {
        console.warn(`No team ID found for project ${projectId} - task update not broadcasted`);
      }
    } catch (err) {
      console.error('Failed to handle task_updated:', err.message);
      socket.emit('error', {
        message: 'Failed to process task update',
        code: 'TASK_UPDATE_FAILED',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle task creation with improved error handling and role-based filtering
  socket.on('task_created', async (data) => {
    try {
      if (!socket.authenticated) {
        socket.emit('error', { 
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { taskId, projectId, taskData } = data;
      
      if (!taskId || !projectId || !taskData) {
        socket.emit('error', { 
          message: 'Task ID, Project ID, and Task Data are required',
          code: 'MISSING_REQUIRED_FIELDS',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Get project's team ID and emit to team room
      const teamId = await getProjectTeamId(projectId, socket.token);
      if (teamId) {
        const teamRoom = `team:${teamId}`;
        
        // Create the creation event
        const createEvent = {
          taskId,
          projectId,
          taskData,
          createdBy: {
            userId: socket.userId,
            userEmail: socket.userEmail
          },
          timestamp: new Date().toISOString()
        };

        // For member users, only broadcast to the assignee if the task is assigned
        if (socket.userRole === 'member' && taskData?.assigneeId) {
          // Find sockets for the assigned user
          const assigneeSockets = Array.from(io.sockets.sockets.values())
            .filter(s => s.authenticated && s.userId === taskData.assigneeId);
          
          // Emit to assignee's sockets
          assigneeSockets.forEach(s => s.emit('task_created', createEvent));
          
          // Also emit to the sender
          socket.emit('task_created', createEvent);
        } else {
          // For admins or unassigned tasks, broadcast to all team members
          io.to(teamRoom).emit('task_created', createEvent);
        }
        
        console.log(`Task ${taskId} created in project ${projectId} by ${socket.userEmail}`);
      } else {
        console.warn(`No team ID found for project ${projectId} - task creation not broadcasted`);
      }
    } catch (err) {
      console.error('Failed to handle task_created:', err.message);
      socket.emit('error', {
        message: 'Failed to process task creation',
        code: 'TASK_CREATE_FAILED',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle task deletion with improved error handling and role-based filtering
  socket.on('task_deleted', async (data) => {
    try {
      if (!socket.authenticated) {
        socket.emit('error', { 
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { taskId, projectId } = data;
      
      if (!taskId || !projectId) {
        socket.emit('error', { 
          message: 'Task ID and Project ID are required',
          code: 'MISSING_REQUIRED_FIELDS',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Get project's team ID and emit to team room
      const teamId = await getProjectTeamId(projectId, socket.token);
      if (teamId) {
        const teamRoom = `team:${teamId}`;
        
        // Create the deletion event
        const deleteEvent = {
          taskId,
          projectId,
          deletedBy: {
            userId: socket.userId,
            userEmail: socket.userEmail
          },
          timestamp: new Date().toISOString()
        };

        // For member users, only broadcast to team members (since only admins can delete)
        if (socket.userRole === 'member') {
          // Members shouldn't be able to delete tasks, but if they somehow do, broadcast to team
          io.to(teamRoom).emit('task_deleted', deleteEvent);
        } else {
          // For admins, broadcast to all team members
          io.to(teamRoom).emit('task_deleted', deleteEvent);
        }
        
        console.log(`Task ${taskId} deleted in project ${projectId} by ${socket.userEmail}`);
      } else {
        console.warn(`No team ID found for project ${projectId} - task deletion not broadcasted`);
      }
    } catch (err) {
      console.error('Failed to handle task_deleted:', err.message);
      socket.emit('error', {
        message: 'Failed to process task deletion',
        code: 'TASK_DELETE_FAILED',
        timestamp: new Date().toISOString()
      });
    }
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

  // Handle project updates with improved error handling
  socket.on('project_updated', async (data) => {
    try {
      if (!socket.authenticated) {
        socket.emit('error', { 
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { projectId, projectData, action } = data;
      
      if (!projectId) {
        socket.emit('error', { 
          message: 'Project ID is required',
          code: 'MISSING_PROJECT_ID',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Get project's team ID and emit to team room
      const teamId = await getProjectTeamId(projectId, socket.token);
      if (teamId) {
        const teamRoom = `team:${teamId}`;
        io.to(teamRoom).emit('project_updated', {
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
      } else {
        console.warn(`No team ID found for project ${projectId} - project update not broadcasted`);
      }
    } catch (err) {
      console.error('Failed to handle project_updated:', err.message);
      socket.emit('error', {
        message: 'Failed to process project update',
        code: 'PROJECT_UPDATE_FAILED',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle disconnection with improved logging
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id} (${reason}) - authenticated: ${socket.authenticated}`);
    
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
          
          console.log(`User ${socket.userEmail} left project ${projectId} due to disconnect`);
        }
      });
      
      // Remove from user sockets tracking
      if (userSockets.has(socket.userId)) {
        userSockets.get(socket.userId).delete(socket.id);
        if (userSockets.get(socket.userId).size === 0) {
          userSockets.delete(socket.userId);
          console.log(`User ${socket.userEmail} has no remaining connections`);
        }
      }
    }
    
    // Remove from socket users tracking
    socketUsers.delete(socket.id);
  });

  // Handle errors with improved logging
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error.message || error);
    
    // Don't disconnect on socket errors - let the client handle reconnection
    // Only log the error for debugging purposes
  });
  
  // Handle authentication errors
  socket.on('auth_error', (error) => {
    console.error(`Authentication error for ${socket.id}:`, error.message || error);
    
    // Emit error back to client
    socket.emit('error', {
      message: 'Authentication error occurred',
      code: 'AUTH_ERROR',
      timestamp: new Date().toISOString()
    });
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
