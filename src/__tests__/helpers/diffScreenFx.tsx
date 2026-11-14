/**
 * 변경 화면 시험의 그리기 도우미 (11-15) — 가짜 백엔드는 `diffFx.ts` 가 갖는다. 이 파일은 앱 모듈을
 * 들이므로 `vi.mock` 공장 안에서 들이면 안 된다(공장이 자기 자신을 기다리며 멈춘다).
 */
import { render } from "@testing-library/react";

import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider, storageKeyFor } from "@/contexts/WorkspaceContext";
import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import { clearNotes } from "@/features/diff/diffNoteStore";
import { resetDiffSession } from "@/features/diff/diffSessionStore";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { resetBackend } from "./diffFx";

export { fx, GIT_PATCH, type SentCtx } from "./diffFx";

export function resetFx(): void {
  resetBackend();
  localStorage.clear();
  recentChangesStore.clear();
  resetDiffSession();
  clearNotes(1);
}

/** 워처 버퍼에 변경을 싣는다(차례대로 ts 1, 2, …) + 워크스페이스 영속 값. */
export function seed(changes: Array<{ path: string; op: "A" | "M" | "D" }>, extra: Record<string, unknown> = {}): void {
  changes.forEach((c, i) => recentChangesStore.push(1, { ...c, ts: i + 1, read: false }));
  if (Object.keys(extra).length > 0) localStorage.setItem(storageKeyFor(1), JSON.stringify(extra));
}

export function renderDiffScreen() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <DiffScreenV2 projectId={1} projectRoot="/tmp/proj" />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

/** 일지 묶음 하나. */
export function entryGroup(path: string, title: string, files: string[], extra: Record<string, unknown> = {}) {
  return {
    entry_path: path,
    entry_title: title,
    entry_type: "bug",
    created_at: "2026-08-20T10:00:00+09:00",
    verified_by_user: false,
    verified_stale: false,
    plan_refs: [],
    files,
    ...extra,
  };
}

/** 일지 없는 파일 묶음(끝의 `entry_path: null`). */
export function looseGroup(files: string[]) {
  return {
    entry_path: null,
    entry_title: null,
    entry_type: null,
    created_at: null,
    verified_by_user: null,
    verified_stale: null,
    plan_refs: [],
    files,
  };
}

/** 일지 요약(증거 등급) — `evidence` 0 이면 검증 없음. */
export function summaryOf(path: string, evidence: number) {
  return {
    relative_path: path,
    workday: "20260820",
    type: "bug",
    slug: "x",
    status: "done",
    title: "t",
    session_id: "s",
    agent_id: "claude-code",
    verified_by_user: false,
    verified_stale: false,
    evidence,
    created_at: "2026-08-20T10:00:00+09:00",
    files_count: 1,
  };
}

export const activeName = (el: HTMLElement) =>
  el.querySelector('.chg-item[aria-current="true"] .chg-name')?.textContent ?? null;
