"""Add agent_run_events (durable agent progress log); ensure agent_runs exists

Revision ID: f999a1b2c3d4
Revises: e888f55566a7
Create Date: 2026-10-13 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f999a1b2c3d4'
down_revision: Union[str, None] = 'e888f55566a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    # agent_runs was never created by an earlier revision (some environments
    # created it out-of-band), so only create it when it is missing.
    if 'agent_runs' not in existing_tables:
        op.create_table(
            'agent_runs',
            sa.Column('id', sa.String(length=36), primary_key=True),
            sa.Column('run_id', sa.String(length=64), nullable=False),
            sa.Column('event_id', sa.String(length=36), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.String(length=36), nullable=True),
            sa.Column('trigger_message', sa.Text(), nullable=True),
            sa.Column('objective', sa.Text(), nullable=True),
            sa.Column('status', sa.String(length=50), nullable=False, server_default='INITIALIZED'),
            sa.Column('termination_status', sa.String(length=50), nullable=True),
            sa.Column('started_at', sa.DateTime(), nullable=False),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
            sa.Column('tool_history', sa.JSON(), nullable=True),
            sa.Column('decision_trace', sa.JSON(), nullable=True),
            sa.Column('final_response', sa.Text(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_agent_runs_run_id', 'agent_runs', ['run_id'], unique=True)
        op.create_index('ix_agent_runs_event_id', 'agent_runs', ['event_id'])
        op.create_index('ix_agent_runs_user_id', 'agent_runs', ['user_id'])
        op.create_index('ix_agent_runs_status', 'agent_runs', ['status'])
        op.create_index('ix_agent_runs_started_at', 'agent_runs', ['started_at'])

    op.create_table(
        'agent_run_events',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('run_id', sa.String(length=64), sa.ForeignKey('agent_runs.run_id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_id', sa.String(length=36), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('type', sa.String(length=64), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('run_id', 'sequence', name='uq_agent_run_events_run_sequence'),
    )
    op.create_index('ix_agent_run_events_run_id', 'agent_run_events', ['run_id'])
    op.create_index('ix_agent_run_events_event_id', 'agent_run_events', ['event_id'])
    op.create_index('ix_agent_run_events_type', 'agent_run_events', ['type'])


def downgrade() -> None:
    # agent_runs is intentionally left in place: it may predate this revision.
    op.drop_index('ix_agent_run_events_type', table_name='agent_run_events')
    op.drop_index('ix_agent_run_events_event_id', table_name='agent_run_events')
    op.drop_index('ix_agent_run_events_run_id', table_name='agent_run_events')
    op.drop_table('agent_run_events')
