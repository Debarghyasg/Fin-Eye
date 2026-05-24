"""
Alembic environment — runs migrations against the PostgreSQL database.

Uses the *synchronous* psycopg2 URL derived from Pydantic settings so that
Alembic can run in a normal (non-async) context via the CLI.

Usage:
    # Apply all pending migrations
    alembic upgrade head

    # Generate a new migration from model changes
    alembic revision --autogenerate -m "describe change"

    # Downgrade one step
    alembic downgrade -1
"""
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# ── Make sure the app package is importable from backend/ ─────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ── Import settings and all models so autogenerate can see the metadata ────────
from app.core.config import settings  # noqa: E402
from app.db.session import Base  # noqa: E402

# Import every model module so their tables are registered on Base.metadata
import app.db.models  # noqa: E402, F401

# ── Alembic Config object ─────────────────────────────────────────────────────
config = context.config

# Override the sqlalchemy.url from alembic.ini with the value from settings
config.set_main_option("sqlalchemy.url", settings.sync_database_url)

# Set up Python logging from the alembic.ini [loggers] section
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The metadata autogenerate compares against
target_metadata = Base.metadata


# ── Offline mode (generate SQL without connecting) ────────────────────────────
def run_migrations_offline() -> None:
    """Emit SQL to stdout without a live DB connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,          # detect column type changes
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online mode (run against a live DB connection) ────────────────────────────
def run_migrations_online() -> None:
    """Apply migrations using a real engine connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,     # single connection per migration run
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
