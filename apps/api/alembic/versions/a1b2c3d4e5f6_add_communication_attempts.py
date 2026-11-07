"""Add communication_attempts (durable per-channel vendor outreach records)

Revision ID: a1b2c3d4e5f6
Revises: f999a1b2c3d4
Create Date: 2026-10-14 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f999a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'communication_attempts',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('event_id', sa.String(length=36), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
        sa.Column(
            'shortlist_entry_id',
            sa.String(length=36),
            sa.ForeignKey('event_shortlist_entries.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('vendor_id', sa.String(length=36), sa.ForeignKey('vendors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('approval_id', sa.String(length=36), nullable=True),
        sa.Column('channel', sa.String(length=20), nullable=False),
        sa.Column('provider', sa.String(length=30), nullable=True),
        sa.Column('contact_name', sa.String(length=255), nullable=True),
        sa.Column('destination', sa.String(length=20), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='NOT_ATTEMPTED'),
        sa.Column('provider_ref', sa.String(length=255), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('details', sa.JSON(), nullable=False),
        sa.Column('requested_by', sa.String(length=100), nullable=True),
        sa.Column('last_attempt_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('shortlist_entry_id', 'channel', name='uq_communication_attempt_entry_channel'),
    )
    op.create_index('ix_communication_attempts_event_id', 'communication_attempts', ['event_id'])
    op.create_index('ix_communication_attempts_shortlist_entry_id', 'communication_attempts', ['shortlist_entry_id'])
    op.create_index('ix_communication_attempts_vendor_id', 'communication_attempts', ['vendor_id'])
    op.create_index('ix_communication_attempts_status', 'communication_attempts', ['status'])
    op.create_index('ix_communication_attempts_provider_ref', 'communication_attempts', ['provider_ref'])


def downgrade() -> None:
    op.drop_index('ix_communication_attempts_provider_ref', table_name='communication_attempts')
    op.drop_index('ix_communication_attempts_status', table_name='communication_attempts')
    op.drop_index('ix_communication_attempts_vendor_id', table_name='communication_attempts')
    op.drop_index('ix_communication_attempts_shortlist_entry_id', table_name='communication_attempts')
    op.drop_index('ix_communication_attempts_event_id', table_name='communication_attempts')
    op.drop_table('communication_attempts')
