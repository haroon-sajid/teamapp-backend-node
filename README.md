# Team Collaboration WebSocket Server

Real-time WebSocket server for Team Collaboration App using Socket.IO and Node.js.

## Quick Start

### Install Dependencies
```bash
npm install
```

### Configure Environment
Create a `.env` file with your JWT secret (must match Python FastAPI backend):
```env
JWT_SECRET=your-fastapi-jwt-secret-here
CORS_ORIGIN=http://localhost:3000
```

### Run Server
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Server status |
| GET | `/health` | Health check |
| GET | `/auth/test` | Test authentication |
| GET | `/projects/:projectId/users` | Get active users |
| GET | `/rooms` | Get active rooms |
| GET | `/users/:userId/connections` | Get user connections |

## WebSocket Events

### Client to Server
- `authenticate` - Authenticate with JWT token
- `join_project` - Join project room
- `leave_project` - Leave project room
- `task_created` - Create task
- `task_updated` - Update task
- `task_deleted` - Delete task
- `project_updated` - Update project
- `user_typing` - Typing indicator
- `cursor_position` - Cursor position

### Server to Client
- `connected` - Connection established
- `authenticated` - Authentication success
- `authentication_error` - Authentication failed
- `user_joined` - User joined project
- `user_left` - User left project
- `task_created` - Task created
- `task_updated` - Task updated
- `task_deleted` - Task deleted
- `project_updated` - Project updated
- `typing_indicator` - Typing indicator
- `user_cursor` - User cursor position
- `error` - Error message

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `JWT_SECRET` | JWT secret (must match FastAPI backend) | Required |
| `CORS_ORIGIN` | CORS origin URL | `http://localhost:3000` |
| `NODE_ENV` | Environment mode | `development` |

## License

MIT