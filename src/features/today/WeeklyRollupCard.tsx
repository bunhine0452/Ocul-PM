import { useCallback, useEffect, useState } from "react";

import { AppDialog } from "@/components/ui/AppDialog";
import { ErrorCard } from "@/components/ErrorCard";
import { Markdown } from "@/components/Markdown";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { RollupDoc, RollupSummary } from "@/lib/bindings";
import { resolveLlmTarget } from "@/lib/llmTarget";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";

/**
 * journal-scale-round `{#rollup-weekly}` — Today 의 「이번 주 요약」.
 *
 * 이 카드가 있는 이유는 **요약 층이 보이지 않으면 없는 것과 같기** 때문이다.
 * 롤업은 에이전트가 `journal_search` 로 먼저 만나지만, 사람이 그 층의 존재를
 * 알게 되는 자리는 여기 하나다 — 만들기 버튼도, 「오래됨」 배지도 여기서만
 * 보인다.
 *
 * **0건이어도 숨지 않는다.** HotspotCard(`{#hotspot-card}`) / HonestyAudit 과
 * 같은 선이다: "이번 주 요약이 아직 없다"와 "카드가 안 그려졌다"는 다른
 * 사실이고, 전자는 사용자가 행동할 수 있는 상태다.
 *
 * 생성은 항상 두 갈래로 제공한다 — 결정적(키 없이 즉시)과 AI. 백엔드가 같은
 * 폴백 규약을 지므로 AI 쪽을 눌러도 모델이 없으면 결정적 본문이 나오고,
 * `used_llm` 이 거짓이면 그 사실을 토스트로 말한다.
 */
interface WeeklyRollupCardProps {
  projectId: number;
  enabled: boolean;
}

export function WeeklyRollupCard({ projectId, enabled }: WeeklyRollupCardProps) {
  const { t } = useT();
  const [current, setCurrent] = useState<RollupSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<RollupDoc | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCurrent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await oculpmApi.rollupList(projectId);
        // 목록은 최신 주 먼저 — 첫 줄이 곧 「이번 주(또는 가장 최근)」다.
        if (!cancelled) setCurrent(list[0] ?? null);
      } catch (e) {
        if (!cancelled) {
          setCurrent(null);
          setError(e instanceof OculpmApiError ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled, nonce]);

  const generate = useCallback(
    async (useLlm: boolean) => {
      if (busy) return;
      setBusy(true);
      try {
        const target = useLlm ? await resolveLlmTarget() : null;
        const res = await oculpmApi.rollupWeek(
          projectId,
          null,
          useLlm,
          target?.provider ?? null,
          target?.model ?? null,
        );
        setCurrent(res.summary);
        setDoc(res);
        if (res.note) toast.info(res.note);
        else if (useLlm && !res.used_llm) toast.info(t("today.rollup.noModel"));
        else toast.info(t("today.rollup.done", { week: res.summary.week }));
      } catch (e) {
        toast.destructive(
          t("today.rollup.generateFailed", {
            error: e instanceof OculpmApiError ? e.message : String(e),
          }),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, projectId, t],
  );

  const openDoc = useCallback(async () => {
    if (!current) return;
    setOpen(true);
    try {
      setDoc(await oculpmApi.rollupRead(projectId, current.week));
    } catch (e) {
      setOpen(false);
      toast.destructive(
        t("today.rollup.generateFailed", {
          error: e instanceof OculpmApiError ? e.message : String(e),
        }),
      );
    }
  }, [current, projectId, t]);

  if (!enabled) return null;
  if (error && !loading) {
    return (
      <ErrorCard
        title={t("today.rollup.failed")}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }
  if (loading) return null;

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: "var(--bg-inset)",
        border: "1px solid var(--border-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: "var(--fw-bold)" }}>{t("today.rollup.title")}</span>
        {current ? (
          <span style={{ fontSize: "var(--fs-3)", fontWeight: "var(--fw-bold)", color: "var(--text-3)" }}>
            {t("today.rollup.week", { week: current.week, n: current.entry_count })}
          </span>
        ) : null}
      </div>

      {current ? (
        <>
          <div
            style={{
              fontSize: "var(--fs-3)",
              color: "var(--text-2)",
              lineHeight: 1.6,
              marginBottom: 8,
            }}
          >
            {current.summary || t("today.rollup.noSummaryLine")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {current.stale ? (
              <span className="chip sm warn" title={t("today.rollup.staleHint")}>
                {t("today.rollup.stale")}
              </span>
            ) : null}
            <span style={{ fontSize: "var(--fs-2)", color: "var(--text-3)" }}>
              {current.generator.startsWith("llm:")
                ? t("today.rollup.byAi")
                : t("today.rollup.byRule")}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn sm" onClick={() => void openDoc()}>
              {t("today.rollup.open")}
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => void generate(false)}
            >
              {busy ? t("today.rollup.busy") : t("today.rollup.regenerate")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              fontSize: "var(--fs-3)",
              color: "var(--text-3)",
              lineHeight: 1.6,
              marginBottom: 8,
            }}
          >
            {t("today.rollup.empty")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => void generate(false)}
            >
              {busy ? t("today.rollup.busy") : t("today.rollup.create")}
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => void generate(true)}
            >
              {t("today.rollup.createAi")}
            </button>
          </div>
        </>
      )}

      <AppDialog
        open={open && doc != null}
        onClose={() => setOpen(false)}
        label={t("today.rollup.modalLabel", { week: doc?.summary.week ?? "" })}
        width={720}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-card)",
          }}
        >
          <span style={{ fontWeight: "var(--fw-bold)" }}>
            {t("today.rollup.modalLabel", { week: doc?.summary.week ?? "" })}
          </span>
          <span style={{ fontSize: "var(--fs-2)", color: "var(--text-3)" }}>
            {doc ? doc.summary.path : ""}
          </span>
        </div>
        <div style={{ overflow: "auto", padding: "14px 16px" }}>
          {doc ? <Markdown>{doc.body_markdown}</Markdown> : null}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "10px 16px",
            borderTop: "1px solid var(--border-card)",
          }}
        >
          <button type="button" className="btn sm" onClick={() => setOpen(false)}>
            {t("today.rollup.close")}
          </button>
        </div>
      </AppDialog>
    </section>
  );
}
