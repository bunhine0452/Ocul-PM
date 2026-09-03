// 옮기기의 [되돌리기] — 토스트에 버튼이 붙고, 눌렀을 때 **정말로** 되돌아가는가.
//
// 삭제에는 버튼이 없다는 것도 같이 잰다: OS 휴지통은 macOS 에서 프로그램이
// 되짚을 수 없어(`trash` 크레이트 `os_limited` 는 Windows·Linux 전용) 눌러도
// 안 되는 버튼을 다느니 없는 편이 정직하다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const rename = vi.fn();
const del = vi.fn();
vi.mock("@/api/code", () => ({
  codeFileApi: {
    rename: (...a: unknown[]) => rename(...a),
    delete: (...a: unknown[]) => del(...a),
    create: vi.fn(),
    mkdir: vi.fn(),
  },
}));

import { useFileOps } from "@/features/code/useFileOps";
import { emptyTabs } from "@/features/code/codeTabs";
import { getToasts, type Toast } from "@/lib/toast";

function setup() {
  const clearMarks = vi.fn();
  const hook = renderHook(() =>
    useFileOps({
      projectId: 1,
      rootName: "ai-pm",
      tabsRef: { current: emptyTabs() },
      setTabs: vi.fn(),
      setExpanded: vi.fn(),
      refreshDirtyPaths: vi.fn(),
      reloadAfterOp: vi.fn(),
      loadDir: vi.fn(),
      openPath: vi.fn(),
      clearMarks,
    }),
  );
  return { ...hook, clearMarks };
}

/** 지금 떠 있는 마지막 토스트. */
function latest(): Toast {
  const all = getToasts();
  return all[all.length - 1];
}

beforeEach(() => {
  rename.mockReset();
  del.mockReset();
  // 백엔드는 새 경로와 폴더 여부를 알려 준다 — 프런트는 그것을 믿는다.
  rename.mockImplementation((_p: number, _from: string, to: string) =>
    Promise.resolve({ relative_path: to, is_dir: false }),
  );
  del.mockResolvedValue(null);
  for (const t of getToasts()) t.durationMs = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("옮기기 되돌리기", () => {
  it("하나를 옮기면 [되돌리기] 가 붙고, 누르면 제자리로 돌아간다", async () => {
    const { result } = setup();
    act(() => result.current.moveInto(["a.ts"], "src"));
    await waitFor(() => expect(rename).toHaveBeenCalledWith(1, "a.ts", "src/a.ts"));

    const toast = latest();
    expect(toast.message).toContain("a.ts");
    expect(toast.message).toContain("옮겼습니다");
    const undo = toast.actions?.[0];
    expect(undo?.label).toBe("되돌리기");

    rename.mockClear();
    act(() => undo!.onClick());
    await waitFor(() => expect(rename).toHaveBeenCalledWith(1, "src/a.ts", "a.ts"));
  });

  it("여럿을 옮기면 토스트는 하나, 되돌리기는 **역순**으로 전부", async () => {
    const { result } = setup();
    act(() => result.current.moveInto(["a.ts", "b.ts"], "src"));
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(2));
    expect(latest().message).toContain("2개를");

    rename.mockClear();
    act(() => latest().actions![0].onClick());
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(2));
    // 역순 — a→b, b→c 사슬을 앞에서부터 풀면 되돌린 것을 다시 데려간다.
    expect(rename.mock.calls.map((c) => c[1])).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("실패한 것에는 되돌리기를 걸지 않는다 (성공한 만큼만)", async () => {
    const { result } = setup();
    rename.mockImplementation((_p: number, from: string, to: string) =>
      from === "b.ts" ? Promise.reject(new Error("nope")) : Promise.resolve({ relative_path: to, is_dir: false }),
    );
    act(() => result.current.moveInto(["a.ts", "b.ts"], "src"));
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(2));

    rename.mockClear();
    act(() => latest().actions![0].onClick());
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    expect(rename).toHaveBeenCalledWith(1, "src/a.ts", "a.ts");
  });

  it("폴더와 그 안의 파일을 함께 뽑아도 폴더 한 번만 옮긴다", async () => {
    const { result } = setup();
    act(() => result.current.moveInto(["src", "src/main.ts"], "lib"));
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    expect(rename).toHaveBeenCalledWith(1, "src", "lib/src");
  });

  it("옮기고 나면 뽑아 둔 것을 비운다 — 사라진 경로가 남으면 안 된다", async () => {
    const { result, clearMarks } = setup();
    act(() => result.current.moveInto(["a.ts"], "src"));
    await waitFor(() => expect(clearMarks).toHaveBeenCalled());
  });
});

describe("삭제", () => {
  it("여럿을 지우고, [되돌리기] 는 달지 않는다 (휴지통은 앱이 되짚을 수 없다)", async () => {
    const { result } = setup();
    act(() =>
      result.current.askDelete([
        { path: "a.ts", isDir: false },
        { path: "lib", isDir: true },
      ]),
    );
    expect(result.current.pendingDelete?.targets).toHaveLength(2);

    act(() => result.current.confirmDelete());
    await waitFor(() => expect(del).toHaveBeenCalledTimes(2));
    const toast = latest();
    expect(toast.message).toContain("2개를 휴지통으로 보냈습니다");
    expect(toast.actions).toBeUndefined();
  });

  it("확인 창에 걸기 전에 후손을 걷어낸다 — 폴더를 지우면 안의 것은 이미 사라진다", () => {
    const { result } = setup();
    act(() =>
      result.current.askDelete([
        { path: "src", isDir: true },
        { path: "src/main.ts", isDir: false },
      ]),
    );
    expect(result.current.pendingDelete?.targets).toEqual([{ path: "src", isDir: true }]);
  });
});
