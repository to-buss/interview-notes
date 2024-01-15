export const kafkaTopics = [
  {
    id: "kafka-foundations",
    title: "1. Foundational Concepts",
    icon: "📨",
    subtopics: [
      {
        id: "consumer-groups",
        title: "Consumer Groups",
        content: `A Consumer Group is a set of consumers that work together to consume data from a topic. Each partition in the topic is assigned to exactly one consumer in the group at a time — guaranteeing parallel, non-duplicate processing.\n\nScaling rule: you can add consumers up to the number of partitions. Beyond that, extra consumers sit idle. To scale further, increase the partition count first.`,
        diagram: `
Topic: "orders"  (4 partitions)
┌──────────┬──────────┬──────────┬──────────┐
│  P-0     │  P-1     │  P-2     │  P-3     │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┘
     │          │          │          │
     ▼          ▼          ▼          ▼
┌─────────────────────────────────────────┐
│         Consumer Group "order-svc"      │
│  [Consumer A]  [Consumer B]  [Consumer C] [Consumer D] │
└─────────────────────────────────────────┘

  Each partition → exactly one consumer in the group`,
        code: `// Consumer group configuration (Java)
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "broker1:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-svc");          // group name
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");  // start from beginning if no committed offset

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(List.of("orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        System.out.printf("partition=%d offset=%d key=%s value=%s%n",
            record.partition(), record.offset(), record.key(), record.value());
    }
}`,
      },
      {
        id: "offsets",
        title: "Offsets",
        content: `An offset is a unique, sequential integer assigned to each message within a partition. It acts as a bookmark so the consumer knows where it left off.\n\nIn modern Kafka, committed offsets are stored in the internal topic __consumer_offsets. When a consumer restarts, it reads this topic to resume from where it stopped — enabling fault-tolerance without message loss or duplicate processing (when committed correctly).`,
        diagram: `
Partition 0 of topic "events":
┌───┬───┬───┬───┬───┬───┬───┬───┐
│ 0 │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │  ← offsets
└───┴───┴───┴───┴───┴───┴───┴───┘
                    ▲
          committed offset = 4
          (consumer will resume at 5 on restart)

__consumer_offsets  (internal Kafka topic)
  group="order-svc", topic="events", partition=0, offset=4`,
        code: `// Manual offset commit (for precise control)
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");

ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
for (ConsumerRecord<String, String> record : records) {
    process(record); // do your work first
}
// Only commit after successful processing
consumer.commitSync();

// Or commit specific offset
Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
offsets.put(new TopicPartition("events", 0), new OffsetAndMetadata(5));
consumer.commitSync(offsets);`,
      },
      {
        id: "high-throughput",
        title: "High Throughput",
        content: `Kafka achieves exceptional throughput despite writing to disk via three mechanisms:\n\n1. Sequential I/O — Kafka only appends to the end of log files. Sequential disk writes are nearly as fast as RAM writes, unlike random access.\n\n2. Zero-Copy — Uses the OS sendfile() system call to transfer data directly from the page cache to the network socket, bypassing the application heap entirely. No data is copied into JVM memory.\n\n3. Batching — Producers buffer records and send them in large batches. Consumers also fetch in batches. This amortizes network round-trip cost across many messages.`,
        diagram: `
  WITHOUT Zero-Copy (4 copies):
  Disk → Kernel buffer → User space → Socket buffer → NIC

  WITH Zero-Copy (2 copies via sendfile):
  Disk → Page Cache ──────────────────→ NIC
                  (kernel handles transfer directly)

  Sequential Append (fast):
  [ msg1 | msg2 | msg3 | msg4 | ... ]  →  append here
                                                 ▲
                                          O(1), no seek`,
        code: null,
      },
    ],
  },
  {
    id: "kafka-reliability",
    title: "2. Reliability & Consistency",
    icon: "🔒",
    subtopics: [
      {
        id: "acks",
        title: "Producer acks",
        content: `The acks setting controls how many brokers must confirm a write before the producer considers it successful:\n\n• acks=0 — Fire-and-forget. Producer sends and moves on. Fastest, but messages can be lost if the broker crashes before writing.\n\n• acks=1 — Leader-only acknowledgement. Safe against single-broker crashes unless the leader fails before replicating.\n\n• acks=all (or -1) — Leader + all In-Sync Replicas must acknowledge. Safest setting; pairs with min.insync.replicas for true durability guarantees.`,
        diagram: `
acks=0:  Producer ──────────────────────────────► (no ack)
                         Broker may drop it silently

acks=1:  Producer ─────────► Leader ──► ACK
                              (replicas may not have it yet)

acks=all: Producer ─────────► Leader ─► ISR-1 ─► ISR-2 ─► ACK
                              (all in-sync replicas confirmed)`,
        code: `// Producer reliability configuration
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "broker1:9092");
props.put(ProducerConfig.ACKS_CONFIG, "all");               // wait for all ISRs
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);  // exactly-once at producer level
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
ProducerRecord<String, String> record =
    new ProducerRecord<>("orders", "user-42", "{\"item\":\"book\"}");

producer.send(record, (metadata, ex) -> {
    if (ex != null) ex.printStackTrace();
    else System.out.printf("Sent to partition %d at offset %d%n",
        metadata.partition(), metadata.offset());
});`,
      },
      {
        id: "isr",
        title: "ISR (In-Sync Replicas)",
        content: `An In-Sync Replica (ISR) is a follower that has fully caught up with the leader's log within a configurable time window (replica.lag.time.max.ms).\n\nOnly ISR members are eligible to become the new leader on failover (default config). This prevents a lagging replica — which may be missing recent messages — from being elected leader, which would cause data loss.\n\nIf too many replicas fall out of ISR and min.insync.replicas is not met, producers with acks=all will receive a NotEnoughReplicasException, effectively halting writes to protect consistency.`,
        diagram: `
  Topic "orders", Partition 0 — Replication Factor 3

  ┌──────────────────────┐
  │  Leader (Broker 1)   │  offset: 0..105
  └──────────┬───────────┘
             │  replicate
     ┌────────┴────────┐
     ▼                 ▼
  ┌──────────┐    ┌──────────┐
  │ Broker 2 │    │ Broker 3 │
  │ offset:  │    │ offset:  │
  │   0..105 │    │   0..98  │
  │  (ISR)   │    │ (lagging,│
  │          │    │  out ISR)│
  └──────────┘    └──────────┘

  ISR = { Broker1, Broker2 }`,
        code: `// Broker config (server.properties)
// Minimum ISRs that must ack for a write to succeed with acks=all
min.insync.replicas=2

// How long a follower can be behind before removed from ISR
replica.lag.time.max.ms=30000

// Topic-level override
kafka-topics.sh --alter \\
  --topic orders \\
  --config min.insync.replicas=2`,
      },
      {
        id: "eos",
        title: "Exactly-Once Semantics",
        content: `Exactly-Once Semantics (EOS) ensures each message is processed and written exactly once — no duplicates, no data loss — even across retries and failures.\n\nIt is built on two pillars:\n\n1. Idempotent Producer — Each producer gets a Producer ID (PID). The broker deduplicates retried messages using (PID, sequence number), preventing duplicates.\n\n2. Transactional API — A producer with a transactional.id can write to multiple topics/partitions atomically. Either all writes commit (visible together) or all abort (none visible). Consumers set isolation.level=read_committed to only see committed data.`,
        diagram: `
  Transactional Write:
  ┌─────────────────────────────────────────────┐
  │  beginTransaction()                          │
  │    producer.send("topic-A", msg1)            │
  │    producer.send("topic-B", msg2)            │
  │    consumer.commitSync(offsets, transaction) │
  │  commitTransaction()  ← atomic               │
  └─────────────────────────────────────────────┘
         ▼ on crash before commit
  abortTransaction() — none of the above is visible`,
        code: `// Exactly-once producer setup
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-producer-1"); // unique per instance

producer.initTransactions();

try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("topic-A", key, value1));
    producer.send(new ProducerRecord<>("topic-B", key, value2));
    // Commit consumer offset as part of the transaction (read-process-write)
    producer.sendOffsetsToTransaction(offsets, consumerGroupMetadata);
    producer.commitTransaction();
} catch (ProducerFencedException e) {
    producer.close(); // another instance took over
} catch (KafkaException e) {
    producer.abortTransaction(); // safe rollback
}

// Consumer side: only see committed messages
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");`,
      },
    ],
  },
  {
    id: "kafka-architecture",
    title: "3. Architecture & Modern Trends",
    icon: "🏗️",
    subtopics: [
      {
        id: "kraft",
        title: "KRaft (No ZooKeeper)",
        content: `KRaft (Kafka Raft) is Kafka's built-in consensus protocol, replacing ZooKeeper for metadata management as of Kafka 3.3 (GA) and made mandatory in Kafka 4.0.\n\nWhy ZooKeeper was removed:\n• ZooKeeper capped practical partition count at ~200k; KRaft scales to millions.\n• Leader election with ZooKeeper could take 30–60s on large clusters; KRaft brings this down to seconds.\n• Operational simplicity — no separate ZooKeeper cluster to deploy, monitor, and secure.\n\nIn KRaft mode, a quorum of brokers (the controller quorum) runs the Raft consensus algorithm to elect a controller and replicate the cluster metadata log.`,
        diagram: `
  Old (ZooKeeper mode):
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ Broker 1 │    │ Broker 2 │    │ Broker 3 │
  └────┬─────┘    └────┬─────┘    └────┬─────┘
       └───────────────┼───────────────┘
                       ▼
              ┌────────────────┐
              │   ZooKeeper    │  ← separate cluster to manage
              └────────────────┘

  New (KRaft mode):
  ┌────────────────────────────────────────┐
  │          Kafka Cluster                  │
  │  ┌──────────┐  ┌──────────┐            │
  │  │Controller│  │Controller│  (quorum)  │
  │  │ Broker 1 │  │ Broker 2 │            │
  │  └──────────┘  └──────────┘            │
  │       ┌─────────────────┐              │
  │       │  Broker 3,4,... │ (data only)  │
  │       └─────────────────┘              │
  └────────────────────────────────────────┘`,
        code: `# kraft/server.properties — minimal KRaft config
process.roles=broker,controller          # this node is both
node.id=1
controller.quorum.voters=1@localhost:9093,2@host2:9093,3@host3:9093
listeners=PLAINTEXT://:9092,CONTROLLER://:9093
log.dirs=/var/kafka/data

# Format storage (replaces zookeeper-server-start.sh)
kafka-storage.sh format -t $(kafka-storage.sh random-uuid) -c server.properties`,
      },
      {
        id: "log-compaction",
        title: "Log Compaction",
        content: `Log compaction is an alternative retention policy. Instead of deleting old data by time or size, Kafka retains the last known value for each key in a partition. Older records with the same key are removed during background compaction.\n\nWhen to use it: topics that represent the current state of an entity — e.g., a user-profile topic where key=userId. A consumer that starts from the beginning will see the latest value for every key, effectively "restoring state."\n\nA tombstone (null value) tells Kafka to delete that key entirely during the next compaction cycle.`,
        diagram: `
  Before compaction (key : value):
  [ A:1 | B:10 | A:2 | C:5 | B:20 | A:3 | C:null ]
    old                                         new ──►

  After compaction:
  [ A:3 | B:20 ]   ← C was tombstoned (null), deleted
                     only latest value per key survives`,
        code: `// Enable log compaction on a topic
kafka-topics.sh --create \\
  --topic user-profiles \\
  --config cleanup.policy=compact \\
  --config min.cleanable.dirty.ratio=0.1 \\
  --config segment.ms=60000

// Sending a tombstone (delete a key)
ProducerRecord<String, String> tombstone =
    new ProducerRecord<>("user-profiles", "user-42", null); // null value = tombstone
producer.send(tombstone);`,
      },
      {
        id: "rebalance",
        title: "Rebalance & Static Membership",
        content: `A rebalance occurs when the partition assignment within a consumer group changes — triggered by a consumer joining, leaving, or timing out.\n\nDuring a rebalance, all consumers stop processing (stop-the-world). In large groups or those with slow startup, this causes significant lag spikes.\n\nStatic Group Membership (group.instance.id) solves this: when a consumer restarts with the same instance ID, it reclaims its previous partitions without triggering a group-wide rebalance — provided it returns before session.timeout.ms expires.`,
        diagram: `
  Dynamic membership (default) — restart triggers full rebalance:
  Consumer C restarts → LEAVE → REBALANCE (all stop) → REJOIN → REBALANCE again

  Static membership (group.instance.id set):
  Consumer C restarts → session timer running...
    returns within session.timeout.ms → reclaims same partitions, NO rebalance
    exceeds session.timeout.ms        → full rebalance triggered`,
        code: `// Static group membership — prevents rebalance on short restarts
props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-svc");
props.put(ConsumerConfig.GROUP_INSTANCE_ID_CONFIG, "order-svc-pod-3"); // unique & stable per instance
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, "60000"); // give pod 60s to restart

// Incremental Cooperative Rebalancing (Kafka 2.4+)
// Avoids stop-the-world: only partitions being moved are paused
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
    CooperativeStickyAssignor.class.getName());`,
      },
    ],
  },
  {
    id: "kafka-troubleshooting",
    title: "4. Scenario-Based / Troubleshooting",
    icon: "🔧",
    subtopics: [
      {
        id: "consumer-lag",
        title: "Consumer Lag",
        content: `Consumer lag = log-end-offset minus committed-offset for a partition. It measures how far behind a consumer is from the latest messages.\n\nTroubleshooting steps:\n1. Check lag metrics — use kafka-consumer-groups.sh or Kafka's JMX metrics / Grafana.\n2. Check partition count — if consumers == partitions already, you cannot scale by adding more consumers.\n3. Check poll() loop duration — if processing per batch takes longer than max.poll.interval.ms, the broker removes the consumer from the group (triggers rebalance). Slow DB calls or external API calls are common culprits.\n4. Tune max.poll.records — reduce the batch size to lower per-poll processing time, or optimize the processing code itself.`,
        diagram: `
  Partition 0:
  ┌──────────────────────────────────────────┐
  │ 0  1  2  3  4  5  6  7  8  9  10  11   │
  └──────────────────────────────────────────┘
                    ▲                    ▲
            committed offset=5    log-end-offset=11

  Consumer Lag = 11 - 5 = 6 messages behind

  kafka-consumer-groups.sh --describe --group order-svc
  GROUP      TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
  order-svc  orders  0          5               11              6`,
        code: `# Check consumer lag from CLI
kafka-consumer-groups.sh \\
  --bootstrap-server broker1:9092 \\
  --describe \\
  --group order-svc

# Reset offsets to latest (skip backlog — use with caution)
kafka-consumer-groups.sh \\
  --bootstrap-server broker1:9092 \\
  --group order-svc \\
  --topic orders \\
  --reset-offsets --to-latest --execute

// Tune poll settings to avoid max.poll.interval.ms breach
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "100");        // smaller batch
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "300000"); // 5 min processing window`,
      },
      {
        id: "message-ordering",
        title: "Message Ordering",
        content: `Kafka guarantees strict ordering only within a single partition. Across partitions, there is no ordering guarantee.\n\nTo ensure all events for a specific entity (e.g., a user) are ordered, use a Partition Key. All records with the same key are routed to the same partition via consistent hashing.\n\nCaution: hot partitions — if one key has significantly more traffic than others, that partition's consumer will become a bottleneck. Choose keys with high cardinality (e.g., userId, orderId) rather than low-cardinality keys (e.g., country, event-type).`,
        diagram: `
  Producer sends events for user-42 and user-99:

  key=user-42  ──hash──►  Partition 2  → [ev1, ev2, ev3]  (ordered)
  key=user-99  ──hash──►  Partition 0  → [ev1, ev2]        (ordered)

  Within each partition: strict order guaranteed
  Across partitions: no global order

  Hot partition problem:
  key="US"  ──► Partition 1  [▓▓▓▓▓▓▓▓▓▓▓▓▓▓]  ← overloaded
  key="CA"  ──► Partition 2  [▓]
  key="AU"  ──► Partition 0  [▓▓]`,
        code: `// Route all events for a user to the same partition
ProducerRecord<String, String> record = new ProducerRecord<>(
    "user-events",   // topic
    "user-42",       // key → determines partition
    eventJson        // value
);
producer.send(record);

// Custom partitioner — e.g., route VIP users to dedicated partitions
public class VipPartitioner implements Partitioner {
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                         Object value, byte[] valueBytes, Cluster cluster) {
        int numPartitions = cluster.partitionCountForTopic(topic);
        if (key.toString().startsWith("vip-")) {
            return 0; // VIP traffic always goes to partition 0
        }
        return Math.abs(Utils.murmur2(keyBytes)) % (numPartitions - 1) + 1;
    }
}`,
      },
    ],
  },
];