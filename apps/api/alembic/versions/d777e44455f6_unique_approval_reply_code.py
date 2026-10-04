"""Make ix_approvals_reply_code unique

Revision ID: d777e44455f6
Revises: c011e22233d4
Create Date: 2026-10-05 01:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd777e44455f6'
down_revision: Union[str, None] = 'c011e22233d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('approvals') as batch_op:
        batch_op.drop_index('ix_approvals_reply_code')
        batch_op.create_index('ix_approvals_reply_code', ['reply_code'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('approvals') as batch_op:
        batch_op.drop_index('ix_approvals_reply_code')
        batch_op.create_index('ix_approvals_reply_code', ['reply_code'], unique=False)
