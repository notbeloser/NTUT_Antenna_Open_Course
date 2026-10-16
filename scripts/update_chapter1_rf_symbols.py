# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf==1.28.2", "fonttools==4.66.1"]
# ///
"""Redraw the lecture's 11 RF symbols and update Chapter 1 and its index.

Run with: uv run scripts/update_chapter1_rf_symbols.py
The existing nine-page PDF is the layout source. Subsequent runs replace the
generated continuation page, so the revised PDF always has ten pages.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import math
import re
from dataclasses import dataclass
from datetime import datetime
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

import pymupdf as pdf
from fontTools import subset
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable


ROOT = Path(__file__).resolve().parents[1]
NOTE = ROOT / "notes/001_無線通訊系統的基頻模組.md"
CHAPTER = ROOT / "pdf/001_無線通訊系統的基頻模組.pdf"
INDEX_NOTE = ROOT / "notes/000_課程導讀與目錄.md"
INDEX_PDF = ROOT / "pdf/000_課程導讀與目錄.pdf"
IMAGES = ROOT / "notes/images"
VIDEO = "https://www.youtube.com/watch?v=42VW-8VFu5E&t=1080s"
MARKER = "chapter1-rf-symbols-v1"
INK = (0.12, 0.20, 0.26)
BLUE = (0, 0.39, 0.56)
LEFT, RIGHT = 62.362, 532.918
PHONE = (
    "影片中的手機例子把 TX／RX 放在同一裝置，利用開關切換共用天線的路徑。"
    "多種通訊功能可對應到不同模組，各模組仍可用此收發流程理解。"
)
EXPLANATION = (
    "依影片 18:00 的符號表重畫。濾波器框內由上至下代表高、中、低頻；"
    "斜線劃除的是受到抑制的頻率。倍頻／分頻改變頻率，放大器改變訊號幅度。"
)
READING_MAP = (
    "第 2–3 頁：收發機全貌與射頻符號；第 4 頁：編碼與錯誤保護；"
    "第 5 頁：多工；第 6–7 頁：調變與星座圖；第 8 頁：選擇調變方式；"
    "第 9 頁：I/Q 實作；第 10 頁：自測與答案。"
)


@dataclass(frozen=True)
class Symbol:
    slug: str
    name: str
    english: str
    function: str


SYMBOLS = (
    Symbol("antenna", "天線", "Antenna", "在電訊號與空間電磁波之間轉換，是收發機的對外介面。"),
    Symbol("amplifier", "放大器（PA／LNA）", "Amplifier", "放大訊號；PA 位於傳送路徑，LNA 位於接收路徑。"),
    Symbol("mixer", "混頻器", "Mixer", "與參考載波（LO）相乘，產生和頻與差頻，用於升／降頻。"),
    Symbol("oscillator", "振盪器", "Oscillator", "提供混頻與調變所需的參考載波。"),
    Symbol("power-divider", "90° 分配器", "90° power divider", "將訊號分成兩路，兩路輸出相位相差 90°。"),
    Symbol("frequency-multiplier", "倍頻器", "Frequency multiplier", "將輸入頻率倍增；圖示以 ×2 為例。"),
    Symbol("frequency-divider", "分頻器", "Frequency divider", "將輸入頻率除以指定倍數；圖示以 ÷2 為例。"),
    Symbol("switch", "開關", "Switch", "接通、斷開或切換訊號路徑；圖示為開路狀態。"),
    Symbol("lpf", "低通濾波器 LPF", "Low-pass filter", "保留低頻成分，抑制較高頻成分。"),
    Symbol("bpf", "帶通濾波器 BPF", "Band-pass filter", "保留指定頻帶，抑制頻帶外的成分。"),
    Symbol("hpf", "高通濾波器 HPF", "High-pass filter", "保留高頻成分，抑制較低頻成分。"),
)


def line(x1, y1, x2, y2, **attributes):
    attrs = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attributes.items())
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {attrs}/>'


def arrow(x1, y1, x2, y2):
    angle = math.atan2(y2 - y1, x2 - x1)
    points = [(x2, y2)]
    for sign in (-1, 1):
        points.append((x2 - 6 * math.cos(angle) + sign * 3 * math.sin(angle),
                       y2 - 6 * math.sin(angle) - sign * 3 * math.cos(angle)))
    coords = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    return line(x1, y1, x2, y2) + f'<polygon points="{coords}" fill="#244452" stroke="none"/>'


def label(text, x=80, y=46, size=19):
    return (f'<text x="{x}" y="{y}" text-anchor="middle" font-family="sans-serif" '
            f'font-size="{size}" fill="#244452" stroke="none">{escape(text)}</text>')


def wave(x0, x1, y, cycles, amplitude):
    points = [f"{x0 + (x1 - x0) * i / 100:.2f},"
              f"{y - amplitude * math.sin(2 * math.pi * cycles * i / 100):.2f}"
              for i in range(101)]
    return f'<polyline points="{" ".join(points)}"/>'


def symbol_svg(symbol):
    s = symbol.slug
    if s == "antenna":
        drawing = '<path d="M 38 62 H 80 V 34 M 59 13 L 80 34 L 101 13"/>'
    elif s == "amplifier":
        drawing = (arrow(15, 40, 57, 40) + '<path d="M 57 17 L 105 40 L 57 63 Z"/>'
                   + arrow(105, 40, 145, 40))
    elif s == "mixer":
        drawing = (arrow(15, 35, 58, 35) + '<circle cx="80" cy="35" r="22"/>'
                   + '<path d="M 65 20 L 95 50 M 65 50 L 95 20"/>'
                   + arrow(102, 35, 145, 35) + arrow(80, 75, 80, 57)
                   + label("LO", 99, 76, 10))
    elif s == "oscillator":
        drawing = ('<circle cx="80" cy="40" r="22"/>' + wave(62, 98, 40, 1, 8)
                   + arrow(102, 40, 145, 40))
    elif s in {"power-divider", "frequency-multiplier", "frequency-divider"}:
        text = {"power-divider": "90°", "frequency-multiplier": "×2", "frequency-divider": "÷2"}[s]
        drawing = (arrow(15, 40, 55, 40) + '<rect x="55" y="18" width="50" height="44"/>'
                   + label(text) + arrow(105, 30, 145, 30) + arrow(105, 50, 145, 50))
        if s == "power-divider":
            drawing += label("0°", 133, 19, 10) + label("90°", 131, 68, 10)
    elif s == "switch":
        drawing = (arrow(15, 40, 55, 40) + '<rect x="55" y="16" width="50" height="48"/>'
                   + line(55, 40, 65, 40) + line(95, 40, 105, 40)
                   + '<circle cx="67" cy="40" r="2.5"/><circle cx="93" cy="40" r="2.5"/>'
                   + line(69, 39, 89, 25) + arrow(105, 40, 145, 40))
    else:
        drawing = (arrow(15, 40, 55, 40) + '<rect x="55" y="11" width="50" height="58"/>'
                   + arrow(105, 40, 145, 40))
        kept = {"lpf": 2, "bpf": 1, "hpf": 0}[s]
        for i, cycles in enumerate((3, 2, 1)):
            y = 24 + 16 * i
            drawing += wave(62, 98, y, cycles, 4)
            if i != kept:
                drawing += line(61, y + 6, 99, y - 6, stroke_width="2.6")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80">\n'
            f'<title>{escape(symbol.name)}</title><desc>{escape(symbol.function)}</desc>\n'
            '<rect width="160" height="80" fill="white"/>\n'
            '<g fill="none" stroke="#244452" stroke-width="2.1" stroke-linecap="round" '
            f'stroke-linejoin="round">{drawing}</g>\n</svg>\n')


def create_artwork():
    artwork = {}
    for symbol in SYMBOLS:
        svg = symbol_svg(symbol)
        base = IMAGES / f"001-rf-symbol-{symbol.slug}"
        base.with_suffix(".svg").write_text(svg, encoding="utf-8")
        with pdf.open("svg", svg.encode()) as drawing:
            base.with_suffix(".png").write_bytes(drawing[0].get_pixmap(matrix=pdf.Matrix(4, 4)).tobytes("png"))
            artwork[symbol.slug] = pdf.open("pdf", drawing.convert_to_pdf())
    return artwork


def unicode_cmap(data):
    """Read the bfchar and bfrange mappings used by these LaTeX PDFs."""
    mapping = {}
    for block in re.findall(r"beginbfchar(.*?)endbfchar", data, re.S):
        for source, target in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            char = bytes.fromhex(target).decode("utf-16-be")
            if len(char) == 1:
                mapping[int(source, 16)] = ord(char)
    for block in re.findall(r"beginbfrange(.*?)endbfrange", data, re.S):
        for start, end, target in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            for source in range(int(start, 16), int(end, 16) + 1):
                mapping[source] = int(target, 16) + source - int(start, 16)
    return mapping


def recovered_font(doc, xref):
    """Restore Unicode cmap tables stripped from the embedded TrueType fonts."""
    font = TTFont(io.BytesIO(doc.extract_font(xref)[3]), recalcTimestamp=False)
    glyphs = font.getGlyphOrder()
    unicode_ref = int(doc.xref_get_key(xref, "ToUnicode")[1].split()[0])
    mapping = unicode_cmap(doc.xref_stream(unicode_ref).decode("ascii"))
    descendant = int(re.search(r"\d+", doc.xref_get_key(xref, "DescendantFonts")[1]).group())
    kind, value = doc.xref_get_key(descendant, "CIDToGIDMap")
    gid_data = doc.xref_stream(int(value.split()[0])) if kind == "xref" else None
    cmap = {}
    for cid, codepoint in mapping.items():
        gid = int.from_bytes(gid_data[2 * cid:2 * cid + 2], "big") if gid_data else cid
        if 0 < gid < len(glyphs):
            cmap[codepoint] = glyphs[gid]
    cmap[32] = glyphs[3]  # The space glyph is omitted from the PDF ToUnicode map.
    # LaTeX also stripped its advance width; restore spacing between words.
    font["hmtx"].metrics[glyphs[3]] = (font["head"].unitsPerEm // 4, 0)
    table = CmapSubtable.newSubtable(4)
    table.platformID, table.platEncID, table.language = 3, 1, 0
    table.cmap = cmap
    font["cmap"] = newTable("cmap")
    font["cmap"].tableVersion = 0
    font["cmap"].tables = [table]
    output = io.BytesIO()
    font.save(output)
    return output.getvalue()


class Fonts:
    def __init__(self, doc, characters):
        available = doc[0].get_fonts()
        self.buffers = {}
        for name, suffix in (("rfRegular", "Regular"), ("rfBold", "Bold")):
            xref = next(f[0] for f in available if "MicrosoftJhengHei" in f[3] and f[3].endswith(suffix))
            self.buffers[name] = recovered_font(doc, xref)
        self.faces = {name: pdf.Font(fontbuffer=data) for name, data in self.buffers.items()}
        missing = {ord(c) for c in characters if any(not f.has_glyph(ord(c), fallback=False) for f in self.faces.values())}
        if missing:
            # Only newly introduced characters absent from the original subset
            # need a fallback. Embed a small subset of a full CJK font.
            fallback = Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc")
            if fallback.exists():
                font = TTFont(fallback, fontNumber=0, recalcTimestamp=False)
            else:
                font = TTFont(io.BytesIO(pdf.Font("cjk").buffer), recalcTimestamp=False)
            for tag in ("BDF ", "FFTM"):
                if tag in font:
                    del font[tag]
            sub = subset.Subsetter()
            sub.populate(unicodes=missing | {32})
            sub.subset(font)
            output = io.BytesIO()
            font.save(output)
            self.buffers["rfFallback"] = output.getvalue()
            self.faces["rfFallback"] = pdf.Font(fontbuffer=output.getvalue())
        self.resources = {name: name + hashlib.sha256(data).hexdigest()[:10]
                          for name, data in self.buffers.items()}

    def name(self, char, bold=False):
        preferred = "rfBold" if bold else "rfRegular"
        if self.faces[preferred].has_glyph(ord(char), fallback=False):
            return preferred
        if self.faces["rfFallback"].has_glyph(ord(char), fallback=False):
            return "rfFallback"
        raise ValueError(f"No glyph for {char!r}")

    def width(self, text, size, bold=False):
        return sum(self.faces[self.name(c, bold)].text_length(c, fontsize=size) for c in text)

    def text(self, page, point, text, size=10.9091, bold=False, color=(0, 0, 0)):
        x, y = point
        for name, run in self.runs(text, bold):
            resource = self.resources[name]
            page.insert_font(fontname=resource, fontbuffer=self.buffers[name])
            page.insert_text((x, y), run, fontname=resource, fontsize=size, color=color)
            x += self.faces[name].text_length(run, fontsize=size)

    def runs(self, text, bold):
        runs = []
        for char in text:
            name = self.name(char, bold)
            if runs and runs[-1][0] == name:
                runs[-1] = (name, runs[-1][1] + char)
            else:
                runs.append((name, char))
        return runs

    def paragraph(self, page, rect, text, size=10.9091, leading=15, color=(0, 0, 0)):
        lines, current = [], ""
        for token in re.findall(r"[A-Za-z0-9]+(?:[./_-][A-Za-z0-9]+)*|[^\S\n]+|.", text):
            if current and self.width(current + token, size) > rect.width:
                if token in "，。；：、）／":
                    moved, current = current[-1], current[:-1]
                    lines.append(current.rstrip())
                    current = moved + token
                else:
                    lines.append(current.rstrip())
                    current = token.lstrip()
            else:
                current += token
        if current:
            lines.append(current.rstrip())
        if len(lines) * leading > rect.height:
            raise ValueError(f"Text does not fit {rect}: {text}")
        for i, text_line in enumerate(lines):
            self.text(page, (rect.x0, rect.y0 + size + i * leading), text_line, size, color=color)
        return rect.y0 + len(lines) * leading


def erase(page, rect, graphics=False):
    page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions(images=0, graphics=1 if graphics else 0)


def spans(page):
    return [s for b in page.get_text("dict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"]]


def replace_span(page, fonts, span, text):
    rect = pdf.Rect(span["bbox"])
    erase(page, rect + (-0.1, -0.1, 0.1, 0.1))
    color = tuple(((span["color"] >> shift) & 255) / 255 for shift in (16, 8, 0))
    fonts.text(page, span["origin"], text, size=span["size"], bold="Bold" in span["font"], color=color)


def draw_table(page, fonts, artwork, symbols, top, row_height, size):
    x_name, x_icon, x_function = LEFT, 184, 281
    page.draw_line((LEFT, top), (RIGHT, top), width=0.8, color=INK)
    fonts.text(page, (x_name + 3, top + 13), "元件", size=size)
    fonts.text(page, (x_icon + 27, top + 13), "圖示", size=size)
    fonts.text(page, (x_function + 5, top + 13), "功能", size=size)
    y = top + 20
    page.draw_line((LEFT, y), (RIGHT, y), width=0.6, color=INK)
    for symbol in symbols:
        fonts.text(page, (x_name + 3, y + 14), symbol.name, size=size - 0.3)
        fonts.text(page, (x_name + 3, y + 27), symbol.english, size=size - 1.9, color=INK)
        page.show_pdf_page(pdf.Rect(x_icon + 10, y + 3, x_function - 10, y + row_height - 3), artwork[symbol.slug], 0)
        fonts.paragraph(page, pdf.Rect(x_function + 5, y + 5, RIGHT - 3, y + row_height - 2),
                        symbol.function, size=size, leading=14)
        y += row_height
        page.draw_line((LEFT, y), (RIGHT, y), width=0.35, color=(0.72, 0.77, 0.80))
    page.draw_line((LEFT, y), (RIGHT, y), width=0.8, color=INK)
    return y


def save_pdf(doc, path):
    temporary = path.with_suffix(".tmp.pdf")
    try:
        for page in doc:
            page.clean_contents(sanitize=True)
        doc.save(temporary, garbage=4, deflate=True, use_objstms=1)
        doc.close()
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def update_markdown():
    text = NOTE.read_text(encoding="utf-8")
    text = text.replace("[下載原始 PDF]", "[下載 PDF]")
    text = re.sub(r"(## 本單元的閱讀地圖\n\n)第 .*?自測與答案。", lambda m: m[1] + READING_MAP, text, count=1)
    rows = ["| 元件 | 圖示 | 功能 |", "|:-----|:----:|:-----|"]
    for symbol in SYMBOLS:
        image = (f'<img src="images/001-rf-symbol-{symbol.slug}.png" '
                 f'alt="{symbol.name}符號" width="120">')
        rows.append(f"| {symbol.name} {symbol.english} | {image} | {symbol.function} |")
    section = f"### 辨識射頻圖中的符號\n\n對照影片：[18:00 的符號表]({VIDEO})。\n\n"
    section += "\n".join(rows) + f"\n\n{EXPLANATION}\n\n"
    text, count = re.subn(r"### 辨識射頻圖中的符號\n.*?(?=影片中的手機例子)", lambda _: section, text, count=1, flags=re.S)
    if count != 1:
        raise ValueError("Chapter 1 symbol section not found.")
    text = text.replace("在第 3 頁的編碼方式下", "在第 4 頁的編碼方式下")
    NOTE.write_text(text, encoding="utf-8")

    index = INDEX_NOTE.read_text(encoding="utf-8")
    changed = bool(re.search(r"\|\s*01\|[^\n]*\| 9 頁", index))
    index = index.replace("[下載原始 PDF]", "[下載 PDF]")
    index = index.replace("原始 PDF", "PDF").replace("取得原始講義", "取得講義")
    index = index.replace("與PDF", "與 PDF").replace("對應PDF", "對應目前的 PDF")
    index = re.sub(r"(\|\s*01\|[^\n]*\| )9 頁", r"\g<1>10 頁", index)
    if changed:
        timestamp = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d %H:%M")
        index = re.sub(r"全套講義｜更新：[^\n]+", f"全套講義｜更新：{timestamp}（臺灣時間）", index)
    total = sum(len(pdf.open(path)) for path in (ROOT / "pdf").glob("*.pdf") if path != INDEX_PDF)
    # Chapter 1 is saved after the Markdown update on the first run.
    total += 10 - len(pdf.open(CHAPTER))
    index = re.sub(r"共 \d+ 頁", f"共 {total} 頁", index)
    INDEX_NOTE.write_text(index, encoding="utf-8")


def update_chapter(artwork):
    doc = pdf.open(CHAPTER)
    if len(doc) not in (9, 10) or (len(doc) == 10 and MARKER not in doc.metadata.get("keywords", "")):
        raise ValueError("Expected the original 9-page PDF or this script's 10-page revision.")
    map_paragraph = re.search(r"## 本單元的閱讀地圖\n\n([^\n]+)", NOTE.read_text(encoding="utf-8")).group(1)
    characters = map_paragraph + PHONE + EXPLANATION + "辨識射頻圖中的符號（續）元件圖示功能天線課程｜快速自學講義單元01｜基頻模組來源：陳晏笙老師「天線」開放式課程0123456789對照影片：18:00"
    characters += "".join(s.name + s.english + s.function for s in SYMBOLS)
    fonts = Fonts(doc, characters)
    if len(doc) == 10:
        doc.delete_page(2)
    erase(doc[0], pdf.Rect(LEFT - 1, 512, RIGHT + 1, 650))
    fonts.paragraph(doc[0], pdf.Rect(LEFT, 513.5, RIGHT, 650), map_paragraph, leading=14)

    page = doc[1]
    erase(page, pdf.Rect(LEFT - 1, 549, RIGHT + 1, 790), graphics=True)
    fonts.text(page, (LEFT, 564), "辨識射頻圖中的符號", size=11.9552, bold=True)
    draw_table(page, fonts, artwork, SYMBOLS[:5], top=574, row_height=38, size=10.2)

    continuation = doc.new_page(pno=2, width=595.28, height=841.89)
    fonts.text(continuation, (LEFT, 34), "天線課程｜快速自學講義", size=9.9626, color=(0.30, 0.37, 0.47))
    header = "單元01｜基頻模組"
    fonts.text(continuation, (RIGHT - fonts.width(header, 9.9626), 34), header, size=9.9626, color=(0.30, 0.37, 0.47))
    continuation.draw_line((LEFT, 37.5), (RIGHT, 37.5), width=0.4, color=(0.45, 0.48, 0.53))
    fonts.text(continuation, (LEFT, 76), "辨識射頻圖中的符號（續）", size=11.9552, bold=True)
    video_label = "對照影片：18:00 的符號表"
    fonts.text(continuation, (LEFT, 98), video_label, size=9.9626, color=BLUE)
    continuation.insert_link({"kind": pdf.LINK_URI, "from": pdf.Rect(LEFT, 86, LEFT + fonts.width(video_label, 9.9626), 102), "uri": VIDEO})
    bottom = draw_table(continuation, fonts, artwork, SYMBOLS[5:], top=116, row_height=50, size=10.9091)
    bottom = fonts.paragraph(continuation, pdf.Rect(LEFT, bottom + 20, RIGHT, bottom + 95), EXPLANATION, leading=15)
    fonts.paragraph(continuation, pdf.Rect(LEFT, bottom + 20, RIGHT, bottom + 100), PHONE, leading=15)
    fonts.text(continuation, (LEFT, 815.75), "來源：陳晏笙老師「天線」開放式課程", size=7.9701, color=(0.30, 0.37, 0.47))

    for i, page in enumerate(doc):
        existing = [s for s in spans(page) if s["text"].isdigit() and s["bbox"][1] > 780]
        for span in existing:
            erase(page, pdf.Rect(span["bbox"]) + (-0.1, -0.1, 0.1, 0.1))
        number = str(i + 1)
        fonts.text(page, (RIGHT - fonts.width(number, 9.9626), 809.415), number, size=9.9626)
    for span in spans(doc[9]):
        if re.search(r"在第[34] 頁的編碼方式下", span["text"]):
            replace_span(doc[9], fonts, span, re.sub(r"在第[34] 頁", "在第4 頁", span["text"]))
    metadata = doc.metadata
    metadata["keywords"] = MARKER
    metadata["modDate"] = datetime.now(ZoneInfo("Asia/Taipei")).strftime("D:%Y%m%d%H%M%S+08'00'")
    doc.set_metadata(metadata)
    save_pdf(doc, CHAPTER)


def update_index_pdf():
    text = INDEX_NOTE.read_text(encoding="utf-8")
    timestamp = re.search(r"全套講義｜更新：([^\n]+)", text).group(1)
    total = re.search(r"共 (\d+) 頁", text).group(1)
    doc = pdf.open(INDEX_PDF)
    fonts = Fonts(doc, timestamp + "全套講義｜更新：原課程28單元合計約32.6小時；已完成28份講義共頁10，已完成0123456789")
    for span in spans(doc[0]):
        if "全套講義｜更新：" in span["text"]:
            replace_span(doc[0], fonts, span, f"全套講義｜更新：{timestamp}")
        elif re.search(r"共\s*\d+\s*頁", span["text"]):
            new = re.sub(r"共\s*\d+\s*頁", f"共{total} 頁", span["text"])
            replace_span(doc[0], fonts, span, new)
    for span in spans(doc[1]):
        if span["bbox"][1] < 150 and re.match(r"(?:9|10)\s*頁，已完成", span["text"]):
            replace_span(doc[1], fonts, span, "10 頁，已完成")
    metadata = doc.metadata
    metadata["modDate"] = datetime.now(ZoneInfo("Asia/Taipei")).strftime("D:%Y%m%d%H%M%S+08'00'")
    doc.set_metadata(metadata)
    save_pdf(doc, INDEX_PDF)


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    # Validate the layout source before touching any output.
    with pdf.open(CHAPTER) as doc:
        if len(doc) not in (9, 10) or (len(doc) == 10 and MARKER not in doc.metadata.get("keywords", "")):
            raise ValueError("Unexpected Chapter 1 PDF; no outputs were written.")
    artwork = create_artwork()
    try:
        update_markdown()
        update_chapter(artwork)
        update_index_pdf()
    finally:
        for drawing in artwork.values():
            drawing.close()
    print("Updated 11 SVG/PNG symbols, Chapter 1 Markdown/PDF (10 pages), and the course index.")


if __name__ == "__main__":
    main()
