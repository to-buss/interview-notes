export const redisTopics = [
  {
    id: "redis-data-structures",
    title: "1. Core Data Structures",
    icon: "🗂️",
    subtopics: [
      {
        id: "strings-hashes",
        title: "Strings & Hashes",
        content: `String is the simplest Redis type — a binary-safe byte sequence up to 512MB. Used for counters, cached JSON, session tokens, idempotency keys, and feature flags.\n\nHash is a map of field → value stored under one key. Ideal for objects (user profile, order) where you want to read or update individual fields without fetching the whole value. More memory-efficient than storing a JSON string when you need partial access.\n\nKey difference: store an object as a JSON String when you always read it whole; store it as a Hash when you frequently read or update individual fields.\n\n**Interview Q: When would you use a Hash over a String for storing an object?**\nA: When you need to update individual fields atomically (HSET), read a subset of fields (HMGET), or when the object has many fields and you want to avoid deserialising the whole JSON just to update one field. Hash also allows HINCRBY on numeric fields (e.g. incrementing a balance) without a read-modify-write cycle.`,
        diagram: `
  String:
  key="session:abc123"  →  value="{ userId:42, role:ADMIN }"

  Hash:
  key="user:42"
    field "name"    → "Alice"
    field "email"   → "alice@example.com"
    field "balance" → "10050"
    field "status"  → "ACTIVE"

  HSET user:42 balance 10100   ← update one field, no JSON parse needed
  HGET user:42 balance         ← read one field`,
        code: `// Jedis (low-level) — all examples use var
try (var jedis = jedisPool.getResource()) {

    // String — cache a serialised object with TTL
    var json = objectMapper.writeValueAsString(order);
    jedis.setex("order:" + order.getId(), 300, json);   // TTL 300s

    // String — atomic counter (e.g. rate limiter)
    var count = jedis.incr("rate:user:42");
    if (count == 1) jedis.expire("rate:user:42", 60);   // first hit, set window
    if (count > 100) throw new RateLimitException();

    // Hash — store object fields individually
    var fields = Map.of(
        "name",    user.getName(),
        "email",   user.getEmail(),
        "balance", String.valueOf(user.getBalance()),
        "status",  user.getStatus().name()
    );
    jedis.hset("user:" + user.getId(), fields);

    // Hash — read a single field (no full deserialisation)
    var balance = jedis.hget("user:42", "balance");

    // Hash — increment a numeric field atomically
    var newBalance = jedis.hincrBy("user:42", "balance", 500L);

    // Hash — read multiple fields
    var values = jedis.hmget("user:42", "name", "email", "status");
}

// Spring Data Redis (higher level)
var ops = redisTemplate.opsForHash();
ops.put("user:42", "status", "SUSPENDED");
var status = ops.get("user:42", "status");`,
      },
      {
        id: "lists-sets",
        title: "Lists, Sets & Sorted Sets",
        content: `List is a doubly-linked list of strings. O(1) push/pop from both ends. Use for queues (LPUSH + BRPOP), recent activity feeds (LPUSH + LTRIM), and task queues. Not a replacement for Kafka — no consumer groups, no replay, no durability guarantees beyond AOF.\n\nSet is an unordered collection of unique strings. Use for membership checks (SISMEMBER O(1)), tags, deduplication, and set operations (SUNION, SINTER, SDIFF).\n\nSorted Set (ZSet) associates each member with a float score. Members are always sorted by score. Use for leaderboards, rate limiting with sliding windows, priority queues, and time-series indices (score = timestamp).\n\n**Interview Q: How would you implement a leaderboard with Redis?**\nA: Use a Sorted Set. ZADD scores the member, ZREVRANK gets a player's rank (0-based, highest score first), ZREVRANGE returns the top-N. All O(log N). Updates are atomic — no read-modify-write needed.`,
        diagram: `
  List (queue pattern — LPUSH producer, BRPOP consumer):
  LPUSH jobs "job3"   →  [job3 | job2 | job1]
  BRPOP jobs 0        →  "job1"  (blocks until item available)

  Set:
  SADD tags:post:99  "redis" "java" "payments"
  SISMEMBER tags:post:99 "redis"  →  1 (true)
  SINTER tags:post:99 tags:post:42  →  common tags

  Sorted Set (leaderboard):
  ZADD leaderboard 9500 "alice"
  ZADD leaderboard 8200 "bob"
  ZADD leaderboard 9900 "carol"
  ZREVRANGE leaderboard 0 2 WITHSCORES
    → ["carol",9900, "alice",9500, "bob",8200]
  ZREVRANK leaderboard "alice"  →  1  (0-based, carol is 0)`,
        code: `try (var jedis = jedisPool.getResource()) {

    // List — simple job queue
    jedis.lpush("jobs:email", jobJson);

    // Consumer (blocking pop — waits up to 5s)
    var item = jedis.brpop(5, "jobs:email");
    if (item != null) processJob(item.get(1));

    // List — keep last 100 events per user (activity feed)
    var key = "feed:user:42";
    jedis.lpush(key, eventJson);
    jedis.ltrim(key, 0, 99);    // trim to newest 100

    // Set — idempotency check (process-once guarantee)
    var idempotencyKey = "processed:" + transactionId;
    var isNew = jedis.setnx(idempotencyKey, "1");  // 1 = first time, 0 = duplicate
    if (isNew == 0) return;                         // already processed
    jedis.expire(idempotencyKey, 86400);

    // Sorted Set — leaderboard
    jedis.zadd("leaderboard", 9500.0, "alice");
    var topThree = jedis.zrevrangeWithScores("leaderboard", 0, 2);
    var aliceRank = jedis.zrevrank("leaderboard", "alice"); // 0-based

    // Sorted Set — sliding window rate limiter (score = timestamp ms)
    var now = System.currentTimeMillis();
    var windowKey = "ratelimit:user:42";
    jedis.zadd(windowKey, now, UUID.randomUUID().toString()); // add this request
    jedis.zremrangeByScore(windowKey, 0, now - 60_000);      // remove older than 1min
    var requestsInWindow = jedis.zcard(windowKey);
    if (requestsInWindow > 100) throw new RateLimitException();
    jedis.expire(windowKey, 60);
}`,
      },
      {
        id: "streams",
        title: "Redis Streams",
        content: `Redis Streams (Redis 5+) is a persistent, append-only log — similar to Kafka topics but simpler. Each entry has a unique auto-generated ID (timestamp-sequence, e.g. 1699000000000-0) and a set of field-value pairs.\n\nKey features:\n• Consumer Groups — multiple consumers share work. Each message is delivered to one consumer in the group. Unacknowledged messages are re-delivered. Kafka-like semantics without Kafka's operational overhead.\n• XACK — consumer explicitly acknowledges a message once processed.\n• XPENDING — lists messages delivered but not yet acknowledged (monitor stuck consumers).\n• Persistence — entries survive restarts if AOF/RDB is enabled.\n\nWhen to use Redis Streams vs Kafka:\n• Redis Streams — low-to-medium throughput, simple fan-out, acceptable to lose data on Redis failure, want low operational overhead.\n• Kafka — high throughput, long retention, replay from any offset, multi-datacenter replication, exactly-once semantics.\n\n**Interview Q: What happens to unacknowledged Redis Stream messages if a consumer crashes?**\nA: They stay in the PEL (Pending Entry List) for the consumer group. Another consumer (or the same one after restart) can claim them with XCLAIM after a timeout. XAUTOCLAIM (Redis 6.2) does this automatically.`,
        diagram: `
  Stream "payments":
  ID                  fields
  1699000000000-0  →  { amount:"500", currency:"EUR", userId:"42" }
  1699000000001-0  →  { amount:"200", currency:"GBP", userId:"99" }
  1699000000002-0  →  { amount:"750", currency:"EUR", userId:"42" }

  Consumer Group "payment-processor":
  Consumer A  →  reads 1699000000000-0  →  XACK  ✅
  Consumer B  →  reads 1699000000001-0  →  (crash — no XACK)
                                             ↑
                          stays in PEL → re-claimed after idle timeout`,
        code: `try (var jedis = jedisPool.getResource()) {

    // Producer — append to stream
    var fields = Map.of("amount", "500", "currency", "EUR", "userId", "42");
    var entryId = jedis.xadd("payments", StreamEntryID.ASTERISK, fields); // auto ID

    // Create consumer group (read from beginning with "0", or latest with "$")
    jedis.xgroupCreate("payments", "payment-processor", new StreamEntryID("0"), true);

    // Consumer — read up to 10 undelivered messages, block 2s if empty
    var groupRead = new XReadGroupParams().count(10).block(2000);
    var messages = jedis.xreadGroup(
        "payment-processor", "consumer-A",
        Map.of("payments", StreamEntryID.UNRECEIVED_ENTRY),
        groupRead
    );

    if (messages != null) {
        for (var stream : messages) {
            for (var entry : stream.getValue()) {
                try {
                    processPayment(entry.getFields());
                    jedis.xack("payments", "payment-processor", entry.getID()); // ack
                } catch (Exception e) {
                    // don't ack — message stays in PEL for retry
                    log.warn("Processing failed for {}", entry.getID());
                }
            }
        }
    }

    // Check pending (unacknowledged) messages
    var pending = jedis.xpending("payments", "payment-processor",
        XPendingParams.params().count(10));
    pending.forEach(p -> log.info("Pending: id={} consumer={} idle={}ms",
        p.getID(), p.getConsumerName(), p.getIdleTime()));

    // Trim stream to last 1000 entries (prevent unbounded growth)
    jedis.xtrim("payments", 1000, false);
}`,
      },
    ],
  },
  {
    id: "redis-caching",
    title: "2. Caching Patterns",
    icon: "⚡",
    subtopics: [
      {
        id: "cache-aside",
        title: "Cache-Aside (Lazy Loading)",
        content: `Cache-aside is the most common caching pattern. The application manages the cache explicitly: on a read, check the cache first; on a miss, load from the DB and populate the cache.\n\nAdvantages: only requested data is cached (no wasted memory). Cache can tolerate failures — fall back to DB.\nDisadvantages: cache miss adds latency (two round trips: Redis miss + DB read). Risk of stale data if DB is updated without invalidating the cache.\n\nStale data mitigation:\n• Short TTL — accept slight staleness, data auto-expires.\n• Cache invalidation on write — delete the cache key whenever the DB record changes.\n• Write-through — update cache and DB together on every write (see next subtopic).\n\n**Interview Q: What is a cache stampede and how do you prevent it?**\nA: A cache stampede (thundering herd) happens when a hot key expires and many concurrent requests all get a cache miss simultaneously, all hitting the DB at once. Prevention: (1) Probabilistic early expiration — refresh the cache slightly before it expires. (2) Mutex/lock — only one thread fetches from DB; others wait. (3) Background refresh — a scheduler refreshes hot keys before they expire, so the key is never cold.`,
        diagram: `
  Cache-Aside read flow:
  App ──► Redis GET "order:42" ──► HIT  → return cached value
                                   │
                                  MISS
                                   │
                              App ──► DB SELECT order WHERE id=42
                                   │
                              App ──► Redis SETEX "order:42" 300 <value>
                                   │
                              return value to caller

  Cache invalidation on write:
  App writes order to DB
       └──► Redis DEL "order:42"   ← invalidate, NOT update
            (next read will re-populate from DB)`,
        code: `@Service
public class OrderService {

    private final OrderRepository db;
    private final RedisTemplate<String, Order> redis;
    private static final Duration TTL = Duration.ofMinutes(5);

    public Order getOrder(String orderId) {
        var key = "order:" + orderId;
        var ops = redis.opsForValue();

        // 1. Check cache
        var cached = ops.get(key);
        if (cached != null) return cached;

        // 2. Cache miss — load from DB
        var order = db.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));

        // 3. Populate cache
        ops.set(key, order, TTL);
        return order;
    }

    public Order updateOrder(String orderId, OrderUpdate update) {
        var updated = db.update(orderId, update);

        // Invalidate — do NOT write to cache here (avoids race conditions)
        redis.delete("order:" + orderId);
        return updated;
    }

    // Preventing stampede with a simple mutex
    public Order getOrderWithLock(String orderId) {
        var key     = "order:" + orderId;
        var lockKey = "lock:order:" + orderId;
        var ops     = redis.opsForValue();

        var cached = ops.get(key);
        if (cached != null) return cached;

        // Try to acquire lock (SET NX EX)
        var acquired = ops.setIfAbsent(lockKey, "1", Duration.ofSeconds(5));
        if (Boolean.TRUE.equals(acquired)) {
            try {
                var order = db.findById(orderId).orElseThrow();
                ops.set(key, order, TTL);
                return order;
            } finally {
                redis.delete(lockKey);
            }
        }
        // Another thread is loading — brief wait then retry
        Thread.sleep(50);
        return getOrderWithLock(orderId);
    }
}`,
      },
      {
        id: "write-through",
        title: "Write-Through & Write-Behind",
        content: `Write-Through: every write goes to both the cache and the DB synchronously before returning to the caller. Cache is always warm and consistent.\nAdvantage: reads always hit cache (no cold misses after first write). No stale data.\nDisadvantage: write latency increases (two writes per operation). Data that is written but never read wastes cache memory.\n\nWrite-Behind (Write-Back): writes go to cache immediately, DB write is async (queued). Ultra-low write latency.\nAdvantage: batching DB writes reduces DB load.\nDisadvantage: risk of data loss if Redis crashes before the async write flushes. Only suitable where some data loss is tolerable (e.g. analytics, counters — not financial transactions).\n\nEviction policies (set via maxmemory-policy):\n• allkeys-lru — evict least recently used key from all keys. Good general default.\n• volatile-lru — LRU but only among keys with TTL set.\n• allkeys-lfu — evict least frequently used (better for skewed access).\n• noeviction — return OOM error when memory is full. Use when cache data must not be lost.\n\n**Interview Q: Which eviction policy would you use for a payment session cache?**\nA: volatile-lru or volatile-ttl — sessions always have a TTL, so only TTL-bearing keys are evicted. This prevents evicting non-session data (e.g. config) while still freeing memory from old sessions.`,
        diagram: `
  Write-Through:
  App ──WRITE──► Redis SET key value   ┐
              ──WRITE──► DB INSERT     ┘  both synchronous
  Response to caller only after both succeed

  Write-Behind:
  App ──WRITE──► Redis SET key value  ← immediate response
                      │
              async queue
                      │
              DB INSERT (batched, ~100ms–1s later)
              ⚠️ crash here = data loss

  Eviction (maxmemory reached):
  allkeys-lru: evict the key that was least recently accessed
  volatile-lru: same, but only keys with expiry set
  noeviction:  reject writes — returns OOM error to client`,
        code: `// Write-Through with Spring Data Redis
@Service
public class SessionService {

    private final SessionRepository db;
    private final RedisTemplate<String, Session> redis;

    // Write-through: update both atomically
    public Session updateSession(String sessionId, Session updated) {
        // Write to DB first (source of truth)
        var saved = db.save(updated);

        // Immediately update cache — caller sees fresh data on next GET
        var key = "session:" + sessionId;
        redis.opsForValue().set(key, saved, Duration.ofMinutes(30));
        return saved;
    }
}

// Redis maxmemory config (redis.conf)
// maxmemory 2gb
// maxmemory-policy allkeys-lru

// Spring Boot config (application.yml)
// spring:
//   data:
//     redis:
//       host: localhost
//       port: 6379
//   cache:
//     redis:
//       time-to-live: 300000   # 5 min default TTL

// @Cacheable — Spring-managed cache-aside
@Cacheable(value = "portfolios", key = "#portfolioId")
public Portfolio getPortfolio(String portfolioId) {
    return portfolioRepo.findById(portfolioId).orElseThrow();
}

@CacheEvict(value = "portfolios", key = "#portfolio.id")
public Portfolio updatePortfolio(Portfolio portfolio) {
    return portfolioRepo.save(portfolio);
}

@CachePut(value = "portfolios", key = "#result.id")   // write-through
public Portfolio createPortfolio(Portfolio portfolio) {
    return portfolioRepo.save(portfolio);
}`,
      },
      {
        id: "ttl-eviction",
        title: "TTL, Keyspace & Expiry Patterns",
        content: `TTL (Time To Live) tells Redis to automatically delete a key after N seconds. Essential for session management, rate limiting, and cache entries.\n\nExpiry commands:\n• EXPIRE key seconds — set TTL on existing key\n• SETEX key seconds value — set value + TTL atomically (preferred over SET + EXPIRE)\n• PEXPIRE / PSETEX — millisecond precision\n• PERSIST key — remove TTL (make key permanent)\n• TTL key — returns remaining seconds (-1 = no TTL, -2 = key doesn't exist)\n\nKeyspace notifications: Redis can publish events to Pub/Sub channels when keys expire, are deleted, or are modified. Useful for triggering downstream logic when a session expires or a lock is released. Enable with notify-keyspace-events Ex in redis.conf.\n\n**Interview Q: Why should you use SETEX instead of SET followed by EXPIRE?**\nA: SET + EXPIRE are two separate commands. If the process crashes between them, the key is set but has no TTL — it lives forever, leaking memory. SETEX is atomic — both the value and the TTL are set in a single command, so there is no window for a partial state.`,
        diagram: `
  Key lifecycle:
  SETEX "session:abc" 1800 "{...}"
       │
       │  1800 seconds pass
       ▼
  Key auto-deleted by Redis

  TTL key → 1800  (just set)
  TTL key → 450   (75% through)
  TTL key → -2    (expired / deleted)
  TTL key → -1    (no TTL — permanent)

  Keyspace notification on expiry:
  notify-keyspace-events Ex
  Subscribe to: __keyevent@0__:expired
       → receives "session:abc" when it expires
       → trigger: clean up associated resources`,
        code: `try (var jedis = jedisPool.getResource()) {

    // Atomic set + TTL (preferred)
    jedis.setex("session:abc123", 1800, sessionJson);

    // Check remaining TTL
    var remaining = jedis.ttl("session:abc123");
    if (remaining < 300) {
        // Extend session on activity (sliding expiry)
        jedis.expire("session:abc123", 1800);
    }

    // Conditional set — only if key does NOT exist (idempotency key)
    var params = new SetParams().nx().ex(86400);   // NX = only if absent, EX = TTL
    var result = jedis.set("idempotency:" + txId, "1", params);
    if (!"OK".equals(result)) throw new DuplicateRequestException();

    // GETDEL — atomic get and delete (one-time token)
    var token = jedis.getdel("otp:" + userId);
    if (token == null) throw new InvalidTokenException();
}

// Keyspace notification listener (Spring)
@Component
public class SessionExpiryListener implements MessageListener {

    @Override
    public void onMessage(Message message, byte[] pattern) {
        var expiredKey = new String(message.getBody()); // e.g. "session:abc123"
        var sessionId = expiredKey.replace("session:", "");
        auditService.recordSessionExpiry(sessionId);
        log.info("Session expired: {}", sessionId);
    }
}

// Register the listener in config
@Bean
RedisMessageListenerContainer listenerContainer(RedisConnectionFactory cf,
                                                 SessionExpiryListener listener) {
    var container = new RedisMessageListenerContainer();
    container.setConnectionFactory(cf);
    container.addMessageListener(listener,
        new PatternTopic("__keyevent@0__:expired"));
    return container;
}`,
      },
    ],
  },
  {
    id: "redis-advanced",
    title: "3. Advanced Features",
    icon: "🔬",
    subtopics: [
      {
        id: "distributed-locks",
        title: "Distributed Locks",
        content: `A distributed lock prevents multiple instances of a service from executing a critical section simultaneously — e.g. prevent double-processing a payment, prevent concurrent rebalance jobs.\n\nSimple lock with SET NX EX:\n• SET lock:resource clientId NX EX 30 — acquire lock (NX = only if absent, EX = auto-expire)\n• DEL lock:resource — release lock\n• Problem: the DEL must only happen if the current process still holds the lock. Use a Lua script for atomic check-and-delete.\n\nRedlock algorithm (multi-node):\n• Acquire lock on N/2+1 Redis nodes within a time window. If majority acquired, lock is held. Handles single-node failures.\n• Controversial: Martin Kleppmann argued Redlock is unsafe under clock drift and GC pauses. Use Redisson (Java library) which implements safer fencing tokens.\n\n**Interview Q: What's the danger of a plain DEL to release a lock?**\nA: If process A's lock TTL expires (due to GC pause or slow processing), Redis auto-deletes the key. Process B then acquires the lock. When process A resumes, its DEL deletes B's lock. A Lua script (GET + DEL only if value matches our client ID) makes release atomic and ownership-checked.`,
        diagram: `
  Correct lock lifecycle:
  Process A: SET lock:payment:42 "client-A" NX EX 30  → OK (acquired)
  Process B: SET lock:payment:42 "client-B" NX EX 30  → nil (rejected)
  Process A: [Lua] GET + DEL if value == "client-A"    → released

  Danger — naive DEL:
  Process A: SET lock NX EX 5   → acquired
  [5s pass — GC pause in A, lock expires]
  Process B: SET lock NX EX 5   → acquired  ← B now holds lock
  Process A: DEL lock           → deletes B's lock ❌ ← A just broke B's lock

  Redlock (5 nodes, majority quorum):
  A acquires on nodes: 1 ✅  2 ✅  3 ✅  4 ✗  5 ✗
  Majority (3/5) acquired within 10ms → lock valid`,
        code: `// Option 1: Manual lock with Lua script (Jedis)
private static final String RELEASE_LUA = """
    if redis.call('get', KEYS[1]) == ARGV[1]
    then return redis.call('del', KEYS[1])
    else return 0 end
    """;

public boolean acquireLock(String resource, String clientId, int ttlSeconds) {
    try (var jedis = jedisPool.getResource()) {
        var params = new SetParams().nx().ex(ttlSeconds);
        var result = jedis.set("lock:" + resource, clientId, params);
        return "OK".equals(result);
    }
}

public void releaseLock(String resource, String clientId) {
    try (var jedis = jedisPool.getResource()) {
        jedis.eval(RELEASE_LUA,
            List.of("lock:" + resource),
            List.of(clientId));
    }
}

// Usage
var lockId = UUID.randomUUID().toString();
if (!acquireLock("payment:42", lockId, 30)) {
    throw new LockNotAcquiredException("Another process is handling payment 42");
}
try {
    processPayment("42");
} finally {
    releaseLock("payment:42", lockId);
}

// Option 2: Redisson (recommended for production)
var config = new Config();
config.useSingleServer().setAddress("redis://localhost:6379");
var redisson = Redisson.create(config);

var lock = redisson.getLock("lock:payment:42");
try {
    if (lock.tryLock(5, 30, TimeUnit.SECONDS)) { // wait 5s, hold 30s
        processPayment("42");
    }
} finally {
    if (lock.isHeldByCurrentThread()) lock.unlock();
}`,
      },
      {
        id: "pubsub-pipeline",
        title: "Pub/Sub & Pipelining",
        content: `Pub/Sub: publishers send messages to a channel; all subscribers receive every message. Fire-and-forget — no persistence, no consumer groups, no replay. If a subscriber is offline, the message is lost.\n\nUse cases: live notifications, cache invalidation broadcasts, presence/heartbeat signals. Not suitable for durable messaging — use Redis Streams or Kafka for that.\n\nPipelining: batch multiple commands into a single network round-trip. Instead of sending command → wait for reply → send next command, pipeline buffers all commands and sends them together. Replies come back in order. Dramatically reduces latency for bulk operations (e.g. warming a cache with 10,000 keys).\n\nTransaction (MULTI/EXEC): queues commands and executes them atomically. No other client can interleave commands within a MULTI/EXEC block. Note: Redis transactions do NOT roll back on error — if one command fails, the others still execute. For rollback semantics, use Lua scripts.\n\n**Interview Q: What is the difference between Redis Pub/Sub and Redis Streams?**\nA: Pub/Sub is ephemeral — messages are delivered only to currently connected subscribers and are never stored. Streams are persistent — messages are stored in the log and can be replayed from any offset. Streams support consumer groups (each message delivered to one consumer), XACK, and XPENDING. Use Pub/Sub for transient real-time notifications; use Streams when you need durability, at-least-once delivery, or consumer groups.`,
        diagram: `
  Pub/Sub:
  Publisher ──PUBLISH notifications "msg"──► Redis
                                               │  fan-out to all subscribers
                                    ┌──────────┼──────────┐
                                    ▼          ▼          ▼
                                Subscriber1  Sub2       Sub3
  ⚠️ Sub4 joins AFTER publish → misses "msg" entirely

  Pipelining (3 commands, 1 round-trip):
  Without pipeline:  [cmd1]→[rtt]→[cmd2]→[rtt]→[cmd3]→[rtt]  3 RTTs
  With pipeline:     [cmd1|cmd2|cmd3]──────────►[r1|r2|r3]    1 RTT`,
        code: `// Pub/Sub publisher
try (var jedis = jedisPool.getResource()) {
    var recipients = jedis.publish("notifications:user:42", messageJson);
    log.info("Delivered to {} subscribers", recipients);
}

// Pub/Sub subscriber (runs in its own thread)
try (var subscriber = jedisPool.getResource()) {
    subscriber.subscribe(new JedisPubSub() {
        @Override
        public void onMessage(String channel, String message) {
            var notification = objectMapper.readValue(message, Notification.class);
            notificationHandler.handle(notification);
        }
    }, "notifications:user:42");   // blocks until unsubscribed
}

// Pipelining — bulk cache warm-up
try (var jedis = jedisPool.getResource()) {
    var orders = orderRepo.findAll();

    var pipeline = jedis.pipelined();
    for (var order : orders) {
        var json = objectMapper.writeValueAsString(order);
        pipeline.setex("order:" + order.getId(), 300, json);
    }
    var responses = pipeline.syncAndReturnAll();  // single round-trip
    log.info("Cached {} orders", responses.size());
}

// Transaction (MULTI/EXEC) — atomic debit + credit
try (var jedis = jedisPool.getResource()) {
    jedis.watch("balance:alice", "balance:bob");   // optimistic lock

    var aliceBal = Long.parseLong(jedis.get("balance:alice"));
    if (aliceBal < 100) { jedis.unwatch(); throw new InsufficientFundsException(); }

    var tx = jedis.multi();
    tx.decrBy("balance:alice", 100);
    tx.incrBy("balance:bob",   100);
    var results = tx.exec();   // null if WATCH detected concurrent modification
    if (results == null) throw new ConcurrentModificationException("Retry transfer");
}`,
      },
      {
        id: "lua-scripts",
        title: "Lua Scripts & Atomic Operations",
        content: `Lua scripts run inside Redis atomically — no other client can execute commands while a script runs. This gives you multi-step atomic operations without MULTI/EXEC limitations.\n\nAdvantages over MULTI/EXEC:\n• Conditional logic — can read a value and decide what to write based on it.\n• Rollback semantics — if the script errors mid-way, changes already made within the script are NOT rolled back (Redis Lua is not transactional in the DB sense), but the script runs without interference from other clients.\n• Performance — one round-trip for complex operations.\n\nEVALSHA: load a script once with SCRIPT LOAD, get back a SHA. Execute it repeatedly with EVALSHA — no need to re-send the script body each time.\n\n**Interview Q: When would you use a Lua script over a pipeline?**\nA: When you need conditional logic (read-then-write based on current value) or when the operation must be atomic (no other client can see intermediate state). A pipeline just batches commands but doesn't make them atomic — another client can interleave between them. Examples: compare-and-swap on a balance, rate limiter with a check-and-increment, lock release with ownership check.`,
        diagram: `
  Lua script — atomic compare-and-swap:
  Script: GET key → if value == expected → SET key newValue → return 1
          else → return 0
  Entire script runs without interruption from other clients.

  MULTI/EXEC limitation (no conditional logic):
  MULTI
    GET balance:alice     ← queued, not executed yet
    IF balance > 100 ...  ← IMPOSSIBLE — you can't read mid-transaction
  EXEC

  Lua workaround:
  local bal = tonumber(redis.call('GET', KEYS[1]))
  if bal >= tonumber(ARGV[1]) then
    redis.call('DECRBY', KEYS[1], ARGV[1])
    return 1
  end
  return 0`,
        code: `// Atomic rate limiter using Lua
private static final String RATE_LIMIT_LUA = """
    local key     = KEYS[1]
    local limit   = tonumber(ARGV[1])
    local window  = tonumber(ARGV[2])
    local current = redis.call('INCR', key)
    if current == 1 then
        redis.call('EXPIRE', key, window)
    end
    if current > limit then
        return 0
    end
    return 1
    """;

public boolean allowRequest(String userId) {
    try (var jedis = jedisPool.getResource()) {
        var key    = "rate:" + userId;
        var result = (Long) jedis.eval(RATE_LIMIT_LUA,
            List.of(key),
            List.of("100", "60"));   // 100 req / 60s
        return result == 1L;
    }
}

// Load script once, call by SHA (faster — no script transfer per call)
String sha;
try (var jedis = jedisPool.getResource()) {
    sha = jedis.scriptLoad(RATE_LIMIT_LUA);
}

public boolean allowRequestFast(String userId) {
    try (var jedis = jedisPool.getResource()) {
        var result = (Long) jedis.evalsha(sha,
            List.of("rate:" + userId),
            List.of("100", "60"));
        return result == 1L;
    }
}

// Atomic stock reservation (compare-and-decrement)
private static final String RESERVE_LUA = """
    local stock = tonumber(redis.call('GET', KEYS[1]))
    if stock == nil or stock < tonumber(ARGV[1]) then
        return -1
    end
    return redis.call('DECRBY', KEYS[1], ARGV[1])
    """;

public long reserveStock(String productId, int quantity) {
    try (var jedis = jedisPool.getResource()) {
        var remaining = (Long) jedis.eval(RESERVE_LUA,
            List.of("stock:" + productId),
            List.of(String.valueOf(quantity)));
        if (remaining == -1) throw new InsufficientStockException(productId);
        return remaining;
    }
}`,
      },
    ],
  },
  {
    id: "redis-production",
    title: "4. Reliability & Production",
    icon: "🏭",
    subtopics: [
      {
        id: "persistence",
        title: "Persistence: RDB vs AOF",
        content: `Redis offers two persistence mechanisms:\n\nRDB (Redis Database) — point-in-time snapshots. Redis forks and writes the entire dataset to an rdb file periodically. Fast restart (loads snapshot). Low I/O overhead during normal operation. Risk: data written after the last snapshot is lost on crash.\n\nAOF (Append-Only File) — logs every write command. On restart, Redis replays the AOF to reconstruct state. More durable than RDB. Three fsync policies:\n• always — fsync after every write. Safest, slowest.\n• everysec (default) — fsync every second. At most 1 second of data loss.\n• no — OS decides when to fsync. Fast but risky.\n\nAOF rewrite: AOF grows indefinitely. Redis compacts it by rewriting the minimal set of commands to reproduce current state (BGREWRITEAOF).\n\nBest practice for production: use both — RDB for fast restarts, AOF for durability. Set appendfsync everysec.\n\n**Interview Q: If Redis is used only as a cache, do you need persistence?**\nA: Usually no — a cache can be cold-started and warmed up from the DB. Enabling persistence adds I/O overhead and larger disk footprint. However, if cache warm-up takes a long time (e.g. expensive aggregations) or if the cache absorbs read load that would overwhelm the DB on restart, RDB snapshots can be worthwhile to speed up recovery.`,
        diagram: `
  RDB snapshot (every 60s if 1000 keys changed):
  t=0s   Redis writes rdb file ──────────────────► dump.rdb
  t=30s  writes: [w1..w500]
  t=60s  Redis forks → writes rdb  ──────────────► dump.rdb (updated)
  t=65s  CRASH
  Recovery: load dump.rdb → lose 5s of w501..w600 ⚠️

  AOF (appendfsync everysec):
  write cmd ──► AOF buffer ──► fsync to appendonly.aof (every 1s)
  CRASH: lose at most 1 second of writes

  Both enabled (recommended):
  Restart sequence:
    1. Load AOF (more complete)    ← Redis prefers AOF if both present
    2. Fall back to RDB if no AOF`,
        code: `# redis.conf — recommended production persistence
save 3600 1       # RDB: snapshot if 1+ key changed in 1hr
save 300  100     # RDB: snapshot if 100+ keys changed in 5min
save 60   10000   # RDB: snapshot if 10k+ keys changed in 1min

appendonly yes
appendfsync everysec       # safe default: at most 1s data loss
auto-aof-rewrite-percentage 100   # rewrite when AOF doubles in size
auto-aof-rewrite-min-size 64mb

# Java: check last RDB save time to verify persistence is working
try (var jedis = jedisPool.getResource()) {
    var info = jedis.info("persistence");
    var lastSave = jedis.lastsave();
    var ageSeconds = Instant.now().getEpochSecond() - lastSave;
    if (ageSeconds > 7200) {
        alertService.warn("RDB snapshot is {}s old — check Redis persistence", ageSeconds);
    }

    // Trigger manual snapshot
    var status = jedis.bgsave();
    log.info("BGSave status: {}", status);

    // Trigger AOF rewrite (compact the file)
    jedis.bgrewriteaof();
}`,
      },
      {
        id: "high-availability",
        title: "Sentinel vs Cluster",
        content: `Redis Sentinel provides high availability for a single-shard deployment. Sentinels monitor the master and replicas. If the master fails, Sentinels vote and promote a replica. Clients connect to Sentinel to discover the current master address.\n\nSuitable for: datasets that fit on one machine. Simple setup. Automatic failover.\nLimitation: single master is the write bottleneck. Does not shard data.\n\nRedis Cluster shards data across multiple masters using hash slots (16,384 total). Each master owns a range of slots. Each master has replicas. Provides both horizontal scaling and HA.\n\nCluster key routing: clients hash the key (CRC16 mod 16384) to find the correct slot and master. JedisCluster / Lettuce do this automatically.\n\nHash tags: force related keys to the same slot by wrapping the common part in {}: e.g. {user:42}:session and {user:42}:cart always land on the same shard — enabling multi-key operations.\n\n**Interview Q: What happens during a Redis Cluster failover?**\nA: The replicas of the failed master detect the failure. They vote among themselves; if quorum is reached, one promotes itself to master and takes over the hash slots. Clients get MOVED or ASK errors during the transition, which trigger a slot map refresh. Typically completes in a few seconds. Writes to the failed master during the window are lost unless AOF was enabled.`,
        diagram: `
  Sentinel (single shard, HA):
  ┌──────────┐  replication  ┌──────────┐
  │  Master  │──────────────►│ Replica1 │
  └──────────┘               └──────────┘
       │                     ┌──────────┐
       └────────────────────►│ Replica2 │
                             └──────────┘
  [Sentinel1] [Sentinel2] [Sentinel3]  ← monitor, vote, promote

  Cluster (sharded, HA):
  Slots 0-5460      Slots 5461-10922   Slots 10923-16383
  [Master A] ──►R   [Master B] ──►R   [Master C] ──►R
  key="order:42" → CRC16("order:42") % 16384 = 7638 → Master B

  Hash tag — force co-location:
  {user:42}:session  ─┐
  {user:42}:cart     ─┤  hash slot of "user:42" → same master
  {user:42}:prefs    ─┘  ← MGET across all three works in cluster`,
        code: `// Sentinel client (Jedis)
var sentinelAddresses = Set.of(
    "sentinel1:26379",
    "sentinel2:26379",
    "sentinel3:26379"
);
var pool = new JedisSentinelPool("mymaster", sentinelAddresses);
try (var jedis = pool.getResource()) {
    jedis.set("key", "value");   // always writes to current master
}

// Cluster client (Jedis)
var nodes = Set.of(
    new HostAndPort("redis1", 7000),
    new HostAndPort("redis2", 7001),
    new HostAndPort("redis3", 7002)
);
var cluster = new JedisCluster(nodes);
cluster.set("order:42", orderJson);    // JedisCluster routes to correct shard

// Hash tags — multi-key ops on same shard
cluster.set("{user:42}:session", sessionJson);
cluster.set("{user:42}:cart",    cartJson);
var results = cluster.mget("{user:42}:session", "{user:42}:cart");  // works in cluster

// Spring Boot Cluster config (application.yml)
// spring:
//   data:
//     redis:
//       cluster:
//         nodes: redis1:7000,redis2:7001,redis3:7002
//         max-redirects: 3`,
      },
    ],
  },
  {
    id: "redis-interview",
    title: "5. Interview Q&A",
    icon: "🎯",
    subtopics: [
      {
        id: "redis-qa-fundamentals",
        title: "Fundamentals Q&A",
        content: `**Q: Is Redis single-threaded? How does it achieve high performance?**\nA: The main command processing is single-threaded (one thread handles all client commands). This eliminates lock contention and context switches. High performance comes from: all data in RAM (no disk I/O on reads), O(1) or O(log N) data structures, non-blocking I/O multiplexing (epoll/kqueue), and pipelining. In Redis 6+, I/O threads handle network reads/writes in parallel while command execution stays single-threaded.\n\n**Q: What is the difference between KEYS and SCAN?**\nA: KEYS pattern blocks the entire server for the duration of the scan — dangerous on large keyspaces (can block for seconds). SCAN is cursor-based and incremental: each call returns a cursor + a small batch of keys. Never completes in one call, but never blocks. Always use SCAN in production.\n\n**Q: What is Redis memory fragmentation and how do you fix it?**\nA: Fragmentation occurs when Redis allocates and frees many small chunks, leaving gaps in memory the allocator can't reuse. Reported as mem_fragmentation_ratio in INFO memory (> 1.5 is high). Fix: MEMORY PURGE (Redis 4+) triggers active defragmentation, or restart Redis (it compacts on startup). Configure activedefrag yes in redis.conf for automatic online defragmentation.\n\n**Q: How does Redis handle expired keys?**\nA: Two mechanisms. Lazy expiry: a key is checked and deleted when it is accessed. Active expiry: Redis randomly samples 20 keys with TTL every 100ms and deletes expired ones. If more than 25% of sampled keys are expired, it repeats immediately. This means expired keys can linger in memory briefly after their TTL — don't rely on exact expiry timing for critical logic.`,
        diagram: null,
        code: `// SCAN instead of KEYS (production safe)
try (var jedis = jedisPool.getResource()) {
    var cursor = ScanParams.SCAN_POINTER_START;
    var params = new ScanParams().match("session:*").count(100);

    do {
        var result = jedis.scan(cursor, params);
        cursor = result.getCursor();
        result.getResult().forEach(key -> process(key));
    } while (!cursor.equals(ScanParams.SCAN_POINTER_START)); // "0" = done
}

// Check memory fragmentation
try (var jedis = jedisPool.getResource()) {
    var info = jedis.info("memory");
    // Parse mem_fragmentation_ratio from info string
    // > 1.5 → high fragmentation, consider MEMORY PURGE
    jedis.memoryPurge();   // Redis 4+ — triggers active defrag
}

// INFO command — key metrics to know for interviews
// INFO server      → version, uptime
// INFO clients     → connected_clients, blocked_clients
// INFO memory      → used_memory, mem_fragmentation_ratio
// INFO stats       → total_commands_processed, keyspace_hits, keyspace_misses
// INFO replication → role (master/slave), connected_slaves, replication lag`,
      },
      {
        id: "redis-qa-payments",
        title: "Payments & Banking Q&A",
        content: `**Q: How would you implement idempotency for a payment API using Redis?**\nA: Use SET NX EX with the idempotency key from the request header. The key stores the response payload. On first call: key doesn't exist → process payment → store response in Redis (30-day TTL). On retry: key exists → return stored response immediately, skip processing. The response must be stored atomically after processing — use a Lua script or accept that a crash between processing and caching may cause a second execution (mitigate with DB-level idempotency check).\n\n**Q: How would you implement a distributed rate limiter using Redis?**\nA: Sliding window with Sorted Set: ZADD the current timestamp as both score and member (use UUID to avoid dedup), ZREMRANGEBYSCORE to remove entries older than the window, ZCARD to count. If count > limit, reject. Alternatively, use the fixed window counter with INCR + EXPIRE (simpler but allows 2x burst at window boundary). For multi-region, each region has its own counter — use a conservative limit per region.\n\n**Q: How would you use Redis to prevent double-spend in a payment system?**\nA: Combine a distributed lock (SET NX EX on the account ID) with a DB-level check. The lock ensures only one payment is in-flight per account at a time. Inside the lock: read balance from DB, validate, debit, release lock. For higher throughput, use optimistic locking with WATCH/MULTI/EXEC — abort if the balance changed since we read it.\n\n**Q: What are the risks of using Redis as a primary data store (not just cache)?**\nA: (1) Data loss on crash if persistence is misconfigured. (2) Memory-bound — all data must fit in RAM (expensive at scale). (3) No ACID transactions — MULTI/EXEC doesn't roll back on error. (4) Limited query capability — no ad-hoc queries, no joins. (5) Replication is asynchronous — a failover can lose the last few writes. Redis is suitable as primary store only for data where some loss is acceptable (sessions, rate limits) or where it is backed by a durable DB.`,
        diagram: null,
        code: `// Idempotency pattern for payment API
@PostMapping("/payments")
public ResponseEntity<PaymentResponse> createPayment(
    @RequestHeader("Idempotency-Key") String idempotencyKey,
    @RequestBody PaymentRequest request
) {
    var cacheKey = "idempotency:" + idempotencyKey;
    var ops = redis.opsForValue();

    // Check if already processed
    var cached = ops.get(cacheKey);
    if (cached != null) {
        return ResponseEntity.ok(cached);  // replay stored response
    }

    // Process payment
    var response = paymentService.process(request);

    // Store response — 30 days (idempotency window)
    ops.set(cacheKey, response, Duration.ofDays(30));
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
}

// Distributed rate limiter — fixed window
public boolean isAllowed(String clientId) {
    try (var jedis = jedisPool.getResource()) {
        var key   = "rate:" + clientId + ":" + (System.currentTimeMillis() / 60_000); // 1-min bucket
        var count = jedis.incr(key);
        if (count == 1) jedis.expire(key, 60);
        return count <= 1000;  // 1000 req/min
    }
}

// Double-spend prevention with lock
public PaymentResult processPayment(String accountId, BigDecimal amount) {
    var lockId  = UUID.randomUUID().toString();
    var lockKey = "lock:account:" + accountId;
    try (var jedis = jedisPool.getResource()) {
        var acquired = jedis.set(lockKey, lockId, new SetParams().nx().ex(10));
        if (!"OK".equals(acquired)) throw new AccountLockedException(accountId);
    }
    try {
        return accountService.debit(accountId, amount); // DB-level debit
    } finally {
        releaseLock(lockKey, lockId);
    }
}`,
      },
      {
        id: "redis-qa-architecture",
        title: "Architecture & Design Q&A",
        content: `**Q: When should you NOT use Redis?**\nA: (1) Data larger than available RAM. (2) Data requiring complex relational queries or joins. (3) Strong durability requirements with zero tolerance for data loss (use PostgreSQL). (4) Data that must survive a complete Redis cluster failure without a DB behind it. (5) Long-term analytics or reporting — use a data warehouse. Redis excels at ephemeral, fast-access data; it complements rather than replaces a relational DB.\n\n**Q: How do you handle a Redis failover with zero downtime in a Java Spring application?**\nA: Use Lettuce (default in Spring Data Redis) with Sentinel or Cluster auto-reconnect. Lettuce maintains a connection pool and automatically reconnects and re-discovers the master after a Sentinel failover. Add retry logic with exponential back-off for the brief window during promotion. Set timeout values: connect-timeout 500ms, command-timeout 1000ms. Circuit breaker (Resilience4j) around Redis calls prevents cascade failures if Redis is unavailable.\n\n**Q: What is the N+1 Redis problem and how do you avoid it?**\nA: The N+1 problem: loading a list of N items requires N+1 Redis calls (1 to get IDs, then 1 per ID). Fix: use MGET (fetch N string keys in one call), HMGET (fetch N fields from a hash), or a pipeline. For Sorted Set ranges, ZRANGE with WITHSCORES returns all members in one call. Avoid loops calling jedis.get() inside — always batch.\n\n**Q: How would you design a leaderboard for 100 million users with Redis?**\nA: Sorted Set is the natural fit — ZADD for score updates, ZREVRANK for a user's rank, ZREVRANGE for top-N. Problem at 100M users: memory (each entry ~64 bytes → ~6GB). Optimisations: (1) Sparse leaderboard — only store top-1M active users; others re-enter on next activity. (2) Shard by user segment or time period. (3) Use Redis Cluster to distribute across multiple nodes. (4) Pre-compute top-1000 leaderboard every 60s and cache as a List for cheap reads.`,
        diagram: null,
        code: `// Lettuce auto-reconnect with Sentinel (Spring Boot)
// application.yml:
// spring.data.redis.sentinel.master: mymaster
// spring.data.redis.sentinel.nodes: sentinel1:26379,sentinel2:26379,sentinel3:26379
// spring.data.redis.timeout: 1000ms
// spring.data.redis.lettuce.pool.max-active: 20

// Circuit breaker around Redis (Resilience4j)
@Bean
public CircuitBreaker redisCircuitBreaker(CircuitBreakerRegistry registry) {
    return registry.circuitBreaker("redis",
        CircuitBreakerConfig.custom()
            .failureRateThreshold(50)
            .waitDurationInOpenState(Duration.ofSeconds(10))
            .slidingWindowSize(10)
            .build());
}

// Avoid N+1 — batch with MGET
public Map<String, Order> getOrders(List<String> orderIds) {
    try (var jedis = jedisPool.getResource()) {
        var keys  = orderIds.stream().map(id -> "order:" + id).toArray(String[]::new);
        var jsons = jedis.mget(keys);   // 1 round-trip for all

        var result = new HashMap<String, Order>();
        for (int i = 0; i < orderIds.size(); i++) {
            if (jsons.get(i) != null) {
                result.put(orderIds.get(i),
                    objectMapper.readValue(jsons.get(i), Order.class));
            }
        }
        return result;
    }
}

// Leaderboard — core operations
try (var jedis = jedisPool.getResource()) {
    jedis.zadd("leaderboard:global", score, userId);           // update score
    var rank  = jedis.zrevrank("leaderboard:global", userId);  // 0-based rank
    var topTen = jedis.zrevrangeWithScores("leaderboard:global", 0, 9);
    topTen.forEach(e -> System.out.println(e.getElement() + ": " + e.getScore()));
}`,
      },
    ],
  },
];