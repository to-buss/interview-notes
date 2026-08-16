# Legal Invoice Billing Review System

## 1. What is LegalLens

Let's help large companies manage their legal departments, external law firms, legal matters, invoices, and legal spend.

LegalLens covers:

- **Legal matter management** — tracking legal cases/matters, documents, budgets and progress.
- **E-billing** — law firms submit invoices through LegalLens.
- **AI invoice review** — AI examines individual invoice line items and flags things that violate billing guidelines.
- **Legal spend analytics** — dashboards showing where the company is spending money on lawyers/law firms.
- **Budgeting & forecasting** — tracking spend against budgets and predicting potential overruns.
- **Outside counsel management** — comparing law firms, lawyer rates, performance and resourcing.
- **Generative AI** — *Ask LegalLens* functionality lets legal teams ask questions about their legal-spend data in natural language.

A useful simplified architecture is:

```
Law firms → LegalLens → Corporate Legal Department → Finance/AP
```

With LegalLens sitting in the middle as the system of record for legal matters, invoices, and external legal spend.

### Why it's interesting from a technology perspective

This is particularly relevant to the AI/RAG architecture patterns I've been exploring.

LegalLens has a fairly interesting combination of:

**Transactional data**
- Invoices
- Invoice line items
- Budgets
- Matters
- Vendors
- Timekeepers
- Rates
- Approvals

**Unstructured/semi-structured data**
- Invoice descriptions
- Legal narratives
- Documents
- Billing guidelines

**AI/ML**
- Classification of legal work
- Invoice anomaly detection
- Spend forecasting
- Summarisation
- Natural-language querying

## 2. Start with this scope

A law firm submits an invoice:

```
Invoice
├── Invoice metadata
│    ├── Law firm
│    ├── Client
│    ├── Matter
│    ├── Invoice number
│    └── Invoice date
│
└── Line items
     ├── Date
     ├── Lawyer
     ├── Activity
     ├── Hours
     ├── Rate
     └── Amount
```

Example:

| Date | Lawyer | Activity | Hours | Rate | Amount |
|---|---|---|---|---|---|
| 01-Aug | John Smith | Review contract | 3.5h | €450/h | €1,575 |
| 01-Aug | John Smith | Review contract | 2.0h | €450/h | €900 |
| 02-Aug | Mary Jones | Attend meeting | 1.5h | €300/h | €450 |

The client has billing guidelines such as:

- **RULE-001** — Contract review must not exceed 2 hours per day.
- **RULE-002** — Partner time is not billable for administrative activities.
- **RULE-003** — Travel time is not billable.
- **RULE-004** — Duplicate work entries should be flagged.
- **RULE-005** — Hourly rate must match the agreed rate for the lawyer.

The system determines:

> **Line item #1 — ❌ Potential violation**
>
> **Reason:** 3.5 hours billed for contract review. Maximum permitted: 2 hours.
>
> **Potential overcharge:** 1.5 × €450 = €675

That's already a useful product.

## 3. Architecture I'd recommend

Given my Python/Django/Kafka background, I'd build it roughly like this:

```
                    ┌──────────────────┐
                    │   Law Firm       │
                    │ Invoice PDF/CSV  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Invoice Service  │
                    │ Django           │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Document Parser  │
                    │ PDF/OCR          │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Invoice Normalizer│
                    └────────┬─────────┘
                             │
                             ▼
                       Kafka Topic
                     invoice.received
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
     ┌──────────────────┐          ┌──────────────────┐
     │ Rules Engine     │          │ AI Review Engine │
     │                  │          │                  │
     │ deterministic    │          │ LLM + RAG        │
     │ validation       │          │                  │
     └────────┬─────────┘          └────────┬─────────┘
              │                             │
              └──────────────┬──────────────┘
                             ▼
                    ┌──────────────────┐
                    │ Review Service   │
                    │                  │
                    │ violations       │
                    │ explanations     │
                    │ confidence       │
                    └────────┬─────────┘
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
          PostgreSQL                Vector DB
          transactional            billing guidelines
          data                     / policies
```

## 4. let's not make everything AI

This is probably the most important architectural decision.

Some violations are deterministic. For example:

```
Agreed rate  = €400/hour
Invoice rate = €450/hour
```

We don't need an LLM. Just:

```python
if invoice_rate > agreed_rate:
    flag(RATE_VIOLATION)
```

Likewise:

```
Maximum hours = 2
Actual hours  = 3.5
```

Easy.

But consider:

> "Review correspondence with opposing counsel regarding discovery documents."

The system may need to understand what kind of work this represents and whether it is permitted under the client's billing guidelines.

That's where AI becomes useful.

## 5. Where RAG comes in

Suppose the client has a 40-page billing policy. We could have:

```
Billing Guidelines
        │
        ▼
Document ingestion
        │
        ▼
    Chunking
        │
        ▼
   Embeddings
        │
        ▼
   Vector DB
```

Then when reviewing:

**Invoice line:**
> "Review emails regarding discovery" — 3.5 hours

The AI reviewer retrieves relevant rules:

- Routine correspondence should not exceed 1 hour per matter per day.
- Administrative correspondence is non-billable.

Then the LLM evaluates the line against those rules. Conceptually:

```
Invoice Line
    +
Relevant Billing Rules
    +
Matter Context
    ↓
   LLM
    ↓
Review Decision
```

## 6. I would actually create TWO review paths

### Path A — Rules engine

```
Invoice
   ↓
Normalize
   ↓
Rules Engine
   ↓
Hard violations
```

Examples:

- Incorrect hourly rate
- Duplicate invoice
- Duplicate line
- Excessive hours
- Non-billable activity code
- Invoice outside permitted period
- Missing required information

### Path B — AI review

```
Invoice line
     ↓
Retrieve relevant policies
     ↓
Retrieve matter context
     ↓
    LLM
     ↓
Classification
```

Examples:

- Is this administrative work?
- Is this potentially clerical?
- Does the description represent substantive legal work?
- Does the description contain insufficient detail?
- Does this appear to duplicate another activity?
- Does the work appear inconsistent with the matter?

## 7. The AI should return structured output

Don't allow the LLM to return arbitrary prose. Have it produce something like:

```json
{
  "lineItemId": "LI-12345",
  "decision": "FLAG",
  "violationType": "EXCESSIVE_TIME",
  "confidence": 0.94,
  "billedHours": 3.5,
  "allowedHours": 2.0,
  "potentialOvercharge": 675.00,
  "reason": "Billing guidelines limit contract review to 2 hours per day.",
  "policyReference": "RULE-001"
}
```

That becomes extremely important for auditability.

## 8. Database design

I'd keep the initial PostgreSQL model fairly simple:

```
Client
└── BillingPolicy
     └── PolicyRule

Matter
└── Invoice
     └── InvoiceLine

InvoiceLine
└── ReviewResult
     ├── violation
     ├── confidence
     ├── explanation
     └── policyReference
```

For example:

```sql
invoice
-------
id
client_id
law_firm_id
invoice_number
invoice_date
total_amount
status

invoice_line
------------
id
invoice_id
matter_id
lawyer_id
activity_date
description
hours
rate
amount

review_result
-------------
id
invoice_line_id
review_type
decision
violation_type
confidence
explanation
potential_savings
created_at
```

## 9. What I'd use the Vector DB for

Not everything belongs there.

**PostgreSQL** — use it for:

- Invoices
- Invoice lines
- Clients
- Law firms
- Lawyers
- Rates
- Matters
- Rules
- Review results
- Audit information

**Vector DB** — use it for:

- Billing guidelines
- Client policies
- Legal billing rules
- Historical examples
- Unstructured documentation

This is exactly the distinction between transactional data and semantic retrieval that I keep coming back to.

## 10. The MVP I'd build

Don't start with PDF ingestion + OCR + Kafka + Kubernetes + RAG + agents all at once. I'd build this in stages.

### Version 1

Input:

```json
{
  "invoiceLine": {
    "description": "Review contract",
    "hours": 3.5,
    "rate": 450
  },
  "rules": [
    {
      "type": "MAX_HOURS",
      "activity": "CONTRACT_REVIEW",
      "maxHours": 2
    }
  ]
}
```

Output:

```json
{
  "decision": "FLAG",
  "reason": "3.5 hours exceeds permitted 2 hours",
  "potentialOvercharge": 675
}
```

No AI yet.

### Version 2

Add:
- PostgreSQL
- Django
- REST API

### Version 3

Add:

```
PDF invoice
    ↓
Document extraction
    ↓
Structured invoice
```

### Version 4

Add:

```
Billing guidelines
    ↓
Embeddings
    ↓
Vector DB
    ↓
RAG
```

### Version 5

Add:
- LLM review

### Version 6

Add:
- Kafka, for asynchronous invoice processing.

### Version 7

Add:
- Web UI

Where a legal operations person sees:

| Line | Amount | Status | Reason |
|---|---|---|---|
| Contract review | €1,575 | 🔴 Flagged | Excessive time |
| Research | €800 | 🟢 OK | — |
| Admin work | €300 | 🔴 Flagged | Non-billable |
| Meeting | €450 | 🟡 Review | Possible duplication |