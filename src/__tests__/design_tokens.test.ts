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

  it("글자 7단 · 층 8단 · 이징 3종", () => {
    for (let i = 1; i <= 7; i++) expect(root).toMatch(new RegExp(`--fs-${i}:\\s*[0-9.]+px;`));
    for (const z of ["sticky", "strip", "panel", "dock", "menu", "popover", "modal", "top"]) {
      expect(root).toMatch(new RegExp(`--z-${z}:\\s*\\d+;`));
    }
    for (const e of ["ease-out", "ease-in-out", "ease-spring"]) expect(root).toMatch(new RegExp(`--${e}:`));
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

  it("상태색 hex 리터럴은 tokens.css 밖에 없다", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!file.endsWith(".css") || file.endsWith("tokens.css")) continue;
      const src = readFileSync(file, "utf8");
      if (/#(12a06b|c2810a|e5484d|d29922|d9822b|d97757)\b/i.test(src)) offenders.push(file.slice(ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
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
