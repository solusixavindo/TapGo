#!/usr/bin/env python3
"""Generate TapGo Midtrans mobile application clarification PDF and PPTX.

The script intentionally avoids third-party document libraries so the artifact
can be regenerated in restricted environments. It produces a vector PDF and an
editable PPTX built from Office Open XML text boxes and shapes.
"""

from __future__ import annotations

import datetime as _dt
import io
import math
import os
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "midtrans"
PDF_PATH = OUT_DIR / "Klarifikasi_Mobile_Application_TapGo_Midtrans.pdf"
PPTX_PATH = OUT_DIR / "Klarifikasi_Mobile_Application_TapGo_Midtrans.pptx"
LOGO_PATH = ROOT / "TapGo_Logo_512x512.png"

PAGE_W = 595.28
PAGE_H = 841.89

NAVY = (0.015, 0.102, 0.188)
NAVY_2 = (0.035, 0.164, 0.286)
GOLD = (0.823, 0.639, 0.231)
LIGHT = (0.945, 0.961, 0.980)
MID = (0.855, 0.887, 0.925)
TEXT = (0.090, 0.145, 0.220)
MUTED = (0.360, 0.410, 0.500)
WHITE = (1.0, 1.0, 1.0)


def _rgb(color: tuple[float, float, float]) -> str:
    return f"{color[0]:.3f} {color[1]:.3f} {color[2]:.3f}"


def _esc_pdf(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _approx_width(text: str, size: float, bold: bool = False) -> float:
    factor = 0.55 if bold else 0.50
    wide = sum(1 for c in text if c in "MW@#%")
    return (len(text) * factor + wide * 0.10) * size


def _wrap(text: str, max_width: float, size: float, bold: bool = False) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else f"{current} {word}"
        if _approx_width(trial, size, bold) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


class Canvas:
    def __init__(self) -> None:
        self.ops: list[str] = []

    def rect(self, x: float, y: float, w: float, h: float, fill: tuple[float, float, float] | None = None,
             stroke: tuple[float, float, float] | None = None, width: float = 1) -> None:
        if fill:
            self.ops.append(f"{_rgb(fill)} rg")
        if stroke:
            self.ops.append(f"{_rgb(stroke)} RG {width:.2f} w")
        self.ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re {'B' if fill and stroke else 'f' if fill else 'S'}")

    def line(self, x1: float, y1: float, x2: float, y2: float, color: tuple[float, float, float], width: float = 1) -> None:
        self.ops.append(f"{_rgb(color)} RG {width:.2f} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def text(self, x: float, y: float, text: str, size: float = 10, color: tuple[float, float, float] = TEXT,
             bold: bool = False, align: str = "left") -> None:
        font = "F2" if bold else "F1"
        tx = x
        if align == "center":
            tx = x - _approx_width(text, size, bold) / 2
        elif align == "right":
            tx = x - _approx_width(text, size, bold)
        self.ops.append(f"BT /{font} {size:.2f} Tf {_rgb(color)} rg {tx:.2f} {y:.2f} Td ({_esc_pdf(text)}) Tj ET")

    def wrapped(self, x: float, y: float, text: str, width: float, size: float = 10,
                color: tuple[float, float, float] = TEXT, bold: bool = False, leading: float | None = None) -> float:
        leading = leading or size * 1.42
        yy = y
        for line in _wrap(text, width, size, bold):
            self.text(x, yy, line, size, color, bold)
            yy -= leading
        return yy

    def image(self, name: str, x: float, y: float, w: float, h: float) -> None:
        self.ops.append(f"q {w:.2f} 0 0 {h:.2f} {x:.2f} {y:.2f} cm /{name} Do Q")

    def stream(self) -> bytes:
        return ("\n".join(self.ops) + "\n").encode("latin-1", "replace")


def _load_logo_jpeg() -> tuple[bytes, int, int] | None:
    if not LOGO_PATH.exists():
        return None
    img = Image.open(LOGO_PATH).convert("RGB")
    img.thumbnail((512, 512), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue(), img.width, img.height


def _footer(c: Canvas, page_no: int) -> None:
    c.line(52, 42, PAGE_W - 52, 42, MID, 0.8)
    c.text(52, 24, "PT TAPGO LION INDONESIA | tapgolion.id", 8.5, MUTED, False)
    c.text(PAGE_W - 52, 24, str(page_no), 8.5, MUTED, False, "right")


def _cover() -> Canvas:
    c = Canvas()
    c.rect(0, 0, PAGE_W, PAGE_H, WHITE)
    c.rect(0, PAGE_H - 255, PAGE_W, 255, NAVY)
    c.rect(0, PAGE_H - 260, PAGE_W, 5, GOLD)
    c.rect(52, PAGE_H - 178, 76, 76, WHITE)
    if LOGO_PATH.exists():
        c.image("ImLogo", 62, PAGE_H - 168, 56, 56)
    else:
        c.text(90, PAGE_H - 140, "T", 32, GOLD, True, "center")
    c.text(52, PAGE_H - 310, "KLARIFIKASI MOBILE APPLICATION", 24, NAVY, True)
    c.text(52, PAGE_H - 338, "Dokumen Tambahan Proses Onboarding Midtrans", 13, MUTED, False)
    c.rect(52, PAGE_H - 512, PAGE_W - 104, 138, LIGHT, MID)
    rows = [
        ("Merchant", "PT TAPGO LION INDONESIA"),
        ("Aplikasi", "TapGo - Android Mobile Application"),
        ("Status", "Pre-Production / Internal User Acceptance Testing"),
        ("Tanggal", "14 Juli 2026"),
    ]
    y = PAGE_H - 402
    for label, value in rows:
        c.text(76, y, label, 9.5, MUTED, True)
        c.text(190, y, value, 10.5, TEXT, True if label == "Merchant" else False)
        y -= 29
    c.rect(52, 132, PAGE_W - 104, 105, NAVY_2)
    note = (
        "Dokumen ini disusun untuk menjawab permintaan Tim Midtrans mengenai "
        "konfirmasi apakah transaksi dilakukan melalui aplikasi mobile dan "
        "informasi URL aplikasi yang dapat diakses."
    )
    c.wrapped(76, 196, note, PAGE_W - 152, 11, WHITE, False, 16)
    c.text(52, 82, "PT TAPGO LION INDONESIA", 11, NAVY, True)
    c.text(52, 62, "Website: https://tapgolion.id | Email: support@tapgolion.id", 9.5, MUTED)
    _footer(c, 1)
    return c


def _page2() -> Canvas:
    c = Canvas()
    c.rect(0, 0, PAGE_W, PAGE_H, WHITE)
    c.text(52, 785, "1. Konfirmasi Transaksi Mobile", 18, NAVY, True)
    paragraph = (
        "PT TAPGO LION INDONESIA mengonfirmasi bahwa transaksi membership TapGo "
        "dilakukan melalui aplikasi mobile Android. Pengguna melakukan registrasi, "
        "login, memilih paket membership, meninjau checkout, dan melanjutkan "
        "pembayaran dari aplikasi TapGo. Pengguna kemudian diarahkan ke halaman "
        "pembayaran Midtrans."
    )
    c.wrapped(52, 752, paragraph, PAGE_W - 104, 10.8, TEXT, False, 16)
    c.rect(52, 590, PAGE_W - 104, 72, LIGHT, MID)
    c.text(72, 632, "Ringkasan", 10, NAVY, True)
    c.wrapped(72, 612, "Transaksi membership dimulai dari aplikasi TapGo dan pembayaran diproses melalui halaman pembayaran Midtrans.", PAGE_W - 144, 10, TEXT, False, 14)
    c.text(52, 538, "2. Status dan URL Aplikasi", 18, NAVY, True)
    rows = [
        ("Nama Aplikasi", "TapGo"),
        ("Platform", "Android Mobile Application"),
        ("Status", "Pre-Production / Internal User Acceptance Testing (UAT)"),
        ("URL Google Play", "Belum tersedia"),
        ("Website resmi", "https://tapgolion.id"),
    ]
    x, y, w = 52, 494, PAGE_W - 104
    c.rect(x, y - 160, w, 178, WHITE, MID)
    c.rect(x, y - 12, w, 30, NAVY)
    c.text(x + 16, y - 1, "Informasi Aplikasi", 10, WHITE, True)
    row_y = y - 42
    for i, (label, value) in enumerate(rows):
        if i % 2 == 0:
            c.rect(x, row_y - 11, w, 30, LIGHT)
        c.text(x + 16, row_y, label, 9.4, NAVY, True)
        c.wrapped(x + 178, row_y, value, w - 200, 9.4, TEXT, False, 12)
        c.line(x, row_y - 14, x + w, row_y - 14, MID, 0.5)
        row_y -= 30
    explanation = (
        "Aplikasi TapGo belum memiliki URL publik Google Play Store karena masih "
        "berada dalam tahap finalisasi onboarding payment gateway, UAT internal, "
        "dan persiapan rilis Google Play. Setelah proses onboarding Midtrans "
        "selesai dan aplikasi dinyatakan siap produksi, aplikasi akan "
        "dipublikasikan melalui Google Play Store."
    )
    c.wrapped(52, 287, explanation, PAGE_W - 104, 10.5, TEXT, False, 15)
    demo_note = (
        "Apabila Tim Midtrans memerlukan akses demo, rekaman alur aplikasi, "
        "screenshot tambahan, atau file APK UAT melalui kanal yang disetujui, "
        "PT TAPGO LION INDONESIA siap menyediakannya."
    )
    c.rect(52, 122, PAGE_W - 104, 78, NAVY_2)
    c.wrapped(72, 166, demo_note, PAGE_W - 144, 10.2, WHITE, False, 15)
    _footer(c, 2)
    return c


def _flow(c: Canvas) -> None:
    steps = [
        "Registrasi", "Login", "Pilih Membership", "Checkout", "Invoice Dibuat",
        "Midtrans Payment Page", "Pembayaran", "Webhook Midtrans",
        "Verifikasi Backend", "Invoice PAID", "Membership Aktif",
    ]
    start_x, start_y = 52, 695
    box_w, box_h = 142, 34
    gap_x, gap_y = 34, 34
    for idx, step in enumerate(steps):
        row = idx // 3
        col = idx % 3
        x = start_x + col * (box_w + gap_x)
        y = start_y - row * (box_h + gap_y)
        c.rect(x, y, box_w, box_h, LIGHT, MID)
        c.text(x + box_w / 2, y + 12, step, 8.6, NAVY, True, "center")
        if idx < len(steps) - 1:
            if col < 2:
                c.line(x + box_w + 6, y + box_h / 2, x + box_w + gap_x - 8, y + box_h / 2, GOLD, 1.5)
                c.text(x + box_w + gap_x / 2, y + box_h / 2 - 3, ">", 10, GOLD, True, "center")
            else:
                nx = start_x
                ny = start_y - (row + 1) * (box_h + gap_y)
                c.line(x + box_w / 2, y - 6, x + box_w / 2, ny + box_h + 8, GOLD, 1.5)
                c.line(x + box_w / 2, ny + box_h + 8, nx + box_w / 2, ny + box_h + 8, GOLD, 1.5)
                c.text(nx + box_w / 2, ny + box_h + 2, "v", 10, GOLD, True, "center")


def _page3() -> Canvas:
    c = Canvas()
    c.rect(0, 0, PAGE_W, PAGE_H, WHITE)
    c.text(52, 785, "3. Alur Transaksi TapGo", 18, NAVY, True)
    _flow(c)
    explanation = (
        "Midtrans mengirimkan notifikasi pembayaran ke backend TapGo. Sistem "
        "melakukan verifikasi status pembayaran, invoice, dan nominal transaksi "
        "sebelum mengaktifkan membership pengguna."
    )
    c.wrapped(52, 388, explanation, PAGE_W - 104, 10.5, TEXT, False, 15)
    c.text(52, 325, "4. Pernyataan Resmi", 18, NAVY, True)
    statement = (
        "PT TAPGO LION INDONESIA menyatakan bahwa TapGo merupakan aplikasi mobile "
        "Android yang sedang memasuki tahap akhir persiapan produksi. Belum "
        "tersedianya URL Google Play Store bukan karena aplikasi belum "
        "dikembangkan, tetapi karena proses integrasi payment gateway, onboarding "
        "merchant, dan pengujian internal masih berlangsung. Setelah seluruh proses "
        "tersebut selesai, aplikasi akan dipublikasikan secara resmi melalui "
        "Google Play Store dan URL publik dapat disampaikan kepada Tim Midtrans "
        "apabila diperlukan."
    )
    c.wrapped(52, 292, statement, PAGE_W - 104, 10.3, TEXT, False, 15)
    c.text(52, 142, "Hormat kami,", 10.2, TEXT)
    c.text(52, 106, "Ahmad Zulhi", 12, NAVY, True)
    c.text(52, 89, "Direktur", 10, TEXT)
    c.text(52, 72, "PT TAPGO LION INDONESIA", 10, TEXT, True)
    c.text(330, 106, "Email: support@tapgolion.id", 9.5, MUTED)
    c.text(330, 89, "Website: https://tapgolion.id", 9.5, MUTED)
    _footer(c, 3)
    return c


def _pdf_object(data: bytes) -> bytes:
    return data if data.endswith(b"\n") else data + b"\n"


def write_pdf() -> None:
    logo = _load_logo_jpeg()
    pages = [_cover(), _page2(), _page3()]
    objects: list[bytes] = []

    def add(data: bytes) -> int:
        objects.append(_pdf_object(data))
        return len(objects)

    catalog_id = add(b"<< /Type /Catalog /Pages 2 0 R >>")
    pages_id = add(b"")
    font_regular_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    font_bold_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    image_id = None
    if logo:
        data, iw, ih = logo
        image_id = add(
            f"<< /Type /XObject /Subtype /Image /Width {iw} /Height {ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(data)} >>\nstream\n".encode()
            + data
            + b"\nendstream"
        )

    page_ids: list[int] = []
    content_ids: list[int] = []
    for canvas in pages:
        stream = canvas.stream()
        content_ids.append(add(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"endstream"))
        resources = f"<< /Font << /F1 {font_regular_id} 0 R /F2 {font_bold_id} 0 R >>"
        if image_id:
            resources += f" /XObject << /ImLogo {image_id} 0 R >>"
        resources += " >>"
        page_ids.append(add(
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_W:.2f} {PAGE_H:.2f}] /Resources {resources} /Contents {content_ids[-1]} 0 R >>".encode()
        ))
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>\n".encode()

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + obj + b"endobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode()
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects)+1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    PDF_PATH.write_bytes(out)


EMU = 914400
SLIDE_W = 10 * EMU
SLIDE_H = 14.142 * EMU


def _emu(v: float) -> int:
    return int(v * EMU)


def _ppt_shape(idx: int, x: float, y: float, w: float, h: float, fill: str, line: str = "FFFFFF",
               radius: bool = False) -> str:
    geom = "roundRect" if radius else "rect"
    return f"""
      <p:sp><p:nvSpPr><p:cNvPr id="{idx}" name="Shape {idx}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="{_emu(x)}" y="{_emu(y)}"/><a:ext cx="{_emu(w)}" cy="{_emu(h)}"/></a:xfrm>
          <a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>
          <a:ln><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>"""


def _ppt_text(idx: int, x: float, y: float, w: float, h: float, text: str, size: int = 18,
              color: str = "0A2233", bold: bool = False) -> str:
    lines = text.split("\n")
    paras = []
    for line in lines:
        paras.append(
            f'<a:p><a:r><a:rPr lang="id-ID" sz="{size*100}" b="{1 if bold else 0}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></a:rPr><a:t>{xml_escape(line)}</a:t></a:r></a:p>'
        )
    return f"""
      <p:sp><p:nvSpPr><p:cNvPr id="{idx}" name="Text {idx}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="{_emu(x)}" y="{_emu(y)}"/><a:ext cx="{_emu(w)}" cy="{_emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
        <p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>{''.join(paras)}</p:txBody></p:sp>"""


def _slide_xml(slide_no: int) -> str:
    footer = _ppt_text(90, 0.7, 13.55, 5.8, 0.25, "PT TAPGO LION INDONESIA | tapgolion.id", 8, "5C6778")
    page = _ppt_text(91, 9.2, 13.55, 0.3, 0.25, str(slide_no), 8, "5C6778")
    if slide_no == 1:
        body = (
            _ppt_shape(2, 0, 0, 10, 4.1, "06284A", "06284A")
            + _ppt_shape(3, 0, 4.1, 10, 0.08, "D2A33B", "D2A33B")
            + _ppt_text(4, 0.75, 4.65, 8.5, 0.8, "KLARIFIKASI MOBILE APPLICATION", 28, "06284A", True)
            + _ppt_text(5, 0.75, 5.35, 8.5, 0.4, "Dokumen Tambahan Proses Onboarding Midtrans", 14, "5C6778")
            + _ppt_shape(6, 0.75, 6.25, 8.5, 2.2, "F2F6FA", "D3DDEB", True)
            + _ppt_text(7, 1.05, 6.55, 7.9, 1.6, "Merchant: PT TAPGO LION INDONESIA\nAplikasi: TapGo - Android Mobile Application\nStatus: Pre-Production / Internal User Acceptance Testing\nTanggal: 14 Juli 2026", 13, "0A2233", True)
            + _ppt_shape(8, 0.75, 10.2, 8.5, 1.45, "0A2233", "0A2233", True)
            + _ppt_text(9, 1.05, 10.55, 7.9, 0.9, "Dokumen ini menjawab permintaan Tim Midtrans mengenai transaksi melalui aplikasi mobile dan informasi URL aplikasi.", 13, "FFFFFF")
        )
    elif slide_no == 2:
        body = (
            _ppt_text(2, 0.75, 0.8, 8.6, 0.5, "1. Konfirmasi Transaksi Mobile", 22, "06284A", True)
            + _ppt_text(3, 0.75, 1.55, 8.5, 1.5, "PT TAPGO LION INDONESIA mengonfirmasi bahwa transaksi membership TapGo dilakukan melalui aplikasi mobile Android. Pengguna melakukan registrasi, login, memilih paket membership, meninjau checkout, dan melanjutkan pembayaran dari aplikasi TapGo. Pengguna kemudian diarahkan ke halaman pembayaran Midtrans.", 13, "0A2233")
            + _ppt_text(4, 0.75, 4.0, 8.6, 0.5, "2. Status dan URL Aplikasi", 22, "06284A", True)
            + _ppt_shape(5, 0.75, 4.8, 8.5, 3.0, "F2F6FA", "D3DDEB", True)
            + _ppt_text(6, 1.05, 5.15, 7.8, 2.3, "Nama Aplikasi: TapGo\nPlatform: Android Mobile Application\nStatus: Pre-Production / Internal User Acceptance Testing (UAT)\nURL Google Play: Belum tersedia\nWebsite resmi: https://tapgolion.id", 13, "0A2233", True)
            + _ppt_text(7, 0.75, 8.45, 8.5, 1.9, "Aplikasi TapGo belum memiliki URL publik Google Play Store karena masih berada dalam tahap finalisasi onboarding payment gateway, UAT internal, dan persiapan rilis Google Play. Apabila Tim Midtrans memerlukan akses demo, rekaman alur aplikasi, screenshot tambahan, atau file APK UAT melalui kanal yang disetujui, PT TAPGO LION INDONESIA siap menyediakannya.", 13, "0A2233")
        )
    else:
        flow = "Registrasi -> Login -> Pilih Membership -> Checkout -> Invoice Dibuat\n-> Midtrans Payment Page -> Pembayaran -> Webhook Midtrans\n-> Verifikasi Backend -> Invoice PAID -> Membership Aktif"
        body = (
            _ppt_text(2, 0.75, 0.8, 8.6, 0.5, "3. Alur Transaksi TapGo", 22, "06284A", True)
            + _ppt_shape(3, 0.75, 1.55, 8.5, 2.4, "F2F6FA", "D3DDEB", True)
            + _ppt_text(4, 1.05, 1.9, 7.9, 1.7, flow, 13, "06284A", True)
            + _ppt_text(5, 0.75, 4.35, 8.5, 0.9, "Midtrans mengirimkan notifikasi pembayaran ke backend TapGo. Sistem melakukan verifikasi status pembayaran, invoice, dan nominal transaksi sebelum mengaktifkan membership pengguna.", 13, "0A2233")
            + _ppt_text(6, 0.75, 6.1, 8.6, 0.5, "4. Pernyataan Resmi", 22, "06284A", True)
            + _ppt_text(7, 0.75, 6.85, 8.5, 2.5, "PT TAPGO LION INDONESIA menyatakan bahwa TapGo merupakan aplikasi mobile Android yang sedang memasuki tahap akhir persiapan produksi. Belum tersedianya URL Google Play Store bukan karena aplikasi belum dikembangkan, tetapi karena proses integrasi payment gateway, onboarding merchant, dan pengujian internal masih berlangsung.", 13, "0A2233")
            + _ppt_text(8, 0.75, 10.2, 4.5, 1.0, "Hormat kami,\nAhmad Zulhi\nDirektur\nPT TAPGO LION INDONESIA", 13, "06284A", True)
            + _ppt_text(9, 5.6, 10.55, 3.6, 0.7, "Email: support@tapgolion.id\nWebsite: https://tapgolion.id", 12, "5C6778")
        )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    {body}{footer}{page}
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"""


def write_pptx() -> None:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"""
    pres_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>"""
    presentation = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst>
  <p:sldSz cx="{int(SLIDE_W)}" cy="{int(SLIDE_H)}" type="custom"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"""
    now = _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    core = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Klarifikasi Mobile Application TapGo Midtrans</dc:title><dc:creator>PT TAPGO LION INDONESIA</dc:creator><cp:lastModifiedBy>PT TAPGO LION INDONESIA</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>"""
    app = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>TapGo Generator</Application><Slides>3</Slides></Properties>"""
    with zipfile.ZipFile(PPTX_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("ppt/presentation.xml", presentation)
        z.writestr("ppt/_rels/presentation.xml.rels", pres_rels)
        z.writestr("docProps/core.xml", core)
        z.writestr("docProps/app.xml", app)
        for i in range(1, 4):
            z.writestr(f"ppt/slides/slide{i}.xml", _slide_xml(i))
            z.writestr(f"ppt/slides/_rels/slide{i}.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>""")


def audit() -> None:
    pdf_bytes = PDF_PATH.read_bytes()
    pptx_bytes = PPTX_PATH.read_bytes()
    for bad in [b"Xavindo", b"Febrina", b"Delia", b"BEGIN PRIVATE", b"DOKU_SECRET", b"MIDTRANS_SERVER_KEY"]:
        if bad.lower() in pdf_bytes.lower() or bad.lower() in pptx_bytes.lower():
            raise RuntimeError(f"Forbidden text detected: {bad.decode('latin-1')}")
    if pdf_bytes.count(b"/Type /Page ") != 3:
        raise RuntimeError("PDF page count audit failed")
    if not pdf_bytes.startswith(b"%PDF-1.4"):
        raise RuntimeError("PDF header audit failed")
    with zipfile.ZipFile(PPTX_PATH) as z:
        required = ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]
        for name in required:
            if name not in z.namelist():
                raise RuntimeError(f"Missing PPTX slide: {name}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_pdf()
    write_pptx()
    audit()
    print(f"PDF: {PDF_PATH} ({PDF_PATH.stat().st_size} bytes)")
    print(f"PPTX: {PPTX_PATH} ({PPTX_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
