const redis = require('redis');
const logger = require('./logger');

let client = null;

function getRedisClient() {
  if (!client) {
    client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    client.on('error', (err) => {
      logger.error('Redis client error:', err);
    });

    client.on('connect', () => {
      logger.info('Connected to Redis');
    });

    client.on('disconnect', () => {
      logger.warn('Disconnected from Redis');
    });

    // Connect to Redis
    client.connect().catch(err => {
      logger.error('Failed to connect to Redis:', err);
    });
  }
  
  return client;
}

module.exports = {
  getRedisClient
};