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
