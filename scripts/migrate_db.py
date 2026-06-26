"""
scripts/migrate_db.py
=====================
Idempotent database migration script for CAD_Estimate.

Usage:
    python scripts/migrate_db.py [--db-url sqlite:///construction_orders.db]

Supported databases:
    - SQLite (default, recommended for development/local)
    - PostgreSQL (ensure psycopg2 is installed and DB_URL is set)

Migrations applied (all idempotent):
    1. cad_tasks.structured_analysis TEXT column (if missing)
    2. quotation_item_audits table (if missing)
    3. quotation_items.confidence REAL column (if missing)
    4. quotation_items.source_evidence TEXT column (if missing)
    5. quotation_items.bounding_box TEXT column (if missing)
    6. quotation_items.original_text TEXT column (if missing)
    7. quotation_items.needs_manual_review INTEGER column (if missing)
    8. quotation_items.width_inferred/height_inferred/depth_inferred columns (if missing)

Migration execution policy:
    Auto-migration is intentionally NOT run on app startup.
    For production, run this script manually or in a CI/CD pipeline before
    starting the API server.
"""

import os
import sys
import logging
import argparse
from sqlalchemy import text

# Allow running as a script from the project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

logger = logging.getLogger(__name__)


def _get_sqlite_columns(conn, table_name: str):
    """Returns a set of column names for a SQLite table."""
    result = conn.execute(text(f"PRAGMA table_info({table_name})"))
    rows = result.fetchall()
    return {row[1] for row in rows}


def _table_exists_sqlite(conn, table_name: str) -> bool:
    """Check if a table exists in SQLite."""
    result = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:tname"),
        {"tname": table_name}
    )
    return result.fetchone() is not None


def _get_postgres_columns(conn, table_name: str):
    """Returns a set of column names for a PostgreSQL table."""
    result = conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = %s
        """,
        (table_name,)
    )
    return {row[0] for row in result.fetchall()}


def _table_exists_postgres(conn, table_name: str) -> bool:
    """Check if a table exists in PostgreSQL."""
    result = conn.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_name = %s
        """,
        (table_name,)
    )
    return result.fetchone() is not None


def ensure_schema(db_url: str = None, dry_run: bool = False) -> dict:
    """
    Applies all pending schema migrations idempotently.

    Args:
        db_url: SQLAlchemy database URL. Defaults to reading DATABASE_URL env var,
                then falls back to 'sqlite:///construction_orders.db'.
        dry_run: If True, executes the migration logic but rolls back at the end.

    Returns:
        dict with keys:
            - applied: list of applied migration descriptions
            - skipped: list of skipped (already existed) migration descriptions
            - errors: list of error descriptions (if any)
    """
    from sqlalchemy import create_engine, text

    if db_url is None:
        db_url = os.getenv("DATABASE_URL", "sqlite:///construction_orders.db")

    logger.info("Running schema migration against: %s (dry_run=%s)", db_url, dry_run)

    is_sqlite = db_url.startswith("sqlite")
    is_postgres = "postgresql" in db_url or "postgres" in db_url

    if not is_sqlite and not is_postgres:
        msg = (
            f"Unsupported database type in URL: '{db_url}'. "
            "Only SQLite and PostgreSQL are supported. "
            "Please run migrations manually using ALTER TABLE statements."
        )
        logger.error(msg)
        return {"applied": [], "skipped": [], "errors": [msg]}

    engine = create_engine(db_url)
    applied = []
    skipped = []
    errors = []

    try:
        with engine.connect() as conn:
            # We start a transaction block explicitly if possible, or let the connection handle it.
            # In SQLAlchemy 2.0 connection is usually auto-committed unless we use conn.begin() or commit/rollback.
            transaction = conn.begin()
            try:
                if is_sqlite:
                    _run_sqlite_migrations(conn, applied, skipped, errors)
                elif is_postgres:
                    _run_postgres_migrations(conn, applied, skipped, errors)

                if dry_run:
                    transaction.rollback()
                    logger.info("Dry-run mode: Transaction rolled back successfully.")
                else:
                    transaction.commit()
                    logger.info("Transaction committed successfully.")
            except Exception as e:
                transaction.rollback()
                raise e
    except Exception as e:
        err_msg = f"Migration failed with unexpected error: {e}"
        logger.exception(err_msg)
        errors.append(err_msg)
    finally:
        engine.dispose()

    # Summary
    logger.info("Migration complete. Applied: %d, Skipped: %d, Errors: %d",
                len(applied), len(skipped), len(errors))
    for m in applied:
        logger.info("  [APPLIED]  %s", m)
    for m in skipped:
        logger.info("  [SKIPPED]  %s", m)
    for e in errors:
        logger.error("  [ERROR]    %s", e)

    return {"applied": applied, "skipped": skipped, "errors": errors}


def _run_sqlite_migrations(conn, applied: list, skipped: list, errors: list):
    """Run all SQLite-specific migration steps."""

    # ── 1. cad_tasks.structured_analysis ────────────────────────────────────
    if _table_exists_sqlite(conn, "cad_tasks"):
        cols = _get_sqlite_columns(conn, "cad_tasks")
        if "structured_analysis" not in cols:
            try:
                conn.execute(text(
                    "ALTER TABLE cad_tasks ADD COLUMN structured_analysis TEXT"
                ))
                applied.append("cad_tasks.structured_analysis TEXT column added")
            except Exception as e:
                errors.append(f"Failed to add cad_tasks.structured_analysis: {e}")
        else:
            skipped.append("cad_tasks.structured_analysis already exists")
    else:
        skipped.append("cad_tasks table does not exist yet (will be created by ORM)")

    # ── 2. quotation_item_audits table ──────────────────────────────────────
    if not _table_exists_sqlite(conn, "quotation_item_audits"):
        try:
            conn.execute(text("""
                CREATE TABLE quotation_item_audits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
                    quotation_item_id INTEGER
                        REFERENCES quotation_items(id) ON DELETE SET NULL,
                    field_name TEXT NOT NULL,
                    old_value TEXT,
                    new_value TEXT,
                    source TEXT DEFAULT 'user_edit',
                    created_at DATETIME
                )
            """))
            applied.append("quotation_item_audits table created")
        except Exception as e:
            errors.append(f"Failed to create quotation_item_audits: {e}")
    else:
        # Check if quotation_id column is missing and add it
        cols = _get_sqlite_columns(conn, "quotation_item_audits")
        if "quotation_id" not in cols:
            try:
                conn.execute(text("ALTER TABLE quotation_item_audits ADD COLUMN quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE"))
                applied.append("quotation_item_audits.quotation_id column added")
            except Exception as e:
                errors.append(f"Failed to add quotation_id to quotation_item_audits: {e}")
        else:
            skipped.append("quotation_item_audits already exists with quotation_id")

    # ── 3-7. quotation_items extra AI pipeline columns ──────────────────────
    if _table_exists_sqlite(conn, "quotation_items"):
        cols = _get_sqlite_columns(conn, "quotation_items")

        extra_columns = [
            ("confidence", "REAL DEFAULT 1.0"),
            ("source_evidence", "TEXT"),
            ("bounding_box", "TEXT"),
            ("original_text", "TEXT"),
            ("needs_manual_review", "INTEGER DEFAULT 0"),
            ("width_inferred", "INTEGER DEFAULT 0"),
            ("height_inferred", "INTEGER DEFAULT 0"),
            ("depth_inferred", "INTEGER DEFAULT 0"),
            ("price_source", "VARCHAR"),
            ("price_confidence", "FLOAT"),
            ("pricing_remarks", "TEXT"),
        ]

        for col_name, col_def in extra_columns:
            if col_name not in cols:
                try:
                    conn.execute(text(
                        f"ALTER TABLE quotation_items ADD COLUMN {col_name} {col_def}"
                    ))
                    applied.append(f"quotation_items.{col_name} column added")
                except Exception as e:
                    errors.append(f"Failed to add quotation_items.{col_name}: {e}")
            else:
                skipped.append(f"quotation_items.{col_name} already exists")
    else:
        skipped.append("quotation_items table does not exist yet (will be created by ORM)")

    # ── Extra pricing columns for quotations table ──────────────────────────
    if _table_exists_sqlite(conn, "quotations"):
        cols = _get_sqlite_columns(conn, "quotations")
        extra_columns_q = [
            ("surcharge_rate", "FLOAT DEFAULT 0.30"),
            ("vat_rate", "FLOAT DEFAULT 0.10"),
            ("contingency_amount", "INTEGER DEFAULT 0"),
            ("installation_fee", "INTEGER DEFAULT 0"),
            ("transportation_fee", "INTEGER DEFAULT 0"),
        ]
        for col_name, col_def in extra_columns_q:
            if col_name not in cols:
                try:
                    conn.execute(text(
                        f"ALTER TABLE quotations ADD COLUMN {col_name} {col_def}"
                    ))
                    applied.append(f"quotations.{col_name} column added")
                except Exception as e:
                    errors.append(f"Failed to add quotations.{col_name}: {e}")
            else:
                skipped.append(f"quotations.{col_name} already exists")

    # ── Extra columns for cabinet_boms table ────────────────────────────────
    if _table_exists_sqlite(conn, "cabinet_boms"):
        cols = _get_sqlite_columns(conn, "cabinet_boms")
        extra_columns_bom = [
            ("width_source", "VARCHAR DEFAULT 'drawing_text'"),
            ("height_source", "VARCHAR DEFAULT 'drawing_text'"),
            ("depth_source", "VARCHAR DEFAULT 'drawing_text'"),
        ]
        for col_name, col_def in extra_columns_bom:
            if col_name not in cols:
                try:
                    conn.execute(text(
                        f"ALTER TABLE cabinet_boms ADD COLUMN {col_name} {col_def}"
                    ))
                    applied.append(f"cabinet_boms.{col_name} column added")
                except Exception as e:
                    errors.append(f"Failed to add cabinet_boms.{col_name}: {e}")
            else:
                skipped.append(f"cabinet_boms.{col_name} already exists")


def _run_postgres_migrations(conn, applied: list, skipped: list, errors: list):
    """Run all PostgreSQL-specific migration steps."""
    from sqlalchemy import text

    # ── 1. cad_tasks.structured_analysis ────────────────────────────────────
    result = conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='cad_tasks' AND column_name='structured_analysis'
    """))
    if not result.fetchone():
        try:
            conn.execute(text(
                "ALTER TABLE cad_tasks ADD COLUMN structured_analysis TEXT"
            ))
            applied.append("cad_tasks.structured_analysis TEXT column added")
        except Exception as e:
            errors.append(f"Failed to add cad_tasks.structured_analysis: {e}")
    else:
        skipped.append("cad_tasks.structured_analysis already exists")

    # ── 2. quotation_item_audits table ──────────────────────────────────────
    result = conn.execute(text("""
        SELECT 1 FROM information_schema.tables WHERE table_name='quotation_item_audits'
    """))
    if not result.fetchone():
        try:
            conn.execute(text("""
                CREATE TABLE quotation_item_audits (
                    id SERIAL PRIMARY KEY,
                    quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
                    quotation_item_id INTEGER
                        REFERENCES quotation_items(id) ON DELETE SET NULL,
                    field_name TEXT NOT NULL,
                    old_value TEXT,
                    new_value TEXT,
                    source TEXT DEFAULT 'user_edit',
                    created_at TIMESTAMP
                )
            """))
            applied.append("quotation_item_audits table created")
        except Exception as e:
            errors.append(f"Failed to create quotation_item_audits: {e}")
    else:
        # Check if quotation_id exists
        result_col = conn.execute(text("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name='quotation_item_audits' AND column_name='quotation_id'
        """))
        if not result_col.fetchone():
            try:
                conn.execute(text("ALTER TABLE quotation_item_audits ADD COLUMN quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE"))
                applied.append("quotation_item_audits.quotation_id column added")
            except Exception as e:
                errors.append(f"Failed to add quotation_id to postgres quotation_item_audits: {e}")
        else:
            skipped.append("quotation_item_audits already exists with quotation_id")

    # ── 3-7. quotation_items extra columns ──────────────────────────────────
    extra_columns = [
        ("confidence", "REAL DEFAULT 1.0"),
        ("source_evidence", "TEXT"),
        ("bounding_box", "TEXT"),
        ("original_text", "TEXT"),
        ("needs_manual_review", "INTEGER DEFAULT 0"),
        ("width_inferred", "BOOLEAN DEFAULT FALSE"),
        ("height_inferred", "BOOLEAN DEFAULT FALSE"),
        ("depth_inferred", "BOOLEAN DEFAULT FALSE"),
        ("price_source", "VARCHAR"),
        ("price_confidence", "FLOAT"),
        ("pricing_remarks", "TEXT"),
    ]

    for col_name, col_def in extra_columns:
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name='quotation_items' AND column_name=:col
        """), {"col": col_name})
        if not result.fetchone():
            try:
                conn.execute(text(
                    f"ALTER TABLE quotation_items ADD COLUMN {col_name} {col_def}"
                ))
                applied.append(f"quotation_items.{col_name} column added")
            except Exception as e:
                errors.append(f"Failed to add quotation_items.{col_name}: {e}")
        else:
            skipped.append(f"quotation_items.{col_name} already exists")

    # ── Extra pricing columns for quotations table ──────────────────────────
    result_q = conn.execute(text("""
        SELECT 1 FROM information_schema.tables WHERE table_name='quotations'
    """))
    if result_q.fetchone():
        extra_columns_q = [
            ("surcharge_rate", "FLOAT DEFAULT 0.30"),
            ("vat_rate", "FLOAT DEFAULT 0.10"),
            ("contingency_amount", "INTEGER DEFAULT 0"),
            ("installation_fee", "INTEGER DEFAULT 0"),
            ("transportation_fee", "INTEGER DEFAULT 0"),
        ]
        for col_name, col_def in extra_columns_q:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name='quotations' AND column_name=:col
            """), {"col": col_name})
            if not result.fetchone():
                try:
                    conn.execute(text(
                        f"ALTER TABLE quotations ADD COLUMN {col_name} {col_def}"
                    ))
                    applied.append(f"quotations.{col_name} column added")
                except Exception as e:
                    errors.append(f"Failed to add postgres quotations.{col_name}: {e}")
            else:
                skipped.append(f"quotations.{col_name} already exists")

    # ── Extra columns for cabinet_boms table ────────────────────────────────
    result_b = conn.execute(text("""
        SELECT 1 FROM information_schema.tables WHERE table_name='cabinet_boms'
    """))
    if result_b.fetchone():
        extra_columns_bom = [
            ("width_source", "VARCHAR DEFAULT 'drawing_text'"),
            ("height_source", "VARCHAR DEFAULT 'drawing_text'"),
            ("depth_source", "VARCHAR DEFAULT 'drawing_text'"),
        ]
        for col_name, col_def in extra_columns_bom:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name='cabinet_boms' AND column_name=:col
            """), {"col": col_name})
            if not result.fetchone():
                try:
                    conn.execute(text(
                        f"ALTER TABLE cabinet_boms ADD COLUMN {col_name} {col_def}"
                    ))
                    applied.append(f"cabinet_boms.{col_name} column added")
                except Exception as e:
                    errors.append(f"Failed to add postgres cabinet_boms.{col_name}: {e}")
            else:
                skipped.append(f"cabinet_boms.{col_name} already exists")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Idempotent schema migration for CAD_Estimate database."
    )
    parser.add_argument(
        "--db-url",
        "--database",
        dest="db_url",
        default=None,
        help=(
            "SQLAlchemy database URL (default: DATABASE_URL env var, "
            "or sqlite:///construction_orders.db)"
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate migration without committing changes."
    )
    args = parser.parse_args()

    result = ensure_schema(db_url=args.db_url, dry_run=args.dry_run)

    if result["errors"]:
        logger.error("Migration finished with errors!")
        sys.exit(1)
    else:
        logger.info("Migration finished successfully.")
        sys.exit(0)
