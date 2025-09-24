# Production Deployment Guide

This guide provides step-by-step instructions for safely deploying the Team Collaboration WebSocket server to production without connection issues.

## Pre-Deployment Checklist

### 1. Environment Configuration

Create a `.env` file for production:

```bash
# Production Environment Variables
NODE_ENV=production
PORT=3001

# JWT Configuration (MUST match your FastAPI backend)
JWT_SECRET=your-super-secure-production-jwt-secret-key-here
JWT_ALGORITHM=HS256

# Backend Configuration
PYTHON_BACKEND_URL=https://your-api-domain.com
FRONTEND_URL=https://your-frontend-domain.com

# CORS Configuration
CORS_ORIGIN=https://your-frontend-domain.com

# Socket.IO Configuration
SOCKET_PING_INTERVAL=25000
SOCKET_PING_TIMEOUT=60000
```

### 2. Security Configuration

**Critical Security Steps**:

1. **Change JWT Secret**: Use a strong, unique JWT secret that matches your FastAPI backend
2. **Update CORS Origins**: Replace localhost URLs with your production domains
3. **Use HTTPS**: Ensure all production URLs use HTTPS
4. **Environment Variables**: Never commit production secrets to version control

### 3. Server Requirements

**Minimum Requirements**:
- Node.js 16.0.0 or higher
- 2GB RAM minimum
- 1 CPU core minimum
- 10GB disk space

**Recommended for Production**:
- Node.js 18.x LTS
- 4GB RAM
- 2+ CPU cores
- 50GB disk space
- SSD storage

## Deployment Options

### Option 1: Traditional VPS/Cloud Server

#### Step 1: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Create application user
sudo useradd -m -s /bin/bash websocket-app
sudo usermod -aG sudo websocket-app
```

#### Step 2: Application Deployment

```bash
# Switch to application user
sudo su - websocket-app

# Clone your repository
git clone https://github.com/your-username/team-collaboration-websocket.git
cd team-collaboration-websocket

# Install dependencies
npm install --production

# Create production environment file
cp .env.example .env
# Edit .env with production values
nano .env

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'team-collaboration-websocket',
    script: 'server.js',
    instances: 'max', // Use all CPU cores
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF

# Create logs directory
mkdir -p logs

# Start application with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

#### Step 3: Nginx Configuration

```bash
# Install Nginx
sudo apt install nginx -y

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/websocket-app
```

Nginx configuration:

```nginx
upstream websocket_backend {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
    server 127.0.0.1:3004;
    server 127.0.0.1:3005;
}

server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL Configuration
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # WebSocket proxy configuration
    location /socket.io/ {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific settings
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://websocket_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/websocket-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Option 2: Docker Deployment

#### Step 1: Create Dockerfile

```dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S websocket -u 1001

# Change ownership
RUN chown -R websocket:nodejs /usr/src/app
USER websocket

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application
CMD ["node", "server.js"]
```

#### Step 2: Create Docker Compose

```yaml
version: '3.8'

services:
  websocket-server:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - JWT_SECRET=${JWT_SECRET}
      - JWT_ALGORITHM=HS256
      - PYTHON_BACKEND_URL=${PYTHON_BACKEND_URL}
      - FRONTEND_URL=${FRONTEND_URL}
      - CORS_ORIGIN=${CORS_ORIGIN}
    volumes:
      - ./logs:/usr/src/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - websocket-server
    restart: unless-stopped
```

#### Step 3: Deploy with Docker

```bash
# Create environment file
cat > .env << EOF
JWT_SECRET=your-super-secure-production-jwt-secret
PYTHON_BACKEND_URL=https://your-api-domain.com
FRONTEND_URL=https://your-frontend-domain.com
CORS_ORIGIN=https://your-frontend-domain.com
EOF

# Build and start
docker-compose up -d

# Check logs
docker-compose logs -f websocket-server
```

### Option 3: Cloud Platform Deployment

#### AWS EC2 with Load Balancer

1. **Launch EC2 Instance**:
   - Use Amazon Linux 2 or Ubuntu 20.04
   - t3.medium or larger
   - Configure security groups for ports 80, 443, 3001

2. **Setup Application**:
   ```bash
   # Install Node.js and PM2
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 18
   nvm use 18
   npm install -g pm2
   ```

3. **Configure Load Balancer**:
   - Create Application Load Balancer
   - Configure target groups for health checks on `/health`
   - Setup SSL certificate in ACM

#### Google Cloud Platform

1. **Deploy to App Engine**:
   ```yaml
   # app.yaml
   runtime: nodejs18
   env: standard
   
   env_variables:
     NODE_ENV: production
     JWT_SECRET: your-jwt-secret
     PYTHON_BACKEND_URL: https://your-api-domain.com
     FRONTEND_URL: https://your-frontend-domain.com
   
   automatic_scaling:
     min_instances: 1
     max_instances: 10
     target_cpu_utilization: 0.6
   ```

2. **Deploy**:
   ```bash
   gcloud app deploy
   ```

## Production Configuration

### 1. Environment Variables

**Required Production Variables**:

```bash
# Core Configuration
NODE_ENV=production
PORT=3001

# Security (CRITICAL - Change these!)
JWT_SECRET=your-super-secure-256-bit-secret-key-here
JWT_ALGORITHM=HS256

# Backend Integration
PYTHON_BACKEND_URL=https://your-api-domain.com
FRONTEND_URL=https://your-frontend-domain.com

# CORS Configuration
CORS_ORIGIN=https://your-frontend-domain.com

# Performance Tuning
SOCKET_PING_INTERVAL=25000
SOCKET_PING_TIMEOUT=60000

# Rate Limiting (Optional - adjust based on needs)
MAX_CONNECTIONS_PER_IP=10
MAX_CONNECTIONS_LOCALHOST=20
CONNECTION_WINDOW=60000
CONNECTION_COOLDOWN=2000
CONNECTION_COOLDOWN_LOCALHOST=500
```

### 2. Process Management

**PM2 Configuration** (recommended):

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'team-collaboration-websocket',
    script: 'server.js',
    instances: 'max', // Use all CPU cores
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s',
    watch: false,
    ignore_watch: ['node_modules', 'logs']
  }]
};
```

### 3. Monitoring and Logging

**Setup Log Rotation**:

```bash
# Install logrotate
sudo apt install logrotate -y

# Create logrotate configuration
sudo nano /etc/logrotate.d/websocket-app
```

Logrotate configuration:

```
/path/to/your/app/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 websocket-app websocket-app
    postrotate
        pm2 reloadLogs
    endscript
}
```

**Health Monitoring**:

```bash
# Create health check script
cat > health-check.sh << 'EOF'
#!/bin/bash

HEALTH_URL="http://localhost:3001/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -eq 200 ]; then
    echo "Health check passed: $RESPONSE"
    exit 0
else
    echo "Health check failed: $RESPONSE"
    # Restart PM2 process
    pm2 restart team-collaboration-websocket
    exit 1
fi
EOF

chmod +x health-check.sh

# Add to crontab for monitoring
(crontab -l 2>/dev/null; echo "*/5 * * * * /path/to/health-check.sh") | crontab -
```

## Security Considerations

### 1. JWT Secret Management

**Never use default secrets in production!**

```bash
# Generate secure JWT secret
openssl rand -base64 64

# Store securely (use environment variables or secret management service)
export JWT_SECRET="your-generated-secret-here"
```

### 2. CORS Configuration

**Update CORS origins for production**:

```javascript
// In server.js, update CORS configuration
const io = socketIo(server, {
  cors: {
    origin: [
      "https://your-frontend-domain.com",
      "https://www.your-frontend-domain.com",
      // Remove localhost URLs for production
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"]
  }
});
```

### 3. Rate Limiting Tuning

**Adjust rate limits based on your needs**:

```javascript
// In server.js, adjust these values for production
const MAX_CONNECTIONS_PER_IP = 10; // Adjust based on expected load
const MAX_CONNECTIONS_LOCALHOST = 20; // Keep higher for admin access
const CONNECTION_WINDOW = 60000; // 1 minute
const CONNECTION_COOLDOWN = 2000; // 2 seconds
const CONNECTION_COOLDOWN_LOCALHOST = 500; // 0.5 seconds
```

## Performance Optimization

### 1. Cluster Mode

**Use PM2 cluster mode for better performance**:

```bash
# Start with cluster mode
pm2 start ecosystem.config.js --env production

# Monitor cluster
pm2 monit
```

### 2. Load Balancing

**For high-traffic scenarios, use multiple instances**:

```bash
# Start multiple instances on different ports
PORT=3001 pm2 start server.js --name "websocket-1"
PORT=3002 pm2 start server.js --name "websocket-2"
PORT=3003 pm2 start server.js --name "websocket-3"
PORT=3004 pm2 start server.js --name "websocket-4"
```

### 3. Memory Management

**Monitor and manage memory usage**:

```bash
# Set memory limits in PM2
pm2 start server.js --max-memory-restart 1G

# Monitor memory usage
pm2 monit
```

## Deployment Verification

### 1. Health Check

```bash
# Test health endpoint
curl https://your-domain.com/health

# Expected response:
{
  "status": "OK",
  "timestamp": "2024-01-XX...",
  "environment": "production",
  "connections": {
    "total": 0,
    "activeRooms": 0,
    "rooms": {}
  }
}
```

### 2. WebSocket Connection Test

```javascript
// Test WebSocket connection from browser console
const socket = io('https://your-domain.com', {
  auth: {
    token: 'your-valid-jwt-token'
  }
});

socket.on('connected', (data) => {
  console.log('Connected to production server:', data);
});

socket.on('authenticated', (data) => {
  console.log('Authentication successful:', data);
});
```

### 3. Load Testing

```bash
# Install artillery for load testing
npm install -g artillery

# Create load test configuration
cat > load-test.yml << EOF
config:
  target: 'https://your-domain.com'
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "WebSocket Connection Test"
    weight: 100
    engine: socketio
    beforeRequest: "setAuthToken"
functions:
  setAuthToken: |
    function(context, events, done) {
      context.vars.token = 'your-valid-jwt-token';
      return done();
    }
EOF

# Run load test
artillery run load-test.yml
```

## Troubleshooting Production Issues

### Common Issues and Solutions

1. **High Memory Usage**:
   ```bash
   # Restart PM2 process
   pm2 restart team-collaboration-websocket
   
   # Check for memory leaks
   pm2 monit
   ```

2. **Connection Timeouts**:
   ```bash
   # Check Nginx configuration
   sudo nginx -t
   
   # Restart Nginx
   sudo systemctl restart nginx
   ```

3. **JWT Authentication Failures**:
   ```bash
   # Verify JWT secret matches backend
   echo $JWT_SECRET
   
   # Check backend connectivity
   curl $PYTHON_BACKEND_URL/health
   ```

4. **Rate Limiting Issues**:
   ```bash
   # Check server logs
   pm2 logs team-collaboration-websocket
   
   # Adjust rate limits if needed
   # Edit server.js and restart
   ```

## Maintenance

### Regular Maintenance Tasks

1. **Weekly**:
   - Check server logs for errors
   - Monitor memory usage
   - Verify health endpoints

2. **Monthly**:
   - Update dependencies
   - Review security settings
   - Check SSL certificate expiration

3. **Quarterly**:
   - Performance review
   - Security audit
   - Backup verification

### Backup Strategy

```bash
# Backup application code
tar -czf websocket-app-backup-$(date +%Y%m%d).tar.gz /path/to/your/app

# Backup PM2 configuration
pm2 save
cp ~/.pm2/dump.pm2 /path/to/backup/

# Backup environment variables (securely)
# Store in secure location, never in version control
```

## Support and Monitoring

### Recommended Monitoring Tools

1. **PM2 Monitoring**: Built-in process monitoring
2. **Nginx Status**: Monitor proxy performance
3. **System Monitoring**: CPU, memory, disk usage
4. **Application Logs**: Error tracking and debugging

### Emergency Procedures

1. **Server Down**:
   ```bash
   # Check PM2 status
   pm2 status
   
   # Restart if needed
   pm2 restart all
   
   # Check system resources
   top
   df -h
   ```

2. **High Load**:
   ```bash
   # Scale up instances
   pm2 scale team-collaboration-websocket +2
   
   # Check for bottlenecks
   pm2 monit
   ```

3. **Security Incident**:
   ```bash
   # Rotate JWT secrets
   # Update CORS settings
   # Review access logs
   # Restart services
   ```

---

**Important**: Always test your deployment in a staging environment before deploying to production. Keep backups of your configuration and have a rollback plan ready.
