/**
 * 설정 · 표시 · 「파일 열기」 (2026-11-02).
 *
 * 옛 기본값 `code "%path"` 는 셸 명령이라 `code` 가 없는 기기에서 열기가 실패했고, 바꿀 칸도
 * 없었다. 이제 자동 · VS Code · Cursor · 기본 앱 · 직접 입력 중 하나를 `external_editor_command`
 * 에 쓴다. 옛 기본값이 남은 사람은 「자동」으로 보인다(백엔드 `editor_choice::choose` 와 같은 규칙).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  saved: [] as Array<{ key: string; value: string }>,
  settingsSet: vi.fn(async (_k: string, _v: string) => ({ status: "ok", data: null })),
  detect: "vscode",
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsGetAll") return () => ok(fx.saved);
          if (prop === "settingsSet") return fx.settingsSet;
          if (prop === "detectEditor") return () => Promise.resolve(fx.detect);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { EditorRow, choiceOf } from "@/features/settings/EditorRow";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";

function renderRow() {
  return render(
    <SettingsProvider>
      <EditorRow />
    </SettingsProvider>,
  );
}

beforeEach(() => {
  setLangSetting("ko");
  fx.saved = [];
  fx.detect = "vscode";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetLangForTests();
});

describe("choiceOf — stored value → choice", () => {
  it("empty, auto and the legacy default read as auto", () => {
    for (const v of ["", " ", "auto", 'code "%path"']) expect(choiceOf(v)).toBe("auto");
  });
  it("the three names stay, anything else is custom", () => {
    expect(choiceOf("vscode")).toBe("vscode");
    expect(choiceOf("cursor")).toBe("cursor");
    expect(choiceOf("system")).toBe("system");
    expect(choiceOf('code -g "%path:%line"')).toBe("custom");
  });
});

describe("Open files in row", () => {
  it("auto shows the detected editor name", async () => {
    renderRow();
    expect(await screen.findByRole("tab", { name: t("prefs.display.editorAutoFound", { name: "VS Code" }) })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("picking VS Code saves vscode", async () => {
    renderRow();
    fireEvent.click(screen.getByRole("tab", { name: "VS Code" }));
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("external_editor_command", "vscode"));
  });

  it("custom opens a field and saves the command on Enter", async () => {
    renderRow();
    fireEvent.click(screen.getByRole("tab", { name: t("prefs.display.editorCustom") }));
    expect(fx.settingsSet).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: t("prefs.display.editorCustom") });
    fireEvent.change(input, { target: { value: "subl %path:%line" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fx.settingsSet).toHaveBeenCalledWith("external_editor_command", "subl %path:%line"));
  });
});
