# FinSight AI

> Production-grade financial document intelligence platform — query 10-Ks, earnings calls, and SEC filings with cited answers, anomaly detection, and full audit trails.

---

## Monorepo structure

```
Fin-Eye/
├── frontend/          Next.js 14 (App Router) — TypeScript, Tailwind, Framer Motion
├── backend/           FastAPI — Python 3.11, SQLAlchemy async, Alembic
├── docker-compose.yml PostgreSQL 16 + API + LocalStack (S3/SQS)
└── README.md
```

---

## Quick start — local dev

### Prerequisites
- Docker + Docker Compose v2
- Node.js 20+ (for frontend)
- Python 3.11+ (for backend outside Docker)
- A [Clerk](https://clerk.com) account (free tier is fine)

### 1 — Clone and configure

```bash
git clone https://github.com/Debarghyasg/Fin-Eye.git
cd Fin-Eye

# Copy env template and fill in Clerk keys
cp backend/.env.example backend/.env
# Edit backend/.env — minimum required:
#   CLERK_SECRET_KEY=sk_test_...
#   CLERK_PUBLISHABLE_KEY=pk_test_...
#   CLERK_JWT_AUDIENCE=https://your-app.clerk.accounts.dev
```

### 2 — Start infrastructure

```bash
# Starts: PostgreSQL 16, FastAPI (with --reload), LocalStack (S3 + SQS)
docker-compose up
```

On first boot the API container will:
1. Run `alembic upgrade head` — creates all 5 tables
2. Create the S3 bucket `finsight-documents` in LocalStack
3. Create the SQS queue `finsight-documents` in LocalStack

### 3 — Verify the API is running

```bash
curl http://localhost:8000/
# {"service":"FinSight AI","version":"0.1.0","status":"ok"}

curl http://localhost:8000/api/v1/analytics/health
# {"status":"ok","database":"ok","version":"0.1.0","environment":"development"}
```

Interactive API docs: **http://localhost:8000/docs**

### 4 — Run the frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

---

## Backend — manual setup (without Docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run migrations against a local Postgres
alembic upgrade head

# Start the dev server
uvicorn app.main:app --reload --port 8000
```

---

## Run tests

```bash
cd backend
pip install pytest pytest-asyncio httpx aiosqlite
pytest tests/ -v
```

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/auth/me` | Current user profile |
| PATCH | `/api/v1/auth/me` | Update display name |
| GET | `/api/v1/auth/me/workspaces` | List workspaces |
| POST | `/api/v1/auth/me/workspaces` | Create workspace |
| POST | `/api/v1/documents/upload` | Upload document (async pipeline) |
| GET | `/api/v1/documents?workspace_id=` | List documents |
| GET | `/api/v1/documents/{id}` | Document detail |
| GET | `/api/v1/documents/{id}/status` | Poll processing status |
| GET | `/api/v1/documents/{id}/chunks` | List extracted chunks |
| PATCH | `/api/v1/documents/{id}` | Update metadata |
| DELETE | `/api/v1/documents/{id}` | Delete document |
| POST | `/api/v1/queries` | RAG query *(Week 3)* |
| GET | `/api/v1/queries/history` | Query audit log |
| GET | `/api/v1/analytics/health` | Health check |
| GET | `/api/v1/analytics/pipeline` | Pipeline stage status |
| GET | `/api/v1/analytics/stats` | Workspace statistics |
| POST | `/api/v1/analytics/compare` | Doc comparison *(Week 4)* |

---

## Document processing pipeline

```
Upload → S3 → PII Scan (Comprehend) → SQS event
                                           ↓
                               Background worker / Lambda
                                           ↓
                              PyMuPDF prose extraction
                              pdfplumber table extraction
                                           ↓
                              Chunker (800/150 prose + whole-table)
                                           ↓
                              DB chunks written  ← Week 2 ✓
                                           ↓
                              OpenAI embeddings → Pinecone  ← Week 3
                                           ↓
                              Anomaly detection + alerts     ← Week 4
```

---

## PostgreSQL — manual migration query

If you need to run the migration manually against an external database:

```bash
# From backend/
DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/dbname alembic upgrade head
```

Or provide the connection string in `backend/.env` and run `alembic upgrade head`.

---

## Environment variables

See [`backend/.env.example`](backend/.env.example) for the full list with descriptions.

**Minimum required to start:**

| Variable | Where to get it |
|----------|-----------------|
| `DATABASE_URL` | Your Postgres connection string |
| `CLERK_SECRET_KEY` | [Clerk dashboard](https://dashboard.clerk.com) → API Keys |
| `CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys |
| `CLERK_JWT_AUDIENCE` | Clerk dashboard → API Keys → Frontend API URL |

**Required for Week 3 (RAG queries):**

| Variable | Where to get it |
|----------|-----------------|
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |
| `PINECONE_API_KEY` | [app.pinecone.io](https://app.pinecone.io) |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Framer Motion, Zustand, Recharts |
| Backend | FastAPI, Python 3.11, SQLAlchemy 2 async, asyncpg |
| Database | PostgreSQL 16 |
| Migrations | Alembic |
| Auth | Clerk (JWT RS256) |
| Storage | AWS S3 (LocalStack in dev) |
| Queue | AWS SQS (LocalStack in dev) |
| PII detection | AWS Comprehend (regex fallback in dev) |
| Extraction | PyMuPDF + pdfplumber |
| Vector store | Pinecone *(Week 3)* |
| LLM | GPT-4o *(Week 3)* |
| Infra | Terraform + AWS ECS Fargate *(Week 5)* |
