"""기업 리포트 P2: 사실 원장·투자유치·기간 요약·기업DB 파일·다운로드 기록·공공데이터·검색 색인.

Revision ID: o2c3r4p5t6u7
Revises: n1b2r3f4g5h6
Create Date: 2026-09-28 15:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "o2c3r4p5t6u7"
down_revision = "n1b2r3f4g5h6"
branch_labels = None
depends_on = None

TRGM_INDEXES = [
    ("ix_search_index_title_trgm", "search_index", "title"),
    ("ix_search_index_body_trgm", "search_index", "body"),
    ("ix_search_index_norm_trgm", "search_index", "norm"),
    ("ix_company_files_name_trgm", "company_files", "display_name"),
]


def upgrade() -> None:
    op.add_column("news_articles", sa.Column("facts_extracted_at", sa.DateTime(), nullable=True))
    op.create_table('company_file_downloads',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('file_id', sa.String(length=36), nullable=True),
    sa.Column('company_id', sa.String(length=36), nullable=True),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_company_file_downloads_file_id'), 'company_file_downloads', ['file_id'], unique=False)
    op.create_table('search_index',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('entity_type', sa.String(length=20), nullable=False),
    sa.Column('entity_id', sa.String(length=64), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('norm', sa.Text(), nullable=True),
    sa.Column('doc_date', sa.Date(), nullable=True),
    sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('url_path', sa.String(length=300), nullable=True),
    sa.Column('is_latest', sa.Boolean(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('entity_type', 'entity_id', name='uq_search_entity')
    )
    op.create_index('ix_search_company_date', 'search_index', ['company_id', 'doc_date'], unique=False)
    op.create_table('company_facts',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('fact_type', sa.String(length=20), nullable=False),
    sa.Column('fact_date', sa.Date(), nullable=True),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('detail', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('source_refs', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('origin', sa.String(length=10), nullable=False),
    sa.Column('dedup_key', sa.String(length=64), nullable=True),
    sa.Column('confirmed_by', sa.String(length=36), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.Column('supersedes_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['portfolio_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_company_facts_company_date', 'company_facts', ['company_id', 'fact_date'], unique=False)
    op.create_index(op.f('ix_company_facts_company_id'), 'company_facts', ['company_id'], unique=False)
    op.create_index(op.f('ix_company_facts_dedup_key'), 'company_facts', ['dedup_key'], unique=False)
    op.create_table('company_files',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=True),
    sa.Column('folder', sa.String(length=12), nullable=False),
    sa.Column('display_name', sa.String(length=300), nullable=False),
    sa.Column('original_name', sa.String(length=300), nullable=True),
    sa.Column('storage_key', sa.String(length=300), nullable=False),
    sa.Column('file_type', sa.String(length=10), nullable=False),
    sa.Column('mime', sa.String(length=100), nullable=True),
    sa.Column('size', sa.BigInteger(), nullable=False),
    sa.Column('period_label', sa.String(length=20), nullable=True),
    sa.Column('doc_kind', sa.String(length=40), nullable=True),
    sa.Column('origin', sa.String(length=10), nullable=False),
    sa.Column('auto_key', sa.String(length=120), nullable=True),
    sa.Column('related_type', sa.String(length=20), nullable=True),
    sa.Column('related_id', sa.String(length=36), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('memo', sa.Text(), nullable=True),
    sa.Column('search_text', sa.Text(), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['portfolio_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_company_files_auto_key'), 'company_files', ['auto_key'], unique=False)
    op.create_index('ix_company_files_company_folder', 'company_files', ['company_id', 'folder'], unique=False)
    op.create_index(op.f('ix_company_files_company_id'), 'company_files', ['company_id'], unique=False)
    op.create_table('company_funding_rounds',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('round_date', sa.Date(), nullable=True),
    sa.Column('round_name', sa.String(length=50), nullable=True),
    sa.Column('amount', sa.BigInteger(), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('amount_disclosed', sa.Boolean(), nullable=False),
    sa.Column('investors', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('valuation', sa.BigInteger(), nullable=True),
    sa.Column('is_follow_on', sa.Boolean(), nullable=False),
    sa.Column('source_refs', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('origin', sa.String(length=10), nullable=False),
    sa.Column('fact_id', sa.String(length=36), nullable=True),
    sa.Column('confirmed_by', sa.String(length=36), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['portfolio_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_company_funding_rounds_company_id'), 'company_funding_rounds', ['company_id'], unique=False)
    op.create_table('company_period_summaries',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('date_from', sa.Date(), nullable=False),
    sa.Column('date_to', sa.Date(), nullable=False),
    sa.Column('article_hash', sa.String(length=64), nullable=False),
    sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('model', sa.String(length=80), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['portfolio_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_company_period_summaries_company_id'), 'company_period_summaries', ['company_id'], unique=False)
    op.create_index('ix_period_summary_lookup', 'company_period_summaries', ['company_id', 'date_from', 'date_to'], unique=False)
    op.create_table('company_public_data',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('company_id', sa.String(length=36), nullable=False),
    sa.Column('source', sa.String(length=10), nullable=False),
    sa.Column('as_of', sa.Date(), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['portfolio_companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'source', 'as_of', name='uq_public_data_snapshot')
    )
    op.create_index(op.f('ix_company_public_data_company_id'), 'company_public_data', ['company_id'], unique=False)


    # pg_trgm이 있을 때만 GIN 인덱스(없으면 ILIKE 순차 검색으로 동작)
    for name, table, col in TRGM_INDEXES:
        op.execute(
            "DO $$ BEGIN "
            "IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN "
            f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({col} gin_trgm_ops); "
            "END IF; END $$;"
        )


def downgrade() -> None:
    for name, _, _ in TRGM_INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
    for t in ["search_index", "company_public_data", "company_file_downloads", "company_files",
              "company_period_summaries", "company_funding_rounds", "company_facts"]:
        op.drop_table(t)
    op.drop_column("news_articles", "facts_extracted_at")
