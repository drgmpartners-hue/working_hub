"""PDF report generation service using ReportLab.

Generates a simple commission report PDF for a single CommissionResult row.
The generated file is saved under the ``reports/`` directory relative to the
process working directory (same convention as the ``uploads/`` directory used
by the upload service).

Usage
-----
    from app.services.pdf_service import generate_commission_pdf

    file_path = generate_commission_pdf(result_row)
    # file_path is an absolute-style relative path, e.g. "reports/abc123.pdf"
"""
from __future__ import annotations

import os
from typing import Any

REPORT_DIR = "reports"


def _ensure_report_dir() -> str:
    """Create the reports directory if it does not exist and return its path."""
    os.makedirs(REPORT_DIR, exist_ok=True)
    return REPORT_DIR


def generate_commission_pdf(result: Any) -> str:
    """Generate a PDF commission report for *result* and return the file path.

    Parameters
    ----------
    result:
        A ``CommissionResult`` ORM object (or any object with the attributes
        ``id``, ``employee_name``, ``detail_data``, ``calculation_id``).

    Returns
    -------
    str
        Relative file path of the generated PDF, e.g. ``"reports/<id>.pdf"``.

    Raises
    ------
    ImportError
        If ``reportlab`` is not installed.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "reportlab is required for PDF generation. "
            "Install it with: pip install reportlab"
        ) from exc

    report_dir = _ensure_report_dir()
    file_path = os.path.join(report_dir, f"{result.id}.pdf")

    # ------------------------------------------------------------------
    # Build document
    # ------------------------------------------------------------------
    doc = SimpleDocTemplate(
        file_path,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    # Title
    title_style = styles["Title"]
    story.append(Paragraph("Commission Report", title_style))
    story.append(Spacer(1, 0.5 * cm))

    # Employee name
    story.append(
        Paragraph(
            f"<b>Employee:</b> {result.employee_name}",
            styles["Normal"],
        )
    )
    story.append(
        Paragraph(
            f"<b>Calculation ID:</b> {result.calculation_id}",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 0.5 * cm))

    # Detail data table
    detail: dict[str, Any] = result.detail_data or {}
    if detail:
        story.append(Paragraph("<b>Details</b>", styles["Heading2"]))
        story.append(Spacer(1, 0.2 * cm))

        table_data = [["Field", "Value"]]
        for key, value in detail.items():
            table_data.append([str(key), str(value)])

        table = Table(
            table_data,
            colWidths=[8 * cm, 8 * cm],
            repeatRows=1,
        )
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A5F")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, 0), 10),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7FA")]),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(table)

    doc.build(story)
    return file_path
