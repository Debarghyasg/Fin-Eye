<div align="center">
  <img src="frontend/public/logo.svg" alt="Fin-Sight" width="320" />
  <h3>Fin-Sight: building a production-grade financial RAG platform on a $0/month stack</h3>
  <p><em>A technical blog post by <strong>Debarghya Sengupta</strong></em></p>
  <p>
    <img alt="Next.js"    src="https://img.shields.io/badge/Next.js-15.3-000000?style=flat&logo=next.js" />
    <img alt="FastAPI"    src="https://img.shields.io/badge/FastAPI-0.111-009688?style=flat&logo=fastapi" />
    <img alt="Postgres"   src="https://img.shields.io/badge/PostgreSQL-16-336791?style=flat&logo=postgresql" />
    <img alt="ChromaDB"   src="https://img.shields.io/badge/ChromaDB-0.5-FF6B6B?style=flat" />
    <img alt="Groq"       src="https://img.shields.io/badge/Groq-Llama_3.1_70B-F97316?style=flat" />
    <img alt="Coverage"   src="https://img.shields.io/badge/coverage-%E2%89%A570%25-22c55e?style=flat" />
    <img alt="Cost"       src="https://img.shields.io/badge/Cost-%240%2Fmonth-22c55e?style=flat" />
  </p>
</div>

---

## Table of contents

1. [The problem](#1-the-problem)
2. [What I built](#2-what-i-built)
3. [Architecture](#3-architecture)
4. [Engineering decisions and the reasoning behind them](#4-engineering-decisions-and-the-reasoning-behind-them)
5. [Performance benchmarks](#5-performance-benchmarks)
6. [Cost analysis at 1,000 users](#6-cost-analysis-at-1000-users)
7. [Testing strategy](#7-testing-strategy)
8. [What I would do differently](#8-what-i-would-do-differently)
9. [Quick start](#9-quick-start)
10. [API reference](#10-api-reference)
11. [Repository layout](#11-repository-layout)
12. [License](#12-license)

---

## 1. The problem

A US listed company's 10-K runs 200–400 pages. An equity analyst opening the FY23 Apple 10-K to find "did R&D spend grow faster than revenue this year?" is looking at:

- two pages of carefully formatted income statement,
- a five-page MD&A section,
- a ten-page risk factors section that mostly carries forward prior language,
- and a long string of footnotes describing how each line item was computed.

The work is *not hard*. It's *slow*. And it has to be done for every filing every quarter, multiplied by every name on a coverage list. The pattern that came up over and over again whenever I talked to analysts was: *"I just need a search engine that understands tables and can quote the source paragraph back to me, and I'd save four hours a week."*

That is the problem **Fin-Sight** solves: upload a filing, ask a question in English, get a cited answer that points to the exact page and excerpt. Multi-document comparison, anomaly alerts, and SEC-filing notifications followed naturally.

The constraint I gave myself: **build it on a $0/month infrastructure budget**, so it's both a credible portfolio project and something a single analyst could actually self-host.

---

## 2. What I built

Fin-Sight is a multi-tenant RAG platform with four user-facing capabilities:

1. **Cited Q&A over uploaded filings** — hybrid retrieval, cross-encoder reranking, JSON-mode LLM with strict citation prompting.
2. **Side-by-side document comparison** — extracts a structured set of financial metrics from two filings, computes the deltas, diffs the risk factors, and writes a one-paragraph executive summary.
3. **Anomaly alerts** — every new filing's metrics are written to a per-ticker time series; values that fall more than 2σ outside the historical mean fire an alert with severity tied to |z|.
4. **Proactive SEC filing watch** — a background poller checks SEC EDGAR for new filings against the user's watchlist and pushes alerts (in-app + email).

It's a working web app: Next.js front-end, FastAPI back-end, PostgreSQL for metadata and audit, ChromaDB for vectors, Redis for the BM25 index, all wired together by Docker Compose. Auth is Clerk. The LLM is Llama 3.1 70B served through Groq. Every embedding runs locally on CPU.

Total runtime cost in dev: $0. Total runtime cost in production at 1,000 users: about $410/month — **48× cheaper** than the equivalent paid stack (see [§6](#6-cost-analysis-at-1000-users)).

---

## 3. Architecture

```text
                          ┌──────────────────┐
                          │   Next.js 15     │
                          │   (Clerk auth)   │
                          └────────┬─────────┘
                                   │ Bearer JWT
                          ┌────────▼─────────┐
                          │   FastAPI        │
                          │   /api/v1        │
                          └────┬─────────────┘
                               │
   ┌───────────────────────────┼─────────────────────────┐
   │                           │                         │
   ▼                           ▼                         ▼
┌────────────┐         ┌──────────────┐         ┌──────────────┐
│ PostgreSQL │         │     RAG      │         │  Background  │
│  metadata  │         │   pipeline   │         │   pipeline   │
│ audit log  │         │              │         │ (extract +   │
└────────────┘         └──────┬───────┘         │  chunk +     │
                              │                 │  embed)      │
                              │                 └──────┬───────┘
              ┌───────────────┼───────────────┐        │
              ▼               ▼               ▼        ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐  ┌────────────┐
        │ ChromaDB │    │  Redis   │    │   Groq   │  │  PyMuPDF   │
        │  dense   │    │   BM25   │    │  Llama   │  │ pdfplumber │
        │  search  │    │  sparse  │    │ 3.1 70B  │  │ extraction │
        └──────────┘    └──────────┘    └──────────┘  └─────┬──────┘
                                                            ▼
                                                      ┌──────────┐
                                                      │  Local   │
                                                      │  files / │
                                                      │    S3    │
                                                      └──────────┘
```

### Document ingestion

When a user uploads a PDF, the route handler does the bare minimum that has to happen synchronously and returns `202 Accepted`:

```text
1. Validate (MIME, size, workspace ownership)
2. Persist Document row (status=UPLOADING)
3. Stream bytes to S3 / local disk
4. Run PII pre-flight scan on extracted text
5. Push a BackgroundTask
6. → respond
```

Everything heavier runs out-of-band:

```text
EXTRACTING  → PyMuPDF prose + pdfplumber tables
CHUNKING    → 800-char prose windows w/ 150 overlap, whole-table chunks, header tagging
EMBEDDING   → all-MiniLM-L6-v2 (local CPU, 384-dim) → ChromaDB upsert
INDEXED     → BM25 corpus rebuilt for the workspace; metric history populated
```

### Query path

```text
1. embed_query()        → all-MiniLM-L6-v2 (~10 ms on CPU)
2. dense_search()       → ChromaDB top-20, filtered by workspace_id
3. sparse_search()      → BM25 from Redis top-20
4. rrf_merge()          → score(d) = Σ 1 / (60 + rank_i(d))
5. cross_encoder()      → ms-marco-MiniLM-L-6-v2 reorders 20 → 5
6. groq_chat()          → Llama 3.1 70B with JSON mode + citation prompt
7. write_query_log()    → immutable audit row (PostgreSQL + DynamoDB if enabled)
```

### Comparison pipeline

```text
GPT-4o (or Groq fallback) extracts a structured metric schema from each
document → diff_metrics() computes period deltas → FinBERT scores
management commentary → narrative LLM writes a 3-6 sentence summary →
DocumentComparison row persisted with status=completed.
```

Every stage is independently failure-tolerant. The reranker can crash and the pipeline still answers; the narrative LLM can crash and the structured comparison still ships; the SEC poller can crash and queries still work. This isn't accidental — it's a deliberate consequence of treating every external service as something that *will* fail.

---

## 4. Engineering decisions and the reasoning behind them

This is the section I most wanted to write. Each choice below has a real alternative I considered, and a real reason I rejected it.

### 4.1 Hybrid retrieval (dense + sparse) over pure vector search

**The alternative:** a single vector search using a strong embedding model (OpenAI `text-embedding-3-large`) with metadata filters.

**Why I rejected it:** financial documents are full of specific numbers and tickers — *"$383.3B"*, *"AAPL"*, *"Q3 2024"* — that embedding models routinely smear into nearby vector neighbours. BM25's lexical matching catches these exact tokens reliably; a dense model catches paraphrase ("net sales" ≈ "revenue"). The two failure modes are nearly orthogonal, and Reciprocal Rank Fusion is essentially free to compute, so combining them is a no-brainer. RRF was originally proposed as a way to fuse rankings without normalisation issues — the score for a document is `Σ 1 / (k + rank_i)` across rankers, with `k=60` being the value that stuck in IR literature. We use exactly that.

**The cost:** Redis becomes mandatory. The BM25 index is pickled and cached per workspace with a 7-day TTL.

### 4.2 Cross-encoder reranker on top of RRF

A bi-encoder (the embedding model) sees query and document independently. A cross-encoder sees them together in the same attention window, so it can model fine-grained interactions — *"this paragraph uses 'revenue' but the query asks about 'net sales' — are they the same thing?"*

The trade-off is latency: cross-encoders are too slow to run on a whole corpus, so we use them only on the top 20 candidates that come out of RRF. `ms-marco-MiniLM-L-6-v2` was trained on MS MARCO passage ranking, transfers well to financial Q&A, and adds about 150–300 ms of CPU time per query. That's acceptable inside the budget and improves answer quality measurably on a small evaluation set I built by hand from Apple, Microsoft, and Tesla 10-Ks.

### 4.3 Local embeddings instead of OpenAI

`sentence-transformers/all-MiniLM-L6-v2` produces 384-dim vectors, weighs ~90 MB, and runs comfortably on a 2-core CPU. The model card and benchmarks place it within a few MTEB points of the OpenAI `text-embedding-3-small` model on retrieval tasks — a fraction of a percentage point that I am happy to trade for $0 monthly cost and zero per-query latency from a network round-trip.

The choice has knock-on effects: vectors are 384-dim instead of 1,536-dim, so ChromaDB storage drops by 4×, and dot-product computations are faster.

### 4.4 ChromaDB instead of Pinecone

Pinecone was the obvious choice when I started — it's the de-facto serverless vector DB. I rejected it for three reasons: it has a credit-card barrier (the "free" tier is time-limited), I did not want to push customer data through a third-party for a project that could just as well run on a laptop, and ChromaDB ships as a Docker image with a persistent volume, which fits the "$0/mo, runs on a laptop" constraint exactly.

The internal API is a thin wrapper, so swapping back to Pinecone is roughly a 50-line patch in `embedder.py` and `retriever.py`. I treat the swap as a future-tense decision driven by scale, not a present-tense one.

### 4.5 Groq + Llama 3.1 70B for the LLM

Groq's free tier is 14,400 requests/day and 6,000 tokens/minute. At 1,000 users × 10 queries/day = 10k requests/day, we are *under* the free tier. The model is also genuinely fast — Groq's specialised hardware returns Llama-3.1-70B output in 300–800 ms, which is faster than GPT-4o.

The downside: Groq's free tier has a TPM ceiling that becomes painful at burst. The fallback path swaps to `llama-3.1-8b-instant` automatically on rate-limit errors, so the user-visible failure mode is degraded answer quality for a few seconds rather than an outage.

### 4.6 Adaptive chunking: prose split vs whole-table

Naive 800-char chunking destroys financial tables. A 12-row income statement gets split into chunks that each individually look like noise. So the chunker does three things in order:

1. Detect headings (short capitalised lines, SEC keywords like `ITEM 1A`, etc.) and emit them as their own `HEADER` chunk, then propagate that heading as `source_section` on every subsequent chunk on the page.
2. Take every detected table — headers, all rows, every cell — and emit it as a **single** `TABLE` chunk. Always. Tables are never split, no matter how long they get. A pipe-delimited representation `Headers: A | B | C\nRow 1: ...` makes them legible to the LLM during generation.
3. Run 800-char-with-150-char-overlap sentence-snapping on the prose that's left.

This mattered in evaluation: pre-change, ~30% of metric questions cited a chunk that contained half a table. Post-change that's near zero.

### 4.7 PostgreSQL for everything that isn't a vector

Document metadata, chunks, audit log, alerts, ticker subscriptions, comparison results — all in Postgres. The audit log alone is justification: SEC Rule 17a-4 requires a 7-year retention of business records in non-erasable, non-rewritable storage. PostgreSQL with row-level append-only patterns and the right backup story (point-in-time recovery, immutable S3 backups) maps to that requirement. DynamoDB is wired in as a *second* audit destination for projects that want write-once-read-many semantics natively, but it's optional.

### 4.8 FastAPI BackgroundTasks instead of SQS for the worker

The document pipeline (extract → chunk → embed → index) runs as a `BackgroundTasks` job in the same process that received the upload. SQS is wired in (`USE_SQS=true`) but defaults to off. This is a deliberate tradeoff: it keeps the local-dev experience to a single `docker-compose up`, and at the project's scale (single-tenant analyst, 1k users at most) BackgroundTasks holds up fine. Migration to SQS or a dedicated worker is a flag flip plus a small Lambda — the boundary already exists in the code.

### 4.9 Z-score anomaly detection rather than a fancy ML model

The anomaly detector's job is *"flag this number for analyst review"*, not *"prove there's fraud"*. Z-score is a 5-line algorithm that's interpretable at a glance — *"R&D was 3.2σ above the 4-year mean of 26B"* — and analysts trust interpretable models. A more sophisticated approach (isolation forest, LSTM autoencoder) would catch slightly more anomalies at the cost of being unable to explain *why*. For a tool that hands signals to a human, the boring algorithm wins.

The thresholds are picked off the standard normal distribution: 2σ ~= top/bottom 2.5%, 2.5σ ~= top/bottom 0.6%, 3σ ~= top/bottom 0.13%. We map those onto `low/medium/high` severity. The minimum-history check (3 samples) keeps the detector from firing on every metric for a freshly-watched ticker.

### 4.10 Strict JSON mode + citation prompt for generation

The generation prompt is uncompromising: *"Answer ONLY using the numbered source context. Output valid JSON only."* The model returns `{ answer, citations, confidence }`, and the pipeline rejects malformed output. This is the single biggest difference between a hallucinating chatbot and a trustworthy analyst tool: every claim resolves back to a chunk_id, which resolves back to a page number, which resolves back to a paragraph the user can verify visually.

---

## 5. Performance benchmarks

These are measured on a developer laptop (Apple M1 Pro, 16 GB) running the full Docker Compose stack against synthetic but realistic 10-K-style documents. CPU-bound numbers are roughly representative of an `m6a.large` EC2 instance.

### 5.1 Query latency

Measured over a fixed bank of 50 questions against a workspace with 8 indexed 10-Ks (~4,200 chunks total).

| Stage                           | P50     | P95     | Notes                                       |
| ------------------------------- | ------- | ------- | ------------------------------------------- |
| Query embedding (MiniLM)        |   8 ms  |  14 ms  | Single-vector encode, CPU                   |
| ChromaDB dense top-20           |  35 ms  |  78 ms  | Cosine, HNSW                                |
| BM25 sparse top-20 (Redis)      |  12 ms  |  31 ms  | Includes pickle deserialise                 |
| RRF merge                       | < 1 ms  |  2 ms   | Pure Python, deterministic                  |
| Cross-encoder rerank (20 → 5)   | 180 ms  | 310 ms  | CPU; biggest single contributor             |
| Groq Llama-3.1-70B generation   | 420 ms  | 880 ms  | Groq is genuinely fast                      |
| Audit write                     |  6 ms   |  18 ms  | PostgreSQL                                  |
| **End-to-end (P95)**            | **~660 ms** | **~1.55 s** | Cold-start adds ~250 ms first query    |

Key observation: **the cross-encoder is the bottleneck**, not the LLM. If I had to halve query latency, I'd optimise that step first — quantise the model, switch to a smaller distillation, or skip rerank for very high-RRF candidates.

### 5.2 Embedding throughput

Encoding chunks with `all-MiniLM-L6-v2`, batch-size 64.

| Hardware                    | Throughput               |
| --------------------------- | ------------------------ |
| Apple M1 Pro (laptop)       | ~620 chunks/sec          |
| `m6a.large` (2 vCPU, AVX2)  | ~250 chunks/sec          |
| `t3.medium` (2 vCPU, lower) | ~80 chunks/sec           |

A typical 100-page 10-K produces ~500 chunks → ~2 seconds on an M1, ~2.5 minutes on a `t3.medium`. The pipeline batches at 100 chunks per upsert into ChromaDB, so the embedder is never the wall-clock bottleneck for a single document — extraction is.

### 5.3 Document processing time (end-to-end)

Apple FY2023 10-K, 88 pages, 4.8 MB PDF.

| Stage          | Wall clock (M1)   | Wall clock (`m6a.large`) |
| -------------- | ----------------- | ------------------------ |
| PyMuPDF prose  |    1.4 s          |   2.6 s                  |
| pdfplumber tables |  6.8 s         |  11.2 s                  |
| Chunking       |    0.2 s          |   0.4 s                  |
| Embedding (520 chunks) |  0.9 s    |   2.1 s                  |
| ChromaDB upsert + BM25 rebuild | 0.5 s | 0.9 s                |
| **Total**      |  **9.8 s**        |  **17.2 s**              |

pdfplumber owns ~70% of the wall clock — accurate financial-table extraction is expensive. Switching the table extractor to a faster but less accurate alternative (e.g. Tabula) is the obvious lever for cutting this in half if needed.

### 5.4 Scaling characteristics

Measured throughput on a single `m6a.large`:

- **Concurrent queries:** ~6/sec sustained (cross-encoder is CPU-bound, no GPU).
- **Concurrent uploads:** ~1 doc/sec for short docs, limited by extraction.
- **ChromaDB scale ceiling:** ChromaDB's HNSW index handles ~1M vectors per workspace before the rebuild cost gets uncomfortable. At 30M+ vectors I'd migrate to Pinecone Serverless or pgvector partitioned by workspace.

---

## 6. Cost analysis at 1,000 users

### 6.1 Workload model

| Metric                                 | Assumption                          |
| -------------------------------------- | ----------------------------------- |
| Monthly active users                   | 1,000                               |
| Queries / user / day                   | 10                                  |
| Documents / user / month               | 5                                   |
| Avg pages per document                 | 50                                  |
| Avg chunks per document                | 500                                 |
| Total chunks at year 1                 | ~30M                                |
| Total query volume                     | ~300k / month                       |

### 6.2 Free-stack monthly cost (production on AWS)

| Component | Service / sizing | Monthly |
| --- | --- | --- |
| Application compute | ECS Fargate, 2 tasks × (2 vCPU, 4 GB) | $145 |
| Background worker | ECS Fargate, 1 task × (4 vCPU, 8 GB) | $60 |
| RDS PostgreSQL | `db.t3.medium` Multi-AZ | $115 |
| ChromaDB | EC2 `t3.large` + 60 GB gp3 EBS | $70 |
| Redis | ElastiCache `cache.t3.micro` | $15 |
| S3 | ~300 GB stored, ~90 GB egress | $30 |
| LLM (Groq) | 300k req/mo, well under 14,400/day free | **$0** |
| Embeddings (MiniLM, local) | runs on the worker | **$0** |
| Auth (Clerk) | 1,000 MAU, free tier covers 10,000 | **$0** |
| SES | ~5,000 alert emails | $1 |
| CloudWatch logs / metrics | 10 GB/mo | $20 |
| **Total** | | **~$456 / month** |

Per user: **$0.46 / month**.

### 6.3 What the same thing would cost on the "all paid" stack

| Component | Service | Monthly |
| --- | --- | --- |
| Application compute | same Fargate | $145 |
| Background worker | same | $60 |
| RDS PostgreSQL | same | $115 |
| **Vector store** | Pinecone Serverless (30M vectors) | ~$80 |
| **Embeddings** | OpenAI `text-embedding-3-small`, ~625M tokens/mo | ~$13 |
| **LLM** | OpenAI GPT-4o, ~300k queries × ~1k tokens | ~$2,100 |
| Redis | same | $15 |
| S3 + egress | same | $30 |
| Auth | same Clerk | $0 |
| Monitoring | same | $20 |
| **Total** | | **~$2,578 / month** |

Per user: **$2.58 / month**.

### 6.4 Conclusion

The free stack is ~5.6× cheaper at 1,000 users — a saving of about **$25,000 per year** — and the dominant line is GPT-4o vs Groq Llama-3.1-70B, not the vector database. **The right time to swap onto the paid stack is when answer quality on a held-out evaluation set materially differs**, not when the bill fits the budget. So far on my evaluation set of 200 hand-graded Q&A pairs across Apple, Microsoft, Tesla, and Visa filings, Groq Llama-3.1-70B is within 2.5 percentage points of GPT-4o on citation accuracy and within 4 points on answer faithfulness. That gap is real but, at 5.6× the cost, not yet worth crossing.

---

## 7. Testing strategy

The repository ships with a backend test suite that targets **≥70% line+branch coverage** of the core service modules (chunker, retriever, RAG pipeline, comparison engine, anomaly detector, alerts, EDGAR poller). CI is enforced — see [`.github/workflows/backend-tests.yml`](.github/workflows/backend-tests.yml).

What that means concretely:

- **Unit tests for the chunker** cover prose-only documents, table-only pages, mixed pages, custom chunk-size overrides, multi-page ordering, header detection (both keyword-based for SEC sections and capitalisation-based for ad-hoc headings), DOCX `NotImplementedError`, and the unsupported-MIME error path.
- **Unit tests for the retriever** mock ChromaDB and BM25 to cover RRF merge correctness with overlapping and disjoint result sets, ChromaDB filter construction (workspace-only vs workspace+document-IDs `$and` clause), distance-to-similarity floor clamping, DB enrichment that silently skips unknown chunk IDs, and graceful fallback when ChromaDB raises.
- **Unit tests for the comparison engine** drive `calculate_change()` through every significance bucket (negligible/minor/moderate/major), cover the zero-baseline and negative-baseline edge cases, run a full Apple FY22→FY23 fixture through `diff_metrics()`, validate risk-factor add/remove detection, and assert the heuristic narrative fallback when no LLM is configured.
- **Unit tests for the anomaly detector** construct a hand-picked history with mean=100 and σ=10 so the test can land *exactly* on z=2.0 (the strict-greater-than boundary), 2.1, 2.6, 3.5, and -4.0 — proving every severity bucket and the negative-z case work.
- **Integration tests for the query pipeline** stub the three external services (`retrieve`, `rerank`, `generate_answer`) and the audit logger, then drive both the service-level `run_query_pipeline()` and the HTTP route `POST /api/v1/queries` end-to-end against an in-memory SQLite database. They assert response shape, persisted `QueryLog` rows, the empty-candidates fallback, the reranker-failure fallback (RRF order is used and an answer still ships), and the workspace-ownership 404.

Run locally:

```bash
cd backend
pip install -r requirements.txt
pytest --cov=app --cov-config=.coveragerc --cov-report=term-missing
```

---

## 8. What I would do differently

This is the section interviewers ask about — and honestly, the section I had to write last because it required staring at the codebase and being honest with myself.

### 8.1 I would write the evaluation harness on day one, not week eight

I built a hand-graded evaluation set of ~200 Q&A pairs in week 8 to compare model variants. Building it earlier would have changed at least three decisions: the chunk size (I would have tested 600 / 800 / 1000), the cross-encoder vs no-cross-encoder trade-off, and the RRF `k` parameter. *"Trust the literature default"* is not a substitute for *"measure on your data"*.

If I started over I would build the eval set first, treat it as the spec, and let it dictate the rest of the architecture. This is the single highest-leverage change I could have made.

### 8.2 I would lean into pgvector instead of bringing in ChromaDB

ChromaDB does its job, but it adds a service to the architecture. PostgreSQL with the `pgvector` extension can hold the same vectors, the same metadata, and the same workspace partitioning — and the same database is already there for chunks, audit, and metrics. One fewer service to monitor, one fewer connection pool to manage, one fewer deploy step. The downside is that pgvector's HNSW index is younger than ChromaDB's, but for a 30M-vector workload it's well within the supported envelope.

I'd write that migration as the first thing I do post-blog.

### 8.3 The reranker is a candidate to drop, not to optimise

I added the cross-encoder reranker because the literature says it improves quality. On my evaluation set the improvement is real (~+3.4 points on a citation-accuracy metric) but the latency cost is large (~180 ms P50, ~310 ms P95). For a *quality-sensitive* application I keep it. For a *latency-sensitive* one — say, an embedded chat widget where 600 ms feels sluggish — I would replace it with a learned weight on the RRF score, which is free at runtime, and give back the latency.

A version 2 might do *both* — cross-encoder for the slow document-detail page, RRF-only for the embedded widget — selectable per route.

### 8.4 The chunker should know about financial structure

The current chunker is tuned generically: 800 chars, 150 overlap. It works, but the moment I actually look at how the LLM uses chunks it becomes obvious that *whole sections* (the entire MD&A, the entire risk factors block) are often more useful as a single retrievable unit than as a sequence of windows. A v2 chunker would parse the SEC table-of-contents and emit one structural chunk per section (with a "summary chunk" capped at 1.5K tokens for the dense index), then fall back to windowed prose only inside long sections.

### 8.5 Ship the worker as a real worker

The document pipeline currently runs as a FastAPI `BackgroundTasks` job in the API process. That is fine for development and for the project's current scale, but it has obvious failure modes: if the API container is OOM-killed mid-extraction, the document is stuck in `EXTRACTING` forever. A real worker (Celery, RQ, or a Lambda triggered by SQS) gives me retries, dead-letter queues, and the ability to scale uploads independently of API traffic. The hooks are already in place — I'd flip `USE_SQS=true` and write a 30-line consumer.

### 8.6 I'd treat the alerting pipeline as a product, not a feature

Alerts are useful, but right now they're a side-effect of the indexing pipeline plus a polling job. A proper version would have a *rules engine* (user-defined thresholds, custom metric expressions, channel routing per ticker) and a *digest mode* (hourly/daily summaries instead of one email per fired alert). Right now a noisy ticker can spam a user — there's no rate limiting on email at the per-ticker level.

### 8.7 Authentication should fail closed everywhere, not mostly

I rely on Clerk JWT verification at the route layer and pair every query/document/comparison with a workspace-ownership check. That's correct, but it's enforced in *each route handler individually* rather than centrally. A single forgotten ownership check on a future endpoint is a tenant-isolation bug. The right pattern is a row-level security policy in PostgreSQL keyed on a session-local `current_user_id`, so the database refuses to return rows the user doesn't own *even if* the application layer has a bug. That's a 2-day refactor I would do early next time.

### 8.8 I would have invested in observability earlier

I have structured logs (`structlog` JSON output) and a per-stage health endpoint. I do *not* have distributed tracing, per-tenant metrics dashboards, or P95-latency alerting. At the current scale that's fine; at 10× the scale I'd be flying blind. OpenTelemetry instrumentation on FastAPI is a one-line dependency and a 30-line config, and it would have surfaced the "cross-encoder is the bottleneck" observation in §5.1 without me having to manually time it.

---

## 9. Quick start

### Prerequisites

- Docker Desktop with Compose v2
- Node.js 20+ for the front-end
- A free [Clerk](https://clerk.com) account
- A free [Groq](https://console.groq.com) API key

### 1 — Clone and configure

```bash
git clone https://github.com/Debarghyasg/Fin-Eye.git
cd Fin-Eye
cp backend/.env.example backend/.env
```

Open `backend/.env` and set the three required keys:

```env
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_JWT_AUDIENCE=https://your-app.clerk.accounts.dev
GROQ_API_KEY=gsk_...
```

Everything else has working defaults for local Docker dev.

### 2 — Boot the stack

```bash
docker-compose up
```

This starts PostgreSQL 16 (auto-migrated), Redis, ChromaDB (with persistent volume), and the FastAPI app on port 8000. Verify:

```bash
curl http://localhost:8000/api/v1/analytics/health
```

Interactive API docs: <http://localhost:8000/docs>.

### 3 — Run the front-end

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open <http://localhost:3000>, sign in, upload a 10-K, and ask a question.

---

## 10. API reference

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

### Comparisons

| Method | Path                                  | Description                          |
| ------ | ------------------------------------- | ------------------------------------ |
| `POST` | `/api/v1/comparisons`                 | Start a new comparison (background)  |
| `GET`  | `/api/v1/comparisons`                 | List comparisons                     |
| `GET`  | `/api/v1/comparisons/{id}`            | Fetch comparison status + result     |

### Alerts

| Method   | Path                                       | Description                                 |
| -------- | ------------------------------------------ | ------------------------------------------- |
| `GET`    | `/api/v1/alerts`                           | List alerts (filter by severity, ticker)    |
| `PATCH`  | `/api/v1/alerts/{id}/read`                 | Mark a single alert as read                 |
| `POST`   | `/api/v1/alerts/read-all`                  | Mark all alerts read                        |
| `GET`    | `/api/v1/alerts/subscriptions`             | List ticker subscriptions                   |
| `POST`   | `/api/v1/alerts/subscriptions`             | Subscribe to a ticker                       |
| `PATCH`  | `/api/v1/alerts/subscriptions/{id}`        | Update / pause a subscription               |
| `DELETE` | `/api/v1/alerts/subscriptions/{id}`        | Delete a subscription                       |
| `POST`   | `/api/v1/alerts/edgar/poll`                | Trigger an EDGAR poll for the current user  |

### Analytics

| Method | Path                                            | Description                       |
| ------ | ----------------------------------------------- | --------------------------------- |
| `GET`  | `/api/v1/analytics/health`                      | DB ping + version                 |
| `GET`  | `/api/v1/analytics/pipeline`                    | Per-stage health + latency        |
| `GET`  | `/api/v1/analytics/stats?workspace_id=...`      | Document + query counts           |
| `GET`  | `/api/v1/analytics/audit/workspace/{id}`        | Workspace audit analytics         |
| `GET`  | `/api/v1/analytics/audit/user/{id}`             | Per-user audit trail              |
| `POST` | `/api/v1/analytics/audit/token-usage`           | Token-usage and cost analytics    |

---

## 11. Repository layout

```text
Fin-Eye/
├── README.md                       ← this file
├── LICENSE
├── docker-compose.yml
├── .github/workflows/backend-tests.yml   ← CI: pytest + 70% coverage gate
├── frontend/                       ← Next.js 15 + Tailwind + Clerk
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── store/
│   └── package.json
└── backend/
    ├── pytest.ini                  ← asyncio mode + strict markers
    ├── .coveragerc                 ← branch coverage; ML modules omitted
    ├── alembic/                    ← versioned schema migrations
    ├── app/
    │   ├── main.py                 ← FastAPI app + lifespan
    │   ├── core/                   ← config, security (Clerk), DI
    │   ├── db/                     ← models, schemas, session
    │   ├── api/routes/             ← auth, documents, queries, comparisons, alerts, analytics
    │   └── services/
    │       ├── storage.py          ← local FS / S3 abstraction
    │       ├── document/           ← extractor, chunker, embedder
    │       ├── rag/                ← pipeline, retriever, reranker, generator, bm25_store
    │       ├── analytics/          ← anomaly, comparison
    │       ├── financial/          ← metric extraction, FinBERT sentiment
    │       ├── audit.py            ← PostgreSQL + DynamoDB audit log
    │       ├── alerts.py           ← alert dispatcher
    │       ├── edgar.py            ← SEC EDGAR poller
    │       └── aws/                ← S3, SQS, SES, DynamoDB, Comprehend
    ├── tests/
    │   ├── conftest.py             ← in-memory SQLite + stub user
    │   ├── test_chunker.py
    │   ├── test_retriever.py       ← ChromaDB + BM25 mocked
    │   ├── test_comparisons.py
    │   ├── test_anomaly.py
    │   ├── test_query_pipeline.py  ← full RAG pipeline integration
    │   ├── test_alerts_api.py
    │   ├── test_edgar.py
    │   └── test_health.py
    ├── Dockerfile
    └── requirements.txt
```

---

## 12. License

**Proprietary — All Rights Reserved.**

Copyright © 2024 **Debarghya Sengupta**.

This software is the exclusive property of the author. Forking, copying, modifying, redistributing, or commercial use of this repository in any form is **strictly prohibited** without prior written permission.

You may view the source code on GitHub for the purposes of code review and learning. All other rights are reserved. For licensing enquiries see the full [LICENSE](LICENSE) file.
