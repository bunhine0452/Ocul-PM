// 코드 화면 Phase 1 — 탭·분할·파일 조작이 **열려 있는 버퍼와 어긋나지 않는지**.
//
// 순수 로직은 code_tabs / code_file_ops 가 덮는다. 여기서 확인하는 것은 그
// 로직이 실제 화면에서 백엔드 호출과 함께 옳게 엮이는가다 — 특히 이름을
// 바꾸거나 지운 파일이 탭에 열려 있을 때.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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
  /** 파일 → 그 파일을 만진 일지들 (#agent-diff 칩). */
  entries: Map<string, unknown[]>;
  /** HEAD 시점 내용 (null = HEAD 에 없음). */
  head: Map<string, string>;
} = {
  files: new Map(),
  ops: { reads: 0, create: [], mkdir: [], rename: [], del: [] },
  entries: new Map(),
  head: new Map(),
};

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
            case "codeFileEntries":
              return (_p: number, rel: string) => ok(fx.entries.get(rel) ?? []);
            case "codeHeadContent":
              return (_p: number, rel: string) => ok(fx.head.get(rel) ?? null);
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
import { runCloseIntent } from "@/lib/closeIntent";
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
  fx.entries = new Map();
  fx.head = new Map();
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

/**
 * 트리에서 **고정으로** 연다 (단일 클릭 → 더블 클릭).
 *
 * 미리보기 탭이 기본이 된 뒤로, 트리를 한 번씩 누르는 것만으로는 탭이 쌓이지
 * 않는다 — 자리 하나를 돌려 쓰는 것이 요점이다. 탭이 둘 이상 필요한 테스트는
 * 실제 사용과 같이 더블클릭으로 고정한다.
 */
function openPinned(el: HTMLElement) {
  fireEvent.click(el);
  fireEvent.doubleClick(el);
}

describe("코드 화면 — 탭", () => {
  it("여러 파일을 열면 탭이 쌓이고, 탭을 눌러 전환한다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    openPinned(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));

    fireEvent.click(await findByText("src"));
    openPinned(await findByText("main.rs"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("fn main() {}"));
    expect(tabNames(container)).toEqual(["README.md", "main.rs"]);

    // 탭으로 되돌아가기 — 트리를 거치지 않는다.
    fireEvent.click(container.querySelectorAll(".code-tab")[0]);
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
  });

  it("훑어보기만 하면 탭이 쌓이지 않는다 — 미리보기 자리를 돌려 쓴다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
    expect(container.querySelectorAll(".code-tab.preview")).toHaveLength(1);

    fireEvent.click(await findByText("src"));
    fireEvent.click(await findByText("main.rs"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("fn main() {}"));
    // 트리를 두 번 눌렀지만 탭은 하나다 — 두 번째가 첫 번째 자리를 차지했다.
    expect(tabNames(container)).toEqual(["main.rs"]);

    // 고치기 시작하면 그 탭은 더 이상 훑는 중이 아니다.
    fireEvent.click(getByTestId("mutate"));
    await waitFor(() => expect(container.querySelectorAll(".code-tab.preview")).toHaveLength(0));
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(tabNames(container)).toEqual(["main.rs", "README.md"]));
  });

  it("탭을 닫으면 이웃이 올라온다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    openPinned(await findByText("README.md"));
    fireEvent.click(await findByText("src"));
    openPinned(await findByText("main.rs"));
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

describe("코드 화면 — 탭 키보드 UX (#tab-keys)", () => {
  /** jsdom 은 레이아웃이 없어 getClientRects 가 늘 빈 목록이다 — "보이는 화면"
   *  가드를 통과시키려면 상자 하나를 흉내내야 한다. */
  let rects: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rects = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{ x: 0, y: 0, width: 800, height: 600 }] as unknown as DOMRectList);
  });
  afterEach(() => {
    rects.mockRestore();
  });

  /** 지금 활성인 탭의 파일 이름. */
  function activeTab(container: HTMLElement): string | null {
    return container.querySelector(".code-tab.on .code-tab-name")?.textContent ?? null;
  }

  async function openTwo(r: ReturnType<typeof renderScreen>) {
    openPinned(await r.findByText("README.md"));
    fireEvent.click(await r.findByText("src"));
    openPinned(await r.findByText("main.rs"));
    await waitFor(() => expect(tabNames(r.container)).toEqual(["README.md", "main.rs"]));
  }

  it("⌘W(닫기 사슬)가 활성 탭부터 닫고, 탭이 다 떨어지면 창 차례로 넘긴다", async () => {
    const r = renderScreen();
    await openTwo(r);

    let handled = false;
    act(() => {
      handled = runCloseIntent();
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(tabNames(r.container)).toEqual(["README.md"]));

    act(() => {
      handled = runCloseIntent();
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(tabNames(r.container)).toEqual([]));

    // 더 닫을 코드 탭이 없다 — 사슬을 받지 않아야 프로젝트 탭이 닫힌다.
    act(() => {
      handled = runCloseIntent();
    });
    expect(handled).toBe(false);
  });

  it("안 보이는 화면(배경 프로젝트 탭)은 ⌘W 를 받지 않는다", async () => {
    const r = renderScreen();
    await openTwo(r);
    // display:none 흉내 — 레이아웃 상자가 사라진다.
    rects.mockReturnValue([] as unknown as DOMRectList);

    let handled = true;
    act(() => {
      handled = runCloseIntent();
    });
    expect(handled).toBe(false);
    expect(tabNames(r.container)).toEqual(["README.md", "main.rs"]);
  });

  it("⌃Tab · ⇧⌘] 가 탭을 순환한다", async () => {
    const r = renderScreen();
    await openTwo(r);
    expect(activeTab(r.container)).toBe("main.rs");

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    await waitFor(() => expect(activeTab(r.container)).toBe("README.md"));

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(activeTab(r.container)).toBe("main.rs"));

    fireEvent.keyDown(window, { key: "]", code: "BracketRight", metaKey: true, shiftKey: true });
    await waitFor(() => expect(activeTab(r.container)).toBe("README.md"));
  });

  it("⇧⌘T 가 마지막으로 닫은 탭을 되살린다", async () => {
    const r = renderScreen();
    await openTwo(r);
    act(() => {
      runCloseIntent(); // main.rs 닫힘
    });
    await waitFor(() => expect(tabNames(r.container)).toEqual(["README.md"]));

    fireEvent.keyDown(window, { key: "T", metaKey: true, shiftKey: true });
    await waitFor(() => expect(tabNames(r.container)).toEqual(["README.md", "main.rs"]));
    expect(activeTab(r.container)).toBe("main.rs");
  });

  it("닫은 사이 디스크에서 사라진 파일은 되살리지 않는다", async () => {
    const r = renderScreen();
    await openTwo(r);
    act(() => {
      runCloseIntent();
    });
    await waitFor(() => expect(tabNames(r.container)).toEqual(["README.md"]));

    fx.files.delete("src/main.rs");
    const readsBefore = fx.ops.reads;
    fireEvent.keyDown(window, { key: "T", metaKey: true, shiftKey: true });
    // 깨진 탭을 열어 두는 대신 아무 일도 없어야 한다 (토스트는 전역 스택).
    await waitFor(() => expect(fx.ops.reads).toBeGreaterThan(readsBefore));
    expect(tabNames(r.container)).toEqual(["README.md"]);
  });

  it("탭 우클릭 메뉴의 「닫은 탭 다시 열기」가 같은 일을 한다", async () => {
    const r = renderScreen();
    await openTwo(r);
    // × 로 닫아도 기억된다.
    fireEvent.click(r.container.querySelectorAll(".code-tab .code-tab-close")[1]);
    await waitFor(() => expect(tabNames(r.container)).toEqual(["README.md"]));

    fireEvent.contextMenu(r.container.querySelector(".code-tab") as HTMLElement);
    const item = [...document.querySelectorAll(".code-ctxmenu-item")].find((el) =>
      el.textContent?.startsWith(t("code.tabs.reopen")),
    ) as HTMLButtonElement;
    expect(item).toBeTruthy();
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    await waitFor(() => expect(tabNames(r.container)).toEqual(["README.md", "main.rs"]));
  });

  it("⌘N 이 보고 있던 파일의 폴더에 새 파일 입력을 연다", async () => {
    const r = renderScreen();
    fireEvent.click(await r.findByText("src"));
    fireEvent.click(await r.findByText("main.rs"));
    await waitFor(() => expect(tabNames(r.container)).toEqual(["main.rs"]));

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    typeAndCommit(draftInput(r.container), "util.rs");
    await waitFor(() => expect(fx.ops.create).toEqual(["src/util.rs"]));
  });
});

describe("코드 화면 — 트리 사이드바 좌/우 (#sidebar-side)", () => {
  const isSidebar = (el: Element | null) => el?.classList.contains("code-sidebar") ?? false;

  it("토글이 트리를 오른쪽으로 옮기고(영속), 다시 왼쪽으로 되돌린다", async () => {
    const { findByText, container } = renderScreen();
    await findByText("README.md");
    const body = () => container.querySelector(".code-body") as HTMLElement;
    // 기본: 왼쪽 — DOM 순서도 화면 순서와 같다 (사이드바가 첫 자식).
    expect(isSidebar(body().firstElementChild)).toBe(true);

    fireEvent.click(
      container.querySelector(`button[aria-label="${t("code.sidebar.toRight")}"]`) as HTMLElement,
    );
    await waitFor(() => expect(isSidebar(body().lastElementChild)).toBe(true));
    expect(isSidebar(body().firstElementChild)).toBe(false);
    expect(body().querySelector(".code-sidebar.on-right")).toBeTruthy();
    // 워크스페이스에 영속된다 (디바운스 — 실제 저장까지 기다린다).
    await waitFor(() =>
      expect(localStorage.getItem("aipm:workspace:v2:p1")).toContain('"codeSidebarSide":"right"'),
    );

    fireEvent.click(
      container.querySelector(`button[aria-label="${t("code.sidebar.toLeft")}"]`) as HTMLElement,
    );
    await waitFor(() => expect(isSidebar(body().firstElementChild)).toBe(true));
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

describe("코드 화면 — 에이전트 변경 가시화 (#agent-diff)", () => {
  const entry = {
    journal_path: "20260823/Bugs/0900_bug_fix.md",
    title: "널 가드 추가",
    entry_type: "bug",
    agent_id: "claude-code",
    created_at: "2026-08-23T09:00:00+09:00",
    op: "update",
  };

  it("이 파일을 만진 일지가 있으면 브레드크럼에 칩이 뜨고, 클릭하면 목록이 열린다", async () => {
    fx.entries.set("README.md", [entry]);
    const { findByText, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));

    const chip = await waitFor(() => {
      const el = container.querySelector(".code-crumbs-actions .code-crumb-act");
      if (!el) throw new Error("칩 없음");
      return el as HTMLElement;
    });
    expect(chip.textContent).toContain("1");
    fireEvent.click(chip);
    await findByText("널 가드 추가");
    await findByText(t("code.jrnl.title"));
  });

  it("일지 항목을 클릭하면 일지 화면 점프 이벤트가 나간다", async () => {
    fx.entries.set("README.md", [entry]);
    const seen: unknown[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("oculpm:open-entity", listen);
    try {
      const { findByText, container } = renderScreen();
      fireEvent.click(await findByText("README.md"));
      await waitFor(() => {
        if (!container.querySelector(".code-crumb-act")) throw new Error("칩 없음");
      });
      fireEvent.click(container.querySelector(".code-crumb-act") as HTMLElement);
      fireEvent.click(await findByText("널 가드 추가"));
      expect(seen).toEqual([{ kind: "journal", id: entry.journal_path }]);
    } finally {
      window.removeEventListener("oculpm:open-entity", listen);
    }
  });

  it("만진 일지가 없으면 칩 자체가 없다", async () => {
    const { findByText, getByTestId, container } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
    expect(container.querySelector(".code-crumbs-actions .code-crumb-act-n")).toBeNull();
  });

  it("HEAD 비교를 켜면 배너가 뜨고, 끄면 사라진다", async () => {
    fx.head.set("README.md", "# 옛 내용");
    const { findByText, getByTestId, container, queryByText } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));

    const toggle = container.querySelector(
      `.code-crumbs-actions button[aria-label="${t("code.diff.head")}"]`,
    ) as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    await findByText(t("code.diff.banner.head"));

    fireEvent.click(
      container.querySelector(`button[aria-label="${t("code.diff.exit")}"]`) as HTMLElement,
    );
    await waitFor(() => expect(queryByText(t("code.diff.banner.head"))).toBeNull());
  });

  it("HEAD 에 없는 파일은 비교 대신 이유를 말한다", async () => {
    // head 픽스처 없음 = codeHeadContent 가 null.
    const { findByText, getByTestId, container, queryByText } = renderScreen();
    fireEvent.click(await findByText("README.md"));
    await waitFor(() => expect(getByTestId("editor-text").textContent).toBe("# hello"));
    fireEvent.click(
      container.querySelector(
        `.code-crumbs-actions button[aria-label="${t("code.diff.head")}"]`,
      ) as HTMLElement,
    );
    // 배너는 안 뜬다 (토스트는 전역 스택이라 여기선 부재만 단언).
    await waitFor(() => expect(queryByText(t("code.diff.banner.head"))).toBeNull());
  });
});
