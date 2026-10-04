"""Add negotiation_control, control_changed_by, and control_changed_at to vendor_assignments

Revision ID: e888f55566a7
Revises: d777e44455f6
Create Date: 2026-10-05 01:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e888f55566a7'
down_revision: Union[str, None] = 'd777e44455f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('vendor_assignments') as batch_op:
        batch_op.add_column(
            sa.Column('negotiation_control', sa.String(length=20), server_default='AGENT', nullable=False)
        )
        batch_op.add_column(
            sa.Column('control_changed_by', sa.String(length=36), nullable=True)
        )
        batch_op.add_column(
            sa.Column('control_changed_at', sa.DateTime(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table('vendor_assignments') as batch_op:
        batch_op.drop_column('control_changed_at')
        batch_op.drop_column('control_changed_by')
        batch_op.drop_column('negotiation_control')
