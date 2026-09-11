import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { READ_COMMANDS, READ_ONLY_WHEN, WRITE_COMMANDS } from "./commandRegistry";

interface Manifest {
  contributes: {
    commands: { command: string }[];
    menus?: { commandPalette?: { command: string; when?: string }[] };
  };
}

const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as Manifest;

describe("package.json 커맨드 분류", () => {
  it("모든 커맨드가 READ 또는 WRITE 로 분류되어 있다", () => {
    const declared = manifest.contributes.commands.map((c) => c.command).sort();
    const classified = [...READ_COMMANDS, ...WRITE_COMMANDS].sort();
    expect(declared).toEqual(classified);
  });

  it("쓰기 커맨드는 팔레트에서 `!oculpm.readOnly` 로 숨는다", () => {
    const palette = new Map((manifest.contributes.menus?.commandPalette ?? []).map((m) => [m.command, m.when]));
    for (const id of WRITE_COMMANDS) {
      expect(palette.get(id), `${id} 의 commandPalette when`).toContain(READ_ONLY_WHEN);
    }
  });
});
