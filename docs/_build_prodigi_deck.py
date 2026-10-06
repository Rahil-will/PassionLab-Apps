"""Build the Prodigi product presentation (17 slides) via PowerPoint COM.

Editorial / photographic design system.
Run:  uvx --from ppt-mcp python docs/_build_prodigi_deck.py
"""
from __future__ import annotations

import os
import sys

import win32com.client as win32

DOCS = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(DOCS, "Prodigi_Product_Presentation.pptx")
ASSETS = r"C:\Users\Rahil\.cursor\projects\c-Users-Rahil-Downloads-PRODIGI\assets"

IMG_TEXTURE = os.path.join(ASSETS, "deck_dark_texture.png")
IMG_SEWING = os.path.join(ASSETS, "deck_sewing_line.png")
IMG_CUTTING = os.path.join(ASSETS, "deck_cutting_table.png")
IMG_TABLET = os.path.join(ASSETS, "deck_floor_tablet.png")
IMG_BUNDLES = os.path.join(ASSETS, "deck_wip_bundles.png")
IMG_DOCK = os.path.join(ASSETS, "deck_shipping_dock.png")

# ── Design tokens ──────────────────────────────────────────────────────────
INK = 0x0F131B
INK8 = 0x1F242F
INK7 = 0x333947
INK6 = 0x4A5160
INK5 = 0x6C7383
INK4 = 0x9AA1AE
INK3 = 0xC2C8D2
INK2 = 0xDDE1E8
INK1 = 0xEEF0F4
INK05 = 0xF7F8FA
WHITE = 0xFFFFFF
BRAND = 0x1F5EFF
BRAND3 = 0x80A8FF
BRAND9 = 0x081A4D

FONT = "Segoe UI"
FONT_L = "Segoe UI Light"

W, H = 960.0, 540.0
M = 64.0          # left margin
CW = 832.0        # content width

# COM constants
msoFalse, msoTrue = 0, -1
msoAnchorTop, msoAnchorMiddle = 1, 3
ppAlignLeft, ppAlignCenter, ppAlignRight = 1, 2, 3
ppLayoutBlank = 12
SH_RECT, SH_ROUND, SH_OVAL, SH_RARROW = 1, 5, 9, 33
msoTextOrientationHorizontal = 1


def rgb(hexint: int) -> int:
    r, g, b = (hexint >> 16) & 0xFF, (hexint >> 8) & 0xFF, hexint & 0xFF
    return r + (g << 8) + (b << 16)


# ── primitives ─────────────────────────────────────────────────────────────
def clear(slide) -> None:
    for i in range(slide.Shapes.Count, 0, -1):
        slide.Shapes(i).Delete()


def bg(slide, color: int) -> None:
    slide.FollowMasterBackground = msoFalse
    slide.Background.Fill.Solid()
    slide.Background.Fill.ForeColor.RGB = rgb(color)


def rect(slide, l, t, w, h, fill, transparency: float | None = None):
    if w <= 0 or h <= 0:
        return None
    s = slide.Shapes.AddShape(SH_RECT, l, t, w, h)
    s.Fill.Solid()
    s.Fill.ForeColor.RGB = rgb(fill)
    if transparency is not None:
        s.Fill.Transparency = transparency
    s.Line.Visible = msoFalse
    s.Shadow.Visible = msoFalse
    return s


def round_rect(slide, l, t, w, h, fill, radius_pt: float = 10.0, line: int | None = None):
    s = slide.Shapes.AddShape(SH_ROUND, l, t, w, h)
    try:
        s.Adjustments[1] = min(radius_pt / min(w, h) * 2, 1.0) * 0.5
    except Exception:
        pass
    s.Fill.Solid()
    s.Fill.ForeColor.RGB = rgb(fill)
    if line is None:
        s.Line.Visible = msoFalse
    else:
        s.Line.Visible = msoTrue
        s.Line.ForeColor.RGB = rgb(line)
        s.Line.Weight = 1.0
    s.Shadow.Visible = msoFalse
    return s


def oval(slide, l, t, w, h, fill):
    s = slide.Shapes.AddShape(SH_OVAL, l, t, w, h)
    s.Fill.Solid()
    s.Fill.ForeColor.RGB = rgb(fill)
    s.Line.Visible = msoFalse
    s.Shadow.Visible = msoFalse
    return s


def arrow(slide, l, t, w, h, fill):
    s = slide.Shapes.AddShape(SH_RARROW, l, t, w, h)
    s.Fill.Solid()
    s.Fill.ForeColor.RGB = rgb(fill)
    s.Line.Visible = msoFalse
    s.Shadow.Visible = msoFalse
    return s


def tx(
    slide,
    l,
    t,
    w,
    h,
    text,
    size,
    color,
    bold=False,
    align="left",
    anchor="top",
    font=FONT,
    spacing=None,
    line_spacing=None,
):
    s = slide.Shapes.AddTextbox(msoTextOrientationHorizontal, l, t, w, h)
    s.Line.Visible = msoFalse
    s.Fill.Visible = msoFalse
    s.Shadow.Visible = msoFalse
    tf = s.TextFrame
    tf.WordWrap = msoTrue
    tf.AutoSize = 0
    tf.MarginLeft = tf.MarginRight = 0
    tf.MarginTop = tf.MarginBottom = 0
    tf.VerticalAnchor = msoAnchorMiddle if anchor == "middle" else msoAnchorTop
    r = tf.TextRange
    r.Text = text
    r.Font.Name = font
    r.Font.NameFarEast = font
    r.Font.Size = size
    r.Font.Bold = msoTrue if bold else msoFalse
    r.Font.Color.RGB = rgb(color)
    r.ParagraphFormat.Alignment = {"left": ppAlignLeft, "center": ppAlignCenter, "right": ppAlignRight}[align]
    r.ParagraphFormat.SpaceBefore = 0
    r.ParagraphFormat.SpaceAfter = 0
    if spacing is not None:
        try:
            r.Font.Spacing = spacing
        except Exception:
            pass
    if line_spacing is not None:
        try:
            r.ParagraphFormat.LineRuleWithin = msoTrue
            r.ParagraphFormat.SpaceWithin = line_spacing
        except Exception:
            pass
    return s


def image_cover(slide, path, l, t, w, h, mask_bg: int | None = None):
    """Insert picture scaled to cover the box, centred; mask the overflow."""
    pic = slide.Shapes.AddPicture(path, msoFalse, msoTrue, 0, 0)
    pic.LockAspectRatio = msoTrue
    nw, nh = float(pic.Width), float(pic.Height)
    scale = max(w / nw, h / nh)
    pic.Width = nw * scale
    pic.Left = l + (w - float(pic.Width)) / 2.0
    pic.Top = t + (h - float(pic.Height)) / 2.0
    if mask_bg is not None:
        rect(slide, -400, -400, 400 + l, H + 800, mask_bg)
        rect(slide, l + w, -400, W + 400 - (l + w), H + 800, mask_bg)
        rect(slide, l, -400, w, 400 + t, mask_bg)
        rect(slide, l, t + h, w, H + 400 - (t + h), mask_bg)
    return pic


def scrim(slide, l, t, w, h, color=INK, transparency=0.45):
    rect(slide, l, t, w, h, color, transparency)


def scrim_fade(slide, l, t, w, h, color=INK, a_from=0.15, a_to=1.0, steps=30):
    """Scrim that fades left to right. True gradient where available, stepped otherwise."""
    s = slide.Shapes.AddShape(SH_RECT, l, t, w, h)
    s.Line.Visible = msoFalse
    s.Shadow.Visible = msoFalse
    try:
        f = s.Fill
        f.TwoColorGradient(1, 1)
        f.GradientAngle = 0
        f.GradientStops(1).Color.RGB = rgb(color)
        f.GradientStops(1).Transparency = a_from
        f.GradientStops(2).Color.RGB = rgb(color)
        f.GradientStops(2).Transparency = a_to
        return s
    except Exception:
        s.Delete()
    sw = w / steps
    for i in range(steps):
        a = a_from + (a_to - a_from) * (i / (steps - 1))
        rect(slide, l + i * sw, t, sw + 0.8, h, color, a)
    return None


# ── slide chrome ───────────────────────────────────────────────────────────
def rail(slide, dark=False):
    rect(slide, 0, 0, 6, H, BRAND)


def eyebrow(slide, text, dark=False, y=52):
    tx(slide, M, y, 600, 16, text.upper(), 11.5, BRAND3 if dark else BRAND, True, spacing=2.4)


def foot(slide, n, dark=False):
    c = INK5 if not dark else INK6
    rect(slide, M, 498, CW, 1, INK2 if not dark else 0x252B36)
    tx(slide, M, 508, 300, 16, "PRODIGI", 10.5, c, True, spacing=2.0)
    tx(slide, M + CW - 200, 508, 200, 16, f"{n:02d} / 17", 10.5, c, False, "right")


def headline(slide, y, text, size=40, color=INK, w=CW, x=M):
    return tx(slide, x, y, w, 130, text, size, color, True, line_spacing=0.94)


def deck(slide, y, text, color=INK5, w=CW, x=M, size=17.5):
    return tx(slide, x, y, w, 60, text, size, color, False, line_spacing=1.1)


def rule(slide, x, y, w, color=BRAND, h=3.0):
    rect(slide, x, y, w, h, color)


# ═══════════════════════════════════════════════════════════════════════════
# 01 — Title
# ═══════════════════════════════════════════════════════════════════════════
def s01(s):
    bg(s, INK)
    image_cover(s, IMG_TEXTURE, 0, 0, W, H)
    scrim(s, 0, 0, W, H, INK, 0.30)
    rect(s, 0, 0, 6, H, BRAND)

    tx(s, M, 56, 500, 16, "RAJESH BHEDA CONSULTING", 11.5, BRAND3, True, spacing=2.6)
    tx(s, M, 150, 700, 96, "Prodigi", 72, WHITE, True, font=FONT)
    rule(s, M, 262, 96)
    tx(
        s,
        M,
        296,
        620,
        90,
        "Plan the making.\nCapture the making.\nKnow the making.",
        26,
        INK2,
        False,
        line_spacing=1.25,
    )

    beats = [
        ("Plan", "lines · dates · targets"),
        ("Capture", "hourly · QC · batch · cutting"),
        ("Know", "same-day production truth"),
    ]
    for i, (h, sub) in enumerate(beats):
        x = 560
        y = 168 + i * 78
        rect(s, x, y + 4, 2, 46, BRAND)
        tx(s, x + 18, y, 320, 26, h, 17, WHITE, True)
        tx(s, x + 18, y + 26, 320, 24, sub, 13, INK4, False)

    tx(s, M, 470, 400, 18, "Product presentation", 12, INK5, False)
    tx(s, M + CW - 200, 470, 200, 18, "01 / 17", 12, INK5, False, "right")


# ═══════════════════════════════════════════════════════════════════════════
# 02 — Problem (full-bleed photo)
# ═══════════════════════════════════════════════════════════════════════════
def s02(s):
    bg(s, INK)
    image_cover(s, IMG_SEWING, 0, 0, W, H)
    scrim(s, 0, 0, W, H, INK, 0.40)
    scrim_fade(s, 0, 0, 660, H, INK, 0.18, 1.0)
    rect(s, 0, 0, 6, H, BRAND)

    eyebrow(s, "The problem", dark=True)
    headline(s, 96, "The factory knows\nthe plan.\nIt cannot see\nthe making.", 40, WHITE, w=500)
    rule(s, M, 316, 72)

    qs = [
        "What was actually produced yesterday?",
        "Where is the WIP right now?",
        "What left — and what came back?",
        "Will this order ship on time?",
    ]
    for i, q in enumerate(qs):
        y = 348 + i * 34
        tx(s, M, y, 470, 26, q, 15.5, INK2, False)

    foot(s, 2, dark=True)


# ═══════════════════════════════════════════════════════════════════════════
# 03 — Why the gap exists
# ═══════════════════════════════════════════════════════════════════════════
def s03(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "Why the gap exists")
    headline(s, 82, "The systems exist.\nProduction is still disconnected.", 38)
    deck(s, 176, "ERP owns the money. PLM owns development. The floor still owns spreadsheets.")

    cols = [
        ("ERP", "Orders · finance\nPayroll · materials"),
        ("PLM", "Tech packs · BOM\nDevelopment"),
        ("Excel & paper", "The actual\nproduction floor"),
    ]
    for i, (h, b) in enumerate(cols):
        x = M + i * 285
        w = 261
        rect(s, x, 232, w, 3, INK3)
        tx(s, x, 250, w, 30, h, 21, INK, True)
        tx(s, x, 284, w, 60, b, 15, INK5, False, line_spacing=1.2)

    round_rect(s, M, 366, CW, 116, INK, 12)
    rect(s, M, 366, 4, 116, BRAND)
    tx(s, M + 28, 386, 300, 18, "THE GAP", 11.5, BRAND3, True, spacing=2.4)
    tx(s, M + 28, 408, 430, 30, "Nobody owns production\nas a system.", 22, WHITE, True, line_spacing=1.05)
    rect(s, M + 486, 392, 1, 64, 0x2A3040)
    tx(
        s,
        M + 512,
        392,
        296,
        70,
        "Prodigi is that layer. It plans the making, captures the making, and feeds the ERP — it never replaces it.",
        13.5,
        INK3,
        False,
        line_spacing=1.25,
    )
    foot(s, 3)


# ═══════════════════════════════════════════════════════════════════════════
# 04 — Three different numbers
# ═══════════════════════════════════════════════════════════════════════════
def s04(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "The consequence")
    headline(s, 82, "Planned, produced and shipped\nare three different numbers.", 38)
    deck(
        s,
        176,
        "Management reconciles them after the fact. The floor cannot steer with them in the moment.",
    )

    cards = [("PLANNED", "the order"), ("PRODUCED", "the floor"), ("SHIPPED", "the carton")]
    for i, (h, b) in enumerate(cards):
        x = M + i * 296
        round_rect(s, x, 240, 240, 148, INK05, 12)
        rect(s, x, 240, 240, 3, BRAND)
        tx(s, x + 22, 264, 200, 20, h, 11.5, BRAND, True, spacing=2.2)
        tx(s, x + 22, 296, 200, 44, b, 27, INK, True)
        tx(s, x + 22, 344, 200, 24, "counted separately", 12.5, INK4, False)
        if i < 2:
            tx(s, x + 240, 292, 56, 44, "≠", 30, INK3, True, "center", "middle")

    rect(s, M, 424, 4, 44, BRAND)
    tx(
        s,
        M + 22,
        424,
        760,
        44,
        "Until these three share one spine, on-time shipment is an argument — not a fact.",
        17,
        INK7,
        False,
        anchor="middle",
    )
    foot(s, 4)


# ═══════════════════════════════════════════════════════════════════════════
# 05 — Introducing Prodigi
# ═══════════════════════════════════════════════════════════════════════════
def s05(s):
    bg(s, WHITE)
    image_cover(s, IMG_SEWING, 520, 0, 440, H, mask_bg=WHITE)
    scrim(s, 520, 0, 440, H, INK, 0.30)
    rail(s)

    eyebrow(s, "Introducing Prodigi")
    headline(s, 86, "Prodigi is the\nproduction layer\nfor the garment\nfactory.", 36, INK, w=420)
    rule(s, M, 268, 72)

    beats = [
        ("Plan", "Colorways onto lines and dates. One route. A real target."),
        ("Capture", "Hourly, QC, batch or cutting — as the operation works."),
        ("Know", "Day, style and factory views from the same actuals."),
    ]
    for i, (h, b) in enumerate(beats):
        y = 298 + i * 62
        tx(s, M, y, 110, 22, h, 16, INK, True)
        tx(s, M + 96, y, 330, 44, b, 13.5, INK5, False, line_spacing=1.15)

    tx(
        s,
        556,
        398,
        372,
        70,
        "It feeds the ERP.\nIt never replaces it.",
        22,
        WHITE,
        True,
        line_spacing=1.15,
    )
    foot(s, 5)


# ═══════════════════════════════════════════════════════════════════════════
# 06 — The loop
# ═══════════════════════════════════════════════════════════════════════════
def s06(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "The system")
    headline(s, 82, "Plan goes to the floor.\nThe floor comes back as insight.", 38)

    nodes = [
        ("Configure", "departments\nflows · users"),
        ("Plan", "lines · dates\nrouting"),
        ("Capture", "output\n+ people"),
        ("Handover", "WIP\nmovement"),
        ("Report", "day · style\ndashboard"),
    ]
    top, h = 232, 140
    for i, (t_, b) in enumerate(nodes):
        x = M + i * 170
        w = 150
        round_rect(s, x, top, w, h, INK05, 10)
        rect(s, x, top, w, 3, BRAND)
        tx(s, x + 14, top + 22, w - 28, 24, f"{i+1:02d}", 12, INK3, True)
        tx(s, x + 14, top + 48, w - 28, 26, t_, 17, INK, True)
        tx(s, x + 14, top + 78, w - 28, 46, b, 12.5, INK5, False, line_spacing=1.15)
        if i < 4:
            arrow(s, x + w + 3, top + h / 2 - 5, 14, 10, INK3)

    rect(s, M, 412, CW, 1, INK2)
    tx(
        s,
        M,
        428,
        560,
        48,
        "Nothing important sits outside this loop.",
        19,
        INK,
        True,
    )
    tx(
        s,
        M + 570,
        428,
        262,
        48,
        "That is what makes Prodigi a system\nrather than a set of tools.",
        13,
        INK5,
        False,
        line_spacing=1.2,
    )
    foot(s, 6)


# ═══════════════════════════════════════════════════════════════════════════
# 07 — Follow one order
# ═══════════════════════════════════════════════════════════════════════════
def s07(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "One order")
    headline(s, 82, "Follow one order through the factory.", 38)
    deck(s, 138, "One record. One route. One trail of actuals.")

    stops = [
        ("Order", "sizes live"),
        ("Cut", "lay & qty"),
        ("Print", "outsourced"),
        ("Sew", "hourly / QC"),
        ("Pack", "handed on"),
        ("Ship", "fulfilled"),
    ]
    y = 262
    rect(s, 110, y, 740, 2, INK2)
    for i, (t_, b) in enumerate(stops):
        cx = 110 + i * 148
        rect(s, cx - 70, 196, 140, 0, WHITE)
        oval(s, cx - 7, y - 6, 14, 14, BRAND if i == 0 else INK3)
        tx(s, cx - 70, 204, 140, 24, t_, 18, INK, True, "center")
        tx(s, cx - 70, 230, 140, 20, b, 12.5, INK4, False, "center")

    qs = [
        ("At cutting", "What was actually cut?"),
        ("At sewing", "What was produced — and how fast?"),
        ("At handover", "What left? What arrived?"),
        ("At shipment", "Will it go out on time?"),
    ]
    for i, (h, b) in enumerate(qs):
        x = M + i * 210
        w = 196
        rect(s, x, 330, 24, 2, BRAND)
        tx(s, x, 344, w, 20, h, 11.5, BRAND, True, spacing=1.8)
        tx(s, x, 366, w, 60, b, 15, INK7, False, line_spacing=1.2)
    foot(s, 7)


# ═══════════════════════════════════════════════════════════════════════════
# 08 — Plan
# ═══════════════════════════════════════════════════════════════════════════
def s08(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "Plan")
    headline(s, 82, "The plan becomes\nwork on the line.", 38, w=420)
    deck(
        s,
        188,
        "Who makes what, where, and when — with a target the floor can be measured against.",
        w=400,
    )

    pts = [
        ("Route locked to the order", "Applied once, then frozen. History never rewrites itself."),
        ("Colorways on lines and dates", "Every colour allocated to a resource across a real calendar."),
        ("Targets from SAM and people", "Planned, then compared against what was actually made."),
    ]
    for i, (h, b) in enumerate(pts):
        y = 274 + i * 66
        tx(s, M, y, 30, 22, f"{i+1}", 15, BRAND, True)
        tx(s, M + 26, y, 380, 22, h, 15.5, INK, True)
        tx(s, M + 26, y + 24, 380, 36, b, 13, INK5, False, line_spacing=1.15)

    # Drawn planning board (not a fake screenshot)
    px, py, pw, ph = 520, 172, 376, 286
    round_rect(s, px, py, pw, ph, INK05, 12)
    tx(s, px + 20, py + 18, 240, 18, "LINE PLAN", 10.5, INK4, True, spacing=2.0)
    for d in range(6):
        tx(s, px + 116 + d * 40, py + 18, 40, 16, f"D{d+1}", 9.5, INK3, False, "center")
    rows = [
        ("Cutting", 0, 2),
        ("Sewing L1", 1, 3),
        ("Sewing L2", 2, 3),
        ("Finishing", 3, 2),
        ("Packing", 4, 2),
    ]
    for i, (name, off, span) in enumerate(rows):
        ry = py + 52 + i * 44
        rect(s, px + 20, ry + 26, pw - 40, 1, INK2)
        tx(s, px + 20, ry, 96, 18, name, 11.5, INK7, False)
        bx = px + 116 + off * 40
        rect(s, bx, ry + 2, span * 40 - 6, 16, BRAND if i in (1, 2) else INK3)
    foot(s, 8)


# ═══════════════════════════════════════════════════════════════════════════
# 09 — Floor (photo left)
# ═══════════════════════════════════════════════════════════════════════════
def s09(s):
    bg(s, WHITE)
    image_cover(s, IMG_TABLET, 0, 0, 452, H, mask_bg=WHITE)
    scrim(s, 0, 0, 452, H, INK, 0.20)

    x = 500
    eyebrow(s, "Run", y=52)
    s.Shapes(s.Shapes.Count).Left = x  # move eyebrow to the right column
    headline(s, 84, "The floor sees only\nthe work assigned\nto it.", 34, INK, w=400, x=x)
    deck(s, 202, "PIN login. Today's allocations. Not the entire factory.", w=400, x=x, size=15)

    roles = [
        ("Operator", "Production tiles for the operations they are granted."),
        ("Supervisor", "Handover and workforce — the line, not a catalogue."),
        ("QA / terminal", "Shipment and rejection. Closes the order."),
    ]
    for i, (h, b) in enumerate(roles):
        y = 262 + i * 66
        rect(s, x, y + 2, 2, 46, BRAND)
        tx(s, x + 16, y, 200, 22, h, 15, INK, True)
        tx(s, x + 16, y + 22, 380, 44, b, 13, INK5, False, line_spacing=1.15)

    tx(
        s,
        x,
        468,
        400,
        44,
        "Composed from the person, the department, and the factory's entitlements.",
        12.5,
        INK4,
        False,
        line_spacing=1.2,
    )
    tx(s, x + 300, 508, 100, 16, "09 / 17", 10.5, INK5, False, "right")


# ═══════════════════════════════════════════════════════════════════════════
# 10 — Capture (photo band)
# ═══════════════════════════════════════════════════════════════════════════
def s10(s):
    bg(s, WHITE)
    image_cover(s, IMG_CUTTING, 0, 0, W, 168, mask_bg=WHITE)
    scrim(s, 0, 0, W, 168, INK, 0.52)
    rect(s, 0, 0, 6, 168, BRAND)

    tx(s, M, 40, 600, 16, "CAPTURE", 11.5, BRAND3, True, spacing=2.4)
    tx(s, M, 66, 760, 70, "Capture production the way\nthe operation actually works.", 30, WHITE, True, line_spacing=1.05)

    modes = [
        ("Hourly", "Sewing, finishing, packing.\nSize-wise, hour by hour."),
        ("QC", "Piece-wise pass, fail, rework.\nDefects caught at source."),
        ("Batch", "Washing, curing, ovens.\nOne count per batch."),
        ("Cutting", "Lay, plies, size quantities.\nWhere the count is born."),
    ]
    for i, (h, b) in enumerate(modes):
        x = M + i * 210
        w = 196
        round_rect(s, x, 200, w, 132, INK05, 10)
        rect(s, x, 200, w, 3, BRAND)
        tx(s, x + 16, 222, w - 32, 26, h, 18, INK, True)
        tx(s, x + 16, 252, w - 32, 64, b, 12.5, INK5, False, line_spacing=1.2)

    notes = [
        ("One truth at a time", "Output or QC — never both at once on the same department and order."),
        ("Efficiency needs people", "Headcount is logged on the same allocation as the output."),
    ]
    for i, (h, b) in enumerate(notes):
        x = M + i * 424
        rect(s, x, 366, 2, 60, BRAND)
        tx(s, x + 18, 364, 380, 22, h, 15, INK, True)
        tx(s, x + 18, 388, 380, 44, b, 13, INK5, False, line_spacing=1.15)
    foot(s, 10)


# ═══════════════════════════════════════════════════════════════════════════
# 11 — Handover (photo left)
# ═══════════════════════════════════════════════════════════════════════════
def s11(s):
    bg(s, WHITE)
    image_cover(s, IMG_BUNDLES, 0, 0, 430, H, mask_bg=WHITE)
    scrim(s, 0, 0, 430, H, INK, 0.22)

    x = 478
    tx(s, x, 52, 400, 16, "HANDOVER", 11.5, BRAND, True, spacing=2.4)
    headline(s, 82, "Every movement of WIP\nleaves a digital trail.", 30, INK, w=430, x=x)
    tx(
        s,
        x,
        158,
        420,
        44,
        "Pieces cannot appear downstream unless the previous department handed them over.",
        13.5,
        INK5,
        False,
        line_spacing=1.2,
    )

    states = [
        ("Pending", "Sent. Awaiting receipt."),
        ("Received", "Counts match."),
        ("Disputed", "What arrived differs."),
        ("Closed", "Loss owned, remarked, resolved."),
    ]
    for i, (h, b) in enumerate(states):
        y = 218 + i * 52
        oval(s, x, y + 5, 10, 10, BRAND)
        if i < 3:
            rect(s, x + 4, y + 15, 2, 42, INK2)
        tx(s, x + 24, y, 140, 20, h, 14.5, INK, True)
        tx(s, x + 150, y, 280, 20, b, 13, INK5, False)

    round_rect(s, x, 428, 430, 58, INK, 10)
    tx(s, x + 18, 438, 400, 16, "ON THE CHALLAN", 10, BRAND3, True, spacing=2.0)
    tx(
        s,
        x + 18,
        456,
        400,
        22,
        "From → to · order & colour · qty by size · who, and when",
        12.5,
        WHITE,
        False,
    )
    tx(s, x + 330, 508, 100, 16, "11 / 17", 10.5, INK5, False, "right")


# ═══════════════════════════════════════════════════════════════════════════
# 12 — Outsource
# ═══════════════════════════════════════════════════════════════════════════
def s12(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "Outsource")
    headline(s, 82, "Outsourced work never\ndisappears from the picture.", 38)
    deck(s, 176, "Printing, washing, embroidery — still on the order, still reconcilable.")

    boxes = [
        ("In-house", "Raises the out-challan"),
        ("Vendor", "Work happens off-site"),
        ("Return", "Return-challan comes back"),
        ("Next step", "Receives into the flow"),
    ]
    top, h = 250, 126
    for i, (t_, b) in enumerate(boxes):
        x = M + i * 210
        w = 196
        fill = INK if i == 1 else INK05
        round_rect(s, x, top, w, h, fill, 10)
        rect(s, x, top, w, 3, BRAND)
        tx(s, x + 16, top + 24, w - 32, 26, t_, 17, WHITE if i == 1 else INK, True)
        tx(s, x + 16, top + 56, w - 32, 50, b, 12.5, INK3 if i == 1 else INK5, False, line_spacing=1.2)
        if i < 3:
            arrow(s, x + w + 3, top + h / 2 - 5, 14, 10, INK3)

    rect(s, M, top + h + 22, 2, 44, BRAND)
    tx(
        s,
        M + 20,
        top + h + 18,
        760,
        50,
        "Both legs are challans. The pieces never leave the system — even while they leave the building.",
        16.5,
        INK7,
        False,
        anchor="middle",
    )
    foot(s, 12)


# ═══════════════════════════════════════════════════════════════════════════
# 13 — Reports
# ═══════════════════════════════════════════════════════════════════════════
def s13(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "Measure")
    headline(s, 82, "Production becomes management\ninsight on the same day.", 38)

    # Day lens
    round_rect(s, M, 196, 404, 258, INK05, 12)
    rect(s, M, 196, 404, 3, BRAND)
    tx(s, M + 24, 218, 340, 18, "DAY · TIME", 10.5, BRAND, True, spacing=2.2)
    tx(s, M + 24, 242, 340, 34, "How did the factory run?", 21, INK, True)
    for i, t_ in enumerate(
        [
            "Department output for any date range",
            "Handovers sent, received, disputed",
            "Efficiency from output and workforce",
            "The morning review, already compiled",
        ]
    ):
        tx(s, M + 24, 288 + i * 34, 356, 26, t_, 13.5, INK6, False)

    # Style lens
    x2 = M + 428
    round_rect(s, x2, 196, 404, 258, INK, 12)
    rect(s, x2, 196, 404, 3, BRAND)
    tx(s, x2 + 24, 218, 340, 18, "STYLE · ORDER", 10.5, BRAND3, True, spacing=2.2)
    tx(s, x2 + 24, 242, 340, 34, "How is this order moving?", 21, WHITE, True)
    for i, t_ in enumerate(
        [
            "Production matrix across the route",
            "Daily output trend per department",
            "Cut-to-ship and fulfillment",
            "The handover journey, end to end",
        ]
    ):
        tx(s, x2 + 24, 288 + i * 34, 356, 26, t_, 13.5, INK3, False)

    tx(
        s,
        M,
        466,
        CW,
        24,
        "Same actuals. Two lenses. No overnight batch.",
        14,
        INK5,
        False,
    )
    foot(s, 13)


# ═══════════════════════════════════════════════════════════════════════════
# 14 — Act (dark)
# ═══════════════════════════════════════════════════════════════════════════
def s14(s):
    bg(s, INK)
    image_cover(s, IMG_TEXTURE, 0, 0, W, H)
    scrim(s, 0, 0, W, H, INK, 0.25)
    rect(s, 0, 0, 6, H, BRAND)

    eyebrow(s, "Act", dark=True)
    headline(s, 84, "The factory can see the risk\nbefore the order is late.", 36, WHITE)

    kpis = [
        ("Output", "against the plan"),
        ("Efficiency", "output vs people & time"),
        ("Floor WIP", "pieces on the floor now"),
        ("Active orders", "in production"),
        ("Order → Ship", "shipped vs ordered"),
    ]
    for i, (h, b) in enumerate(kpis):
        x = M + i * 170
        w = 150
        round_rect(s, x, 226, w, 116, INK8, 10)
        rect(s, x, 226, w, 3, BRAND)
        tx(s, x + 14, 248, w - 28, 40, h, 15, WHITE, True)
        tx(s, x + 14, 292, w - 28, 40, b, 12, INK4, False, line_spacing=1.15)

    rect(s, M, 382, 2, 60, BRAND)
    tx(s, M + 20, 378, 470, 26, "Then the list that actually matters", 17, WHITE, True)
    tx(
        s,
        M + 20,
        404,
        470,
        44,
        "Orders with balance still to ship — drill into the day, the style, or the floor.",
        13.5,
        INK3,
        False,
        line_spacing=1.2,
    )
    tx(
        s,
        M + 540,
        378,
        292,
        70,
        "Every number on this screen traces back\nto a tap on the floor.",
        13.5,
        INK4,
        False,
        line_spacing=1.25,
    )
    foot(s, 14, dark=True)


# ═══════════════════════════════════════════════════════════════════════════
# 15 — Trust
# ═══════════════════════════════════════════════════════════════════════════
def s15(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "Trust")
    headline(s, 80, "The numbers can be trusted because\nthe factory cannot skip the truth.", 34)

    rules = [
        ("One truth at a time", "A department cannot count the same work as hourly output and as QC."),
        ("You cannot produce what has not arrived", "Downstream capture waits on handover. Cutting is where the count is born."),
        ("Every gap has an owner", "A disputed challan closes as acknowledged loss, not a quiet correction."),
        ("History does not rewrite", "The route is locked onto the order the moment planning applies it."),
        ("Efficiency needs people", "Headcount is captured against the same allocation as the output."),
    ]
    for i, (h, b) in enumerate(rules):
        y = 176 + i * 62
        tx(s, M, y - 4, 44, 30, f"{i+1:02d}", 19, INK2, True)
        tx(s, M + 46, y, 372, 22, h, 15.5, INK, True)
        tx(s, M + 428, y, 380, 44, b, 12.5, INK5, False, line_spacing=1.2)
        if i < 4:
            rect(s, M + 46, y + 44, CW - 46, 1, INK1)

    tx(
        s,
        M,
        486,
        CW,
        24,
        "Each factory's data is isolated · floor PINs are stored hashed · new factories are provisioned by RBC, never self-signup",
        11.5,
        INK4,
        False,
    )
    rect(s, M, 476, CW, 1, INK2)
    tx(s, M + CW - 200, 508, 200, 16, "15 / 17", 10.5, INK5, False, "right")
    tx(s, M, 508, 300, 16, "PRODIGI", 10.5, INK5, True, spacing=2.0)


# ═══════════════════════════════════════════════════════════════════════════
# 16 — Value
# ═══════════════════════════════════════════════════════════════════════════
def s16(s):
    bg(s, WHITE)
    rail(s)
    eyebrow(s, "What changes")
    headline(s, 82, "One production spine.\nNot a stack of spreadsheets.", 38)

    befores = [
        "Plan in Excel, output in notebooks",
        "WIP as a guess",
        "Outsource as a phone call",
        "Efficiency as an opinion",
        "The morning meeting as compilation",
    ]
    afters = [
        "Plan and actuals on the same order",
        "WIP as received, sent, in transit",
        "Outsource as a two-leg trace",
        "Efficiency only when people are logged",
        "The day report already compiled",
    ]

    round_rect(s, M, 196, 404, 268, INK05, 12)
    tx(s, M + 24, 216, 340, 18, "BEFORE", 10.5, INK4, True, spacing=2.2)
    for i, t_ in enumerate(befores):
        tx(s, M + 24, 250 + i * 40, 356, 32, t_, 13.5, INK6, False, line_spacing=1.1)

    x2 = M + 428
    round_rect(s, x2, 196, 404, 268, INK, 12)
    rect(s, x2, 196, 404, 3, BRAND)
    tx(s, x2 + 24, 216, 340, 18, "WITH PRODIGI", 10.5, BRAND3, True, spacing=2.2)
    for i, t_ in enumerate(afters):
        tx(s, x2 + 24, 250 + i * 40, 356, 32, t_, 13.5, WHITE, False, line_spacing=1.1)

    tx(
        s,
        M,
        474,
        CW,
        24,
        "Visibility, accountability and traceability — the value is operational, not a promised percentage.",
        13,
        INK5,
        False,
    )
    foot(s, 16)


# ═══════════════════════════════════════════════════════════════════════════
# 17 — Close
# ═══════════════════════════════════════════════════════════════════════════
def s17(s):
    bg(s, INK)
    image_cover(s, IMG_DOCK, 0, 0, W, H)
    scrim(s, 0, 0, W, H, INK, 0.55)
    scrim_fade(s, 0, 0, 740, H, INK, 0.10, 1.0)
    rect(s, 0, 0, 6, H, BRAND)

    tx(s, M, 56, 600, 16, "WHERE PRODIGI IS GOING", 11.5, BRAND3, True, spacing=2.6)
    tx(s, M, 92, 620, 52, "Own your production.", 44, WHITE, True)
    rule(s, M, 158, 72)
    tx(
        s,
        M,
        186,
        520,
        60,
        "Plan it, capture it, measure it — in one system\nbuilt for how garments are actually made.",
        17,
        INK2,
        False,
        line_spacing=1.3,
    )
    tx(
        s,
        M,
        268,
        560,
        30,
        "The operating system for garment production.",
        19,
        BRAND3,
        True,
    )
    tx(
        s,
        M,
        302,
        520,
        40,
        "Inventory, costing and finance stay out of scope. Prodigi feeds them — never duplicates them.",
        13,
        INK4,
        False,
        line_spacing=1.25,
    )

    # Bottom band: roadmap + contact
    rect(s, 0, 386, W, 154, INK, 0.06)
    rect(s, 0, 386, W, 1, 0x2A3040)
    cols = [
        ("NOW", "Configure · plan · capture\nhandover · report"),
        ("NEXT", "Company layer · finer desktop\nroles · stronger audit trail"),
        ("LATER", "Buyer WIP view · supplier\nportal · machine capture"),
    ]
    for i, (h, b) in enumerate(cols):
        x = M + i * 232
        tx(s, x, 410, 200, 18, h, 10.5, BRAND3, True, spacing=2.2)
        tx(s, x, 432, 206, 46, b, 12.5, INK3, False, line_spacing=1.2)

    rect(s, 762, 408, 1, 72, 0x2A3040)
    tx(s, 790, 410, 170, 18, "CONTACT", 10.5, BRAND3, True, spacing=2.2)
    tx(s, 790, 432, 170, 20, "rbc@rajeshbheda.com", 12.5, WHITE, False)
    tx(s, 790, 454, 170, 20, "www.rajeshbheda.com", 12.5, INK4, False)

    tx(s, M, 502, 300, 16, "PRODIGI", 10.5, INK5, True, spacing=2.0)
    tx(s, M + CW - 200, 502, 200, 16, "17 / 17", 10.5, INK5, False, "right")


BUILDERS = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15, s16, s17]


def main() -> int:
    app = win32.Dispatch("PowerPoint.Application")
    app.Visible = True

    target = os.path.basename(OUT)
    for i in range(app.Presentations.Count, 0, -1):
        try:
            if app.Presentations(i).Name.lower() == target.lower():
                app.Presentations(i).Close()
        except Exception:
            pass

    prs = app.Presentations.Add()
    prs.PageSetup.SlideWidth = W
    prs.PageSetup.SlideHeight = H
    while prs.Slides.Count < len(BUILDERS):
        prs.Slides.Add(prs.Slides.Count + 1, ppLayoutBlank)

    for i, fn in enumerate(BUILDERS, start=1):
        slide = prs.Slides(i)
        clear(slide)
        fn(slide)

    try:
        scheme = prs.Designs(1).SlideMaster.Theme.ThemeFontScheme
        scheme.MajorFont(1).Name = FONT
        scheme.MinorFont(1).Name = FONT
    except Exception:
        pass

    if os.path.exists(OUT):
        os.remove(OUT)
    prs.SaveAs(OUT)
    print(f"Saved {OUT}\nSlides: {prs.Slides.Count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
