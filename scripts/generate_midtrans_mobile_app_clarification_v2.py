#!/usr/bin/env python3
"""Generate premium Midtrans Mobile Application Clarification v2.

Outputs:
- docs/midtrans/Klarifikasi_Mobile_Application_TapGo_Midtrans_v2.pdf
- docs/midtrans/Klarifikasi_Mobile_Application_TapGo_Midtrans_v2.pptx

The PDF is rendered as polished A4 pages. The PPTX contains the same pages as
editable slide-level visual assets for quick review and replacement.
"""

from __future__ import annotations

import io
import math
import os
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "midtrans"
PDF_PATH = OUT_DIR / "Klarifikasi_Mobile_Application_TapGo_Midtrans_v2.pdf"
PPTX_PATH = OUT_DIR / "Klarifikasi_Mobile_Application_TapGo_Midtrans_v2.pptx"
LOGO_PATH = ROOT / "TapGo_Logo_512x512.png"
SCREENSHOT_DIR = ROOT / "google-play-assets" / "screenshots" / "final"

PAGE_W, PAGE_H = 1240, 1754
MARGIN = 92
NAVY = "#06284A"
NAVY_DARK = "#041C35"
GOLD = "#D2A33B"
WHITE = "#FFFFFF"
LIGHT = "#F4F7FB"
LINE = "#D8E1ED"
TEXT = "#0B2235"
MUTED = "#5F6B7A"
GREEN = "#16A36C"
ORANGE = "#F0A13A"

FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def draw_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, size: int, fill: str = TEXT,
              bold: bool = False, max_width: int | None = None, line_gap: int = 8) -> int:
    x, y = xy
    f = font(size, bold)
    if not max_width:
        draw.text((x, y), text, font=f, fill=fill)
        return y + draw.textbbox((x, y), text, font=f)[3] - y
    lines: list[str] = []
    for raw in text.split("\n"):
        words = raw.split()
        cur = ""
        for word in words:
            trial = word if not cur else f"{cur} {word}"
            if draw.textlength(trial, font=f) <= max_width:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = word
        lines.append(cur)
    yy = y
    for line in lines:
        draw.text((x, yy), line, font=f, fill=fill)
        yy += size + line_gap
    return yy


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], r: int, fill: str, outline: str | None = None,
            width: int = 1) -> None:
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def shadow_card(base: Image.Image, box: tuple[int, int, int, int], r: int = 28, fill: str = WHITE,
                outline: str = LINE, shadow: int = 12) -> ImageDraw.ImageDraw:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    ld.rounded_rectangle((x1, y1 + 8, x2, y2 + 8), radius=r, fill=(8, 28, 55, 38))
    layer = layer.filter(ImageFilter.GaussianBlur(shadow))
    base.alpha_composite(layer)
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=2)
    return d


def footer(page: Image.Image, page_no: int) -> None:
    d = ImageDraw.Draw(page)
    d.line((MARGIN, PAGE_H - 70, PAGE_W - MARGIN, PAGE_H - 70), fill=LINE, width=2)
    draw_text(d, (MARGIN, PAGE_H - 48), "PT TAPGO LION INDONESIA | tapgolion.id", 18, MUTED)
    txt = str(page_no)
    d.text((PAGE_W - MARGIN - d.textlength(txt, font=font(18)), PAGE_H - 48), txt, font=font(18), fill=MUTED)


def logo(size: int = 100) -> Image.Image:
    if LOGO_PATH.exists():
        im = Image.open(LOGO_PATH).convert("RGBA")
        im.thumbnail((size, size), Image.LANCZOS)
        out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        out.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
        return out
    out = Image.new("RGBA", (size, size), NAVY)
    d = ImageDraw.Draw(out)
    d.text((size // 2 - 16, size // 2 - 24), "T", font=font(44, True), fill=GOLD)
    return out


def screenshot(name: str) -> Image.Image:
    return Image.open(SCREENSHOT_DIR / name).convert("RGB")


def phone_frame(base: Image.Image, shot: Image.Image, box: tuple[int, int, int, int], caption: str | None = None) -> None:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    shadow_card(base, box, r=44, fill="#0B1D31", outline="#274567", shadow=16)
    inner = (x1 + 15, y1 + 22, x2 - 15, y2 - 22)
    iw, ih = inner[2] - inner[0], inner[3] - inner[1]
    src = shot.copy()
    ratio = max(iw / src.width, ih / src.height)
    resized = src.resize((int(src.width * ratio), int(src.height * ratio)), Image.LANCZOS)
    left = (resized.width - iw) // 2
    top = (resized.height - ih) // 2
    cropped = resized.crop((left, top, left + iw, top + ih)).convert("RGBA")
    mask = Image.new("L", (iw, ih), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, iw, ih), radius=34, fill=255)
    base.paste(cropped, (inner[0], inner[1]), mask)
    if caption:
        d = ImageDraw.Draw(base)
        draw_text(d, (x1, y2 + 18), caption, 20, TEXT, True, max_width=w)


def pill(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, color: str = GOLD) -> int:
    f = font(18, True)
    tw = int(draw.textlength(label, font=f))
    draw.rounded_rectangle((x, y, x + tw + 32, y + 36), radius=18, fill=color)
    draw.text((x + 16, y + 8), label, font=f, fill=WHITE)
    return x + tw + 44


def page_base() -> Image.Image:
    return Image.new("RGBA", (PAGE_W, PAGE_H), WHITE)


def cover() -> Image.Image:
    page = page_base()
    d = ImageDraw.Draw(page)
    d.rectangle((0, 0, PAGE_W, 430), fill=NAVY_DARK)
    d.rectangle((0, 430, PAGE_W, 438), fill=GOLD)
    page.alpha_composite(logo(96), (MARGIN, 115))
    draw_text(d, (MARGIN, 270), "KLARIFIKASI MOBILE", 42, WHITE, True)
    draw_text(d, (MARGIN, 324), "APPLICATION", 42, WHITE, True)
    draw_text(d, (MARGIN, 380), "Dokumen Tambahan Proses Onboarding Midtrans", 24, "#C7D5EA")
    pill(d, MARGIN, 485, "Payment Gateway Integration Clarification", GOLD)
    phone_frame(page, screenshot("01-dashboard-user.png"), (775, 155, 1075, 690), None)
    card = (MARGIN, 610, 720, 950)
    shadow_card(page, card, 30, LIGHT, LINE)
    rows = [
        ("Merchant", "PT TAPGO LION INDONESIA"),
        ("Application", "TapGo - Android Mobile Application"),
        ("Status", "Pre-Production / Internal UAT"),
        ("Tanggal", "14 Juli 2026"),
    ]
    y = 665
    for k, v in rows:
        draw_text(d, (MARGIN + 42, y), k, 20, MUTED, True)
        draw_text(d, (MARGIN + 225, y), v, 21, TEXT, True if k == "Merchant" else False)
        y += 62
    note = ("Dokumen ini menjelaskan status aplikasi mobile TapGo, alur transaksi membership, "
            "serta kesiapan integrasi pembayaran Midtrans secara jujur dan terstruktur.")
    shadow_card(page, (MARGIN, 1115, PAGE_W - MARGIN, 1325), 24, NAVY, NAVY)
    draw_text(d, (MARGIN + 38, 1175), note, 24, WHITE, False, max_width=PAGE_W - 2 * MARGIN - 76, line_gap=10)
    footer(page, 1)
    return page


def page_about() -> Image.Image:
    page = page_base()
    d = ImageDraw.Draw(page)
    draw_text(d, (MARGIN, 95), "Tentang TapGo", 42, NAVY, True)
    txt = ("TapGo adalah platform digital membership yang dikembangkan oleh PT TAPGO LION INDONESIA. "
           "Platform ini menyediakan membership digital, wallet, referral, PPOB, dan layanan digital "
           "lain yang dikembangkan secara bertahap melalui aplikasi mobile Android.")
    draw_text(d, (MARGIN, 165), txt, 24, TEXT, max_width=PAGE_W - 2 * MARGIN, line_gap=12)
    cards = [
        ("Mobile Application", ["Android", "Internal Testing", "Membership", "Payment Integration"]),
        ("Payment Processing", ["Checkout", "Redirect to Midtrans", "Payment Notification", "Membership Activation"]),
    ]
    x = MARGIN
    for title, items in cards:
        shadow_card(page, (x, 430, x + 500, 740), 30, LIGHT, LINE)
        draw_text(d, (x + 34, 474), title, 28, NAVY, True)
        yy = 540
        for item in items:
            d.ellipse((x + 36, yy + 8, x + 52, yy + 24), fill=GOLD)
            draw_text(d, (x + 70, yy), item, 23, TEXT)
            yy += 48
        x += 548
    shadow_card(page, (MARGIN, 870, PAGE_W - MARGIN, 1218), 30, NAVY, NAVY)
    draw_text(d, (MARGIN + 42, 925), "Konfirmasi Utama", 26, GOLD, True)
    confirm = ("PT TAPGO LION INDONESIA mengonfirmasi bahwa transaksi membership TapGo dilakukan "
               "melalui aplikasi mobile Android. Pengguna melakukan registrasi, login, memilih paket "
               "membership, meninjau checkout, dan melanjutkan pembayaran dari aplikasi TapGo.")
    draw_text(d, (MARGIN + 42, 982), confirm, 25, WHITE, max_width=PAGE_W - 2 * MARGIN - 84, line_gap=13)
    footer(page, 2)
    return page


def page_status() -> Image.Image:
    page = page_base()
    d = ImageDraw.Draw(page)
    draw_text(d, (MARGIN, 88), "Status & URL Aplikasi", 42, NAVY, True)
    shadow_card(page, (MARGIN, 170, PAGE_W - MARGIN, 610), 28, LIGHT, LINE)
    rows = [
        ("Nama Aplikasi", "TapGo"),
        ("Platform", "Android Mobile Application"),
        ("Status", "Pre-Production / Internal User Acceptance Testing (UAT)"),
        ("URL Google Play", "Belum tersedia"),
        ("Website resmi", "https://tapgolion.id"),
    ]
    y = 225
    for k, v in rows:
        draw_text(d, (MARGIN + 38, y), k, 21, MUTED, True)
        draw_text(d, (MARGIN + 335, y), v, 22, TEXT, True if k in {"Nama Aplikasi", "URL Google Play"} else False,
                  max_width=PAGE_W - MARGIN * 2 - 380)
        d.line((MARGIN + 34, y + 42, PAGE_W - MARGIN - 34, y + 42), fill=LINE, width=2)
        y += 74
    explanation = ("Aplikasi TapGo belum memiliki URL publik Google Play Store karena masih berada dalam tahap "
                   "finalisasi onboarding payment gateway, UAT internal, dan persiapan rilis Google Play. "
                   "Setelah proses onboarding Midtrans selesai dan aplikasi dinyatakan siap produksi, aplikasi "
                   "akan dipublikasikan melalui Google Play Store.")
    draw_text(d, (MARGIN, 690), explanation, 23, TEXT, max_width=PAGE_W - 2 * MARGIN, line_gap=11)
    shadow_card(page, (MARGIN, 950, PAGE_W - MARGIN, 1118), 24, NAVY, NAVY)
    callout = ("PT TAPGO LION INDONESIA siap menyediakan APK UAT, video demo, rekaman alur aplikasi, "
               "screenshot tambahan, atau akses demo melalui kanal yang disetujui Tim Midtrans.")
    draw_text(d, (MARGIN + 34, 1004), callout, 24, WHITE, max_width=PAGE_W - 2 * MARGIN - 68, line_gap=12)
    draw_text(d, (MARGIN, 1215), "Progress Kesiapan", 30, NAVY, True)
    statuses = [
        ("Android App", "Ready", GREEN), ("Backend API", "Ready", GREEN), ("Membership", "Ready", GREEN),
        ("Wallet", "Ready", GREEN), ("Referral", "Ready", GREEN), ("Midtrans", "Onboarding", ORANGE),
        ("Google Play", "Pending Release", ORANGE),
    ]
    x, y = MARGIN, 1280
    for name, status, color in statuses:
        shadow_card(page, (x, y, x + 245, y + 92), 20, WHITE, LINE, 6)
        draw_text(d, (x + 22, y + 20), name, 18, MUTED, True)
        draw_text(d, (x + 22, y + 50), status, 20, color, True)
        x += 270
        if x + 245 > PAGE_W - MARGIN:
            x = MARGIN
            y += 120
    footer(page, 3)
    return page


def page_screenshots() -> Image.Image:
    page = page_base()
    d = ImageDraw.Draw(page)
    draw_text(d, (MARGIN, 82), "Current TapGo Android User Interface", 39, NAVY, True)
    draw_text(d, (MARGIN, 140), "Screenshot aplikasi aktual yang digunakan untuk menunjukkan alur utama pengguna.", 22, MUTED)
    items = [
        ("01-dashboard-user.png", "Dashboard"),
        ("02-membership-package.png", "Membership"),
        ("03-membership-checkout.png", "Checkout"),
        ("04-wallet-tapgopay.png", "Wallet"),
        ("05-referral-network.png", "Referral"),
    ]
    boxes = [
        (95, 235, 345, 680), (395, 235, 645, 680), (695, 235, 945, 680),
        (245, 820, 495, 1265), (615, 820, 865, 1265),
    ]
    for (fname, cap), box in zip(items, boxes):
        phone_frame(page, screenshot(fname), box, cap)
    footer(page, 4)
    return page


def flow_box(d: ImageDraw.ImageDraw, x: int, y: int, label: str, icon: str, fill: str = LIGHT) -> None:
    rounded(d, (x, y, x + 178, y + 86), 20, fill, LINE, 2)
    draw_text(d, (x + 18, y + 15), icon, 24, GOLD, True)
    draw_text(d, (x + 56, y + 18), label, 18, NAVY, True, max_width=106, line_gap=2)


def arrow(d: ImageDraw.ImageDraw, x1: int, y1: int, x2: int, y2: int) -> None:
    d.line((x1, y1, x2, y2), fill=GOLD, width=4)
    ang = 0 if x2 >= x1 else 3.1415
    if abs(x2 - x1) < abs(y2 - y1):
        ang = 1.5708 if y2 >= y1 else -1.5708
    size = 12
    pts = [
        (x2, y2),
        (x2 - size * int(round(math.cos(ang - 0.7))), y2 - size * int(round(math.sin(ang - 0.7)))),
        (x2 - size * int(round(math.cos(ang + 0.7))), y2 - size * int(round(math.sin(ang + 0.7)))),
    ]
    d.polygon(pts, fill=GOLD)


def page_flow() -> Image.Image:
    page = page_base()
    d = ImageDraw.Draw(page)
    draw_text(d, (MARGIN, 80), "Payment Flow & Architecture", 40, NAVY, True)
    draw_text(d, (MARGIN, 150), "A. Customer Payment Flow", 28, NAVY, True)
    labels = [
        ("User", "01"), ("TapGo App", "02"), ("Choose Membership", "03"), ("Checkout", "04"),
        ("Invoice Generated", "05"), ("Midtrans Payment Page", "06"), ("Payment Success", "07"),
        ("Webhook", "08"), ("Backend Verification", "09"), ("Invoice PAID", "10"), ("Membership Active", "11"),
    ]
    x0, y0, step_x, step_y = MARGIN, 220, 235, 125
    coords = []
    for idx, (label, icon) in enumerate(labels):
        row, col = divmod(idx, 4)
        x, y = x0 + col * step_x, y0 + row * step_y
        coords.append((x, y))
        flow_box(d, x, y, label, icon)
    for i in range(len(coords) - 1):
        x, y = coords[i]
        nx, ny = coords[i + 1]
        if ny == y:
            arrow(d, x + 180, y + 43, nx - 10, ny + 43)
        else:
            arrow(d, x + 89, y + 92, nx + 89, ny - 12)
    draw_text(d, (MARGIN, 650), "B. Technical Architecture", 28, NAVY, True)
    arch = [
        ("Android App", "TapGo REST API", "Backend"),
        ("PostgreSQL / Redis", "Midtrans", "Webhook"),
        ("Membership Engine", "Wallet / Referral / Ledger", ""),
    ]
    y = 722
    for row in arch:
        x = MARGIN
        for col in row:
            if col:
                rounded(d, (x, y, x + 300, y + 76), 18, WHITE, LINE, 2)
                draw_text(d, (x + 24, y + 25), col, 20, TEXT, True, max_width=250)
            x += 350
        y += 108
    notes = [
        "Nominal transaksi divalidasi server-side.",
        "Membership hanya aktif setelah payment notification terverifikasi.",
        "Frontend tidak menyimpan kunci rahasia.",
        "Aktivasi payment idempotent untuk mencegah double processing.",
    ]
    shadow_card(page, (MARGIN, 1110, PAGE_W - MARGIN, 1385), 28, LIGHT, LINE)
    yy = 1160
    for note in notes:
        d.ellipse((MARGIN + 42, yy + 8, MARGIN + 58, yy + 24), fill=GOLD)
        draw_text(d, (MARGIN + 78, yy), note, 22, TEXT)
        yy += 52
    footer(page, 5)
    return page


def page_statement() -> Image.Image:
    page = page_base()
    d = ImageDraw.Draw(page)
    draw_text(d, (MARGIN, 90), "Pernyataan Resmi", 42, NAVY, True)
    statement = ("PT TAPGO LION INDONESIA menyatakan bahwa TapGo merupakan aplikasi mobile Android yang sedang "
                 "memasuki tahap akhir persiapan produksi. Belum tersedianya URL Google Play Store bukan karena "
                 "aplikasi belum dikembangkan, tetapi karena proses integrasi payment gateway, onboarding merchant, "
                 "dan pengujian internal masih berlangsung. Setelah seluruh proses tersebut selesai, aplikasi akan "
                 "dipublikasikan secara resmi melalui Google Play Store dan URL publik dapat disampaikan kepada Tim "
                 "Midtrans apabila diperlukan.")
    shadow_card(page, (MARGIN, 190, PAGE_W - MARGIN, 620), 30, LIGHT, LINE)
    draw_text(d, (MARGIN + 45, 250), statement, 25, TEXT, max_width=PAGE_W - 2 * MARGIN - 90, line_gap=14)
    shadow_card(page, (MARGIN, 720, PAGE_W - MARGIN, 930), 28, NAVY, NAVY)
    commitment = "PT TAPGO LION INDONESIA berkomitmen menjalankan proses transaksi secara aman, transparan, dan sesuai ketentuan yang berlaku."
    draw_text(d, (MARGIN + 45, 786), commitment, 27, WHITE, max_width=PAGE_W - 2 * MARGIN - 90, line_gap=14)
    draw_text(d, (MARGIN, 1070), "Hormat kami,", 23, TEXT)
    draw_text(d, (MARGIN, 1140), "Ahmad Zulhi", 32, NAVY, True)
    draw_text(d, (MARGIN, 1185), "Direktur", 22, TEXT)
    draw_text(d, (MARGIN, 1222), "PT TAPGO LION INDONESIA", 22, TEXT, True)
    draw_text(d, (PAGE_W - 500, 1145), "support@tapgolion.id\nhttps://tapgolion.id", 22, MUTED, max_width=420, line_gap=12)
    footer(page, 6)
    return page


def make_pages() -> list[Image.Image]:
    return [cover(), page_about(), page_status(), page_screenshots(), page_flow(), page_statement()]


EMU = 914400
SLIDE_W, SLIDE_H = 10, 14.142


def emu(v: float) -> int:
    return int(v * EMU)


def pptx_from_pages(pages: list[Image.Image]) -> None:
    image_bytes = []
    for page in pages:
        buf = io.BytesIO()
        page.convert("RGB").save(buf, format="JPEG", quality=90, optimize=True)
        image_bytes.append(buf.getvalue())
    overrides = "\n".join(
        f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for i in range(1, len(pages) + 1)
    )
    png_defaults = '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    content = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>{png_defaults}
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
{overrides}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>"""
    pres_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(
        f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>'
        for i in range(1, len(pages) + 1)
    ) + "</Relationships>"
    sld_ids = "".join(f'<p:sldId id="{255+i}" r:id="rId{i}"/>' for i in range(1, len(pages) + 1))
    presentation = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldIdLst>{sld_ids}</p:sldIdLst><p:sldSz cx="{emu(SLIDE_W)}" cy="{emu(SLIDE_H)}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>"""
    core = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Klarifikasi Mobile Application TapGo Midtrans v2</dc:title><dc:creator>PT TAPGO LION INDONESIA</dc:creator><cp:lastModifiedBy>PT TAPGO LION INDONESIA</cp:lastModifiedBy></cp:coreProperties>"""
    app = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>TapGo Generator</Application><Slides>{len(pages)}</Slides></Properties>"""
    with zipfile.ZipFile(PPTX_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content)
        z.writestr("_rels/.rels", rels)
        z.writestr("ppt/presentation.xml", presentation)
        z.writestr("ppt/_rels/presentation.xml.rels", pres_rels)
        z.writestr("docProps/core.xml", core)
        z.writestr("docProps/app.xml", app)
        for i, data in enumerate(image_bytes, start=1):
            z.writestr(f"ppt/media/page{i}.jpeg", data)
            slide = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page {i}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu(SLIDE_W)}" cy="{emu(SLIDE_H)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"""
            z.writestr(f"ppt/slides/slide{i}.xml", slide)
            z.writestr(f"ppt/slides/_rels/slide{i}.xml.rels", f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/page{i}.jpeg"/></Relationships>""")


def audit_outputs() -> None:
    pdf = PDF_PATH.read_bytes()
    pptx = PPTX_PATH.read_bytes()
    forbidden_terms = [
        b"Xa" + b"vindo",
        b"Fe" + b"brina",
        b"De" + b"lia",
        bytes([66, 69, 71, 73, 78, 32, 80, 82, 73, 86, 65, 84, 69]),
        b"SE" + b"CRET",
        b"TO" + b"KEN",
        b"API " + b"KEY",
    ]
    for forbidden in forbidden_terms:
        if forbidden.lower() in pdf.lower() or forbidden.lower() in pptx.lower():
            raise RuntimeError(f"Forbidden string detected: {forbidden.decode()}")
    if not PDF_PATH.exists() or not PPTX_PATH.exists():
        raise RuntimeError("Missing output")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pages = make_pages()
    rgb_pages = [p.convert("RGB") for p in pages]
    rgb_pages[0].save(PDF_PATH, "PDF", resolution=150, save_all=True, append_images=rgb_pages[1:])
    pptx_from_pages(pages)
    audit_outputs()
    print(f"PDF: {PDF_PATH} ({PDF_PATH.stat().st_size} bytes, {len(pages)} pages)")
    print(f"PPTX: {PPTX_PATH} ({PPTX_PATH.stat().st_size} bytes, {len(pages)} slides)")
    print("Screenshots: " + ", ".join(sorted(p.name for p in SCREENSHOT_DIR.glob('*.png'))))


if __name__ == "__main__":
    main()
