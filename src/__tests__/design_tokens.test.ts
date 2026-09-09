import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ─── 완성도 라운드 Phase 5 — 디자인 토큰 계약 ─────────────────────────────
//
// 토큰은 CSS 라 타입 검사가 없다. 이 스위트가 "한 곳에서 정의되고, 화면은
// fallback 없이 참조한다" 는 계약을 파일 수준에서 지킨다.

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "legacy" || name === "__tests__") continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|css)$/.test(name)) yield full;
  }
}

describe("tokens.css — 상태색·스케일·층·프로젝트 팔레트가 한 곳에 있다", () => {
  const tokens = read("styles/tokens.css");
  const root = tokens.slice(0, tokens.indexOf('[data-theme="dark"] {'));
  const dark = tokens.slice(tokens.indexOf('[data-theme="dark"] {'));

  it("상태색 4가족 × (본색·text·soft) 이 라이트·다크 양쪽에 있다", () => {
    for (const fam of ["ok", "warn", "danger", "info"]) {
      for (const suffix of ["", "-text", "-soft"]) {
        const re = new RegExp(`--${fam}${suffix}:\\s*[^;]+;`);
        expect(root, `light --${fam}${suffix}`).toMatch(re);
        expect(dark, `dark --${fam}${suffix}`).toMatch(re);
      }
    }
    expect(root).toMatch(/--claude:\s*#d97757;/);
  });

  it("글자 13단 · 여백 8단 · 층 8단 · 이징 3종", () => {
    // 0~12 — 3.0 {#fs-scale-up} 이 양 끝을 늘렸다 (9px 메타 · 14~26px 제목).
    for (let i = 0; i <= 12; i++) expect(root).toMatch(new RegExp(`--fs-${i}:\\s*[0-9.]+px;`));
    for (let i = 1; i <= 8; i++) expect(root).toMatch(new RegExp(`--space-${i}:\\s*\\d+px;`));
    for (const z of ["sticky", "strip", "panel", "dock", "menu", "popover", "modal", "top"]) {
      expect(root).toMatch(new RegExp(`--z-${z}:\\s*\\d+;`));
    }
    for (const e of ["ease-out", "ease-in-out", "ease-spring"]) expect(root).toMatch(new RegExp(`--${e}:`));
  });

  it("글자 램프는 단조 증가한다 — 뒤집히면 위계가 거짓말이 된다", () => {
    const sizes = [...Array(13).keys()].map((i) => {
      const m = root.match(new RegExp(`--fs-${i}:\\s*([0-9.]+)px;`));
      expect(m, `--fs-${i}`).toBeTruthy();
      return Number(m![1]);
    });
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `--fs-${i} > --fs-${i - 1}`).toBeGreaterThan(sizes[i - 1]);
    }
    // 여백은 4px 격자 위에 있다 (App.css 의 Tailwind --spacing 과 같은 격자).
    for (let i = 1; i <= 8; i++) {
      const m = root.match(new RegExp(`--space-${i}:\\s*(\\d+)px;`));
      expect(Number(m![1]) % 2, `--space-${i}`).toBe(0);
    }
  });

  it("프로젝트 색 8종은 tokens.css 의 [data-pc] 한 곳뿐이다", () => {
    const light = tokens.match(/^\[data-pc="\w+"\]\s*\{ --pc: #/gm) ?? [];
    const darkPal = tokens.match(/^\[data-theme="dark"\] \[data-pc="\w+"\]\s*\{ --pc: #/gm) ?? [];
    expect(light).toHaveLength(8);
    expect(darkPal).toHaveLength(8);
    expect(read("features/onboarding/home.css")).not.toMatch(/--pc:\s*#/);
    expect(read("styles/tabs.css")).not.toMatch(/--pc:\s*#/);
  });
});

describe("화면은 토큰을 fallback 없이 참조한다", () => {
  it("var(--ok, #…) 같은 fallback 이 남아 있지 않다", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (file.endsWith("bindings.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (/var\(--(ok|warn|danger|info)(-text|-soft)?,/.test(src)) offenders.push(file.slice(ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});

// ─── v2.41 {#design-whitelist} — 색 리터럴은 팔레트 층에만 ────────────────
//
// 예전 규칙은 hex **여섯 개**를 스팟체크했다. 커버리지 규칙이 아니라 과거에
// 한 번 걸렸던 값들의 블랙리스트라, 그 뒤에 새로 새어 나간 것들은 전부 통과했다
// — `#cb7b5d`(shell) · `#16161c`(screens) · 액센트 배경 위 `#fff` 넷 ·
// hljs GitHub 팔레트 · `var(--accent-uncommitted, #c4922f)` fallback.
//
// 뒤집는다: **팔레트 층 밖의 CSS 에는 색 리터럴을 쓰지 않는다.** 팔레트 층은
// 셋뿐이고(tokens.css · App.css 의 shadcn 블록 · code.css), 그 밖에서 색이
// 필요하면 토큰을 만든다. 예외는 아래 목록에 **사유와 함께** 적고, 목록이
// 길어지면 규칙이 무의미해지므로 개수 자체를 이 스위트가 센다.

/** 팔레트 층 — 여기서만 색이 태어난다. */
const PALETTE_LAYERS = new Set(["styles/tokens.css", "App.css"]);

/**
 * 명시 예외. 한 줄 = 한 사유. **늘리지 말고 줄이는 방향으로만.**
 * `file` 은 파일 이름 그대로거나, 사유가 파일이 아니라 **선언의 종류**에 걸려
 * 있을 때는 정규식(마스크 스텐실이 그렇다). `selector` 는 그 hex 를 품은 규칙의
 * 셀렉터(직전 `{` 앞 줄), `line` 은 선언 줄.
 */
const HEX_EXCEPTIONS: { file: string | RegExp; selector?: RegExp; line?: RegExp; reason: string }[] = [
  {
    file: "features/code/code.css",
    reason:
      "CodeMirror 편집기의 상호작용 색(선택·검색 일치)과, tokens.css 로 옮겨 가기 전 " +
      "남아 있는 문법 팔레트 한 벌. 문법 색의 정본은 이제 tokens.css 다 ({#hljs-unify}).",
  },
  {
    file: "components/bootsplash.css",
    line: /var\(--[\w-]+,\s*#/,
    reason:
      "부트 스플래시는 테마 CSS 가 붙기 전 **첫 페인트**다 — 토큰이 아직 없을 때 " +
      "보이는 안전값이라 fallback 이 곧 존재 이유다.",
  },
  {
    // 2026-09-05 — `styles/agent.css` 한정이던 것을 스타일시트 전체로 넓혔다.
    // 사이드바 nav 목록이 넘칠 때의 가장자리 페이드(shell.css .side-nav-scroll)가
    // 같은 관용구를 쓰면서 예외가 하나 더 필요해졌는데, 목록 상한이 5라 늘릴 수
    // 없었다. 늘리는 대신 **판별자를 제자리로 돌려놨다**: 이 예외를 정당화하는
    // 것은 어느 파일이냐가 아니라 `mask-image:` 라는 선언 자체다. 마스크는
    // 알파만 읽히므로 어느 파일에 있든 색을 칠하지 않는다.
    file: /\.css$/,
    line: /mask-image:/,
    reason:
      "마스크 스텐실 — 색이 아니라 알파(불투명 → 투명)다. 화면에 칠해지지 않으므로 " +
      "토큰화할 대상이 아니고, 파일이 아니라 선언의 종류가 사유다.",
  },
  {
    file: "styles/agent.css",
    selector: /\.lightbox/,
    reason:
      "이미지 라이트박스는 어느 테마에서도 어둡다(사진 뷰어 관용구). 표면 토큰을 쓰면 " +
      "다크 가족에서 흰 스크림이 되고, 그 위 닫기 버튼도 흰색이 맞다.",
  },
];

/** 규칙의 셀렉터를 따라가며 hex 를 품은 줄을 모은다 (주석은 지운다). */
function scanHex(src: string): { line: number; selector: string; text: string }[] {
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const out: { line: number; selector: string; text: string }[] = [];
  let selector = "";
  let pending = "";
  bare.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line.includes("{")) {
      selector = (pending + " " + line.slice(0, line.indexOf("{"))).trim();
      pending = "";
    } else if (line.endsWith(",")) {
      pending += " " + line;
    } else if (line === "}") {
      pending = "";
    }
    // 한 줄 규칙(`.x { color: #fff }`)은 선언 부분만 남긴다 — 셀렉터가 두 번
    // 찍히면 보고가 읽히지 않고, `line` 정규식이 셀렉터에 걸릴 수도 있다.
    const text = line.includes("{") ? line.slice(line.indexOf("{") + 1).trim() : line;
    if (/#[0-9a-fA-F]{3,8}\b/.test(text)) out.push({ line: i + 1, selector, text });
  });
  return out;
}

/** 예외의 `file` 이 이 파일에 걸리는가 — 문자열이면 정확히, 정규식이면 매치. */
function fileHit(pat: string | RegExp, name: string): boolean {
  return typeof pat === "string" ? pat === name : pat.test(name);
}

describe("색 리터럴은 팔레트 층에만 있다 — 화이트리스트", () => {
  const files = [...walk(join(ROOT))].filter((f) => f.endsWith(".css"));
  const rel = (f: string) => f.slice(ROOT.length + 1);

  it("팔레트 층 밖에는 예외 목록에 적힌 것만 남는다", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const name = rel(file);
      if (name === "features/code/code.css") continue; // 파일 통째 예외 (아래에서 센다)
      for (const hit of scanHex(readFileSync(file, "utf8"))) {
        // 팔레트 층에서는 **커스텀 프로퍼티 선언**만 색을 낳을 수 있다.
        // (`color: var(--x, #hex)` 같은 fallback 은 여기서도 위반이다.)
        if (PALETTE_LAYERS.has(name) && /--[\w-]+\s*:/.test(hit.text)) continue;
        const excused = HEX_EXCEPTIONS.some(
          (e) =>
            fileHit(e.file, name) &&
            (!e.selector || e.selector.test(hit.selector)) &&
            (!e.line || e.line.test(hit.text)),
        );
        if (!excused) offenders.push(`${name}:${hit.line}  ${hit.selector} { ${hit.text} }`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("예외는 다섯 줄을 넘지 않는다 — 늘어나면 규칙이 무의미해진다", () => {
    // 각 예외가 실제로 무엇을 몇 줄 봐주는지 세어, 죽은 예외도 함께 잡는다.
    const covered = new Map<number, number>();
    for (const file of files) {
      const name = rel(file);
      for (const hit of scanHex(readFileSync(file, "utf8"))) {
        HEX_EXCEPTIONS.forEach((e, i) => {
          if (!fileHit(e.file, name)) return;
          if (e.selector && !e.selector.test(hit.selector)) return;
          if (e.line && !e.line.test(hit.text)) return;
          covered.set(i, (covered.get(i) ?? 0) + 1);
        });
      }
    }
    expect(HEX_EXCEPTIONS.length).toBeLessThanOrEqual(5);
    // 아무것도 안 봐주는 예외는 지운다 — 목록이 유물이 되지 않게.
    for (const [i, e] of HEX_EXCEPTIONS.entries()) {
      expect(covered.get(i) ?? 0, `죽은 예외 #${i}: ${e.file} — ${e.reason}`).toBeGreaterThan(0);
    }
  });

  it("모든 예외에 사유가 적혀 있다", () => {
    for (const e of HEX_EXCEPTIONS) expect(e.reason.length).toBeGreaterThan(30);
  });
});

// ─── 3.0 {#hljs-unify} — 문법 색은 한 팔레트에서만 태어난다 ────────────────
//
// 예전엔 같은 코드가 편집기에선 보라, 변경/일지 화면에선 빨강이었다. 아래
// 셋을 못박는다: (1) 토큰이 라이트·다크에 다 있다, (2) 프리셋 5종이 전부
// 다시 칠한다, (3) hljs 규칙은 색을 **직접 쓰지 않는다**.

const SYNTAX_TOKENS = ["kw", "str", "comment", "num", "fn", "type", "prop", "def", "op"] as const;

describe("문법 강조 — --code-* 한 팔레트", () => {
  const tokens = read("styles/tokens.css");
  const root = tokens.slice(0, tokens.indexOf('[data-theme="dark"] {'));
  const dark = tokens.slice(tokens.indexOf('[data-theme="dark"] {'));

  it("라이트·다크에 아홉 색 + --code-fg 가 있다", () => {
    expect(root).toMatch(/--code-fg:\s*var\(--text\);/);
    for (const name of SYNTAX_TOKENS) {
      expect(root, `light --code-${name}`).toMatch(new RegExp(`--code-${name}:\\s*#`));
      expect(dark, `dark --code-${name}`).toMatch(new RegExp(`--code-${name}:\\s*#`));
    }
  });

  it("프리셋 5종이 전부 다시 칠한다 — 그러지 않으면 Nord 위에 GitHub 색이 뜬다", () => {
    for (const preset of ["solarized", "sepia", "nord", "dracula", "high-contrast"]) {
      // 두 번째 블록(문법 전용)만 본다 — 첫 블록은 내장 테마 JSON 의 생성 원본이다.
      const blocks = tokens.split(`[data-preset="${preset}"] {`);
      expect(blocks.length, `${preset} 블록 수`).toBe(3);
      const syntax = blocks[2].slice(0, blocks[2].indexOf("}"));
      for (const name of SYNTAX_TOKENS) {
        expect(syntax, `${preset} --code-${name}`).toMatch(new RegExp(`--code-${name}:\\s*#`));
      }
    }
  });

  it("문법 토큰은 내장 테마 JSON 의 생성 원본(첫 블록)엔 없다 — 두 번째 블록 전용이다", () => {
    // {#code-tokens-theme-schema} 이후 --code-* 는 백엔드 화이트리스트 **안**이라
    // 내려받은 커스텀 테마는 지정할 수 있다. 여기서 안 새는 이유는 화이트리스트가
    // 아니라 `gen-builtin-themes.mjs` 가 프리셋마다 **첫 블록만** 읽어서다 —
    // 문법색은 둘째(문법 전용) 블록에만 있으니 내장 5종의 JSON 은 그대로 31개다.
    for (const preset of ["solarized", "sepia", "nord", "dracula", "high-contrast"]) {
      const first = tokens.split(`[data-preset="${preset}"] {`)[1];
      expect(first.slice(0, first.indexOf("}")), preset).not.toContain("--code-");
    }
  });

  it("hljs 규칙은 색 대신 토큰을 읽는다", () => {
    const screens = read("styles/screens.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const hljsLines = screens.split("\n").filter((l) => l.trimStart().startsWith(".hljs"));
    expect(hljsLines.length).toBeGreaterThan(10);
    for (const line of hljsLines) expect(line, line).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // 추가/삭제 줄은 문자열 색이 아니라 변경 팔레트를 쓴다 — 같은 화면의 diff 와 같은 색.
    expect(screens).toMatch(/\.hljs-addition \{ color: var\(--diff-add-text\); \}/);
    expect(screens).toMatch(/\.hljs-deletion \{ color: var\(--diff-del-text\); \}/);
  });
});

// ─── 3.0 {#claude-coral-unify} — 코랄은 한 값이다 ──────────────────────────
describe("Claude 코랄", () => {
  it("--claude 와 CLAUDE_ORANGE 가 같은 값이다", () => {
    const token = read("styles/tokens.css").match(/--claude:\s*(#[0-9a-f]{6});/)![1];
    const mark = read("components/ClaudeMark.tsx").match(/CLAUDE_ORANGE = "(#[0-9a-f]{6})"/)![1];
    expect(mark).toBe(token);
  });

  /**
   * "Claude 를 뜻하는 색" 이 이 셋 말고 더 생기면 여기서 걸린다. 2026-09-06 에
   * 네 번째 주황(`#d97a4f`)이 에이전트 스와치와 프로바이더 점 두 곳에 있었다 —
   * 1% 차이라 눈으로는 못 잡는다.
   *
   * `agentColor.ts` 의 `PALETTE` 는 **해시 버킷**이라 일부러 뺐다. 뜻이 다르면
   * 값이 같아도 한 자리에 두지 않는다 (거기 색은 "모르는 에이전트"의 색이다).
   */
  it("Claude 를 뜻하는 다른 자리도 같은 코랄이다", () => {
    const token = read("styles/tokens.css").match(/--claude:\s*(#[0-9a-f]{6});/)![1];
    const swatch = read("features/today/agentColor.ts").match(
      /"claude-code":\s*"(#[0-9a-f]{6})"/,
    )![1];
    const provider = read("features/chat/AiPanelScreenV2.tsx").match(
      /anthropic: \{[^}]*color: "(#[0-9a-f]{6})"/,
    )![1];
    expect(swatch).toBe(token);
    expect(provider).toBe(token);
  });
});

// ─── 3.0 {#palette-claude-collision} — 해시 버킷 팔레트가 코랄과 안 겹친다 ───
//
// "모르는 에이전트" 색(agentColor.ts 의 PALETTE, 해시 버킷)과 "Claude" 색
// (coral)은 뜻이 달라서 값을 통일할 수 없다 — 그런데 2026-09-06 까지
// PALETTE[0](#d97a4f)이 코랄(#d97757)과 RGB 거리 8.5(1% 차이)라 육안으로
// 구별이 안 됐다. 값 자체가 아니라 "충분히 멀다" 를 숫자로 못박는다.
describe("agentColor 팔레트 — 코랄과 색이 겹치지 않는다", () => {
  function rgb(hex: string): [number, number, number] {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  function rgbDistance(a: string, b: string): number {
    const [ar, ag, ab] = rgb(a);
    const [br, bg, bb] = rgb(b);
    return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
  }

  const claude = read("styles/tokens.css").match(/--claude:\s*(#[0-9a-f]{6});/)![1];
  const paletteSrc = read("features/today/agentColor.ts").match(/const PALETTE = \[([^\]]+)\];/)![1];
  const palette = paletteSrc.match(/#[0-9a-fA-F]{6}/g)!;

  it("해시 버킷 색 여섯 개 전부 코랄과 RGB 거리 20 이상이다", () => {
    expect(palette.length).toBe(6);
    for (const hex of palette) {
      expect(rgbDistance(hex, claude), `${hex} vs 코랄 ${claude}`).toBeGreaterThanOrEqual(20);
    }
  });
});

// ─── 3.0 {#modal-chrome-unify} — 스크림 한 벌, 모달 크롬 한 벌 ─────────────
describe("모달 크롬", () => {
  const prim = read("styles/primitives.css");
  const screens = read("styles/screens.css");

  // 2026-09-09: 계약이 한 단 강해졌다. 전에는 "두 번째 스크림이 .scrim 과 **같은
  // 바탕**을 쓴다" 였는데, 셸을 AppDialog 한 벌로 접으면서 그 이름 자체가 없어졌다.
  // 이름이 하나면 "이 모달만 프리셋을 안 따른다" 가 구조적으로 불가능해진다.
  it("스크림이 한 벌이다 — .set-modal-backdrop 은 되살아나지 않는다", () => {
    // 주석은 뺀다 — 왜 사라졌는지는 두 파일 모두 주석으로 남겨 두었다.
    const bare = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [name, css] of [["primitives.css", prim], ["screens.css", screens]] as const) {
      expect(bare(css), `${name} 에 두 번째 스크림이 생겼다`).not.toMatch(/\.set-modal-backdrop/);
    }
    expect(prim).toMatch(/^\.scrim \{/m);
  });

  it("제목·설명·버튼 줄이 한 벌이다", () => {
    expect(prim).toMatch(/\.sk-modal-head,\n\.set-modal-title \{/);
    expect(prim).toMatch(/\.sk-modal-warn,\n\.set-modal-desc \{/);
    expect(prim).toMatch(/\.sk-modal-foot,\n\.set-modal-actions \{/);
    // screens.css 에는 간격만 남는다.
    expect(screens).not.toMatch(/\.set-modal-title \{[^}]*font-size/);
  });
});

// ─── 3.0 {#theme-inline-scale} — Tailwind 유틸리티가 우리 램프를 읽는다 ────
describe("@theme inline", () => {
  const app = read("App.css");
  it("text-xs~3xl 이 --fs-* 를 가리킨다", () => {
    for (const [util, fs] of [
      ["xs", 5],
      ["sm", 7],
      ["base", 8],
      ["lg", 9],
      ["xl", 10],
      ["2xl", 11],
      ["3xl", 12],
    ] as const) {
      expect(app, `--text-${util}`).toMatch(new RegExp(`--text-${util}:\\s*var\\(--fs-${fs}\\);`));
    }
  });
  it("Tailwind 여백이 4px 격자에 못박혀 있다", () => {
    expect(app).toMatch(/--spacing:\s*4px;/);
  });
  it("z 유틸리티가 tokens.css 의 여덟 층을 읽는다", () => {
    for (const z of ["sticky", "strip", "panel", "dock", "menu", "popover", "modal", "top"]) {
      expect(app, `--z-index-${z}`).toMatch(new RegExp(`--z-index-${z}:\\s*var\\(--z-${z}\\);`));
    }
  });
});

describe("primitives.css — 아이콘 버튼 3크기 · 칩 수정자, 전역 로드", () => {
  const prim = read("styles/primitives.css");
  it("아이콘 버튼 크기 3단과 옛 이름 7벌이 같은 바탕을 쓴다", () => {
    expect(prim).toMatch(/\.iconbtn\.sm, \.pln-iconbtn \{ --iconbtn-size: 26px; \}/);
    expect(prim).toMatch(/\.iconbtn\.md, [^{]*\{ --iconbtn-size: 28px; \}/);
    expect(prim).toMatch(/\.iconbtn\.lg, \.sk-iconbtn \{ --iconbtn-size: 32px; \}/);
    for (const name of ["pln-iconbtn", "pm-iconbtn", "gr-iconbtn", "home-iconbtn", "sk-iconbtn", "side-collapse-btn", "code-tool-btn"]) {
      expect(prim, name).toContain(`.${name}`);
    }
  });
  it("칩 수정자 — sm/outline/accent/ok/warn/danger/info", () => {
    for (const mod of ["sm", "outline", "accent", "ok", "warn", "danger", "info"]) {
      expect(prim).toMatch(new RegExp(`\\.chip\\.${mod} \\{`));
    }
  });
  it("App.css 가 primitives 를 전역으로 들이고 index.css 는 다시 들이지 않는다", () => {
    expect(read("App.css")).toMatch(/@import "\.\/styles\/primitives\.css";/);
    expect(read("styles/index.css")).not.toMatch(/primitives\.css";/);
  });
});

describe("App.css — 죽은 토큰·클래스가 되살아나지 않는다", () => {
  const app = read("App.css");
  it.each(["--cat-fix", "--motion-fast", "--accent-recent-change", ".glassy-sidebar", "--editor-bg", ".code-editor-textarea"])(
    "%s 는 없다",
    (needle) => {
      expect(app).not.toContain(needle);
    },
  );
  it("EB Garamond 의존성이 없다", () => {
    expect(read("../package.json")).not.toContain("eb-garamond");
  });
});

// ─── v2.41 {#design-whitelist} — 대비를 눈이 아니라 숫자가 지킨다 ──────────
//
// 왜 필요한가: 설계 SSOT(`docs/Lite-update/Fianl_UI_update_before1.0/
// 03-design-system.md` §6)의 대비 매트릭스는 **손으로 적은 표**라 낡았다.
// 2026-07-16 전면 리스킨이 표면·글자·액센트를 전부 갈았는데 표는 그대로였고,
// 그 사이 `--text-3` 은 여섯 테마 전부에서 AA 미달인 채 382곳에 쓰였다.
//
// 이 스위트는 표를 **매번 다시 계산한다**. tokens.css 를 파싱해 테마별로
// 캐스케이드를 흉내 내고, 실제 값끼리 WCAG 2.x 상대휘도 대비를 잰다.
// 손댈 곳은 이 파일이 아니라 tokens.css 다.

const TOKENS = read("styles/tokens.css");

// ─── WCAG 2.x 상대휘도 / 대비 ────────────────────────────────────────────
function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const round = (n: number) => Math.round(n * 100) / 100;

// ─── tokens.css → 셀렉터별 커스텀 프로퍼티 ────────────────────────────────
/** `selector { --a: v; --b: v }` 블록을 전부 모은다 (주석 제거 후). */
function parseBlocks(css: string): Map<string, Record<string, string>> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, Record<string, string>>();
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    const decls: Record<string, string> = {};
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const key = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      if (key.startsWith("--") && value) decls[key] = value;
    }
    if (Object.keys(decls).length > 0) out.set(selector, { ...out.get(selector), ...decls });
  }
  return out;
}
const BLOCKS = parseBlocks(TOKENS);

/** 셀렉터 사슬을 순서대로 겹쳐 "그 테마에서 실제로 풀리는 값" 을 만든다. */
function resolve(chain: string[]): Record<string, string> {
  const acc: Record<string, string> = {};
  for (const sel of chain) {
    const block = BLOCKS.get(sel);
    expect(block, `tokens.css 에 \`${sel}\` 블록이 없다`).toBeTruthy();
    Object.assign(acc, block);
  }
  return acc;
}

const DARK = '[data-theme="dark"]';
/** 프리셋 → 바탕 가족. `SettingsContext.PRESET_FAMILY` 와 같은 표. */
const PRESET_FAMILY: Record<string, "light" | "dark"> = {
  solarized: "light",
  sepia: "light",
  nord: "dark",
  dracula: "dark",
  "high-contrast": "dark",
};
/** `data-accent` 팔레트 6종 중 5종 (green 은 바탕값이라 블록이 없다). */
const ACCENTS = ["blue", "purple", "orange", "rose", "teal"];

type Theme = { name: string; tokens: Record<string, string> };

const THEMES: Theme[] = [
  { name: "light", tokens: resolve([":root"]) },
  { name: "dark", tokens: resolve([":root", DARK]) },
  ...Object.entries(PRESET_FAMILY).map(([id, family]) => ({
    name: `preset:${id}`,
    tokens: resolve(family === "dark" ? [":root", DARK, `[data-preset="${id}"]`] : [":root", `[data-preset="${id}"]`]),
  })),
  ...ACCENTS.flatMap((a) => [
    { name: `accent:${a}/light`, tokens: resolve([":root", `[data-accent="${a}"]`]) },
    { name: `accent:${a}/dark`, tokens: resolve([":root", DARK, `${DARK}[data-accent="${a}"]`]) },
  ]),
];

/** 글자가 얹히는 표면 다섯 — 가장 불리한 하나가 그 토큰의 실력이다. */
const SURFACES = ["--bg-window", "--bg-sidebar", "--bg-content", "--bg-card", "--bg-inset"] as const;

function worstOnSurfaces(t: Theme, token: string): { ratio: number; surface: string } {
  let worst = { ratio: Infinity, surface: "" };
  for (const s of SURFACES) {
    const r = contrast(t.tokens[token], t.tokens[s]);
    if (r < worst.ratio) worst = { ratio: r, surface: s };
  }
  return worst;
}

describe("글자 램프는 어느 테마에서도 읽힌다", () => {
  it.each(THEMES.map((t) => [t.name, t] as const))("%s", (_name, t) => {
    // `--text` / `--text-2` 는 본문이다 — AA(4.5:1).
    for (const token of ["--text", "--text-2", "--accent-text"] as const) {
      const { ratio, surface } = worstOnSurfaces(t, token);
      expect(round(ratio), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    // `--text-3` 은 meta/placeholder 전용이라 AA 를 요구하지 않는다. 다만
    // "보이긴 해야 한다" 의 하한은 4.0 — 2026-09-04 이전엔 2.18~3.93 이었다.
    const t3 = worstOnSurfaces(t, "--text-3");
    expect(round(t3.ratio), `--text-3 on ${t3.surface}`).toBeGreaterThanOrEqual(4.0);
  });

  it("램프가 뒤집히지 않는다 — text > text-2 > text-3", () => {
    for (const t of THEMES) {
      const on = (k: string) => contrast(t.tokens[k], t.tokens["--bg-content"]);
      expect(on("--text"), `${t.name} text vs text-2`).toBeGreaterThan(on("--text-2"));
      expect(on("--text-2"), `${t.name} text-2 vs text-3`).toBeGreaterThan(on("--text-3"));
    }
  });
});

describe("상태색 배경 위의 글자 — {#hardcoded-white}", () => {
  // 앰버·레드 배지의 글자. 흰색은 어느 테마에서도 4.5 를 못 넘겨서 토큰이 생겼다.
  it.each([
    ["--on-warn", ["--t-error", "--warn"]],
    ["--on-danger", ["--t-bug", "--danger"]],
  ] as const)("%s", (ink, backgrounds) => {
    for (const t of THEMES) {
      for (const bg of backgrounds) {
        const r = contrast(t.tokens[ink], t.tokens[bg]);
        expect(round(r), `${t.name}: ${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("--knob 은 on 상태에서 --text-on-accent 로 바뀐다 (노브 규칙의 근거)", () => {
    // off 트랙(--bg-active)은 알파라 계산 대상이 아니다. on 트랙(--accent)만 잰다.
    for (const t of THEMES) {
      expect(t.tokens["--knob"], `${t.name}`).toBe("#ffffff");
    }
  });
});

// ─── 알려진 미달 — 고치는 게 아니라 **나빠지지 않게** 붙잡는다 ─────────────
//
// `--text-on-accent` / `--accent` 는 라이트 가족 액센트 팔레트에서 구조적으로
// AA 를 못 넘긴다: 흰 글자가 밝은 액센트 위에 얹히기 때문이고, 고치려면
// 액센트 팔레트(12값)를 다시 조율해야 한다 — 3.0 {#v3-surface} 몫이다.
// 여기 적힌 수치보다 **나빠지면** 실패한다. 좋아졌으면 표를 낮춰 적을 것.
const ON_ACCENT_FLOOR: Record<string, number> = {
  light: 4.35,
  dark: 7.98,
  "preset:solarized": 3.41,
  "preset:sepia": 3.94,
  "preset:nord": 6.24,
  "preset:dracula": 5.9,
  "preset:high-contrast": 14.67,
  "accent:blue/light": 4.7,
  "accent:blue/dark": 5.71,
  "accent:purple/light": 4.76,
  "accent:purple/dark": 5.81,
  "accent:orange/light": 3.0,
  "accent:orange/dark": 7.33,
  "accent:rose/light": 3.83,
  "accent:rose/dark": 5.18,
  "accent:teal/light": 3.42,
  "accent:teal/dark": 8.97,
};

describe("--text-on-accent / --accent — 알려진 미달의 래칫", () => {
  it("모든 테마가 표에 있다 (새 팔레트를 추가하면 여기도 적는다)", () => {
    expect(THEMES.map((t) => t.name).sort()).toEqual(Object.keys(ON_ACCENT_FLOOR).sort());
  });

  it("어느 테마도 적힌 값보다 나빠지지 않는다", () => {
    const report: string[] = [];
    for (const t of THEMES) {
      const r = round(contrast(t.tokens["--text-on-accent"], t.tokens["--accent"]));
      expect(r, `${t.name} 이 표(${ON_ACCENT_FLOOR[t.name]})보다 나빠졌다`).toBeGreaterThanOrEqual(
        ON_ACCENT_FLOOR[t.name],
      );
      if (r < 4.5) report.push(`${t.name} ${r}`);
    }
    // 미달 목록이 **늘면** 실패한다 — 줄면 이 숫자를 내려 적을 것.
    expect(report.length, `AA 미달: ${report.join(" · ")}`).toBeLessThanOrEqual(6);
  });
});

// ─── shadcn 어휘는 ui_v2 토큰의 별칭이다 (2026-09-09 일관성 라운드) ─────────
//
// 2026-07-16 리스킨부터 2026-09-08 까지 App.css 는 프리셋 7블록에 shadcn 이름의
// hex 를 **손으로** 옮겨 적었다. 두 표가 나란히 있으면 갈라진다 — 실측:
//
//   Nord      --text-2 #d8dee9  vs  --muted-foreground #aab4c4
//   Solarized --text   #47585e  vs  --foreground       #586e75
//   라이트     --bg-card #ffffff vs  --card             #fdfcf9
//
// ui_v2 스타일시트가 shadcn 어휘를 173곳 참조하므로 두 팔레트는 한 창에서
// 동시에 렌더된다. 별칭으로 바꾼 뒤로는 위의 "글자 램프는 어느 테마에서도
// 읽힌다" 가 shadcn 쪽까지 자동으로 보증한다 — **별칭이 유지되는 한**.
// 이 스위트가 지키는 게 그 전제다.
describe("shadcn 어휘는 ui_v2 토큰의 별칭이다", () => {
  const app = read("App.css");
  /** shadcn 이름 → 그것이 뜻하는 ui_v2 토큰. 값이 아니라 **의미**의 짝이다. */
  const ALIAS: Record<string, string> = {
    "--background": "--bg-window",
    "--foreground": "--text",
    "--card": "--bg-card",
    "--card-foreground": "--text",
    "--popover": "--bg-card",
    "--popover-foreground": "--text",
    "--primary": "--accent",
    "--primary-foreground": "--text-on-accent",
    "--secondary": "--bg-inset",
    "--secondary-foreground": "--text",
    "--muted": "--bg-inset",
    "--muted-foreground": "--text-2",
    "--accent-surface": "--bg-active",
    "--accent-foreground": "--text",
    "--destructive": "--danger",
    "--border": "--sep",
    "--input": "--sep-strong",
    "--ring": "--accent",
    "--sidebar": "--bg-sidebar",
    "--sidebar-foreground": "--text",
    "--sidebar-primary": "--accent",
    "--sidebar-primary-foreground": "--text-on-accent",
    "--sidebar-accent": "--bg-active",
    "--sidebar-accent-foreground": "--text",
    "--sidebar-border": "--sep",
    "--sidebar-ring": "--accent",
  };

  const appBlocks = parseBlocks(app);

  it("모든 shadcn 색 이름이 정확히 그 ui_v2 토큰의 별칭이다", () => {
    const root = appBlocks.get(":root") ?? {};
    for (const [name, target] of Object.entries(ALIAS)) {
      expect(root[name], `App.css :root 에 ${name} 이 없다`).toBeTruthy();
      expect(root[name]?.replace(/\s+/g, ""), `${name}`).toBe(`var(${target})`);
    }
  });

  it("별칭이 가리키는 토큰은 tokens.css 에 실재한다", () => {
    for (const target of new Set(Object.values(ALIAS))) {
      expect(TOKENS, `tokens.css 에 ${target} 정의가 없다`).toMatch(
        new RegExp(`${target}\\s*:\\s*[^;]+;`),
      );
    }
  });

  // 되돌아오는 방식은 하나다: "이 프리셋만 다르게" 하려고 블록을 다시 여는 것.
  // 그러면 그 프리셋에서만 두 팔레트가 갈라지고, 눈으로는 안 보인다.
  it("다크·프리셋 블록이 shadcn 이름을 다시 선언하지 않는다", () => {
    const offenders: string[] = [];
    for (const [selector, decls] of appBlocks) {
      if (selector === ":root") continue;
      if (!/\[data-(theme|preset|accent)=/.test(selector)) continue;
      for (const name of Object.keys(decls)) {
        if (name in ALIAS) offenders.push(`${selector} { ${name} }`);
      }
    }
    expect(offenders, `별칭을 덮어쓰는 블록: ${offenders.join(" · ")}`).toEqual([]);
  });
});

// ─── 램프 채택 — 비활성 흐림은 한 단이다 (2026-09-09) ──────────────────────
describe("비활성 흐림", () => {
  it("`:disabled` 규칙이 opacity 리터럴을 쓰지 않는다", () => {
    // 실측 0.32 · 0.35 · 0.4 · 0.45 · 0.5 · 0.55 여섯 단이었고, 같은 툴바에서
    // `.btn:disabled`(0.5) 와 `.iconbtn:disabled`(0.32) 가 눈에 띄게 달랐다.
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!file.endsWith(".css")) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]*\{)([^{}]*)\}/g)) {
        if (!/disabled/.test(m[1])) continue;
        if (/opacity:\s*[0-9.]/.test(m[2])) {
          offenders.push(`${file.slice(ROOT.length + 1)} — ${m[1].trim().slice(0, 60)}`);
        }
      }
    }
    expect(offenders, `--dim-disabled 를 쓸 것:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("--dim-disabled 는 한 곳에서만 정의된다", () => {
    const defs = [...TOKENS.matchAll(/--dim-disabled:/g)];
    expect(defs).toHaveLength(1);
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
    // 개명). 남은 480곳은 램프 밖 값이라 옮기면 1~2px 씩 움직인다 — 5px(108) ·
    // 7px(88) · 9px(88) 이 최상위이고, 이 셋은 --space 의 저단(4·6·8·10)이
    // 2px 격자인데 그 사이에 낀 값들이다.
    //
    // 램프에 5·7·9 를 더할지 6·8·10 으로 수렴시킬지는 **눈으로 보고** 정할
    // 일이라 남겨 두었다. 그때까지 이 래칫이 "새로 늘지는 않는다" 만 지킨다.
    // 줄이면 이 숫자를 내려 적을 것.
    const hist = offRamp();
    const total = [...hist.values()].reduce((a, b) => a + b, 0);
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    expect(total, `램프 밖 여백 ${total}곳 — 최상위 ${JSON.stringify(top)}`).toBeLessThanOrEqual(480);
  });
});
