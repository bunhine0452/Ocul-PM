import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, read, walk } from "./designFs";

// ─── 디자인 래칫 — "나빠지지 않는다" 만 지킨다 ──────────────────────────────
//
// 계약(`design_tokens.test.ts`)과 갈라 둔 이유: 이 파일의 숫자들은 **고쳐야 할
// 빚의 잔액**이지 지켜야 할 규칙이 아니다. 줄면 숫자를 내려 적고, 늘면 왜
// 늘었는지를 설명해야 한다. 둘을 한 파일에 두면 "이 expect 는 계약인가
// 잔액인가" 를 매번 다시 읽게 된다 (그리고 그 파일이 810줄로 크기 래칫에
// 걸렸다 — 쪼갤 자리를 크기가 아니라 뜻이 정했다).

// ─── EmptyState/LoadingState 밀도 계약 — 래칫 (2026-09-09) ─────────────────
//
// `{#layout-empty-density}`: 호출부 50곳 중 **20곳**이 인라인 padding 으로
// `.es--plain` 의 60px 을 덮고 있었다. 기본값이 지배적 용법에 안 맞으면 호출부가
// 매번 되돌리고, 되돌리는 값은 자리마다 갈린다 — 실측이 그 증거였다:
// 16 · "16px" · "24px 8px" · "24px 16px" · "18px 16px" · "16px 20px" · "8px 0" ·
// "6px 2px" 여덟 가지.
//
// 그중 **최빈값이 정확히 16px(10곳)** 이고 그건 램프의 --space-6 이다. 그
// 10곳만 `density="compact"` 로 옮겼다 — 계산값이 같으니 시각 변화 0이다.
// 남은 10곳은 램프 밖이라 접으면 2~8px 씩 움직인다: 눈으로 보고 정할 일이라
// 인라인으로 남기고 여기서 동결한다.
describe("빈 상태·로딩 밀도", () => {
  const CALL = /<(?:Empty|Loading)State\b[^>]*\bstyle=/g;

  it("밀도를 인라인으로 덮는 호출부가 **늘지** 않는다", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!/\.tsx$/.test(file)) continue;
      const n = (readFileSync(file, "utf8").match(CALL) ?? []).length;
      if (n) offenders.push(`${file.slice(ROOT.length + 1)} ×${n}`);
    }
    const total = offenders.reduce((a, o) => a + Number(o.split("×")[1]), 0);
    // 줄이면 이 숫자를 내려 적을 것. 새 밀도가 필요하면 인라인이 아니라
    // `density` 한 단을 더하는 쪽이다 — 그게 이 항목이 세운 규약이다.
    expect(total, `인라인 밀도 ${total}곳 — ${offenders.join(" · ")}`).toBeLessThanOrEqual(10);
  });

  it("세 밀도가 CSS 와 컴포넌트 양쪽에 있다", () => {
    const css = read("styles/empty.css");
    for (const cls of ["es--plain", "es--compact", "es--rich"]) {
      expect(css, `${cls} 가 empty.css 에 없다`).toContain(`.${cls} {`);
    }
    // LoadingState 는 `rich` 를 갖지 않는다 — 아이콘·제목·행동이 있는 로딩은 없다.
    const ls = read("components/LoadingState.tsx");
    expect(ls).toContain('density?: "plain" | "compact"');
  });
});

// ─── 여백 램프 채택 — 래칫 (2026-09-09) ────────────────────────────────────
describe("여백", () => {
  const RAMP = new Set([4, 6, 8, 10, 12, 16, 20, 24]);
  const PROP = /\b(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?\s*:\s*([^;{}]+)/g;

  function offRamp(): Map<number, number> {
    const hist = new Map<number, number>();
    for (const file of walk(join(ROOT))) {
      if (!file.endsWith(".css") || file.endsWith("styles/tokens.css")) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const m of css.matchAll(PROP)) {
        for (const mm of m[1].matchAll(/(?<![-\w.])(\d+)px/g)) {
          const v = Number(mm[1]);
          // 1~3px 은 헤어라인 보정이지 여백 스케일이 아니다 — 램프가 4px 에서 시작한다.
          if (v >= 4 && !RAMP.has(v)) hist.set(v, (hist.get(v) ?? 0) + 1);
        }
      }
    }
    return hist;
  }

  it("램프 밖 여백이 **늘지** 않는다", () => {
    // 2026-09-09: 램프에 정확히 맞는 892곳을 토큰으로 옮겼다(시각 변화 0인 순수
    // 개명). 남은 469곳은 램프 밖이라 옮기면 1~2px 씩 움직여 눈으로 볼 일이었다.
    //
    // 2026-09-10 {#ramp-space}: 사용자가 **수렴**을 골랐다 — 램프를 넓히면
    // 저단이 2px 격자 연속값이 되어 "7px 인가 8px 인가" 를 다시 고르게 된다.
    // 최상위 셋(5·105 · 7·87 · 9·87)을 6·8·10 으로 올려 267곳을 옮겼다.
    // 올림인 이유: 여백은 **중첩되며 누적**된다(카드 padding 안의 행 gap 안의
    // 항목 padding). 전부 내리면 세 겹에서 3px 이 빠져 눈에 띄게 조인다.
    // 컨트롤 높이({#ramp-height})가 내림인 것과 반대인데, 높이는 중첩되지 않고
    // 이 앱이 밀도 도구라서다.
    //
    // 남은 202곳: 11·13·14·17·18·21·22(152)는 이번 결정의 대상이 아니었고,
    // 24 초과(38)는 페이지 여백이라 이 램프의 구간(4~24) 밖이다. 결합된
    // 11곳(calc·음수 여백·트리 들여쓰기 산술)도 남겼다 — 거기서 여백은
    // 선택이 아니라 계산이다.
    // 줄이면 이 숫자를 내려 적을 것.
    const hist = offRamp();
    const total = [...hist.values()].reduce((a, b) => a + b, 0);
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    expect(total, `램프 밖 여백 ${total}곳 — 최상위 ${JSON.stringify(top)}`).toBeLessThanOrEqual(202);
  });
});

// ─── 검색칸 두 단 — 계약 (2026-09-10 {#unify-search-input}) ────────────────
//
// 래칫이 아니라 계약이라 여기 있는 게 어색하지만, 이 파일이 이미 "디자인
// 스위트" 의 작은 쪽이고 `design_tokens.test.ts` 는 733줄로 800 래칫에
// 가깝다 — 55줄을 얹으면 다음 사람이 계약 하나 더할 자리가 없어진다.
//
// 게이트(check-design-discipline 규칙 17)가 "상자를 다시 적었다" 를 잡고,
// 여기서는 **두 단이 실제로 존재하는가** 를 잡는다. 게이트만 있으면 누가
// `.sm` 을 지워도 조용히 통과한다 (호출부는 그냥 30px 이 된다).
describe("검색칸", () => {
  const css = read("styles/primitives.css");

  it("두 단이 정의 자리에 있다", () => {
    expect(css, "기본 단(.search-box) 이 없다").toMatch(/^\.search-box \{$/m);
    expect(css, "촘촘한 단(.search-box.sm) 이 없다").toMatch(/^\.search-box\.sm \{$/m);
    // 높이는 이 두 줄에만 있어야 하고, **리터럴이 아니라 램프**여야 한다
    // (2026-09-10 {#ramp-height} 이후 — 그전에는 30px/26px 리터럴이었다).
    const heights = [...css.matchAll(/\.search-box(?:\.sm)?\s*\{[^}]*?\bheight:\s*([^;]+)/g)].map((m) => m[1].trim());
    expect(heights.sort()).toEqual(["var(--ctl-3)", "var(--ctl-4)"]);
  });

  it("호출부는 상자를 다시 적지 않는다", () => {
    // 접힌 열한 벌의 이름. 살아남은 클래스는 폭·여백·표면만 갖는다.
    const FOLDED = [
      "cfg-search", "pm-search", "sk-shop-search", "gr-search", "ctx-search",
      "diff-search", "dfl-filter", "entry-filelist-filter", "code-filter", "pln-rail-search",
    ];
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!file.endsWith(".css") || file.endsWith("styles/primitives.css")) continue;
      const body = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim();
        if (!FOLDED.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(sel))) continue;
        // 곡률·바탕·높이는 단이 갖는다. 표면(`background`)만은 자리의 것이다 —
        // 플래너 레일은 자기 배경이 투명이라 면을 지워야 한다.
        for (const prop of ["height", "border-radius"]) {
          if (new RegExp(`(?:^|[;{\\s])${prop}\\s*:`).test(m[2])) offenders.push(`${sel} { ${prop} }`);
        }
      }
    }
    expect(offenders, `상자를 다시 적은 곳: ${offenders.join(" · ")}`).toEqual([]);
  });
});

// ─── 읽기 열 폭 — 래칫 (2026-09-10 {#layout-widths}) ───────────────────────
//
// 실측은 항목이 센 다섯이 아니라 **일곱**이었다(720 · 760 · 780 · 820 · 860 ·
// 880 + 페이지 셸 1180). 빠져 있던 넷: `.sk-hooks`(720) · `.disc-doc-prose`
// (780) · `.cfg-main`(780) · `.sk-article`(820).
//
// 값이 정확히 맞는 다섯 자리만 토큰으로 옮겼다(시각 변화 0): `.ai-thread-inner`
// · `.composer` · `.sk-shop` → --read-narrow, `.pln-doc` · `.search-results` →
// --read-wide. 남은 여섯은 접으면 20~120px 씩 움직여 눈으로 보고 정할 일이라
// 여기서 동결한다 — {#ramp-space} 와 같은 형태의 이월이다.
describe("읽기 열 폭", () => {
  it("두 단이 토큰으로 있다", () => {
    const tokens = read("styles/tokens.css");
    expect(tokens).toContain("--read-narrow: 760px;");
    expect(tokens).toContain("--read-wide: 880px;");
  });

  it("램프 밖 읽기 폭이 **늘지** 않는다", () => {
    // 700~1000px 만 읽기 열이다. 그 위(.ctx-page 1040 · .pm-sheet 1080 ·
    // .page 1180 · .home-wrap 1560)는 읽는 열이 아니라 **창/시트 자체의
    // 상한**이라 두 단으로 접을 대상이 아니다 — 목록이 아니라 경계로 적는다.
    const READING_MAX = 1000;
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!file.endsWith(".css")) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim();
        // @media/@container 조건의 max-width 는 폭이 아니라 **접히는 선**이다.
        if (sel.startsWith("@")) continue;
        const w = /(?:^|[;{\s])max-width:\s*(\d+)px/.exec(m[2]);
        if (!w) continue;
        const v = Number(w[1]);
        if (v < 700 || v > READING_MAX) continue;
        offenders.push(`${sel.split("\n").pop()!.trim()}=${v}`);
      }
    }
    // 줄이면 이 숫자를 내려 적을 것. 새 읽기 열은 리터럴이 아니라 두 단 중 하나다.
    expect(offenders.length, `램프 밖 읽기 폭 ${offenders.length}곳 — ${offenders.join(" · ")}`).toBeLessThanOrEqual(6);
  });
});

// ─── 칩 두 단 — 계약 (2026-09-10 {#unify-chips}) ───────────────────────────
//
// 게이트(규칙 20)는 "허용된 두 곡률 중 하나인가" 만 본다. 여기서는 더 강한 것,
// **어느 쪽인지가 크는 방식과 맞는가**를 본다 — 게이트만 있으면 고정 높이 칩이
// 전부 알약이 되어도 통과한다.
describe("칩", () => {
  const FIXED_ONLY = "var(--radius-s)";
  const GROWS_ONLY = "var(--radius-pill)";

  it("높이가 정해진 칩은 상자, 패딩으로 크는 칩은 알약", () => {
    const wrong: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!file.endsWith(".css")) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim().split("\n").pop()!.trim();
        const last = sel.split(/\s+/).pop() ?? "";
        if (!/\.(?:chip|attach-chip|agent-chip|gr-chip|scope-chip|file-pill|tbadge)(?![\w-])/.test(last)) continue;
        // `.chip.sm` 은 문서화된 예외 — 가장 작은 단은 알약이다.
        if (/\.chip\.sm\b/.test(last)) continue;
        const r = /(?:^|[;{\s])border-radius:\s*([^;]+)/.exec(m[2]);
        if (!r) continue;
        const hasHeight = /(?:^|[;{\s])height:\s*/.test(m[2]);
        const want = hasHeight ? FIXED_ONLY : GROWS_ONLY;
        if (r[1].trim() !== want) wrong.push(`${sel} → ${r[1].trim()} (기대: ${want})`);
      }
    }
    expect(wrong, wrong.join(" · ")).toEqual([]);
  });

  it("아이콘 버튼은 램프에서 두 단만 가져간다", () => {
    const prim = read("styles/primitives.css");
    const sizes = [...prim.matchAll(/--iconbtn-size:\s*([^;]+)/g)].map((m) => m[1].trim());
    expect(new Set(sizes)).toEqual(new Set(["var(--ctl-4)", "var(--ctl-3)"]));
  });
});

// ─── 드릴다운 머리 — 계약 (2026-09-10 {#unify-drilldown}) ──────────────────
//
// 일지 드릴다운은 처음부터 `<Toolbar>` 의 leading/title/sub 로 그렸는데, 스킬
// 드릴다운만 `.sk-head` 라는 자기 머리를 갖고 있어 크롬이 52→60px 로 튀었다.
// 뒤로가기 화살표도 일곱 자리 중 여섯이 15 인데 일지 하나만 18 이었다.
describe("드릴다운 머리", () => {
  it("화면 머리를 대신하는 자기 헤더가 없다", () => {
    // `.sk-head` 처럼 `<Toolbar>` 자리를 차지하는 규칙이 다시 생기면 걸린다.
    const css = read("features/skills/skills.css");
    expect(css).not.toMatch(/^\.sk-head \{/m);
  });

  it("뒤로가기 화살표는 한 크기다", () => {
    const sizes = new Set<string>();
    for (const file of walk(join(ROOT))) {
      if (!/\.tsx$/.test(file)) continue;
      for (const m of readFileSync(file, "utf8").matchAll(/<ArrowLeft\s+size=\{(\d+)\}/g)) {
        sizes.add(m[1]);
      }
    }
    expect([...sizes], `뒤로가기 화살표 크기: ${[...sizes].join(" · ")}`).toEqual(["15"]);
  });
});

// ─── 좌측 목록 열 — 계약 (2026-09-10 {#layout-widths}) ─────────────────────
//
// 같은 일을 하는 세 열이 264 · 284 · 288 이었다. 항목은 "264·284·288·320" 이라
// 했는데 320 은 없고 실제 네 번째는 `.acp-panel`(244)이다 — 그리고 그건 왼쪽
// 목록 열이 아니라 오른쪽에서 밀려 나오는 세션 패널이라 대상이 아니다.
describe("좌측 목록 열", () => {
  it("세 열이 한 토큰을 쓴다", () => {
    expect(read("styles/tokens.css")).toContain("--panel-w: 284px;");
    expect(read("features/code/code.css")).toMatch(/\.code-sidebar\s*\{[^}]*width: var\(--panel-w\)/);
    expect(read("features/discussion/discussion.css")).toMatch(/\.disc-list\s*\{[^}]*width: var\(--panel-w\)/);
    expect(read("styles/screens.css")).toContain("grid-template-columns: var(--panel-w) 1fr");
  });
});
