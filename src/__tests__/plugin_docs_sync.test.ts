// 인앱 플러그인 문서(pluginDocs.ts)와 플러그인 실표면의 동기 강제 —
// plugin/oculpm/ 이 SSOT 다. 커맨드를 추가/수정하고 앱 문서를 빼먹으면
// 여기가 깨진다 (landing/plugin.html 은 plugin_manifest.rs 가 같은 방식으로
// 강제한다 — 문서 표면 3곳이 전부 게이트 아래에 있다).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PLUGIN_COMMANDS, PLUGIN_FLOW, PLUGIN_TOOLS } from "@/features/skills/pluginDocs";
import { CATALOG_PINS, CATALOG_SKILLS } from "@/features/skills/skillsCatalog";

const commandsDir = join(process.cwd(), "plugin", "oculpm", "commands");
// 도구 정의는 **두 파일**에 산다 — 2026-09-03 파일 크기 래칫을 들이면서 a2a
// 도구가 `a2a_tools.rs` 로 갈라졌다. 한쪽만 읽으면 이 게이트가 조용히 반쪽이 된다.
const toolSources = [
  // 2026-09-04 에 `tools.rs` 가 `tools/mod.rs` + `tools/tests.rs` 로 갈라졌다
  // (파일 크기 래칫). 도구 정의는 본문에 있으므로 `mod.rs` 를 읽는다.
  join(process.cwd(), "src-tauri", "src", "oculpm", "mcp", "tools", "mod.rs"),
  join(process.cwd(), "src-tauri", "src", "oculpm", "mcp", "a2a_tools.rs"),
];
const landingPlugin = join(process.cwd(), "landing", "plugin.html");

function frontmatterDescription(md: string): string {
  const m = md.match(/^---\n[\s\S]*?description:\s*(.+?)\n[\s\S]*?---\n/);
  if (!m) throw new Error("frontmatter description 없음");
  return m[1].trim();
}

describe("plugin docs sync (플러그인이 SSOT)", () => {
  const onDisk = readdirSync(commandsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();

  test("커맨드 목록이 양방향으로 일치한다", () => {
    const inApp = PLUGIN_COMMANDS.map((c) => c.slug).sort();
    expect(inApp).toEqual(onDisk);
  });

  test.each(PLUGIN_COMMANDS.map((c) => [c.slug, c] as const))(
    "%s — cmd 형식과 frontmatter description 일치",
    (slug, doc) => {
      expect(doc.cmd).toBe(`/oculpm:${slug}`);
      const md = readFileSync(join(commandsDir, `${slug}.md`), "utf8");
      expect(doc.description).toBe(frontmatterDescription(md));
    },
  );

  test("권장 흐름의 커맨드는 전부 실존한다", () => {
    for (const step of PLUGIN_FLOW) {
      expect(onDisk).toContain(step.replace("/oculpm:", ""));
    }
  });

  test("MCP 도구 이름이 서버 정의(tools.rs · a2a_tools.rs)에 전부 존재한다", () => {
    const src = toolSources.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const t of PLUGIN_TOOLS) {
      expect(src, `서버 정의에 ${t.name} 없음 — 도구가 개명/삭제됐다면 앱 문서도 갱신`).toContain(
        `"name": "${t.name}"`,
      );
    }
    // 역방향: 서버에 도구가 추가됐는데 앱 문서에 없으면 여기서 잡는다.
    const serverTools = [...src.matchAll(/"name":\s*"([a-z_]+)"/g)].map((m) => m[1]);
    const documented = new Set(PLUGIN_TOOLS.map((t) => t.name));
    for (const name of serverTools) {
      expect(documented.has(name), `서버 도구 ${name} 가 앱 플러그인 문서에 없음`).toBe(true);
    }
  });
});

// Osaurus 라운드 Phase 8 `#landing-skills` — oculpm.com/plugin 이 스킬 카탈로그다.
// 카탈로그의 SSOT 는 `skillsCatalog.ts` 라, 스킬을 추가하거나 핀을 갱신하고
// 랜딩을 빼먹으면 여기가 깨진다 (Rust 쪽 `plugin_manifest` 는 커맨드·도구·
// 동봉 스킬을, 여기는 제3자 카탈로그를 본다 — 소유가 갈린다).
describe("landing/plugin.html 카탈로그 동기", () => {
  const page = readFileSync(landingPlugin, "utf8");

  test.each(CATALOG_SKILLS.map((s) => [s.id] as const))("%s 가 카탈로그 표에 있다", (id) => {
    expect(page, `landing/plugin.html 에 카탈로그 스킬 ${id} 누락`).toContain(`<td>${id}</td>`);
  });

  test.each(CATALOG_SKILLS.map((s) => [s.id, s.sourceUrl] as const))(
    "%s 의 원문 링크가 핀 URL 그대로다",
    (_id, sourceUrl) => {
      expect(page).toContain(sourceUrl);
    },
  );

  test("핀 SHA 배지가 지금 핀과 같다", () => {
    // 짧은 SHA 를 배지로 쓴다 — 핀을 갱신하면 배지도 함께 바뀌어야 한다.
    for (const [source, sha] of Object.entries(CATALOG_PINS)) {
      expect(page, `${source} 핀 배지가 ${sha.slice(0, 7)} 가 아님`).toContain(
        `${source}@${sha.slice(0, 7)}`,
      );
    }
  });

  test("페이지가 말하는 카탈로그 개수가 실제와 같다", () => {
    expect(page).toContain(`스킬 샵 카탈로그 ${CATALOG_SKILLS.length}종`);
  });
});
