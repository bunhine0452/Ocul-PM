import { openSettings } from "@/lib/settingsNav";
import { useCallback, useEffect, useState } from "react";
import { safeUnlisten } from "@/lib/unlisten";

import { commands, events, type JournalMissingSignal } from "@/lib/bindings";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";

interface JournalMissingCardProps {
  projectId: number;
  enabled: boolean;
  onNavigate: (view: UiV2View) => void;
}

/** 조회 범위 — 최근 7일 (신호는 최근성이 전부다). */
const SIGNAL_DAYS = 7;
/** 카드에 펼쳐 보여줄 최대 행 수 — 나머지는 "외 N개"로 접는다. */
const MAX_ROWS = 8;

/** UTC ISO → 로컬 "7월 30일 11:30" 표기. 파싱 불가 시 원문 그대로. */
function formatLocalTs(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 훅 session_id(UUID 등)를 앞 8자로 축약. */
function shortSid(sid: string): string {
  return sid.length > 9 ? `${sid.slice(0, 8)}…` : sid;
}

/**
 * H3b — 일지 없이 끝난 세션. 플러그인 SessionEnd 훅이
 * `.oculpm/hooks/journal-missing.jsonl` 에 남긴 신호를 최근 7일 범위로
 * 보여준다 (근거: benchmarks/agentic — 규칙·도구가 주입돼도 헤드리스 단발
 * 세션의 기록 준수 0/12). HonestyAudit 과 같은 자기은닉 카드 — 신호가
 * 0건이면 렌더하지 않아 깨끗한 날에 소음을 내지 않는다. 세션 종료 이벤트
 * (oculpmSessionEnded — SessionEnd 훅 인박스 소비의 산물)에 재조회를 걸어
 * 앱을 켜둔 채 끝난 세션도 바로 반영한다.
 */
export function JournalMissingCard({
  projectId,
  enabled,
  onNavigate,
}: JournalMissingCardProps) {
  const { t } = useT();
  const [signals, setSignals] = useState<JournalMissingSignal[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await commands.journalMissingSignals(projectId, SIGNAL_DAYS);
      setSignals(res.status === "ok" ? res.data : []);
    } catch {
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!enabled) {
      setSignals([]);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  // 세션 종료 시 재조회 — journal-missing.jsonl append 는 같은 SessionEnd
  // 훅이 claude-events.jsonl append 와 함께 일으키므로, 그 인박스 소비가
  // 내는 기존 이벤트를 그대로 재사용한다 (새 이벤트 타입 불필요).
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let off: (() => void) | null = null;
    try {
      void events.oculpmSessionEnded
        .listen((e) => {
          if (e.payload.project_id === projectId) void refresh();
        })
        .then((unlisten) => {
          if (active) off = unlisten;
          else safeUnlisten(unlisten);
        })
        .catch(() => {});
    } catch {
      /* event channel unavailable (tests) */
    }
    return () => {
      active = false;
      safeUnlisten(off);
    };
  }, [projectId, enabled, refresh]);

  if (!enabled || loading || signals.length === 0) return null;

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
        <span style={{ fontWeight: 700 }}>{t("today.missing.title")}</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--warn, #c2810a)",
          }}
        >
          {t("today.missing.recent", { days: SIGNAL_DAYS, n: signals.length })}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10 }}>
          {t("today.missing.desc")}
      </div>
      <ul
        style={{
          margin: "0 0 10px",
          paddingLeft: 16,
          fontSize: 12,
          color: "var(--text-2)",
        }}
      >
        {signals.slice(0, MAX_ROWS).map((s, i) => (
          <li key={`${s.session_id}-${s.ts}-${i}`}>
            {formatLocalTs(s.ts)} · {t("today.missing.session")}{" "}
            <span className="mono">{shortSid(s.session_id)}</span>
          </li>
        ))}
        {signals.length > MAX_ROWS ? (
          <li style={{ color: "var(--text-3)" }}>
            {t("today.missing.more", { n: signals.length - MAX_ROWS })}
          </li>
        ) : null}
      </ul>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          // 설정 화면으로 옮기고 ocul-pm 탭(자동 초안 토글이 있는 곳)을 편다 —
          // 예전엔 화면만 옮겨 사용자가 탭을 찾아야 했다.
          onNavigate("settings");
          openSettings("oculpm");
        }}
      >
        {t("today.missing.enable")}
      </button>
    </section>
  );
}
