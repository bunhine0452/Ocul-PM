#!/usr/bin/env python3
"""Pretendard Variable → UI 본문용 woff2 서브셋 빌더 (수동 실행, 결과물만 커밋된다).

    pnpm install                                  # devDep 인 pretendard 를 받아온 뒤
    python3 scripts/build-pretendard-subset.py    # 기본 경로 자동 탐색

왜 이 스크립트가 필요한가
-------------------------
npm `pretendard` 패키지가 주는 선택지는 둘 다 이 앱에 맞지 않는다.

  - `woff2/PretendardVariable.woff2` (2.06MB) — 한자(CJK Unified Ideographs)와
    가나까지 통째로 들고 있다. 한국어 개발 도구 UI 에서 한자는 거의 안 나오고,
    나와도 시스템 폰트(Apple SD Gothic Neo)가 이어받으면 그만이다.
  - `woff2-dynamic-subset/` (92파일 3.0MB) — 브라우저가 필요한 조각만 받는
    구조라 웹에서는 좋지만, 데스크톱 앱은 폰트가 이미 로컬 파일이라 지연 로드
    이득이 없고 .app 번들만 3MB 로 불어난다.

그래서 D2Coding 과 같은 방식으로 직접 서브셋한다 (scripts/build-d2coding-subset.py).
한자·가나를 덜어내고 한글 완성형은 11,172자 전부 남긴다 — 사용자가 만드는 일지
제목·프로젝트명에 어떤 음절이 올지 알 수 없어서, KS X 1001 2,350자로 줄이면 드문
음절만 다른 폰트로 튀어 단어 중간에서 서체가 갈린다.

가변 축(wght 45~930)은 반드시 유지한다. 이게 이 교체의 핵심 이유다 — 정적 SUITE
7종을 쓰던 시절 CSS 의 `font-weight: 550` / `650` 선언 96개가 이웃 굵기(600/700)로
스냅되어 의도한 굵기로 렌더된 적이 없었다. 가변 폰트에서는 그대로 동작한다.

커버리지 근거
-------------
라틴+기호+자모/전각만 = 69KB, 여기에 한글 완성형을 더하면 1,724KB. 즉 용량은
사실상 전부 한글이고, 한자를 빼는 것이 유일하게 의미 있는 절감이다 (2.06MB→1.72MB).
Block Elements·박스드로잉은 넣지 않는다 — 터미널은 Menlo/D2Coding 스택이 따로
담당하고(App.css 참고), 본문 UI 에는 나오지 않는다.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "assets" / "fonts" / "Pretendard-subset.woff2"
DEFAULT_SRC = (
    REPO / "node_modules" / "pretendard" / "dist" / "web" / "variable" / "woff2"
    / "PretendardVariable.woff2"
)

# 유니코드 범위. 각 줄의 주석이 "왜 필요한가" 다 — 근거 없는 범위는 넣지 않는다.
RANGES = [
    ("0020-007E", "기본 라틴 (영문·숫자·기호)"),
    ("00A0-00FF", "라틴-1 보충 (é ü ñ °· ± × ÷)"),
    ("0100-017F", "라틴 확장-A (유럽어 인명/패키지명)"),
    ("2000-206F", "일반 구두점 (— ' ' \" \" … • ‰)"),
    ("20A0-20BF", "통화 기호 (₩ € ₿)"),
    ("2100-214F", "문자꼴 기호 (™ № ℃ ℹ)"),
    ("2190-21FF", "화살표 (← → ↑ ↓ ⇧ ⇥) — UI 크롬·단축키 표기"),
    ("2200-22FF", "수학 연산자 (∞ ≈ ≠ ≤ ≥ ∑)"),
    ("25A0-25FF", "기하 도형 (● ■ ▲ ▶ ◆) — 상태 배지·불릿"),
    ("3000-303F", "CJK 구두점 (「」『』〜)"),
    ("1100-11FF", "한글 자모"),
    ("3130-318F", "한글 호환 자모 (ㄱ ㄴ ㅏ) — 조합 중 IME 표시"),
    ("AC00-D7A3", "한글 완성형 11,172자 (전량 유지)"),
    ("FF00-FFEF", "전각/반각 폼"),
]


def expand(spec: str) -> list[int]:
    """"AC00-D7A3" 또는 "20A9" 형태를 코드포인트 리스트로 편다."""
    if "-" in spec:
        lo, hi = spec.split("-")
        return list(range(int(lo, 16), int(hi, 16) + 1))
    return [int(spec, 16)]


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        print(f"원본을 찾을 수 없습니다: {src}", file=sys.stderr)
        print("pnpm install 로 devDependency 인 pretendard 를 먼저 받으세요.", file=sys.stderr)
        return 1

    font = TTFont(src)
    if "fvar" not in font:
        print("가변 폰트가 아닙니다 — wght 축이 있는 PretendardVariable 을 주세요.", file=sys.stderr)
        return 1

    before_glyphs = len(font.getGlyphOrder())
    axes = [(a.axisTag, a.minValue, a.maxValue) for a in font["fvar"].axes]

    codepoints: list[int] = []
    for spec, _why in RANGES:
        codepoints.extend(expand(spec))

    options = Options()
    options.flavor = "woff2"
    # notdef 아웃라인 유지: 커버리지 밖 글리프가 빈칸이 아니라 두부(□)로 보여야
    # 폰트 폴백이 안 걸린 자리를 개발 중에 눈으로 잡아낼 수 있다.
    options.notdef_outline = True

    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)

    # 가변 축이 서브셋 과정에서 날아가면 이 교체의 목적 자체가 사라진다 —
    # 조용히 정적 폰트를 커밋하는 사고를 막기 위해 단언으로 못박는다.
    assert "fvar" in font, "서브셋 후 fvar(가변 축)가 사라졌습니다"
    assert "gvar" in font, "서브셋 후 gvar(가변 글리프)가 사라졌습니다"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(OUT)

    size_kb = OUT.stat().st_size / 1024
    print(f"원본      : {src}")
    print(f"가변 축   : {axes}")
    print(f"글리프    : {before_glyphs:,} → {len(font.getGlyphOrder()):,}")
    print(f"출력      : {OUT.relative_to(REPO)}  {size_kb:,.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
