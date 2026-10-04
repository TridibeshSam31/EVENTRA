"""Remote approval notifications and phone mapping

Revision ID: c011e22233d4
Revises: bb07211120c7
Create Date: 2026-10-04 20:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c011e22233d4'
down_revision: Union[str, None] = 'bb07211120c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add phone_e164 to users table
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('phone_e164', sa.String(length=30), nullable=True))
        batch_op.create_index(op.f('ix_users_phone_e164'), ['phone_e164'], unique=False)

    # 2. Add reply_code to approvals table
    with op.batch_alter_table('approvals') as batch_op:
        batch_op.add_column(sa.Column('reply_code', sa.String(length=10), nullable=True))
        batch_op.create_index(op.f('ix_approvals_reply_code'), ['reply_code'], unique=False)

    # 3. Create push_subscriptions table
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('endpoint', sa.Text(), nullable=False),
        sa.Column('p256dh', sa.String(length=255), nullable=False),
        sa.Column('auth', sa.String(length=255), nullable=False),
        sa.Column('user_agent', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('endpoint', name='uq_push_subscriptions_endpoint'),
    )
    op.create_index(op.f('ix_push_subscriptions_user_id'), 'push_subscriptions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_push_subscriptions_user_id'), table_name='push_subscriptions')
    op.drop_table('push_subscriptions')

    with op.batch_alter_table('approvals') as batch_op:
        batch_op.drop_index(op.f('ix_approvals_reply_code'))
        batch_op.drop_column('reply_code')

    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_index(op.f('ix_users_phone_e164'))
        batch_op.drop_column('phone_e164')
