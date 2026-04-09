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
        id: "schema-registry",
        title: "Schema Registry & Avro",
        content: `A Schema Registry is a centralised store for event schemas (Avro, Protobuf, or JSON Schema). Producers register a schema before publishing; consumers fetch the schema to deserialise. This enforces a contract between producers and consumers and enables safe schema evolution.\n\nHow it works: the producer serialises the payload as Avro bytes prefixed with a magic byte (0x00) and the 4-byte schema ID. The consumer reads the schema ID, fetches the schema from the registry, and deserialises.\n\nCompatibility modes (set per subject):\n• BACKWARD (default) — new schema can read data written by old schema. Safe to deploy consumers first.\n• FORWARD — old schema can read data written by new schema. Safe to deploy producers first.\n• FULL — both directions. Safest, most restrictive.\n• NONE — no compatibility check. Dangerous in production.\n\nRule of thumb: adding an optional field with a default is BACKWARD compatible. Removing a field is FORWARD compatible. Renaming a field is BREAKING under all modes — use aliases instead.`,
        diagram: `
  Producer                Schema Registry              Consumer
      │                         │                          │
      │  register schema v1     │                          │
      │────────────────────────►│                          │
      │  ← schema_id = 42       │                          │
      │                         │                          │
      │  send: [0x00][id=42][avro bytes]                   │
      │──────────────────────────────────────────────────► broker
      │                         │                          │
      │                         │    fetch schema id=42    │
      │                         │◄─────────────────────────│
      │                         │    return schema v1      │
      │                         │─────────────────────────►│
      │                         │                          │ deserialise

  Compatibility: adding optional field (safe ✅)
    v1: { name: string }
    v2: { name: string, email: string (default: "") }
    Old consumer reads v2 data → ignores email field ✅

  Renaming a field (breaking ❌ — use alias instead)
    v2: { fullName: string }  ← breaks old consumers expecting "name"`,
        code: `// Maven dependency
// <artifactId>kafka-avro-serializer</artifactId> (Confluent)

// Producer with Avro serialiser
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, KafkaAvroSerializer.class);
props.put("schema.registry.url", "http://schema-registry:8081");

// Avro schema (OrderPlaced.avsc)
// {
//   "type": "record", "name": "OrderPlaced", "namespace": "com.investment.orders.v1",
//   "fields": [
//     { "name": "orderId",     "type": "string" },
//     { "name": "portfolioId", "type": "string" },
//     { "name": "amount",      "type": "double" },
//     { "name": "currency",    "type": "string", "default": "EUR" }  ← optional, backward compat
//   ]
// }

// Check compatibility before deploying
curl -X POST http://schema-registry:8081/compatibility/subjects/orders.placed-value/versions/latest \\
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \\
  -d '{"schema": "{...new schema json...}"}'
// Response: { "is_compatible": true }

// Set compatibility mode per subject
curl -X PUT http://schema-registry:8081/config/orders.placed-value \\
  -d '{"compatibility": "FULL"}'`,
      },
      {
        id: "producer-internals",
        title: "Producer Internals",
        content: `Understanding how records flow through the producer is essential for tuning throughput and latency.\n\nFlow: send() → Serialiser → Partitioner → RecordAccumulator (in-memory buffer per partition) → Sender thread → NetworkClient → Broker\n\nKey configs:\n• batch.size (default 16KB) — max bytes per batch per partition. Larger = better throughput, more memory.\n• linger.ms (default 0) — how long the sender waits for a batch to fill before sending. 0 = send immediately (low latency). 5–20ms = better batching (higher throughput).\n• buffer.memory (default 32MB) — total memory for all batched records. If full, send() blocks for max.block.ms then throws.\n• compression.type — none / gzip / snappy / lz4 / zstd. lz4 is the best balance of CPU and ratio for most cases.\n• max.in.flight.requests.per.connection (default 5) — how many unacknowledged requests per broker. Set to 1 for strict ordering without idempotence; with enable.idempotence=true, up to 5 is safe.\n\nLow-latency tuning: linger.ms=0, batch.size small, acks=1\nHigh-throughput tuning: linger.ms=10–20, batch.size=65536+, compression.type=lz4, acks=all`,
        diagram: `
  Application Thread          Sender Thread (background)
  ──────────────────          ──────────────────────────
  producer.send(record)
       │
       ▼
  Serialise key + value
       │
       ▼
  Partitioner (hash key → partition N)
       │
       ▼
  RecordAccumulator
  ┌─────────────────────────────────────┐
  │  Partition 0 batch: [r1][r2][r3]   │ ← filling up (batch.size)
  │  Partition 1 batch: [r4]           │
  │  Partition 2 batch: [r5][r6]       │
  └─────────────────────────────────────┘
       │ linger.ms elapsed OR batch full
       ▼
  Sender drains batch → NetworkClient → Broker
                                         │
                                   ACK (acks config)
                                         │
                                   ProduceCallback fired`,
        code: `// High-throughput producer config
Properties props = new Properties();
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 65536);           // 64KB batches
props.put(ProducerConfig.LINGER_MS_CONFIG, 10);               // wait 10ms to fill batch
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "lz4");     // fast compression
props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, 67108864L);    // 64MB buffer
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);

// Low-latency producer config (e.g. real-time trading signals)
props.put(ProducerConfig.LINGER_MS_CONFIG, 0);                // send immediately
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 16384);           // default, small
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "none");
props.put(ProducerConfig.ACKS_CONFIG, "1");                   // leader only

// Async send with callback — never block the application thread on acks
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        log.error("Failed to send record to {}-{}", metadata.topic(), metadata.partition(), exception);
        // handle: retry, DLQ, alert
    }
});`,
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
        id: "dlq",
        title: "Dead Letter Queue (DLQ)",
        content: `A Dead Letter Queue is a topic that receives messages a consumer cannot process after exhausting retries. Instead of blocking the partition (retry forever) or silently dropping the message, the consumer routes it to a .dlq topic for manual inspection and reprocessing.\n\nWhen to send to DLQ:\n• Deserialisation failure — schema mismatch, corrupt bytes\n• Validation failure — message violates business rules\n• Downstream system unavailable for too long — after N retries with back-off\n• Poison pill — a message that always causes the consumer to crash\n\nDLQ naming convention: mirror the source topic name, e.g. orders.placed → orders.placed.dlq\n\nReprocessing: once the root cause is fixed, replay DLQ messages back to the original topic. Never replay blindly — inspect first.\n\nCritical: without a DLQ, a single bad message can halt all processing on that partition forever (consumer stops, lag grows, alerts fire). The DLQ trades perfect correctness for availability — a conscious, documented trade-off.`,
        diagram: `
  Normal flow:
  orders.placed → [Consumer] → process → commit offset

  Poison pill message:
  orders.placed  [msg1][msg2][POISON][msg4][msg5]
                              │
                 deserialise fails (3 retries)
                              │
                              ▼
                  orders.placed.dlq
                  [POISON + metadata: topic, partition, offset, error]

                 commit offset past POISON
                              │
                              ▼
                 [msg4][msg5] processed normally ✅

  DLQ message envelope:
  {
    "originalTopic":     "orders.placed",
    "originalPartition": 2,
    "originalOffset":    1047,
    "errorMessage":      "Schema deserialization failed: unknown field 'correlationId'",
    "errorTimestamp":    "2024-11-14T10:22:31Z",
    "retryCount":        3,
    "originalPayload":   "<raw bytes as base64>"
  }`,
        code: `// Consumer with DLQ routing
@Component
public class OrderConsumer {

    private final KafkaProducer<String, String> dlqProducer;
    private static final String DLQ_TOPIC = "orders.placed.dlq";
    private static final int MAX_RETRIES = 3;

    private void processWithDlq(ConsumerRecord<String, String> record) {
        int attempts = 0;
        while (attempts < MAX_RETRIES) {
            try {
                processOrder(record.value());
                return; // success
            } catch (DeserialisationException e) {
                // Permanent failure — no point retrying
                sendToDlq(record, e, attempts);
                return;
            } catch (TransientException e) {
                attempts++;
                if (attempts >= MAX_RETRIES) {
                    sendToDlq(record, e, attempts);
                    return;
                }
                sleep(backoff(attempts)); // exponential back-off
            }
        }
    }

    private void sendToDlq(ConsumerRecord<String, String> record, Exception e, int retries) {
        String envelope = """
            {
              "originalTopic": "%s", "originalPartition": %d,
              "originalOffset": %d,  "retryCount": %d,
              "errorMessage": "%s",   "originalPayload": "%s"
            }
            """.formatted(record.topic(), record.partition(),
                          record.offset(), retries,
                          e.getMessage(), record.value());

        dlqProducer.send(new ProducerRecord<>(DLQ_TOPIC, record.key(), envelope));
        log.warn("Sent to DLQ: topic={} partition={} offset={}",
            record.topic(), record.partition(), record.offset());
    }
}

# Replay DLQ back to original topic (after fix deployed)
kafka-console-consumer.sh --topic orders.placed.dlq --from-beginning \\
  | kafka-console-producer.sh --topic orders.placed`,
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
        id: "tiered-storage",
        title: "Tiered Storage",
        content: `Tiered Storage (GA in Kafka 3.6) separates hot data from cold data. Recent messages stay on the broker's local disk (fast, expensive); older segments are offloaded to cheap object storage (S3, GCS, Azure Blob). Brokers serve recent reads from local disk; older reads are fetched transparently from object storage.\n\nWhy it matters:\n• Decouples retention from broker disk size — you can retain 7 years of orders.executed without huge brokers.\n• Broker scaling becomes compute/throughput-based, not storage-based.\n• Disaster recovery: re-bootstrap a broker from object storage instead of replicating from peers.\n\nTrade-off: read latency for cold data increases (object storage is slower than local SSD). Not suitable for consumers that regularly read old data at high frequency.\n\nTypical use cases: regulatory retention (7-year orders), audit logs, re-processing pipelines that read old history infrequently.`,
        diagram: `
  Without Tiered Storage:
  Broker disk must hold ALL retained data
  orders.executed (7yr retention) = 50TB per broker ❌ expensive

  With Tiered Storage:
  ┌────────────────────────────────────────────┐
  │  Broker (local disk — hot tier)            │
  │  [last 7 days of segments]  ~500GB         │
  └──────────────────┬─────────────────────────┘
                     │  background upload (async)
                     ▼
  ┌────────────────────────────────────────────┐
  │  Object Storage (cold tier)                │
  │  S3 / GCS / Azure Blob                     │
  │  [segments older than 7 days] — years      │
  │  Cost: ~$0.023/GB/month vs $0.10+ on EBS   │
  └────────────────────────────────────────────┘

  Consumer fetching offset=2019:
  Broker checks → not on local disk
              → fetches from S3 transparently
              → serves to consumer (extra latency ~50-200ms)`,
        code: `# Enable tiered storage on a topic (server.properties)
remote.log.storage.system.enable=true
remote.log.storage.manager.class.name=org.apache.kafka.server.log.remote.storage.RemoteLogStorageManager

# S3 remote storage plugin config
remote.log.storage.manager.impl.prefix=rlsm.
rlsm.s3.bucket=my-kafka-tiered-storage
rlsm.s3.region=eu-west-1

# Per-topic: local retention 7 days, remote retention 7 years
kafka-topics.sh --alter --topic orders.executed \\
  --config remote.storage.enable=true \\
  --config local.retention.ms=604800000 \\
  --config retention.ms=220752000000`,
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
        id: "under-replicated-partitions",
        title: "Under-Replicated Partitions",
        content: `An Under-Replicated Partition (URP) is a partition where one or more replicas are not in sync with the leader. This is one of the most important Kafka health metrics to monitor — a sustained URP count above zero means your cluster is at risk of data loss if a leader fails.\n\nCommon causes:\n• Broker is slow (GC pauses, disk I/O saturation) — replica falls behind, gets removed from ISR\n• Broker is down — all its partitions become under-replicated\n• Network congestion between brokers — replication traffic delayed\n• Topic replication factor > available brokers — impossible to satisfy\n\nTriage steps:\n1. Check kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions JMX metric. Alert if > 0 for more than 30s.\n2. Identify which broker is lagging: kafka-topics.sh --describe shows ISR per partition.\n3. Check broker GC logs, disk I/O (iostat), and network.\n4. If broker is down: let it restart and catch up — preferred replica election runs automatically.\n5. If disk is full: add capacity or reduce retention. A full disk stops replication entirely.`,
        diagram: `
  Healthy: RF=3, all in ISR
  Partition 0: Leader=Broker1, ISR=[1,2,3]  ✅

  Under-replicated: Broker3 fell behind
  Partition 0: Leader=Broker1, ISR=[1,2]   ← Broker3 removed from ISR
              Replicas=[1,2,3]
  URP count = 1  ← alert fires

  Risk: if Broker1 dies now, only Broker2 is eligible for leader
        Broker3 would lose messages it missed while lagging

  Preferred replica election (rebalances leadership):
  kafka-leader-election.sh --election-type PREFERRED \\
    --bootstrap-server broker1:9092 --all-topic-partitions`,
        code: `# Monitor URPs via CLI
kafka-topics.sh --bootstrap-server broker1:9092 \\
  --describe --under-replicated-partitions

# Output example:
# Topic: orders  Partition: 2  Leader: 1  Replicas: 1,2,3  Isr: 1,2
#                                                            ↑ Broker3 missing from ISR

# JMX metric to alert on (Prometheus / Grafana)
# kafka_server_replica_manager_under_replicated_partitions > 0

# Check which broker is causing the most URPs
kafka-topics.sh --bootstrap-server broker1:9092 --describe \\
  | grep -v "Isr:.*Replicas" \\  # lines where ISR != Replicas
  | awk '{print $8}' | sort | uniq -c | sort -rn

# Trigger preferred replica election to rebalance leaders after broker recovery
kafka-leader-election.sh \\
  --bootstrap-server broker1:9092 \\
  --election-type PREFERRED \\
  --all-topic-partitions`,
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
  {
    id: "kafka-streams",
    title: "5. Kafka Streams",
    icon: "🌊",
    subtopics: [
      {
        id: "kstream-ktable",
        title: "KStream vs KTable",
        content: `Kafka Streams is a client library for building stateful, fault-tolerant stream processing applications. No separate cluster needed — it runs inside your Java application.\n\nKStream — an unbounded stream of records. Every record is an independent event. Suitable for click events, transactions, price ticks. Think: append-only log.\n\nKTable — a changelog stream. Each record represents the latest value for a key — older values for the same key are superseded. Backed by a local RocksDB state store. Think: materialised view of the latest state per key.\n\nGlobalKTable — like KTable but replicated to every instance of the application (not partitioned). Use for small reference data (e.g. product catalogue, currency rates) that needs to be joined with every partition of a KStream without repartitioning.\n\nKey difference: if you send key="user-42" twice to a KStream, you get two records. To a KTable, you get one record — the latest value for "user-42".`,
        diagram: `
  KStream (event stream — every record counts):
  key=A val=1 → key=B val=2 → key=A val=3 → key=C val=4
  Materialised: [A:1, B:2, A:3, C:4]  ← all events

  KTable (changelog — latest value per key):
  key=A val=1 → key=B val=2 → key=A val=3
  Materialised: { A: 3, B: 2 }  ← A updated, only latest kept

  KTable backed by RocksDB (local state store):
  ┌─────────────────────────────────┐
  │  Kafka Streams App (instance 1) │
  │  partitions: [0, 1]             │
  │  RocksDB: { A:3, B:2, ... }     │  ← local to this instance
  └─────────────────────────────────┘
  ┌─────────────────────────────────┐
  │  Kafka Streams App (instance 2) │
  │  partitions: [2, 3]             │
  │  RocksDB: { C:4, D:1, ... }     │  ← different keys
  └─────────────────────────────────┘`,
        code: `// Build a KStream and KTable from Kafka topics
StreamsBuilder builder = new StreamsBuilder();

// KStream: every order event
KStream<String, Order> ordersStream = builder.stream(
    "orders.placed",
    Consumed.with(Serdes.String(), orderSerde)
);

// KTable: latest portfolio state per portfolioId
KTable<String, Portfolio> portfolioTable = builder.table(
    "portfolio.state",
    Consumed.with(Serdes.String(), portfolioSerde),
    Materialized.as("portfolio-store")   // named state store — queryable via IQ
);

// Simple stream processing: filter + map + send to new topic
ordersStream
    .filter((portfolioId, order) -> order.getAmount() > 1000.0)
    .mapValues(order -> enrichWithRisk(order))
    .to("orders.enriched", Produced.with(Serdes.String(), enrichedOrderSerde));

// Start the streams app
KafkaStreams streams = new KafkaStreams(builder.build(), streamsConfig);
streams.start();
Runtime.getRuntime().addShutdownHook(new Thread(streams::close));`,
      },
      {
        id: "windowing",
        title: "Stateful Operations & Windowing",
        content: `Stateful operations maintain state across records — aggregations, counts, joins. The state is stored in a local RocksDB store, which is backed by a Kafka changelog topic for fault tolerance. On restart, the app replays the changelog to rebuild state.\n\nWindow types:\n• Tumbling window — fixed, non-overlapping time buckets. E.g. "count orders per minute". Each event belongs to exactly one window.\n• Hopping window — fixed size, overlapping. E.g. "count orders in the last 5 minutes, updated every 1 minute". One event can belong to multiple windows.\n• Session window — dynamic, inactivity-gap based. E.g. "group events with < 30s gap into a session". Useful for user sessions.\n• Sliding window — continuous window that moves with each new event. Used in joins.\n\nOut-of-order events: Kafka Streams handles late arrivals via grace periods. Records arriving after the window closed but within the grace period are still included.`,
        diagram: `
  Tumbling window (size=1min, no overlap):
  |── 10:00–10:01 ──|── 10:01–10:02 ──|── 10:02–10:03 ──|
       [e1,e2,e3]         [e4,e5]           [e6]

  Hopping window (size=3min, advance=1min):
  |──── 10:00–10:03 ────|
       |──── 10:01–10:04 ────|
            |──── 10:02–10:05 ────|
  e1 appears in all 3 windows

  Session window (inactivity gap=30s):
  e1──e2──e3   [30s gap]   e4──e5──e6
  └── session 1 ──┘        └── session 2 ──┘`,
        code: `// Count orders per portfolio per 1-minute tumbling window
KStream<String, Order> orders = builder.stream("orders.placed", ...);

KTable<Windowed<String>, Long> orderCountPerMinute = orders
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(1)))
    .count(Materialized.as("order-count-store"));

orderCountPerMinute
    .toStream()
    .map((windowedKey, count) -> KeyValue.pair(
        windowedKey.key(),
        new WindowedCount(windowedKey.window().startTime(), count)
    ))
    .to("order-counts.per-minute");

// Aggregation: sum order amounts per portfolio per hour
KTable<Windowed<String>, Double> hourlyVolume = orders
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofHours(1)))
    .aggregate(
        () -> 0.0,                                          // initialiser
        (portfolioId, order, total) -> total + order.getAmount(), // aggregator
        Materialized.<String, Double, WindowStore<Bytes, byte[]>>as("hourly-volume-store")
            .withValueSerde(Serdes.Double())
    );

// Session window: group user activity sessions
KTable<Windowed<String>, Long> sessions = clickStream
    .groupByKey()
    .windowedBy(SessionWindows.ofInactivityGapWithNoGrace(Duration.ofMinutes(30)))
    .count();`,
      },
      {
        id: "stream-table-join",
        title: "Stream–Table Join",
        content: `A Stream–Table join enriches every event in a KStream with the current value from a KTable — without repartitioning, since both are co-partitioned by the same key.\n\nUse case: enrich each order event with the current portfolio's risk profile, or each payment with the customer's account status.\n\nJoin types in Kafka Streams:\n• KStream–KTable (inner) — only emit if the key exists in the KTable at the time the stream event arrives\n• KStream–KTable (left join) — always emit; null if key missing from KTable\n• KStream–KStream — windowed join; both streams must have a matching event within a time window\n• KTable–KTable — produces a new KTable; updates whenever either side changes\n\nCo-partitioning requirement: KStream and KTable must have the same number of partitions and the same partitioner, so matching keys land on the same Streams task. If not, Kafka Streams throws a TopologyException. Fix: repartition one side with .repartition() or use GlobalKTable.`,
        diagram: `
  Stream-Table join (enrich order with portfolio risk profile):

  orders.placed (KStream):            portfolio.state (KTable):
  key=pfol-1 order=BUY AAPL  ──►     key=pfol-1 → { risk: BALANCED }
                                 join │
                                      ▼
                             enriched order:
                             { order: BUY AAPL, riskProfile: BALANCED }

  KStream–KStream windowed join:
  payments stream ──────────────────────────────────────►
  fraud-signals stream ─────────────────────────────────►
  window=5min: match payment+fraud-signal by transactionId
               emit only if both arrive within 5 minutes`,
        code: `// KStream–KTable join: enrich each order with portfolio risk profile
KStream<String, Order> orders = builder.stream("orders.placed", ...);
KTable<String, Portfolio> portfolios = builder.table("portfolio.state", ...);

KStream<String, EnrichedOrder> enriched = orders.join(
    portfolios,
    (order, portfolio) -> {
        if (portfolio == null) return EnrichedOrder.withoutProfile(order); // left join
        return EnrichedOrder.of(order, portfolio.getRiskProfile());
    }
);
enriched.to("orders.enriched");

// KStream–KStream windowed join: match payments with fraud signals
KStream<String, Payment>     payments     = builder.stream("payments");
KStream<String, FraudSignal> fraudSignals = builder.stream("fraud.signals");

KStream<String, SuspiciousPayment> flagged = payments.join(
    fraudSignals,
    (payment, signal) -> new SuspiciousPayment(payment, signal),
    JoinWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(5)),
    StreamJoined.with(Serdes.String(), paymentSerde, fraudSerde)
);
flagged.to("payments.suspicious");

// Interactive Query: read state store directly from the app (no Kafka round-trip)
ReadOnlyWindowStore<String, Long> store = streams.store(
    StoreQueryParameters.fromNameAndType("order-count-store",
        QueryableStoreTypes.windowStore())
);
WindowStoreIterator<Long> it = store.fetch("pfol-1",
    Instant.now().minus(Duration.ofMinutes(5)), Instant.now());
while (it.hasNext()) {
    KeyValue<Long, Long> entry = it.next();
    System.out.println("window=" + entry.key + " count=" + entry.value);
}`,
      },
    ],
  },
];