# backend/projects/services/pdf/agreement_pdf.py
from __future__ import annotations

import io
import os
import hashlib
from typing import List, Optional, Iterable
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils.timezone import localtime

from projects.models import Agreement, Milestone

# ✅ NEW: version history model
try:
  from projects.models import AgreementPDFVersion  # type: ignore
except Exception:
  AgreementPDFVersion = None  # type: ignore

# Kept for compatibility even if unused here
from projects.services.pdf.scope_filter import is_assumption_key  # noqa: F401

# ✅ AI scope persisted model (OneToOne: agreement.ai_scope)
try:
  from projects.models_ai_scope import AgreementAIScope  # noqa: F401
except Exception:
  AgreementAIScope = None  # type: ignore

try:
  from PyPDF2 import PdfMerger
except Exception:
  PdfMerger = None  # type: ignore

# ✅ Legal clauses
try:
  from projects.services.legal_clauses import build_legal_notices
except Exception:  # pragma: no cover
  def build_legal_notices(project_state: Optional[str] = None, payment_mode: Optional[str] = None) -> List[tuple[str, str]]:
    return [
      (
        "Terms Incorporated",
        "The MyHomeBro Terms of Service, Privacy Policy, and any Escrow Program Terms are incorporated into this "
        "Agreement by reference."
      ),
      (
        "Electronic Signatures & Records",
        "The parties consent to do business electronically and agree that electronic signatures and records have "
        "the same force and effect as wet ink signatures."
      ),
    ]


def _s(v) -> str:
  return "" if v is None else str(v)


def _currency(v) -> str:
  try:
    return f"${float(v or 0):,.2f}"
  except Exception:
    return "$0.00"


def _first_existing(paths: list[str]) -> Optional[str]:
  for p in paths:
    if p and os.path.exists(p):
      return p
  return None


def _myhomebro_logo_path() -> Optional[str]:
  override = getattr(settings, "MHB_LOGO_PATH", None) or os.environ.get("MHB_LOGO_PATH")
  if override and os.path.exists(override):
    return override

  roots: List[str] = []
  static_root = getattr(settings, "STATIC_ROOT", None)
  if static_root:
    roots += [
      static_root,
      os.path.join(static_root, "assets"),
      os.path.join(static_root, "static"),
      os.path.join(static_root, "staticfiles"),
      os.path.join(static_root, "staticfiles", "assets"),
    ]
  roots.append(os.path.join(getattr(settings, "BASE_DIR", ""), "static"))
  roots += [str(p) for p in getattr(settings, "STATICFILES_DIRS", []) or []]

  candidates: List[str] = []
  for r in roots:
    candidates += [
      os.path.join(r, "myhomebro_logo.png"),
      os.path.join(r, "img", "myhomebro_logo.png"),
      os.path.join(r, "images", "myhomebro_logo.png"),
      os.path.join(r, "assets", "myhomebro_logo.png"),
    ]
  return _first_existing(candidates)


def _contractor_logo_path(ag: Agreement) -> Optional[str]:
  try:
    field = getattr(getattr(ag, "contractor", None), "logo", None)
    if field and hasattr(field, "path") and os.path.exists(field.path):
      return field.path
  except Exception:
    pass
  return None


def _signature_path(field) -> Optional[str]:
  try:
    if field and hasattr(field, "path") and os.path.exists(field.path):
      return field.path
  except Exception:
    pass
  return None


def _due_of(m) -> Optional[str]:
  for attr in (
    "completion_date", "due_date", "end_date", "end",
    "target_date", "finish_date", "scheduled_date", "start_date",
  ):
    val = getattr(m, attr, None)
    if val:
      try:
        val = val.date()
      except Exception:
        pass
      return _s(val)
  return None


def _start_of(m) -> Optional[str]:
  for attr in ("start_date", "scheduled_date", "begin_date", "start"):
    val = getattr(m, attr, None)
    if val:
      try:
        val = val.date()
      except Exception:
        pass
      return _s(val)
  return None


def _fmt_date_friendly(v: object) -> Optional[str]:
  if not v:
    return None
  try:
    if isinstance(v, datetime):
      d = v.date()
    elif isinstance(v, date):
      d = v
    else:
      d = datetime.fromisoformat(str(v)).date()
    txt = d.strftime("%b %d, %Y")
    return txt.replace(" 0", " ")
  except Exception:
    try:
      s = str(v)
      if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    except Exception:
      pass
    return str(v)


def _get_first(obj, keys: Iterable[str]) -> Optional[str]:
  for k in keys:
    try:
      v = getattr(obj, k, None)
    except Exception:
      v = None
    if v:
      s = str(v).strip()
      if s:
        return s
  return None


def _fmt_addr_from(obj) -> str:
  if not obj:
    return ""

  line1 = _get_first(obj, (
    "street_address",
    "address_line1",
    "address",
    "line1",
    "address1",
    "street1",
    "street",
  ))

  line2 = _get_first(obj, (
    "address_line2",
    "address_line_2",
    "line2",
    "address2",
    "street2",
    "unit",
    "apt",
    "suite",
  ))

  city = _get_first(obj, ("city", "town", "city_name"))
  state = _get_first(obj, ("state", "state_code", "region", "province"))
  zipc = _get_first(obj, ("zip_code", "zip", "zipcode", "postal_code", "postcode"))

  parts: List[str] = []
  if line1:
    parts.append(line1)
  if line2:
    parts.append(line2)
  tail = " ".join([p for p in (city, state, zipc) if p])
  if tail:
    parts.append(tail)

  return " ".join(parts) if parts else ""


def _composite_addr_from_snapshots(obj, prefix: str) -> str:
  if not obj:
    return ""

  def g(name: str) -> Optional[str]:
    return _get_first(obj, (name,))

  line1 = (
    g(f"{prefix}_address_line1_snapshot") or
    g(f"{prefix}_street_address_snapshot") or
    g(f"{prefix}_street_snapshot") or
    g(f"{prefix}_address_snapshot")
  )
  line2 = (
    g(f"{prefix}_address_line2_snapshot") or
    g(f"{prefix}_unit_snapshot") or
    g(f"{prefix}_apt_snapshot") or
    g(f"{prefix}_suite_snapshot")
  )
  city = g(f"{prefix}_city_snapshot")
  state = (
    g(f"{prefix}_state_snapshot") or
    g(f"{prefix}_region_snapshot") or
    g(f"{prefix}_state_code_snapshot")
  )
  zipc = (
    g(f"{prefix}_zip_snapshot") or
    g(f"{prefix}_zipcode_snapshot") or
    g(f"{prefix}_postal_code_snapshot") or
    g(f"{prefix}_postcode_snapshot")
  )

  parts: List[str] = []
  if line1:
    parts.append(line1.strip())
  if line2:
    parts.append(line2.strip())
  tail = " ".join([p for p in (city, state, zipc) if p and str(p).strip()])
  if tail:
    parts.append(tail.strip())
  return " ".join(parts).strip() if parts else ""


def _project_addr_from_agreement(ag: Agreement) -> str:
  line1 = getattr(ag, "project_address_line1", None) or ""
  line2 = getattr(ag, "project_address_line2", None) or ""
  city = getattr(ag, "project_address_city", None) or ""
  state = getattr(ag, "project_address_state", None) or ""
  postal = getattr(ag, "project_postal_code", None) or ""

  if not any([line1.strip(), line2.strip(), city.strip(), state.strip(), postal.strip()]):
    return ""

  parts: List[str] = []
  if line1.strip():
    parts.append(line1.strip())
  if line2.strip():
    parts.append(line2.strip())
  tail_parts = [p.strip() for p in (city, state, postal) if str(p).strip()]
  if tail_parts:
    parts.append(" ".join(tail_parts))

  return " ".join(parts)


def _project_address(ag: Agreement) -> str:
  direct = _project_addr_from_agreement(ag)
  if direct:
    return direct

  is_same = getattr(ag, "project_is_homeowner_address", False) or getattr(
    ag, "project_address_same_as_homeowner", False
  )
  if is_same:
    return "Same as Customer Address"

  return ""


def _detect_project_state(ag: Agreement) -> Optional[str]:
  candidates: List[Optional[str]] = []
  try:
    proj = getattr(ag, "project", None)
    if proj:
      candidates += [getattr(proj, "state", None), getattr(proj, "region", None)]
  except Exception:
    pass
  try:
    h = getattr(ag, "homeowner", None)
    if h:
      candidates += [getattr(h, "state", None), getattr(h, "region", None)]
  except Exception:
    pass
  try:
    c = getattr(ag, "contractor", None)
    if c:
      candidates += [getattr(c, "state", None), getattr(c, "region", None)]
  except Exception:
    pass
  candidates += [getattr(ag, "state", None)]
  candidates += [
    getattr(ag, "project_state_snapshot", None),
    getattr(ag, "homeowner_state_snapshot", None),
  ]

  for v in candidates:
    if not v:
      continue
    s = str(v).strip()
    if not s:
      continue
    return s.upper() if len(s) == 2 else s
  return None


def _watermark_preview(canvas):
  canvas.saveState()
  canvas.setFont("Helvetica-Bold", 48)
  canvas.setFillGray(0.85)
  canvas.translate(612 / 2, 792 / 2)
  canvas.rotate(30)
  canvas.drawCentredString(0, 0, "PREVIEW – NOT SIGNED")
  canvas.restoreState()


def _escape_html(s: str) -> str:
  return (
    (s or "")
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
  )


def _desc_to_html(desc: str) -> str:
  desc = (desc or "").replace("\r\n", "\n").replace("\r", "\n").strip()
  if not desc:
    return ""

  lines = [ln.strip() for ln in desc.split("\n")]

  bullets: List[str] = []
  normals: List[str] = []

  for ln in lines:
    if not ln:
      normals.append("")
      continue
    if ln.startswith(("-", "•", "*")):
      bullets.append(ln.lstrip("-•*").strip())
    else:
      normals.append(ln)

  parts: List[str] = []

  normal_txt = "\n".join(normals).strip()
  if normal_txt:
    parts.append(_escape_html(normal_txt).replace("\n\n", "<br/><br/>").replace("\n", "<br/>"))

  if bullets:
    li = "".join([f"<li>{_escape_html(b)}</li>" for b in bullets if b])
    if li:
      parts.append(f"<ul>{li}</ul>")

  return "<br/>".join([p for p in parts if p])


def _header_footer(canvas, doc, *, ag: Optional[Agreement] = None):
  """
  Draw header/footer + mini signatures in footer of each page.
  ✅ Footer signatures only show when agreement is EXECUTED (signature_is_satisfied True).
  """
  from reportlab.lib import colors
  from reportlab.lib.pagesizes import letter
  from reportlab.lib.units import inch
  from reportlab.lib.utils import ImageReader

  canvas.saveState()
  w, h = letter

  # Header rule
  canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
  canvas.setLineWidth(0.6)
  canvas.line(0.75 * inch, h - 0.9 * inch, w - 0.75 * inch, h - 0.9 * inch)

  canvas.setFont("Helvetica", 9.5)
  canvas.setFillColor(colors.HexColor("#6B7280"))
  canvas.drawRightString(w - 0.8 * inch, h - 0.72 * inch, "Agreement")

  # Footer rule
  footer_rule_y = 0.9 * inch
  canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
  canvas.setLineWidth(0.6)
  canvas.line(0.75 * inch, footer_rule_y, w - 0.75 * inch, footer_rule_y)

  # Footer logo (left)
  mhb_path = _myhomebro_logo_path()
  if mhb_path and os.path.exists(mhb_path):
    try:
      im = ImageReader(mhb_path)
      iw, ih = im.getSize()
      max_w, max_h = 75, 18
      scale = min(max_w / iw, max_h / ih, 1.0)
      fw, fh = iw * scale, ih * scale
      canvas.drawImage(im, 0.8 * inch, 0.62 * inch, width=fw, height=fh, mask="auto")
    except Exception:
      canvas.setFont("Helvetica-Bold", 9)
      canvas.setFillColor(colors.HexColor("#111827"))
      canvas.drawString(0.8 * inch, 0.63 * inch, "MyHomeBro")
  else:
    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(colors.HexColor("#111827"))
    canvas.drawString(0.8 * inch, 0.63 * inch, "MyHomeBro")

  # Footer right: timestamp + page #
  canvas.setFont("Helvetica", 9)
  ts = localtime().strftime("%Y-%m-%d %H:%M")
  right = f"Generated {ts}  |  Page {canvas.getPageNumber()}"
  canvas.setFillColor(colors.HexColor("#475569"))
  tw = canvas.stringWidth(right, "Helvetica", 9)
  canvas.drawString(w - 0.8 * inch - tw, 0.62 * inch, right)

  # ✅ Mini signatures BELOW the line — EXECUTED ONLY
  show_footer_sigs = False
  if ag is not None:
    try:
      show_footer_sigs = bool(getattr(ag, "signature_is_satisfied", False))
    except Exception:
      show_footer_sigs = False

  if show_footer_sigs and ag is not None:
    try:
      contractor_signed = bool(
        getattr(ag, "contractor_signed", False)
        or getattr(ag, "signed_by_contractor", False)
        or getattr(ag, "contractor_signature_name", None)
      )
      homeowner_signed = bool(
        getattr(ag, "homeowner_signed", False)
        or getattr(ag, "signed_by_homeowner", False)
        or getattr(ag, "homeowner_signature_name", None)
      )

      c_img_path = _signature_path(getattr(ag, "contractor_signature", None)) if contractor_signed else None
      h_img_path = _signature_path(getattr(ag, "homeowner_signature", None)) if homeowner_signed else None

      max_sig_w = 95
      max_sig_h = 16
      sig_y = 0.64 * inch
      start_x = (w / 2) - 110

      def draw_sig(path: str, x: float, y: float, label: str):
        try:
          im = ImageReader(path)
          iw, ih = im.getSize()
          if not iw or not ih:
            return
          scale = min(max_sig_w / float(iw), max_sig_h / float(ih), 1.0)
          fw, fh = float(iw) * scale, float(ih) * scale

          canvas.setFont("Helvetica", 7.0)
          canvas.setFillColor(colors.HexColor("#6B7280"))
          canvas.drawString(x, y + fh + 1, label)

          canvas.drawImage(im, x, y, width=fw, height=fh, mask="auto")
        except Exception:
          return

      if c_img_path:
        draw_sig(c_img_path, start_x, sig_y, "Contractor")
        start_x += 115
      if h_img_path:
        draw_sig(h_img_path, start_x, sig_y, "Customer")
    except Exception:
      pass

  canvas.restoreState()


def _ai_scope_payload(ag: Agreement) -> tuple[list[dict], dict]:
  try:
    scope = getattr(ag, "ai_scope", None)
    if not scope:
      return [], {}
    questions = getattr(scope, "questions", None) or []
    answers = getattr(scope, "answers", None) or {}
    if not isinstance(questions, list):
      questions = []
    if not isinstance(answers, dict):
      answers = {}
    return questions, answers
  except Exception:
    return [], {}


def _pretty_key(k: str) -> str:
  k = (k or "").strip()
  if not k:
    return ""
  return k.replace("_", " ").strip().title()


def _normalize_payment_mode(v) -> str:
  s = str(v or "").strip().lower()
  if "direct" in s:
    return "direct"
  if "escrow" in s:
    return "escrow"
  return "escrow"


def _advisory_money_line(label: str, low, high) -> str:
  try:
    lo = float(low)
    hi = float(high)
    if lo <= 0 or hi <= 0:
      return ""
    return f"{label}: {_currency(lo)} – {_currency(hi)}"
  except Exception:
    return ""


def _milestone_advisory_lines(m) -> list[str]:
  mode = _s(getattr(m, "pricing_mode", None)).strip().lower()
  labor_line = _advisory_money_line(
    "Labor",
    getattr(m, "labor_estimate_low", None),
    getattr(m, "labor_estimate_high", None),
  )
  material_range_line = _advisory_money_line(
    "Materials",
    getattr(m, "materials_estimate_low", None),
    getattr(m, "materials_estimate_high", None),
  )
  if mode == "labor_only":
    materials_line = "Materials: customer supplied"
  else:
    materials_line = material_range_line or ("Materials: shared responsibility" if mode == "hybrid" else "")
  materials_hint = _s(getattr(m, "materials_hint", None)).strip()
  hint_line = f"Materials context: {materials_hint}" if materials_hint else ""
  detail_lines = [line for line in (labor_line, materials_line, hint_line) if line]
  if not detail_lines:
    return []
  return ["Estimate guidance:"] + detail_lines


def _boolish(v, default: bool = True) -> bool:
  if v is True:
    return True
  if v is False:
    return False
  if v in (1, "1", "true", "True", "yes", "Yes"):
    return True
  if v in (0, "0", "false", "False", "no", "No"):
    return False
  return default


def _signature_requirements(ag: Agreement) -> tuple[bool, bool]:
  req_contr = _boolish(getattr(ag, "require_contractor_signature", None), True)
  req_cust = _boolish(getattr(ag, "require_customer_signature", None), True)
  return req_contr, req_cust


def _clarification_is_answered(value) -> bool:
  if value is False:
    return True
  if value == 0:
    return True
  if value is None:
    return False
  if isinstance(value, str):
    return bool(value.strip())
  if isinstance(value, (list, tuple, set)):
    return len(value) > 0
  if isinstance(value, dict):
    return len(value) > 0
  return True


def _clarification_display_value(value) -> str:
  if value is True:
    return "Yes"
  if value is False:
    return "No"
  if value is None:
    return "Not provided"
  if isinstance(value, (list, tuple, set)):
    items = [str(x).strip() for x in value if str(x).strip()]
    return ", ".join(items) if items else "Not provided"
  if isinstance(value, dict):
    try:
      bits = []
      for k, v in value.items():
        ks = str(k).strip()
        vs = str(v).strip()
        if ks and vs:
          bits.append(f"{ks}: {vs}")
      return "; ".join(bits) if bits else "Not provided"
    except Exception:
      return "Not provided"
  s = str(value).strip()
  return s or "Not provided"


def _normalized_clarification_rows(questions: list[dict], answers: dict) -> list[dict]:
  q_list = questions if isinstance(questions, list) else []
  a_map = answers if isinstance(answers, dict) else {}

  question_map: dict[str, dict] = {}
  ordered_keys: List[str] = []

  for q in q_list:
    if not isinstance(q, dict):
      continue
    key = str(q.get("key") or "").strip()
    if not key:
      continue
    if key not in question_map:
      ordered_keys.append(key)
    question_map[key] = q

  for key in a_map.keys():
    s_key = str(key).strip()
    if s_key and s_key not in question_map:
      ordered_keys.append(s_key)

  rows: List[dict] = []
  for key in ordered_keys:
    q = question_map.get(key, {})
    label = str(q.get("label") or "").strip() or _pretty_key(key)
    help_text = str(q.get("help") or "").strip()
    required = bool(q.get("required", False))
    value = a_map.get(key)
    answered = _clarification_is_answered(value)

    if not answered and not required:
      # hide optional blanks to keep PDF clean
      continue

    rows.append({
      "key": key,
      "label": label or _pretty_key(key) or key,
      "help": help_text,
      "required": required,
      "answered": answered,
      "status_label": "Recommended" if required else "Optional",
      "value_text": _clarification_display_value(value),
    })

  rows.sort(key=lambda r: (0 if r.get("answered") else 1, 0 if r.get("required") else 1, r.get("label", "").lower()))
  return rows


def build_agreement_pdf_bytes(ag: Agreement, *, is_preview: bool = False) -> bytes:
  from reportlab.lib.pagesizes import letter
  from reportlab.lib.units import inch
  from reportlab.lib import colors
  from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
  from reportlab.lib.enums import TA_CENTER
  from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image,
    PageBreak,
    KeepTogether,
    CondPageBreak,
  )

  def _scaled_image(path: Optional[str], max_w: float, max_h: float) -> Optional[Image]:
    try:
      if not path or not os.path.exists(path):
        return None
      img = Image(path)
      iw = getattr(img, "imageWidth", None) or getattr(img, "drawWidth", None) or 0
      ih = getattr(img, "imageHeight", None) or getattr(img, "drawHeight", None) or 0
      if not iw or not ih:
        return None
      scale = min(max_w / float(iw), max_h / float(ih), 1.0)
      img.drawWidth = float(iw) * scale
      img.drawHeight = float(ih) * scale
      return img
    except Exception:
      return None

  def _paragraphs_from(text: str) -> List[str]:
    if not text:
      return []
    chunks = [p.strip() for p in text.replace("\r\n", "\n").split("\n\n")]
    out: List[str] = []
    for ch in chunks:
      if len(ch) <= 1800:
        out.append(ch)
      else:
        lines = ch.split("\n")
        buf: List[str] = []
        cur = 0
        for ln in lines:
          ln = ln.strip()
          if not ln:
            if buf:
              out.append(" ".join(buf))
              buf = []
              cur = 0
            continue
          ln_len = len(ln)
          if cur + ln_len > 1800 and buf:
            out.append(" ".join(buf))
            buf = [ln]
            cur = ln_len
          else:
            buf.append(ln)
            cur += ln_len + 1
        if buf:
          out.append(" ".join(buf))
    return out

  payment_mode = _normalize_payment_mode(getattr(ag, "payment_mode", None))

  buf = io.BytesIO()
  doc = SimpleDocTemplate(
    buf,
    pagesize=letter,
    leftMargin=0.75 * inch,
    rightMargin=0.75 * inch,
    topMargin=1.2 * inch,
    bottomMargin=0.9 * inch,
    title=f"Agreement #{getattr(ag, 'pk', '')}",
  )

  ss = getSampleStyleSheet()
  s_h1 = ss["Heading1"]
  s_h1.fontSize = 22
  s_h1.textColor = colors.HexColor("#111827")
  s_h2 = ss["Heading2"]
  s_h2.fontSize = 14
  s_body = ss["BodyText"]
  s_small = ParagraphStyle(
    "Small",
    parent=s_body,
    fontSize=9.5,
    leading=13,
    textColor=colors.HexColor("#6B7280"),
  )
  s_muted = ParagraphStyle(
    "Muted", parent=s_body, fontSize=10, textColor=colors.HexColor("#6B7280")
  )
  s_just = ParagraphStyle("Just", parent=s_body, fontSize=10.5, leading=14)
  s_h3 = ParagraphStyle("h3", parent=s_h2, fontSize=12.5)
  s_lbl = ParagraphStyle(
    "lbl",
    parent=s_body,
    fontSize=10.5,
    leading=14,
    textColor=colors.HexColor("#111827"),
  )
  s_val = ParagraphStyle("val", parent=s_body, fontSize=10.5, leading=14)

  s_table = ParagraphStyle(
    "TableCell",
    parent=s_body,
    fontSize=9,
    leading=11,
    wordWrap="CJK",
  )
  s_table_center = ParagraphStyle(
    "TableCellCenter",
    parent=s_table,
    alignment=TA_CENTER,
  )
  s_table_sub = ParagraphStyle(
    "TableCellSub",
    parent=s_table,
    fontSize=8.5,
    leading=10.5,
    textColor=colors.HexColor("#374151"),
  )

  story: list = []

  contractor_logo = _contractor_logo_path(ag)
  img_logo = _scaled_image(contractor_logo, max_w=170, max_h=44)
  if img_logo:
    story.append(img_logo)
    story.append(Spacer(1, 6))

  story.append(Paragraph(f"Agreement #{ag.id}", s_h1))
  story.append(Spacer(1, 6))
  story.append(Paragraph("Project", s_lbl))

  contractor = getattr(ag, "contractor", None)
  homeowner = getattr(ag, "homeowner", None)
  project = getattr(ag, "project", None)

  c_name = _s(getattr(contractor, "business_name", None) or getattr(contractor, "full_name", None))
  c_email = _s(getattr(contractor, "email", None))
  c_phone = _s(getattr(contractor, "phone", None) or getattr(contractor, "phone_number", None))
  c_addr = _fmt_addr_from(contractor)
  c_lic_no = _s(getattr(contractor, "license_number", None))
  c_lic_ex = _s(getattr(contractor, "license_expiration", None))

  h_name_raw = _s(getattr(homeowner, "full_name", None) or getattr(homeowner, "name", None))
  h_company = _s(getattr(homeowner, "company_name", None)).strip()
  h_name = f"{h_company} ({h_name_raw})" if (h_company and h_name_raw) else (h_company or h_name_raw)
  h_email = _s(getattr(homeowner, "email", None))
  h_addr = _fmt_addr_from(homeowner) or _composite_addr_from_snapshots(ag, "homeowner")

  p_addr = _project_address(ag)

  proj_type = _s(getattr(ag, "project_type", None) or getattr(project, "type", None))
  proj_subtype = _s(getattr(ag, "project_subtype", None) or getattr(project, "subtype", None))
  type_line = proj_type if proj_type else "—"
  if proj_subtype:
    type_line = f"{proj_type} — {proj_subtype}" if proj_type else proj_subtype

  milestones_qs = Milestone.objects.filter(agreement=ag).order_by("order", "id")
  first_start: Optional[str] = None
  last_due: Optional[str] = None
  if milestones_qs.exists():
    first_m = milestones_qs.first()
    last_m = milestones_qs.last()
    if first_m:
      first_start = _start_of(first_m)
    if last_m:
      last_due = _due_of(last_m)

  schedule_line = "—"
  if first_start or last_due:
    start_txt = _fmt_date_friendly(first_start) if first_start else "TBD"
    end_txt = _fmt_date_friendly(last_due) if last_due else "TBD"
    schedule_line = f"{start_txt} → {end_txt} (est.)"
  else:
    ag_start = _s(getattr(ag, "start", None))
    ag_end = _s(getattr(ag, "end", None))
    if ag_start or ag_end:
      start_txt = _fmt_date_friendly(ag_start) if ag_start else "TBD"
      end_txt = _fmt_date_friendly(ag_end) if ag_end else "TBD"
      schedule_line = f"{start_txt} → {end_txt} (est.)"

  status_line = (_s(getattr(ag, "status", "")) or "draft").lower()

  def _dot_join(parts: list[str]) -> str:
    return " • ".join([p for p in parts if p])

  story.append(Paragraph(f"<b>Contractor:</b> {_dot_join([c_name, c_email, c_phone]) or '—'}", s_val))
  if c_addr:
    story.append(Paragraph(f"<b>Contractor Address:</b> {c_addr or '---'}", s_val))
  if c_lic_no:
    lic = f"License #{c_lic_no}"
    if c_lic_ex:
      lic += f" (exp {c_lic_ex})"
    story.append(Paragraph(f"<b>{lic}</b>", s_small))

  story.append(Paragraph(f"<b>Customer:</b> {_dot_join([h_name, h_email]) or '—'}", s_val))
  story.append(Paragraph(f"<b>Customer Address:</b> {h_addr or '---'}", s_val))
  story.append(Paragraph(f"<b>Project Address:</b> {p_addr or '---'}", s_val))
  story.append(Paragraph(f"<b>Type:</b> {type_line}", s_val))
  story.append(Paragraph(f"<b>Payment Mode:</b> {'Direct Pay' if payment_mode == 'direct' else 'Escrow (Protected)'}", s_val))
  story.append(Paragraph(f"<b>Schedule:</b> {schedule_line}", s_val))
  story.append(Paragraph(f"<b>Status:</b> {status_line}", s_small))
  story.append(Spacer(1, 12))

  story.append(Paragraph("Milestones", s_h2))
  ms = milestones_qs
  if ms.exists():
    rows = [[
      Paragraph("#", s_table_center),
      Paragraph("Milestone", s_table),
      Paragraph("Start Date", s_table_center),
      Paragraph("Due Date", s_table_center),
      Paragraph("Milestone Amount", s_table_center),
    ]]

    total_amt = Decimal("0.00")

    for idx, m in enumerate(ms, 1):
      try:
        order_num = int(getattr(m, "order", None) or 0) or idx
      except Exception:
        order_num = idx

      title = _s(getattr(m, "title", None) or "").strip() or "—"
      desc = _s(getattr(m, "description", None) or "").strip()

      amt = Decimal(str(getattr(m, "amount", 0) or 0))
      total_amt += amt

      start_raw = _start_of(m)
      due_raw = _due_of(m)
      start = _fmt_date_friendly(start_raw) if start_raw else "TBD"
      due = _fmt_date_friendly(due_raw) if due_raw else "TBD"

      desc_html = _desc_to_html(desc)
      milestone_html = f"<b>{_escape_html(title)}</b>"
      if desc_html:
        milestone_html += f"<br/>{desc_html}"
      for advisory_line in _milestone_advisory_lines(m):
        milestone_html += f"<br/><font color='#4B5563'>{_escape_html(advisory_line)}</font>"

      rows.append([
        Paragraph(str(order_num), s_table_center),
        Paragraph(milestone_html, s_table_sub),
        Paragraph(start, s_table_center),
        Paragraph(due, s_table_center),
        Paragraph(_currency(float(amt)), s_table_center),
      ])

    rows.append([
      "",
      Paragraph("<b>Totals</b>", s_table),
      "",
      "",
      Paragraph(f"<b>{_currency(float(total_amt))}</b>", s_table_center),
    ])

    c1 = 0.55 * inch
    c3 = 1.05 * inch
    c4 = 1.05 * inch
    c5 = 1.20 * inch
    c2 = doc.width - (c1 + c3 + c4 + c5)

    t = Table(rows, colWidths=[c1, c2, c3, c4, c5], repeatRows=1)
    t.setStyle(TableStyle([
      ("BACKGROUND", (0, 0), (-1, 0), "#F3F4F6"),
      ("GRID", (0, 0), (-1, -1), 0.25, "#E5E7EB"),
      ("ALIGN", (0, 1), (0, -2), "CENTER"),
      ("ALIGN", (2, 1), (3, -2), "CENTER"),
      ("ALIGN", (4, 1), (4, -2), "RIGHT"),
      ("VALIGN", (0, 0), (-1, -1), "TOP"),
      ("BACKGROUND", (0, -1), (-1, -1), "#FAFAFA"),
      ("LINEABOVE", (0, -1), (-1, -1), 0.5, "#E5E7EB"),
      ("TOPPADDING", (0, 0), (-1, -1), 3),
      ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
      ("LEFTPADDING", (0, 0), (-1, -1), 6),
      ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [t, Spacer(1, 10)]

    story.append(PageBreak())

    story.append(Paragraph(
      "Each milestone represents a distinct phase of work. Payment for a milestone is contingent upon substantial "
      "completion of the work described for that milestone, subject to the approval and dispute process set forth "
      "in this Agreement.",
      s_just,
    ))
    story.append(Paragraph(
      "Approval indicates that the milestone work has been substantially completed in a professional and "
      "workmanlike manner consistent with industry standards, excluding minor punch-list items that do not "
      "materially impair use.",
      s_just,
    ))
    story.append(Paragraph(
      "Estimated schedule; dates may change. Materials listed are estimated project context and may change.",
      s_small,
    ))
    story.append(Spacer(1, 12))
  else:
    story += [Paragraph("No milestones defined.", s_muted), Spacer(1, 12)]

  questions, answers = _ai_scope_payload(ag)
  clarification_rows = _normalized_clarification_rows(questions, answers)
  if clarification_rows:
    story.append(CondPageBreak(3.0 * inch))
    story.append(Paragraph("Scope Clarifications", s_h2))
    story.append(Paragraph(
      "These clarifications summarize optional and recommended scope details captured during agreement setup. "
      "They help reduce misunderstandings about responsibilities, materials, access, permits, selections, and other project assumptions.",
      s_small,
    ))
    story.append(Spacer(1, 6))

    clar_rows = [[
      Paragraph("Clarification", s_table),
      Paragraph("Response", s_table),
      Paragraph("Status", s_table_center),
    ]]

    for row in clarification_rows:
      label_html = f"<b>{_escape_html(row.get('label', ''))}</b>"
      help_txt = row.get("help", "")
      if help_txt:
        label_html += f"<br/><font color='#6B7280'>{_escape_html(help_txt)}</font>"

      response_html = _escape_html(row.get("value_text", "Not provided")).replace("\n", "<br/>")
      status_html = row.get("status_label", "Optional")

      clar_rows.append([
        Paragraph(label_html, s_table_sub),
        Paragraph(response_html, s_table_sub),
        Paragraph(status_html, s_table_center),
      ])

    clar_c1 = 2.35 * inch
    clar_c3 = 1.00 * inch
    clar_c2 = doc.width - (clar_c1 + clar_c3)

    clar_tbl = Table(clar_rows, colWidths=[clar_c1, clar_c2, clar_c3], repeatRows=1)
    clar_tbl.setStyle(TableStyle([
      ("BACKGROUND", (0, 0), (-1, 0), "#F3F4F6"),
      ("GRID", (0, 0), (-1, -1), 0.25, "#E5E7EB"),
      ("VALIGN", (0, 0), (-1, -1), "TOP"),
      ("ALIGN", (2, 1), (2, -1), "CENTER"),
      ("TOPPADDING", (0, 0), (-1, -1), 4),
      ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
      ("LEFTPADDING", (0, 0), (-1, -1), 6),
      ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(clar_tbl)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
      "<i>Where these Scope Clarifications assign responsibility for permits, materials, selections, site access, "
      "or other project logistics, those clarifications supplement the scope of work and help interpret the parties’ expectations.</i>",
      s_small,
    ))
    story.append(Spacer(1, 12))

  story.append(Paragraph("Warranty", s_h2))
  wtype = (_s(getattr(ag, "warranty_type", ""))).strip().lower()
  wtext = _s(getattr(ag, "warranty_text_snapshot", ""))
  if wtype in ("default", "standard", "std") or not wtext:
    story.append(Paragraph(
      "Contractor warrants that all work will be performed in a professional and workmanlike manner consistent "
      "with applicable codes and industry standards. Warranty excludes normal wear, misuse, improper maintenance, "
      "third-party modifications, and acts of God.",
      s_just,
    ))
  else:
    story.append(Paragraph(wtext.replace("\n", "<br/>"), s_just))
  story.append(Spacer(1, 12))

  story.append(CondPageBreak(2.6 * inch))
  story.append(Paragraph("Legal Terms & Conditions", s_h2))
  story.append(Spacer(1, 6))

  project_state = _detect_project_state(ag)
  clauses = build_legal_notices(project_state=project_state, payment_mode=payment_mode)

  def _clause_block(title: str, text: str):
    parts = [Paragraph(title, s_h3)]
    for para in _paragraphs_from(text):
      parts.append(Paragraph(para.replace("\n", "<br/>"), s_just))
    parts.append(Spacer(1, 6))
    return parts

  from reportlab.platypus import KeepTogether

  for title, text in clauses:
    if title == "Permits & Compliance":
      story.append(CondPageBreak(3.0 * inch))

    block = _clause_block(title, text)

    if title in (
      "Limitation of Liability",
      "Insurance",
      "Payment & Escrow",
      "Payment (Direct Pay)",
      "Payment Processing & Platform Fees",
    ):
      story.append(KeepTogether(block))
    else:
      for p in block:
        story.append(p)

  story.append(Paragraph("Governing Law", s_h3))
  story.append(Paragraph(
    "This Agreement is governed by the laws of the state in which the project property is located, without "
    "regard to conflict-of-law principles.",
    s_just,
  ))
  story.append(Spacer(1, 10))

  story.append(PageBreak())

  from reportlab.platypus import Table as RLTable, TableStyle as RLTableStyle, Spacer as RLSpacer

  story.append(Paragraph("Document Metadata & Amendment History", s_h2))
  story.append(Spacer(1, 6))

  ag_created = getattr(ag, "created_at", None) or getattr(ag, "created", None)
  ag_amended = getattr(ag, "amended_at", None)
  ag_amend_num = getattr(ag, "amendment_number", None)
  ag_pdf_ver = getattr(ag, "pdf_version", None)

  def _fmt_dt(val) -> str:
    if not val:
      return "—"
    try:
      return localtime(val).strftime("%Y-%m-%d %H:%M")
    except Exception:
      return str(val)

  meta_rows = [
    ["Agreement ID", str(getattr(ag, "id", "")) or "—"],
    ["Amendment Number", str(ag_amend_num or 0)],
    ["PDF Version", f"v{ag_pdf_ver}" if ag_pdf_ver is not None else "—"],
    ["Payment Mode", "Direct Pay" if payment_mode == "direct" else "Escrow (Protected)"],
    ["Original Created", _fmt_dt(ag_created)],
    ["Last Amended", _fmt_dt(ag_amended)],
    ["Generated At", localtime().strftime("%Y-%m-%d %H:%M")],
  ]

  from reportlab.lib.units import inch as _inch

  meta_tbl = RLTable(meta_rows, colWidths=[1.9 * _inch, doc.width - 1.9 * _inch])
  meta_tbl.setStyle(RLTableStyle([
    ("GRID", (0, 0), (-1, -1), 0.25, "#E5E7EB"),
    ("BACKGROUND", (0, 0), (-1, 0), "#F9FAFB"),
    ("FONT", (0, 0), (-1, -1), "Helvetica", 9.5),
    ("ALIGN", (0, 0), (0, -1), "LEFT"),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
  ]))
  story.append(meta_tbl)
  story.append(RLSpacer(1, 12))

  story.append(Paragraph("Signatures", s_h2))

  req_contr, req_cust = _signature_requirements(ag)

  contractor_signed = bool(
    getattr(ag, "contractor_signed", False)
    or getattr(ag, "signed_by_contractor", False)
    or getattr(ag, "contractor_signature_name", None)
  )
  homeowner_signed = bool(
    getattr(ag, "homeowner_signed", False)
    or getattr(ag, "signed_by_homeowner", False)
    or getattr(ag, "homeowner_signature_name", None)
  )

  c_img = _signature_path(getattr(ag, "contractor_signature", None)) if contractor_signed else None
  h_img = _signature_path(getattr(ag, "homeowner_signature", None)) if homeowner_signed else None

  def _sig_ip(ag: Agreement, which: str) -> Optional[str]:
    if which == "contractor":
      return (
        getattr(ag, "contractor_signed_ip", None) or
        getattr(ag, "contractor_ip", None) or
        getattr(ag, "signed_ip_contractor", None)
      )
    return (
      getattr(ag, "homeowner_signed_ip", None) or
      getattr(ag, "homeowner_ip", None) or
      getattr(ag, "signed_ip_homeowner", None)
    )

  def _sig_at(ag: Agreement, which: str):
    if which == "contractor":
      return getattr(ag, "signed_at_contractor", None) or getattr(ag, "contractor_signed_at", None)
    return getattr(ag, "signed_at_homeowner", None) or getattr(ag, "homeowner_signed_at", None)

  def _fmt_dt_sig(val) -> str:
    if not val:
      return ""
    try:
      return localtime(val).strftime("%Y-%m-%d %H:%M")
    except Exception:
      return str(val)

  def _sig_block(name: str, img_path: Optional[str], signed_at, ip, label: str, required: bool) -> list:
    block: list = []

    def _scaled_image_local(path: Optional[str], max_w: float, max_h: float):
      try:
        if not path or not os.path.exists(path):
          return None
        from reportlab.platypus import Image as RLImage
        img = RLImage(path)
        iw = getattr(img, "imageWidth", None) or getattr(img, "drawWidth", None) or 0
        ih = getattr(img, "imageHeight", None) or getattr(img, "drawHeight", None) or 0
        if not iw or not ih:
          return None
        scale = min(max_w / float(iw), max_h / float(ih), 1.0)
        img.drawWidth = float(iw) * scale
        img.drawHeight = float(ih) * scale
        return img
      except Exception:
        return None

    simg = _scaled_image_local(img_path, max_w=200, max_h=80) if img_path else None
    if simg:
      block += [simg, RLSpacer(1, 3)]

    signed_str = _fmt_dt_sig(signed_at)
    block += [
      Paragraph(f"<b>{label}:</b> {_s(name) or '—'}", s_body),
      Paragraph(f"<b>Signed:</b> {signed_str or ('—' if required else 'Waived')}", s_small),
      Paragraph(f"<b>IP:</b> {_s(ip) or '—'}", s_small),
    ]
    return block

  c_name_sig = _s(getattr(ag, "contractor_signature_name", None))
  h_name_sig = _s(getattr(ag, "homeowner_signature_name", None))

  c_at_raw = _sig_at(ag, "contractor")
  h_at_raw = _sig_at(ag, "homeowner")

  c_ip = _sig_ip(ag, "contractor")
  h_ip = _sig_ip(ag, "homeowner")

  sig_tbl = RLTable(
    [[
      _sig_block(c_name_sig, c_img, c_at_raw, c_ip, "Contractor", req_contr),
      _sig_block(h_name_sig, h_img, h_at_raw, h_ip, "Customer", req_cust),
    ]],
    colWidths=[3.5 * _inch, 3.5 * _inch],
  )
  sig_tbl.setStyle(RLTableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
  story.append(sig_tbl)

  def _first(c, d):
    executed = False
    try:
      executed = bool(getattr(ag, "signature_is_satisfied", False))
    except Exception:
      executed = False
    if is_preview and not executed:
      _watermark_preview(c)
    _header_footer(c, d, ag=ag)

  def _later(c, d):
    executed = False
    try:
      executed = bool(getattr(ag, "signature_is_satisfied", False))
    except Exception:
      executed = False
    if is_preview and not executed:
      _watermark_preview(c)
    _header_footer(c, d, ag=ag)

  doc.build(story, onFirstPage=_first, onLaterPages=_later)
  return buf.getvalue()


def _sha256_hex(data: bytes) -> str:
  try:
    return hashlib.sha256(data).hexdigest()
  except Exception:
    return ""


def _pick_kind_for_agreement(ag: Agreement) -> str:
  try:
    if bool(getattr(ag, "signature_is_satisfied", False)):
      return "executed"
  except Exception:
    pass
  return "final"


def _snapshot_sig_fields(ag: Agreement) -> dict:
  return {
    "signed_by_contractor": bool(getattr(ag, "signed_by_contractor", False) or getattr(ag, "contractor_signed", False)),
    "signed_by_homeowner": bool(getattr(ag, "signed_by_homeowner", False) or getattr(ag, "homeowner_signed", False)),
    "contractor_signature_name": _s(getattr(ag, "contractor_signature_name", "")),
    "homeowner_signature_name": _s(getattr(ag, "homeowner_signature_name", "")),
    "contractor_signed_at": getattr(ag, "signed_at_contractor", None) or getattr(ag, "contractor_signed_at", None),
    "homeowner_signed_at": getattr(ag, "signed_at_homeowner", None) or getattr(ag, "homeowner_signed_at", None),
  }


def generate_full_agreement_pdf(ag: Agreement, *, merge_attachments: bool = True) -> str:
  version = int(getattr(ag, "pdf_version", 0) or 0) + 1

  base_bytes = build_agreement_pdf_bytes(ag, is_preview=False)

  tmp_dir = os.path.join(getattr(settings, "MEDIA_ROOT", ""), "agreements", "tmp")
  os.makedirs(tmp_dir, exist_ok=True)
  base_path = os.path.join(tmp_dir, f"agreement_{ag.id}_v{version}.pdf")
  with open(base_path, "wb") as f:
    f.write(base_bytes)

  final_bytes = base_bytes
  final_path = base_path

  if merge_attachments and PdfMerger:
    try:
      atts = list(ag.attachments.all())
    except Exception:
      atts = []
    pdf_paths: List[str] = []
    for att in atts:
      p = getattr(att.file, "path", None)
      if p and p.lower().endswith(".pdf") and os.path.exists(p):
        pdf_paths.append(p)

    if pdf_paths:
      try:
        merger = PdfMerger()
        merger.append(base_path)
        for p in pdf_paths:
          merger.append(p)
        merged_path = base_path.replace(".pdf", "_merged.pdf")
        with open(merged_path, "wb") as out:
          merger.write(out)
        merger.close()
        final_path = merged_path
      except Exception:
        final_path = base_path

  try:
    with open(final_path, "rb") as fh:
      final_bytes = fh.read()
  except Exception:
    final_bytes = base_bytes

  sha = _sha256_hex(final_bytes)
  kind = _pick_kind_for_agreement(ag)
  sig_snap = _snapshot_sig_fields(ag)

  fname_ag = f"agreement_{ag.id}_v{version}.pdf"
  fname_ver = f"agreement_{ag.id}_v{version}_{kind}.pdf"

  with transaction.atomic():
    ag.pdf_version = version
    ag.pdf_file.save(fname_ag, ContentFile(final_bytes), save=False)
    ag.save(update_fields=["pdf_version", "pdf_file"])

    if AgreementPDFVersion is not None:
      try:
        obj, created = AgreementPDFVersion.objects.get_or_create(
          agreement=ag,
          version_number=version,
          defaults={
            "kind": kind,
            "sha256": sha,
            **sig_snap,
          },
        )
        obj.kind = kind
        obj.sha256 = sha
        for k, v in sig_snap.items():
          setattr(obj, k, v)

        obj.file.save(fname_ver, ContentFile(final_bytes), save=False)
        obj.save()
      except Exception:
        pass

  return ag.pdf_file.path
