from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = Field("development", alias="AIEA_ENV")
    debug: bool = True

    database_url: str = "postgresql+asyncpg://aiea:aiea@postgres:5432/aiea"
    redis_url: str = "redis://redis:6379/0"

    vault_path: Path = Path("/vault")
    creds_path: Path = Path("/creds")
    models_path: Path = Path("/models")

    lmstudio_url: str = "http://host.docker.internal:1234"

    cors_origins: list[str] = [
        "http://localhost:4020",
        "http://localhost:4022",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
