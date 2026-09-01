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
  /**
   * 마지막 스캔이 예산으로 끊겨 남은 transcript 가 있다 — 배지가 아직
   * 최종이 아니라는 뜻. 숨기면 "안 걸림" 이 확정처럼 읽힌다.
   */
  partial: boolean;
  days: number;
  refresh: () => void;
  /** 원장을 비우고 처음부터 다시 센다 — 이중 집계·낡은 재개점의 유일한 복구. */
  rebuild: () => Promise<void>;
}

/**
 * @param days 조회 창. 기본 30일(배지). 진단의 「발동」 섹션은 7일을 본다 —
 *   "요즘 안 걸린다" 를 묻는 자리라 창이 짧아야 답이 최신이다.
 */
export function useFiringLedger(projectId: number, days = FIRING_WINDOW_DAYS): FiringLedger {
  const [overview, setOverview] = useState<FiringOverview | null>(null);
  const [scanning, setScanning] = useState(false);
  const [partial, setPartial] = useState(false);
  const [nonce, setNonce] = useState(0);

  // 원장은 **보조 신호**다 — 조회·스캔이 어떤 이유로 실패하든(커맨드 부재,
  // transcript 없음, 권한) 화면은 그대로 동작해야 한다. 그래서 모든 호출을
  // 삼키고 null 로 떨어뜨린다: 배지가 안 뜰 뿐 목록·편집은 멀쩡하다.
  const load = useCallback(async () => {
    try {
      const res = await commands.firingStats(projectId, days);
      return res?.status === "ok" ? res.data : null;
    } catch {
      return null;
    }
  }, [projectId, days]);

  useEffect(() => {
    let alive = true;
    setOverview(null);
    void (async () => {
      const first = await load();
      if (!alive) return;
      setOverview(first);

      setScanning(true);
      let leftover = false;
      for (let round = 0; round < MAX_SCAN_ROUNDS; round++) {
        // 스캔 실패·transcript 부재는 조용히 끝낸다 — 여기서 토스트를 띄우면
        // Claude Code 를 안 쓰는 사용자에게는 소음일 뿐이다.
        let done = true;
        leftover = false;
        try {
          const scan = await commands.firingRescan(projectId);
          done = scan?.status !== "ok" || scan.data.no_transcripts || scan.data.complete;
          leftover = scan?.status === "ok" && !scan.data.no_transcripts && !scan.data.complete;
        } catch {
          done = true;
        }
        if (!alive) return;
        if (done) break;
      }
      if (!alive) return;
      setScanning(false);
      setPartial(leftover);

      const after = await load();
      if (!alive) return;
      setOverview(after);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, load, nonce]);

  const index = useMemo(() => buildFiringIndex(overview?.stats ?? []), [overview]);

  const rebuild = useCallback(async () => {
    setScanning(true);
    try {
      const res = await commands.firingRebuild(projectId);
      setPartial(res?.status === "ok" && !res.data.no_transcripts && !res.data.complete);
    } catch {
      // 조회 실패와 같은 규율 — 원장은 보조 신호라 조용히 넘어간다.
    }
    setScanning(false);
    setOverview(await load());
  }, [projectId, load]);

  return {
    index,
    overview,
    measured: overview != null && overview.last_scan_at != null,
    scanning,
    partial,
    days,
    refresh: useCallback(() => setNonce((n) => n + 1), []),
    rebuild,
  };
}
