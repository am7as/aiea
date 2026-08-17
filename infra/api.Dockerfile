FROM ghcr.io/prefix-dev/pixi:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY backend/pixi.toml ./pixi.toml
COPY backend/pixi.lock* ./pixi.lock

RUN pixi install -e default

ENV PATH="/workspace/.pixi/envs/default/bin:${PATH}"
ENV PYTHONPATH="/workspace"

EXPOSE 8000
CMD ["pixi", "run", "dev"]
