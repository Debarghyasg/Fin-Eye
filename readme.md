# FinSight AI — Financial Document Intelligence Platform

A production-grade frontend for querying, comparing, and monitoring financial documents. Built to demonstrate AWS-scale distributed systems architecture and JP Morgan–grade security to interviewers at Amazon and JP Morgan.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS + tailwindcss-animate |
| Components | Shadcn/ui (Radix UI primitives) |
| Animations | Framer Motion |
| State | Zustand |
| Server State | TanStack React Query |
| Charts | Recharts |
| File Upload | React Dropzone |
| Auth | Clerk |

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/dashboard`.

---

## Pages

| Route | Description |
|---|---|
| `/sign-in` | Auth page with OAuth + email/password, animated orbs |
| `/sign-up` | 2-step registration with features panel |
| `/dashboard` | Portfolio overview — stats, Recharts revenue area/bar, query volume, RAG pipeline status |
| `/workspace` | Document upload (drag-drop + S3 simulation), document list, AI query panel with source chips |
| `/compare` | Side-by-side document comparison — metrics table, risk factor diffs, sentiment analysis, AI narrative |
| `/alerts` | Alert feed with severity filtering, per-ticker subscriptions, delivery settings |
| `/settings` | Security toggles, API key management |

---

## Architecture Highlights (Interview-Ready)

### Async Document Pipeline
Uploads simulate the real AWS pattern: S3 → SQS → Lambda (embed) → Pinecone index. No API blocking.

### Hybrid RAG
BM25 keyword search + dense vector retrieval → cross-encoder re-ranking → GPT-4o with structured outputs.

### Security
- PII detection before storage (AWS Comprehend)
- KMS encryption at rest
- 7-year immutable audit log (DynamoDB) — SEC Rule 17a-4

### Observability
Pipeline status panel shows per-stage latency. CloudWatch + Datadog APM in production.

---

## Design System

- **Dark theme** with deep navy `#080e18` background
- **Accent**: FinSight green `#22a269` with glow effects
- **Glass morphism** cards with gradient borders
- **Framer Motion** on every page entry, sidebar collapse, chart renders, and micro-interactions
- Custom animated scrollbars, shimmer loaders, typing indicators
