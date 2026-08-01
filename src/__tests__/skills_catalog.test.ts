import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_PINS,
  CATALOG_SKILLS,
  CATALOG_TAGS,
} from "@/features/skills/skillsCatalog";

// ─── C1 — 벤더링 스킬 카탈로그 무결성 ─────────────────────────────────────
//
// 카탈로그는 런타임 네트워크 0 이 전제라, 원문이 커밋 핀과 함께 저장소에
// 그대로 동봉되어야 한다. 여기서는 (a) frontmatter 시작, (b) vendored-from
// 헤더 + 40-hex 커밋 SHA, (c) 태그 어휘, (d) id ↔ catalog/<id>.md 1:1,
// (e) tokenEstimate 를 검증한다. 원문 본문은 무수정이 원칙이므로 내용
// 자체는 단정하지 않는다.

const CATALOG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../features/skills/catalog",
);

// 벤더링된 40-hex 커밋 SHA 를 포함한 출처 헤더.
const VENDORED_RE =
  /<!-- vendored-from: https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/([0-9a-f]{40})\/skills\/[\w-]+\/SKILL\.md · MIT License © [^·]+· retrieved \d{4}-\d{2}-\d{2} · ocul-pm catalog -->/;

describe("skills catalog (C1 vendored)", () => {
  it("25개 엔트리가 있고 id 는 중복이 없다", () => {
    expect(CATALOG_SKILLS).toHaveLength(25);
    const ids = CATALOG_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CATALOG_SKILLS.map((s) => [s.id, s] as const))(
    "%s — content 가 frontmatter 로 시작한다",
    (_id, skill) => {
      expect(skill.content.startsWith("---\n")).toBe(true);
      // 닫는 --- 도 있어야 frontmatter 로 성립한다.
      expect(skill.content.slice(4)).toMatch(/^[\s\S]*?\n---\s*\n/);
    },
  );

  it.each(CATALOG_SKILLS.map((s) => [s.id, s] as const))(
    "%s — vendored-from 헤더와 40-hex 핀 SHA 가 있다",
    (_id, skill) => {
      const match = skill.content.match(VENDORED_RE);
      expect(match).not.toBeNull();
      const sha = match?.[1];
      expect(sha).toBe(CATALOG_PINS[skill.source]);
      expect(skill.sourceUrl).toContain(`/blob/${CATALOG_PINS[skill.source]}/`);
    },
  );

  it.each(CATALOG_SKILLS.map((s) => [s.id, s] as const))(
    "%s — tags 는 비어있지 않고 허용 어휘 내다",
    (_id, skill) => {
      expect(skill.tags.length).toBeGreaterThan(0);
      for (const tag of skill.tags) {
        expect(CATALOG_TAGS).toContain(tag);
        expect(tag).toBe(tag.toLowerCase());
      }
    },
  );

  it("id 와 catalog/<id>.md 파일이 1:1 대응한다", () => {
    const files = fs
      .readdirSync(CATALOG_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    const ids = CATALOG_SKILLS.map((s) => s.id).sort();
    expect(files).toEqual(ids);
  });

  it.each(CATALOG_SKILLS.map((s) => [s.id, s] as const))(
    "%s — content 가 디스크의 catalog 파일과 동일하다",
    (_id, skill) => {
      const onDisk = fs.readFileSync(path.join(CATALOG_DIR, `${skill.id}.md`), "utf8");
      expect(skill.content).toBe(onDisk);
    },
  );

  it.each(CATALOG_SKILLS.map((s) => [s.id, s] as const))(
    "%s — tokenEstimate > 0 이고 content.length/4 반올림과 일치한다",
    (_id, skill) => {
      expect(skill.tokenEstimate).toBeGreaterThan(0);
      expect(skill.tokenEstimate).toBe(Math.round(skill.content.length / 4));
    },
  );

  it("메타데이터: license=MIT, source 별 sourceUrl 저장소가 맞다", () => {
    for (const skill of CATALOG_SKILLS) {
      expect(skill.license).toBe("MIT");
      expect(skill.summary.length).toBeGreaterThan(0);
      expect(skill.label.length).toBeGreaterThan(0);
      const repo = skill.source === "ecc" ? "affaan-m/ecc" : "DietrichGebert/ponytail";
      expect(skill.sourceUrl.startsWith(`https://github.com/${repo}/blob/`)).toBe(true);
    }
  });

  // oculpm.com/plugin 문서 페이지가 카탈로그 실표면과 동기 — 스킬을 추가하고
  // 문서를 빼먹으면 여기서 게이트가 실패한다 (커맨드의 plugin_manifest.rs
  // 게이트와 같은 원칙을 카탈로그로 확장).
  it("landing/plugin.html 이 카탈로그 전 스킬을 문서화한다", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "landing", "plugin.html"), "utf8");
    for (const skill of CATALOG_SKILLS) {
      expect(page, `landing/plugin.html 에 카탈로그 스킬 ${skill.id} 문서 누락`).toContain(
        skill.id,
      );
    }
    expect(page).toContain(`카탈로그 ${CATALOG_SKILLS.length}종`);
  });

  // MIT 는 사본 재배포 시 저작권 고지 + 허가 고지 전문 동봉을 요구한다 —
  // 벤더 사본과 함께 업스트림 LICENSE 전문을 catalog/ 에 동봉해야 한다.
  it.each([
    ["LICENSE-ecc", "Affaan Mustafa"],
    ["LICENSE-ponytail", "DietrichGebert"],
  ])("%s — MIT 허가 고지 전문이 동봉되어 있다 (© %s)", (file, holder) => {
    const text = fs.readFileSync(path.join(CATALOG_DIR, file), "utf8");
    expect(text).toContain("MIT License");
    expect(text).toContain(holder);
    expect(text).toContain("Permission is hereby granted, free of charge");
    expect(text).toContain("THE SOFTWARE IS PROVIDED \"AS IS\"");
  });

  // 유니코드 위생 — 제3자 콘텐츠를 사용자 컨텍스트에 주입하는 파이프라인이므로,
  // bidi 제어문자(텍스트 방향 뒤집기)와 제로폭 문자(보이지 않는 스머글링)를
  // 벤더 파일 전체에서 금지한다.
  const BIDI_AND_ZERO_WIDTH_RE =
    // U+202A–U+202E bidi 임베딩/오버라이드, U+2066–U+2069 bidi 아이솔레이트,
    // U+200B/U+200C/U+200D 제로폭, U+FEFF BOM/ZWNBSP, U+00AD soft hyphen.
    /[\u202A-\u202E\u2066-\u2069\u200B\u200C\u200D\uFEFF\u00AD]/u;

  const hygieneTargets = [
    ...fs.readdirSync(CATALOG_DIR).filter((f) => f.endsWith(".md")),
    "LICENSE-ecc",
    "LICENSE-ponytail",
  ];

  it.each(hygieneTargets.map((f) => [f] as const))(
    "%s — bidi 제어문자·제로폭 문자가 없다",
    (file) => {
      const text = fs.readFileSync(path.join(CATALOG_DIR, file), "utf8");
      const match = text.match(BIDI_AND_ZERO_WIDTH_RE);
      expect(
        match === null
          ? null
          : `U+${match[0].codePointAt(0)?.toString(16).toUpperCase()} at index ${match.index}`,
      ).toBeNull();
    },
  );
});
