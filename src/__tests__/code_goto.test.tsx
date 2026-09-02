// B4 파일 안에서 이동 — 위젯 (docs/20260902_vscode-borrows/03-goto.md).
//
// 순수 규칙은 code_goto_model 이 덮는다. 여기서 잠그는 것은 **훑는 동안 코드가
// 따라 움직이고, 그만두면 원래 자리로 돌아온다** 는 계약이다 — 그 되돌리기가
// 없으면 이 위젯은 목록을 보여 주는 대가로 사용자의 자리를 뺏는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";
import type { CodeDirEntry, CodeFileContent, LspSymbol } from "@/lib/bindings";

const fx: { files: Map<string, string>; symbols: LspSymbol[] } = {
  files: new Map(),
  symbols: [],
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const err = (error: string) => Promise.resolve({ status: "error" as const, error });
  const dirEntries = (dirPath: string): CodeDirEntry[] => {
    const prefix = dirPath ? dirPath + "/" : "";
    const out: CodeDirEntry[] = [];
    for (const key of fx.files.keys()) {
      if (!key.startsWith(prefix) || key.slice(prefix.length).includes("/")) continue;
      out.push({ name: key.slice(prefix.length), relative_path: key, is_dir: false, ignored: false });
    }
    return out;
  };
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "codeTree":
              return () =>
                ok({
                  nodes: [...fx.files.keys()].map((p) => ({
                    name: p,
                    relative_path: p,
                    is_dir: false,
                    children: [],
                  })),
                  file_count: fx.files.size,
                  truncated: false,
                });
            case "codeDir":
              return (_p: number, rel: string) => ok({ entries: dirEntries(rel), truncated: false });
            case "codeRead":
              return (_p: number, rel: string) => {
                const hit = fx.files.get(rel);
                if (hit === undefined) return err("Failed to read file");
                return ok({
                  content: hit,
                  hash: "h1",
                  bytes: hit.length,
                  binary: false,
                  too_large: false,
                } satisfies CodeFileContent);
              };
            case "lspDocumentSymbols":
              return () => ok(fx.symbols);
            case "settingsGetAll":
              return () => ok([]);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

// CM 목 — 받은 점프 지시를 속성으로 드러낸다 (jsdom 에 에디터가 없다).
vi.mock("@/features/code/CodeEditor", () => ({
  CodeEditor: ({
    path,
    jump,
  }: {
    path: string;
    jump?: { line: number; ch?: number; focus?: boolean } | null;
  }) => (
    <div
      data-testid="editor"
      data-path={path}
      data-jump={jump ? `${jump.line}:${jump.ch ?? ""}:${jump.focus === false ? "peek" : "focus"}` : ""}
    />
  ),
}));

import { CodeGoto } from "@/features/code/CodeGoto";
import { CodeScreenV2 } from "@/features/code/CodeScreenV2";
import { _resetBuffers } from "@/features/code/codeBuffers";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";

function sym(name: string, line: number, depth = 0, kind = "function"): LspSymbol {
  return { name, detail: null, kind, depth, line, character: 0 };
}

/** 문서 순서대로: 9행 함수 · 19행 구조체 · 그 안 24행 메서드. */
const SYMBOLS = [sym("handleMutate", 9), sym("Renderer", 19, 0, "struct"), sym("draw", 24, 1, "method")];

function renderGoto(over: Partial<React.ComponentProps<typeof CodeGoto>> = {}) {
  const onJump = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <CodeGoto
      symbols={SYMBOLS}
      symbolsLoading={false}
      lineCount={80}
      originLine={5}
      lineMode={false}
      onJump={onJump}
      onClose={onClose}
      {...over}
    />,
  );
  return { onJump, onClose, ...utils };
}

const input = () => screen.getByRole("combobox");
const optionNames = () => screen.queryAllByRole("option").map((el) => el.textContent ?? "");

beforeEach(() => {
  _resetBuffers();
  fx.files = new Map([["main.rs", "fn main() {}\n".repeat(40)]]);
  fx.symbols = SYMBOLS;
});
afterEach(cleanup);

describe("CodeGoto — 심볼 모드", () => {
  it("열면 지금 파일의 심볼이 문서 순서로 뜬다", () => {
    renderGoto();
    expect(optionNames().map((s) => s.replace(/\d+$/, ""))).toEqual([
      "handleMutate",
      "Renderer",
      "drawRenderer",
    ]);
  });

  it("열자마자는 점프하지 않는다 — 연 것만으로 화면이 움직이면 안 된다", () => {
    const { onJump } = renderGoto();
    expect(onJump).not.toHaveBeenCalled();
  });

  it("첫 선택은 커서가 들어 있는 심볼", () => {
    // 커서 20행 → Renderer(19행) 안.
    renderGoto({ originLine: 20 });
    const on = screen.getAllByRole("option").filter((el) => el.getAttribute("aria-selected") === "true");
    expect(on).toHaveLength(1);
    expect(on[0].textContent).toContain("Renderer");
  });

  it("타자로 좁혀진다", () => {
    renderGoto();
    fireEvent.change(input(), { target: { value: "draw" } });
    expect(optionNames()).toHaveLength(1);
    expect(optionNames()[0]).toContain("draw");
  });

  it("↑↓ 로 옮길 때마다 미리 점프한다 (포커스는 뺏지 않는다)", () => {
    const { onJump } = renderGoto();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    // Renderer 는 0-based 19행 → 1-based 20행.
    expect(onJump).toHaveBeenLastCalledWith(20, 0, false);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(onJump).toHaveBeenLastCalledWith(25, 0, false);
    // 끝에서 한 번 더 누르면 처음으로 돈다.
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(onJump).toHaveBeenLastCalledWith(10, 0, false);
  });

  it("Esc 면 열 때의 줄로 되돌아간다", () => {
    const { onJump, onClose } = renderGoto();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onJump).toHaveBeenLastCalledWith(5, undefined, false);
    expect(onClose).toHaveBeenCalled();
  });

  it("아무것도 안 건드리고 Esc 면 점프 자체가 없다", () => {
    const { onJump, onClose } = renderGoto();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onJump).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("⏎ 면 그 자리에 남고 에디터가 포커스를 가져간다", () => {
    const { onJump, onClose } = renderGoto();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onJump).toHaveBeenLastCalledWith(20, 0, true);
    expect(onClose).toHaveBeenCalled();
  });

  it("행을 눌러도 확정된다", () => {
    const { onJump } = renderGoto();
    fireEvent.click(screen.getAllByRole("option")[2]);
    expect(onJump).toHaveBeenLastCalledWith(25, 0, true);
  });

  it("맞는 심볼이 없으면 이유를 말한다", () => {
    renderGoto();
    fireEvent.change(input(), { target: { value: "zzzz" } });
    expect(optionNames()).toEqual([]);
    expect(screen.getByText(t("code.goto.noMatch"))).toBeTruthy();
  });
});

describe("CodeGoto — 줄 모드", () => {
  it("⌃G 로 열면 : 가 채워져 있다", () => {
    renderGoto({ lineMode: true });
    expect((input() as HTMLInputElement).value).toBe(":");
    expect(optionNames()).toEqual([]);
    expect(screen.getByText(t("code.goto.lineHint", { max: 80 }))).toBeTruthy();
  });

  it("심볼이 없는 파일은 줄 모드로 넘어간다", async () => {
    renderGoto({ symbols: [] });
    await waitFor(() => expect((input() as HTMLInputElement).value).toBe(":"));
  });

  it(":12:3 은 12행 3칸 (친 열은 1-based, 점프는 0-based)", () => {
    const { onJump } = renderGoto();
    fireEvent.change(input(), { target: { value: ":12:3" } });
    expect(screen.getByRole("option").textContent).toBe(
      t("code.goto.lineToCol", { line: 12, col: 3 }),
    );
    expect(onJump).toHaveBeenLastCalledWith(12, 2, false);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onJump).toHaveBeenLastCalledWith(12, 2, true);
  });

  it("문서를 넘는 줄은 마지막 줄로 접는다", () => {
    const { onJump } = renderGoto();
    fireEvent.change(input(), { target: { value: ":999" } });
    expect(screen.getByRole("option").textContent).toBe(t("code.goto.lineTo", { line: 80 }));
    expect(onJump).toHaveBeenLastCalledWith(80, undefined, false);
  });
});

describe("CodeGoto — a11y", () => {
  const summarize = (r: AxeResults) => r.violations.map((v: Result) => ({ id: v.id, help: v.help }));
  const AXE = { rules: { "color-contrast": { enabled: false } } } as const;

  it("심볼 목록에 위반이 없다", async () => {
    const { container } = renderGoto();
    expect(summarize(await axe(container, AXE))).toEqual([]);
  });

  it("줄 모드에도 위반이 없다", async () => {
    const { container } = renderGoto({ lineMode: true });
    fireEvent.change(input(), { target: { value: ":12" } });
    expect(summarize(await axe(container, AXE))).toEqual([]);
  });
});

describe("코드 화면 배선 — ⇧⌘O · ⌃G", () => {
  // jsdom 은 레이아웃이 없어 getClientRects 가 늘 빈 목록이다 — 화면의 "보이는
  // 창만 키를 받는다" 가드를 통과시키려면 상자 하나를 흉내내야 한다.
  let rects: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rects = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{ x: 0, y: 0, width: 800, height: 600 }] as unknown as DOMRectList);
  });
  afterEach(() => rects.mockRestore());

  function renderScreen() {
    return render(
      <SettingsProvider>
        <WorkspaceProvider projectId={1}>
          <CodeScreenV2
            projectId={1}
            projectRoot="/tmp/proj"
            openTarget={null}
            onOpenTargetConsumed={() => {}}
          />
        </WorkspaceProvider>
      </SettingsProvider>,
    );
  }

  /** 파일 하나를 열어 둔다 — 열린 파일이 없으면 이동할 곳이 없다. */
  async function openFile(container: HTMLElement) {
    const row = await waitFor(() => {
      const hit = [...container.querySelectorAll(".code-tree-row")].find(
        (el) => el.querySelector(".code-tree-label")?.textContent === "main.rs",
      );
      if (!hit) throw new Error("트리에 파일이 없습니다");
      return hit as HTMLElement;
    });
    fireEvent.click(row);
    await screen.findByTestId("editor");
  }

  it("⇧⌘O 는 심볼 모드로, ⌃G 는 줄 모드로 연다", async () => {
    const { container } = renderScreen();
    await openFile(container);

    fireEvent.keyDown(window, { key: "o", code: "KeyO", metaKey: true, shiftKey: true });
    const panel = await screen.findByRole("dialog", { name: t("code.goto.aria") });
    await waitFor(() => expect(within(panel).getAllByRole("option").length).toBe(3));
    expect((within(panel).getByRole("combobox") as HTMLInputElement).value).toBe("");

    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(window, { key: "g", code: "KeyG", ctrlKey: true });
    const line = await screen.findByRole("dialog", { name: t("code.goto.aria") });
    expect((within(line).getByRole("combobox") as HTMLInputElement).value).toBe(":");
  });

  it("훑는 동안 에디터가 따라 움직이고 Esc 면 원래 줄로 돌아온다", async () => {
    const { container } = renderScreen();
    await openFile(container);

    fireEvent.keyDown(window, { key: "o", code: "KeyO", metaKey: true, shiftKey: true });
    const panel = await screen.findByRole("dialog", { name: t("code.goto.aria") });
    await waitFor(() => expect(within(panel).getAllByRole("option").length).toBe(3));

    fireEvent.keyDown(within(panel).getByRole("combobox"), { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getByTestId("editor").getAttribute("data-jump")).toBe("20:0:peek"),
    );

    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // 열 때의 커서 줄(1행) 로 되돌아간다.
    expect(screen.getByTestId("editor").getAttribute("data-jump")).toBe("1::peek");
  });
});
