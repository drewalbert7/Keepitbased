"""SQLite + SQLAlchemy persistence for swarm runs & autoresearch experiments."""

from __future__ import annotations

from datetime import datetime
from typing import Generator

from sqlalchemy import DateTime, Float, Integer, JSON, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker, Session

from config import settings


class Base(DeclarativeBase):
    pass


class SwarmForecastRow(Base):
    __tablename__ = "swarm_forecasts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    horizon_days_min: Mapped[int] = mapped_column(Integer, default=5)
    horizon_days_max: Mapped[int] = mapped_column(Integer, default=9)
    rebound_probability: Mapped[float] = mapped_column(Float)
    expected_rebound_pct: Mapped[float] = mapped_column(Float)
    ci_low_pct: Mapped[float] = mapped_column(Float)
    ci_high_pct: Mapped[float] = mapped_column(Float)
    swarm_agents_used: Mapped[int] = mapped_column(Integer)
    reflexivity_score: Mapped[float] = mapped_column(Float)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExperimentRow(Base):
    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    branch: Mapped[str] = mapped_column(String(256))
    commit_sha: Mapped[str] = mapped_column(String(48))
    baseline_sharpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_sharpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_winrate: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidate_winrate: Mapped[float | None] = mapped_column(Float, nullable=True)
    improved: Mapped[int] = mapped_column(Integer, default=0)  # 0/1
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    metrics_dump: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


engine = create_engine(
    f"sqlite:///{settings.sqlite_path}",
    echo=False,
    future=True,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_session() -> Generator[Session, None, None]:
    sess = SessionLocal()
    try:
        yield sess
        sess.commit()
    except Exception:
        sess.rollback()
        raise
    finally:
        sess.close()


def session_scope() -> Session:
    return SessionLocal()
