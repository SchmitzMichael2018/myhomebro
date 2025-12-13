from __future__ import annotations

import io
import os
from typing import List, Optional, Iterable
from datetime import date, datetime

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.timezone import localtime

from projects.models import Agreement, Milestone

try:
  from PyPDF2 import PdfMerger
except Exception:
  PdfMerger = None

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
  SimpleDocTemplate,
  Paragraph,
  Spacer,
  Table as RLTable,
  TableStyle as RLTableStyle,
  Image as RLImage,
  PageBreak,
)
from reportlab.pdfgen import canvas
from reportlab.graphics.shapes import Drawing, Line
from reportlab.lib.utils import ImageReader


def _s(val):
  if val is None:
    return ""
  try:
    return str(val)
  except Exception:
    return ""


def _get_any(obj, keys: Iterable[str], default: str = "") -> str:
  for k in keys:
    try:
      v = getattr(obj, k, None)
      if v is not None and str(v).strip() != "":
        return str(v)
    except Exception:
      continue
  return default


def _money(val) -> str:
  try:
    if val is None:
      return "$0.00"
    return f"${float(val):,.2f}"
  except Exception:
    return "$0.00"


def _fmt_date(val) -> str:
  if not val:
    return ""
  if isinstance(val, (datetime,)):
    try:
      return localtime(val).strftime("%b %d, %Y")
    except Exception:
      return str(val)
  if isinstance(val, (date,)):
    try:
      return val.strftime("%b %d, %Y")
    except Exception:
      return str(val)
  return str(val)


def _safe_logo_path() -> Optional[str]:
  try:
    p = os.path.join(settings.BASE_DIR, "static", "myhomebro_logo.png")
    if os.path.exists(p):
      return p
  except Exception:
    pass
  try:
    p = os.path.join(settings.BASE_DIR, "static", "myhomebro_logo.png")
    if os.path.exists(p):
      return p
  except Exception:
    pass
  return None


def _sig_logo_path(ag: Agreement) -> Optional[str]:
  """
  Try contractor logo, else fallback to MyHomeBro logo.
  """
  # Contractor uploaded logo (optional)
  try:
    contractor = getattr(ag, "contractor", None)
    if contractor is not None:
      logo_field = getattr(contractor, "logo", None)
      if logo_field and getattr(logo_field, "path", None) and os.path.exists(logo_field.path):
        return logo_field.path
  except Exception:
    pass
  return _safe_logo_path()


def _signature_path(file_field) -> Optional[str]:
  try:
    p = getattr(file_field, "path", None)
    if p and os.path.exists(p):
      return p
  except Exception:
    pass
  return None


def _scaled_image(path: Optional[str], max_w: float, max_h: float) -> Optional[RLImage]:
  if not path:
    return None
  try:
    img = RLImage(path)
    iw, ih = img.imageWidth, img.imageHeight
    if iw <= 0 or ih <= 0:
      return None
    scale = min(max_w / iw, max_h / ih)
    img.drawWidth = iw * scale
    img.drawHeight = ih * scale
    return img
  except Exception:
    return None


def _wrap_lines(text: str, max_chars: int = 110, preserve_blank: bool = True) -> List[str]:
  """
  Basic wrapping utility to avoid long lines. Bullet-aware-ish:
  - Keeps leading "-", "*", "•", "1.", "a." on the same line chunk.
  """
  if not text:
    return [""] if preserve_blank else []

  lines_in = text.splitlines()
  out: List[str] = []
  for raw in lines_in:
    line = raw.rstrip()
    if line.strip() == "":
      if preserve_blank:
        out.append("")
      continue

    prefix = ""
    body = line.strip()

    # Detect simple bullet/number prefixes
    for b in ("• ", "- ", "* "):
      if body.startswith(b):
        prefix = b
        body = body[len(b):].strip()
        break

    if not prefix:
      import re
      m = re.match(r"^([0-9]+\.)\s+(.*)$", body)
      if m:
        prefix = m.group(1) + " "
        body = m.group(2).strip()
      else:
        m = re.match(r"^([a-zA-Z]\.)\s+(.*)$", body)
        if m:
          prefix = m.group(1) + " "
          body = m.group(2).strip()

    words = body.split()
    cur = prefix
    for w in words:
      test = (cur + w).strip() if cur.endswith(" ") or cur == "" else (cur + " " + w)
      if len(test) > max_chars and cur.strip():
        out.append(cur.rstrip())
        cur = (prefix + w + " ").strip() + " "
      else:
        if cur == prefix or cur == "":
          cur = prefix + w + " "
        else:
          cur = cur + w + " "
    if cur.strip():
      out.append(cur.rstrip())
  return out


def build_agreement_pdf_bytes(agreement: Agreement, is_preview: bool = True) -> bytes:
  """
  Build a single PDF (base agreement, no attachments merged) and return its bytes.

  NOTE: We now show signature images in preview if they exist.
  """
  ag = agreement

  styles = getSampleStyleSheet()

  s_title = ParagraphStyle(
    "s_title",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=22,
    leading=26,
    textColor=colors.HexColor("#111827"),
    alignment=TA_LEFT,
    spaceAfter=12,
  )

  s_h2 = ParagraphStyle(
    "s_h2",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=14,
    leading=18,
    textColor=colors.HexColor("#111827"),
    alignment=TA_LEFT,
    spaceBefore=10,
    spaceAfter=6,
  )

  s_body = ParagraphStyle(
    "s_body",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=10.5,
    leading=13,
    textColor=colors.HexColor("#111827"),
    alignment=TA_LEFT,
  )

  s_small = ParagraphStyle(
    "s_small",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9.2,
    leading=12,
    textColor=colors.HexColor("#4B5563"),
    alignment=TA_LEFT,
  )

  s_center_small = ParagraphStyle(
    "s_center_small",
    parent=s_small,
    alignment=TA_CENTER,
  )

  def _para(text: str, style=s_body):
    return Paragraph(text.replace("\n", "<br/>"), style)

  logo_path = _sig_logo_path(ag)

  contractor = getattr(ag, "contractor", None)
  homeowner = getattr(ag, "homeowner", None)
  project = getattr(ag, "project", None)

  contractor_name = _get_any(
    contractor,
    ["business_name", "full_name", "name"],
    default="Contractor",
  )
  contractor_email = _get_any(contractor, ["email"], default="")
  contractor_phone = _get_any(contractor, ["phone_number", "phone"], default="")

  homeowner_name = (
    _get_any(ag, ["homeowner_name"], default="")
    or _get_any(homeowner, ["full_name", "name"], default="Homeowner")
  )
  homeowner_email = (
    _get_any(ag, ["homeowner_email"], default="")
    or _get_any(homeowner, ["email"], default="")
  )

  project_title = (
    _get_any(ag, ["project_title", "title"], default="")
    or _get_any(project, ["title"], default=f"Agreement #{ag.id}")
  )

  # Address fields
  contractor_addr = _get_any(contractor, ["address_line1", "address", "street_address"], default="")
  homeowner_addr_snapshot = _get_any(ag, ["homeowner_address_snapshot", "homeowner_address_text"], default="")
  project_addr_snapshot = _get_any(ag, ["project_address_snapshot", "project_address_text"], default="")

  project_type = _get_any(ag, ["project_type"], default="")
  project_subtype = _get_any(ag, ["project_subtype"], default="")
  schedule_start = _fmt_date(getattr(ag, "start", None))
  schedule_end = _fmt_date(getattr(ag, "end", None))

  # Milestones
  try:
    milestones = list(Milestone.objects.filter(agreement=ag).order_by("order"))
  except Exception:
    milestones = []

  total_cost = getattr(ag, "total_cost", None)
  if total_cost is None:
    try:
      total_cost = sum([float(m.amount or 0) for m in milestones])
    except Exception:
      total_cost = 0

  # Watermark logic
  preview_label = "PREVIEW — NOT SIGNED" if is_preview else ""
  # Determine if agreement appears fully signed (both flags true)
  fully_signed = False
  try:
    if hasattr(ag, "is_fully_signed") and getattr(ag, "is_fully_signed", False):
      fully_signed = True
  except Exception:
    pass
  try:
    if getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False):
      fully_signed = True
  except Exception:
    pass

  story: List = []

  # Header (logo + title)
  if logo_path:
    img = _scaled_image(logo_path, max_w=120, max_h=120)
    if img:
      img.hAlign = "CENTER"
      story.append(img)
      story.append(Spacer(1, 10))

  story.append(Paragraph(f"Agreement #{ag.id}", s_title))

  # Project summary
  summary_lines = [
    f"<b>Project</b>",
    f"<b>Contractor:</b> {_s(contractor_name)}"
    + (f" • {_s(contractor_email)}" if contractor_email else "")
    + (f" • {_s(contractor_phone)}" if contractor_phone else ""),
    f"<b>Contractor Address:</b> {_s(contractor_addr) or '—'}",
    f"<b>Homeowner:</b> {_s(homeowner_name)}"
    + (f" • {_s(homeowner_email)}" if homeowner_email else ""),
    f"<b>Homeowner Address:</b> {_s(homeowner_addr_snapshot) or '—'}",
    f"<b>Project Address:</b> {_s(project_addr_snapshot) or '—'}",
  ]

  if project_type or project_subtype:
    if project_subtype:
      summary_lines.append(f"<b>Type:</b> {_s(project_type)} — {_s(project_subtype)}")
    else:
      summary_lines.append(f"<b>Type:</b> {_s(project_type)}")

  if schedule_start or schedule_end:
    if schedule_start and schedule_end:
      summary_lines.append(f"<b>Schedule:</b> {schedule_start} → {schedule_end} (est.)")
    elif schedule_start:
      summary_lines.append(f"<b>Schedule:</b> {schedule_start}")
    else:
      summary_lines.append(f"<b>Schedule:</b> {schedule_end}")

  status_str = _get_any(ag, ["status"], default="draft")
  summary_lines.append(f"<b>Status:</b> {_s(status_str)}")

  story.append(_para("<br/>".join(summary_lines), s_body))
  story.append(Spacer(1, 10))

  # Divider
  story.append(Spacer(1, 6))
  story.append(Drawing(500, 1, Line(0, 0, 500, 0)))
  story.append(Spacer(1, 10))

  # Milestones table
  story.append(Paragraph("Milestones", s_h2))

  table_data = [["#", "Milestone", "Due", "Amount", "Status"]]
  for i, m in enumerate(milestones, start=1):
    due = _fmt_date(getattr(m, "due_date", None) or getattr(m, "completion_date", None))
    amt = _money(getattr(m, "amount", None))
    stat = _get_any(m, ["status_display", "status"], default="Pending")
    table_data.append([str(i), _s(getattr(m, "title", "") or ""), due, amt, stat])

  table_data.append(["", "", "", "<b>Total</b>", f"<b>{_money(total_cost)}</b>"])

  tbl = RLTable(table_data, colWidths=[0.5 * inch, 3.0 * inch, 1.2 * inch, 1.0 * inch, 1.0 * inch])
  tbl.setStyle(
    RLTableStyle(
      [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F9FAFB")),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
        ("FONT", (0, 1), (-1, -2), "Helvetica", 9.5),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 1), (2, -1), "CENTER"),
        ("ALIGN", (3, 1), (3, -1), "RIGHT"),
        ("ALIGN", (4, 1), (4, -1), "CENTER"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F9FAFB")),
        ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 10),
      ]
    )
  )
  story.append(tbl)
  story.append(Spacer(1, 14))

  # Warranty section
  story.append(Paragraph("Warranty", s_h2))
  warranty_text = _get_any(ag, ["warranty_text_snapshot", "warranty_text"], default="")
  if not warranty_text:
    warranty_text = (
      "Default workmanship warranty applies. Contractor warrants that all work will be performed in a good and "
      "workmanlike manner and in accordance with applicable codes. Defects arising from normal wear, misuse, "
      "negligence, alteration, or acts of God are excluded."
    )
  story.append(_para(warranty_text, s_body))
  story.append(Spacer(1, 16))

  # Metadata block (amendment history)
  story.append(Paragraph("Document Metadata & Amendment History", s_h2))

  amend_num = getattr(ag, "amendment_number", None) or 0
  pdf_version = getattr(ag, "pdf_version", None) or ""
  created_at = getattr(ag, "created_at", None)
  updated_at = getattr(ag, "updated_at", None)

  meta_rows = [
    ["Agreement ID", _s(ag.id)],
    ["Amendment Number", _s(amend_num)],
    ["PDF Version", _s(pdf_version)],
    ["Original Created", _s(localtime(created_at).strftime("%Y-%m-%d %H:%M")) if created_at else "—"],
    ["Last Amended", "—"],
    ["Generated At", _s(localtime(updated_at).strftime("%Y-%m-%d %H:%M")) if updated_at else "—"],
  ]
  meta_tbl = RLTable(meta_rows, colWidths=[2.0 * inch, 5.0 * inch])
  meta_tbl.setStyle(
    RLTableStyle(
      [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F9FAFB")),
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9.5),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
      ]
    )
  )
  story.append(meta_tbl)
  story.append(Spacer(1, 12))

  story.append(Paragraph("Signatures", s_h2))

  def _fmt_dt_sig(val) -> str:
    if not val:
      return ""
    try:
      return localtime(val).strftime("%Y-%m-%d %H:%M")
    except Exception:
      return str(val)

  def _sig_block(name: str, img_path: Optional[str], signed_at, ip, label: str) -> list:
    block: list = []
    simg = _scaled_image(img_path, max_w=200, max_h=80) if img_path else None
    if simg:
      block.append(simg)
      block.append(Spacer(1, 4))

    signed_str = _fmt_dt_sig(signed_at)
    block += [
      Paragraph(f"<b>{label}:</b> {_s(name) or '—'}", s_body),
      Paragraph(f"<b>Signed:</b> {signed_str or '—'}", s_small),
      Paragraph(f"<b>IP:</b> {_s(ip) or '—'}", s_small),
    ]
    return block

  # Identify who has actually signed (legacy + new flags)
  c_signed = bool(getattr(ag, "signed_by_contractor", False) or getattr(ag, "contractor_signed", False))
  h_signed = bool(getattr(ag, "signed_by_homeowner", False) or getattr(ag, "homeowner_signed", False))

  c_name_sig = _s(getattr(ag, "contractor_signature_name", None))
  h_name_sig = _s(getattr(ag, "homeowner_signature_name", None))

  c_at_raw = getattr(ag, "signed_at_contractor", None) or getattr(
    ag, "contractor_signed_at", None
  )
  h_at_raw = getattr(ag, "signed_at_homeowner", None) or getattr(
    ag, "homeowner_signed_at", None
  )

  c_ip = getattr(ag, "contractor_signed_ip", None) or ""
  h_ip = getattr(ag, "homeowner_signed_ip", None) or ""

  # ✅ Show signature images whenever they exist.
  # For PREVIEW PDFs we show whatever signatures are currently on file (e.g. contractor may have signed, homeowner not yet).
  # For FINAL fully-signed PDFs we show both parties' signature images (if present).
  c_img = _signature_path(getattr(ag, "contractor_signature", None)) if c_signed else None
  h_img = _signature_path(getattr(ag, "homeowner_signature", None)) if h_signed else None

  sig_tbl = RLTable(
    [[
      _sig_block(c_name_sig, c_img, c_at_raw, c_ip, "Contractor"),
      _sig_block(h_name_sig, h_img, h_at_raw, h_ip, "Homeowner"),
    ]],
    colWidths=[3.5 * inch, 3.5 * inch],
  )
  sig_tbl.setStyle(RLTableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
  story.append(sig_tbl)

  if is_preview:
    story.append(Spacer(1, 6))
    story.append(
      Paragraph(
        "This is a preview. Final version will include any updated signatures.",
        s_small,
      )
    )

  def _on_page(c: canvas.Canvas, doc):
    # Footer: generated timestamp & page number
    c.saveState()
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#9CA3AF"))
    gen = localtime(getattr(ag, "updated_at", None)) if getattr(ag, "updated_at", None) else None
    gen_str = gen.strftime("%Y-%m-%d %H:%M") if gen else ""
    c.drawRightString(letter[0] - 0.75 * inch, 0.5 * inch, f"Generated {gen_str}  |  Page {doc.page}")
    c.restoreState()

    # Watermark for preview
    if is_preview and preview_label:
      c.saveState()
      c.setFont("Helvetica-Bold", 56)
      c.setFillColor(colors.Color(0.8, 0.8, 0.8, alpha=0.25))
      c.translate(letter[0] / 2, letter[1] / 2)
      c.rotate(30)
      c.drawCentredString(0, 0, preview_label)
      c.restoreState()

  buf = io.BytesIO()
  doc = SimpleDocTemplate(
    buf,
    pagesize=letter,
    leftMargin=0.75 * inch,
    rightMargin=0.75 * inch,
    topMargin=0.75 * inch,
    bottomMargin=0.75 * inch,
  )
  doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)

  return buf.getvalue()


def generate_full_agreement_pdf(agreement: Agreement) -> str:
  """
  Generate and save the final PDF to agreement.pdf_file (or equivalent FileField),
  bump pdf_version, and return the relative path to the generated PDF file.

  Also merges attachments if PdfMerger is available and agreement has attachments.

  NOTE: The base PDF is built with is_preview=False.
  """
  ag = agreement
  tmp_dir = getattr(settings, "PDF_TMP_DIR", None) or getattr(settings, "MEDIA_ROOT", None) or "/tmp"
  os.makedirs(tmp_dir, exist_ok=True)

  version = int(getattr(ag, "pdf_version", 0) or 0) + 1

  base_bytes = build_agreement_pdf_bytes(ag, is_preview=False)

  base_path = os.path.join(tmp_dir, f"agreement_{ag.id}_v{version}.pdf")
  with open(base_path, "wb") as f:
    f.write(base_bytes)

  final_path = base_path

  merge_attachments = True
  if merge_attachments and PdfMerger:
    try:
      atts = list(ag.attachments.all())
    except Exception:
      atts = []
    pdf_paths: List[str] = []
    for att in atts:
      p = getattr(att.file, "path", None)
      if p and os.path.exists(p) and p.lower().endswith(".pdf"):
        pdf_paths.append(p)

    if pdf_paths:
      merged_path = os.path.join(tmp_dir, f"agreement_{ag.id}_v{version}_merged.pdf")
      merger = PdfMerger()
      merger.append(base_path)
      for p in pdf_paths:
        try:
          merger.append(p)
        except Exception:
          continue
      with open(merged_path, "wb") as out_f:
        merger.write(out_f)
      merger.close()
      final_path = merged_path

  # Save to FileField if available
  rel_name = os.path.basename(final_path)
  try:
    with open(final_path, "rb") as f:
      content = ContentFile(f.read(), name=rel_name)
      if hasattr(ag, "pdf_file") and ag.pdf_file is not None:
        ag.pdf_file.save(rel_name, content, save=False)
      else:
        setattr(ag, "pdf_file", content)
  except Exception:
    # If saving fails, return path anyway
    pass

  if hasattr(ag, "pdf_version"):
    ag.pdf_version = version

  try:
    ag.save()
  except Exception:
    pass

  return rel_name
