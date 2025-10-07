# backend/projects/services/pdf.py
from __future__ import annotations

import io, os
from typing import List, Optional
from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.timezone import localtime
from projects.models import Agreement

# Optional PDF merger for attached PDFs
try:
    from PyPDF2 import PdfMerger
except Exception:
    PdfMerger = None


# ------------------------- helper utilities -------------------------

def _s(v): return "" if v is None else str(v)
def _currency(v):
    try: return f"${float(v or 0):,.2f}"
    except Exception: return "$0.00"
def _exists(p): return bool(p and os.path.exists(p))


def _myhomebro_logo_path() -> Optional[str]:
    """Find the MyHomeBro logo for the disclaimer."""
    roots = []
    static_root = getattr(settings, "STATIC_ROOT", None)
    if static_root:
        roots.append(os.path.join(static_root, "assets"))
        roots.append(static_root)
    roots.append(os.path.join(getattr(settings, "BASE_DIR", ""), "static"))
    for root in roots:
        for name in ("myhomebro_logo.png", "myhomebro_logo.jpg", "myhomebro_logo.jpeg"):
            p = os.path.join(root, name)
            if os.path.exists(p): return p
    return None


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


def _load_legal_text(filename: str) -> str:
    """
    Load legal text (ToS/Privacy) from static/legal/<filename>.
    Falls back to empty string if not found.
    """
    base_dir = getattr(settings, "BASE_DIR", "")
    candidates = [
        os.path.join(base_dir, "static", "legal", filename),
        os.path.join(getattr(settings, "STATIC_ROOT", "") or "", "legal", filename),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as fh:
                    return fh.read().strip()
            except Exception:
                pass
    return ""


# ------------------------- page chrome -------------------------

def _watermark_preview(canvas):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 48)
    canvas.setFillGray(0.85)
    canvas.translate(612/2, 792/2)
    canvas.rotate(30)
    canvas.drawCentredString(0, 0, "PREVIEW – NOT SIGNED")
    canvas.restoreState()

def _header_footer(canvas, doc):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    canvas.saveState()
    w, h = letter
    canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
    canvas.setLineWidth(0.6)
    canvas.line(0.75*inch, h-0.85*inch, w-0.75*inch, h-0.85*inch)
    canvas.setFont("Helvetica", 9)
    ts = localtime().strftime("%Y-%m-%d %H:%M")
    left = "MyHomeBro — Agreement PDF"
    right = f"Generated {ts}  |  Page {canvas.getPageNumber()}"
    canvas.setFillColor(colors.HexColor("#475569"))
    canvas.drawString(0.75*inch, 0.6*inch, left)
    tw = canvas.stringWidth(right, "Helvetica", 9)
    canvas.drawString(w-0.75*inch-tw, 0.6*inch, right)
    canvas.restoreState()


# ------------------------- main builder -------------------------

def build_agreement_pdf_bytes(ag: Agreement, *, is_preview=False) -> bytes:
    """
    Render a full, legally credible Agreement and append Terms of Service + Privacy Policy.
    Keeps contractor logo in header and MyHomeBro logo only in the disclaimer.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75*inch,
        rightMargin=0.75*inch,
        topMargin=1.0*inch,
        bottomMargin=0.75*inch,
        title=f"Agreement #{getattr(ag,'pk','')}",
    )

    ss = getSampleStyleSheet()
    h1, h2, body = ss["Heading1"], ss["Heading2"], ss["BodyText"]
    h1.fontSize, h2.fontSize = 18, 14
    small = ParagraphStyle("Small", parent=body, fontSize=9, leading=12, textColor=colors.HexColor("#475569"))
    mono  = ParagraphStyle("Mono", parent=body, fontName="Courier", fontSize=9, leading=12)

    story: list = []

    # ---- Header: contractor logo only ----
    logo = _contractor_logo_path(ag)
    if logo:
        try:
            story.append(Image(logo, width=0.9*inch, height=0.9*inch))
        except Exception:
            pass
    story.append(Spacer(1, 6))

    # ---- 1. Project Info ----
    story.append(Paragraph(f"Agreement #{ag.id}", h1))
    title = _s(getattr(ag, "project_title", None) or getattr(ag, "title", None) or "Project")
    story.append(Paragraph(title, body))
    story.append(Spacer(1, 4))
    contractor = getattr(ag, "contractor", None)
    homeowner = getattr(ag, "homeowner", None)
    contractor_line = " • ".join([_s(x) for x in [
        getattr(contractor,"business_name",None) or getattr(contractor,"name",None),
        getattr(contractor,"email",None), getattr(contractor,"phone",None)
    ] if x])
    homeowner_line = " • ".join([_s(x) for x in [
        getattr(homeowner,"name",None) or getattr(homeowner,"full_name",None),
        getattr(homeowner,"email",None)
    ] if x])
    story += [
        Paragraph("<b>Contractor</b>: "+(contractor_line or "—"), body),
        Paragraph("<b>Homeowner</b>: "+(homeowner_line or "—"), body),
        Paragraph(f"<b>Type</b>: {_s(ag.project_type)} — {_s(ag.project_subtype)}", body),
        Paragraph(f"<b>Schedule</b>: {_s(ag.start) or 'TBD'} → {_s(ag.end) or 'TBD'}", body),
        Paragraph(f"<b>Status</b>: {_s(ag.status)}", small),
        Spacer(1, 10)
    ]

    # ---- 2. Scope / Description ----
    desc = _s(getattr(ag,"description",None))
    if desc:
        story += [Paragraph("Scope / Description", h2),
                  Paragraph(desc.replace("\n","<br/>"), body),
                  Spacer(1,8)]

    # ---- 3. Milestones & Payment Terms ----
    from projects.models import Milestone
    ms = Milestone.objects.filter(agreement=ag).order_by("order","id")
    rows=[["#","Milestone","Due","Amount","Status"]]
    total=0
    for i,m in enumerate(ms,1):
        amt=float(getattr(m,"amount",0) or 0)
        total+=amt
        rows.append([i,_s(m.title or m.description),_s(getattr(m,"due_date",None)) or "—",
                     _currency(amt),
                     "Complete" if getattr(m,"completed",False) else (_s(getattr(m,"status","")) or "Pending")])
    rows.append(["","","Total",_currency(total),""])
    t=Table(rows,colWidths=[0.4*inch,3.7*inch,1.2*inch,1.1*inch,1.2*inch])
    t.setStyle(TableStyle([
        ("FONT",(0,0),(-1,0),"Helvetica-Bold"),
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#F8FAFC")),
        ("GRID",(0,0),(-1,-1),0.25,colors.HexColor("#E5E7EB")),
        ("ALIGN",(2,1),(3,-1),"CENTER")
    ]))
    story += [Paragraph("Milestones & Payment Terms", h2), t, Spacer(1,8),
              Paragraph("Payments will be made from escrow upon homeowner approval or 5 days after completion of each milestone, unless disputed in writing.", small),
              Spacer(1,10)]

    # ---- 4. Warranty ----
    story.append(Paragraph("Warranty", h2))
    wtext = _s(getattr(ag,"warranty_text_snapshot",""))
    story.append(Paragraph(
        f"Contractor warrants workmanship for a period of 12 months following completion. "
        f"This warranty covers defects in workmanship and excludes materials, misuse, negligence, or normal wear. "
        f"Contractor will repair or replace defective work at their expense within a reasonable time after notice. "
        f"{wtext}", body))
    story.append(Spacer(1,10))

    # ---- 5. Homeowner Responsibilities ----
    story.append(Paragraph("Homeowner Responsibilities", h2))
    story.append(Paragraph(
        "Homeowner agrees to provide timely access to the property, maintain a safe working environment, "
        "and promptly review and approve milestone completions. Homeowner shall not unreasonably delay approval "
        "or payment once work is completed as described.", body))
    story.append(Spacer(1,10))

    # ---- 6. Contractor Responsibilities & Insurance ----
    story.append(Paragraph("Contractor Responsibilities & Insurance", h2))
    story.append(Paragraph(
        "Contractor represents they maintain all licenses, insurance, and permits required by law and will perform "
        "all work in accordance with applicable building codes. Contractor assumes full responsibility for employee safety, "
        "tools, and materials used in performance of this Agreement.", body))
    story.append(Spacer(1,10))

    # ---- 7. Dispute Resolution & Termination ----
    story.append(Paragraph("Dispute Resolution & Termination", h2))
    story.append(Paragraph(
        "In the event of a dispute, both parties agree to attempt resolution through direct communication and mediation "
        "before arbitration or litigation. Either party may terminate this Agreement with written notice if the other fails "
        "to perform a material obligation, provided all completed work and costs are settled fairly.", body))
    story.append(Spacer(1,10))

    # ---- 8. Governing Law & Miscellaneous ----
    story.append(Paragraph("Governing Law & Miscellaneous", h2))
    story.append(Paragraph(
        "This Agreement shall be governed by the laws of the State of Texas, without regard to conflicts of law principles. "
        "If any provision is held invalid, the remaining provisions shall remain in effect. "
        "Electronic signatures are legally binding under the U.S. ESIGN Act.", body))
    story.append(Spacer(1,10))

    # ---- 9. Attachments & Addenda ----
    story.append(Paragraph("Attachments & Addenda", h2))
    atts=[]
    try: atts=list(ag.attachments.all())
    except Exception: atts=[]
    if atts:
        rows=[["Category","Title / File","Acknowledgement Required"]]
        for f in atts:
            rows.append([_s(getattr(f,"category","OTHER")).upper(),
                         _s(getattr(f,"title",None) or getattr(f,"filename",None) or "Attachment"),
                         "Yes" if getattr(f,"require_acknowledgement",False) else "No"])
        from reportlab.platypus import Table as RLTable, TableStyle as RLTableStyle
        att_tbl=RLTable(rows,colWidths=[1.2*inch,4.6*inch,1.3*inch])
        att_tbl.setStyle(RLTableStyle([
            ("FONT",(0,0),(-1,0),"Helvetica-Bold"),
            ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#F8FAFC")),
            ("GRID",(0,0),(-1,-1),0.25,colors.HexColor("#E5E7EB")),
            ("ALIGN",(2,1),(2,-1),"CENTER")
        ]))
        story.append(att_tbl)
    else:
        story.append(Paragraph("No additional attachments.", body))
    story.append(Spacer(1,12))

    # ---- 10. Platform Disclaimer (MyHomeBro logo) ----
    story.append(Paragraph("Platform Disclaimer", h2))
    mhb_logo=_myhomebro_logo_path()
    if mhb_logo:
        try:
            from reportlab.platypus import Image as RLImage
            story.append(RLImage(mhb_logo,width=0.8*inch,height=0.8*inch))
            story.append(Spacer(1,6))
        except Exception: pass
    disclaimer=(
        "MyHomeBro is a neutral platform facilitating communication, e-signatures, and escrow-style payments between "
        "independent contractors and homeowners. MyHomeBro is not a general contractor, agent, or employer of either party "
        "and does not guarantee the quality, safety, or legality of services. All contracts are directly between Contractor "
        "and Homeowner. MyHomeBro’s role is limited to payment facilitation and recordkeeping through its escrow system. "
        "See the appended Terms of Service and Privacy Policy."
    )
    story.append(Paragraph(disclaimer, small))
    story.append(Spacer(1,10))

    # ---- 11. Signatures ----
    from reportlab.platypus import Image as RLImage, Table as RLTable, TableStyle as RLTableStyle, Spacer as RLSpacer
    story.append(PageBreak())
    story.append(Paragraph("Signatures", h2))
    c_img=_signature_path(getattr(ag,"contractor_signature",None))
    h_img=_signature_path(getattr(ag,"homeowner_signature",None))
    c_block,h_block=[],[]
    if c_img:
        try: c_block+=[RLImage(c_img,width=1.8*inch,height=0.6*inch),RLSpacer(1,3)]
        except Exception: pass
    if h_img:
        try: h_block+=[RLImage(h_img,width=1.8*inch,height=0.6*inch),RLSpacer(1,3)]
        except Exception: pass
    c_block+=[Paragraph(f"<b>Contractor:</b> {_s(getattr(ag,'contractor_signature_name',None))}",body),
              Paragraph(f"<b>Signed:</b> {_s(getattr(ag,'contractor_signed_at',None))}",small)]
    h_block+=[Paragraph(f"<b>Homeowner:</b> {_s(getattr(ag,'homeowner_signature_name',None))}",body),
              Paragraph(f"<b>Signed:</b> {_s(getattr(ag,'homeowner_signed_at',None))}",small)]
    sig_tbl=RLTable([[c_block,h_block]],colWidths=[3.5*inch,3.5*inch])
    sig_tbl.setStyle(RLTableStyle([("VALIGN",(0,0),(-1,-1),"TOP")]))
    story.append(sig_tbl)
    if is_preview:
        story.append(Spacer(1,6))
        story.append(Paragraph("This is a preview. Final version will include any updated signatures.", small))

    # ---- 12. Terms of Service (append full text) ----
    tos_text = _load_legal_text("terms_of_service.txt")
    if tos_text:
        story.append(PageBreak())
        story.append(Paragraph("Terms of Service", h2))
        for line in tos_text.splitlines():
            story.append(Paragraph(line.replace("  ", "&nbsp;&nbsp;"), mono if line.strip().startswith("-") else body))
        story.append(Spacer(1,8))

    # ---- 13. Privacy Policy (append full text) ----
    privacy_text = _load_legal_text("privacy_policy.txt")
    if privacy_text:
        story.append(PageBreak())
        story.append(Paragraph("Privacy Policy", h2))
        for line in privacy_text.splitlines():
            story.append(Paragraph(line.replace("  ", "&nbsp;&nbsp;"), mono if line.strip().startswith("-") else body))
        story.append(Spacer(1,8))

    # build
    def first(c,d):
        if is_preview: _watermark_preview(c)
        _header_footer(c,d)
    def later(c,d):
        if is_preview: _watermark_preview(c)
        _header_footer(c,d)
    doc.build(story,onFirstPage=first,onLaterPages=later)
    return buf.getvalue()


def generate_full_agreement_pdf(ag: Agreement, *, merge_attachments=True) -> str:
    """
    Build + save versioned PDF, append attached PDFs if any.
    """
    version=int(getattr(ag,"pdf_version",0) or 0)+1
    base=build_agreement_pdf_bytes(ag,is_preview=False)
    tmp=os.path.join(getattr(settings,"MEDIA_ROOT",""),"agreements","tmp")
    os.makedirs(tmp,exist_ok=True)
    base_path=os.path.join(tmp,f"agreement_{ag.id}_v{version}.pdf")
    with open(base_path,"wb") as f: f.write(base)
    final_path=base_path
    if merge_attachments and PdfMerger:
        try:
            atts=list(ag.attachments.all())
        except Exception: atts=[]
        pdfs=[getattr(a.file,"path",None) for a in atts if getattr(a.file,"path",None) and a.file.name.lower().endswith(".pdf")]
        if pdfs:
            try:
                merger=PdfMerger()
                merger.append(base_path)
                for p in pdfs: merger.append(p)
                merged=base_path.replace(".pdf","_merged.pdf")
                merger.write(merged); merger.close()
                final_path=merged
            except Exception:
                pass
    with open(final_path,"rb") as fh:
        content=ContentFile(fh.read())
        fname=f"agreement_{ag.id}_v{version}.pdf"
        ag.pdf_file.save(fname,content,save=True)
        if hasattr(ag,"pdf_version"):
            ag.pdf_version=version
            ag.save(update_fields=["pdf_version","pdf_file"])
    return ag.pdf_file.path
