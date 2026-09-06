import { useEffect, useState } from "react";

import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { ErrorCard } from "@/components/ErrorCard";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { requestManualEntry } from "@/lib/journalCompose";
import { toast } from "@/lib/toast";
import type { SessionUnrecorded } from "@/lib/bindings";
import { useT, type I18nKey } from "@/i18n";

interface HonestyAuditProps {
  projectId: number;
  /** YYYYMMDD current workday. */
  workday: string | null;
  enabled: boolean;
  /** 「변경 검토」 — 문제를 보여 준 자리에서 바로 diff 로 (v3-surface). */
  onNavigate?: (view: UiV2View) => void;
}

const SEV_COLOR: Record<string, string> = {
  ok: "var(--text-3)",
  warning: "var(--warn)",
  critical: "var(--danger)",
};
const SEV_LABEL: Record<string, I18nKey> = {
  ok: "today.honesty.ok",
  warning: "today.honesty.warning",
  critical: "today.honesty.critical",
};

/**
 * F2 — 정직성 감사. Compares the watcher's ground-truth file changes
 * (`file_changes.ndjson`) against the journal's `files_touched` for every
 * session of the day, and surfaces `unrecorded`: files an agent actually
 * changed but that no journal entry anywhere in the workday records.
 * Read-only; the card only renders when there is at least one unrecorded
 * change (no noise on clean days).
 *
 * 완성도 라운드 Phase 3: one `oculpm_compare_workday` call instead of
 * `listSessions` + `compareLayers` per session (1+N IPC, and the backend
 * re-parsed the same ndjson N times).
 *
 * Reads `unrecorded`, NOT `only_in_index` (dogfooding 2026-08-20). The latter
 * joins on an exact `session_id`, and agents stamp their own dialect
 * (`manual-20260820-205400`) that never matches the watcher's
 * (`20260820-002`) — so it reported every changed file as 미기록.
 */
export function HonestyAudit({ projectId, workday, enabled, onNavigate }: HonestyAuditProps) {
  const { t } = useT();
  const [rows, setRows] = useState<SessionUnrecorded[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * 검사가 **실패**했다 — 결과가 0건인 것과 다르다 (2026-09-04).
   *
   * 예전에는 `catch { setRows([]) }` 였다. 그러면 감사가 못 돌았는데도 화면은
   * 깨끗한 날과 **글자 하나 다르지 않다**. "모르면 모른다고 말한다" 는 이
   * 제품의 반복 원칙이고, 미기록 변경을 보여주는 카드가 자기 실패를 숨기는
   * 것은 그 원칙의 정반대다. 0건일 때 숨는 것은 그대로 둔다(깨끗한 날의
   * 소음 방지) — 숨기지 않는 것은 **실패**뿐이다.
   */
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !workday) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const cmp = await oculpmApi.compareWorkday(projectId, workday);
        if (!cancelled) setRows(cmp.sessions.filter((s) => s.unrecorded.length > 0));
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof OculpmApiError ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workday, enabled, nonce]);

  if (!enabled) return null;
  if (error && !loading) {
    return (
      <ErrorCard
        title={t("today.honesty.failed")}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
        style={{ marginTop: 16 }}
      />
    );
  }
  if (loading || rows.length === 0) return null;

  const totalMissed = rows.reduce((n, r) => n + r.unrecorded.length, 0);

  return (
    <section
      style={{
        marginTop: 16,
        padding: "14px 16px",
        borderRadius: 12,
        background: "var(--surface-2, rgba(0,0,0,0.02))",
        border: "1px solid color-mix(in srgb, var(--warn) 25%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 700 }}>{t("today.honesty.title")}</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--warn)",
          }}
        >
          {t("today.honesty.unlogged", { n: totalMissed })}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10 }}>
          {t("today.honesty.desc")}
      </div>
      {rows.map((r) => (
        <div key={r.session_id} style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: SEV_COLOR[r.unrecorded_severity] ?? "var(--text-2)",
              marginBottom: 2,
            }}
          >
            {t("today.honesty.session")} {r.session_id} · {SEV_LABEL[r.unrecorded_severity] ? t(SEV_LABEL[r.unrecorded_severity]) : r.unrecorded_severity} ·{" "}
            {t("today.honesty.count", { n: r.unrecorded.length })}
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 16,
              fontSize: 12,
              color: "var(--text-2)",
            }}
          >
            {r.unrecorded.slice(0, 12).map((p) => (
              <li key={p}>{p}</li>
            ))}
            {r.unrecorded.length > 12 ? (
              <li style={{ color: "var(--text-3)" }}>
                {t("today.honesty.more", { n: r.unrecorded.length - 12 })}
              </li>
            ) : null}
          </ul>
          {/* 문제를 보여 줬으면 그 자리에서 할 수 있는 일을 놓는다
              (v3-surface {#honesty-actions}). 셋 다 **무료 경로**다 — 작성기
              씨앗·클립보드·화면 이동. LLM 을 켜라는 제안은 여기 없다. */}
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                requestManualEntry({
                  title: t("today.honesty.seedTitle", { session: r.session_id }),
                  body: seedBody(r),
                })
              }
            >
              {t("today.honesty.write")}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(r.unrecorded.join("\n"))
                  .then(() => toast.info(t("today.honesty.copied", { n: r.unrecorded.length })));
              }}
            >
              {t("today.honesty.copyPaths")}
            </button>
            {onNavigate ? (
              <button type="button" className="btn sm" onClick={() => onNavigate("diff")}>
                {t("today.honesty.review")}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * 작성기에 실어 보낼 본문 — 미기록 파일을 **전부** 적는다 (목록의 12개 상한은
 * 화면의 사정이지 기록의 사정이 아니다). 빈 작성기를 열어 주면 사용자가 방금
 * 본 목록을 손으로 옮겨 적어야 하고, 그러면 아무도 안 쓴다.
 */
function seedBody(row: SessionUnrecorded): string {
  return row.unrecorded.map((p) => `- ${p}`).join("\n");
}
