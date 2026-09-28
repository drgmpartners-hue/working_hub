"""기업 리포트: 투자기업·키워드·기사·데일리 브리핑·수신자·발송 로그·AI 검토 로그·백필 작업.

Revision ID: n1b2r3f4g5h6
Revises: d9e0f1a2b3c4
Create Date: 2026-09-28 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "n1b2r3f4g5h6"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def _ts(name: str, nullable: bool = False):
    return sa.Column(name, sa.DateTime(), server_default=sa.text("now()"), nullable=nullable)


def upgrade() -> None:
    # 한글 부분 일치 검색(통합 검색, P2)용. 권한이 없어도 배포가 멈추지 않도록 실패는 알림만 남긴다.
    op.execute(
        "DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm; "
        "EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_trgm 생성 건너뜀: %', SQLERRM; END $$;"
    )

    op.create_table(
        "portfolio_companies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_en", sa.String(200)),
        sa.Column("aliases", JSONB),
        sa.Column("is_listed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("stock_code", sa.String(12)),
        sa.Column("corp_code", sa.String(8)),
        sa.Column("biz_reg_no", sa.String(12)),
        sa.Column("ceo_name", sa.String(100)),
        sa.Column("industry", sa.String(200)),
        sa.Column("address", sa.String(300)),
        sa.Column("homepage", sa.String(300)),
        sa.Column("established_at", sa.Date()),
        sa.Column("profile_source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("search_query", sa.String(200)),
        sa.Column("invested_at", sa.Date()),
        sa.Column("invest_type", sa.String(50)),
        sa.Column("invest_amount", sa.BigInteger()),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("memo", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_collected_at", sa.DateTime()),
        _ts("created_at"),
        _ts("updated_at"),
    )
    op.create_index("ix_portfolio_companies_name", "portfolio_companies", ["name"])

    op.create_table(
        "company_keywords",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("keyword", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("source", sa.String(10), nullable=False, server_default="manual"),
        _ts("created_at"),
        sa.UniqueConstraint("company_id", "keyword", "kind", name="uq_company_keyword"),
    )
    op.create_index("ix_company_keywords_company_id", "company_keywords", ["company_id"])

    op.create_table(
        "news_articles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(10), nullable=False, server_default="news"),
        sa.Column("source", sa.String(20), nullable=False, server_default="naver"),
        sa.Column("collected_via", sa.String(10), nullable=False, server_default="daily"),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("url_hash", sa.String(64), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("press", sa.String(100)),
        sa.Column("published_at", sa.DateTime()),
        _ts("collected_at"),
        sa.Column("relevance_score", sa.Integer()),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("hidden_at", sa.DateTime()),
        sa.Column("hidden_by", sa.String(36)),
        sa.Column("dup_group_id", sa.String(36)),
        sa.Column("is_representative", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("summary", sa.Text()),
        sa.Column("tag", sa.String(10)),
        sa.Column("issue_type", sa.String(30)),
        sa.Column("summarized_at", sa.DateTime()),
        sa.UniqueConstraint("company_id", "url_hash", name="uq_news_article_url"),
    )
    op.create_index("ix_news_articles_company_published", "news_articles", ["company_id", "published_at"])
    op.create_index("ix_news_articles_dup_group_id", "news_articles", ["dup_group_id"])

    op.create_table(
        "news_briefings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("briefing_date", sa.Date(), nullable=False, unique=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="draft"),
        sa.Column("basic_info", JSONB),
        sa.Column("overall_summary", sa.Text()),
        sa.Column("company_summaries", JSONB),
        sa.Column("article_ids", JSONB),
        sa.Column("article_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("caution_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_fallback", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("review_summary", JSONB),
        sa.Column("approved_by", sa.String(36)),
        sa.Column("approved_at", sa.DateTime()),
        sa.Column("sent_at", sa.DateTime()),
        _ts("created_at"),
        _ts("updated_at"),
    )

    op.create_table(
        "briefing_recipients",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        _ts("created_at"),
    )

    op.create_table(
        "briefing_send_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("briefing_type", sa.String(10), nullable=False, server_default="daily"),
        sa.Column("briefing_id", sa.String(36)),
        sa.Column("user_id", sa.String(36)),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("channel", sa.String(10), nullable=False, server_default="alimtalk"),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("solapi_group_id", sa.String(100)),
        sa.Column("error", sa.Text()),
        _ts("sent_at"),
    )
    op.create_index("ix_briefing_send_logs_briefing_id", "briefing_send_logs", ["briefing_id"])

    op.create_table(
        "ai_review_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", sa.String(36)),
        sa.Column("stage", sa.String(10), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("input_hash", sa.String(64)),
        sa.Column("output", JSONB),
        sa.Column("verdict_summary", JSONB),
        sa.Column("tokens", JSONB),
        _ts("created_at"),
    )
    op.create_index("ix_ai_review_target", "ai_review_logs", ["target_type", "target_id"])

    op.create_table(
        "backfill_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_from", sa.Date(), nullable=False),
        sa.Column("period_to", sa.Date(), nullable=False),
        sa.Column("trigger", sa.String(20), nullable=False, server_default="register"),
        sa.Column("status", sa.String(12), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_stats", JSONB),
        sa.Column("coverage", JSONB),
        sa.Column("key_events", JSONB),
        sa.Column("sample_review", JSONB),
        sa.Column("estimated_recall", sa.Float()),
        sa.Column("verdict", sa.String(15)),
        sa.Column("report_file_id", sa.String(36)),
        sa.Column("error", sa.Text()),
        sa.Column("created_by", sa.String(36)),
        _ts("created_at"),
        sa.Column("finished_at", sa.DateTime()),
    )
    op.create_index("ix_backfill_jobs_company_id", "backfill_jobs", ["company_id"])


def downgrade() -> None:
    for t in (
        "backfill_jobs", "ai_review_logs", "briefing_send_logs", "briefing_recipients",
        "news_briefings", "news_articles", "company_keywords", "portfolio_companies",
    ):
        op.drop_table(t)
