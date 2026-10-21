/**
 * Performance monitoring for MineCord server.
 * Tracks request latencies, database query times, WebSocket events, and system metrics.
 */

const os = require('node:os');

class MetricsCollector {
  constructor(options = {}) {
    this.maxSamples = options.maxSamples || 1000;
    this.requestLatencies = [];
    this.dbQueryLatencies = [];
    this.wsEventLatencies = [];
    this.errors = [];
    this.counters = new Map();
    this.gauges = new Map();
    this.startTime = Date.now();
    this.requestCount = 0;
    this.dbQueryCount = 0;
    this.wsEventCount = 0;
    this.errorCount = 0;
  }

  /**
   * Record an HTTP request latency
   */
  recordRequest(method, path, statusCode, latencyMs) {
    this.requestCount++;
    this.requestLatencies.push({ method, path, statusCode, latencyMs, timestamp: Date.now() });
    if (this.requestLatencies.length > this.maxSamples) {
      this.requestLatencies.shift();
    }
    this.incrementCounter(`http.requests.${method}.${statusCode}`);
    this.incrementCounter(`http.requests.total`);
  }

  /**
   * Record a database query latency
   */
  recordDbQuery(queryType, latencyMs, success = true) {
    this.dbQueryCount++;
    this.dbQueryLatencies.push({ queryType, latencyMs, success, timestamp: Date.now() });
    if (this.dbQueryLatencies.length > this.maxSamples) {
      this.dbQueryLatencies.shift();
    }
    this.incrementCounter(`db.queries.${queryType}`);
    this.incrementCounter(`db.queries.total`);
    if (!success) this.incrementCounter(`db.queries.errors`);
  }

  /**
   * Record a WebSocket event latency
   */
  recordWsEvent(eventType, latencyMs, success = true) {
    this.wsEventCount++;
    this.wsEventLatencies.push({ eventType, latencyMs, success, timestamp: Date.now() });
    if (this.wsEventLatencies.length > this.maxSamples) {
      this.wsEventLatencies.shift();
    }
    this.incrementCounter(`ws.events.${eventType}`);
    this.incrementCounter(`ws.events.total`);
    if (!success) this.incrementCounter(`ws.events.errors`);
  }

  /**
   * Record an error
   */
  recordError(type, message, context = {}) {
    this.errorCount++;
    this.errors.push({ type, message, context, timestamp: Date.now() });
    if (this.errors.length > this.maxSamples) {
      this.errors.shift();
    }
    this.incrementCounter(`errors.${type}`);
    this.incrementCounter(`errors.total`);
  }

  /**
   * Increment a counter
   */
  incrementCounter(name, value = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name, value) {
    this.gauges.set(name, value);
  }

  /**
   * Get current system metrics
   */
  getSystemMetrics() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
      cpu: {
        user: cpu.user,
        system: cpu.system,
      },
      system: {
        totalMem: os.totalmem(),
        freeMem: os.freemem(),
        loadAvg: os.loadavg(),
        cpus: os.cpus().length,
      },
      eventLoop: this._getEventLoopLag(),
    };
  }

  /**
   * Estimate event loop lag
   */
  _getEventLoopLag() {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e6; // ms
      this.setGauge('eventLoop.lag', lag);
    });
    return this.gauges.get('eventLoop.lag') || 0;
  }

  /**
   * Calculate percentile from sorted array
   */
  _percentile(sortedValues, percentile) {
    if (!sortedValues.length) return 0;
    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * Get latency statistics for an array of samples
   */
  _getLatencyStats(samples, valueKey = 'latencyMs') {
    if (!samples.length) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    const values = samples.map(s => s[valueKey]).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      min: values[0],
      max: values[values.length - 1],
      mean: sum / values.length,
      p50: this._percentile(values, 0.5),
      p95: this._percentile(values, 0.95),
      p99: this._percentile(values, 0.99),
    };
  }

  /**
   * Get HTTP request latency stats
   */
  getRequestStats() {
    return this._getLatencyStats(this.requestLatencies);
  }

  /**
   * Get database query latency stats
   */
  getDbQueryStats() {
    return this._getLatencyStats(this.dbQueryLatencies);
  }

  /**
   * Get WebSocket event latency stats
   */
  getWsEventStats() {
    return this._getLatencyStats(this.wsEventLatencies);
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit = 50) {
    return this.errors.slice(-limit);
  }

  /**
   * Get all counters
   */
  getCounters() {
    return Object.fromEntries(this.counters);
  }

  /**
   * Get all gauges
   */
  getGauges() {
    return Object.fromEntries(this.gauges);
  }

  /**
   * Get comprehensive metrics summary
   */
  getSummary() {
    return {
      uptime: Date.now() - this.startTime,
      processUptime: process.uptime(),
      requests: this.getRequestStats(),
      dbQueries: this.getDbQueryStats(),
      wsEvents: this.getWsEventStats(),
      errors: {
        total: this.errorCount,
        recent: this.getRecentErrors(10),
      },
      counters: this.getCounters(),
      gauges: this.getGauges(),
      system: this.getSystemMetrics(),
      cache: this._getCacheStats(),
    };
  }

  _getCacheStats() {
    // Will be populated by cache module
    return {};
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.requestLatencies = [];
    this.dbQueryLatencies = [];
    this.wsEventLatencies = [];
    this.errors = [];
    this.counters.clear();
    this.gauges.clear();
    this.requestCount = 0;
    this.dbQueryCount = 0;
    this.wsEventCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
  }
}

// Singleton instance
const metrics = new MetricsCollector();

/**
 * Express middleware for request timing
 */
function requestTimingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordRequest(req.method, req.path, res.statusCode, latencyMs);
  });
  next();
}

/**
 * Wrap a database operation with timing
 */
function withDbTiming(queryType, fn) {
  const start = process.hrtime.bigint();
  try {
    const result = fn();
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordDbQuery(queryType, latencyMs, true);
    return result;
  } catch (error) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordDbQuery(queryType, latencyMs, false);
    throw error;
  }
}

/**
 * Wrap an async database operation with timing
 */
async function withDbTimingAsync(queryType, fn) {
  const start = process.hrtime.bigint();
  try {
    const result = await fn();
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordDbQuery(queryType, latencyMs, true);
    return result;
  } catch (error) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordDbQuery(queryType, latencyMs, false);
    throw error;
  }
}

/**
 * Wrap a WebSocket event handler with timing
 */
function withWsTiming(eventType, fn) {
  return (...args) => {
    const start = process.hrtime.bigint();
    try {
      const result = fn(...args);
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      metrics.recordWsEvent(eventType, latencyMs, true);
      return result;
    } catch (error) {
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      metrics.recordWsEvent(eventType, latencyMs, false);
      throw error;
    }
  };
}

/**
 * Wrap an async WebSocket event handler with timing
 */
function withWsTimingAsync(eventType, fn) {
  return async (...args) => {
    const start = process.hrtime.bigint();
    try {
      const result = await fn(...args);
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      metrics.recordWsEvent(eventType, latencyMs, true);
      return result;
    } catch (error) {
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      metrics.recordWsEvent(eventType, latencyMs, false);
      throw error;
    }
  };
}

/**
 * Update connection gauges
 */
function updateConnectionGauges(httpConnections, wsConnections, wsRooms, wsCalls) {
  metrics.setGauge('connections.http', httpConnections);
  metrics.setGauge('connections.ws', wsConnections);
  metrics.setGauge('voice.rooms', wsRooms);
  metrics.setGauge('voice.calls', wsCalls);
}

/**
 * Update cache gauges from cache module
 */
function updateCacheGauges(cacheStats) {
  for (const [cacheName, stats] of Object.entries(cacheStats)) {
    metrics.setGauge(`cache.${cacheName}.size`, stats.size);
    metrics.setGauge(`cache.${cacheName}.hitRate`, parseFloat(stats.hitRate) || 0);
  }
}

module.exports = {
  metrics,
  requestTimingMiddleware,
  withDbTiming,
  withDbTimingAsync,
  withWsTiming,
  withWsTimingAsync,
  updateConnectionGauges,
  updateCacheGauges,
};