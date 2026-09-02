import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";
import type {
  CodeDirEntry,
  CodeTree,
  CodeTreeNode,
  CodeFileContent,
  CodeWriteOutcome,
} from "@/lib/bindings";

// 코드 화면 — 트리/선택/저장/충돌의 상태 흐름. CodeMirror 는 jsdom 에서
// 측정 API 가 없어 렌더가 불안정하므로 편집 신호를 흉내내는 목으로 바꾼다.

const summarizeAxe = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));
const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

const fx: {
  tree: CodeTree;
  read: Record<string, CodeFileContent>;
  writeResult: CodeWriteOutcome;
  writeCalls: { relPath: string; content: string; baseHash: string }[];
  /** `settings_get_all` 이 돌려줄 항목 — 저장 위생·자동 저장을 켜는 손잡이. */
  settings: [string, string][];
} = {
  tree: { nodes: [], file_count: 0, truncated: false },
  read: {},
  writeResult: { kind: "saved", hash: "h2" },
  writeCalls: [],
  settings: [],
};

function textFile(content: string, hash = "h1"): CodeFileContent {
  return { content, hash, bytes: content.length, binary: false, too_large: false };
}

// 트리는 이제 **지연 로딩**이다 — 화면은 `code_dir` 로 한 단계씩 읽는다.
// 픽스처는 여전히 전량 트리 하나이므로, 그 트리에서 해당 단계를 잘라 돌려준다
// (백엔드가 하는 일과 같은 계약: 한 단계 · 폴더 우선은 이미 정렬된 픽스처를 따름).
function dirEntriesOf(nodes: CodeTreeNode[], dirPath: string): CodeDirEntry[] {
  const toEntry = (n: CodeTreeNode): CodeDirEntry => ({
    name: n.name,
    relative_path: n.relative_path,
    is_dir: n.is_dir,
    ignored: false,
  });
  if (dirPath === "") return nodes.map(toEntry);
  let cur = nodes;
  for (const seg of dirPath.split("/")) {
    const hit = cur.find((n) => n.is_dir && n.name === seg);
    if (!hit) return [];
    cur = hit.children;
  }
  return cur.map(toEntry);
}

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "codeTree":
              return () => ok(fx.tree);
            case "codeDir":
              return (_pid: number, relPath: string) =>
                ok({ entries: dirEntriesOf(fx.tree.nodes, relPath), truncated: false });
            case "codeRead":
              return (_pid: number, relPath: string) =>
                ok(fx.read[relPath] ?? textFile("// missing fixture"));
            case "codeWrite":
              return (_pid: number, relPath: string, content: string, baseHash: string) => {
                fx.writeCalls.push({ relPath, content, baseHash });
                return ok(fx.writeResult);
              };
            case "settingsGetAll":
              return () => ok(fx.settings);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

// CM 목 — initialText 를 그대로 보여 주고, 편집(onChange)·⌘S(onSave)를
// 버튼으로 흉내낸다.
vi.mock("@/features/code/CodeEditor", () => ({
  CodeEditor: ({
    initialText,
    onChange,
    onSave,
  }: {
    initialText: string;
    onChange: (t: string) => void;
    onSave: () => void;
  }) => (
    <div data-testid="editor">
      <span data-testid="editor-text">{initialText}</span>
      <button data-testid="mutate" onClick={() => onChange(initialText + "!")} />
      {/* 저장 위생을 보려면 "지저분한" 본문이 필요하다 — 줄 끝 공백 + 끝 빈 줄. */}
      <button data-testid="mutate-messy" onClick={() => onChange(initialText + "   \n\n\n")} />
      <button data-testid="dosave" onClick={() => onSave()} />
    </div>
  ),
}));

import { CodeScreenV2 } from "@/features/code/CodeScreenV2";
import { _resetBuffers } from "@/features/code/codeBuffers";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";

function wrap(node: React.ReactNode) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{node}</WorkspaceProvider>
    </SettingsProvider>
  );
}

function screenEl(over: Partial<React.ComponentProps<typeof CodeScreenV2>> = {}) {
  return (
    <CodeScreenV2
      projectId={1}
      projectRoot="/tmp/proj"
      openTarget={null}
      onOpenTargetConsumed={() => {}}
      {...over}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  _resetBuffers();
  fx.tree = {
    nodes: [
      {
        name: "src",
        relative_path: "src",
        is_dir: true,
        children: [
          { name: "main.rs", relative_path: "src/main.rs", is_dir: false, children: [] },
        ],
      },
      { name: "README.md", relative_path: "README.md", is_dir: false, children: [] },
    ],
    file_count: 2,
    truncated: false,
  };
  fx.read = {
    "README.md": textFile("# hello"),
    "src/main.rs": textFile("fn main() {}"),
  };
  fx.writeResult = { kind: "saved", hash: "h2" };
  fx.writeCalls = [];
  fx.settings = [];
  // jsdom 에는 blob: URL 이 없다 — svg 미리보기가 이 둘을 쓴다.
  URL.createObjectURL = vi.fn(() => "blob:mock/1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("CodeScreenV2", () => {
  it("renders the tree and an empty state until a file is picked", async () => {
    const { findByText, findByRole } = render(wrap(screenEl()));
    await findByRole("tree");
    await findByText("README.md");
    await findByText(t("code.empty.title"));
  });

  it("opens a file from the tree into the editor", async () => {
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    const text = await findByTestId("editor-text");
    expect(text.textContent).toBe("# hello");
    // 상태줄 — 깨끗한 상태.
    await findByText(t("code.savedState"));
  });

  it("draws an svg beside the editor — from the buffer, and only for svg", async () => {
    // svg 는 코드로 열린다(에디터로). 그림은 그 **옆에** 뜬다 — 파일 하나로
    // 고치기와 보기를 동시에 한다.
    fx.tree.nodes.push({
      name: "icon.svg",
      relative_path: "icon.svg",
      is_dir: false,
      children: [],
    });
    fx.tree.file_count = 3;
    fx.read["icon.svg"] = textFile('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { findByText, findByRole, findByAltText, queryByRole } = render(wrap(screenEl()));

    // 텍스트 파일에는 이 손잡이가 아예 없다.
    fireEvent.click(await findByText("README.md"));
    await findByText(t("code.savedState"));
    expect(queryByRole("button", { name: t("code.svg.toggle") })).toBeNull();

    fireEvent.click(await findByText("icon.svg"));
    const toggle = await findByRole("button", { name: t("code.svg.toggle") });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(await findByAltText("icon.svg")).toHaveAttribute("src", "blob:mock/1");
    // 에디터는 그대로 살아 있다 — 갈아타는 것이 아니라 나란히 두는 것이다.
    await findByText('<svg xmlns="http://www.w3.org/2000/svg"/>');

    fireEvent.click(await findByRole("button", { name: t("code.svg.hide") }));
    expect(queryByRole("img")).toBeNull();
  });

  it("marks the buffer dirty on edit and saves through code_write", async () => {
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    fireEvent.click(await findByTestId("mutate"));
    await findByText(t("code.dirty"));
    fireEvent.click(await findByTestId("dosave"));
    await findByText(t("code.savedState"));
    expect(fx.writeCalls).toHaveLength(1);
    expect(fx.writeCalls[0]).toMatchObject({
      relPath: "README.md",
      content: "# hello!",
      baseHash: "h1",
    });
  });

  it("preserves CRLF line endings through the edit-save round trip", async () => {
    // CM 은 줄바꿈을 LF 로 합치므로, 정규화→복원이 없으면 CRLF 파일이 저장
    // 한 번에 통째로 LF 가 된다 (회귀 방지).
    fx.read["README.md"] = textFile("line1\r\nline2\r\n");
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    const text = await findByTestId("editor-text");
    expect(text.textContent).toBe("line1\nline2\n"); // 에디터에는 LF 정규화본
    fireEvent.click(await findByTestId("mutate"));
    fireEvent.click(await findByTestId("dosave"));
    await findByText(t("code.savedState"));
    expect(fx.writeCalls[0].content).toBe("line1\r\nline2\r\n!");
  });

  it("re-entrant save in the same tick issues only one code_write", async () => {
    // ⌘S 가 CM 키맵과 화면 레벨 리스너 양쪽에 걸리면 같은 base_hash 로 저장이
    // 두 번 나가 두 번째가 가짜 충돌 배너를 띄운다 (회귀 방지).
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    fireEvent.click(await findByTestId("mutate"));
    await findByText(t("code.dirty"));
    const btn = await findByTestId("dosave");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await findByText(t("code.savedState"));
    expect(fx.writeCalls).toHaveLength(1);
  });

  it("shows the conflict banner when the save reports a stale disk", async () => {
    fx.writeResult = { kind: "conflict", disk_hash: "other" };
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    fireEvent.click(await findByTestId("mutate"));
    fireEvent.click(await findByTestId("dosave"));
    await findByText(t("code.conflict.title"));
    await findByText(t("code.conflict.reload"));
    await findByText(t("code.conflict.overwrite"));
  });

  // ── 저장 위생 · 자동 저장 (vscode-borrows Phase 1) ─────────────────────

  it("tidies the buffer before writing when save hygiene is on", async () => {
    fx.settings = [
      ["code_trim_trailing_whitespace", "true"],
      ["code_trim_final_newlines", "true"],
      ["code_insert_final_newline", "true"],
    ];
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("src"));
    fireEvent.click(await findByText("main.rs"));
    fireEvent.click(await findByTestId("mutate-messy"));
    await findByText(t("code.dirty"));
    fireEvent.click(await findByTestId("dosave"));
    await findByText(t("code.savedState"));
    // 줄 끝 공백은 사라지고, 끝은 개행 하나로 정규화된다.
    expect(fx.writeCalls).toHaveLength(1);
    expect(fx.writeCalls[0].content).toBe("fn main() {}\n");
  });

  it("keeps trailing whitespace in markdown — two spaces are a hard line break", async () => {
    fx.settings = [
      ["code_trim_trailing_whitespace", "true"],
      ["code_trim_final_newlines", "true"],
    ];
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    fireEvent.click(await findByTestId("mutate-messy"));
    fireEvent.click(await findByTestId("dosave"));
    await findByText(t("code.savedState"));
    // 줄 끝 공백은 살아남고, 끝 빈 줄 정리는 그대로 걸린다.
    expect(fx.writeCalls[0].content).toBe("# hello   \n");
  });

  it("auto-saves on focus change and says so in the status bar", async () => {
    fx.settings = [["code_auto_save", "onFocusChange"]];
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    // 자동 저장이 켜져 있다는 사실이 상태줄에 있어야 한다 — ⌘S 습관을
    // 버려도 되는지 알 방법이 이것뿐이다.
    await findByText(t("code.autoSaveOn"));
    fireEvent.click(await findByTestId("mutate"));
    await findByText(t("code.dirty"));
    fireEvent.focusOut(await findByTestId("editor"));
    await findByText(t("code.autoSaveOn"));
    expect(fx.writeCalls).toHaveLength(1);
    expect(fx.writeCalls[0]).toMatchObject({ relPath: "README.md", content: "# hello!" });
  });

  it("never auto-saves over a conflict banner", async () => {
    fx.settings = [["code_auto_save", "onFocusChange"]];
    fx.writeResult = { kind: "conflict", disk_hash: "other" };
    const { findByText, findByTestId } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    fireEvent.click(await findByTestId("mutate"));
    fireEvent.click(await findByTestId("dosave"));
    await findByText(t("code.conflict.title"));
    // 배너가 떠 있는 동안 포커스가 나가도 다시 쓰지 않는다 (D7) — 사용자가
    // 배너에서 고를 때까지 남의 작업을 덮지 않는다.
    fireEvent.focusOut(await findByTestId("editor"));
    await findByText(t("code.conflict.title"));
    expect(fx.writeCalls).toHaveLength(1);
  });

  it("shows the unopenable state for binary files", async () => {
    fx.read["README.md"] = { content: "", hash: "hb", bytes: 9999, binary: true, too_large: false };
    const { findByText } = render(wrap(screenEl()));
    fireEvent.click(await findByText("README.md"));
    await findByText(t("code.binary"));
    await findByText(t("code.openExternal"));
  });

  it("jumps straight to a handoff target from another screen", async () => {
    const consumed = vi.fn();
    const { findByTestId } = render(
      wrap(screenEl({ openTarget: { path: "src/main.rs", line: 1, nonce: 1 }, onOpenTargetConsumed: consumed })),
    );
    const text = await findByTestId("editor-text");
    expect(text.textContent).toBe("fn main() {}");
    expect(consumed).toHaveBeenCalled();
  });

  it("has no basic a11y violations", async () => {
    const { container, findByRole } = render(wrap(screenEl()));
    await findByRole("tree");
    const results = await axe(container, AXE_OPTIONS);
    expect(summarizeAxe(results)).toEqual([]);
  });
});
