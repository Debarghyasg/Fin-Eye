# Fin-Eye — Windows 11 Setup & Test Guide (No Docker)

Everything runs natively on Windows 11 — no Docker, no WSL, no virtual machines.  
Total setup time: **~30 minutes** (most of it is pip downloading ML models).

---

## Table of Contents

1. [Install the tools](#1-install-the-tools)
2. [Get the code](#2-get-the-code)
3. [Create the database](#3-create-the-database)
4. [Configure the backend](#4-configure-the-backend)
5. [Install backend Python packages](#5-install-backend-python-packages)
6. [Run database migrations](#6-run-database-migrations)
7. [Configure the frontend](#7-configure-the-frontend)
8. [Install frontend packages](#8-install-frontend-packages)
9. [Start everything](#9-start-everything)
10. [Verify the whole system works](#10-verify-the-whole-system-works)
11. [Test every feature end-to-end](#11-test-every-feature-end-to-end)
12. [Run the automated test suite](#12-run-the-automated-test-suite)
13. [Daily startup routine](#13-daily-startup-routine)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Install the tools

Do each step below **in order**. Use **Git Bash** for all terminal commands (installed in step 1.1).

### 1.1 Git
1. Go to **https://git-scm.com/download/win**
2. Download and run the installer — click **Next** through all defaults
3. After install, search **Start → Git Bash** — use Git Bash for every command in this guide

### 1.2 Python 3.11
1. Go to **https://www.python.org/downloads/release/python-3119/**
2. Scroll down → click **Windows installer (64-bit)**
3. Run it → **tick "Add python.exe to PATH"** at the very bottom → click **Install Now**
4. Verify:
```bash
python --version
# Expected: Python 3.11.x
```

### 1.3 Node.js 20 LTS
1. Go to **https://nodejs.org** → click **20.x.x LTS**
2. Run the installer — all defaults
3. Verify:
```bash
node --version   # v20.x.x
npm --version    # 10.x.x
```

### 1.4 PostgreSQL 16
1. Go to **https://www.enterprisedb.com/downloads/postgres-postgresql-downloads**
2. Download **PostgreSQL 16** for Windows x86-64
3. Run the installer:
   - Password for the `postgres` superuser: **`finsight_dev`** (remember this)
   - Port: **5432** (leave as-is)
   - Uncheck **Stack Builder** at the end
4. Add psql to your PATH:
```bash
echo 'export PATH="$PATH:/c/Program Files/PostgreSQL/16/bin"' >> ~/.bashrc
source ~/.bashrc
```
5. Verify:
```bash
psql --version
# Expected: psql (PostgreSQL) 16.x
```

### 1.5 Qdrant (vector database — single .exe, no install)
1. Go to **https://github.com/qdrant/qdrant/releases/latest**
2. Download **`qdrant-x86_64-pc-windows-msvc.zip`**
3. Extract it → move `qdrant.exe` to **`C:\qdrant\qdrant.exe`**
4. Verify later in step 9 (just run it to confirm it starts)

### 1.6 Redis
1. Go to **https://github.com/microsoftarchive/redis/releases**
2. Download **`Redis-x64-3.0.504.msi`**
3. Run the installer → tick **"Add Redis to the PATH"**
4. Verify:
```bash
redis-cli ping
# Expected: PONG
```

---

## 2. Get the code

```bash
cd C:/
git clone https://github.com/Debarghyasg/Fin-Eye.git
cd Fin-Eye
```

---

## 3. Create the database

```bash
# Connect as the postgres superuser (enter password: finsight_dev when asked)
psql -U postgres -h localhost
```

Inside the `psql` prompt, run these three lines then quit:

```sql
CREATE USER finsight WITH PASSWORD 'finsight_dev';
CREATE DATABASE finsight OWNER finsight;
\q
```

Verify the database exists:
```bash
psql -U finsight -h localhost -d finsight -c "SELECT version();"
# Expected: PostgreSQL 16.x ... (one line printed, no errors)
```

---

## 4. Configure the backend

```bash
cd C:/Fin-Eye/backend
cp .env.example .env
```

Open `C:/Fin-Eye/backend/.env` in Notepad (or any text editor) and set **these 3 values**:

```ini
CLERK_SECRET_KEY=sk_test_REPLACE_ME
CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
GROQ_API_KEY=gsk_REPLACE_ME
```

**Get your Clerk keys (2 minutes, free):**
1. Go to **https://clerk.com** → Sign Up → create an application
2. Choose **Email** as the sign-in method
3. In the left sidebar click **API Keys**
4. Copy `Publishable key` → paste as `CLERK_PUBLISHABLE_KEY`
5. Copy `Secret key` → paste as `CLERK_SECRET_KEY`

**Get your Groq key (1 minute, free):**
1. Go to **https://console.groq.com** → Sign Up
2. Go to **API Keys** in the left sidebar → **Create API Key**
3. Copy the key (starts with `gsk_`) → paste as `GROQ_API_KEY`

Everything else in `.env` already has correct defaults for local Windows dev.  
**Do not change anything else unless you know what you're doing.**

---

## 5. Install backend Python packages

```bash
cd C:/Fin-Eye/backend

# Create an isolated virtual environment
python -m venv .venv

# Activate it (you must do this every time you open a new terminal for the backend)
source .venv/Scripts/activate
# You should now see (.venv) at the start of your prompt

# Install all packages — this takes 5–15 minutes on first run
# (downloads PyTorch ~200 MB, sentence-transformers ~90 MB, FinBERT ~440 MB)
pip install -r requirements.txt

# Download the spaCy language model for PII scanning
python -m spacy download en_core_web_sm
```

Create the uploads folder where PDFs will be stored:
```bash
mkdir C:/Fin-Eye/backend/uploads
```

---

## 6. Run database migrations

```bash
# Make sure you are in backend/ with .venv active
cd C:/Fin-Eye/backend
source .venv/Scripts/activate

alembic upgrade head
```

Expected output (last 3 lines):
```
INFO  [alembic.runtime.migration] Running upgrade  -> 0001, initial_schema
INFO  [alembic.runtime.migration] Running upgrade 0001 -> 0002, add_analytics_summary
...
INFO  [alembic.runtime.migration] Running upgrade 0004 -> 0005, add_audit_logs
```

If you see those lines and no `ERROR`, migrations succeeded.

---

## 7. Configure the frontend

Create the file `C:/Fin-Eye/frontend/.env.local` — open Notepad, paste this, then **File → Save As** with that exact filename:

```ini
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
CLERK_SECRET_KEY=sk_test_REPLACE_ME
```

Replace both `REPLACE_ME` values with the same Clerk keys from step 4.

---

## 8. Install frontend packages

```bash
cd C:/Fin-Eye/frontend
npm install
```

Expected: finishes with `added N packages` and no `ERROR` lines.

---

## 9. Start everything

You need **4 Git Bash windows open at the same time**. Open them with  
**Start → Git Bash** (right-click the taskbar icon → New window).

### Window 1 — Qdrant
```bash
cd C:/qdrant
./qdrant.exe
```
✅ Ready when you see: `Qdrant HTTP listening on 0.0.0.0:6333`

### Window 2 — Redis
```bash
redis-server
```
✅ Ready when you see: `Ready to accept connections`

### Window 3 — FastAPI backend
```bash
cd C:/Fin-Eye/backend
source .venv/Scripts/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
✅ Ready when you see: `Application startup complete.`

### Window 4 — Next.js frontend
```bash
cd C:/Fin-Eye/frontend
npm run dev
```
✅ Ready when you see: `Ready on http://localhost:3000`

---

## 10. Verify the whole system works

Run each check in a **5th Git Bash window** while the 4 servers above are running.

### 10.1 — Qdrant is up
```bash
curl http://localhost:6333/
# Expected JSON response with "title": "qdrant - vector search engine"
```

### 10.2 — Redis is up
```bash
redis-cli ping
# Expected: PONG
```

### 10.3 — PostgreSQL is up
```bash
psql -U finsight -h localhost -d finsight -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
# Expected: a number >= 10 (the migrated tables)
```

### 10.4 — Backend health check
```bash
curl http://localhost:8000/api/v1/analytics/health
# Expected:
# {"status":"ok","database":"ok","version":"0.1.0","environment":"development"}
```

### 10.5 — Backend pipeline check
```bash
curl http://localhost:8000/api/v1/analytics/pipeline \
  -H "Authorization: Bearer test" 2>/dev/null | python -m json.tool
# Expected: JSON with "overall" and a "stages" array listing PostgreSQL, Qdrant, Groq LLM etc.
# Note: this endpoint requires auth — a 401 here is normal without a real JWT.
# The health endpoint in 10.4 (no auth) is the true liveness check.
```

### 10.6 — Frontend loads
Open **http://localhost:3000** in your browser.  
✅ You should see the Fin-Eye sign-in page (powered by Clerk).

### 10.7 — Swagger API docs
Open **http://localhost:8000/docs** in your browser.  
✅ You should see the interactive FastAPI Swagger UI listing all endpoints.

---

## 11. Test every feature end-to-end

### 11.1 — Sign up and sign in
1. Open **http://localhost:3000**
2. Click **Sign up** → enter your email → follow the verification email
3. You should land on the **Dashboard** page

### 11.2 — Upload a document
1. Go to the **Workspace** page (left sidebar)
2. Click **Upload Documents**
3. Drag a PDF onto the dropzone (use any 10-K from **https://www.sec.gov/cgi-bin/browse-edgar**)
4. Watch the card status change:  
   `uploading → extracting → chunking → embedding → indexed`  
   (takes ~10–30 seconds depending on PDF size)
5. ✅ When the card shows **Indexed** with a green dot, the document is ready

> **Note:** With `CELERY_TASK_ALWAYS_EAGER=true` (the default), processing happens
> synchronously — the upload button will appear to hang for ~10–30 s while the
> document indexes. This is normal. You can watch progress in Window 3 (backend logs).

### 11.3 — Ask a question (RAG query)
1. In the Workspace centre panel, type a question, e.g.:  
   `What was total revenue and how did it change year over year?`
2. Press **Enter** or click the send button
3. ✅ You should get:
   - A cited answer with **[1]**, **[2]** citation markers
   - Source cards in the right panel showing document name, page number, excerpt
   - Clicking a source opens the **PDF viewer** on the cited page

### 11.4 — View document chunks
1. In the document list, hover over a document card → click **⋮** (three dots)
2. Click **View chunks**
3. ✅ A dialog opens showing the extracted text and table chunks
4. Test the filter buttons: **Prose**, **Table**, **Headers**

### 11.5 — Edit document metadata
1. Hover a document card → click **⋮** → **Edit metadata**
2. Change the **Ticker** to `AAPL` and **Fiscal period** to `FY2024`
3. Click **Save changes**
4. ✅ The card updates immediately with the new ticker

### 11.6 — Delete a document
1. Hover a document card → click **⋮** → **Delete**
2. Click **OK** in the confirm dialog
3. ✅ The card disappears and the document is removed from Qdrant and Postgres

### 11.7 — Document comparison
1. Upload **two** different PDFs (e.g. Apple 10-K FY2022 and Apple 10-K FY2023)
2. Wait for both to reach **Indexed**
3. Go to the **Compare** page (left sidebar)
4. Select Document A and Document B from the dropdowns
5. Click **Run Comparison**
6. ✅ After ~30–60 s you should see:
   - **Financial Metrics** tab with revenue / net income / EPS deltas
   - **Risk Factor Changes** tab showing added / removed risks
   - **Sentiment Analysis** tab with FinBERT scores
   - **AI Narrative** tab with a 3–6 sentence executive summary

### 11.8 — Alerts & ticker subscriptions
1. Go to the **Alerts** page
2. Click the **Subscriptions** tab → click **Add Ticker**
3. Enter ticker `MSFT`, click **Subscribe**
4. ✅ The subscription appears in the list
5. Click **Poll EDGAR** button → wait a few seconds
6. ✅ Any new filings appear as alerts in the **Alert Feed** tab
7. Click an alert → it marks as read (blue dot disappears)
8. Click **Mark all as read** → all alerts clear

### 11.9 — Analytics dashboard
1. Go to the **Analytics** page
2. ✅ The top stat cards show live data (total queries, avg confidence, tokens)
3. Charts show query volume and confidence trends

### 11.10 — Dashboard pipeline health
1. Go to the **Dashboard** page
2. Scroll down to the **RAG Pipeline** widget
3. ✅ All stages should show a green dot:
   - PostgreSQL — ok
   - S3 Ingestion — ok (local storage)
   - Embeddings — ok
   - Qdrant — ok
   - Groq LLM — ok (if GROQ_API_KEY is set)

---

## 12. Run the automated test suite

```bash
cd C:/Fin-Eye/backend
source .venv/Scripts/activate

pytest --cov=app --cov-config=.coveragerc --cov-report=term-missing -v
```

Expected output:
```
tests/test_health.py          PASSED
tests/test_chunker.py         PASSED (multiple)
tests/test_retriever.py       PASSED (multiple)
tests/test_anomaly.py         PASSED (multiple)
tests/test_comparisons.py     PASSED (multiple)
tests/test_query_pipeline.py  PASSED (multiple)
tests/test_alerts_api.py      PASSED (multiple)
tests/test_edgar.py           PASSED (multiple)

---------- coverage: 70%+ ----------
```

> Tests use an **in-memory SQLite database** and **mocked external services** (Qdrant, Groq, Clerk).
> They do NOT need the 4 servers running. You can run them in any terminal with `.venv` active.

Run a single test file:
```bash
pytest tests/test_chunker.py -v
```

Run a specific test:
```bash
pytest tests/test_anomaly.py::test_z_score_high_severity -v
```

---

## 13. Daily startup routine

Every time you want to work on the project:

**Step 1** — Open 4 Git Bash windows and run one command in each:

| Window | Command |
|--------|---------|
| 1 — Qdrant | `cd C:/qdrant && ./qdrant.exe` |
| 2 — Redis | `redis-server` |
| 3 — Backend | `cd C:/Fin-Eye/backend && source .venv/Scripts/activate && uvicorn app.main:app --reload --port 8000` |
| 4 — Frontend | `cd C:/Fin-Eye/frontend && npm run dev` |

**Step 2** — Open **http://localhost:3000** and start working.

**To stop everything:** press `Ctrl+C` in each window, then close them.

---

## 14. Troubleshooting

### `python: command not found`
Python was not added to PATH during install. Reinstall Python 3.11 and **make sure to tick "Add python.exe to PATH"** on the first installer screen.

### `psql: command not found`
```bash
echo 'export PATH="$PATH:/c/Program Files/PostgreSQL/16/bin"' >> ~/.bashrc
source ~/.bashrc
```

### `FATAL: password authentication failed for user "finsight"`
The database user was not created. Re-run step 3:
```bash
psql -U postgres -h localhost -c "CREATE USER finsight WITH PASSWORD 'finsight_dev';"
psql -U postgres -h localhost -c "CREATE DATABASE finsight OWNER finsight;"
```

### `alembic upgrade head` fails with `connection refused`
PostgreSQL is not running. It should auto-start on Windows after install.  
Check: **Start → Services → PostgreSQL 16** → right-click → Start.

### Backend starts but `http://localhost:8000/docs` shows nothing
Check Window 3 for error messages. Most common cause: missing `.env` file or wrong `CLERK_SECRET_KEY`.

### Frontend shows blank white page or Clerk error
Check `frontend/.env.local` — make sure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` starts with `pk_test_` and is the correct key from your Clerk dashboard.

### Upload stays on "uploading" forever / never reaches "indexed"
Check Window 3 (backend logs) for the real error. Common causes:
- `GROQ_API_KEY` not set (embedding still works, but generation will fail)
- `uploads/` folder doesn't exist → run `mkdir C:/Fin-Eye/backend/uploads`
- Qdrant not running → check Window 1

### Port already in use
```bash
# Find which process is using port 8000
netstat -ano | grep :8000
# Kill it (replace 1234 with the actual PID)
taskkill //PID 1234 //F
```
Same approach for port 3000, 6333 (Qdrant), 6379 (Redis), 5432 (Postgres).

### `No module named 'app'`
You forgot to activate the virtual environment:
```bash
source .venv/Scripts/activate
```

### Groq rate limit error during query
The free Groq tier allows 6,000 tokens/minute. Wait 60 seconds and try again.  
Or sign in to https://console.groq.com and check your usage.

### `react-pdf` shows "Could not load PDF" in the viewer
The PDF fetch goes through the backend API with a Bearer token. Make sure:
1. You are signed in (not just on the page — actually authenticated via Clerk)
2. The document status is **Indexed** (not processing)
3. The backend (Window 3) is still running

---

## Quick reference — all service URLs

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | http://localhost:3000 | The main app |
| Backend API | http://localhost:8000 | FastAPI |
| Swagger docs | http://localhost:8000/docs | Interactive API explorer |
| Health check | http://localhost:8000/api/v1/analytics/health | No auth required |
| Qdrant UI | http://localhost:6333/dashboard | Vector store explorer |
| Redis | localhost:6379 | No UI — use `redis-cli` |
| PostgreSQL | localhost:5432 | Use pgAdmin or DBeaver to browse |
