#!/usr/bin/env python3
"""D2Coding → 터미널용 woff2 서브셋 빌더 (수동 실행, 결과물만 커밋된다).

    python3 scripts/build-d2coding-subset.py [D2Coding.ttc 경로]

왜 이 스크립트가 필요한가
-------------------------
내장 터미널(xterm.js)의 폰트 스택은 라틴·기호·박스문자를 **Menlo**(advance
0.60205em = 1233/2048)에 맡기고 한글만 D2Coding 으로 그린다. xterm 은 셀 폭을
스택 선두 폰트로 재므로 셀 = 0.60205em 이고, 한글은 정확히 두 셀(1.2041em)을
차지해야 한다. 그런데 D2Coding 의 한글 advance 는 1.0em 이라 두 셀에 못 미친다.

이전에는 CSS `size-adjust: 120.4%` 로 맞췄는데, size-adjust 는 advance 뿐 아니라
**글리프 자체를 20.4% 확대**한다 — 한 줄 안에서 한글만 라틴/숫자보다 크게 보이는
원인이었다. CSS 로는 advance 만 늘릴 방법이 없으므로, 폰트 파일의 hmtx 를 직접
Menlo 그리드로 재작성한다:

    advance 500(반각)  → 602,  글리프 +51 이동
    advance 1000(전각) → 1204, 글리프 +102 이동

글리프 아웃라인은 원본 크기 그대로 두고 늘어난 폭의 절반씩 좌우로 나눠 중앙에
놓는다. 결과적으로 한글은 두 셀에 정확히 맞으면서 라틴과 같은 광학 크기를 갖는다.

컴포지트 안전성: 이 서브셋 범위의 컴포지트는 전부 자신과 **같은 폭 등급**의
컴포넌트만 참조하고(검증됨, 아래 assert) 전부 xy 오프셋 방식이다. 따라서 심플
글리프만 이동시키면 컴포지트는 컴포넌트를 따라 정확히 한 번만 이동한다 —
컴포넌트 오프셋을 따로 건드리면 이중 이동이 된다.

커버리지는 이전 서브셋(PR-R5 E1)과 동일하다: Latin + 일반 구두점 + 화살표 +
박스드로잉 + 한글 완성형/호환 자모 + CJK 구두점 + 전각. Block Elements(█▀░) ·
Geometric Shapes(●■) · Dingbats(✓) 는 일부러 뺀다 — 터미널에선 Menlo 가 그 범위를
전부 커버하고, 여기 넣으면 오히려 unicode-range 밖에서 폭이 어긋난다.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "assets" / "fonts" / "D2Coding-term.woff2"
DEFAULT_SRC = Path.home() / "Library" / "Fonts" / "D2Coding-Ver1.3.2-20180524-all.ttc"

# Menlo advance(1233/2048) ÷ D2Coding 반각 advance(0.5em).
SCALE = (1233 / 2048) / 0.5

# 이전 서브셋과 동일한 커버리지.
RANGES = [
    (0x0020, 0x007E), (0x00A0, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153),
    (0x2000, 0x200B), (0x2010, 0x2023), (0x2025, 0x2026), (0x202F, 0x2037),
    (0x2039, 0x203F), (0x2042, 0x2042), (0x2044, 0x2049), (0x204B, 0x204E),
    (0x2051, 0x2051), (0x205F, 0x205F), (0x2190, 0x21FF), (0x2500, 0x257F),
    (0x3000, 0x3003), (0x3008, 0x3019), (0x301C, 0x301C), (0x301E, 0x3020),
    (0x3036, 0x3036), (0x3131, 0x318E), (0xAC00, 0xD7A3), (0xFF01, 0xFF5E),
    (0xFFE0, 0xFFE3), (0xFFE5, 0xFFE6),
]


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        print(f"원본 폰트를 찾을 수 없습니다: {src}", file=sys.stderr)
        print("D2Coding .ttc 경로를 인자로 넘기세요.", file=sys.stderr)
        return 1

    font = TTFont(src, fontNumber=0)  # 0 = Regular, 1 = Bold

    options = Options()
    options.hinting = False  # 웹폰트는 CoreText/Skia 가 자체 래스터라이즈 — 힌트 불필요
    options.desubroutinize = False
    options.layout_features = []
    options.name_IDs = ["*"]
    options.notdef_outline = False
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=[c for a, b in RANGES for c in range(a, b + 1)])
    subsetter.subset(font)

    glyf, hmtx = font["glyf"], font["hmtx"]

    # 1) 심플 글리프 아웃라인 이동 + advance 재작성.
    #    컴포지트는 건드리지 않는다 (컴포넌트를 따라 자동으로 같은 폭만큼 움직인다).
    #    폭 등급 검증은 재작성 전 원본 값으로 해야 한다 — 루프가 hmtx 를 갱신하므로.
    orig_adv = {name: hmtx[name][0] for name in font.getGlyphOrder()}
    for name in font.getGlyphOrder():
        old_adv = orig_adv[name]
        new_adv = round(old_adv * SCALE)
        dx = (new_adv - old_adv) // 2
        glyph = glyf[name]
        if glyph.isComposite():
            for comp in glyph.components:
                assert hasattr(comp, "x"), f"{name}: 포인트 매칭 컴포지트 — 이동 불가"
                assert orig_adv[comp.glyphName] == old_adv, f"{name}: 폭 등급이 다른 컴포넌트"
        elif glyph.numberOfContours > 0 and dx:
            glyph.coordinates.translate((dx, 0))
        hmtx[name] = (new_adv, hmtx[name][1] + dx)

    # 2) bbox 재계산 후 lsb 를 xMin 에 일치시킨다 (glyf 규격).
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        if glyph.numberOfContours != 0:
            hmtx[name] = (hmtx[name][0], glyph.xMin)

    advances = [hmtx[n][0] for n in font.getGlyphOrder()]
    font["hhea"].advanceWidthMax = max(advances)
    font["OS/2"].xAvgCharWidth = round(sum(advances) / len(advances))

    font.flavor = "woff2"
    font.save(OUT)
    print(f"{OUT.relative_to(REPO)} — {OUT.stat().st_size / 1024:.0f} KB, "
          f"{len(font.getGlyphOrder())} glyphs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
