"""ARQ worker entry."""
from __future__ import annotations

import logging

from arq.connections import RedisSettings

from app.config import get_settings
from app.logging import configure_logging
from app.workflows.answer import find_answer_job
from app.workflows.category_discovery import discover_categories_job
from app.workflows.classify import classify_question_job
from app.workflows.compare_extraction import compare_extraction
from app.workflows.evaluate import evaluate_question_job
from app.workflows.evaluate_extraction import evaluate_extraction
from app.workflows.exam import compile_exam_pdf, render_exam, reset_exam_template
from app.workflows.extract_ai import ai_extract_material
from app.workflows.feedback import feedback_question_job
from app.workflows.generate import generate_questions
from app.workflows.harvest import harvest_questions_job
from app.workflows.ingest import ingest_material
from app.workflows.reproduction_compare import compare_reproduction_job
from app.workflows.similarity import similarity_question_job
from app.workflows.syllabus import build_syllabus
from app.workflows.validate import validate_exam_job


async def heartbeat(ctx: dict) -> str:
    return "ok"


async def startup(ctx: dict) -> None:
    configure_logging(get_settings().env)
    logging.info("aiea-worker started")


async def shutdown(ctx: dict) -> None:
    logging.info("aiea-worker stopping")


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    on_startup = startup
    on_shutdown = shutdown
    functions = [
        heartbeat,
        ingest_material,
        ai_extract_material,
        compare_extraction,
        evaluate_extraction,
        build_syllabus,
        generate_questions,
        find_answer_job,
        evaluate_question_job,
        harvest_questions_job,
        classify_question_job,
        feedback_question_job,
        similarity_question_job,
        discover_categories_job,
        render_exam,
        compile_exam_pdf,
        reset_exam_template,
        compare_reproduction_job,
        validate_exam_job,
    ]
    cron_jobs: list = []
    # Capped at 2: figure generation routes to a shim-backed CLI provider that
    # can't handle many concurrent heavy calls (they mutually time out). Two
    # in-flight keeps throughput up without overloading the shim.
    max_jobs = 2
    allow_abort_jobs = True
    # AI extraction of a multi-page document is one provider call per page —
    # legitimately long. ARQ's default 300s timeout kills it mid-run.
    job_timeout = 7200
    max_tries = 2
