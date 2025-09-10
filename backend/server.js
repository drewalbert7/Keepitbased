const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const path = require('path');

// Load robust configuration
const config = require('./config');
const { createCommonChecks } = require('./utils/startup');

// Run startup validation
async function runStartupValidation() {
  const validator = createCommonChecks();
  const result = await validator.runAll();
  
  if (!result.success && result.summary.hasErrors) {
    console.error('💥 Critical startup validation errors detected. Exiting...');
    process.exit(1);
  }
  
  return result;
}

const authRoutes = require('./routes/auth');
const alertRoutes = require('./routes/alerts');
const priceRoutes = require('./routes/prices');
const userRoutes = require('./routes/users');
const chartRoutes = require('./routes/charts');
const cryptoRoutes = require('./routes/crypto');
const healthRoutes = require('./routes/health');

const PriceMonitor = require('./services/priceMonitor');
const AlertService = require('./services/alertService');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://keepitbased.com",
      config.FRONTEND_URL
    ].filter(Boolean),
    methods: ["GET", "POST"]
  }
});

const PORT = config.PORT;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"]
    }
  }
}));

app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://keepitbased.com",
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize services
const priceMonitor = new PriceMonitor(io);
const alertService = new AlertService(io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/charts', chartRoutes);
app.use('/api/crypto', cryptoRoutes);
app.use('/api/health', healthRoutes);

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../frontend/build')));

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('subscribe', (symbols) => {
    logger.info(`Client ${socket.id} subscribing to: ${symbols.join(', ')}`);
    socket.join('price-updates');
  });
  
  socket.on('unsubscribe', () => {
    socket.leave('price-updates');
  });
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Start price monitoring (every minute)
cron.schedule('*/1 * * * *', async () => {
  try {
    await priceMonitor.checkAllPrices();
    await alertService.processAlerts();
  } catch (error) {
    logger.error('Error in scheduled price check:', error);
  }
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Serve React app for all non-API routes
app.get('*', (req, res) => {
  // Only serve API 404 for /api/* routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API endpoint not found' });
  }
  
  // Serve React app for all other routes
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Start server with validation
async function startServer() {
  try {
    // Run startup validation
    await runStartupValidation();
    
    // Start server
    server.listen(PORT, () => {
      logger.info(`🚀 KeepItBased API server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${config.NODE_ENV}`);
      logger.info(`🔧 Configuration validated and loaded`);
      
      // Start initial price fetch
      setTimeout(() => {
        priceMonitor.checkAllPrices();
      }, 5000);
    });
  } catch (error) {
    logger.error('💥 Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = { app, server, io };