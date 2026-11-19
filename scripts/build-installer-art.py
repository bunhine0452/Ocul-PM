#!/usr/bin/env python3
"""Windows 설치 파일(NSIS)의 그림 두 장을 굽는다 (2026-11-19, 수동 실행 — 결과 BMP 만 커밋한다).

    python scripts/build-installer-art.py            # Windows (Segoe UI Semibold)
    OCUL_ART_FONT=/path/to/font.ttf python3 scripts/build-installer-art.py

결과 (src-tauri/windows/, tauri.windows.conf.json 의 bundle.windows.nsis 가 가리킨다):
  installer-sidebar.bmp  164×314  환영 · 마침 쪽 왼편 — 앱 캔버스 아이보리(--bg-sidebar) 위에 아이콘 + 「Ocul」
  installer-header.bmp   150×57   나머지 쪽 머리 오른편 — 앱 안 업데이트가 띄우는 작은 진행 창도 이것을 쓴다

MUI 표준 크기의 24비트 BMP 다. 4배로 그려 LANCZOS 로 줄인다(글자 가장자리). 아이콘(src-tauri/icons/icon.png)이나
브랜드 색을 바꿨을 때만 다시 돌린다. Pillow 가 필요하다 (pip install pillow).
"""
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "src-tauri" / "icons" / "icon.png"
OUT = ROOT / "src-tauri" / "windows"

S = 4  # 슈퍼샘플 배율
IVORY = (241, 238, 230)  # tokens.css --bg-sidebar
INK = (38, 34, 28)
ACCENT = (14, 138, 96)  # tokens.css --accent
WHITE = (255, 255, 255)
WORD = "Ocul"


def font_path() -> str:
    env = os.environ.get("OCUL_ART_FONT")
    if env:
        return env
    for p in ("C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/segoeuib.ttf"):
        if Path(p).exists():
            return p
    sys.exit("글꼴을 못 찾았어요 — OCUL_ART_FONT 로 굵은 산세리프 .ttf 경로를 주세요")


def flatten(im: Image.Image, bg: tuple) -> Image.Image:
    base = Image.new("RGBA", im.size, bg + (255,))
    base.alpha_composite(im)
    return base.convert("RGB")


def sidebar(icon: Image.Image, font: str) -> Image.Image:
    w, h = 164 * S, 314 * S
    rule = 2 * S  # 흰 쪽과 가르는 오른쪽 액센트 줄
    im = Image.new("RGBA", (w, h), IVORY + (255,))
    d = ImageDraw.Draw(im)
    d.rectangle([w - rule, 0, w, h], fill=ACCENT + (255,))
    size = 96 * S
    x, y = (w - rule - size) // 2, 74 * S
    im.alpha_composite(icon.resize((size, size), Image.LANCZOS), (x, y))
    f = ImageFont.truetype(font, 30 * S)
    bb = d.textbbox((0, 0), WORD, font=f)
    d.text(((w - rule - (bb[2] - bb[0])) // 2 - bb[0], y + size + 14 * S - bb[1]), WORD, font=f, fill=INK + (255,))
    return flatten(im.resize((164, 314), Image.LANCZOS), IVORY)


def header(icon: Image.Image, font: str) -> Image.Image:
    w, h = 150 * S, 57 * S
    im = Image.new("RGBA", (w, h), WHITE + (255,))
    d = ImageDraw.Draw(im)
    size, pad = 38 * S, 10 * S
    x, y = w - pad - size, (h - size) // 2
    im.alpha_composite(icon.resize((size, size), Image.LANCZOS), (x, y))
    f = ImageFont.truetype(font, 17 * S)
    bb = d.textbbox((0, 0), WORD, font=f)
    d.text((x - 6 * S - (bb[2] - bb[0]) - bb[0], (h - (bb[3] - bb[1])) // 2 - bb[1]), WORD, font=f, fill=INK + (255,))
    return flatten(im.resize((150, 57), Image.LANCZOS), WHITE)


def main() -> None:
    icon = Image.open(ICON).convert("RGBA")
    font = font_path()
    sidebar(icon, font).save(OUT / "installer-sidebar.bmp")
    header(icon, font).save(OUT / "installer-header.bmp")
    print(f"구웠어요: {OUT / 'installer-sidebar.bmp'} · {OUT / 'installer-header.bmp'}")


if __name__ == "__main__":
    main()
