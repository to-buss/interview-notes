export const topics = [
  {
    id: "memory",
    title: "1. Memory",
    icon: "🧠",
    subtopics: [
      {
        id: "heap-regions",
        title: "Heap Regions",
        content: `The JVM heap is divided into generations. Young Gen holds newly allocated objects and is collected frequently. Surviving objects are promoted to Old Gen (Tenured). Metaspace (Java 8+) replaced PermGen and holds class metadata — it grows dynamically and is not part of the heap.`,
        diagram: `
┌─────────────────────────────────────────────────────────┐
│                        JVM HEAP                         │
│  ┌──────────────────────────────┐  ┌──────────────────┐ │
│  │         Young Gen            │  │    Old Gen       │ │
│  │  ┌───────┐ ┌─────┐ ┌─────┐  │  │   (Tenured)      │ │
│  │  │ Eden  │ │ S0  │ │ S1  │  │──▶│                  │ │
│  │  │       │ │     │ │     │  │  │  Long-lived       │ │
│  │  └───────┘ └─────┘ └─────┘  │  │  objects         │ │
│  └──────────────────────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│              Metaspace (off-heap)                        │
│         Class metadata, static fields                    │
└─────────────────────────────────────────────────────────┘`,
        code: null,
      },
      {
        id: "stack-vs-heap",
        title: "Stack vs Heap",
        content: `Each thread has its own stack holding stack frames (local variables, method calls). Objects always live on the heap. Stack overflow = infinite recursion or a call stack that's too deep.`,
        diagram: null,
        code: `// Stack: holds primitives and references (not objects)
public void calculate() {
    int x = 5;           // x lives on THIS thread's stack
    String s = "hello";  // reference 's' on stack, String object on heap
    Object obj = new Object(); // obj ref on stack, Object on heap
}

// Stack overflow example
public int infinite(int n) {
    return infinite(n + 1); // StackOverflowError — no base case
}`,
      },
      {
        id: "jmm",
        title: "Java Memory Model (JMM)",
        content: `The JMM defines happens-before (HB) rules that guarantee memory visibility between threads:\n\n• Monitor unlock HB lock — releasing a lock flushes writes; acquiring reads fresh values\n• Volatile write HB read — a volatile write makes all prior writes visible to any subsequent reader\n• Thread.start() HB first action — parent thread's state is visible to the new thread\n• Thread.join() HB caller — child thread's writes are visible after join()`,
        diagram: null,
        code: `// Rule 1: Monitor unlock HB lock
int x = 0;
synchronized (lock) { x = 42; }   // UNLOCK
// --- another thread ---
synchronized (lock) {              // LOCK
    System.out.println(x);         // guaranteed to see 42
}

// Rule 2: Volatile write HB read
volatile boolean ready = false;
int data = 0;
// Thread A
data = 100;
ready = true;   // volatile WRITE
// Thread B
if (ready) use(data);   // sees data = 100

// Rule 3: Thread start HB first action
config = 99;
Thread t = new Thread(() -> use(config)); // sees 99
t.start();`,
      },
      {
        id: "off-heap",
        title: "Off-Heap Memory",
        content: `Off-heap memory lives outside the JVM heap — never touched by GC. Used by Kafka clients, Netty, and high-throughput banking apps. Must be explicitly freed. Two APIs: DirectByteBuffer (standard) and sun.misc.Unsafe (raw pointer arithmetic).`,
        diagram: null,
        code: `// DirectByteBuffer — standard API
ByteBuffer buf = ByteBuffer.allocateDirect(1024 * 1024); // 1 MB off-heap
buf.putInt(0, 42);
int val = buf.getInt(0);
// Released when ByteBuffer wrapper is GC'd (via Cleaner) — not immediate!

// Force immediate free (pre-Java 9)
((sun.nio.ch.DirectBuffer) buf).cleaner().clean();

// Unsafe — raw pointer arithmetic, no bounds checking
Unsafe unsafe = getUnsafe();
long address = unsafe.allocateMemory(1024);
unsafe.putLong(address, 0xDEADBEEFL);
long result = unsafe.getLong(address);
try {
    riskyOperation();
} finally {
    unsafe.freeMemory(address);  // MUST free — GC will never do this
}

// Common leak: exhausting direct memory
for (int i = 0; i < 100_000; i++) {
    ByteBuffer.allocateDirect(1024 * 1024); // OOM — GC too slow
}`,
      },
      {
        id: "memory-leaks",
        title: "Memory Leak Patterns",
        content: `Common patterns that cause memory leaks in Java:`,
        diagram: null,
        code: `// 1. Static collections holding references
static List<byte[]> cache = new ArrayList<>();
cache.add(new byte[1024 * 1024]); // never removed → lives forever

// 2. Unclosed streams/connections
InputStream in = new FileInputStream("data.txt");
// forgot in.close() → file descriptor + buffer leaked

// 3. ThreadLocal not removed in thread pools
static ThreadLocal<UserContext> ctx = new ThreadLocal<>();
ctx.set(new UserContext()); // thread is reused from pool
// ctx.remove() never called → old context survives next request

// 4. Listeners not deregistered
eventBus.register(this);  // adds reference to eventBus's list
// object can't be GC'd even after you're "done" with it
// Fix: always call eventBus.unregister(this) in cleanup

// 5. Non-static inner class holding outer reference
class Outer {
    byte[] hugeData = new byte[10_000_000];
    class Inner implements Runnable {  // holds implicit ref to Outer
        public void run() { /* ... */ }
    }
}
executor.submit(new Outer().new Inner());
// Outer + hugeData pinned until task completes`,
      },
    ],
  },
  {
    id: "concurrency",
    title: "2. Concurrency",
    icon: "⚡",
    subtopics: [
      {
        id: "thread-lifecycle",
        title: "Thread Lifecycle",
        content: `NEW → RUNNABLE → BLOCKED/WAITING/TIMED_WAITING → TERMINATED\n\n• BLOCKED: waiting to acquire a monitor lock\n• WAITING: Object.wait(), Thread.join() with no timeout — needs explicit notify\n• TIMED_WAITING: sleep(), wait(timeout), join(timeout) — auto-wakes`,
        diagram: `
        ┌─────┐
        │ NEW │
        └──┬──┘
           │ start()
           ▼
      ┌─────────┐   lock contention   ┌─────────┐
      │RUNNABLE │ ──────────────────▶ │ BLOCKED │
      │         │ ◀────────────────── │         │
      └────┬────┘   lock acquired     └─────────┘
           │
           │ wait()/join()            ┌─────────┐
           └────────────────────────▶ │ WAITING │
           ◀──────────── notify()──── └─────────┘
           │
           │ sleep(n)/wait(n)         ┌──────────────┐
           └────────────────────────▶ │TIMED_WAITING │
           ◀──────────── timeout ──── └──────────────┘
           │
           ▼
      ┌────────────┐
      │ TERMINATED │
      └────────────┘`,
        code: null,
      },
      {
        id: "volatile-synchronized",
        title: "volatile vs synchronized",
        content: `volatile: guarantees visibility and happens-before, but NOT atomicity. synchronized: guarantees both visibility and atomicity.\n\nint++ is not atomic even on volatile — it's three operations: read, increment, write. Two threads can interleave.`,
        diagram: null,
        code: `// volatile — visibility only
volatile int counter = 0;
counter++;  // NOT ATOMIC! Read-Modify-Write can interleave

// Thread 1: read(0) → increment → write(1)
// Thread 2: read(0) → increment → write(1)  ← lost update!
// Result: 1 instead of 2

// Correct: use AtomicInteger
AtomicInteger counter = new AtomicInteger(0);
counter.incrementAndGet(); // CAS — truly atomic

// synchronized — atomicity + visibility
private int count = 0;
synchronized void increment() {
    count++;  // safe: only one thread at a time
}

// volatile IS sufficient for a single write/read (flag pattern)
volatile boolean shutdown = false;
// Thread A: shutdown = true;   (single write — atomic for boolean)
// Thread B: while (!shutdown)  (reads fresh value — visible)`,
      },
      {
        id: "juc",
        title: "java.util.concurrent",
        content: `Key synchronizers and their use cases:`,
        diagram: null,
        code: `// ReentrantLock — explicit lock with tryLock, timed lock
ReentrantLock lock = new ReentrantLock();
lock.lock();
try { /* critical section */ }
finally { lock.unlock(); }

// ReadWriteLock — many readers OR one writer
ReadWriteLock rwLock = new ReentrantReadWriteLock();
rwLock.readLock().lock();  // multiple threads can hold simultaneously
rwLock.readLock().unlock();

// CountDownLatch — wait for N events (one-shot)
CountDownLatch latch = new CountDownLatch(3);
// 3 worker threads each call latch.countDown()
latch.await(); // main thread waits until count reaches 0
// Cannot be reset

// CyclicBarrier — N threads meet at a point, then continue together
CyclicBarrier barrier = new CyclicBarrier(3, () -> System.out.println("All ready"));
// each thread calls barrier.await() — last one triggers the action
// Can be reset and reused

// Semaphore — limit concurrent access
Semaphore dbPool = new Semaphore(10); // max 10 concurrent DB connections
dbPool.acquire();
try { /* use connection */ }
finally { dbPool.release(); }`,
      },
      {
        id: "executorservice",
        title: "ExecutorService & ForkJoinPool",
        content: `ThreadPoolExecutor internals: task submission checks corePoolSize → queue → maximumPoolSize → RejectedExecutionHandler. The queue type drives when new threads are created. ForkJoinPool uses work-stealing — idle threads steal tasks from busy threads' deques.`,
        diagram: `
Task submitted
       │
       ▼
  core threads < corePoolSize?
       │ YES → create new thread
       │ NO
       ▼
  Queue full?
       │ NO → enqueue task
       │ YES
       ▼
  threads < maxPoolSize?
       │ YES → create new thread
       │ NO
       ▼
  RejectedExecutionHandler`,
        code: `// ThreadPoolExecutor — explicit control
ExecutorService pool = new ThreadPoolExecutor(
    4,                              // corePoolSize
    8,                              // maximumPoolSize
    60, TimeUnit.SECONDS,           // keepAlive for extra threads
    new ArrayBlockingQueue<>(100),  // bounded queue
    new ThreadPoolExecutor.CallerRunsPolicy() // rejection: caller runs it
);

// ForkJoinPool — divide and conquer
ForkJoinPool fjp = new ForkJoinPool(4); // parallelism = 4
fjp.invoke(new RecursiveTask<Integer>() {
    protected Integer compute() {
        if (problem is small) return solve();
        // split into two sub-tasks
        var left  = new SubTask(leftHalf).fork();
        var right = new SubTask(rightHalf).fork();
        return left.join() + right.join();
    }
});

// Common factory methods (use carefully)
Executors.newFixedThreadPool(4);      // bounded threads, unbounded queue (!)
Executors.newCachedThreadPool();      // unbounded threads — danger at scale
Executors.newWorkStealingPool();      // wraps ForkJoinPool`,
      },
      {
        id: "completablefuture",
        title: "CompletableFuture",
        content: `CompletableFuture enables non-blocking async pipelines. Key distinction: thenApply runs on the completing thread (sync), thenApplyAsync runs on a pool. thenCompose flattens nested futures.`,
        diagram: null,
        code: `// Basic async pipeline
CompletableFuture<String> future = CompletableFuture
    .supplyAsync(() -> fetchUser(id))          // runs on ForkJoinPool
    .thenApply(user -> user.getName())         // sync: same thread
    .thenApplyAsync(name -> enrich(name))      // async: pool thread
    .thenCompose(name -> fetchOrders(name));   // flatMap — avoids CF<CF<T>>

// Combining futures
CompletableFuture<User>   userFuture   = fetchUserAsync(id);
CompletableFuture<Account> accountFuture = fetchAccountAsync(id);

CompletableFuture.allOf(userFuture, accountFuture)
    .thenRun(() -> {
        User user       = userFuture.join();
        Account account = accountFuture.join();
        combine(user, account);
    });

// Error handling
CompletableFuture<String> safe = future
    .exceptionally(ex -> "fallback-value")    // recover from exception
    .handle((result, ex) -> {                 // always runs
        if (ex != null) return "error";
        return result.toUpperCase();
    });

// Timeout (Java 9+)
future.orTimeout(5, TimeUnit.SECONDS)
      .exceptionally(ex -> "timed out");`,
      },
      {
        id: "concurrency-pitfalls",
        title: "Common Pitfalls",
        content: `The most dangerous concurrency bugs:`,
        diagram: null,
        code: `// DEADLOCK — always acquire locks in the same order
// Thread 1: lock(A) then lock(B)
// Thread 2: lock(B) then lock(A)  → circular wait
// Fix: enforce global lock ordering (e.g. by ID)
if (a.id < b.id) { lock(a); lock(b); }
else             { lock(b); lock(a); }

// FALSE SHARING — threads write different fields on same cache line
class Counter {
    volatile long a;  // Thread 1 writes
    volatile long b;  // Thread 2 writes — same 64-byte cache line!
    // Each write invalidates the other thread's cache
}
// Fix: @Contended (JVM flag: -XX:-RestrictContended)
@jdk.internal.vm.annotation.Contended volatile long a;

// THREADLOCAL LEAK in thread pools
static ThreadLocal<Connection> conn = new ThreadLocal<>();
// Thread from pool: conn.set(c);
// Task ends but thread lives on → Connection never closed
// Fix: always conn.remove() in finally block

// LIVELOCK — threads keep responding to each other, no progress
// Thread A: see conflict → back off → retry → see conflict again
// Thread B: same pattern — neither makes progress
// Fix: randomized backoff`,
      },
    ],
  },
  {
    id: "gc",
    title: "4. Garbage Collection",
    icon: "♻️",
    subtopics: [
      {
        id: "gc-algorithms",
        title: "GC Algorithms",
        content: `Trade-off triangle: throughput vs pause time vs memory footprint. No GC wins on all three.`,
        diagram: `
Collector      Throughput   Pause Time   Use Case
─────────────────────────────────────────────────────
Serial         Low          High         Single-core, small heaps
Parallel       High         Medium       Batch processing, throughput focus
CMS            Medium       Low(ish)     Deprecated in Java 14
G1 (default)   High         Predictable  General purpose (Java 9+)
ZGC            High         Sub-ms       Latency-critical (Java 15+)
Shenandoah     High         Sub-ms       Same as ZGC, different algorithm`,
        code: null,
      },
      {
        id: "g1gc",
        title: "G1 GC",
        content: `Heap divided into ~2048 equal-sized regions (1–32 MB each). Regions can be Eden, Survivor, Old, or Humongous (large objects). G1 prioritizes regions with most garbage first — hence "Garbage First". Mixed GC collects both young and old regions together.`,
        diagram: `
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ E  │ E  │ S  │ O  │ O  │ H  │ H  │ E  │
├────┼────┼────┼────┼────┼────┼────┼────┤
│ O  │ E  │ O  │ S  │ E  │ O  │ E  │ O  │
└────┴────┴────┴────┴────┴────┴────┴────┘
E=Eden  S=Survivor  O=Old  H=Humongous

G1 targets: collect regions with most dead objects first`,
        code: `# G1 tuning flags
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200       # pause target (not a hard guarantee)
-XX:G1HeapRegionSize=4m        # override auto-calculated region size
-XX:G1NewSizePercent=5         # min young gen %
-XX:G1MaxNewSizePercent=60     # max young gen %
-XX:InitiatingHeapOccupancyPercent=45  # start concurrent marking at 45% full`,
      },
      {
        id: "zgc",
        title: "ZGC / Shenandoah",
        content: `Both achieve sub-millisecond pauses by doing most GC work concurrently with the application. They use load barriers to handle object references being moved while the app runs. Higher CPU overhead (~5–15%) — the cost of concurrency. Ideal for payment APIs and low-latency services.`,
        diagram: null,
        code: `# Enable ZGC (Java 15+ for production)
-XX:+UseZGC
-XX:SoftMaxHeapSize=4g         # soft limit — ZGC tries to stay under this

# ZGC phases (all concurrent, no stop-the-world except tiny pauses):
# 1. Mark start (pause ~1ms)
# 2. Concurrent mark
# 3. Mark end (pause ~1ms)
# 4. Concurrent process references
# 5. Concurrent relocate
# 6. Concurrent remap

# Shenandoah
-XX:+UseShenandoahGC
-XX:ShenandoahGCMode=iu       # incremental-update mode (default)`,
      },
      {
        id: "gc-logs",
        title: "Reading GC Logs",
        content: `Enable GC logging with -Xlog:gc* (Java 9+). Key things to look for: frequency of collections, pause duration, heap size before/after, allocation rate. A Full GC is always a red flag — it stops all threads.`,
        diagram: null,
        code: `# Enable GC logging
-Xlog:gc*:file=gc.log:time,uptime,level,tags

# Sample G1 log output:
[2.456s][info][gc] GC(3) Pause Young (Normal) (G1 Evacuation Pause)
[2.456s][info][gc] GC(3)   Heap: 512M -> 128M (1024M)
[2.456s][info][gc] GC(3)   Pause: 12.3ms

# Red flags:
# - "Full GC" → heap pressure, possible leak, or wrong GC tuning
# - Pause > MaxGCPauseMillis target consistently
# - Heap size after GC growing each cycle → leak
# - Allocation rate spiking → short-lived object pressure

# Useful tools:
# - GCViewer (open source)
# - GCEasy (web-based)
# - JDK's built-in: jstat -gcutil <pid> 1000`,
      },
    ],
  },
  {
    id: "collections",
    title: "5. Collections",
    icon: "📦",
    subtopics: [
      {
        id: "hashmap",
        title: "HashMap Internals",
        content: `Array of buckets where each bucket is a linked list (Java 7) or a red-black tree when the bucket size exceeds 8 (Java 8+). Load factor 0.75 means resize at 75% capacity — doubles the array and rehashes all entries. hashCode() + equals() contract is critical: equal objects must have equal hash codes.`,
        diagram: `
buckets array
┌─────┐
│  0  │──▶ null
├─────┤
│  1  │──▶ ["alice", 25] ──▶ ["carol", 31]  (collision → linked list)
├─────┤
│  2  │──▶ null
├─────┤
│  3  │──▶ ["bob", 30]
└─────┘
 ...
When bucket list length > 8 → converts to red-black tree → O(log n) lookup`,
        code: `// hashCode + equals contract
class Money {
    final long amount;
    final String currency;

    @Override
    public int hashCode() {
        return Objects.hash(amount, currency); // both fields
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Money m)) return false;
        return amount == m.amount && currency.equals(m.currency);
    }
}

// If you override equals() without hashCode():
Map<Money, String> map = new HashMap<>();
map.put(new Money(100, "EUR"), "hundred");
map.get(new Money(100, "EUR")); // returns null! — different hash buckets

// Initial capacity to avoid rehashing
Map<String, Integer> map = new HashMap<>(expectedSize / 0.75 + 1);`,
      },
      {
        id: "concurrenthashmap",
        title: "ConcurrentHashMap",
        content: `Java 8 replaced segment-based locking with CAS + per-bucket synchronization. Reads are completely lock-free. Writes synchronize only on the specific bucket being modified — far less contention than a single lock. size() is approximate (uses LongAdder internally).`,
        diagram: null,
        code: `ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();

// Atomic compound operations
map.putIfAbsent("key", 1);
map.computeIfAbsent("key", k -> expensiveLoad(k));  // atomic
map.merge("key", 1, Integer::sum);  // atomic read-modify-write

// Common mistake: non-atomic check-then-act
if (!map.containsKey("key")) {      // check
    map.put("key", compute("key")); // act — NOT atomic! race condition
}
// Fix: use computeIfAbsent

// size() is approximate — avoid in logic
int approxSize = map.size(); // may not reflect concurrent inserts

// forEach is weakly consistent — sees snapshot, won't throw ConcurrentModificationException
map.forEach((k, v) -> process(k, v));`,
      },
      {
        id: "arraylist-linkedlist",
        title: "ArrayList vs LinkedList",
        content: `ArrayList wins in almost all real-world cases due to CPU cache locality. Contiguous memory means prefetcher works. LinkedList nodes are scattered in heap — every .get(i) is a cache miss.`,
        diagram: null,
        code: `// ArrayList — O(1) random access, O(n) insert at middle
List<String> list = new ArrayList<>();
list.get(500);           // O(1) — direct index into array
list.add(0, "first");    // O(n) — shifts all elements right

// LinkedList — O(1) insert at iterator position, O(n) get(i)
LinkedList<String> ll = new LinkedList<>();
ll.addFirst("head");     // O(1)
ll.get(500);             // O(n) — traverses 500 nodes

// When LinkedList wins: frequent insert/delete via iterator
Iterator<String> it = ll.iterator();
while (it.hasNext()) {
    if (shouldRemove(it.next())) it.remove(); // O(1) at current position
}
// Same with ArrayList is O(n) per remove due to shifting

// In practice: ArrayList + removeIf() is often still faster
list.removeIf(s -> shouldRemove(s)); // bulk shift once`,
      },
      {
        id: "treemap-linkedhashmap",
        title: "TreeMap vs LinkedHashMap",
        content: `TreeMap: sorted by natural order or Comparator, O(log n) ops, backed by Red-Black tree. LinkedHashMap: maintains insertion or access order, O(1) ops — the classic LRU cache base.`,
        diagram: null,
        code: `// TreeMap — sorted keys
TreeMap<String, Integer> tree = new TreeMap<>();
tree.put("banana", 2);
tree.put("apple", 1);
tree.put("cherry", 3);
tree.firstKey();                    // "apple"
tree.subMap("apple", "cherry");     // range query
tree.floorKey("blueberry");         // "banana" — largest key <= query

// LinkedHashMap — LRU cache
int MAX = 100;
Map<String, Data> lruCache = new LinkedHashMap<>(MAX, 0.75f, true) {
    // accessOrder=true: get() moves entry to end
    protected boolean removeEldestEntry(Map.Entry e) {
        return size() > MAX; // evict oldest on overflow
    }
};
lruCache.put("key", data);
lruCache.get("key"); // moves "key" to most-recently-used end`,
      },
      {
        id: "queue-family",
        title: "Queue Family",
        content: `Choose the right queue for the job:`,
        diagram: `
Queue type              Bounded?  Blocking?   Use case
────────────────────────────────────────────────────────
ArrayDeque              No        No          General stack/queue, faster than LinkedList
PriorityQueue           No        No          Min-heap, task scheduling
ArrayBlockingQueue      YES       Yes         Producer-consumer with back-pressure
LinkedBlockingQueue     Optional  Yes         Producer-consumer (default unbounded!)
SynchronousQueue        0-size    Yes         Direct handoff, no buffering
DelayQueue              No        Yes         Scheduled tasks (expires after delay)`,
        code: `// ArrayDeque — general purpose, no null allowed, faster than LinkedList
Deque<String> deque = new ArrayDeque<>();
deque.push("a");    // stack: push to front
deque.pop();        // stack: pop from front
deque.offer("b");   // queue: add to back
deque.poll();       // queue: remove from front

// PriorityQueue — min-heap
PriorityQueue<Task> pq = new PriorityQueue<>(
    Comparator.comparingInt(t -> t.priority)
);
pq.offer(new Task(3, "low"));
pq.offer(new Task(1, "high"));
pq.poll(); // returns Task(1, "high") — lowest priority value first

// BlockingQueue — producer-consumer
BlockingQueue<Order> queue = new ArrayBlockingQueue<>(100);
// Producer
queue.put(order);      // blocks if full
queue.offer(order, 1, SECONDS); // times out if full

// Consumer
Order o = queue.take();          // blocks if empty
Order o = queue.poll(1, SECONDS);// times out if empty

// SynchronousQueue — zero buffer, direct handoff
BlockingQueue<Work> handoff = new SynchronousQueue<>();
// put() blocks until a consumer calls take() — and vice versa`,
      },
    ],
  },
  {
    id: "design-patterns",
    title: "6. Design Patterns",
    icon: "🏗️",
    subtopics: [
      {
        id: "when-not-to-use",
        title: "When NOT to Use a Pattern",
        content: `Senior interviews test judgment. Over-engineering with patterns is as bad as ignoring them. Ask: does this pattern solve an actual problem I have, or am I adding complexity speculatively?`,
        diagram: null,
        code: `// BAD: Factory for a single concrete type that never changes
class PaymentFactory {
    Payment create(String type) { return new CreditCardPayment(); }
    // Only one implementation exists — factory adds zero value
}
// Just do: new CreditCardPayment()

// BAD: Strategy pattern with a single strategy
interface SortStrategy { void sort(List<?> list); }
class QuickSort implements SortStrategy { ... }
// If you only ever use QuickSort, the abstraction is noise

// GOOD: Strategy when you genuinely swap algorithms
interface FeeCalculator { BigDecimal calculate(Transaction tx); }
class StandardFee implements FeeCalculator { ... }
class PremiumFee implements FeeCalculator { ... }
class WaivedFee implements FeeCalculator { ... }
// Real variation → pattern earns its weight`,
      },
      {
        id: "concurrency-patterns",
        title: "Concurrency Patterns",
        content: `Patterns specifically for thread-safe code:`,
        diagram: null,
        code: `// Immutable object — thread-safe with zero synchronization
final class Money {
    private final long amount;
    private final String currency;
    public Money(long amount, String currency) { /* assign */ }
    public Money add(Money other) {
        return new Money(this.amount + other.amount, currency); // new instance
    }
    // no setters, all fields final
}

// ThreadLocal — per-thread state without synchronization
static final ThreadLocal<SimpleDateFormat> formatter =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));
// Each thread gets its own SimpleDateFormat — no shared state

// Producer-Consumer with BlockingQueue
BlockingQueue<Transaction> queue = new ArrayBlockingQueue<>(1000);
// Producer thread
new Thread(() -> {
    while (running) queue.put(nextTransaction());
}).start();
// Consumer thread
new Thread(() -> {
    while (running) process(queue.take());
}).start();

// Double-Checked Locking — ONLY correct with volatile
class Config {
    private static volatile Config instance;  // volatile is REQUIRED
    static Config getInstance() {
        if (instance == null) {
            synchronized (Config.class) {
                if (instance == null) instance = new Config(); // check again
            }
        }
        return instance;
    }
}`,
      },
      {
        id: "banking-patterns",
        title: "Banking-Relevant Patterns",
        content: `Patterns that come up repeatedly in financial systems:`,
        diagram: null,
        code: `// Command — auditable, replayable transactions
interface Command {
    void execute();
    void undo();
    CommandAudit toAuditRecord();
}
class TransferCommand implements Command {
    private final Account from, to;
    private final Money amount;
    public void execute() { from.debit(amount); to.credit(amount); }
    public void undo()    { to.debit(amount); from.credit(amount); }
    // Every action is an object — store, replay, undo
}

// Decorator — wrap service with cross-cutting concerns
interface PaymentService { Receipt pay(Payment p); }

class LoggingPaymentService implements PaymentService {
    private final PaymentService delegate;
    public Receipt pay(Payment p) {
        log.info("paying {}", p);
        Receipt r = delegate.pay(p);
        log.info("paid {}", r);
        return r;
    }
}
class AuthPaymentService implements PaymentService {
    public Receipt pay(Payment p) {
        checkAuthorization(p); // wraps delegate
        return delegate.pay(p);
    }
}
// Stack them: auth → logging → actual service

// Saga — distributed transaction across microservices
// Each step has a compensating action
// Step 1: Reserve inventory    → Compensate: release inventory
// Step 2: Charge payment       → Compensate: refund payment
// Step 3: Update ledger        → Compensate: reverse ledger entry
// If step 3 fails, run compensations for 2 and 1 in reverse order`,
      },
      {
        id: "builder-immutability",
        title: "Builder & Immutability",
        content: `Builder prevents telescoping constructors and enforces invariants. Java 16+ records give you immutable DTOs for free.`,
        diagram: null,
        code: `// Builder — enforces invariants, readable construction
class TransferRequest {
    private final String fromAccount;
    private final String toAccount;
    private final Money amount;
    private final String reference;  // optional

    private TransferRequest(Builder b) {
        this.fromAccount = Objects.requireNonNull(b.fromAccount);
        this.toAccount   = Objects.requireNonNull(b.toAccount);
        this.amount      = b.amount;
        this.reference   = b.reference;
    }

    static class Builder {
        String fromAccount, toAccount, reference;
        Money amount;
        Builder from(String acc) { this.fromAccount = acc; return this; }
        Builder to(String acc)   { this.toAccount = acc;   return this; }
        Builder amount(Money m)  { this.amount = m;        return this; }
        Builder ref(String r)    { this.reference = r;     return this; }
        TransferRequest build()  { return new TransferRequest(this); }
    }
}
// Usage:
var req = new TransferRequest.Builder()
    .from("NL91ABNA0417164300")
    .to("NL69INGB0123456789")
    .amount(Money.of(1000, "EUR"))
    .build();

// Java 16+ record — immutable DTO for free
record PaymentDTO(String id, long amount, String currency, Instant at) {}
// Gives you: constructor, getters, equals, hashCode, toString — all final`,
      },
      {
        id: "reactive-patterns",
        title: "Reactive / Resilience Patterns",
        content: `Essential for microservice resilience at scale. From Resilience4j:`,
        diagram: `
Request
   │
   ▼
┌──────────────┐   OPEN (tripped)
│Circuit Breaker│──────────────────▶ fail fast (no call made)
│  CLOSED      │
│  (passing)   │◀─────────────────── HALF-OPEN (probe)
└──────┬───────┘
       │ failure threshold exceeded
       └──────────────────────────▶ OPEN`,
        code: `// Circuit Breaker (Resilience4j)
CircuitBreaker cb = CircuitBreaker.ofDefaults("paymentService");
Supplier<Receipt> decorated = CircuitBreaker
    .decorateSupplier(cb, () -> paymentService.pay(payment));
Try.ofSupplier(decorated)
    .recover(CallNotPermittedException.class, e -> fallback());

// Retry with exponential backoff
Retry retry = Retry.of("payment", RetryConfig.custom()
    .maxAttempts(3)
    .waitDuration(Duration.ofMillis(100))
    .intervalFunction(IntervalFunction.ofExponentialBackoff())
    .retryOnException(e -> e instanceof TransientException)
    .build());

// Bulkhead — limit concurrent calls to a service
Bulkhead bulkhead = Bulkhead.of("db", BulkheadConfig.custom()
    .maxConcurrentCalls(20)
    .maxWaitDuration(Duration.ofMillis(500))
    .build());

// Timeout
TimeLimiter timeLimiter = TimeLimiter.of(Duration.ofSeconds(2));
// Compose them all:
// TimeLimiter → CircuitBreaker → Retry → Bulkhead → actual call`,
      },
    ],
  },
  {
    id: "reactive",
    title: "7. Reactive & Async",
    icon: "🌊",
    subtopics: [
      {
        id: "why-reactive",
        title: "Why Reactive at Banks",
        content: `Thread-per-request breaks at scale. 10k simultaneous connections = 10k threads = ~80 GB of stack memory + enormous context-switch overhead. Reactive uses a small event-loop thread pool (CPU core count) and never blocks — I/O waits become callbacks.`,
        diagram: `
Thread-per-request (blocking)        Reactive (non-blocking)
─────────────────────────────        ────────────────────────
Thread 1: ████░░░░░░████░░░░░        Event loop: ████████████
Thread 2: ██░░░░░░████░░░░░░░        (2-4 threads handle 10k connections)
Thread 3: ░░████░░░░░░████░░░
...
Thread N: ░░░░████░░░░░░████░
█ = working  ░ = blocked on I/O`,
        code: null,
      },
      {
        id: "project-reactor",
        title: "Project Reactor (Spring WebFlux)",
        content: `Mono: 0 or 1 item. Flux: 0 to N items. Both are lazy — nothing executes until someone subscribes. Operators are composable and form a processing pipeline.`,
        diagram: null,
        code: `// Mono — single async value
Mono<Account> account = accountRepository.findById(id); // lazy, no DB call yet
account.subscribe(a -> System.out.println(a));          // NOW it runs

// Flux — stream of values
Flux<Transaction> txns = transactionRepository.findByAccount(id);
txns
    .filter(t -> t.amount().compareTo(BigDecimal.ZERO) > 0)
    .map(t -> new TxnDTO(t.id(), t.amount()))
    .take(100)
    .subscribe(dto -> send(dto));

// Common operators
Flux.range(1, 10)
    .map(i -> i * 2)                     // transform each element
    .filter(i -> i > 5)                  // keep matching
    .flatMap(i -> fetchAsync(i))          // concurrent async for each
    .collectList()                        // gather into Mono<List>
    .block();                             // subscribe + block (only in tests!)

// Combining
Mono.zip(fetchUser(id), fetchAccount(id))
    .map(tuple -> new UserAccount(tuple.getT1(), tuple.getT2()));`,
      },
      {
        id: "flatmap-concatmap",
        title: "flatMap vs concatMap",
        content: `The most important Reactor distinction for banking: flatMap is concurrent and unordered, concatMap is sequential and ordered. Use concatMap when processing order matters (ledger entries, event sourcing).`,
        diagram: `
Input:  [A, B, C]  (each triggers async work)

flatMap (concurrent, unordered):
  A ──────────────▶ result_A   (A and B run at the same time)
  B ──────▶ result_B           (B finishes first)
  C ──────────────────▶ result_C
Output: [result_B, result_A, result_C]  ← order NOT preserved

concatMap (sequential, ordered):
  A ──────────────▶ result_A
                              B ──────▶ result_B   (B starts only after A done)
                                                  C ──▶ result_C
Output: [result_A, result_B, result_C]  ← order preserved`,
        code: `// flatMap — concurrent, good for independent lookups
Flux.fromIterable(accountIds)
    .flatMap(id -> accountService.findById(id))  // all fire concurrently
    .collectList();

// flatMap with concurrency limit
Flux.fromIterable(accountIds)
    .flatMap(id -> accountService.findById(id), 5)  // max 5 concurrent

// concatMap — sequential, use for ordered operations
Flux.fromIterable(ledgerEvents)
    .concatMap(event -> applyEvent(event))  // strictly one at a time
    .doOnNext(result -> log.info("applied: {}", result));

// Gotcha: flatMap error handling
flux.flatMap(item ->
    process(item)
        .onErrorResume(e -> Mono.empty())  // skip failed items
);`,
      },
      {
        id: "backpressure",
        title: "Backpressure",
        content: `When a producer emits faster than a consumer can process, backpressure prevents buffer overflow. Reactor implements the Reactive Streams spec — the subscriber requests N items, and the producer respects that demand.`,
        diagram: null,
        code: `// Backpressure strategies
Flux.range(1, 1_000_000)
    .onBackpressureBuffer(1000)      // buffer up to 1000, error if exceeded
    .onBackpressureDrop()            // silently drop items consumer can't keep up with
    .onBackpressureLatest()          // keep only the most recent unprocessed item
    .onBackpressureError();          // throw OverflowException immediately

// Subscriber controlling demand
Flux.range(1, 100)
    .subscribe(new BaseSubscriber<Integer>() {
        protected void hookOnSubscribe(Subscription s) {
            request(10);  // request 10 items initially
        }
        protected void hookOnNext(Integer value) {
            process(value);
            request(1);   // request 1 more after each processed
        }
    });

// Connecting a slow consumer to a fast producer
Flux.interval(Duration.ofMillis(1))   // emits every 1ms
    .onBackpressureDrop()
    .publishOn(Schedulers.boundedElastic())
    .subscribe(i -> {
        Thread.sleep(100); // processing takes 100ms — far slower than producer
    });`,
      },
      {
        id: "virtual-threads",
        title: "Virtual Threads (Java 21)",
        content: `Project Loom brings cheap threads — millions can exist simultaneously. Each virtual thread is a thin wrapper; the JVM mounts them onto carrier (OS) threads only when running. Blocking I/O automatically unmounts the virtual thread, freeing the carrier. Structured concurrency brings task lifecycle management.`,
        diagram: `
Virtual Threads               Platform Thread
┌──────┐ ┌──────┐ ┌──────┐       ┌──────────┐
│  VT1 │ │  VT2 │ │  VT3 │  ───▶ │Carrier 1 │ (OS thread)
└──────┘ └──────┘ └──────┘       └──────────┘
┌──────┐ ┌──────┐                 ┌──────────┐
│  VT4 │ │  VT5 │            ───▶ │Carrier 2 │ (OS thread)
└──────┘ └──────┘                 └──────────┘
VT blocks on I/O → unmounted → carrier picks up next runnable VT`,
        code: `// Create virtual threads (Java 21)
Thread vt = Thread.ofVirtual().start(() -> handleRequest(req));

// ExecutorService with virtual threads
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 100_000; i++) {
        executor.submit(() -> {
            // blocking I/O here is fine — the carrier thread is freed
            String data = httpClient.get(url); // blocks VT, not carrier
            process(data);
        });
    }
} // auto-shutdown + await

// Structured concurrency (Java 21 preview)
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Future<User>    user    = scope.fork(() -> fetchUser(id));
    Future<Account> account = scope.fork(() -> fetchAccount(id));
    scope.join();           // wait for both
    scope.throwIfFailed();  // propagate any error
    return new UserAccount(user.get(), account.get());
}
// If fetchUser fails, fetchAccount is automatically cancelled

// Virtual threads vs Reactor:
// Virtual threads: simpler code, blocking style, good for thread-per-request
// Reactor: more control, backpressure, composable pipelines, mature ecosystem`,
      },
    ],
  },
  {
    id: "nio",
    title: "8. NIO & Netty",
    icon: "🔌",
    subtopics: [
      {
        id: "nio-basics",
        title: "NIO Fundamentals",
        content: `Java NIO (New I/O, Java 1.4) provides non-blocking I/O via Channels, Buffers, and Selectors. One thread can multiplex many connections using a Selector — the OS notifies when a channel is ready for I/O.`,
        diagram: `
Traditional I/O (blocking)       NIO (non-blocking, multiplexed)
──────────────────────────       ─────────────────────────────
Thread 1 ──▶ Socket 1 (blocks)
Thread 2 ──▶ Socket 2 (blocks)   Selector ──▶ [Socket1, Socket2, Socket3...]
Thread 3 ──▶ Socket 3 (blocks)   Single thread handles ALL ready channels
...                               OS notifies which channels are ready`,
        code: `// NIO Selector — single thread, many connections
Selector selector = Selector.open();
ServerSocketChannel server = ServerSocketChannel.open();
server.bind(new InetSocketAddress(8080));
server.configureBlocking(false);              // non-blocking mode
server.register(selector, SelectionKey.OP_ACCEPT);

while (true) {
    selector.select();  // blocks until at least one channel is ready
    Set<SelectionKey> keys = selector.selectedKeys();
    for (SelectionKey key : keys) {
        if (key.isAcceptable()) {
            SocketChannel client = server.accept();
            client.configureBlocking(false);
            client.register(selector, SelectionKey.OP_READ);
        } else if (key.isReadable()) {
            SocketChannel ch = (SocketChannel) key.channel();
            ByteBuffer buf = ByteBuffer.allocate(1024);
            ch.read(buf);
            buf.flip();  // switch from write mode to read mode
            // process buf...
        }
    }
    keys.clear();
}`,
      },
      {
        id: "netty",
        title: "Netty Architecture",
        content: `Netty wraps NIO with a clean pipeline model. EventLoopGroup manages a pool of threads, each running a Selector loop. ChannelPipeline chains handlers — each handler processes inbound or outbound events.`,
        diagram: `
                    Netty Server Architecture
┌─────────────────────────────────────────────────┐
│                 ServerBootstrap                  │
│  BossGroup (1 thread)   WorkerGroup (N threads)  │
│  ┌───────────────┐      ┌───────────────────┐   │
│  │ NioEventLoop  │      │  NioEventLoop x N │   │
│  │ (accepts)     │─────▶│  (read/write/exec)│   │
│  └───────────────┘      └────────┬──────────┘   │
└───────────────────────────────────┼─────────────┘
                                    │
                         Channel Pipeline
                    ┌───────────────────────┐
           inbound  │ ByteToMessageDecoder  │ decode bytes → POJO
              ▼     ├───────────────────────┤
                    │  BusinessLogicHandler │ process
              ▼     ├───────────────────────┤
          outbound  │ MessageToByteEncoder  │ encode POJO → bytes
                    └───────────────────────┘`,
        code: `// Netty server setup
EventLoopGroup boss   = new NioEventLoopGroup(1);
EventLoopGroup worker = new NioEventLoopGroup(); // defaults to 2 * CPU cores
try {
    ServerBootstrap b = new ServerBootstrap();
    b.group(boss, worker)
     .channel(NioServerSocketChannel.class)
     .childHandler(new ChannelInitializer<SocketChannel>() {
         protected void initChannel(SocketChannel ch) {
             ch.pipeline().addLast(
                 new LengthFieldBasedFrameDecoder(8192, 0, 4),
                 new MessageDecoder(),
                 new BusinessHandler(),
                 new MessageEncoder()
             );
         }
     })
     .option(ChannelOption.SO_BACKLOG, 128)
     .childOption(ChannelOption.SO_KEEPALIVE, true);

    ChannelFuture f = b.bind(8080).sync();
    f.channel().closeFuture().sync();
} finally {
    boss.shutdownGracefully();
    worker.shutdownGracefully();
}

// Handler example
public class BusinessHandler extends SimpleChannelInboundHandler<Request> {
    protected void channelRead0(ChannelHandlerContext ctx, Request req) {
        Response resp = process(req);
        ctx.writeAndFlush(resp);  // non-blocking write
    }
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close();
    }
}`,
      },
      {
        id: "zero-copy",
        title: "Zero-Copy & Off-Heap in Netty",
        content: `Netty uses off-heap pooled buffers (PooledByteBuf) and zero-copy techniques to minimize data movement. For file transfer, sendfile() allows kernel to move data directly from disk to socket without userspace copy.`,
        diagram: `
Normal copy path:              Zero-copy path (sendfile):
Disk → Kernel buffer           Disk → Kernel buffer
     → User buffer    (copy 1)      → Socket buffer (kernel copy only)
     → Socket buffer  (copy 2)
     → NIC            (copy 3)      → NIC
                                  Userspace never touched the data`,
        code: `// Zero-copy file transfer with Netty
public void channelRead0(ChannelHandlerContext ctx, Request req) {
    RandomAccessFile file = new RandomAccessFile("data.bin", "r");
    FileRegion region = new DefaultFileRegion(
        file.getChannel(), 0, file.length()
    );
    ctx.writeAndFlush(region);  // uses sendfile() under the hood
    // Data goes: disk → kernel → NIC — never copied to userspace
}

// Netty's pooled off-heap buffer
ByteBuf buf = ctx.alloc().directBuffer(1024); // from pool, off-heap
try {
    buf.writeInt(42);
    buf.writeBytes("hello".getBytes());
    ctx.writeAndFlush(buf.retain()); // retain ref count before async write
} finally {
    buf.release(); // return to pool — NOT freed to OS, reused
}

// CompositeByteBuf — logical view of multiple buffers (no copy)
CompositeByteBuf composite = ctx.alloc().compositeBuffer();
composite.addComponents(true, headerBuf, bodyBuf);
// headerBuf and bodyBuf remain separate in memory
// composite presents them as one contiguous view — zero copy`,
      },
    ],
  },
];
