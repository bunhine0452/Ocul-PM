import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import type { LayerComparison } from "@/lib/bindings";
import { useT, type I18nKey } from "@/i18n";

interface HonestyAuditProps {
  projectId: number;
  /** YYYYMMDD current workday. */
  workday: string | null;
  enabled: boolean;
}

const SEV_COLOR: Record<string, string> = {
  ok: "var(--text-3)",
  warning: "var(--warn, #c2810a)",
  critical: "var(--danger, #c0392b)",
};
const SEV_LABEL: Record<string, I18nKey> = {
  ok: "today.honesty.ok",
  warning: "today.honesty.warning",
  critical: "today.honesty.critical",
};

/**
 * F2 — 정직성 감사. For each of the day's sessions, compares the watcher's
 * ground-truth file changes (`file_changes.ndjson`) against the union of the
 * journal's `files_touched`, and surfaces `only_in_index`: files an agent
 * actually changed but never recorded in a journal entry. Read-only; the card
 * only renders when there is at least one unrecorded change (no noise on clean
 * days). Reuses the already-complete `oculpm_compare_layers` backend (F2).
 */
export function HonestyAudit({ projectId, workday, enabled }: HonestyAuditProps) {
  const { t } = useT();
  const [rows, setRows] = useState<LayerComparison[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !workday) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const sessions = await oculpmApi.listSessions(projectId, workday);
        const cmps = await Promise.all(
          sessions.map((s) =>
            oculpmApi.compareLayers(projectId, s.id).catch(() => null),
          ),
        );
        if (!cancelled) {
          setRows(
            cmps.filter(
              (c): c is LayerComparison => !!c && c.only_in_index.length > 0,
            ),
          );
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workday, enabled]);

  if (!enabled || loading || rows.length === 0) return null;

  const totalMissed = rows.reduce((n, r) => n + r.only_in_index.length, 0);

  return (
    <section
      style={{
        marginTop: 16,
        padding: "14px 16px",
        borderRadius: 12,
        background: "var(--surface-2, rgba(0,0,0,0.02))",
        border: "1px solid var(--warn-border, rgba(194,129,10,0.25))",
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
            color: "var(--warn, #c2810a)",
          }}
        >
          {t("today.honesty.unlogged", { n: totalMissed })}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10 }}>
          {t("today.honesty.desc")}
      </div>
      {rows.map((r) => (
        <div key={r.session_id} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: SEV_COLOR[r.mismatch_severity] ?? "var(--text-2)",
              marginBottom: 2,
            }}
          >
            {t("today.honesty.session")} {r.session_id} · {SEV_LABEL[r.mismatch_severity] ? t(SEV_LABEL[r.mismatch_severity]) : r.mismatch_severity} ·{" "}
            {t("today.honesty.count", { n: r.only_in_index.length })}
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 16,
              fontSize: 12,
              color: "var(--text-2)",
            }}
          >
            {r.only_in_index.slice(0, 12).map((p) => (
              <li key={p}>{p}</li>
            ))}
            {r.only_in_index.length > 12 ? (
              <li style={{ color: "var(--text-3)" }}>
                {t("today.honesty.more", { n: r.only_in_index.length - 12 })}
              </li>
            ) : null}
          </ul>
        </div>
      ))}
    </section>
  );
}
