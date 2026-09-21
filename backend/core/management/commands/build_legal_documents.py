from __future__ import annotations

import html
import re
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)


DOCUMENTS = {
    "terms_of_service": {
        "source": "terms_of_service.md",
        "template": "terms_of_service.html",
        "pdf": "terms_of_service.pdf",
        "label": "Terms of Service",
        "public_path": "/legal/terms-of-service/",
        "description": "Read the terms that govern use of the MyHomeBro platform.",
    },
    "privacy_policy": {
        "source": "privacy_policy.md",
        "template": "privacy_policy.html",
        "pdf": "privacy_policy.pdf",
        "label": "Privacy Policy",
        "public_path": "/legal/privacy-policy/",
        "description": "Learn how MyHomeBro collects, uses, and protects personal data.",
    },
}


def _inline_html(value: str) -> str:
    escaped = html.escape(value, quote=False)
    escaped = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda match: (
            f'<a href="{html.escape(match.group(2), quote=True)}">{match.group(1)}</a>'
        ),
        escaped,
    )
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)


def _inline_pdf(value: str) -> str:
    escaped = html.escape(value, quote=False)
    escaped = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda match: (
            f'<link href="{html.escape(match.group(2), quote=True)}" color="#1957a6">'
            f"{match.group(1)}</link>"
        ),
        escaped,
    )
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    return escaped.replace("  \n", "<br/>")


def _parse_markdown(markdown: str):
    blocks = []
    paragraph = []

    def flush_paragraph():
        if paragraph:
            blocks.append(("paragraph", " ".join(part.strip() for part in paragraph)))
            paragraph.clear()

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            flush_paragraph()
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        bullet = re.match(r"^-\s+(.+)$", line)
        numbered = re.match(r"^\d+\.\s+(.+)$", line)
        if heading:
            flush_paragraph()
            blocks.append((f"h{len(heading.group(1))}", heading.group(2)))
        elif bullet:
            flush_paragraph()
            blocks.append(("bullet", bullet.group(1)))
        elif numbered:
            flush_paragraph()
            blocks.append(("number", numbered.group(1)))
        else:
            paragraph.append(line)
    flush_paragraph()
    return blocks


def _render_html(markdown: str, label: str, public_path: str, description: str) -> str:
    blocks = _parse_markdown(markdown)
    body = []
    list_type = None

    def close_list():
        nonlocal list_type
        if list_type:
            body.append(f"</{list_type}>")
            list_type = None

    for kind, value in blocks:
        if kind in {"bullet", "number"}:
            desired = "ul" if kind == "bullet" else "ol"
            if list_type != desired:
                close_list()
                body.append(f"<{desired}>")
                list_type = desired
            body.append(f"<li>{_inline_html(value)}</li>")
            continue
        close_list()
        if kind.startswith("h"):
            body.append(f"<{kind}>{_inline_html(value)}</{kind}>")
        else:
            body.append(f"<p>{_inline_html(value)}</p>")
    close_list()
    body_html = "\n".join(body)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(label)} | MyHomeBro</title>
  <meta name="description" content="{html.escape(description, quote=True)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://www.myhomebro.com{html.escape(public_path, quote=True)}">
  <meta property="og:title" content="{html.escape(label)} | MyHomeBro">
  <meta property="og:description" content="{html.escape(description, quote=True)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://www.myhomebro.com{html.escape(public_path, quote=True)}">
  <style>
    :root {{ color-scheme: light; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #f5f7fb; color: #14233b; font: 16px/1.65 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    main {{ width: min(920px, calc(100% - 32px)); margin: 32px auto; padding: clamp(24px, 5vw, 64px); background: #fff; border: 1px solid #dbe4f0; border-radius: 18px; box-shadow: 0 14px 40px rgba(13, 38, 76, .08); }}
    h1 {{ margin-top: 0; color: #071a37; font-size: clamp(2rem, 5vw, 3.25rem); line-height: 1.1; }}
    h2 {{ margin-top: 2.25rem; padding-top: .5rem; color: #0b2c57; font-size: 1.45rem; line-height: 1.3; border-top: 1px solid #e6edf6; }}
    h3 {{ margin-top: 1.5rem; color: #164f8f; font-size: 1.1rem; }}
    p, li {{ max-width: 78ch; }}
    li {{ margin: .45rem 0; }}
    a {{ color: #145fc4; }}
    strong {{ color: #071a37; }}
    footer {{ margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid #dbe4f0; color: #55657d; font-size: .9rem; }}
    @media (max-width: 600px) {{ main {{ width: 100%; margin: 0; border: 0; border-radius: 0; }} }}
  </style>
</head>
<body>
  <main>
{body_html}
    <footer>MyHomeBro LLC · San Antonio, Texas · info@myhomebro.com</footer>
  </main>
</body>
</html>
"""


def _register_fonts():
    candidates = [
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    bold_candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    regular = next((path for path in candidates if path.exists()), None)
    bold = next((path for path in bold_candidates if path.exists()), None)
    if regular and bold:
        pdfmetrics.registerFont(TTFont("LegalSans", str(regular)))
        pdfmetrics.registerFont(TTFont("LegalSans-Bold", str(bold)))
        return "LegalSans", "LegalSans-Bold"
    return "Helvetica", "Helvetica-Bold"


class NumberedLegalDocument(BaseDocTemplate):
    def __init__(self, filename, *, legal_title, **kwargs):
        super().__init__(filename, **kwargs)
        self.legal_title = legal_title
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="legal", frames=[frame], onPage=self._page_chrome))

    def _page_chrome(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d8e2ef"))
        canvas.setLineWidth(0.5)
        canvas.line(self.leftMargin, LETTER[1] - 0.55 * inch, LETTER[0] - self.rightMargin, LETTER[1] - 0.55 * inch)
        canvas.setFillColor(colors.HexColor("#334e70"))
        canvas.setFont("Helvetica", 8)
        canvas.drawString(self.leftMargin, LETTER[1] - 0.42 * inch, f"MyHomeBro · {self.legal_title}")
        canvas.drawRightString(LETTER[0] - self.rightMargin, 0.43 * inch, f"Page {doc.page}")
        canvas.restoreState()


def _render_pdf(markdown: str, output: Path, label: str):
    font, bold_font = _register_fonts()
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="LegalTitle", fontName=bold_font, fontSize=25, leading=30, textColor=colors.HexColor("#071a37"), alignment=TA_CENTER, spaceAfter=12))
    styles.add(ParagraphStyle(name="LegalSubtitle", fontName=font, fontSize=10, leading=14, textColor=colors.HexColor("#52677f"), alignment=TA_CENTER, spaceAfter=24))
    styles.add(ParagraphStyle(name="LegalH2", fontName=bold_font, fontSize=14, leading=18, textColor=colors.HexColor("#0b2c57"), spaceBefore=14, spaceAfter=7, keepWithNext=True))
    styles.add(ParagraphStyle(name="LegalH3", fontName=bold_font, fontSize=11, leading=15, textColor=colors.HexColor("#145493"), spaceBefore=10, spaceAfter=5, keepWithNext=True))
    styles.add(ParagraphStyle(name="LegalBody", fontName=font, fontSize=9.3, leading=13.5, textColor=colors.HexColor("#192b43"), alignment=TA_LEFT, spaceAfter=7))
    styles.add(ParagraphStyle(name="LegalList", parent=styles["LegalBody"], leftIndent=2, firstLineIndent=0, spaceAfter=2))

    blocks = _parse_markdown(markdown)
    story = []
    list_items = []
    list_kind = None

    def flush_list():
        nonlocal list_kind
        if list_items:
            story.append(ListFlowable(list_items[:], bulletType="bullet" if list_kind == "bullet" else "1", leftIndent=20, bulletFontName=font, bulletFontSize=8.5, spaceAfter=6))
            list_items.clear()
        list_kind = None

    title_seen = False
    for kind, value in blocks:
        if kind in {"bullet", "number"}:
            if list_kind and list_kind != kind:
                flush_list()
            list_kind = kind
            list_items.append(ListItem(Paragraph(_inline_pdf(value), styles["LegalList"]), leftIndent=8))
            continue
        flush_list()
        if kind == "h1":
            story.append(Spacer(1, 0.8 * inch))
            story.append(Paragraph(_inline_pdf(value), styles["LegalTitle"]))
            title_seen = True
        elif kind == "h2":
            if title_seen and len(story) <= 3:
                story.append(PageBreak())
            story.append(Paragraph(_inline_pdf(value), styles["LegalH2"]))
        elif kind in {"h3", "h4"}:
            story.append(Paragraph(_inline_pdf(value), styles["LegalH3"]))
        elif kind == "paragraph":
            style = styles["LegalSubtitle"] if title_seen and len(story) == 2 else styles["LegalBody"]
            story.append(Paragraph(_inline_pdf(value), style))
    flush_list()

    output.parent.mkdir(parents=True, exist_ok=True)
    doc = NumberedLegalDocument(
        str(output),
        legal_title=label,
        pagesize=LETTER,
        leftMargin=0.72 * inch,
        rightMargin=0.72 * inch,
        topMargin=0.72 * inch,
        bottomMargin=0.65 * inch,
        title=label,
        author="MyHomeBro LLC",
        subject=f"MyHomeBro {label}, effective September 15, 2026",
    )
    doc.build(story)


def _write_utf8_lf(path: Path, content: str):
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


class Command(BaseCommand):
    help = "Build canonical web, plain-text, and PDF legal documents from Markdown sources."

    def handle(self, *args, **options):
        backend_dir = Path(settings.BASE_DIR)
        source_dir = backend_dir / "legal_sources"
        template_dir = backend_dir / "templates" / "legal"
        static_dir = backend_dir / "static" / "legal"
        frontend_static_dir = backend_dir.parent / "frontend" / "public" / "static" / "legal"
        template_dir.mkdir(parents=True, exist_ok=True)
        static_dir.mkdir(parents=True, exist_ok=True)
        frontend_static_dir.mkdir(parents=True, exist_ok=True)

        for slug, config in DOCUMENTS.items():
            source = source_dir / config["source"]
            markdown = source.read_text(encoding="utf-8")
            _write_utf8_lf(
                template_dir / config["template"],
                _render_html(
                    markdown,
                    config["label"],
                    config["public_path"],
                    config["description"],
                ),
            )
            shutil.copyfile(source, frontend_static_dir / f"{slug}.md")
            shutil.copyfile(source, frontend_static_dir / f"{slug}.txt")
            pdf_output = static_dir / config["pdf"]
            _render_pdf(markdown, pdf_output, config["label"])
            # Keep old bookmarked filenames current while all product links use the
            # canonical underscore filenames above.
            shutil.copyfile(pdf_output, static_dir / f"Full {config['pdf']}")
            self.stdout.write(self.style.SUCCESS(f"Built {config['label']}"))
