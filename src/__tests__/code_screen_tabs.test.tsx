// 코드 화면 Phase 1 — 탭·분할·파일 조작이 **열려 있는 버퍼와 어긋나지 않는지**.
//
// 순수 로직은 code_tabs / code_file_ops 가 덮는다. 여기서 확인하는 것은 그
// 로직이 실제 화면에서 백엔드 호출과 함께 옳게 엮이는가다 — 특히 이름을
// 바꾸거나 지운 파일이 탭에 열려 있을 때.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { CodeDirEntry, CodeFileContent, CodePathResult } from "@/lib/bindings";

interface Ops {
  /** `code_read` 호출 횟수 — 재읽기 루프 회귀를 세는 자. */
  reads: number;
  create: string[];
  mkdir: string[];
  rename: Array<{ from: string; to: string }>;
  del: string[];
}

const fx: {
  /** 경로 → 내용. 디렉터리는 경로 끝에 "/" 로 표시한다. */
  files: Map<string, string>;
  ops: Ops;
} = { files: new Map(), ops: { reads: 0, create: [], mkdir: [], rename: [], del: [] } };

function textFile(content: string, hash = "h1"): CodeFileContent {
  return { content, hash, bytes: content.length, binary: false, too_large: false };
}

/** 픽스처 맵에서 한 단계를 잘라 낸다 (code_dir 이 하는 일과 같은 계약). */
function dirEntries(dirPath: string): CodeDirEntry[] {
  const prefix = dirPath ? dirPath + "/" : "";
  const seen = new Map<string, boolean>();
  for (const key of fx.files.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    const name = slash < 0 ? rest : rest.slice(0, slash);
    if (!name) continue;
    seen.set(name, slash >= 0 || rest.endsWith("/"));
  }
  return [...seen].map(([name, isDir]) => ({
    name: name.replace(/\/$/, ""),
    relative_path: (prefix + name).replace(/\/$/, ""),
    is_dir: isDir,
    ignored: false,
  }));
}

/** 전량 트리 — 필터·초기 검증용. 파일만 담는다 (code_tree 와 같이). */
function fullTree() {
  const nodes: Record<string, unknown>[] = [];
  const dirs = new Map<string, Record<string, unknown>>();
  const ensureDir = (path: string): Record<string, unknown> => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const at = path.lastIndexOf("/");
    const node = { name: path.slice(at + 1), relative_path: path, is_dir: true, children: [] };
    dirs.set(path, node);
    if (at < 0) nodes.push(node);
    else (ensureDir(path.slice(0, at)).children as unknown[]).push(node);
    return node;
  };
  for (const key of fx.files.keys()) {
    if (key.endsWith("/")) continue;
    const at = key.lastIndexOf("/");
    const node = { name: key.slice(at + 1), relative_path: key, is_dir: false, children: [] };
    if (at < 0) nodes.push(node);
    else (ensureDir(key.slice(0, at)).children as unknown[]).push(node);
  }
  return { nodes, file_count: fx.files.size, truncated: false };
}

function movePrefix(from: string, to: string): boolean {
  let isDir = false;
  for (const [key, value] of [...fx.files]) {
    if (key === from) {
      fx.files.delete(key);
      fx.files.set(to, value);
    } else if (key.startsWith(from + "/")) {
      isDir = true;
      fx.files.delete(key);
      fx.files.set(to + key.slice(from.length), value);
    }
  }
  return isDir;
}

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const err = (error: string) => Promise.resolve({ status: "error" as const, error });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "codeTree":
              return () => ok(fullTree());
            case "codeDir":
              return (_p: number, rel: string) => ok({ entries: dirEntries(rel), truncated: false });
            case "codeRead":
              return (_p: number, rel: string) => {
                fx.ops.reads += 1;
                const hit = fx.files.get(rel);
                return hit === undefined ? err("Failed to read file") : ok(textFile(hit));
              };
            case "codeWrite":
              return () => ok({ kind: "saved", hash: "h2" });
            case "codeCreate":
              return (_p: number, rel: string) => {
                fx.ops.create.push(rel);
                fx.files.set(rel, "");
                return ok({ relative_path: rel, is_dir: false } satisfies CodePathResult);
              };
            case "codeMkdir":
              return (_p: number, rel: string) => {
                fx.ops.mkdir.push(rel);
                fx.files.set(rel + "/", "");
                return ok({ relative_path: rel, is_dir: true } satisfies CodePathResult);
              };
            case "codeRename":
              return (_p: number, from: string, to: string) => {
                fx.ops.rename.push({ from, to });
                const isDir = movePrefix(from, to);
                return ok({ relative_path: to, is_dir: isDir } satisfies CodePathResult);
              };
            case "codeDelete":
              return (_p: number, rel: string) => {
                fx.ops.del.push(rel);
                for (const key of [...fx.files.keys()]) {
                  if (key === rel || key.startsWith(rel + "/")) fx.files.delete(key);
                }
                return ok(null);
              };
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

// CM 목 — 내용을 그대로 보여 주고 편집만 흉내낸다 (jsdom 에 측정 API 가 없다).
vi.mock("@/features/code/CodeEditor", () => ({
  CodeEditor: ({
    initialText,
    path,
    onChange,
  }: {
    initialText: string;
    path: string;
    onChange: (t: string) => void;
  }) => (
    <div data-testid="editor" data-path={path}>
      <span data-testid="editor-text">{initialText}</span>
      <button data-testid="mutate" onClick={() => onChange(initialText + "!")} />
    </div>
  ),
}));

import { CodeScreenV2 } from "@/features/code/CodeScreenV2";
import { _resetBuffers, bufferKey, getBuffer } from "@/features/code/codeBuffers";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";

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

beforeEach(() => {
  localStorage.clear();
  _resetBuffers();
  fx.files = new Map([
    ["README.md", "# hello"],
    ["src/main.rs", "fn main() {}"],
    ["src/lib.rs", "pub fn x() {}"],
  ]);
  fx.ops = { reads: 0, create: [], mkdir: [], rename: [], del: [] };
});
afterEach(cleanup);

// 질의는 전부 자리를 좁혀서 한다 — 같은 파일 이름이 트리 행과 탭 양쪽에
// 있고, 아이콘 버튼은 title 과 aria-label 을 둘 다 갖는다.

/** 탭 바에 보이는 파일 이름들 (좌→우). */
function tabNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".code-tab .code-tab-name")].map((n) => n.textContent ?? "");
}

/** 트리에서 이 이름의 행 (탭이 아니라). */
function treeRow(container: HTMLElement, name: string): HTMLElement {
  const hit = [...container.querySelectorAll(".code-tree-row")].find(
    (row) => row.querySelector(".code-tree-label")?.textContent === name,
  );
  if (!hit) throw new Error(`트리에 "${name}" 행이 없습니다`);
  return hit as HTMLElement;
}

/** 지금 떠 있는 우클릭 메뉴에서 이 라벨의 항목. */
function menuItem(label: string): HTMLElement {
  const hit = [...document.querySelectorAll(".code-ctxmenu-item")].find(
    (el) => el.textContent === label,
  );
  if (!hit) throw new Error(`메뉴에 "${label}" 항목이 없습니다`);
  return hit as HTMLElement;
}

function iconButton(container: HTMLElement, selector: string, label: string): HTMLElement {
  const hit = container.querySelector(`${selector} button[aria-label="${label}"]`);
  if (!hit) throw new Error(`"${label}" 버튼이 없습니다`);
  return hit as HTMLElement;
}

/** 인라인 입력칸 (새 파일·새 폴더·이름 바꾸기 공용). */
function draftInput(container: HTMLElement): HTMLInputElement {
  const hit = container.querySelector(".code-tree-draft-input");
  if (!hit) throw new Error("인라인 입력칸이 없습니다");
  return hit as HTMLInputElement;
}

function typeAndCommit(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("코드 화면 — 탭", () => {
  it("여러 파일을 열면 탭이 쌓이고, 탭을 눌러 전환한다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));

    fireEvent.click(await findByText("src"));
    fireEvent.click(await findByText("main.rs"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("fn main() {}"));
    expect(tabNames(container)).toEqual(["README.md", "main.rs"]);

    // 탭으로 되돌아가기 — 트리를 거치지 않는다.
    fireEvent.click(container.querySelectorAll(".code-tab")[0]);
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
  });

  it("탭을 닫으면 이웃이 올라온다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    fireEvent.click(await findByText("src"));
    fireEvent.click(await findByText("main.rs"));
    await waitFor(() => expect(tabNames(container)).toHaveLength(2));

    fireEvent.click(container.querySelectorAll(".code-tab .code-tab-close")[1]);
    await waitFor(() => expect(tabNames(container)).toEqual(["README.md"]));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
  });

  it("좌우로 나누면 창이 둘 뜨고, 합치면 하나로 돌아온다", async () => {
    const { findByText, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(tabNames(container)).toEqual(["README.md"]));

    fireEvent.click(iconButton(container, ".code-tabs-actions", t("code.tabs.split")));
    await waitFor(() => expect(container.querySelectorAll(".code-pane")).toHaveLength(2));
    // 보던 파일이 새 창에도 실린다 (빈 창을 띄우지 않는다).
    expect(tabNames(container)).toEqual(["README.md", "README.md"]);

    fireEvent.click(iconButton(container, ".code-tabs-actions", t("code.tabs.unsplit")));
    await waitFor(() => expect(container.querySelectorAll(".code-pane")).toHaveLength(1));
  });

  it("연 파일을 되풀이해 다시 읽지 않는다", async () => {
    // 회귀 방지: 화면이 창에 **매 렌더 새 신원의 콜백**을 넘기면 CodePane 의
    // `loadFile` 이 재생성되고, 그것에 매달린 effect 가 파일을 다시 읽는다.
    // 그 읽기가 또 상태를 바꿔 렌더를 부르므로 **끝나지 않는 재읽기 루프**가
    // 된다 — 편집기가 "불러오는 중" 에서 못 빠져나오고 상태줄도 안 뜬다.
    // (미저장 편집 자체는 버퍼 캐시가 지켜 준다. 깨지는 것은 화면이다.)
    const { findByText, getByTestId, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
    const afterOpen = fx.ops.reads;

    fireEvent.click(getByTestId("mutate"));
    await waitFor(() => expect(container.querySelector(".code-tab.dirty")).toBeTruthy());
    // 화면 상태를 여러 번 건드려 리렌더를 강제한다.
    const filter = container.querySelector(".code-filter input") as HTMLInputElement;
    for (const v of ["R", "RE", "R", ""]) fireEvent.change(filter, { target: { value: v } });
    await waitFor(() => expect(container.querySelector(".code-filter input")).toBeTruthy());

    // 편집도 리렌더도 파일을 다시 읽게 하지 않는다.
    expect(fx.ops.reads).toBe(afterOpen);
    // 그리고 편집기는 여전히 살아 있다 (루프면 "불러오는 중" 에 갇혀 사라진다).
    expect(getByTestId("editor-text").textContent).toBe("# hello!");
    expect(getBuffer(bufferKey(1, "README.md"))?.text).toBe("# hello!");
  });

  it("열어 둔 탭은 다시 열었을 때 되살아난다", async () => {
    const first = renderScreen();
    fireEvent.click(await first.findByText("README.md"));
    await waitFor(() => expect(tabNames(first.container)).toEqual(["README.md"]));
    // 영속은 디바운스된다 — 저장이 실제로 나갈 때까지 기다린다.
    await waitFor(() => expect(localStorage.getItem("aipm:workspace:v2:p1")).toContain("README.md"));
    cleanup();

    const again = renderScreen();
    await waitFor(() => expect(tabNames(again.container)).toEqual(["README.md"]));
  });
});

describe("코드 화면 — 파일 조작", () => {
  /** 트리 행을 우클릭해 메뉴를 띄우고, 라벨로 항목을 누른다. */
  function pickMenu(container: HTMLElement, rowName: string, itemLabel: string) {
    fireEvent.contextMenu(treeRow(container, rowName));
    fireEvent.click(menuItem(itemLabel));
  }

  it("새 파일을 만들면 인라인 입력이 뜨고, 만든 파일이 탭에 열린다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    await findByText("README.md"); // 트리가 그려질 때까지
    fireEvent.click(iconButton(container, ".code-sidebar-head", t("code.ops.newFile")));
    typeAndCommit(draftInput(container), "NOTES.md");

    await waitFor(() => expect(fx.ops.create).toEqual(["NOTES.md"]));
    await waitFor(() => expect(tabNames(container)).toEqual(["NOTES.md"]));
    // 탭이 뜨는 것과 내용이 실리는 것은 한 틱이 아니다 — 편집기까지 기다린다.
    await waitFor(() =>
      expect(getByTestId("editor").getAttribute("data-path")).toBe("NOTES.md"),
    );
    // 새 파일이 트리에도 나타난다 (조작 후 그 단계를 다시 읽는다).
    await waitFor(() => expect(treeRow(container, "NOTES.md")).toBeTruthy());
  });

  it("새 폴더는 만들되 열지 않는다", async () => {
    const { findByText, container } = renderScreen();
    await findByText("README.md");
    fireEvent.click(iconButton(container, ".code-sidebar-head", t("code.ops.newFolder")));
    typeAndCommit(draftInput(container), "docs");

    await waitFor(() => expect(fx.ops.mkdir).toEqual(["docs"]));
    expect(tabNames(container)).toEqual([]);
  });

  it("이름을 바꾸면 열려 있던 탭과 미저장 편집이 새 경로로 따라온다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
    // 저장하지 않은 편집을 만들어 둔다 — 이것이 사라지면 안 된다.
    fireEvent.click(getByTestId("mutate"));
    await waitFor(() => expect(getBuffer(bufferKey(1, "README.md"))?.text).toBe("# hello!"));

    pickMenu(container, "README.md", t("code.ops.rename"));
    typeAndCommit(draftInput(container), "GUIDE.md");

    await waitFor(() => expect(fx.ops.rename).toEqual([{ from: "README.md", to: "GUIDE.md" }]));
    await waitFor(() => expect(tabNames(container)).toEqual(["GUIDE.md"]));
    // 버퍼가 새 키로 옮겨 갔다 — 편집 내용 그대로.
    expect(getBuffer(bufferKey(1, "README.md"))).toBeUndefined();
    expect(getBuffer(bufferKey(1, "GUIDE.md"))?.text).toBe("# hello!");
  });

  it("폴더 이름을 바꾸면 그 아래 열린 탭이 전부 따라온다", async () => {
    const { findByText, container } = renderScreen();
    fireEvent.click(await findByText("src"));
    fireEvent.click(await findByText("main.rs"));
    await waitFor(() => expect(tabNames(container)).toEqual(["main.rs"]));

    pickMenu(container, "src", t("code.ops.rename"));
    typeAndCommit(draftInput(container), "lib");

    await waitFor(() => expect(fx.ops.rename).toEqual([{ from: "src", to: "lib" }]));
    // 탭 이름은 그대로지만 가리키는 경로가 바뀌었다 — 편집기가 새 경로를 든다.
    await waitFor(() =>
      expect(container.querySelector("[data-testid='editor']")?.getAttribute("data-path")).toBe(
        "lib/main.rs",
      ),
    );
  });

  it("삭제는 확인을 받고, 함께 닫히는 탭을 먼저 보여준다", async () => {
    const { findByText, findByRole, container, queryByRole } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(tabNames(container)).toEqual(["README.md"]));

    pickMenu(container, "README.md", t("code.ops.delete"));
    const dialog = await findByRole("dialog");
    // 되돌릴 수 있다는 사실과, 무엇이 함께 닫히는지를 누르기 전에 말한다.
    expect(dialog.textContent).toContain(t("code.ops.deleteTrashNote"));
    expect(dialog.textContent).toContain("README.md");
    expect(fx.ops.del).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: t("code.ops.delete") }));
    await waitFor(() => expect(fx.ops.del).toEqual(["README.md"]));
    await waitFor(() => expect(tabNames(container)).toEqual([]));
    await waitFor(() => expect(queryByRole("dialog")).toBeNull());
  });

  it("삭제를 취소하면 아무 일도 일어나지 않는다", async () => {
    const { findByText, findByRole, container } = renderScreen();
    await findByText("README.md");
    pickMenu(container, "README.md", t("code.ops.delete"));
    const dialog = await findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(fx.ops.del).toEqual([]));
    expect(fx.files.has("README.md")).toBe(true);
  });
});
