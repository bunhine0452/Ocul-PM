// 터미널이 듣는 키는 치트시트에도 (11-15 합류 G-02) — 키 층(`termKeys`)이 맡은 ⌘L(고른 출력을 Claude 에게)과
// ⇧↩(Claude 입력의 줄바꿈)가 단축키 표의 터미널 묶음에 없었다. 표의 머리 주석이 「핸들러를 바꾸면 이 표도 같이
// 바꾼다」 고 적어 둔 약속이다. 그 밖 OS 는 같은 묶음의 ⌘T · ⌘D 처럼 터미널 가족 표기로 옮겨진다.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { ShortcutCheatsheet } from "@/components/ShortcutCheatsheet";
import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";
import { requestCheatsheet } from "@/lib/projectActions";

afterEach(cleanup);

/** 열린 치트시트의 터미널 묶음 — 줄마다 [이름, 키]. */
async function terminalRows(): Promise<Array<[string, string]>> {
  render(<ShortcutCheatsheet />);
  act(() => requestCheatsheet());
  const dialog = await screen.findByRole("dialog");
  const group = dialog.querySelector("#keys-terminal")!.closest("section")!;
  return [...group.querySelectorAll(".keys-row")].map((row) => [
    row.querySelector("dt")!.textContent ?? "",
    [...row.querySelectorAll("kbd")].map((k) => k.textContent).join(" / "),
  ]);
}

describe("terminal cheatsheet — the keys the key layer takes", () => {
  it("macOS: ⌘L sends the selected output to Claude, ⇧↩ is the newline in Claude's input", async () => {
    const rows = await terminalRows();
    expect(rows).toContainEqual([t("keys.termSendSelection"), "⌘L"]);
    expect(rows).toContainEqual([t("keys.termNewline"), "⇧↩"]);
  });

  it("Windows · Linux: the same rows in the terminal family notation", async () => {
    for (const os of ["windows", "linux"] as const) {
      __setPlatformForTests(os);
      const rows = await terminalRows();
      expect(rows, os).toContainEqual([t("keys.termSendSelection"), "Ctrl+Shift+L"]);
      expect(rows, os).toContainEqual([t("keys.termNewline"), "Shift+Enter"]);
      cleanup();
    }
  });
});
