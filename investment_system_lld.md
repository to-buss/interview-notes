# Investment System — Low-Level Design
## Three Interaction Patterns with Implementation Challenges

This document provides the low-level design for three representative interactions from the investment platform, one per communication style. Each section covers the full contract, sequence, data structures, error handling, and real implementation challenges encountered.

---

## 1. gRPC Interaction — Risk Check: Order Service → Risk Service

### 1.1 Context

Before an order is written to the database or forwarded to the execution venue, the Order Service performs a synchronous risk check. This is a blocking, latency-sensitive call — the user's HTTP request is waiting. gRPC was chosen over REST because of strongly-typed Protobuf contracts, bi-directional streaming capability, and lower serialisation overhead at high order volumes.

---

### 1.2 Protobuf Contract

```protobuf
// risk/v1/risk_service.proto
syntax = "proto3";
package risk.v1;

option java_multiple_files = true;
option java_package = "com.investment.risk.v1";

service RiskService {
  // Synchronous pre-trade risk check
  rpc CheckOrderRisk(CheckOrderRiskRequest) returns (CheckOrderRiskResponse);

  // Server-streaming: push live limit updates to Order Service
  rpc StreamLimitChanges(StreamLimitChangesRequest) returns (stream LimitChangeEvent);
}

message CheckOrderRiskRequest {
  string  order_id      = 1;  // idempotency key
  string  portfolio_id  = 2;
  string  customer_id   = 3;
  string  symbol        = 4;
  string  side          = 5;  // BUY | SELL
  int64   quantity      = 6;
  string  order_type    = 7;  // MARKET | LIMIT
  string  currency      = 8;
  double  limit_price   = 9;  // 0 if MARKET order
}

message CheckOrderRiskResponse {
  enum Decision {
    APPROVED  = 0;
    REJECTED  = 1;
    NEEDS_REVIEW = 2;  // human review queue
  }
  Decision decision        = 1;
  string   rejection_code  = 2;  // e.g. "CONCENTRATION_LIMIT_BREACH"
  string   rejection_reason = 3; // human-readable
  double   exposure_after  = 4;  // projected exposure if approved
  double   limit_remaining = 5;  // headroom left on the binding limit
}

message StreamLimitChangesRequest {
  string portfolio_id = 1;
}

message LimitChangeEvent {
  string limit_type   = 1;  // e.g. "DAILY_LOSS", "CONCENTRATION"
  double old_value    = 2;
  double new_value    = 3;
  string reason       = 4;
  int64  timestamp_ms = 5;
}
```

---

### 1.3 Sequence Diagram

```
Client                API Gateway          Order Service          Risk Service
  │                       │                     │                      │
  │  POST /orders         │                     │                      │
  │──────────────────────►│                     │                      │
  │                       │  route + auth JWT   │                      │
  │                       │────────────────────►│                      │
  │                       │                     │  CheckOrderRisk()    │
  │                       │                     │  deadline: 200ms     │
  │                       │                     │─────────────────────►│
  │                       │                     │                      │ evaluate:
  │                       │                     │                      │  - concentration limit
  │                       │                     │                      │  - daily loss limit
  │                       │                     │                      │  - short-sell restriction
  │                       │                     │◄─────────────────────│
  │                       │                     │  APPROVED / REJECTED │
  │                       │                     │                      │
  │                       │  [if REJECTED]       │                      │
  │◄──────────────────────│◄────────────────────│                      │
  │  HTTP 422 + reason    │                     │                      │
  │                       │                     │                      │
  │                       │  [if APPROVED]       │                      │
  │                       │                     │ write to orders DB   │
  │                       │                     │ call Execution Venue │
  │◄──────────────────────│◄────────────────────│                      │
  │  HTTP 201 + orderId   │                     │                      │
```

---

### 1.4 Java Implementation — Order Service call site

```java
// OrderService.java
@Service
public class OrderService {

    private final RiskServiceGrpc.RiskServiceBlockingStub riskStub;
    private final OrderRepository orderRepository;

    public OrderService(ManagedChannel riskChannel, OrderRepository orderRepository) {
        // Deadline-aware stub; per-call deadline set at call site
        this.riskStub = RiskServiceGrpc.newBlockingStub(riskChannel);
        this.orderRepository = orderRepository;
    }

    public OrderResult placeOrder(PlaceOrderRequest req) {
        CheckOrderRiskRequest riskReq = CheckOrderRiskRequest.newBuilder()
            .setOrderId(req.getIdempotencyKey())
            .setPortfolioId(req.getPortfolioId())
            .setCustomerId(req.getCustomerId())
            .setSymbol(req.getSymbol())
            .setSide(req.getSide().name())
            .setQuantity(req.getQuantity())
            .setOrderType(req.getOrderType().name())
            .setCurrency(req.getCurrency())
            .setLimitPrice(req.getLimitPrice() != null ? req.getLimitPrice() : 0)
            .build();

        CheckOrderRiskResponse riskResp;
        try {
            riskResp = riskStub
                .withDeadlineAfter(200, TimeUnit.MILLISECONDS)   // hard deadline
                .withInterceptors(tracingInterceptor())          // propagate trace ID
                .checkOrderRisk(riskReq);
        } catch (StatusRuntimeException e) {
            // DEADLINE_EXCEEDED or UNAVAILABLE — fail open or closed depending on config
            if (e.getStatus().getCode() == Status.Code.DEADLINE_EXCEEDED) {
                throw new RiskServiceTimeoutException("Risk check timed out", e);
            }
            throw new RiskServiceUnavailableException("Risk service unreachable", e);
        }

        if (riskResp.getDecision() == CheckOrderRiskResponse.Decision.REJECTED) {
            throw new OrderRejectedByRiskException(
                riskResp.getRejectionCode(),
                riskResp.getRejectionReason()
            );
        }

        // Safe to write — risk approved
        Order order = orderRepository.save(Order.from(req));
        return OrderResult.success(order.getId());
    }
}
```

---

### 1.5 Java Implementation — Risk Service handler

```java
// RiskServiceImpl.java
@GrpcService
public class RiskServiceImpl extends RiskServiceGrpc.RiskServiceImplBase {

    private final LimitRepository limitRepo;
    private final ExposureCalculator exposureCalc;

    @Override
    public void checkOrderRisk(CheckOrderRiskRequest req,
                                StreamObserver<CheckOrderRiskResponse> responseObserver) {
        try {
            CustomerLimits limits = limitRepo.findByPortfolioId(req.getPortfolioId())
                .orElseThrow(() -> new PortfolioNotFoundException(req.getPortfolioId()));

            double projectedExposure = exposureCalc.compute(req);

            // Concentration limit check
            if (projectedExposure / limits.getTotalPortfolioValue() > limits.getConcentrationLimit()) {
                respond(responseObserver, Decision.REJECTED,
                    "CONCENTRATION_LIMIT_BREACH",
                    "Order would exceed %.0f%% concentration limit for %s"
                        .formatted(limits.getConcentrationLimit() * 100, req.getSymbol()),
                    projectedExposure, limits);
                return;
            }

            // Daily loss limit check
            if (limits.getDailyLossUsed() >= limits.getDailyLossLimit()) {
                respond(responseObserver, Decision.REJECTED,
                    "DAILY_LOSS_LIMIT_REACHED", "Daily loss limit exhausted",
                    projectedExposure, limits);
                return;
            }

            respond(responseObserver, Decision.APPROVED, "", "", projectedExposure, limits);

        } catch (Exception e) {
            responseObserver.onError(
                Status.INTERNAL.withDescription(e.getMessage()).asRuntimeException()
            );
        }
    }

    private void respond(StreamObserver<CheckOrderRiskResponse> obs, Decision decision,
                         String code, String reason, double exposure, CustomerLimits limits) {
        obs.onNext(CheckOrderRiskResponse.newBuilder()
            .setDecision(decision)
            .setRejectionCode(code)
            .setRejectionReason(reason)
            .setExposureAfter(exposure)
            .setLimitRemaining(limits.getDailyLossLimit() - limits.getDailyLossUsed())
            .build());
        obs.onCompleted();
    }
}
```

---

### 1.6 Implementation Challenges

**Challenge 1 — Deadline propagation through the call chain**

Setting a 200ms deadline on the stub does not automatically propagate the remaining deadline to downstream calls made *by* the Risk Service. If the Risk Service queries its own database and that takes 180ms, there is only 20ms remaining for the gRPC response to travel back — but the Risk Service is unaware of this. The pattern that worked: pass the deadline as gRPC metadata and re-apply it as a `Context.withDeadline` on every nested call.

```java
// Inside Risk Service: extract and honour caller's deadline
Context ctx = Context.current();
Deadline deadline = ctx.getDeadline();
if (deadline != null) {
    dbQueryStub.withDeadline(deadline).queryLimits(portfolioId);
}
```

**Challenge 2 — Proto schema evolution breaking consumers**

Adding a new required field to `CheckOrderRiskRequest` caused the Order Service (not yet deployed) to send the old proto without the field. Proto3 defaults unknown fields to zero/empty, so the Risk Service silently received `limit_price = 0.0` for limit orders — approving them all without price-based checks. Fix: treat `0.0` limit price as absent explicitly; never rely on proto3 defaults for business logic. Add a `has_limit_price` bool wrapper or use `google.protobuf.DoubleValue`.

**Challenge 3 — gRPC load balancing behind Kubernetes**

The default Kubernetes Service (ClusterIP) load balances at the TCP connection level, not the HTTP/2 stream level. Because gRPC multiplexes all calls over a single long-lived TCP connection, all traffic from one Order Service pod goes to one Risk Service pod regardless of how many replicas exist. Fix: use client-side load balancing with a headless Kubernetes Service and gRPC's built-in round-robin policy, or deploy a sidecar proxy (Envoy/Istio) that understands HTTP/2 frames.

**Challenge 4 — Fail-open vs fail-closed on timeout**

When the Risk Service is unavailable, should orders be rejected (fail-closed, safe) or allowed through (fail-open, available)? We initially chose fail-closed. During a Risk Service deployment rollout, all orders were rejected for ~30 seconds, causing customer complaints. Solution: a circuit breaker with a configurable fallback mode — fail-closed by default, fail-open only for market orders below a configured notional threshold, controlled by a feature flag.

---
---

## 2. REST Interaction — Customer Onboarding: POST /customers/onboard

### 2.1 Context

The onboarding flow is the entry point for new customers. It is client-facing, document-heavy, and long-running (KYC can take seconds). REST was chosen because the API Gateway and mobile clients already speak JSON/HTTPS, and the flow is naturally request/response shaped from the client's perspective.

---

### 2.2 OpenAPI Contract (excerpt)

```yaml
# openapi: 3.1.0
paths:
  /customers/onboard:
    post:
      operationId: onboardCustomer
      summary: Submit a new customer onboarding application
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
            format: uuid
          description: >
            Client-generated UUID. Repeated requests with the same key return
            the original response without re-processing.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OnboardingRequest'
      responses:
        '201':
          description: Application accepted; KYC in progress
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OnboardingResponse'
        '409':
          description: Duplicate idempotency key with different payload
        '422':
          description: Validation failure (missing fields, invalid KYC data)

components:
  schemas:
    OnboardingRequest:
      type: object
      required: [fullName, email, dateOfBirth, nationality, accountType, riskProfile]
      properties:
        fullName:        { type: string, maxLength: 200 }
        email:           { type: string, format: email }
        dateOfBirth:     { type: string, format: date }
        nationality:     { type: string, pattern: "^[A-Z]{2}$" }
        accountType:     { type: string, enum: [INDIVIDUAL, JOINT, ISA, SIPP] }
        riskProfile:     { type: string, enum: [CONSERVATIVE, BALANCED, GROWTH, AGGRESSIVE] }
        documents:
          type: array
          items:
            $ref: '#/components/schemas/DocumentRef'

    DocumentRef:
      type: object
      required: [type, storageKey]
      properties:
        type:       { type: string, enum: [PASSPORT, DRIVING_LICENCE, PROOF_OF_ADDRESS] }
        storageKey: { type: string, description: Pre-signed S3 key uploaded by client }

    OnboardingResponse:
      type: object
      properties:
        customerId:  { type: string, format: uuid }
        status:      { type: string, enum: [PENDING_KYC, APPROVED, REJECTED] }
        createdAt:   { type: string, format: date-time }
        nextSteps:   { type: array, items: { type: string } }
```

---

### 2.3 Sequence Diagram

```
Mobile Client              API Gateway           Onboarding Service       Customer Data Sync
     │                         │                        │                        │
     │  POST /customers/onboard│                        │                        │
     │  Idempotency-Key: <uuid> │                        │                        │
     │────────────────────────►│                        │                        │
     │                         │  verify JWT            │                        │
     │                         │  check idempotency key │                        │
     │                         │───────────────────────►│                        │
     │                         │                        │                        │
     │                         │                        │ check idempotency store│
     │                         │                        │ (return cached if seen)│
     │                         │                        │                        │
     │                         │                        │ validate request       │
     │                         │                        │ run KYC checks         │
     │                         │                        │ write customer (DB tx) │
     │                         │                        │ write outbox entry     │
     │                         │                        │                        │
     │                         │◄───────────────────────│                        │
     │◄────────────────────────│  201 { customerId,     │                        │
     │                         │        status:PENDING} │                        │
     │                         │                        │                        │
     │                         │            Outbox relay (async)                 │
     │                         │                        │──────────────────────► │
     │                         │                        │  POST /sync/customers  │
     │                         │                        │                        │ push to bank DB
     │                         │                        │◄──────────────────────│
     │                         │                        │  200 OK / 202 Accepted │
     │                         │                        │                        │
     │                         │                        │ POST /notify → Notifications Service
```

---

### 2.4 Java Implementation — Onboarding Service

```java
// OnboardingController.java
@RestController
@RequestMapping("/customers")
public class OnboardingController {

    private final OnboardingService onboardingService;
    private final IdempotencyStore idempotencyStore;

    @PostMapping("/onboard")
    public ResponseEntity<OnboardingResponse> onboard(
        @RequestHeader("Idempotency-Key") UUID idempotencyKey,
        @Valid @RequestBody OnboardingRequest request
    ) {
        // Return cached response for duplicate keys
        return idempotencyStore.get(idempotencyKey)
            .map(cached -> ResponseEntity.status(HttpStatus.CREATED)
                .<OnboardingResponse>body(cached))
            .orElseGet(() -> {
                OnboardingResponse resp = onboardingService.onboard(idempotencyKey, request);
                idempotencyStore.put(idempotencyKey, resp, Duration.ofHours(24));
                return ResponseEntity.status(HttpStatus.CREATED).body(resp);
            });
    }
}

// OnboardingService.java
@Service
@Transactional
public class OnboardingService {

    private final CustomerRepository customerRepo;
    private final OutboxRepository outboxRepo;
    private final KycService kycService;

    public OnboardingResponse onboard(UUID idempotencyKey, OnboardingRequest req) {
        // KYC validation (synchronous, calls internal KYC engine)
        KycResult kyc = kycService.evaluate(req);

        Customer customer = Customer.builder()
            .id(UUID.randomUUID())
            .fullName(req.getFullName())
            .email(req.getEmail())
            .kycStatus(kyc.getStatus())
            .riskProfile(req.getRiskProfile())
            .accountType(req.getAccountType())
            .build();

        // Both writes in a single transaction — outbox pattern
        customerRepo.save(customer);
        outboxRepo.save(OutboxEntry.builder()
            .target("customer-data-sync")
            .eventType("CUSTOMER_ONBOARDED")
            .payload(toJson(customer))
            .build());

        return OnboardingResponse.builder()
            .customerId(customer.getId())
            .status(kyc.getStatus())
            .createdAt(Instant.now())
            .build();
    }
}

// OutboxRelay.java — runs on a scheduler, separate from the request thread
@Component
public class OutboxRelay {

    private final OutboxRepository outboxRepo;
    private final RestTemplate restTemplate;

    @Scheduled(fixedDelay = 1000)
    public void relay() {
        List<OutboxEntry> pending = outboxRepo.findPendingBatch(50);
        for (OutboxEntry entry : pending) {
            try {
                restTemplate.postForEntity(
                    resolveTarget(entry.getTarget()),
                    entry.getPayload(),
                    Void.class
                );
                outboxRepo.markDelivered(entry.getId());
            } catch (RestClientException e) {
                outboxRepo.incrementRetryCount(entry.getId());
                // exponential back-off applied at query level via next_attempt_at
            }
        }
    }
}
```

---

### 2.5 Error Response Standard

All 4xx/5xx responses follow a uniform envelope to allow client SDKs and the API gateway to handle errors consistently:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "timestamp": "2024-11-14T10:22:31Z",
    "details": [
      { "field": "dateOfBirth", "issue": "must be in the past" },
      { "field": "nationality", "issue": "must be a 2-letter ISO country code" }
    ]
  }
}
```

---

### 2.6 Implementation Challenges

**Challenge 1 — Idempotency key collision with different payloads**

The first implementation stored only the idempotency key and returned the cached response regardless of whether the new payload matched. A client bug sent the same key with a different `accountType`, and the system silently returned the original response — the customer was onboarded with the wrong account type. Fix: hash the request payload and store it alongside the key. If key matches but hash differs, return `409 Conflict` with a clear error rather than replaying.

**Challenge 2 — Outbox relay creating duplicate deliveries on restart**

The relay scheduler uses `fixedDelay` — it processes a batch, then waits. During a pod restart, two relay instances ran briefly in parallel (old pod terminating, new pod starting). Both picked up the same outbox entries. Customer Data Sync received the same `CUSTOMER_ONBOARDED` event twice. Customer Data Sync was idempotent (uses `customerId` as key), so no data was corrupted, but the notifications service was not — customers received two welcome emails. Fix: Customer Data Sync's idempotency saved the business data; notifications service was updated to deduplicate on `customerId + eventType` within a 10-minute window.

**Challenge 3 — KYC latency blowing the HTTP client timeout**

The KYC engine sometimes took 8–12 seconds on first-time nationality lookups. The API Gateway had a 5-second upstream timeout configured. Clients received a `504 Gateway Timeout`, but the onboarding transaction had already committed — the customer existed in the DB. When the client retried (with the same idempotency key), it received the correct `201` response from the cache. But clients that did not send an idempotency key got a fresh record created. Fix: made `Idempotency-Key` mandatory (enforced at gateway level), and moved KYC to an async job for slow checks — returning `status: PENDING_KYC` immediately and pushing updates via webhook.

**Challenge 4 — Partial outbox delivery causing stale customer records**

The outbox relay occasionally failed mid-batch, re-queued the whole batch, and re-delivered already-sent entries. Customer Data Sync correctly ignored them (idempotent), but the `next_attempt_at` back-off column was not being reset after successful delivery of other entries in the same batch. Some entries were stuck in back-off long after their failure was resolved. Fix: each outbox entry is processed and committed individually, not in a batch transaction.

---
---

## 3. Kafka Interaction — Exactly-Once Order Placement: Order Service → `orders.placed`

### 3.1 Context

The `orders.placed` topic is the most critical in the system. A duplicate message means two orders are sent to the execution venue — a direct financial loss. The interaction uses Kafka's transactional producer API to guarantee exactly-once delivery, and `isolation.level=read_committed` on all consumers of this topic.

---

### 3.2 Topic Configuration

```properties
# orders.placed topic config
name=orders.placed
partitions=12
replication.factor=3
min.insync.replicas=2
cleanup.policy=delete
retention.ms=220752000000      # 7 years (regulatory)
message.timestamp.type=CreateTime
compression.type=lz4
```

---

### 3.3 Avro Schema (Schema Registry)

```json
// Subject: orders.placed-value  (Schema Registry)
{
  "type": "record",
  "name": "OrderPlaced",
  "namespace": "com.investment.orders.v1",
  "fields": [
    { "name": "orderId",      "type": "string",  "doc": "UUID" },
    { "name": "portfolioId",  "type": "string",  "doc": "UUID — also the partition key" },
    { "name": "customerId",   "type": "string",  "doc": "UUID" },
    { "name": "symbol",       "type": "string" },
    { "name": "side",         "type": { "type": "enum", "name": "Side",
                                         "symbols": ["BUY", "SELL"] } },
    { "name": "quantity",     "type": "long" },
    { "name": "orderType",    "type": { "type": "enum", "name": "OrderType",
                                         "symbols": ["MARKET", "LIMIT"] } },
    { "name": "limitPrice",   "type": ["null", "double"], "default": null },
    { "name": "currency",     "type": "string" },
    { "name": "source",       "type": { "type": "enum", "name": "Source",
                                         "symbols": ["MANUAL", "REBALANCER"] } },
    { "name": "placedAt",     "type": { "type": "long",
                                         "logicalType": "timestamp-millis" } },
    { "name": "correlationId","type": "string",  "doc": "Trace ID for OpenTelemetry" }
  ]
}
```

---

### 3.4 Sequence Diagram

```
Order Service                    Kafka Broker                   Execution Venue Adapter
     │                               │                                  │
     │  initTransactions()           │                                  │
     │──────────────────────────────►│                                  │
     │  ← PID assigned               │                                  │
     │                               │                                  │
     │  beginTransaction()           │                                  │
     │──────────────────────────────►│                                  │
     │                               │                                  │
     │  send(orders.placed, key=portfolioId, value=OrderPlaced)         │
     │──────────────────────────────►│                                  │
     │                               │  replicate to ISR (min 2)        │
     │                               │                                  │
     │  commitTransaction()          │                                  │
     │──────────────────────────────►│                                  │
     │  ← offset confirmed           │  marks transaction COMMITTED     │
     │                               │  in __transaction_state          │
     │                               │                                  │
     │                               │     poll() — read_committed      │
     │                               │◄─────────────────────────────────│
     │                               │  delivers OrderPlaced            │
     │                               │─────────────────────────────────►│
     │                               │                                  │ submit to broker API
     │                               │                                  │ publish orders.executed
```

---

### 3.5 Java Implementation — Transactional Producer

```java
// OrderEventPublisher.java
@Component
public class OrderEventPublisher {

    private final KafkaProducer<String, OrderPlaced> producer;
    private static final String TOPIC = "orders.placed";

    public OrderEventPublisher(@Value("${kafka.bootstrap-servers}") String bootstrapServers,
                                SchemaRegistryClient schemaRegistry) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, KafkaAvroSerializer.class);
        props.put("schema.registry.url", schemaRegistry.getBaseUrls().get(0));

        // Exactly-once config
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG,
            "order-svc-" + InetAddress.getLocalHost().getHostName()); // unique per instance
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);
        props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);

        this.producer = new KafkaProducer<>(props);
        this.producer.initTransactions();  // must call before first transaction
    }

    public void publishOrderPlaced(OrderPlaced event) {
        ProducerRecord<String, OrderPlaced> record =
            new ProducerRecord<>(TOPIC, event.getPortfolioId().toString(), event);

        // Inject trace ID into Kafka headers for OpenTelemetry propagation
        record.headers().add("traceId",
            Span.current().getSpanContext().getTraceId().getBytes(StandardCharsets.UTF_8));

        try {
            producer.beginTransaction();
            producer.send(record, (metadata, ex) -> {
                if (ex != null) throw new KafkaPublishException("Send callback failed", ex);
            });
            producer.commitTransaction();
        } catch (ProducerFencedException e) {
            // Another instance with the same transactional.id took over — this instance must die
            producer.close();
            throw new FatalProducerException("Producer fenced — shutting down", e);
        } catch (KafkaException e) {
            producer.abortTransaction();
            throw new OrderPublishException("Transaction aborted, order not placed", e);
        }
    }
}
```

---

### 3.6 Java Implementation — Execution Venue Adapter (Consumer)

```java
// ExecutionVenueConsumer.java
@Component
public class ExecutionVenueConsumer {

    private final KafkaConsumer<String, OrderPlaced> consumer;
    private final BrokerApiClient brokerClient;
    private final ExecutedOrderPublisher executedPublisher;

    @PostConstruct
    public void start() {
        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "execution-venue-adapter");
        props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed"); // EOS consumer side
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 10);    // broker calls are expensive
        props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, 60_000);

        this.consumer = new KafkaConsumer<>(props);
        consumer.subscribe(List.of("orders.placed"));

        Thread.ofVirtual().start(this::pollLoop);
    }

    private void pollLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            ConsumerRecords<String, OrderPlaced> records =
                consumer.poll(Duration.ofMillis(500));

            for (ConsumerRecord<String, OrderPlaced> record : records) {
                try {
                    BrokerFill fill = brokerClient.submit(record.value()); // call broker API
                    executedPublisher.publishOrderExecuted(fill);          // write orders.executed
                    consumer.commitSync(Map.of(
                        new TopicPartition(record.topic(), record.partition()),
                        new OffsetAndMetadata(record.offset() + 1)
                    ));
                } catch (BrokerRejectedException e) {
                    // Broker permanently rejected — publish to DLQ, commit offset
                    publishToDlq(record, e);
                    consumer.commitSync(...);
                } catch (BrokerUnavailableException e) {
                    // Transient — do NOT commit, retry on next poll
                    log.warn("Broker unavailable, will retry: {}", record.value().getOrderId());
                    consumer.seek(new TopicPartition(record.topic(), record.partition()),
                                  record.offset());
                    break;
                }
            }
        }
    }
}
```

---

### 3.7 Implementation Challenges

**Challenge 1 — `transactional.id` collisions on rolling deployment**

Each producer instance sets `transactional.id` to `order-svc-<hostname>`. During a Kubernetes rolling deployment, a new pod starts before the old one is terminated. If both pods resolve to the same hostname (e.g. both receive `order-svc-0` from the StatefulSet), the new producer calls `initTransactions()`, which causes Kafka to fence the old producer. The old pod's in-flight `commitTransaction()` throws `ProducerFencedException` — the transaction aborts cleanly. But the old pod continued briefly, thinking it was still healthy, and the Order Service returned `201` to the client without the event being in Kafka. The client assumed the order was placed; it was not. Fix: use `HOSTNAME` (Kubernetes pod name, unique per pod) + a startup UUID suffix as the `transactional.id`, and treat `ProducerFencedException` as a fatal error that triggers pod restart immediately.

**Challenge 2 — `max.poll.interval.ms` breach causing rebalance loop**

The Execution Venue Adapter calls an external broker REST API per order. Under normal load this takes ~50ms. During a market open spike, the broker API latency climbed to 8 seconds per call. With `max.poll.records=50`, the poll loop took 400 seconds — far beyond the 300-second `max.poll.interval.ms`. Kafka removed the consumer from the group, triggered a rebalance, and reassigned the partitions to another instance. That instance picked up the same offsets (not committed yet), called the broker API for the same orders again, and the cycle repeated. Fix: reduce `max.poll.records` to 5 for broker-touching consumers; increase `max.poll.interval.ms` to 120 seconds with alerting; add a per-record broker idempotency key (`orderId`) so duplicate broker submissions are rejected safely.

**Challenge 3 — Schema evolution breaking read_committed consumers**

A new field `correlationId` was added to the `OrderPlaced` Avro schema and deployed to the producer before the consumers were updated. The Schema Registry was in `BACKWARD` compatibility mode — new schema can read old records, which is fine. But the consumer was using a generated Java class from the old schema (compiled artefact not yet redeployed). Avro's `ReflectDatumReader` threw a deserialization exception on the new field, the consumer crashed, and the offset was never committed. Because `isolation.level=read_committed`, the consumer re-read the same record indefinitely. Fix: deploy consumers before producers on schema changes; use `FULL` compatibility mode in Schema Registry; always use `GenericRecord` or regenerate stubs as part of the build pipeline.

**Challenge 4 — Transaction coordinator partition unavailability stalling all producers**

Kafka's transactional state is stored in `__transaction_state`, which has 50 partitions by default. Each `transactional.id` is consistently hashed to one partition. When a broker hosting that partition's leader went down, `initTransactions()` and `commitTransaction()` blocked until leader election completed (~15–30 seconds in our cluster). During that window, all Order Service instances using transactional IDs hashed to that partition were stalled. Fix: increase `transaction.state.log.replication.factor` to 3 and `transaction.state.log.min.isr` to 2 (we had left them at defaults of 1); add a 5-second timeout on `commitTransaction()` with a fallback that retries on the next request cycle rather than blocking the HTTP thread.