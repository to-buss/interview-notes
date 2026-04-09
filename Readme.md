# Interview Notes — Senior Java / Architecture Prep

Personal study notes and design documents prepared for senior backend engineering interviews, focused on Java internals, Kafka, and event-driven / microservices architecture.

---

## Repository Contents

| File / Folder | What it is |
|---|---|
| [`java-prep-app/`](#java-prep-app) | Interactive React tutorial app — Java & Kafka interview topics with diagrams and code examples |
| [`Java_Senior_Interview_Prep.pdf`](./Java_Senior_Interview_Prep.pdf) | PDF reference covering Java memory, GC, concurrency, and Spring |
| [`Topics.md`](./Topics.md) | Interview format, topic checklist, and preparation guidance |
| [`investment_system_eda.md`](./investment_system_eda.md) | Full EDA design document for a cloud-native investment platform (Kafka backbone) + parallel microservices architecture comparison |
| [`investment_system_lld.md`](./investment_system_lld.md) | Low-level design for three interaction patterns — gRPC, REST, and Kafka — with real implementation challenges |

---

## java-prep-app

An interactive browser-based study guide built with React + Vite. Switch between **Java** and **Kafka** topics using the subject switcher in the header. Each topic includes:

- Explanation text
- ASCII architecture / flow diagrams
- Syntax-highlighted code examples (Java / bash)
- Previous / Next navigation

**Java topics covered**
- JVM Memory (Heap regions, Stack vs Heap, Java Memory Model)
- Garbage Collection (G1, ZGC, GC tuning)
- Concurrency (happens-before, locks, virtual threads)
- Spring (Bean lifecycle, transactions, AOP)

**Kafka topics covered**
- Foundational (Consumer groups, Offsets, High throughput)
- Reliability (acks, ISR, Exactly-Once Semantics)
- Architecture (KRaft, Log compaction, Rebalance & static membership)
- Troubleshooting (Consumer lag, Message ordering)

---

## Run Locally

**Prerequisites:** Node.js 18+

```bash
cd java-prep-app
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Live Demo

Visit the live demo at [https://interview-notes-eight.vercel.app/](https://interview-notes-eight.vercel.app/)

---

## Run on StackBlitz

StackBlitz runs the full Vite dev server in the browser — no local install needed.

### Option 1 — One-click via GitHub (recommended)

Click the button below or paste the URL directly into your browser:

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/to-buss/interview-notes/tree/master/java-prep-app)

```
https://stackblitz.com/github/to-buss/interview-notes/tree/master/java-prep-app
```

StackBlitz will:
1. Clone the `java-prep-app` sub-directory from this repo
2. Run `npm install` automatically
3. Start `vite dev` and open the app in a split preview pane

### Option 2 — Import manually on stackblitz.com

1. Go to [stackblitz.com](https://stackblitz.com)
2. Click **Import from GitHub**
3. Paste: `to-buss/interview-notes`
4. Set the **root directory** to `java-prep-app`
5. Click **Import**

### Option 3 — Open a specific branch or fork

Replace `master` with your branch name:

```
https://stackblitz.com/github/to-buss/interview-notes/tree/<branch>/java-prep-app
```

### StackBlitz tips

- The first load takes ~15–20 seconds while StackBlitz installs dependencies in WebContainers.
- If the preview shows a blank page, click the **refresh** icon in the preview pane — Vite HMR sometimes needs one reload on cold start.
- To edit files directly in StackBlitz, click any file in the left sidebar. Changes hot-reload instantly.
- StackBlitz saves your session — use **Fork** (top right) to keep a personal copy of your edits.

---

## Design Documents

### `investment_system_eda.md`

End-to-end architecture for a cloud-native investment platform covering:

- Kafka topic topology (6 topics, partition keys, delivery guarantees, retention)
- 5 core domain services (market data, onboarding, customer sync, orders, rebalancer)
- Event schemas (Avro field-level definitions)
- Key architectural decisions (EOS, KRaft, Schema Registry, DLQs)
- **Parallel microservices architecture** — the same system rebuilt with REST/gRPC synchronous calls, including call-flow diagrams, an outbox pattern, and a side-by-side EDA vs microservices comparison table

### `investment_system_lld.md`

Low-level design drilling into three specific interactions:

| Interaction | Pattern | Key detail |
|---|---|---|
| Order Service → Risk Service | gRPC + Protobuf | Synchronous pre-trade risk check; streaming limit updates |
| Client → Onboarding Service | REST + OpenAPI | Idempotency key, outbox relay, async KYC |
| Order Service → `orders.placed` | Kafka EOS | Transactional producer, `read_committed` consumer |

Each section includes the full contract (`.proto` / OpenAPI / Avro), Java implementation, sequence diagram, and **4 real implementation challenges** with root causes and fixes.
