import { useEffect, useRef, useState } from "react";

import { claudeInstallApi } from "@/api/claudeSurface";
import type { CliCheckResult } from "@/lib/bindings";

/**
 * 스택 프리셋이 요구하는 CLI 가 설치돼 있는지 한 번만 확인한다
 * (`GreenfieldWizard` 에서 갈라 나온 조각).
 *
 * `enabled` 가 처음 참이 될 때 아직 안 본 이름만 **병렬로** 묻는다. 예전에는
 * `cliNames.forEach(async …)` 였고, 그 모양이 셋을 동시에 잃고 있었다
 * (2026-09-07 감사):
 *
 * 1. `forEach` 는 async 콜백의 프로미스를 **버린다** — 거부를 아무도 안 받는다.
 * 2. 언마운트 뒤 `setState` 를 막을 길이 없다.
 * 3. "이미 본 CLI" 를 렌더 상태(`cliChecks`)에서 읽으면서 그 값을 effect 의
 *    deps 에 넣지 않아 **스테일 클로저**로 읽고 있었다.
 *
 * 그래서 "이미 봤다" 는 기억을 ref 로 옮겼다. 상태로 두면 결과가 들어올 때마다
 * effect 가 다시 도는 고리가 생긴다.
 *
 * `names` 는 **안정된 배열**이어야 한다 (모듈 상수 등) — 렌더마다 새 배열이면
 * effect 가 매번 돈다.
 */
export function useCliChecks(
  names: readonly string[],
  enabled: boolean,
): Record<string, CliCheckResult> {
  const [checks, setChecks] = useState<Record<string, CliCheckResult>>({});
  const probed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const todo = names.filter((n) => !probed.current.has(n));
    if (todo.length === 0) return;
    todo.forEach((n) => probed.current.add(n));

    let cancelled = false;
    void Promise.all(todo.map((n) => claudeInstallApi.cli(n))).then((results) => {
      if (cancelled) return;
      setChecks((prev) => {
        const next = { ...prev };
        results.forEach((res, i) => {
          // `null` = 탐지 실패. 화면은 "모름" 으로 남기고, 다음 진입에서 다시
          // 보도록 기억을 되돌린다 — 한 번 실패했다고 영원히 모르면 안 된다.
          if (res) next[todo[i]] = res;
          else probed.current.delete(todo[i]);
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [names, enabled]);

  return checks;
}
