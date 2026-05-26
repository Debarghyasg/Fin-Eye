FROM python:3.11-slim

# System deps for PyMuPDF + pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libmupdf-dev \
    libfreetype6-dev \
    libjpeg-dev \
    libopenjp2-7-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Robust pip — long timeout and many retries for flaky home networks
ENV PIP_DEFAULT_TIMEOUT=600 \
    PIP_RETRIES=10 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN pip install --upgrade pip

# Install torch CPU-only first — ~190 MB vs ~750 MB for the default CUDA wheel.
# requirements.txt still pins torch==2.3.1 below; pip sees it's already
# installed and skips re-downloading it.
RUN pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        torch==2.3.1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy model used by Presidio PII analyzer (~12 MB, en_core_web_sm).
# Presidio falls back gracefully if the model is missing, but installing it
# at build time is cheap and avoids a network call on first request.
RUN python -m spacy download en_core_web_sm

COPY . .

# Non-root user for security
RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
