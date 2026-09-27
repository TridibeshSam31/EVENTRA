"""Database Schema Migration Script for B-Gaps (B5-B11)

Safely and idempotently applies missing schema additions to PostgreSQL:
- tasks: verification_status, verified_at, verification_notes (B6)
- agent_runs table (B10)
- idempotency_records table (B11)
- audit_records composite pagination index (B8)
"""
import sys
import os

# Add apps/api to PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text
from app.db.session import engine


def run_migrations():
    print("Applying B-Gaps database schema additions to PostgreSQL...")
    with engine.begin() as conn:
        # 1. Tasks verification state columns (B6)
        print("Migrating tasks table...")
        conn.execute(
            text(
                """
                ALTER TABLE tasks 
                ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'PENDING' NOT NULL,
                ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP NULL,
                ADD COLUMN IF NOT EXISTS verification_notes TEXT NULL;
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_tasks_verification_status ON tasks(verification_status);
                """
            )
        )

        # 2. Agent runs table (B10)
        print("Migrating agent_runs table...")
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id VARCHAR(36) PRIMARY KEY,
                    run_id VARCHAR(64) NOT NULL UNIQUE,
                    event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                    user_id VARCHAR(36) NULL,
                    trigger_message TEXT NULL,
                    objective TEXT NULL,
                    status VARCHAR(50) NOT NULL DEFAULT 'INITIALIZED',
                    termination_status VARCHAR(50) NULL,
                    started_at TIMESTAMP NOT NULL,
                    completed_at TIMESTAMP NULL,
                    tool_history JSON NULL,
                    decision_trace JSON NULL,
                    final_response TEXT NULL,
                    error TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS ix_agent_runs_event_id ON agent_runs(event_id);
                CREATE INDEX IF NOT EXISTS ix_agent_runs_run_id ON agent_runs(run_id);
                CREATE INDEX IF NOT EXISTS ix_agent_runs_started_at ON agent_runs(started_at);
                CREATE INDEX IF NOT EXISTS ix_agent_runs_status ON agent_runs(status);
                """
            )
        )

        # 3. Idempotency records table (B11)
        print("Migrating idempotency_records table...")
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS idempotency_records (
                    idempotency_key VARCHAR(128) PRIMARY KEY,
                    event_id VARCHAR(36) NULL REFERENCES events(id) ON DELETE CASCADE,
                    endpoint VARCHAR(255) NOT NULL,
                    method VARCHAR(10) NOT NULL,
                    request_hash VARCHAR(64) NOT NULL,
                    response_code INTEGER NULL,
                    response_body JSON NULL,
                    status VARCHAR(30) NOT NULL DEFAULT 'PROCESSING',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMP NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_idempotency_records_event_id ON idempotency_records(event_id);
                CREATE INDEX IF NOT EXISTS ix_idempotency_records_endpoint ON idempotency_records(endpoint);
                CREATE INDEX IF NOT EXISTS ix_idempotency_records_status ON idempotency_records(status);
                CREATE INDEX IF NOT EXISTS ix_idempotency_records_expires_at ON idempotency_records(expires_at);
                """
            )
        )

        # 4. Audit Records composite pagination index (B8)
        print("Migrating audit_records pagination index...")
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_audit_records_event_created_id 
                ON audit_records (event_id, created_at DESC, id DESC);
                """
            )
        )

    print("B-Gaps database schema migrations successfully applied!")


if __name__ == "__main__":
    run_migrations()
