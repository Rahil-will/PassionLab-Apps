"""Generate Prodigi client presentation PPTX from PRODUCT_PRESENTATION_MASTER.md content."""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

# Brand colours
INDIGO = RGBColor(0x1E, 0x3A, 0x8A)  # slate-900 / blue-900
BLUE = RGBColor(0x3B, 0x82, 0xF6)     # blue-500
SLATE = RGBColor(0x47, 0x55, 0x69)    # slate-600
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_BG = RGBColor(0xF8, 0xFA, 0xFC)


def set_slide_bg(slide, color: RGBColor) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_title_bar(slide, title: str, subtitle: str | None = None) -> None:
    bar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(10), Inches(1.15))
    bar.fill.solid()
    bar.fill.fore_color.rgb = INDIGO
    bar.line.fill.background()
    tf = bar.text_frame
    tf.text = title
    p = tf.paragraphs[0]
    p.font.size = Pt(28)
    p.font.bold = True
    p.font.color.rgb = WHITE
    if subtitle:
        p2 = tf.add_paragraph()
        p2.text = subtitle
        p2.font.size = Pt(14)
        p2.font.color.rgb = RGBColor(0xBF, 0xDB, 0xFE)


def add_bullets(slide, items: list[str], left=0.6, top=1.45, width=8.8, height=5.5, font_size=18):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.TOP
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = item
        p.level = 0
        p.font.size = Pt(font_size)
        p.font.color.rgb = SLATE
        p.space_after = Pt(10)
        if item.startswith("  "):
            p.level = 1
            p.text = item.strip()
            p.font.size = Pt(16)


def add_two_column(slide, left_title: str, left_items: list[str], right_title: str, right_items: list[str]):
    add_title_bar(slide, left_title if not right_title else f"{left_title}  |  {right_title}")
    # override - use single title approach
    slide.shapes._spTree.remove(slide.shapes[-1]._element)

    add_title_bar(slide, "Prodigi")

    lt = slide.shapes.add_textbox(Inches(0.5), Inches(1.35), Inches(4.5), Inches(0.4))
    lt.text_frame.text = left_title
    lt.text_frame.paragraphs[0].font.bold = True
    lt.text_frame.paragraphs[0].font.size = Pt(20)
    lt.text_frame.paragraphs[0].font.color.rgb = INDIGO

    rt = slide.shapes.add_textbox(Inches(5.2), Inches(1.35), Inches(4.5), Inches(0.4))
    rt.text_frame.text = right_title
    rt.text_frame.paragraphs[0].font.bold = True
    rt.text_frame.paragraphs[0].font.size = Pt(20)
    rt.text_frame.paragraphs[0].font.color.rgb = INDIGO

    add_bullets(slide, left_items, left=0.5, top=1.85, width=4.4, font_size=16)
    add_bullets(slide, right_items, left=5.2, top=1.85, width=4.4, font_size=16)


def add_speaker_notes(slide, notes: str) -> None:
    slide.notes_slide.notes_text_frame.text = notes


def title_slide(prs: Presentation, title: str, subtitle: str, tagline: str) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, INDIGO)
    t = slide.shapes.add_textbox(Inches(0.8), Inches(2.2), Inches(8.4), Inches(1.2))
    tf = t.text_frame
    tf.text = title
    p = tf.paragraphs[0]
    p.font.size = Pt(44)
    p.font.bold = True
    p.font.color.rgb = WHITE

    s = slide.shapes.add_textbox(Inches(0.8), Inches(3.5), Inches(8.4), Inches(0.8))
    s.text_frame.text = subtitle
    s.text_frame.paragraphs[0].font.size = Pt(22)
    s.text_frame.paragraphs[0].font.color.rgb = RGBColor(0xBF, 0xDB, 0xFE)

    g = slide.shapes.add_textbox(Inches(0.8), Inches(4.5), Inches(8.4), Inches(0.6))
    g.text_frame.text = tagline
    g.text_frame.paragraphs[0].font.size = Pt(16)
    g.text_frame.paragraphs[0].font.color.rgb = RGBColor(0x93, 0xC5, 0xFD)

    footer = slide.shapes.add_textbox(Inches(0.8), Inches(6.8), Inches(8), Inches(0.4))
    footer.text_frame.text = "Rajesh Bheda Consulting  ·  Confidential"
    footer.text_frame.paragraphs[0].font.size = Pt(11)
    footer.text_frame.paragraphs[0].font.color.rgb = RGBColor(0x60, 0xA5, 0xFA)


def content_slide(prs: Presentation, title: str, bullets: list[str], subtitle: str | None = None, notes: str | None = None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, title, subtitle)
    add_bullets(slide, bullets)
    if notes:
        add_speaker_notes(slide, notes)
    return slide


def hierarchy_slide(prs: Presentation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, LIGHT_BG)
    add_title_bar(slide, "Department Classification & Capture Architecture", "Four layers — read this before any app demo")

    tree = slide.shapes.add_textbox(Inches(0.55), Inches(1.4), Inches(5.2), Inches(5.6))
    tf = tree.text_frame
    tf.word_wrap = False
    lines = [
        "Work Center (Department)",
        "├── Origin  →  Cutting (Lay Report)",
        "├── Standard Production",
        "│     ├── Loading  →  Hourly Input",
        "│     └── Produce  →  Hourly | QC | Batch",
        "├── Store  →  Handover only",
        "├── Outsource  →  Vendor capture + 2-leg handover",
        "└── Terminal  →  Shipment / QA",
        "",
        "Every non-terminal department also gets:",
        "  • Transaction (handover)  • Audit (optional)",
        "  • Supervisory app (where entitled)",
    ]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        p.font.name = "Consolas"
        p.font.size = Pt(13 if line.startswith("  ") else 14)
        p.font.color.rgb = SLATE if not line.startswith("Work Center") else INDIGO
        if line.startswith("Work Center"):
            p.font.bold = True
            p.font.size = Pt(15)

    layers = slide.shapes.add_textbox(Inches(5.9), Inches(1.4), Inches(3.8), Inches(5.6))
    ltf = layers.text_frame
    layer_items = [
        ("Layer 1", "Department kind"),
        ("Layer 2", "Operation type (Loading, Produce…)"),
        ("Layer 3", "Capture method (Hourly, QC…)"),
        ("Layer 4", "Global capabilities (Handover, Audit)"),
    ]
    for i, (head, body) in enumerate(layer_items):
        p = ltf.paragraphs[0] if i == 0 else ltf.add_paragraph()
        p.text = f"{head}: {body}"
        p.font.size = Pt(15)
        p.font.color.rgb = INDIGO
        p.font.bold = True
        p.space_after = Pt(14)

    add_speaker_notes(
        slide,
        "Origin and Terminal are first-class department roles — not flags on Standard. "
        "Store and Outsource are planning_mode on role=standard.",
    )


def build_deck() -> Presentation:
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)

    title_slide(
        prs,
        "Prodigi",
        "Manufacturing Execution System for Garment Factories",
        "Know what is planned · what is happening on the floor · where every piece is",
    )

    content_slide(
        prs,
        "The Problem",
        [
            "Factories run on spreadsheets, paper challans, and end-of-day Excel",
            "No real-time visibility into WIP between departments",
            "Pieces \"appear\" in the next department without traceability",
            "Quality data lives in separate systems from production counts",
            "Management reports are built manually — always a day late",
            "Buyer audits fail WIP reconciliation",
        ],
        notes="Open with: Where are the 2,000 pieces between Cutting and Sewing?",
    )

    content_slide(
        prs,
        "What Prodigi Is",
        [
            "A production-first MES — not ERP, not PLM, not costing",
            "Tracks every piece through departments: in-house and outsourced",
            "Real-time floor capture on tablets + unified desktop planning & reports",
            "Multi-tenant SaaS — one platform, factory-scoped data isolation",
            "Single job: know what's planned, what's live, and where WIP is",
        ],
    )

    content_slide(
        prs,
        "The MES Engine — Three Rules",
        [
            "1. Output XOR QC",
            "  One active capture session per department + order: hourly/batch OR QC — never both",
            "2. Handover is mandatory",
            "  Pieces cannot appear in dept N+1 without a logged challan from dept N",
            "3. Audit is optional",
            "  AQL sampling never blocks production unless explicitly configured",
        ],
        subtitle="These rules define WIP integrity",
    )

    hierarchy_slide(prs)

    content_slide(
        prs,
        "Five Department Kinds",
        [
            "Origin (role=origin) — first visit; Cutting lay report",
            "Standard Production (role=standard, mode=production) — Loading + Produce ops",
            "Store (role=standard, mode=storage) — passive; handover + supervisor only",
            "Outsource (role=standard, mode=outsource) — vendor two-leg handover",
            "Terminal (role=terminal) — last visit; Shipment / QA capture",
        ],
        subtitle="Origin & Terminal are peer types — not special cases of Standard",
    )

    content_slide(
        prs,
        "Three Applications — One Database",
        [
            "Onboarding App (RBC only) — provision factories, entitlements, first admin",
            "Prodigi Web (desktop) — orders, planning, reports, work centers, users",
            "Prodigi Floor (mobile PWA) — hourly, handover, QC, audit, shipment capture",
            "Factory admin configures in Web → operators execute on Floor → reports close the loop",
        ],
    )

    content_slide(
        prs,
        "Platform Architecture",
        [
            "Platform (RBC / Supabase)",
            "  └── Factories (tenants — RLS isolated)",
            "        └── Departments / Work Centers",
            "              └── Lines (assigned resources)",
            "                    └── Users → Apps → Capture data → Reports",
            "Floor login: Factory ID + Employee ID + PIN",
            "Desktop login: email + password (factory admin)",
        ],
    )

    content_slide(
        prs,
        "Who Uses What",
        [
            "Factory Admin — Prodigi Web: configure, plan, report, manage users",
            "Supervisor — Floor: handover, workforce allocation, style KPIs",
            "Operator — Floor: hourly/batch/QC output on assigned operations",
            "QC / Auditor — Floor: piece-wise inspection or AQL audit",
            "Terminal Clerk — Floor: shipment log, rejection, buyer audit",
        ],
    )

    content_slide(
        prs,
        "Factory Lifecycle",
        [
            "1. RBC provisions factory + admin (Onboarding App)",
            "2. Admin configures shifts, departments, process flows, buyers",
            "3. Admin creates floor users — PIN, department, operation assignments",
            "4. Create orders → apply routing → line planning",
            "5. Floor capture → handover → reports → order completion / OTIF",
        ],
        subtitle="Time to first capture: days, not months",
    )

    content_slide(
        prs,
        "Hourly Production (Floor)",
        [
            "Operators log size-wise output by shift hour slot",
            "Linked to line allocation — planned style on a resource/line",
            "Balance cap: cannot exceed planned minus already produced",
            "3 taps from home screen to logging — designed for factory floor",
            "Feeds Day Report, Style Report, Dashboard efficiency trends",
        ],
        notes="Demo: log 50 pieces size M for hour 10–11; show in Day Report.",
    )

    content_slide(
        prs,
        "Handover — The WIP Spine",
        [
            "Mandatory digital challan between every department visit",
            "Send → Pending → Receive (or Dispute → Amend)",
            "Outsourced departments: two-leg handover (out-challan + return-challan)",
            "Next department blocked from capture until receive confirmed",
            "Transaction Report + Day Report show in-transit WIP and disputes",
        ],
        notes="This is Prodigi's moat — without handover, it's just another tally app.",
    )

    content_slide(
        prs,
        "Quality — QC Log & Audit",
        [
            "QC Log: piece-wise pass / fail / rework with defect codes",
            "Output XOR QC: hourly stops while QC session is active",
            "DHU and defect Pareto available same day in reports",
            "Audit (AQL): optional batch sampling — does not block flow",
            "Quality data on the same order route as production",
        ],
    )

    content_slide(
        prs,
        "Orders & Planning (Web)",
        [
            "Create Order — style, buyer, colorways, sizes, shipment plan",
            "Process flow templates → order routing (frozen per save)",
            "Production Planning — Gantt line allocations with SAM & daily targets",
            "Plan saved → styles appear immediately on operator floor hubs",
            "Dept. Schedule — cross-order Gantt for capacity view",
        ],
    )

    content_slide(
        prs,
        "End-to-End Workflow",
        [
            "Create Order → Routing → Line Planning",
            "→ Cutting (Lay Report) → Handover",
            "→ Sewing (Hourly) → QC (optional) → Handover",
            "→ Finishing / Washing / Packing → Handover",
            "→ Shipment Log → Order Completion → OTIF",
        ],
    )

    content_slide(
        prs,
        "Reports & Dashboard",
        [
            "Day Report — department output, handovers, efficiency by date",
            "Style Report — full colorway lifecycle, matrix, daily charts, OTIF",
            "Transaction Report — handover slip history and dispute status",
            "Dashboard — cut-to-ship funnel, fulfillment %, output & efficiency trends",
            "Same-day insight — no overnight Excel consolidation",
        ],
    )

    content_slide(
        prs,
        "Key KPIs",
        [
            "Hourly / Daily Output — pieces produced per hour and day",
            "Efficiency % — actual vs SAM-based target (workforce-adjusted)",
            "DHU — defects per hundred units inspected",
            "Handover Compliance — sends received vs pending / disputed",
            "Cut-to-Ship % — shipped qty vs cut qty",
            "OTIF — on-time in-full for closed colorways vs shipment plan",
        ],
    )

    content_slide(
        prs,
        "Benefits by Persona",
        [
            "Management — morning dashboard in 10 min; OTIF without merchandiser Excel",
            "Supervisors — hour-wise targets vs actual; dispute resolution on tablet",
            "Operators — clear daily assignment; simple PIN login; size balance caps",
            "Quality — DHU at source; defect Pareto same day",
            "Factory — WIP traceability; buyer audit readiness; scalable onboarding",
        ],
    )

    content_slide(
        prs,
        "Security & Multi-Tenancy",
        [
            "Every table filtered by factory_id via Supabase Row Level Security",
            "Floor PIN stored hashed; synthetic auth email — operators never use email login",
            "No self-service factory creation — RBC provisions via secure onboarding",
            "User CRUD via Edge Functions — admin JWT only",
            "UI route guards are UX; RLS + RPCs are the real security boundary",
        ],
    )

    content_slide(
        prs,
        "Technology Stack",
        [
            "Prodigi Web — Vite, React 19, TypeScript, TanStack Query, Tailwind",
            "Prodigi Floor — Next.js PWA (install to tablet home screen)",
            "Backend — Supabase Postgres, Auth, Edge Functions, RPC business logic",
            "Desktop read-cache offline; floor capture queue for intermittent connectivity",
        ],
    )

    content_slide(
        prs,
        "Roadmap",
        [
            "Near-term: Company/HQ multi-factory layer, desktop RBAC (planner/viewer)",
            "Buyer Portal — read-only WIP and OTIF for merchandisers",
            "AI Insights — anomaly detection on efficiency drops",
            "Predictive analytics — shipment delay alerts before dates slip",
            "Machine / IoT integration — automated count verification",
        ],
    )

    content_slide(
        prs,
        "Why Prodigi Wins",
        [
            "Handover spine — mandatory WIP integrity, not optional challans",
            "Output XOR QC — one truth per department; no conflicting numbers",
            "Four-layer capture model — configure once, floor apps derive correctly",
            "Production-first — built for garment piece-flow, not generic ERP",
            "Consulting + software — RBC implements process design with the system",
        ],
    )

    # CTA slide
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_slide_bg(slide, INDIGO)
    t = slide.shapes.add_textbox(Inches(0.8), Inches(2.4), Inches(8.4), Inches(1))
    t.text_frame.text = "Next Steps"
    t.text_frame.paragraphs[0].font.size = Pt(40)
    t.text_frame.paragraphs[0].font.bold = True
    t.text_frame.paragraphs[0].font.color.rgb = WHITE

    bullets = slide.shapes.add_textbox(Inches(1.2), Inches(3.6), Inches(7.6), Inches(2.5))
    tf = bullets.text_frame
    for i, line in enumerate([
        "Pilot factory — 4-week implementation to first live capture",
        "Live demo — order creation through floor capture to Day Report",
        "Contact RBC for factory provisioning and training",
    ]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = f"•  {line}"
        p.font.size = Pt(20)
        p.font.color.rgb = RGBColor(0xBF, 0xDB, 0xFE)
        p.space_after = Pt(16)

    add_speaker_notes(slide, "Thank you. Q&A.")

    return prs


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "PRODIGI_Client_Presentation.pptx"
    prs = build_deck()
    prs.save(str(out))
    print(f"Saved {out} ({len(prs.slides)} slides)")


if __name__ == "__main__":
    main()
