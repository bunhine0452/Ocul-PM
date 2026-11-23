import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLUGIN_INSTALL, pluginInstallText } from "./start";

const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const nls = (lang: "" | ".ko") =>
  JSON.parse(readFileSync(new URL(`../../package.nls${lang}.json`, import.meta.url), "utf8")) as Record<string, string>;

describe("start guide for a folder without .oculpm/", () => {
  it("copies the same two lines the app shows", () => {
    const app = readFileSync(new URL("../../../src/lib/agentCommands.ts", import.meta.url), "utf8");
    const block = app.slice(app.indexOf("CLAUDE_PLUGIN_INSTALL"), app.indexOf("] as const", app.indexOf("CLAUDE_PLUGIN_INSTALL")));
    for (const line of PLUGIN_INSTALL) expect(block).toContain(`"${line}"`);
    expect(pluginInstallText()).toBe(PLUGIN_INSTALL.join("\n") + "\n");
  });

  it("the panel is there in every folder, and an empty one shows the guide", () => {
    const view = manifest.contributes.views.ocul.find((v: { id: string }) => v.id === "ocul.overview");
    expect(view.when).toBeUndefined();
    const welcome = manifest.contributes.viewsWelcome.filter((w: { view: string }) => w.view === "ocul.overview");
    expect(welcome).toHaveLength(1);
    const key = /^%(.+)%$/.exec(welcome[0].contents)![1];
    for (const lang of ["", ".ko"] as const) {
      const text = nls(lang)[key];
      // 단추는 복사 하나 · 다시 읽기 하나 — 터미널에 쳐 넣는 명령도, 웹 주소도 없다.
      expect([...text.matchAll(/\]\(command:([\w.]+)\)/g)].map((m) => m[1])).toEqual(["ocul.copyPluginInstall", "ocul.refresh"]);
      expect(text).not.toMatch(/continueInTerminal|https?:/);
    }
    expect(manifest.contributes.commands.map((c: { command: string }) => c.command)).toContain("ocul.copyPluginInstall");
  });
});
