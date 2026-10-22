"""
Chaya database layer (SQLAlchemy 2).

Production: PostgreSQL on Railway (DATABASE_URL is injected by the Railway Postgres service).
Local:      SQLite file `chaya.db` in the repo root when DATABASE_URL is not set.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, func,
                        select)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

ROOT = Path(__file__).resolve().parents[2]


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return f"sqlite:///{ROOT / 'chaya.db'}"
    # Railway / Heroku style URLs -> SQLAlchemy psycopg3 driver
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


engine = create_engine(database_url(), pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def backend_name() -> str:
    return "PostgreSQL" if engine.dialect.name.startswith("postgres") else "SQLite"


class Base(DeclarativeBase):
    pass


class Meta(Base):
    __tablename__ = "meta"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class Patient(Base):
    __tablename__ = "patients"
    pid: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    age: Mapped[int] = mapped_column(Integer)
    sex: Mapped[str] = mapped_column(String(1))
    city: Mapped[str] = mapped_column(String(64))
    condition: Mapped[str] = mapped_column(String(32))
    hba1c: Mapped[float] = mapped_column(Float)
    tir: Mapped[float] = mapped_column(Float)
    tar: Mapped[float] = mapped_column(Float)
    alerts: Mapped[int] = mapped_column(Integer)
    ehr: Mapped[dict] = mapped_column(JSON)
    kpi: Mapped[dict] = mapped_column(JSON)


class Reading(Base):
    """5-minute wearable sample for the replay week (k = 0..2015)."""
    __tablename__ = "readings"
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), primary_key=True)
    k: Mapped[int] = mapped_column(Integer, primary_key=True)
    cgm: Mapped[float | None] = mapped_column(Float, nullable=True)
    steps: Mapped[int] = mapped_column(Integer)
    hr: Mapped[int] = mapped_column(Integer)
    sleep: Mapped[int] = mapped_column(Integer)


class Meal(Base):
    __tablename__ = "meals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), index=True)
    k: Mapped[int] = mapped_column(Integer)
    meal: Mapped[str] = mapped_column(String(80))
    carbs: Mapped[int] = mapped_column(Integer)
    gi: Mapped[int] = mapped_column(Integer)
    slot: Mapped[str] = mapped_column(String(16))


class Medication(Base):
    __tablename__ = "medications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), index=True)
    k: Mapped[int] = mapped_column(Integer)
    drug: Mapped[str] = mapped_column(String(64))


class Night(Base):
    __tablename__ = "nights"
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), primary_key=True)
    day: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[str] = mapped_column(String(10))
    sleep_hours: Mapped[float] = mapped_column(Float)
    deep_pct: Mapped[float] = mapped_column(Float)
    bedtime: Mapped[float] = mapped_column(Float)
    hrv_rmssd: Mapped[float] = mapped_column(Float)
    post_dinner_walk: Mapped[bool] = mapped_column(Boolean)


class Prediction(Base):
    __tablename__ = "predictions"
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), primary_key=True)
    k: Mapped[int] = mapped_column(Integer, primary_key=True)
    prob: Mapped[float] = mapped_column(Float)
    p2h: Mapped[float | None] = mapped_column(Float, nullable=True)
    alert: Mapped[bool] = mapped_column(Boolean)
    episode_start: Mapped[bool] = mapped_column(Boolean)
    reasons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    state: Mapped[list] = mapped_column(JSON)       # twin state [G, X, I, Q1, Q2, E] at this time
    su: Mapped[float] = mapped_column(Float)


class Twin(Base):
    __tablename__ = "twins"
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), primary_key=True)
    params: Mapped[list] = mapped_column(JSON)
    prior: Mapped[list] = mapped_column(JSON)
    fit_rmse: Mapped[float] = mapped_column(Float)
    pct: Mapped[dict] = mapped_column(JSON)
    si_mult: Mapped[list] = mapped_column(JSON)
    gb_shift: Mapped[list] = mapped_column(JSON)
    habit_carbs: Mapped[list] = mapped_column(JSON)
    habit_gi: Mapped[list] = mapped_column(JSON)
    habit_rate: Mapped[list] = mapped_column(JSON)
    steps_prof: Mapped[list] = mapped_column(JSON)
    inferred: Mapped[dict] = mapped_column(JSON)


class CaseNote(Base):
    """Advice a clinician wrote on the Rx pad, with the twin's projection at the time."""
    __tablename__ = "case_notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    at_k: Mapped[int] = mapped_column(Integer)
    advice: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[str] = mapped_column(Text)
    projected_peak: Mapped[float] = mapped_column(Float)
    projected_minutes_above: Mapped[int] = mapped_column(Integer)
    baseline_peak: Mapped[float] = mapped_column(Float)
    author: Mapped[str] = mapped_column(String(64), default="Demo clinician")


class AlertReview(Base):
    __tablename__ = "alert_reviews"
    pid: Mapped[str] = mapped_column(ForeignKey("patients.pid"), primary_key=True)
    k: Mapped[int] = mapped_column(Integer, primary_key=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                  default=lambda: datetime.now(timezone.utc))
    reviewer: Mapped[str] = mapped_column(String(64), default="Demo clinician")


def init_db() -> None:
    Base.metadata.create_all(engine)


def is_seeded(s: Session) -> bool:
    return s.scalar(select(func.count()).select_from(Patient)) > 0
