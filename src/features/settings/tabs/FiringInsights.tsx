// 진단 「발동」 — 규칙·스킬이 실제로 걸렸는가 (Osaurus 라운드 Phase 3).
//
// `firing_ledger.rs` 는 Claude Code transcript 에서 규칙 주입과 스킬 발동을
// 결정론적으로 관측한다 (LLM 0 · 네트워크 0 · 증분 스캔). 지금까지 그 값은
// 스킬 화면의 배지로만 쓰였는데, Osaurus 는 같은 데이터를 **자동화 디버깅의
// 정식 절차**로 지정한다 — "결과가 이상하면 무엇이 실제로 로드됐는지 보라".
// 여기가 그 자리다.
//
// 두 목록 중 **아래쪽이 진짜 값**이다: 써 놓고 한 번도 안 걸리는 규칙.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Activity } from "@/components/Icons";
import { rulesApi } from "@/api/claudeSurface";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useFiringLedger } from "@/features/skills/useFiringLedger";
import { neverFiredRules, topFirings } from "@/features/skills/firingModel";
import { formatBytes } from "@/lib/format";
import { useT } from "@/i18n";
import type { RuleEntry, RulesOverview } from "@/lib/bindings";
import { Section } from "./ui";

/** 진단이 보는 창 — 배지의 30일보다 짧다. "요즘 안 걸린다" 를 묻는 자리다. */
const WINDOW_DAYS = 7;
/** 상위 목록의 길이. 더 길면 표가 아니라 로그가 된다. */
const TOP_N = 8;

export function FiringInsights() {
  const ws = useOptionalWorkspace();
  const projectId = ws?.state.currentProjectId ?? null;

  return projectId == null ? null : <Insights projectId={projectId} />;
}

function Insights({ projectId }: { projectId: number }) {
  const { t } = useT();
  const ledger = useFiringLedger(projectId, WINDOW_DAYS);
  const [rules, setRules] = useState<RulesOverview | null>(null);

  useEffect(() => {
    let alive = true;
    // 규칙 목록이 없으면 "안 걸린 규칙" 만 못 그린다 — 상위 목록은 그대로 산다.
    void rulesApi
      .list(projectId)
      .then((r) => alive && setRules(r))
      .catch(() => alive && setRules(null));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const top = topFirings(ledger.overview?.stats ?? [], TOP_N);
  const never: RuleEntry[] = rules ? neverFiredRules(rules, ledger.index) : [];

  return (
    <Section
      title={t("settings.firing.title")}
      description={t("settings.firing.desc", { days: WINDOW_DAYS })}
    >
      {!ledger.measured ? (
        // 한 번도 안 재 본 원장으로 "안 걸렸다" 를 말하면 그건 관측이 아니라
        // 추측이다. 스캔 전에는 두 목록 다 그리지 않는다.
        <div className="text-[11px] text-muted-foreground">
          {ledger.scanning ? t("settings.firing.scanning") : t("settings.firing.notMeasured")}
        </div>
      ) : (
        <>
          {ledger.partial ? (
            <div className="text-[11px] text-amber-600">{t("settings.firing.partial")}</div>
          ) : null}

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("settings.firing.top")}
            </div>
            {top.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">{t("settings.firing.topEmpty")}</div>
            ) : (
              <ul className="text-[11px] space-y-0.5">
                {top.map((stat) => (
                  <li key={`${stat.kind}:${stat.key}`} className="flex items-center gap-3">
                    <span className="w-12 flex-none text-muted-foreground">
                      {t(stat.kind === "rule" ? "settings.firing.kindRule" : "settings.firing.kindSkill")}
                    </span>
                    <span className="flex-1 min-w-0 truncate font-mono" title={stat.key}>
                      {stat.label}
                    </span>
                    <span className="flex-none tabular-nums text-muted-foreground">
                      {t("settings.firing.count", { n: stat.count, sessions: stat.sessions })}
                    </span>
                    {stat.bytes > 0 ? (
                      <span className="flex-none w-16 text-right tabular-nums text-muted-foreground">
                        {formatBytes(stat.bytes)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("settings.firing.never")}
            </div>
            {!rules ? (
              <div className="text-[11px] text-muted-foreground">{t("settings.firing.rulesUnavailable")}</div>
            ) : never.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">{t("settings.firing.neverEmpty")}</div>
            ) : (
              <ul className="text-[11px] space-y-0.5">
                {never.map((entry) => (
                  <li key={`${entry.scope}:${entry.rel_path}`} className="flex items-center gap-3">
                    <span className="w-12 flex-none text-muted-foreground">
                      {t(entry.scope === "project" ? "settings.firing.scopeProject" : "settings.firing.scopeGlobal")}
                    </span>
                    <span className="flex-1 min-w-0 truncate font-mono" title={entry.rel_path}>
                      {entry.name || entry.rel_path}
                    </span>
                    {/* 경로 조건이 붙은 규칙은 **안 걸리는 게 정상일 수 있다** —
                        그 사실을 같이 보여 주지 않으면 멀쩡한 규칙을 지우게 된다. */}
                    {entry.paths.length > 0 ? (
                      <span className="flex-none text-muted-foreground" title={entry.paths.join(" · ")}>
                        {t("settings.firing.scoped")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="flex gap-2 flex-wrap pt-1">
        <Button onClick={() => ledger.refresh()} disabled={ledger.scanning} variant="outline" size="sm">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${ledger.scanning ? "animate-spin" : ""}`} />
          {t("settings.firing.rescan")}
        </Button>
        <Button onClick={() => void ledger.rebuild()} disabled={ledger.scanning} variant="outline" size="sm">
          <Activity className="w-3.5 h-3.5 mr-1.5" />
          {t("settings.firing.rebuild")}
        </Button>
      </div>
    </Section>
  );
}
