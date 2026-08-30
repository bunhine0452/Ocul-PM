// AD-2 — 발동 원장 훅. 화면이 열릴 때 창(기본 30일) 통계를 읽고, 뒤에서
// 증분 스캔을 돌린 다음 한 번 더 읽는다.
//
// 첫 스캔은 누적 transcript 전체를 읽으므로 예산으로 끊긴다 (`complete=false`).
// 그때는 이어서 부르되 **횟수를 제한한다** — 화면이 열려 있는 동안 무한히
// 파일을 읽는 것보다, 남은 분량을 다음 방문으로 미루는 편이 정직하다.
import { useCallback, useEffect, useMemo, useState } from "react";

import { commands, type FiringOverview } from "@/lib/bindings";
import { buildFiringIndex, type FiringIndex } from "./firingModel";

/** 배지가 보는 창 — 30일. */
export const FIRING_WINDOW_DAYS = 30;
/** 한 번 화면을 열었을 때 이어 붙일 수 있는 스캔 횟수 상한. */
const MAX_SCAN_ROUNDS = 6;

export interface FiringLedger {
  index: FiringIndex;
  overview: FiringOverview | null;
  /** 원장이 한 번이라도 스캔됐는가 — 배지가 "0회" 를 주장해도 되는 조건. */
  measured: boolean;
  /** 백그라운드 스캔 진행 중. */
  scanning: boolean;
  days: number;
  refresh: () => void;
}

export function useFiringLedger(projectId: number): FiringLedger {
  const [overview, setOverview] = useState<FiringOverview | null>(null);
  const [scanning, setScanning] = useState(false);
  const [nonce, setNonce] = useState(0);

  // 원장은 **보조 신호**다 — 조회·스캔이 어떤 이유로 실패하든(커맨드 부재,
  // transcript 없음, 권한) 화면은 그대로 동작해야 한다. 그래서 모든 호출을
  // 삼키고 null 로 떨어뜨린다: 배지가 안 뜰 뿐 목록·편집은 멀쩡하다.
  const load = useCallback(async () => {
    try {
      const res = await commands.firingStats(projectId, FIRING_WINDOW_DAYS);
      return res?.status === "ok" ? res.data : null;
    } catch {
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setOverview(null);
    void (async () => {
      const first = await load();
      if (!alive) return;
      setOverview(first);

      setScanning(true);
      for (let round = 0; round < MAX_SCAN_ROUNDS; round++) {
        // 스캔 실패·transcript 부재는 조용히 끝낸다 — 여기서 토스트를 띄우면
        // Claude Code 를 안 쓰는 사용자에게는 소음일 뿐이다.
        let done = true;
        try {
          const scan = await commands.firingRescan(projectId);
          done = scan?.status !== "ok" || scan.data.no_transcripts || scan.data.complete;
        } catch {
          done = true;
        }
        if (!alive) return;
        if (done) break;
      }
      if (!alive) return;
      setScanning(false);

      const after = await load();
      if (!alive) return;
      setOverview(after);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, load, nonce]);

  const index = useMemo(() => buildFiringIndex(overview?.stats ?? []), [overview]);

  return {
    index,
    overview,
    measured: overview != null && overview.last_scan_at != null,
    scanning,
    days: FIRING_WINDOW_DAYS,
    refresh: useCallback(() => setNonce((n) => n + 1), []),
  };
}
