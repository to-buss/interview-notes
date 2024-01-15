# Investment System
## Event-Driven Architecture — Design Document

This document describes the event-driven architecture for a cloud-native investment platform. The system uses Apache Kafka as the central event backbone across five functional domains: market data ingestion, customer onboarding, customer data sync, order management, and automated portfolio rebalancing. All inter-service communication is asynchronous and mediated through well-defined Kafka topics with explicit schemas.

---

## 1. High-Level Architecture

The platform is structured into three tiers: external systems, core domain services, and downstream consumers. All communication between tiers flows through Kafka topics. No service calls another service's API directly — every interaction is an event.

| Tier | Components | Role |
|---|---|---|
| External systems | Market data feed, bank database, Execution venue | Source of truth for prices, customer records, and trade fills |
| Core services | Market data adapter, Onboarding, Customer Data Sync, Order management, Rebalancer, Portfolio | Business logic producers and consumers |
| Downstream consumers | Risk engine, Notifications, Audit log, Analytics | Read-only consumers; never write back to Kafka |

---

## 2. Kafka Topic Topology

The following topics form the event backbone. Each topic has a defined partition key, delivery guarantee, and retention policy.

| Topic | Partition key | Guarantee | Producers | Key consumers |
|---|---|---|---|---|
| `market.prices` | symbol | at-least-once | Market data adapter | Rebalancer, Risk engine, Analytics |
| `customer.onboarded` | customerId | at-least-once | Onboarding service | Customer Data Sync, Notifications, Audit log |
| `customer.synced` | customerId | at-least-once | Customer Data Sync service | Onboarding service, Audit log |
| `orders.placed` | portfolioId | exactly-once | Order mgmt, Rebalancer | Execution venue, Risk engine, Audit log |
| `orders.executed` | orderId | at-least-once | Execution callback adapter | Portfolio service, Notifications, Audit log |
| `portfolio.rebalance-needed` | portfolioId | at-least-once | Portfolio service | Rebalancer, Risk engine |

---

## 3. Core Domain Services

### 3.1 Market Data Ingestion

> **Purpose:** Poll or subscribe to an external price feed and publish normalised price events.

A dedicated adapter connects to the external market data feed (REST polling or WebSocket subscription) and publishes to `market.prices` partitioned by stock symbol. Ordering per symbol is preserved because all updates for a given symbol land on the same partition. The rebalancer and risk engine consume this stream continuously to maintain an up-to-date valuation of all portfolios.

**Event schema — `market.prices`**

| Field | Type | Description |
|---|---|---|
| symbol | string | Instrument ticker (e.g. AAPL, MSFT) |
| price | decimal | Last trade price |
| bid | decimal | Best bid |
| ask | decimal | Best ask |
| timestamp | timestamp | UTC timestamp of the quote |
| source | string | Feed provider identifier |

---

### 3.2 Customer Onboarding

> **Purpose:** Handle KYC, document collection, and account creation.

The onboarding service manages the full customer lifecycle from application through activation. On successful KYC verification and account creation it publishes a `customer.onboarded` event. This event triggers the Customer Data Sync service (to replicate the record to the central bank database) and the notifications service (to send a welcome communication).

**Event schema — `customer.onboarded`**

| Field | Type | Description |
|---|---|---|
| customerId | UUID | Unique customer identifier |
| fullName | string | Legal full name |
| email | string | Primary contact email |
| kycStatus | enum | `APPROVED` \| `PENDING` \| `REJECTED` |
| riskProfile | enum | `CONSERVATIVE` \| `BALANCED` \| `GROWTH` \| `AGGRESSIVE` |
| accountType | enum | `INDIVIDUAL` \| `JOINT` \| `ISA` \| `SIPP` |
| timestamp | timestamp | Onboarding completion time (UTC) |

---

### 3.3 Customer Data Sync

> **Purpose:** Bidirectional sync between the investment platform and the central bank customer database.

The Customer Data Sync service consumes `customer.onboarded` events and pushes the record to the central bank database. It also subscribes to change notifications from the bank database and publishes `customer.synced` back into Kafka so all platform services remain consistent. The service uses `customerId` as an idempotency key on all writes to tolerate Kafka's at-least-once delivery semantics.

**Conflict resolution strategy**

| Scenario | Resolution |
|---|---|
| Field conflict | Bank database timestamp wins — the bank database is the system of record for identity fields. |
| New platform field | Sync to bank database with a platform-specific namespace prefix. |
| Deletion | Soft-delete only; hard deletes require a manual workflow. |
| Network failure | Retry with exponential back-off; unresolvable messages route to `customer.synced.dlq`. |

---

### 3.4 Order Management

> **Purpose:** Validate order requests against risk limits and route to the execution venue.

Two producers write to `orders.placed`: the human-triggered order management service and the automated rebalancer. This single topic is the system of record for order intent. It uses **exactly-once semantics** (idempotent Kafka producer + transactional API) because duplicate execution of a trade has direct financial consequences. The execution venue adapter consumes this topic and calls the broker API.

**Order lifecycle**

| Step | Description |
|---|---|
| 1. Validate | Risk and compliance checks before writing to Kafka. |
| 2. Publish | Write to `orders.placed` with exactly-once guarantee. |
| 3. Route | Execution venue adapter submits the order to the broker. |
| 4. Callback | Broker confirms fill; callback adapter publishes to `orders.executed`. |
| 5. Reconcile | Portfolio service updates positions; triggers rebalance check if needed. |

---

### 3.5 Automated Portfolio Rebalancing

> **Purpose:** Detect portfolio drift and place corrective trades automatically.

The rebalancer is implemented as a **Kafka Streams application**. It joins the `market.prices` stream with `portfolio.rebalance-needed` events to compute current allocation versus the target profile. When drift exceeds the configured threshold it calculates the minimum set of trades to restore balance and publishes them to `orders.placed`. All rebalance decisions are therefore fully auditable and replayable from the Kafka log.

**Rebalance trigger conditions**

| Trigger | Description |
|---|---|
| Price drift | Absolute weight deviates from target by more than the configured tolerance (e.g. ±5%). |
| Cash inflow | New deposit detected; rebalancer allocates cash to underweight assets. |
| Profile change | Customer updates their risk profile; full rebalance on next market open. |
| Fill event | An `orders.executed` event causes a weight shift that exceeds tolerance. |

---

## 4. Key Architectural Decisions

### Partition keys
`market.prices` uses `symbol`; `orders.placed` and `portfolio.rebalance-needed` use `portfolioId`. This ensures all events for a given portfolio land on the same partition and are processed in order by a single consumer instance — critical for correctness.

### Exactly-once for orders
The `orders.placed` topic is produced with Kafka's transactional producer and consumed with `isolation.level=read_committed` to prevent duplicate orders from retries or consumer restarts.

### Customer sync idempotency
The Customer Data Sync consumer uses `customerId` as an idempotency key when writing to the bank database, since Kafka at-least-once delivery may replay events on retry.

### Schema Registry
All events are registered in a Schema Registry (Confluent-compatible) using Avro or Protobuf. This enforces a contract between producers and consumers and enables schema evolution without breaking downstream services.

### Dead letter topics
Each consumer routes unprocessable messages to a `.dlq` topic (e.g. `orders.placed.dlq`) for manual inspection rather than halting processing.

### No direct service calls
Services never call each other's APIs. All state changes are communicated via Kafka events. This eliminates synchronous coupling and allows independent deployment and scaling.

---

## 5. Downstream Consumers

| Service | Topics consumed | Responsibility |
|---|---|---|
| Risk engine | `market.prices`, `orders.placed`, `portfolio.rebalance-needed` | Real-time exposure monitoring; can block orders breaching limits. |
| Notifications | `customer.onboarded`, `orders.executed` | Sends email, push, and SMS updates to customers. |
| Audit log | All topics | Immutable compliance record; consumed with earliest offset reset. |
| Analytics | `market.prices`, `orders.executed` | Reporting, dashboards, and performance attribution. |

---

## 6. Non-Functional Considerations

### Scalability
Each service scales independently. Consumer groups allow horizontal scaling by adding instances — Kafka automatically rebalances partition assignments.

### Resilience
Replication factor of 3 for all production topics. Stateful Kafka Streams applications use RocksDB-backed state stores with changelog topics for recovery after restarts.

### Observability
Consumer lag per topic-partition is the primary health metric. Distributed tracing (OpenTelemetry) propagates a correlation ID through event headers across all services.

### Data retention

| Topic | Retention |
|---|---|
| `market.prices` | 7 days |
| `customer.onboarded` / `customer.synced` | Indefinite (log compaction) |
| `orders.placed` / `orders.executed` | 7 years (regulatory) |
| `portfolio.rebalance-needed` | 30 days |

### Security
TLS in transit, SASL/SCRAM authentication. ACLs restrict each service to only the topics it legitimately produces or consumes. PII fields in customer events are encrypted at the field level before publishing.

---

*This document is a living architecture reference. Topic schemas should be versioned in Schema Registry; this document reflects v1 of each schema.*

---

# Parallel Architecture: Microservices (REST/gRPC)

This section describes the same five functional domains implemented as synchronous microservices communicating over REST/gRPC, with a shared relational database per service (database-per-service pattern). It exists as a direct comparison to the EDA design above.

---

## A. High-Level Architecture

The platform is structured as a mesh of independently deployable services behind an API gateway. Services communicate synchronously via REST or gRPC. Each service owns its own database — no shared schemas.

```
                        ┌─────────────────────────────────────────────────────┐
                        │                   API Gateway                        │
                        │         (auth, rate limiting, routing)               │
                        └───┬──────────┬──────────┬──────────┬────────────────┘
                            │          │          │          │
                            ▼          ▼          ▼          ▼
                   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
                   │Onboarding│ │  Order   │ │Portfolio │ │  Market Data │
                   │ Service  │ │  Service │ │ Service  │ │   Adapter    │
                   └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘
                        │            │             │              │
                        ▼            ▼             ▼              ▼
                   [customers] [orders DB]  [portfolios DB] [prices cache]
                        │            │
                        │ REST call  │ gRPC call
                        ▼            ▼
               ┌──────────────┐  ┌──────────────┐
               │ Customer Data│  │  Execution   │
               │ Sync Service │  │Venue Adapter │
               └──────────────┘  └──────────────┘
                        │
               ┌────────┴────────┐
               ▼                 ▼
        ┌────────────┐   ┌──────────────┐
        │  Risk Svc  │   │Notifications │
        └────────────┘   └──────────────┘
```

---

## B. Service Catalogue

| Service | Protocol | Own DB | Calls | Called by |
|---|---|---|---|---|
| API Gateway | REST (public) | — | All services | External clients |
| Market Data Adapter | REST/WebSocket (inbound) | Redis (price cache) | — | Portfolio, Risk, Rebalancer |
| Onboarding Service | REST | PostgreSQL | Customer Data Sync, Notifications | API Gateway |
| Customer Data Sync | gRPC | — (bank DB via adapter) | Bank database API | Onboarding |
| Order Service | gRPC | PostgreSQL | Risk Service, Execution Venue Adapter | API Gateway, Rebalancer |
| Portfolio Service | gRPC | PostgreSQL | Market Data Adapter, Rebalancer | Order Service, API Gateway |
| Rebalancer | gRPC (internal) | — (stateless) | Market Data Adapter, Portfolio Service, Order Service | Portfolio Service (scheduled) |
| Risk Service | gRPC | PostgreSQL | — | Order Service |
| Execution Venue Adapter | REST (outbound) | — | Broker REST API | Order Service |
| Notifications Service | REST (internal) | — | Email/SMS/push provider | Onboarding, Order Service |
| Audit Service | REST (internal) | PostgreSQL / S3 | — | All services (async via webhook) |

---

## C. Core Domain Flows

### C.1 Market Data Ingestion

```
Market Data Feed
      │  WebSocket / REST poll
      ▼
Market Data Adapter
      │  normalise + store
      ▼
Redis (price cache, TTL 1s)
      │  read on demand
      ├──► Portfolio Service  (GET /prices/{symbol})
      ├──► Risk Service       (GET /prices/{symbol})
      └──► Rebalancer         (GET /prices/batch)
```

The adapter writes normalised prices into a Redis cache. Downstream services pull prices on demand — there is no push. Staleness is bounded by the cache TTL.

---

### C.2 Customer Onboarding

```
Client
  │  POST /customers/onboard
  ▼
API Gateway → Onboarding Service
                    │
                    ├─ validate KYC documents (internal)
                    ├─ write to customers DB
                    │
                    ├─► POST /sync  →  Customer Data Sync Service
                    │                        │
                    │                        └─► bank database API
                    │
                    └─► POST /notify  →  Notifications Service
                                               │
                                               └─► email / SMS provider
```

Onboarding calls Customer Data Sync and Notifications synchronously. If either call fails, Onboarding retries with exponential back-off. A saga compensating transaction rolls back the customer record if sync fails permanently.

---

### C.3 Order Management

```
Client / Rebalancer
  │  POST /orders
  ▼
API Gateway → Order Service
                  │
                  ├─► gRPC: RiskService.CheckLimits(order)
                  │          └─ REJECT if limit breached
                  │
                  ├─ write to orders DB (status=PENDING)
                  │
                  ├─► REST: ExecutionVenueAdapter.SubmitOrder(order)
                  │          │
                  │          └─► Broker REST API
                  │                  │  fill callback (webhook)
                  │                  ▼
                  │         ExecutionVenueAdapter
                  │                  │  POST /orders/{id}/executed
                  │                  ▼
                  │          Order Service (update status=FILLED)
                  │                  │
                  ├─► gRPC: PortfolioService.UpdatePositions(fill)
                  │
                  └─► POST /notify  →  Notifications Service
```

Risk check is a synchronous blocking call — orders are rejected inline, not after the fact. This differs from the EDA model where the risk engine is a downstream consumer that can only flag after the event is written.

---

### C.4 Portfolio Rebalancing

```
Scheduler (cron / Portfolio Service trigger)
      │  gRPC: Rebalancer.CheckDrift(portfolioId)
      ▼
Rebalancer
      │
      ├─► GET /prices/batch         →  Market Data Adapter
      ├─► gRPC: GetPortfolio(id)    →  Portfolio Service
      │
      │  compute drift vs. target allocation
      │
      └─► gRPC: PlaceOrders(trades) →  Order Service (if drift > threshold)
```

The rebalancer is stateless — it pulls current prices and positions on each invocation and computes trades inline. There is no stream join; correctness depends on both reads being consistent at the point of the call.

---

## D. Inter-Service Communication Contracts

| Interaction | Protocol | Contract | Failure mode |
|---|---|---|---|
| External clients → services | REST/JSON | OpenAPI 3.x spec | 4xx / 5xx + retry |
| Service-to-service (low latency) | gRPC / Protobuf | `.proto` schema | Status codes + deadline |
| Outbound to bank DB / broker | REST/JSON | Partner-defined spec | Retry + circuit breaker |
| Async notifications (audit, webhooks) | HTTP webhook | JSON payload | At-least-once delivery via outbox |

---

## E. Resilience Patterns

### Circuit Breaker
Each synchronous call is wrapped with a circuit breaker (e.g. Resilience4j). On repeated failures the circuit opens, returning a fast error instead of queuing up threads.

### Saga (Choreography-less)
Long-running flows (e.g. onboarding) are implemented as explicit orchestration sagas in the Onboarding Service. Each step is recorded in the DB; compensation actions (rollback) are triggered on failure.

### Outbox Pattern
For audit and notification calls, services write to a local outbox table in the same DB transaction as the business write. A separate relay process delivers the outbox entries — guaranteeing at-least-once delivery without a message broker.

```
Order Service TX:
  BEGIN
    INSERT orders (status=FILLED)
    INSERT outbox (target=audit-svc, payload=...)
  COMMIT
         │
  Outbox relay ──► POST /audit/events  →  Audit Service
```

---

## F. Comparison: EDA vs Microservices (Synchronous)

| Concern | EDA (Kafka) | Microservices (REST/gRPC) |
|---|---|---|
| **Coupling** | Temporal decoupling — producer and consumer never interact directly | Tight temporal coupling — caller blocks until callee responds |
| **Throughput** | Very high — Kafka absorbs bursts; consumers process at their own rate | Limited by slowest service in the call chain |
| **Ordering** | Guaranteed within a partition | Must be enforced by the caller or DB sequence |
| **Exactly-once** | Native via Kafka transactional API | Requires idempotency keys + deduplication logic in every service |
| **Auditability** | Complete — the Kafka log is an immutable history by default | Requires explicit audit service + outbox plumbing |
| **Debuggability** | Harder — async flows are non-linear; consumer lag as proxy for health | Easier — synchronous stack traces, distributed tracing straightforward |
| **Operational complexity** | High — Kafka cluster, Schema Registry, KRaft quorum to operate | Lower — standard HTTP services, no broker to manage |
| **Risk check timing** | Post-write (risk engine is a downstream consumer) | Pre-write (risk service blocks the order inline) |
| **Rebalancer consistency** | Strong — Kafka Streams joins are deterministic and replayable | Weaker — depends on prices and positions being consistent at read time |
| **Onboarding rollback** | Event sourcing — publish a compensating event | Explicit saga compensation transaction |