const logger = require('./logger');
const config = require('../config');

class StartupValidator {
  constructor() {
    this.checks = [];
    this.results = [];
  }

  addCheck(name, checkFunction, critical = false) {
    this.checks.push({ name, checkFunction, critical });
    return this;
  }

  async runAll() {
    logger.info('🔍 Running startup validation checks...');
    
    let hasErrors = false;
    let hasWarnings = false;

    for (const check of this.checks) {
      try {
        const start = Date.now();
        const result = await check.checkFunction();
        const duration = Date.now() - start;

        const checkResult = {
          name: check.name,
          status: result.status || 'ok',
          message: result.message || 'Check passed',
          duration: `${duration}ms`,
          critical: check.critical
        };

        this.results.push(checkResult);

        if (checkResult.status === 'error') {
          if (check.critical) {
            logger.error(`❌ CRITICAL: ${check.name} - ${checkResult.message}`);
            hasErrors = true;
          } else {
            logger.warn(`⚠️  ${check.name} - ${checkResult.message}`);
            hasWarnings = true;
          }
        } else if (checkResult.status === 'warning') {
          logger.warn(`⚠️  ${check.name} - ${checkResult.message}`);
          hasWarnings = true;
        } else {
          logger.info(`✅ ${check.name} - ${checkResult.message}`);
        }
      } catch (error) {
        const checkResult = {
          name: check.name,
          status: 'error',
          message: error.message,
          critical: check.critical
        };

        this.results.push(checkResult);

        if (check.critical) {
          logger.error(`❌ CRITICAL: ${check.name} failed - ${error.message}`);
          hasErrors = true;
        } else {
          logger.warn(`⚠️  ${check.name} failed - ${error.message}`);
          hasWarnings = true;
        }
      }
    }

    // Summary
    const summary = {
      total: this.checks.length,
      passed: this.results.filter(r => r.status === 'ok').length,
      warnings: this.results.filter(r => r.status === 'warning').length,
      errors: this.results.filter(r => r.status === 'error').length,
      hasErrors,
      hasWarnings
    };

    if (hasErrors) {
      logger.error(`💥 Startup validation failed: ${summary.errors} critical errors, ${summary.warnings} warnings`);
      return { success: false, summary, results: this.results };
    } else if (hasWarnings) {
      logger.warn(`⚡ Startup completed with warnings: ${summary.warnings} warnings`);
      return { success: true, summary, results: this.results };
    } else {
      logger.info(`🚀 All startup checks passed! (${summary.passed}/${summary.total})`);
      return { success: true, summary, results: this.results };
    }
  }

  getResults() {
    return this.results;
  }
}

// Common startup checks
const createCommonChecks = () => {
  const validator = new StartupValidator();

  // Configuration validation
  validator.addCheck('Configuration Validation', async () => {
    const isValid = config.validate();
    return {
      status: isValid ? 'ok' : 'error',
      message: isValid ? 'All configuration values are valid' : 'Configuration validation failed'
    };
  }, true);

  // JWT Secret check
  validator.addCheck('JWT Secret', async () => {
    if (!config.JWT_SECRET) {
      return { status: 'error', message: 'JWT_SECRET is not set' };
    }
    if (config.JWT_SECRET === 'your-super-secret-jwt-key-change-in-production' || 
        config.JWT_SECRET.startsWith('fallback-jwt-secret')) {
      return { 
        status: 'warning', 
        message: 'Using default/fallback JWT_SECRET - change in production' 
      };
    }
    return { status: 'ok', message: 'JWT_SECRET is properly configured' };
  });

  // Port pre-flight: only in development (or when forced). In production it races with
  // PM2/nginx restarts and caused false failures + crash loops; real conflicts surface on listen().
  const runPortPrecheck =
    process.env.RUN_PORT_AVAILABILITY_CHECK === 'true'
    || (config.NODE_ENV !== 'production' && process.env.RUN_PORT_AVAILABILITY_CHECK !== 'false');

  if (runPortPrecheck) {
    validator.addCheck('Port Availability', async () => {
      const net = require('net');

      return new Promise((resolve) => {
        const server = net.createServer();

        server.listen(config.PORT, () => {
          server.close();
          resolve({ status: 'ok', message: `Port ${config.PORT} is available` });
        });

        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve({
              status: 'error',
              message: `Port ${config.PORT} is already in use`
            });
          } else {
            resolve({
              status: 'error',
              message: `Port check failed: ${err.message}`
            });
          }
        });
      });
    }, false);
  }

  // Database connectivity
  validator.addCheck('Database Connection', async () => {
    try {
      const db = require('../models/database');
      await db.query('SELECT 1');
      return { status: 'ok', message: 'Database connection successful' };
    } catch (error) {
      if (config.GRACEFUL_DB_FAILURE) {
        return { 
          status: 'warning', 
          message: `Database connection failed but graceful failure enabled: ${error.message}` 
        };
      }
      return { 
        status: 'error', 
        message: `Database connection failed: ${error.message}` 
      };
    }
  });

  // Python Service connectivity + LangGraph / LLM readiness (no LLM API calls)
  validator.addCheck('Python Service Connection', async () => {
    try {
      const axios = require('axios');
      const { data } = await axios.get(`${config.PYTHON_SERVICE_URL}/health`, { timeout: 5000 });
      const agent = data?.agent || {};
      const bits = [`Python service OK at ${config.PYTHON_SERVICE_URL}`];
      if (agent.opportunityGraphReady === false) {
        bits.push('opportunity graph not initialized');
      }
      const wantLangGraph = String(process.env.ENABLE_LANGGRAPH_AGENT || '').toLowerCase() === 'true';
      if (wantLangGraph && agent.opportunityGraphReady === false) {
        return {
          status: 'warning',
          message: `${bits.join('; ')} — ENABLE_LANGGRAPH_AGENT is true but Opportunity graph is unavailable`
        };
      }
      const prov = agent.llmProviderConfigured;
      if (prov === 'grok' && !agent.grokKeyPresent) {
        return {
          status: 'warning',
          message: `${bits.join('; ')}; LLM_PROVIDER=grok but no GROK/XAI API key set on Python service`
        };
      }
      if (prov === 'openai' && !agent.openaiKeyPresent) {
        return {
          status: 'warning',
          message: `${bits.join('; ')}; LLM_PROVIDER=openai but no OPENAI_API_KEY set on Python service`
        };
      }
      return { status: 'ok', message: bits.join('; ') };
    } catch (error) {
      return { 
        status: 'warning', 
        message: `Python service unavailable at ${config.PYTHON_SERVICE_URL}: ${error.message}` 
      };
    }
  });

  // Memory check
  validator.addCheck('Memory Usage', async () => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    if (heapUsedMB > 512) {
      return { 
        status: 'warning', 
        message: `High memory usage: ${heapUsedMB}MB` 
      };
    }
    
    return { 
      status: 'ok', 
      message: `Memory usage: ${heapUsedMB}MB` 
    };
  });

  return validator;
};

module.exports = {
  StartupValidator,
  createCommonChecks
};