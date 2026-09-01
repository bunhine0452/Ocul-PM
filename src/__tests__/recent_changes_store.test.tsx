import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { cleanup, render, act } from "@testing-library/react";

import { recentChangesStore, useRecentChanges } from "@/lib/recentChangesStore";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";

// v2 U3 (docs/20260706_v2/03-performance-spec.md §1) — 리렌더 격리 계약.
// watcher 파일 이벤트(store.push)가 WorkspaceContext 소비자를 리렌더하지
// 않아야 한다. 이 격리가 깨지면(버퍼가 다시 컨텍스트 상태로 들어가면) 여기서
// 잡힌다.
//
// 2026-09-01 — **프로젝트 격리** 계약이 추가됐다. 크롬식 탭 이후 한 창의 모든
// 프로젝트 탭이 이 모듈 하나를 공유하므로, 버퍼가 프로젝트별로 갈라지지 않으면
// A 의 변경이 B 의 「미기록 변경」 목록에 뜬다.

let contextRenders = 0;
let storeRenders = 0;

function ContextConsumer() {
  useWorkspace();
  contextRenders += 1;
  return null;
}

function StoreConsumer({ projectId = 1 }: { projectId?: number }) {
  const changes = useRecentChanges(projectId);
  storeRenders += 1;
  return <div data-testid={`count-${projectId}`}>{changes.length}</div>;
}

afterEach(() => cleanup());

beforeEach(() => {
  recentChangesStore.clear(); // 인자 없음 = 모든 프로젝트 버킷
  contextRenders = 0;
  storeRenders = 0;
});

describe("recentChangesStore — 리렌더 격리", () => {
  it("store.push 는 컨텍스트 소비자를 리렌더하지 않는다", () => {
    render(
      <WorkspaceProvider projectId={1}>
        <ContextConsumer />
        <StoreConsumer />
      </WorkspaceProvider>,
    );
    const ctxBefore = contextRenders;
    const storeBefore = storeRenders;

    act(() => {
      recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: 1, read: false });
      recentChangesStore.push(1, { path: "src/b.ts", op: "A", ts: 2, read: false });
    });

    expect(storeRenders).toBeGreaterThan(storeBefore); // 구독자는 갱신
    expect(contextRenders).toBe(ctxBefore); // 컨텍스트 소비자는 그대로
  });

  it("markRead 는 no-op 조건에서 구독자에게 알리지 않는다", () => {
    recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: 1, read: false });
    let notifications = 0;
    const off = recentChangesStore.subscribe(() => {
      notifications += 1;
    });
    recentChangesStore.markRead(1, "없는/경로.ts"); // 버퍼에 없음 — no-op
    recentChangesStore.markRead(1, "src/a.ts"); // 실제 갱신 — 1회 알림
    recentChangesStore.markRead(1, "src/a.ts"); // 이미 read — no-op
    off();
    expect(notifications).toBe(1);
    expect(recentChangesStore.get(1)[0]?.read).toBe(true);
  });

  it("clear 는 빈 버퍼에서 no-op, 채워진 버퍼를 비운다", () => {
    act(() => {
      recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: 1, read: false });
    });
    recentChangesStore.clear(1);
    expect(recentChangesStore.get(1)).toEqual([]);
    recentChangesStore.clear(1); // no-throw
  });
});

describe("recentChangesStore — 프로젝트 격리", () => {
  it("한 프로젝트의 변경은 다른 프로젝트의 버퍼에 새지 않는다", () => {
    recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: 1, read: false });
    recentChangesStore.push(2, { path: "lib/b.rs", op: "A", ts: 2, read: false });

    expect(recentChangesStore.get(1).map((c) => c.path)).toEqual(["src/a.ts"]);
    expect(recentChangesStore.get(2).map((c) => c.path)).toEqual(["lib/b.rs"]);
  });

  it("같은 경로라도 프로젝트가 다르면 read 표시가 옮지 않는다", () => {
    recentChangesStore.push(1, { path: "src/App.tsx", op: "M", ts: 1, read: false });
    recentChangesStore.push(2, { path: "src/App.tsx", op: "M", ts: 1, read: false });

    recentChangesStore.markRead(2, "src/App.tsx");

    expect(recentChangesStore.get(1)[0]?.read).toBe(false);
    expect(recentChangesStore.get(2)[0]?.read).toBe(true);
  });

  it("한 프로젝트를 비워도 다른 프로젝트는 남는다", () => {
    recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: 1, read: false });
    recentChangesStore.push(2, { path: "lib/b.rs", op: "A", ts: 2, read: false });

    recentChangesStore.clear(1);

    expect(recentChangesStore.get(1)).toEqual([]);
    expect(recentChangesStore.get(2)).toHaveLength(1);
  });

  it("탭 두 개가 붙어 있어도 남의 변경으로 리렌더되지 않는다", () => {
    const { getByTestId } = render(
      <>
        <WorkspaceProvider projectId={1}>
          <StoreConsumer projectId={1} />
        </WorkspaceProvider>
        <WorkspaceProvider projectId={2}>
          <StoreConsumer projectId={2} />
        </WorkspaceProvider>
      </>,
    );

    act(() => {
      recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: 1, read: false });
    });

    expect(getByTestId("count-1").textContent).toBe("1");
    expect(getByTestId("count-2").textContent).toBe("0");
  });
});
