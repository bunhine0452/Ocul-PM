// 인앱 플러그인 문서(pluginDocs.ts)와 플러그인 실표면의 동기 강제 —
// plugin/oculpm/ 이 SSOT 다. 커맨드를 추가/수정하고 앱 문서를 빼먹으면
// 여기가 깨진다 (landing/plugin.html 은 plugin_manifest.rs 가 같은 방식으로
// 강제한다 — 문서 표면 3곳이 전부 게이트 아래에 있다).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PLUGIN_COMMANDS, PLUGIN_FLOW, PLUGIN_TOOLS } from "@/features/skills/pluginDocs";

const commandsDir = join(process.cwd(), "plugin", "oculpm", "commands");
const toolsRs = join(process.cwd(), "src-tauri", "src", "oculpm", "mcp", "tools.rs");

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

  test("MCP 도구 이름이 서버 정의(tools.rs)에 전부 존재한다", () => {
    const src = readFileSync(toolsRs, "utf8");
    for (const t of PLUGIN_TOOLS) {
      expect(src, `tools.rs 에 ${t.name} 없음 — 도구가 개명/삭제됐다면 앱 문서도 갱신`).toContain(
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
