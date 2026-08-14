FROM ghcr.io/prefix-dev/pixi:latest

# System libs required by pdfplumber / pdf2image / pytesseract
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git \
        poppler-utils tesseract-ocr libgl1 \
        libreoffice-impress fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY backend/pixi.toml ./pixi.toml
COPY backend/pixi.lock* ./pixi.lock

RUN pixi install -e worker

ENV PATH="/workspace/.pixi/envs/worker/bin:${PATH}"
ENV PYTHONPATH="/workspace"

CMD ["pixi", "run", "-e", "worker", "worker"]
