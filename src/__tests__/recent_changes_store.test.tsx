import { describe, expect, it, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

import { recentChangesStore, useRecentChanges } from "@/lib/recentChangesStore";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";

// v2 U3 (docs/20260706_v2/03-performance-spec.md §1) — 리렌더 격리 계약.
// watcher 파일 이벤트(store.push)가 WorkspaceContext 소비자를 리렌더하지
// 않아야 한다. 이 격리가 깨지면(버퍼가 다시 컨텍스트 상태로 들어가면) 여기서
// 잡힌다.

let contextRenders = 0;
let storeRenders = 0;

function ContextConsumer() {
  useWorkspace();
  contextRenders += 1;
  return null;
}

function StoreConsumer() {
  const changes = useRecentChanges();
  storeRenders += 1;
  return <div data-testid="count">{changes.length}</div>;
}

beforeEach(() => {
  recentChangesStore.clear();
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
      recentChangesStore.push({ path: "src/a.ts", op: "M", ts: 1, read: false });
      recentChangesStore.push({ path: "src/b.ts", op: "A", ts: 2, read: false });
    });

    expect(storeRenders).toBeGreaterThan(storeBefore); // 구독자는 갱신
    expect(contextRenders).toBe(ctxBefore); // 컨텍스트 소비자는 그대로
  });

  it("markRead 는 no-op 조건에서 구독자에게 알리지 않는다", () => {
    recentChangesStore.push({ path: "src/a.ts", op: "M", ts: 1, read: false });
    let notifications = 0;
    const off = recentChangesStore.subscribe(() => {
      notifications += 1;
    });
    recentChangesStore.markRead("없는/경로.ts"); // 버퍼에 없음 — no-op
    recentChangesStore.markRead("src/a.ts"); // 실제 갱신 — 1회 알림
    recentChangesStore.markRead("src/a.ts"); // 이미 read — no-op
    off();
    expect(notifications).toBe(1);
    expect(recentChangesStore.get()[0]?.read).toBe(true);
  });

  it("clear 는 빈 버퍼에서 no-op, 채워진 버퍼를 비운다", () => {
    act(() => {
      recentChangesStore.push({ path: "src/a.ts", op: "M", ts: 1, read: false });
    });
    recentChangesStore.clear();
    expect(recentChangesStore.get()).toEqual([]);
    recentChangesStore.clear(); // no-throw
  });
});
