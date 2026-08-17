from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/deep")
async def health_deep(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
