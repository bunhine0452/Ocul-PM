// 자동 저장 (B2) — 트리거와 게이트.
//
// 설계 SSOT: docs/20260902_vscode-borrows/01-save-hygiene.md §B2.
// 근거: vscode/src/vs/workbench/contrib/files/browser/files.contribution.ts
//
// 왜 이 앱에서 특히 필요한가: 사용자가 고치다 저장을 잊고 에이전트에게 "이 파일
// 봐" 라고 시키면, 에이전트는 **디스크**를 읽는다 — 화면과 다른 것을 읽고 그 위에
// 작업하고, 그 결과가 충돌로 돌아온다. 일반 편집기의 자동 저장은 편의지만
// 여기서는 정합성이다.
//
// 이 파일은 **언제** 저장할지만 정한다. 어떻게 쓰는지는 CodePane 의 몫이다
// (낙관적 잠금·충돌 배너를 그대로 지나가야 하므로 — 마스터 플랜 D7).
import { useCallback, useEffect, useRef } from "react";

import type { AutoSaveMode } from "@/lib/settings";

/**
 * 지연 하한. 저장마다 워처가 증분 색인을 예약하므로 타자 속도로 저장이 나가면
 * 색인 폭풍이 된다 (dogfooding 2026-06-15 의 권한 프롬프트와 같은 경로).
 */
export const AUTO_SAVE_MIN_DELAY_MS = 250;

/** 설정값을 실제로 쓸 지연으로 — 하한을 강제하고 쓰레기 값을 막는다. */
export function autoSaveDelayMs(raw: number, fallback = 1000): number {
  if (!Number.isFinite(raw) || raw <= 0) return Math.max(AUTO_SAVE_MIN_DELAY_MS, fallback);
  return Math.max(AUTO_SAVE_MIN_DELAY_MS, Math.round(raw));
}

export interface AutoSaveWiring {
  /** 타자마다 — `afterDelay` 타이머를 다시 건다. */
  onEdit: () => void;
  /** 에디터에서 포커스가 나갔다 — `onFocusChange` 트리거. */
  onEditorBlur: () => void;
}

export interface AutoSaveArgs {
  mode: AutoSaveMode;
  delayMs: number;
  /** 이 창이 지금 보고 있는 파일. 바뀌면 떠난 파일을 flush 한다. */
  activePath: string | null;
  /** 이 창이 포커스를 갖고 있는가 (분할 중 반대쪽으로 가면 false). */
  isFocused: boolean;
  /**
   * 지금 활성 파일을 자동으로 저장해도 되는가. 매 렌더 새 함수여도 된다 —
   * 훅이 ref 로 잡아 트리거 시점의 값을 읽는다.
   */
  canAutoSave: () => boolean;
  /** 활성 파일 저장 — 평소 저장 경로(충돌 배너 포함)를 그대로 쓴다. */
  saveActive: () => void;
  /** 화면을 떠난 경로를 조용히 저장한다 (이 창의 state 는 건드리지 않는다). */
  flushPath: (path: string) => void;
}

export function useAutoSave({
  mode,
  delayMs,
  activePath,
  isFocused,
  canAutoSave,
  saveActive,
  flushPath,
}: AutoSaveArgs): AutoSaveWiring {
  // 트리거는 타이머·cleanup 안에서 도므로 전부 ref 로 읽는다 — 의존성에 넣으면
  // 설정을 바꿀 때마다 타이머가 새로 걸린다.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const delayRef = useRef(delayMs);
  delayRef.current = delayMs;
  const canRef = useRef(canAutoSave);
  canRef.current = canAutoSave;
  const saveRef = useRef(saveActive);
  saveRef.current = saveActive;
  const flushRef = useRef(flushPath);
  flushRef.current = flushPath;

  const timerRef = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** 게이트를 통과하면 활성 파일을 저장한다. 막히면 **조용히** 지나간다. */
  const fire = useCallback(() => {
    cancel();
    if (modeRef.current === "off") return;
    if (!canRef.current()) return;
    saveRef.current();
  }, [cancel]);

  const onEdit = useCallback(() => {
    if (modeRef.current !== "afterDelay") return;
    cancel();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      fire();
    }, autoSaveDelayMs(delayRef.current));
  }, [cancel, fire]);

  const onEditorBlur = useCallback(() => {
    if (modeRef.current !== "onFocusChange") return;
    fire();
  }, [fire]);

  // 활성 경로가 바뀌면(탭 전환·닫기·창 정리) 떠난 파일을 그 자리에서 저장한다.
  //
  // **두 방식 모두**에 건다. `afterDelay` 에서도 아직 안 터진 타이머가 남아 있을
  // 수 있는데, 그때 타이머가 터지면 이미 다른 파일을 보고 있는 창이 저장한다 —
  // cleanup 시점에는 `pathRef` 가 벌써 새 경로라, 반드시 여기서 잡은 경로로
  // 넘겨야 한다.
  useEffect(() => {
    const path = activePath;
    return () => {
      cancel();
      if (!path || modeRef.current === "off") return;
      flushRef.current(path);
    };
  }, [activePath, cancel]);

  // 이 창이 포커스를 잃었다 — true → false 전이에서만 (마운트 때는 아니다).
  const wasFocusedRef = useRef(isFocused);
  useEffect(() => {
    const was = wasFocusedRef.current;
    wasFocusedRef.current = isFocused;
    if (mode !== "onFocusChange" || !was || isFocused) return;
    fire();
  }, [mode, isFocused, fire]);

  return { onEdit, onEditorBlur };
}
