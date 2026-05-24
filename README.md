<div align="center">

>>>>>>> 1fedbae (Theme added)
  <img src="frontend/public/logo.svg" alt="Fin-Sight" width="320" />
  <h3>Financial Document Intelligence — 100% Free Stack</h3>
  <p><strong>Upload financial filings &rarr; ask questions &rarr; get cited answers</strong></p>
  <p>
    <img alt="Next.js"    src="https://img.shields.io/badge/Next.js-15.3-000000?style=flat&logo=next.js" />
    <img alt="FastAPI"    src="https://img.shields.io/badge/FastAPI-0.111-009688?style=flat&logo=fastapi" />
    <img alt="Postgres"   src="https://img.shields.io/badge/PostgreSQL-16-336791?style=flat&logo=postgresql" />
    <img alt="ChromaDB"   src="https://img.shields.io/badge/ChromaDB-0.5-FF6B6B?style=flat" />
    <img alt="Groq"       src="https://img.shields.io/badge/Groq-Llama_3.1_70B-F97316?style=flat" />
    <img alt="Cost"       src="https://img.shields.io/badge/Cost-%240%2Fmonth-22c55e?style=flat" />
    <img alt="License"    src="https://img.shields.io/badge/License-Proprietary-red?style=flat" />
  </p>
</div>

---

## What is Fin-Sight?

Fin-Sight is a production-grade RAG platform built specifically for financial documents — 10-Ks, earnings calls, prospectuses, annual reports. Upload a filing, ask questions in natural language, and get answers with **inline citations**, **page numbers**, and **confidence scores**. Compare two filings side by side. Get anomaly alerts when key metrics deviate from historical norms.

**Why this exists:** institutional analysts spend hours reading 300-page filings to find one number. Fin-Sight reads them once and answers questions in seconds — with the exact source paragraph cited so you can verify every claim.

---

## Key features

- **Hybrid RAG** — ChromaDB dense vector search + BM25 sparse search merged via Reciprocal Rank Fusion
- **Cross-encoder reranking** — `ms-marco-MiniLM-L-6-v2` reorders top-20 candidates for relevance
- **LLM-grounded answers** — Llama 3.1 70B (via Groq) with strict citation prompting + JSON output
- **Adaptive chunking** — 800-char prose with 150-char overlap, whole-table chunks, header detection
- **PII pre-storage scan** — regex-based scanner blocks SSNs, credit cards, passport numbers
- **Async pipeline** — uploads return immediately, processing happens in background tasks
- **Immutable audit log** — every query written to Postgres, satisfies SEC Rule 17a-4 retention
- **Workspace isolation** — each workspace has its own ChromaDB namespace + BM25 index
- **Real document extraction** — PyMuPDF for prose, pdfplumber for financial tables (no OCR yet)

---

## Why is everything free?

| Layer | Service | Free tier |
|---|---|---|
| LLM | **Groq** (Llama 3.1 70B) | 14,400 requests / day, 6k tokens / min |
| Embeddings | **HuggingFace** `all-MiniLM-L6-v2` | Runs locally on CPU — no API |
| Vector store | **ChromaDB** | Self-hosted in Docker, persistent volume |
| Sparse search | **rank-bm25** + Redis | Both in Docker |
| Database | **PostgreSQL 16** | In Docker |
| File storage | **Local filesystem** | Docker volume |
| Queue | **FastAPI BackgroundTasks** | In-process |
| Auth | **Clerk** (free tier) | 10,000 monthly active users |
| Re-ranker | **sentence-transformers** | CPU, 85 MB model |

**Total monthly cost: \$0.** No credit card needed except Clerk (and Clerk doesn't ask for one on the free tier).

---

## Quick start

### Prerequisites

- **Docker Desktop** + Docker Compose v2
- **Node.js 20+** (for the frontend)
- A free [Clerk](https://clerk.com) account
- A free [Groq](https://console.groq.com) API key

### 1 — Clone

```bash
git clone https://github.com/Debarghyasg/Fin-Eye.git
cd Fin-Eye
```

### 2 — Configure environment

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in **just three things**:

```env
# From dashboard.clerk.com
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_JWT_AUDIENCE=https://your-app.clerk.accounts.dev

# From console.groq.com (60-second signup)
GROQ_API_KEY=gsk_...
```

Everything else has working defaults for local Docker dev.

### 3 — Start the backend

```bash
docker-compose up
```

This boots:

- **PostgreSQL 16** (port 5432) — runs Alembic migrations automatically on first start
- **Redis** (port 6379) — caches BM25 indices
- **ChromaDB** (port 8001) — vector store with persistent volume
- **FastAPI** (port 8000) — auto-reloads on file changes

Verify:

```bash
curl http://localhost:8000/api/v1/analytics/health
# {"status":"ok","database":"ok",...}
```

Interactive API docs: **http://localhost:8000/docs**

### 4 — Start the frontend

In a new terminal:

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open **http://localhost:3000**, sign in, upload a 10-K, ask a question.

---

## Architecture

```text
                          +------------------+
                          |   Next.js 15     |
                          |   (Clerk auth)   |
                          +--------+---------+
                                   | Bearer JWT
                          +--------v---------+
                          |   FastAPI        |
                          |   /api/v1        |
                          +----+-------------+
                               |
   +---------------------------+-------------------------+
   |                           |                         |
   v                           v                         v
+------------+         +--------------+         +--------------+
| PostgreSQL |         |     RAG      |         |  Background  |
|  metadata  |         |   pipeline   |         |   pipeline   |
| audit log  |         |              |         | (extract +   |
+------------+         +------+-------+         |  chunk +     |
                              |                 |  embed)      |
                              |                 +------+-------+
              +---------------+---------------+        |
              v               v               v        v
        +----------+    +----------+    +----------+  +------------+
        | ChromaDB |    |  Redis   |    |   Groq   |  |  PyMuPDF   |
        |  dense   |    |   BM25   |    |  Llama   |  | pdfplumber |
        |  search  |    |  sparse  |    | 3.1 70B  |  | extraction |
        +----------+    +----------+    +----------+  +-----+------+
                                                            v
                                                      +----------+
                                                      |  Local   |
                                                      |  files / |
                                                      |    S3    |
                                                      +----------+
```

### Query flow

```text
1. embed_query()        -> all-MiniLM-L6-v2 (384-dim, local CPU)
2. dense_search()       -> ChromaDB top-20 (workspace_id filter)
3. sparse_search()      -> BM25 from Redis top-20
4. rrf_merge()          -> score(d) = sum( 1 / (60 + rank_i) )
5. cross_encoder()      -> reorder top-20 -> top-5
6. groq_chat()          -> Llama 3.1 70B with JSON mode + strict citation prompt
7. write_query_log()    -> immutable audit row in Postgres
```

---

## API reference

### Auth

| Method   | Path                            | Description                   |
| -------- | ------------------------------- | ----------------------------- |
| `GET`    | `/api/v1/auth/me`               | Current user profile          |
| `PATCH`  | `/api/v1/auth/me`               | Update display name / email   |
| `GET`    | `/api/v1/auth/me/workspaces`    | List workspaces               |
| `POST`   | `/api/v1/auth/me/workspaces`    | Create a workspace            |

### Documents

| Method   | Path                                      | Description                                |
| -------- | ----------------------------------------- | ------------------------------------------ |
| `POST`   | `/api/v1/documents/upload`                | Upload PDF / DOCX / TXT (returns 202)      |
| `GET`    | `/api/v1/documents?workspace_id=...`      | Paginated list                             |
| `GET`    | `/api/v1/documents/{id}`                  | Document detail                            |
| `GET`    | `/api/v1/documents/{id}/status`           | Lightweight polling endpoint               |
| `GET`    | `/api/v1/documents/{id}/chunks`           | Extracted chunks                           |
| `PATCH`  | `/api/v1/documents/{id}`                  | Update ticker / fiscal period              |
| `DELETE` | `/api/v1/documents/{id}`                  | Hard delete + cleanup                      |

### Queries

| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| `POST` | `/api/v1/queries`               | Run hybrid RAG query, return answer  |
| `GET`  | `/api/v1/queries/history`       | Paginated audit log                  |

### Analytics

| Method | Path                                            | Description                       |
| ------ | ----------------------------------------------- | --------------------------------- |
| `GET`  | `/api/v1/analytics/health`                      | DB ping + version                 |
| `GET`  | `/api/v1/analytics/pipeline`                    | Per-stage health + latency        |
| `GET`  | `/api/v1/analytics/stats?workspace_id=...`      | Document + query counts           |

---

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, Framer Motion, Zustand, Recharts, react-dropzone |
| Backend | FastAPI 0.111, Python 3.11, SQLAlchemy 2 (async), asyncpg |
| Database | PostgreSQL 16 + Alembic migrations |
| Auth | Clerk (RS256 JWT verification via JWKS) |
| Vector store | ChromaDB 0.5 (HTTP client) |
| Sparse retrieval | rank-bm25 + Redis 7 (pickle-cached per workspace) |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` (384-dim, CPU) |
| Re-ranker | sentence-transformers `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| LLM | Groq (Llama 3.1 70B + 8B fallback) — JSON mode |
| Document extraction | PyMuPDF (prose) + pdfplumber (tables) |
| File storage | Local filesystem (Docker volume) — pluggable to S3 |
| Queue | FastAPI BackgroundTasks — pluggable to SQS |
| Observability | structlog (JSON logs) |
| Local dev | Docker Compose (4 services) |

---

## Repository layout

```text
Fin-Eye/
|-- README.md
|-- LICENSE
|-- docker-compose.yml
|-- frontend/
|   |-- public/
|   |   |-- logo.svg            # Full wordmark
|   |   |-- logo-mark.svg       # Just the fin (sidebar / auth pages)
|   |   `-- favicon.svg
|   |-- src/
|   |   |-- app/                # App Router pages
|   |   |   |-- (auth)/         # sign-in, sign-up
|   |   |   `-- (app)/          # dashboard, workspace, compare, alerts, settings
|   |   |-- components/         # ui/, layout/, dashboard/, workspace/
|   |   |-- lib/                # utils, mock data
|   |   `-- store/              # Zustand
|   `-- package.json
`-- backend/
    |-- app/
    |   |-- main.py             # FastAPI app + lifespan
    |   |-- core/               # config, security (Clerk), dependencies
    |   |-- db/                 # models, schemas, session
    |   |-- api/routes/         # auth, documents, queries, analytics
    |   `-- services/
    |       |-- storage.py      # local-filesystem / S3 abstraction
    |       |-- document/       # extractor, chunker, embedder
    |       |-- rag/            # pipeline, retriever, reranker, generator, bm25_store
    |       |-- analytics/      # comparison, anomaly (Week 4 stubs)
    |       `-- aws/            # s3, sqs, comprehend (only used if USE_S3=true)
    |-- alembic/                # versioned migrations
    |-- tests/                  # pytest + in-memory SQLite
    |-- Dockerfile
    `-- requirements.txt
```

---

## Roadmap

- [x] **Week 1** — Auth, DB schema, FastAPI skeleton, health checks
- [x] **Week 2** — Upload pipeline, S3-or-local storage, PII scan, extraction, chunking
- [x] **Week 3** — Embeddings, ChromaDB, BM25, RRF, cross-encoder rerank, Groq generator
- [ ] **Week 4** — Document comparison (metric deltas, risk diff, sentiment), anomaly detection
- [ ] **Week 5** — Terraform to AWS (ECS Fargate, RDS, real S3 + SQS), Datadog APM
- [ ] **Week 6** — Embeddable widget, Slack / PagerDuty alerts, CSV / Excel ingestion

---

## License

**Proprietary &mdash; All Rights Reserved.**

Copyright &copy; 2024 **Debarghya Sengupta**.

This software is the exclusive property of the author. Forking, copying,
modifying, redistributing, or commercial use of this repository in any
form is **strictly prohibited** without prior written permission.

You may view the source code on GitHub for the purposes of code review
and learning. All other rights are reserved.

For licensing enquiries see the full [LICENSE](LICENSE) file.
