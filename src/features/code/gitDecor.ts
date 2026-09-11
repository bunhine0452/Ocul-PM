// git 상태 장식 — 트리·탭의 파일 이름 색과 글자 배지 (2026-09-11 IDE 라운드).
//
// 출처는 변경 화면이 쓰는 것과 **같은 커맨드** `git_uncommitted_changes` 다
// (`status --porcelain` 을 프로젝트 기준 경로로 되돌린 것). 백엔드는 이미
// `A`(추가·미추적·이름바꿈 대상) · `M` · `D` 셋으로 접어 준다 — 여기서는 그
// 셋을 그대로 쓰고, **폴더로 말아 올리는 것**만 더한다: VS Code 처럼 안에
// 바뀐 것이 있는 폴더도 색을 가져야 접힌 트리에서 "어디가 움직였나" 가 보인다.

import { useCallback, useEffect, useRef, useState } from "react";

import type { GitChange } from "@/lib/bindings";
import { gitApi } from "@/api/git";

/** 파일 자신의 상태. 폴더는 항상 `"M"`(안에 무언가 바뀜) 으로 말린다. */
export type GitMark = "A" | "M" | "D";

export type GitMarks = ReadonlyMap<string, GitMark>;

const EMPTY: GitMarks = new Map();

/**
 * 변경 목록 → 경로별 표식. 폴더는 자손 중 하나라도 있으면 `M`.
 *
 * 파일이 여러 저장소에 걸쳐 같은 경로로 두 번 오는 일은 없지만(중첩 저장소는
 * 경로가 다르다), 온다면 뒤엣것이 이긴다 — 순서를 정할 근거가 없어 굳이 안 정한다.
 */
export function buildGitMarks(changes: readonly GitChange[]): GitMarks {
  const out = new Map<string, GitMark>();
  for (const c of changes) {
    const op: GitMark = c.op === "A" || c.op === "D" ? c.op : "M";
    out.set(c.path, op);
    let slash = c.path.lastIndexOf("/");
    while (slash > 0) {
      const dir = c.path.slice(0, slash);
      if (!out.has(dir)) out.set(dir, "M");
      slash = c.path.lastIndexOf("/", slash - 1);
    }
  }
  return out;
}

/** 재조회 사이의 최소 간격 — 저장 연타·워처 폭주가 `git status` 를 그만큼 부르지 않게. */
const REFRESH_DEBOUNCE_MS = 250;

/**
 * 프로젝트의 git 표식. `refresh()` 는 디바운스된다 — 저장·워처·파일 조작이
 * 저마다 부르므로 호출부가 조율하지 않아도 된다.
 *
 * 실패(비-git 프로젝트 · git 없음)는 빈 표식이다. 장식은 없어도 편집기는 돈다.
 */
export function useGitMarks(projectId: number): { marks: GitMarks; refresh: () => void } {
  const [marks, setMarks] = useState<GitMarks>(EMPTY);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    gitApi
      .uncommittedChanges(projectId)
      // 답이 배열이 아니면(테스트 하네스의 빈 목 · 이상한 응답) 장식 없음.
      .then((changes) => (Array.isArray(changes) ? buildGitMarks(changes) : EMPTY))
      // 비-git 프로젝트·git 없음 — 장식은 없어도 편집기는 돈다.
      .catch(() => EMPTY)
      .then((next) => {
        // 늦게 도착한 옛 답이 새 답을 덮지 않게.
        if (seq === seqRef.current) setMarks(next);
      });
  }, [projectId]);

  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      load();
    }, REFRESH_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    load();
    // 카운터 ref 라 DOM 노드가 아니다 — 정리 시점에 같은 객체를 올리면 된다.
    const seq = seqRef;
    const timer = timerRef;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // 언마운트 뒤 도착하는 답을 버린다.
      seq.current++;
    };
  }, [load]);

  return { marks, refresh };
}
