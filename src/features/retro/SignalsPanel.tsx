// 회고의 **결정적 신호** 패널 — 통계 4칸 · 출시 · 저항 · 노력 핫스팟 ·
// 에이전트 기여(난이도 분포 포함). LLM 이 닿기 전의 사실만 그린다.
//
// RetroScreenV2 안에 인라인으로 있다가 떼어냈다 (2026-09-05). 이 폴더의 다른
// 패널 넷(DeferLedger·EvalTrend·RuleCandidates·SkillCandidates)은 처음부터
// 파일이었고, 이것만 남아 화면 파일을 800줄 너머로 끌고 있었다 — 래칫이 가리킨
// 자리가 곧 원래 쪼개졌어야 할 자리였다.
//
// `wd`(YYYYMMDD → M/D)와 `KIND_LABEL` 도 함께 왔다. 가장 무겁게 쓰는 곳이
// 여기고, 화면 쪽 세 자리(툴바 부제·Notion 제목·산출물 제목)는 여기서 가져다
// 쓴다 — 두 벌을 만들지 않기 위해서다.
import { TrendingUp, Bug, Wrench, PieChart } from "@/components/Icons";
import type { RetroSignals } from "@/lib/bindings";
import { useT, type I18nKey } from "@/i18n";
import { SourceBadge } from "@/features/oculpm/SourceBadge";
import { sourceOfAgent } from "@/features/oculpm/entrySource";

/** "YYYYMMDD" → "M/D" for compact display. */
export function wd(s: string): string {
  if (s.length !== 8) return s;
  return `${Number(s.slice(4, 6))}/${Number(s.slice(6, 8))}`;
}

const KIND_LABEL: Record<string, string> = {
  feature: "retro.type.feature",
  refactor: "retro.type.refactor",
  error: "retro.type.error",
  bug: "retro.type.bug",
};

export function SignalsPanel({ signals }: { signals: RetroSignals }) {
  const { t } = useT();
  const s = signals;
  return (
    <section className="flex flex-col gap-4">
      {/* stat row */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label={t("retro.stat.total")} value={s.total_entries} />
        <Stat label={t("retro.stat.shipped")} value={s.shipped.length} />
        <Stat label={t("retro.stat.resistance")} value={s.resistance.length} />
        <Stat label={t("retro.stat.agents")} value={s.agent_breakdown.length} />
      </div>

      {s.shipped.length > 0 && (
        <Card icon={<TrendingUp size={15} />} title={t("retro.card.shipped")}>
          <ul className="flex flex-col gap-1.5">
            {s.shipped.map((it, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium bg-(--ok-soft) text-(--ok-text)">
                  {KIND_LABEL[it.kind] ?? it.kind}
                </span>
                <span className="flex-1 text-foreground">{it.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {it.agent_id} · {wd(it.workday)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(s.resistance.length > 0 || s.repeated_files.length > 0) && (
        <Card icon={<Bug size={15} />} title={t("retro.card.resistance")}>
          {s.resistance.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {s.resistance.map((it, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium bg-(--warn-soft) text-(--warn-text)">
                    {KIND_LABEL[it.kind] ?? it.kind}
                  </span>
                  <span className="flex-1 text-foreground">{it.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {it.status} · {wd(it.workday)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.repeated_files.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-2.5">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t("retro.repeatFiles")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.repeated_files.map((rf) => (
                  <span
                    key={rf.path}
                    className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-mono"
                  >
                    {rf.path}
                    <span className="text-(--warn-text)">×{rf.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {s.effort_hotspots.length > 0 && (
        <Card icon={<Wrench size={15} />} title={t("retro.card.effort")}>
          <ul className="flex flex-col gap-1.5">
            {s.effort_hotspots.map((h) => (
              <li key={h.path} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate font-mono text-xs text-foreground">
                  {h.path}
                </span>
                {h.is_hub && (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {t("retro.coreHub")}
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("retro.hubMeta", { n: h.touch_count, fan: h.impact_fan_out })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card icon={<PieChart size={15} />} title={t("retro.card.agents")}>
        <div className="flex flex-col gap-2">
          {s.agent_breakdown.map((a) => (
            <div key={a.agent_id} className="flex items-center gap-2">
              {/* 이 신호가 기계가 쓴 일지에서 왔는지 — 회고의 숫자를 읽는 잣대가 된다. */}
              <SourceBadge source={sourceOfAgent(a.agent_id)} withLabel={false} />
              <span className="w-24 shrink-0 truncate text-sm">{a.agent_id}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${Math.round((a.share ?? 0) * 100)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                {t("retro.agentMeta", { n: a.entry_count, pct: Math.round((a.share ?? 0) * 100) })}
              </span>
            </div>
          ))}
          <DifficultyRow mix={s.difficulty_mix} total={s.total_entries} />
        </div>
      </Card>
    </section>
  );
}

function DifficultyRow({
  mix,
  total,
}: {
  mix: RetroSignals["difficulty_mix"];
  total: number;
}) {
  const { t } = useT();
  const buckets: { labelKey: I18nKey; n: number }[] = [
    { labelKey: "retro.diff.verylow" as I18nKey, n: mix.verylow },
    { labelKey: "retro.diff.low" as I18nKey, n: mix.low },
    { labelKey: "retro.diff.medium" as I18nKey, n: mix.medium },
    { labelKey: "retro.diff.high" as I18nKey, n: mix.high },
    { labelKey: "retro.diff.superhigh" as I18nKey, n: mix.superhigh },
    { labelKey: "retro.diff.null" as I18nKey, n: mix.null_count },
  ].filter((b) => b.n > 0);
  if (buckets.length === 0 || total === 0) return null;
  return (
    <div className="mt-2 border-t border-border/60 pt-2.5">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("retro.diffTitle")}</div>
      <div className="flex flex-wrap gap-1.5">
        {buckets.map((b) => (
          <span key={b.labelKey} className="rounded bg-muted px-2 py-0.5 text-xs">
            {t(b.labelKey)} {b.n}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  // 오늘 화면의 `.stat` 과 같은 물체다. 숫자에 색을 칠하지 않는다 — 출시=초록·
  // 저항=호박은 라벨이 이미 말하는 것을 색으로 한 번 더 말하는 장식이었다.
  return (
    <div className="stat">
      <div className="stat-top">{label}</div>
      <div className="stat-val">{value}</div>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card card-pad">
      <div className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}
