/**
 * In-memory cache with TTL support for frequently accessed data.
 * Designed for MineCord's small user base (~10 users) with low write frequency.
 */

const DEFAULT_TTL = 30000; // 30 seconds default TTL
const MAX_CACHE_SIZE = 1000; // Prevent memory leaks

class Cache {
  constructor(options = {}) {
    this.ttl = options.ttl || DEFAULT_TTL;
    this.maxSize = options.maxSize || MAX_CACHE_SIZE;
    this.store = new Map();
    this.timers = new Map();
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
  }

  /**
   * Get a value from cache
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      const timer = this.timers.get(key);
      if (timer) clearTimeout(timer);
      this.timers.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache with optional custom TTL
   */
  set(key, value, ttl = this.ttl) {
    // Evict oldest entries if at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this._evictOldest();
    }

    const expiresAt = Date.now() + ttl;
    this.store.set(key, { value, expiresAt });

    // Clear existing timer if any
    const existingTimer = this.timers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    // Set expiration timer
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ttl);

    this.timers.set(key, timer);
    this.sets++;
    return value;
  }

  /**
   * Delete a key from cache
   */
  delete(key) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    return this.store.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.store.clear();
    this.timers.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%',
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
  }

  /**
   * Evict oldest entry (by expiration time)
   */
  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < oldestTime) {
        oldestTime = entry.expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      this.evictions++;
    }
  }

  /**
   * Get or set pattern - fetch from source if not in cache
   */
  async getOrSet(key, fetchFn, ttl) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const value = await fetchFn();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Invalidate keys matching a pattern
   */
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    let count = 0;
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }
}

// Cache instances for different data types
const userCache = new Cache({ ttl: 60000, maxSize: 200 }); // Users change infrequently
const serverCache = new Cache({ ttl: 60000, maxSize: 100 }); // Servers change infrequently
const channelCache = new Cache({ ttl: 60000, maxSize: 200 }); // Channels change infrequently
const messageCache = new Cache({ ttl: 10000, maxSize: 500 }); // Messages change more frequently
const friendCache = new Cache({ ttl: 30000, maxSize: 200 }); // Friends change occasionally
const activityCache = new Cache({ ttl: 5000, maxSize: 100 }); // Activity changes frequently

// Cache key generators
const keys = {
  user: (username) => `user:${username}`,
  userById: (id) => `user:id:${id}`,
  server: (serverId) => `server:${serverId}`,
  serverMembers: (serverId) => `server:members:${serverId}`,
  channel: (serverId, channelId) => `channel:${serverId}:${channelId}`,
  serverChannels: (serverId) => `server:channels:${serverId}`,
  messages: (scope, limit = 50) => `messages:${scope}:${limit}`,
  dmMessages: (userA, userB, limit = 50) => `dm:${userA}:${userB}:${limit}`,
  friends: (username) => `friends:${username}`,
  friendStatus: (userA, userB) => `friend:${userA}:${userB}`,
  activity: (username) => `activity:${username}`,
  onlineUsers: () => 'online:users',
  userServers: (username) => `user:servers:${username}`,
};

/**
 * Invalidate user-related caches
 */
function invalidateUserCaches(username, userId) {
  userCache.delete(keys.user(username));
  if (userId) userCache.delete(keys.userById(userId));
  friendCache.delete(keys.friends(username));
  activityCache.delete(keys.activity(username));
  serverCache.invalidatePattern(`server:members:.*${username}.*`);
}

/**
 * Invalidate server-related caches
 */
function invalidateServerCaches(serverId) {
  serverCache.delete(keys.server(serverId));
  serverCache.delete(keys.serverMembers(serverId));
  channelCache.delete(keys.serverChannels(serverId));
  // Invalidate message caches for this server's channels
  messageCache.invalidatePattern(`messages:${serverId}:`);
}

/**
 * Invalidate channel-related caches
 */
function invalidateChannelCaches(serverId, channelId) {
  channelCache.delete(keys.channel(serverId, channelId));
  channelCache.delete(keys.serverChannels(serverId));
  messageCache.delete(keys.messages(`${serverId}:${channelId}`));
  messageCache.delete(keys.messages(`${serverId}:${channelId}`, 50));
}

/**
 * Invalidate message caches for a scope
 */
function invalidateMessageCaches(scope) {
  messageCache.delete(keys.messages(scope));
  messageCache.delete(keys.messages(scope, 50));
}

/**
 * Invalidate DM-related caches
 */
function invalidateDMCaches(userA, userB) {
  const pair = [userA, userB].sort().join(':');
  messageCache.invalidatePattern(`dm:${pair}:`);
  friendCache.delete(keys.friends(userA));
  friendCache.delete(keys.friends(userB));
  friendCache.delete(keys.friendStatus(userA, userB));
}

/**
 * Get all cache statistics
 */
function getAllCacheStats() {
  return {
    user: userCache.getStats(),
    server: serverCache.getStats(),
    channel: channelCache.getStats(),
    message: messageCache.getStats(),
    friend: friendCache.getStats(),
    activity: activityCache.getStats(),
  };
}

/**
 * Reset all cache statistics
 */
function resetAllCacheStats() {
  userCache.resetStats();
  serverCache.resetStats();
  channelCache.resetStats();
  messageCache.resetStats();
  friendCache.resetStats();
  activityCache.resetStats();
}

module.exports = {
  Cache,
  userCache,
  serverCache,
  channelCache,
  messageCache,
  friendCache,
  activityCache,
  keys,
  invalidateUserCaches,
  invalidateServerCaches,
  invalidateChannelCaches,
  invalidateMessageCaches,
  invalidateDMCaches,
  getAllCacheStats,
  resetAllCacheStats,
};