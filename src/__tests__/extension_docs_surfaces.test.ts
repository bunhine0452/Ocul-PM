import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// vscode-extension-round {#rel-docs} — the extension must be present on every
// release surface (the app's five-surface rule, plus the extension's own README).
// Mirrors src-tauri/tests/plugin_manifest.rs `landing_plugin_docs_page_lists_every_command_and_tool`:
// adding a command or setting to extension/package.json without documenting it fails here.

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const EXT_ID = "oculpm.ocul-pm";

describe("VS Code extension — release surfaces", () => {
  it("README ko/en, both landings and CHANGELOG all mention the extension", () => {
    for (const rel of ["README.md", "README.en.md", "landing/index.html", "landing/en/index.html", "CHANGELOG.md"]) {
      expect(read(rel), rel).toContain(EXT_ID);
    }
  });

  it("both landings carry the FAQ question and a bento cell for it", () => {
    for (const [rel, faq, tag] of [
      // i18n-ignore-next-line -- 랜딩 한국어 원문이 검사 대상 소재다 (번역할 UI 카피가 아니다)
      ["landing/index.html", "VS Code 안에서도 쓸 수 있나요?", "VS Code 확장"],
      ["landing/en/index.html", "Can I use it inside VS Code?", "VS Code extension"],
    ] as const) {
      const html = read(rel);
      expect(html, `${rel} FAQ html`).toContain(`<details><summary>${faq}</summary>`);
      expect(html, `${rel} FAQ json-ld`).toContain(`"name": ${JSON.stringify(faq)}`);
      expect(html, `${rel} bento`).toContain(`<span class="cell-tag">${tag}</span>`);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        expect(() => JSON.parse(m[1]), `${rel} json-ld parses`).not.toThrow();
      }
    }
  });

  it("every contributed command and setting is documented in extension/README.md", () => {
    const manifest = JSON.parse(read("extension/package.json")) as {
      contributes: { commands: { command: string }[]; configuration: { properties: Record<string, unknown> } };
    };
    const readme = read("extension/README.md");
    for (const c of manifest.contributes.commands) {
      expect(readme, c.command).toContain(`\`${c.command}\``);
    }
    for (const key of Object.keys(manifest.contributes.configuration.properties)) {
      expect(readme, key).toContain(`\`${key}\``);
    }
  });
});
