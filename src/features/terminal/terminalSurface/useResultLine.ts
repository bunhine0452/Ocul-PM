import { useEffect, type RefObject } from "react";

import { evidenceInbox } from "@/features/oculpm/evidenceInbox";
import { t } from "@/i18n";
import { isModKey } from "@/lib/kbd";
import { toast } from "@/lib/toast";
import type { TerminalHandles } from "../TerminalInstanceImpl";
import { lastResultLine, lastResultStore, useLatestResult, type LastResult } from "../lastResultStore";
import type { CommandBlock } from "../commandBlocks";

/**
 * 결과 끝 줄의 세 손 — 활성 탭의 최신 결과 · ⇧⌘J(검증 칸으로) · 명령 N/실패 N (UI 밀도 라운드 3).
 * `TerminalSurface` 에서 떼어 낸 조각이다 (파일 크기 래칫). 동작은 그 안에 있던 것과 같다.
 */
export function useResultLine(args: {
  sids: readonly string[];
  projectId: number | null;
  keyboardScope: "always" | "focused";
  rootRef: RefObject<HTMLDivElement | null>;
  regRef: RefObject<Map<string, TerminalHandles>>;
}): { latest: LastResult | null; blockStats: { total: number; failed: number }; outputOf: (sid: string) => string | null } {
  const { sids, projectId, keyboardScope, rootRef, regRef } = args;
  const latest = useLatestResult(sids);
  // ⇧⌘J — 포커스가 이 면 안에 있을 때만 (도크는 다른 화면 위에 얹힌다). 전역 단축키는 ⇧⌘J 를 넘긴다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isModKey(e) || !e.shiftKey || e.key.toLowerCase() !== "j") return;
      const root = rootRef.current;
      if (keyboardScope === "focused" && !(root && root.contains(document.activeElement))) return;
      if (!latest) return;
      e.preventDefault();
      const line = lastResultLine(latest);
      if (projectId != null) evidenceInbox.push(projectId, line);
      void navigator.clipboard?.writeText(line).then(() => toast.info(t("term.block.copiedVerification")));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [latest, keyboardScope, projectId, rootRef]);
  /** 명령 N · 실패 N — 활성 탭 페인들의 블록 장부 합. 셸 통합이 꺼져 있으면 0 이라 안 그린다. */
  const blockStats = sids.reduce(
    (acc, sid) => {
      const list = regRef.current?.get(sid)?.blocks.list() ?? [];
      acc.total += list.length;
      acc.failed += list.filter((b) => b.exitCode != null && b.exitCode !== 0).length;
      return acc;
    },
    { total: 0, failed: 0 },
  );
  const outputOf = (sid: string) => {
    const h = regRef.current?.get(sid);
    if (!h || !latest) return null;
    const block = h.blocks.list().find((b) => b.command === latest.command && b.exitCode !== undefined);
    return block ? h.blocks.outputOf(block.id) : null;
  };
  return { latest, blockStats, outputOf };
}

/** `onBlockDone` 한 줄 — 블록을 장부 모양으로 접어 저장소에 넣는다. */
export function recordBlockDone(sid: string, block: CommandBlock, lastLine: string): void {
  lastResultStore.set({
    sid,
    command: block.command,
    exitCode: block.exitCode ?? null,
    durationMs: block.durationMs ?? 0,
    lastLine,
    at: Date.now(),
  });
}
