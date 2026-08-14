FROM ghcr.io/prefix-dev/pixi:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY frontend/pixi.toml ./pixi.toml
COPY frontend/pixi.lock* ./pixi.lock

RUN pixi install

ENV PATH="/workspace/.pixi/envs/default/bin:${PATH}"

EXPOSE 3000
CMD ["pixi", "run", "dev"]
