from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.events import GenParams
from app.ai.factory import build_provider
from app.ai.providers.base import AbstractProvider
from app.db.models import Provider, TaskRoute, TaskRouteModel


@dataclass(frozen=True)
class TaskSpec:
    task: str
    group: str
    description: str


# The AI tasks AIEA routes. `default` is the fallback for any unrouted task.
AI_TASKS: list[TaskSpec] = [
    TaskSpec("default", "Default", "Fallback for any task with no route of its own"),

    TaskSpec("material-extraction", "Material", "Extract structured content (text, formulas, images, tables) from a source file"),
    TaskSpec("category-discovery", "Material", "Derive a list of categories (topic tags) per chapter from the syllabus + existing question evidence"),
    TaskSpec("material-classification", "Material", "Label extracted parts and flag meta / informative-only content to exclude from questions"),
    TaskSpec("extraction-validation", "Material", "Check a file was extracted correctly; decide if a redo with a better prompt or stronger model is needed"),
    TaskSpec("material-analysis", "Material", "Build a course-level topic map and learning objectives across all material"),

    TaskSpec("question-generation", "Generation", "Generate new exam questions from course material"),
    TaskSpec("question-harvesting", "Generation", "Extract the individual questions out of an extracted exam / exercise sheet"),
    TaskSpec("distractor-generation", "Generation", "Produce plausible wrong answers for MCQs"),
    TaskSpec("answer-generation", "Generation", "Produce the model answer / worked solution for a question"),
    TaskSpec("figure-refinement", "Generation", "Look at a rendered question figure and fix label collisions / misplaced labels in its schemdraw/matplotlib spec (vision)"),

    TaskSpec("answer-validation", "Evaluation", "Blind-solve a question from its text and figures alone, then compare against the answer key"),
    TaskSpec("syllabus-audit", "Evaluation", "Rule on whether an exam's terminology, methods and symbols are ones the course actually teaches (given corpus counts as evidence)"),
    TaskSpec("exam-examiner", "Evaluation", "Examiner review of a whole paper: difficulty, honest working time, mark allocation, redundant parts, coverage, equivalence"),
    TaskSpec("question-repair", "Evaluation", "Given one confirmed defect, produce the corrected question / key text"),
    TaskSpec("question-evaluation", "Evaluation", "Assess correctness, clarity, difficulty (1-5), Bloom's level and estimated solve time"),
    TaskSpec("rubric-generation", "Evaluation", "Produce a grading rubric for essay and problem questions"),
    TaskSpec("question-feedback", "Evaluation", "Short critique of one question: well-posed? answers agree? difficulty right? one concrete improvement"),
    TaskSpec("question-similarity", "Evaluation", "Compare a generated question to past (harvested) questions on the same topic; score deviation and pick the closest match"),
    TaskSpec("question-classification", "Material", "Tag a question with chapter_id, bloom, category, and difficulty (for harvested questions that arrive untagged)"),
    TaskSpec("exam-analysis", "Exam", "Analyse a whole exam: coverage, difficulty curve, gaps, suggested swaps"),
    TaskSpec("exam-reproduction-compare", "Exam", "Compare a reference exam PDF to its reproduced (rebuilt) PDF; rate how identical they are and note remaining differences"),

    TaskSpec("review-chat", "Interaction", "Interactive per-question refinement chat"),
    TaskSpec("general-chat", "Interaction", "Free-form chat — used by the console and chat panel"),

    TaskSpec("exam-assembly", "Exam", "Propose a balanced question set for an exam blueprint"),
    TaskSpec("exam-instructions", "Exam", "Write the exam preamble, instructions and cover text"),
    TaskSpec("translate", "Exam", "Translate a question (markdown, math intact) into a target language for bilingual exam render"),

    TaskSpec("orchestration", "Meta", "The orchestrator — monitors other AIs, evaluates their output, and decides prompt or model adjustments"),
]

TASK_SPECS: dict[str, TaskSpec] = {t.task: t for t in AI_TASKS}


@dataclass
class Resolution:
    provider: AbstractProvider
    provider_row: Provider
    model: str
    params: GenParams
    context_mode: str
    context_length: int | None
    system_prompt: str | None
    active_skills: list[str]


def primary_model(route: TaskRoute) -> TaskRouteModel | None:
    return next((m for m in route.models if m.role == "primary"), None)


async def _load_route(db: AsyncSession, task: str) -> TaskRoute | None:
    res = await db.execute(
        select(TaskRoute).options(selectinload(TaskRoute.models)).where(TaskRoute.task == task)
    )
    return res.scalar_one_or_none()


async def resolve(db: AsyncSession, task: str) -> Resolution | None:
    """Resolve a task to a live provider + model, falling back to the default route."""
    route = await _load_route(db, task)
    primary = primary_model(route) if route else None
    if primary is None and task != "default":
        route = await _load_route(db, "default")
        primary = primary_model(route) if route else None
    if route is None or primary is None:
        return None
    provider_row = await db.get(Provider, primary.provider_id)
    if provider_row is None:
        return None
    provider = build_provider(provider_row.name, provider_row.type, provider_row.config or {})
    return Resolution(
        provider=provider,
        provider_row=provider_row,
        model=primary.model,
        params=GenParams(temperature=route.temperature, max_tokens=route.max_tokens),
        context_mode=route.context_mode,
        context_length=route.context_length,
        system_prompt=route.system_prompt,
        active_skills=list(route.active_skills or []),
    )
