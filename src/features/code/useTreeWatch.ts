// 디스크가 바뀌면 파일 트리도 스스로 따라간다 — ⟳ 를 누르지 않아도.
//
// 이 앱에서 파일을 만들고 지우는 것은 대개 사용자가 아니라 **밖에 있는
// 에이전트**다. 그래서 "트리는 손으로 눌러야 최신이 된다" 는 기본값이 틀렸다 —
// 열려 있는 파일 본문은 이미 같은 워처 이벤트로 스스로 최신화되는데(CodePane),
// 정작 그 파일이 어디에 생겼는지 보여 주는 트리만 멈춰 있었다.
// `.oculpm/` 화면들이 useOculpmLive 로 하는 일을, 코드 트리에 맞게 한다.
//
// 한계는 워처의 한계 그대로다: gitignore 된 자리, 다른 통로로 빠지는 경로
// (`.claude/`·`.cursor/`), 워처가 죽어 있던 동안의 변화는 이벤트가 오지 않는다.
// 그 구멍은 창 복귀 시 한 번 다시 읽는 것(useRefetchOnWake)과 ⟳ 버튼이 메운다.
import { useCallback, useEffect, useRef } from "react";

import { oculpmApi } from "@/api/oculpm";
import type { FileOp } from "@/lib/bindings";
import { safeUnlisten } from "@/lib/unlisten";
import { useRefetchOnWake } from "@/lib/useRefetchOnWake";

import { nearestCachedDir } from "./treeUtils";

/**
 * 트리 **모양**을 바꾸는 조작만 고른다.
 *
 * `update` 는 내용만 바뀐 것이라 목록에는 아무 변화가 없다 — 에이전트가 파일
 * 하나를 연달아 고치는 동안 전량 트리를 매번 다시 걷을 이유가 없다. (워처는
 * 이름 바꾸기를 delete + create 로 쪼개 보내므로 `rename` 은 실제로 오지
 * 않지만, 계약상 모양이 바뀌는 쪽이라 함께 받는다.)
 */
export function isTreeShapingOp(op: FileOp): boolean {
  return op === "create" || op === "delete" || op === "rename";
}

/** 금지 경로는 마스킹돼서 온다 — 실제 자리를 알 수 없으니 트리도 손대지 않는다. */
const REDACTED_PREFIX = "**redacted";

/**
 * 한 동작이 여러 이벤트로 쪼개져 온다 (에디터의 임시 파일 + rename, 에이전트의
 * 연속 쓰기, `git checkout` 한 번의 수백 건). 첫 이벤트부터 이 창만큼 모아
 * 한 번에 갚는다 — useOculpmLive 와 같은 방식이다.
 */
const COALESCE_MS = 400;

/** 캐시된 폴더 집합에 물어볼 수 있는 것 — `Map` 도 `Set` 도 그대로 들어온다. */
export interface DirCacheView {
  has(dir: string): boolean;
  keys(): Iterable<string>;
}

export interface TreeWatchOptions {
  projectId: number;
  /**
   * 지금 읽어 둔 폴더들. 값이 아니라 함수로 받는다 — 이벤트가 올 때마다
   * **그 순간의** 캐시를 봐야 하고, 폴더 하나 펼칠 때마다 구독을 다시 걸 이유는
   * 없기 때문이다.
   */
  cachedDirs: () => DirCacheView;
  /**
   * 다시 읽어야 할 폴더들. 비어 있어도 부른다 — 캐시 밖(안 펼친 가지)에서
   * 벌어진 변화도 필터용 전량 트리에는 반영돼야 한다.
   */
  onStale: (dirs: string[]) => void;
}

export function useTreeWatch({ projectId, cachedDirs, onStale }: TreeWatchOptions): void {
  // 구독은 프로젝트당 한 번만 건다. 콜백은 매 렌더 새 신원이어도 되도록 ref 로 받는다.
  const cachedDirsRef = useRef(cachedDirs);
  cachedDirsRef.current = cachedDirs;
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    const pending = new Set<string>();

    const schedule = () => {
      if (timer != null) return; // 이미 열린 창 — 이 이벤트도 그 창에 얹힌다
      timer = window.setTimeout(() => {
        timer = null;
        const dirs = [...pending];
        pending.clear();
        onStaleRef.current(dirs);
      }, COALESCE_MS);
    };

    // 구독 실패는 삼킨다 (래퍼가 이미 한 번 접는다) — 라이브 갱신만 없는
    // 상태로 두고 마운트 시 조회와 ⟳ 는 그대로 동작한다.
    let off: (() => void) | null = null;
    void oculpmApi
      .onFileChanged((payload) => {
        if (payload.project_id !== projectId) return;
        const { op, path } = payload.event;
        if (!isTreeShapingOp(op) || path.startsWith(REDACTED_PREFIX)) return;
        const dir = nearestCachedDir(path, cachedDirsRef.current());
        if (dir !== null) pending.add(dir);
        schedule();
      })
      .then((un) => {
        if (active) off = un;
        else safeUnlisten(un);
      })
      .catch(() => {});

    return () => {
      active = false;
      if (timer != null) window.clearTimeout(timer);
      pending.clear();
      if (off) safeUnlisten(off);
    };
  }, [projectId]);

  // 창으로 돌아왔을 때의 그물 — 앱이 뒤에 있던 동안이나 워처가 멈춰 있던
  // 동안의 변화는 이벤트가 아예 오지 않는다. 읽어 둔 폴더를 통째로 다시 읽는다.
  const onWake = useCallback(() => {
    onStaleRef.current([...cachedDirsRef.current().keys()]);
  }, []);
  useRefetchOnWake(onWake);
}
