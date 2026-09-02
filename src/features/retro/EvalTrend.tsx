// PR-CI6 (EDD-lite) — 회고 화면의 "Eval 추이" 카드.
//
// EVALS.md 가 있는 프로젝트에서만 그려진다 (없으면 null — 커맨드가 None).
// 데이터는 CI5 run-evals 스킬이 append 하는 `## 기록` 표가 SSOT 이고, 여기는
// 읽기 전용 신호다. 스위트별로 최근 실행 8회를 작은 사각형(통과율 색)으로,
// 최신 점수를 분수·퍼센트로 보여준다 — 차트 라이브러리 없이 에이전트 기여
// 막대와 같은 손그림 방식.
import { useEffect, useMemo, useState } from "react";

import { ClipboardCheck } from "@/components/Icons";
import { commands, type EvalRecord, type EvalSignals } from "@/lib/bindings";
import { useT } from "@/i18n";

/** 통과율 → 시맨틱 색 (기존 emerald/amber 팔레트와 일치). */
function rateClass(rate: number): string {
  if (rate >= 1) return "bg-(--ok)";
  if (rate >= 0.7) return "bg-(--ok)/50";
  if (rate >= 0.4) return "bg-(--warn)/70";
  return "bg-(--danger)/70";
}

export function EvalTrendPanel({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [signals, setSignals] = useState<EvalSignals | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setSignals(null);
    void commands.evalSignals(projectId).then((res) => {
      if (!alive) return;
      if (res.status === "ok") setSignals(res.data);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const bySuite = useMemo(() => {
    const map = new Map<string, EvalRecord[]>();
    for (const suite of signals?.suites ?? []) map.set(suite, []);
    for (const r of signals?.records ?? []) map.get(r.suite)?.push(r);
    return map;
  }, [signals]);

  // EVALS.md 자체가 없으면 아무것도 그리지 않는다.
  if (!loaded || !signals) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">
          <ClipboardCheck size={15} />
        </span>
        {t("retro.eval.title")}
        <span className="text-xs font-normal text-muted-foreground">EVALS.md</span>
      </div>
      {signals.records.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <code className="font-mono text-[11px]">EVALS.md</code> {t("retro.eval.empty1")}{" "}
          {/* i18n-ignore-next-line -- EVALS.md 안의 실제 섹션 제목 (디스크 산출물, 번역 범위 밖) */}
          <code className="font-mono text-[11px]">## 기록</code> {t("retro.eval.empty2")}{" "}
          {t("retro.eval.empty3")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...bySuite.entries()]
            .filter(([, recs]) => recs.length > 0)
            .map(([suite, recs]) => {
              const recent = recs.slice(-8);
              const latest = recs[recs.length - 1];
              const rate = latest.passed / latest.total;
              return (
                <div key={suite} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate font-mono text-xs text-foreground">
                    {suite}
                  </span>
                  <div
                    className="flex flex-1 items-center gap-1"
                    role="img"
                    aria-label={t("retro.eval.aria", { suite, n: recent.length })}
                  >
                    {recent.map((r, i) => (
                      <span
                        key={`${r.date}:${i}`}
                        className={`h-2.5 w-2.5 rounded-[3px] ${rateClass(r.passed / r.total)}`}
                        title={`${r.date} · ${r.passed}/${r.total}${r.memo ? ` — ${r.memo}` : ""}`}
                      />
                    ))}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {latest.passed}/{latest.total} ({Math.round(rate * 100)}%) · {latest.date}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
