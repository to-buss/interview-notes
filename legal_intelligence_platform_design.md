# Legal Intelligence Content Platform — HLD & LLD

> **Stack:** Java 17+, Spring Boot 3, Apache Kafka, Kafka Streams, Azure Event Grid, AWS S3, OpenTelemetry, Kubernetes

---

## Table of Contents
1. [System Overview](#system-overview)
2. [High-Level Design (HLD)](#high-level-design)
3. [Low-Level Design (LLD)](#low-level-design)
4. [Key Integration Patterns](#key-integration-patterns)
5. [Key Challenges](#key-challenges)

---

## System Overview

The Legal Intelligence Content Platform ingests legal and regulatory content from two external vendor systems, enriches it through a set of domain-specific microservices, computes statistics via streaming, and persists final documents to object storage. All services are event-driven, deployed on Kubernetes, and observable via OpenTelemetry.

---

## High-Level Design

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL VENDORS                                   │
│                                                                             │
│   ┌──────────────────┐          ┌──────────────────┐                        │
│   │   Vendor System A│          │   Vendor System B│                        │
│   └────────┬─────────┘          └────────┬─────────┘                        │
└────────────│────────────────────────────│────────────────────────────────────┘
             │  Push events               │  Push events
             └──────────────┬─────────────┘
                            ▼
               ┌────────────────────────┐
               │   Azure Event Grid     │  ← Managed event broker (vendor-facing)
               └───────────┬────────────┘
                            │  HTTP webhook / Event Grid trigger
                            ▼
               ┌────────────────────────┐
               │  Ingestion Service     │  ← Spring Boot 3, validates & transforms
               │  (Event Grid Adapter)  │    vendor payload → canonical schema
               └───────────┬────────────┘
                            │  Produce
                            ▼
               ┌────────────────────────┐
               │  Kafka: raw-content    │  ← Partitioned by content-id
               └───────┬───────┬────────┘
                        │       │
           ┌────────────┘       └────────────┐
           │  Subscribe                       │  Subscribe
           ▼                                  ▼
┌─────────────────────┐            ┌─────────────────────┐
│  Content Enricher   │            │   Link Enricher      │
│  (Spring Boot 3)    │            │   (Spring Boot 3)    │
│                     │            │                      │
│ - Fetches full doc  │            │ - Resolves internal  │
│   from vendor API   │            │   & external links   │
│ - Saves to S3       │            │ - Validates URLs      │
│ - Publishes to      │            │ - Publishes to       │
│   enriched-content  │            │   link-events        │
└────────┬────────────┘            └──────────┬──────────┘
         │                  ┌─────────────────┘
         │  (run in parallel, both subscribe to raw-content)
         ▼                  ▼
    ┌───────────────────────────┐
    │  Kafka: enriched-content  │  ← Merged enriched events
    └──────────────┬────────────┘
                   │  Subscribe
                   ▼
      ┌────────────────────────┐
      │   Metadata Generator   │  ← Runs after enrichment
      │   (Spring Boot 3)      │     - Extracts tags, entities, jurisdiction
      │                        │     - Generates searchable metadata
      │                        │     - Publishes to metadata-events
      └────────────┬───────────┘
                   │
                   ▼
      ┌────────────────────────┐
      │  Kafka: metadata-events│
      └────────────────────────┘

      ┌─────────────────────────────────────────┐
      │         Kafka Streams — Stats Engine    │
      │                                         │
      │  Consumes: raw-content, enriched-content│
      │            metadata-events, link-events  │
      │  Computes: ingestion rate, enrichment   │
      │            lag, link health, doc counts  │
      │  Output:   stats-topic (KTable)         │
      └─────────────────────────────────────────┘

      ┌─────────────────────────────────────────┐
      │              AWS S3                     │
      │  /raw/{vendor}/{content-id}             │
      │  /enriched/{content-id}/document        │
      │  /enriched/{content-id}/metadata.json   │
      └─────────────────────────────────────────┘

      ┌─────────────────────────────────────────┐
      │        Kubernetes + OpenTelemetry       │
      │  - Each service exports traces & metrics│
      │  - OTel Collector → Grafana / Jaeger    │
      │  - HPA on consumer lag metrics          │
      └─────────────────────────────────────────┘
```

### Component Responsibilities

| Component              | Role                                                                 | Produces To          |
|------------------------|----------------------------------------------------------------------|----------------------|
| Ingestion Service      | Adapts Event Grid webhooks → canonical Kafka events                 | `raw-content`        |
| Content Enricher       | Fetches full document from vendor, saves to S3                      | `enriched-content`   |
| Link Enricher          | Resolves and validates all hyperlinks in the content                | `link-events`        |
| Metadata Generator     | Extracts structured metadata from enriched content                  | `metadata-events`    |
| Kafka Streams Engine   | Real-time aggregation: counts, lag, link health stats               | `stats-topic`        |

---

## Low-Level Design

### Kafka Topic Design

```
Topic: raw-content
  Partitions : 12  (keyed by content-id for ordering per document)
  Retention  : 7 days
  Schema     : Avro — RawContentEvent
    { content_id, vendor_id, event_type, payload_url, received_at, schema_version }

Topic: enriched-content
  Partitions : 12
  Retention  : 14 days
  Schema     : Avro — EnrichedContentEvent
    { content_id, vendor_id, s3_key, enrichment_status, enriched_at }

Topic: link-events
  Partitions : 6
  Retention  : 3 days
  Schema     : Avro — LinkEvent
    { content_id, links: [{ url, status, resolved_url }], processed_at }

Topic: metadata-events
  Partitions : 12
  Retention  : 30 days
  Schema     : Avro — MetadataEvent
    { content_id, tags[], jurisdiction, doc_type, language, entity_refs[], indexed_at }

Topic: raw-content-dlq          ← Dead letter for ingestion failures
Topic: enriched-content-dlq     ← Dead letter for enrichment failures

Topic: stats-topic (KTable)
  Compacted, keyed by stat_key
  Schema     : { stat_key, value, window_start, window_end, updated_at }
```

### Ingestion Service — Event Grid Adapter

```
Azure Event Grid Webhook (HTTP POST)
         │
         ▼
  @RestController /events
         │
  ┌──────┴───────────────────────────────┐
  │  1. Validate Event Grid signature    │
  │  2. Deserialise vendor payload       │
  │  3. Map to RawContentEvent (Avro)    │
  │  4. Idempotency check (Redis/DB)     │
  │     if duplicate → ack & discard     │
  │  5. KafkaTemplate.send(             │
  │       "raw-content",                 │
  │       content_id,   ← partition key │
  │       event)                         │
  │  6. Return 200 to Event Grid        │
  └──────────────────────────────────────┘

  Retry strategy: Event Grid retries for 24h with exponential backoff
  → Service must be idempotent on re-delivery
```

### Content Enricher — LLD

```
@KafkaListener(topics = "raw-content", groupId = "content-enricher")

For each RawContentEvent:
  1. Check enrichment-status cache (Redis) — skip if already processed
  2. Fetch document from vendor REST API (payload_url)
       - Retry: 3 attempts, exponential backoff, circuit breaker
  3. Transform to canonical document format
  4. Upload to S3:
       PUT s3://bucket/enriched/{content_id}/document.{ext}
  5. Publish EnrichedContentEvent → "enriched-content"
  6. On failure → publish to "raw-content-dlq" with error context

Consumer config:
  max.poll.records      = 50
  max.poll.interval.ms  = 300_000   (5 min — vendor API can be slow)
  enable.auto.commit    = false
  isolation.level       = read_committed
```

### Link Enricher — LLD

```
@KafkaListener(topics = "raw-content", groupId = "link-enricher")
← Runs in PARALLEL with Content Enricher (different consumer group)

For each RawContentEvent:
  1. Parse raw payload for all href / src links
  2. For each link (async, virtual threads / CompletableFuture):
       - HTTP HEAD request to resolve final URL
       - Classify: internal | external | broken
  3. Publish LinkEvent → "link-events"

Concurrency:
  - Virtual threads (Java 21) for I/O-bound link resolution
  - Semaphore to cap concurrent outbound HTTP calls (max 200)
```

### Metadata Generator — LLD

```
@KafkaListener(topics = "enriched-content", groupId = "metadata-generator")
← Downstream of Content Enricher

For each EnrichedContentEvent:
  1. Fetch enriched document from S3 (s3_key)
  2. Run NLP pipeline:
       - Language detection
       - Named entity recognition (jurisdiction, parties, dates)
       - Tag extraction (legal taxonomy)
       - Document type classification
  3. Save metadata JSON to S3:
       PUT s3://bucket/enriched/{content_id}/metadata.json
  4. Publish MetadataEvent → "metadata-events"
```

### Kafka Streams — Stats Topology

```java
// Simplified topology

KStream<String, RawContentEvent> raw =
    builder.stream("raw-content");

KStream<String, EnrichedContentEvent> enriched =
    builder.stream("enriched-content");

// Ingestion rate — tumbling window per vendor per minute
raw.groupBy((k, v) -> v.getVendorId())
   .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(1)))
   .count()
   .toStream()
   .to("stats-topic");

// Enrichment lag — time between raw received and enriched published
enriched.join(
    raw,
    (e, r) -> EnrichmentLag.of(e.getContentId(),
                                e.getEnrichedAt() - r.getReceivedAt()),
    JoinWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(10))
).to("stats-topic");

// Per-vendor doc count — KTable
KTable<String, Long> docCountByVendor =
    raw.groupBy((k, v) -> v.getVendorId()).count();
```

### S3 Layout

```
s3://legal-intelligence-content/
├── raw/
│   └── {vendor_id}/
│       └── {content_id}.json          ← original vendor payload
└── enriched/
    └── {content_id}/
        ├── document.pdf               ← full fetched document
        └── metadata.json             ← structured metadata output
```

### Observability — OTel + K8s

```yaml
# Each Spring Boot 3 service
management:
  tracing:
    sampling.probability: 1.0
  otlp:
    tracing.endpoint: http://otel-collector:4318/v1/traces
    metrics.export.url: http://otel-collector:4318/v1/metrics

# K8s HPA — scale on Kafka consumer lag
metrics:
  - type: External
    external:
      metric:
        name: kafka_consumergroup_lag
        selector:
          matchLabels:
            topic: raw-content
            group: content-enricher
      target:
        type: AverageValue
        averageValue: "1000"
```

---

## Key Integration Patterns

### 1. Event-Driven Choreography
Services react to Kafka events independently — no central orchestrator. Each service subscribes to its input topic, processes, and publishes to its output topic. Decouples producers from consumers; services can be scaled, replaced, or redeployed independently.

### 2. Parallel Consumer Groups
Content Enricher and Link Enricher both subscribe to `raw-content` under **different consumer groups**. Kafka delivers every event to both groups independently, achieving true parallel processing without coordination. Neither service waits for the other.

### 3. Idempotent Consumer
Each service checks a processed-ID cache (Redis) before processing. Vendors may re-deliver via Event Grid retry; Kafka at-least-once delivery means duplicates are possible. Guard: `if (cache.exists(contentId)) ack and return`.

### 4. Dead Letter Queue (DLQ)
On unrecoverable failure (vendor API down after retries, malformed payload), the event is forwarded to a `*-dlq` topic with error context. A separate DLQ processor handles alerting, manual reprocessing, and audit trails — keeping the main pipeline unblocked.

### 5. Claim-Check Pattern
Full document content is never passed through Kafka (messages kept small). Instead, the Content Enricher stores the document in S3 and publishes only the `s3_key` reference. Downstream services (Metadata Generator) fetch from S3 directly — avoids Kafka message size limits and broker pressure.

### 6. Kafka Streams for Real-Time Aggregation
Stateful streaming computations (enrichment lag, doc counts, ingestion rate) run as a Kafka Streams topology — co-located with the data, no separate batch job. KTables provide materialised views queryable via interactive queries.

### 7. Schema Registry + Avro
All Kafka messages use Avro schemas registered in a Schema Registry. Producers and consumers negotiate schema compatibility (BACKWARD compatible by default), enabling safe schema evolution without coordinated deployments.

---

## Key Challenges

### 1. Parallel Enrichment Without Coordination
Content Enricher and Link Enricher run concurrently on the same event. The Metadata Generator is downstream of Content Enricher only — but a full "document ready" state (both enrichments complete) needs a join. **Solution:** Use a Kafka Streams join on `enriched-content` + `link-events` with a time window to produce a `fully-enriched` event only when both are available.

### 2. Ordering vs. Parallelism
Kafka guarantees order within a partition. Partitioning by `content_id` ensures all events for a document go to the same partition and are processed in order per consumer group. However, parallel groups (Content + Link Enrichers) process the same event concurrently — downstream joins must be time-windowed to handle arrival skew.

### 3. Vendor API Reliability
Content Enricher fetches documents from external vendor APIs which can be slow or unavailable. **Solutions:** Circuit breaker (Resilience4j), retry with exponential backoff, `max.poll.interval.ms` set high enough for slow fetches, and DLQ routing on exhaustion — ensuring the consumer never times out and triggers a rebalance.

### 4. Exactly-Once Semantics
The pipeline uses Kafka transactional producers (`enable.idempotence=true`, `transactional.id` per instance) and `read_committed` isolation in consumers. Combined with idempotency checks, this prevents duplicate documents appearing in S3 or downstream topics on consumer restart.

### 5. Schema Evolution Across Services
Multiple services evolve independently. A change to `RawContentEvent` must not break existing consumers. **Solution:** Schema Registry enforces BACKWARD compatibility — new fields must have defaults, no fields removed. Services deploy independently; old consumers ignore unknown fields.

### 6. S3 Consistency and Latency
S3 is eventually consistent for LIST operations (though strongly consistent for PUT/GET since 2020). Metadata Generator fetches from S3 after Content Enricher writes — Kafka event ordering ensures the write happens before the downstream event is consumed, making the object available in time.

### 7. Observability Across Async Boundaries
A single content ingestion spans multiple services and Kafka hops. Distributed tracing must propagate across these async boundaries. **Solution:** W3C Trace Context headers are injected into Kafka message headers by producers and extracted by consumers via OTel's Kafka instrumentation — giving end-to-end traces across the full pipeline in Jaeger/Grafana Tempo.

### 8. Consumer Lag and Backpressure
A spike in vendor events can cause consumer lag to grow. K8s HPA scales consumer pods based on `kafka_consumergroup_lag` (exported via Kafka Exporter → Prometheus → OTel). Adding consumer pods redistributes partitions via rebalancing — but rebalancing causes a brief processing pause, so rebalance frequency must be tuned (`session.timeout.ms`, `heartbeat.interval.ms`).

### 9. DLQ Poison Pill Management
A malformed event that consistently fails processing can block a partition if the consumer retries indefinitely. **Solution:** After N retries, route to DLQ and commit the offset. DLQ events trigger alerts and are available for manual inspection and replay once the root cause is fixed.
