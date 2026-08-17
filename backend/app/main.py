from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    ai,
    courses,
    demo,
    docs,
    exams,
    fs,
    health,
    inventory,
    materials,
    memory,
    monitor,
    questions,
    syllabus,
    tasks,
)
from app.config import get_settings
from app.logging import configure_logging

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.env)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="AIEA API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|host\.docker\.internal|0\.0\.0\.0|\d+\.\d+\.\d+\.\d+)(:\d+)?",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    prefix = "/api/v1"
    app.include_router(health.router, prefix=prefix)
    app.include_router(courses.router, prefix=prefix)
    app.include_router(syllabus.router, prefix=prefix)
    app.include_router(materials.router, prefix=prefix)
    app.include_router(questions.router, prefix=prefix)
    app.include_router(exams.router, prefix=prefix)
    app.include_router(fs.router, prefix=prefix)
    app.include_router(docs.router, prefix=prefix)
    app.include_router(ai.router, prefix=prefix)
    app.include_router(memory.router, prefix=prefix)
    app.include_router(tasks.router, prefix=prefix)
    app.include_router(monitor.router, prefix=prefix)
    app.include_router(inventory.router, prefix=prefix)
    app.include_router(demo.router, prefix=prefix)
    return app


app = create_app()
