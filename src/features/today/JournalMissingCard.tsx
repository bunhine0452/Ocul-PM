import { openSettings } from "@/lib/settingsNav";
import { requestManualEntry } from "@/lib/journalCompose";
import { useCallback, useEffect, useState } from "react";
import { safeUnlisten } from "@/lib/unlisten";

import { commands, events, type JournalMissingSignal } from "@/lib/bindings";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { ErrorCard } from "@/components/ErrorCard";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";

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
 * 세션의 기록 준수 0/12). 세션 종료 이벤트(oculpmSessionEnded — SessionEnd 훅
 * 인박스 소비의 산물)에 재조회를 걸어 앱을 켜둔 채 끝난 세션도 바로 반영한다.
 *
 * {#card-unhide} (2026-09-05) — **0건이어도 숨지 않는다.** 예전에는 신호가
 * 0건이면 카드를 통째로 그리지 않았다. 그런데 이 카드의 판정은 근사다:
 * 백엔드가 "프로젝트 전역 최신 일지보다 오래된 신호"를 해소로 보고 걷어내고,
 * 훅이 없는 에이전트의 세션은 애초에 신호를 남기지 않는다. 그래서 자기은닉은
 * 화면에서 **"정말 깨끗함"과 "가려짐"을 똑같이 보이게** 만들었다 —
 * 기록 누락을 말해 주는 것이 존재 이유인 카드에서 가장 나쁜 실패다.
 * 그렇다고 0건에 초록 체크를 그리면 그건 거짓말이라, 0건 상태는
 * **숫자 + 판정의 한계**만 조용히(경고색 없이) 적는다.
 */
export function JournalMissingCard({
  projectId,
  enabled,
  onNavigate,
}: JournalMissingCardProps) {
  const { t } = useT();
  const [signals, setSignals] = useState<JournalMissingSignal[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * 조회가 **실패**했다 — 신호 0건과 다르다 (2026-09-04). 예전에는 봉투의 오류도
   * throw 도 `setSignals([])` 로 접어, 훅 원장을 못 읽었는데도 화면은 "일지 없이
   * 끝난 세션 없음"과 똑같이 아무것도 그리지 않았다. 이 카드의 존재 이유가
   * "기록되지 않은 것을 말해 주는 것"이라 그 침묵은 특히 나쁘다.
   */
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await commands.journalMissingSignals(projectId, SIGNAL_DAYS);
      if (res.status === "ok") setSignals(res.data);
      else {
        setSignals([]);
        setError(tError(res.error));
      }
    } catch (e) {
      setSignals([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!enabled) {
      setSignals([]);
      setError(null);
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

  if (!enabled) return null;
  if (error && !loading) {
    return (
      <ErrorCard
        title={t("today.missing.failed")}
        error={error}
        onRetry={() => void refresh()}
        style={{ marginTop: 16 }}
      />
    );
  }
  if (loading) return null;

  // 0건 = "확인된 누락 없음"이지 "기록이 완전함"이 아니다. 테두리·숫자에서
  // 경고색을 빼 조용하게 두되, 카드 자체는 남긴다 (위 {#card-unhide}).
  const clean = signals.length === 0;

  return (
    <section
      style={{
        marginTop: 16,
        padding: "14px 16px",
        borderRadius: 12,
        background: "var(--surface-2, rgba(0,0,0,0.02))",
        border: clean
          ? "1px solid var(--border-card)"
          : "1px solid color-mix(in srgb, var(--warn) 25%, transparent)",
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
            color: clean ? "var(--text-3)" : "var(--warn)",
          }}
        >
          {t("today.missing.recent", { days: SIGNAL_DAYS, n: signals.length })}
        </span>
      </div>
      {clean ? (
        <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
          {t("today.missing.zeroNote")}
        </div>
      ) : (
        <MissingRows signals={signals} onNavigate={onNavigate} />
      )}
    </section>
  );
}

/** 신호가 1건 이상일 때의 본문 — 안내 + 행 목록 + 초안 토글로 가는 버튼. */
function MissingRows({
  signals,
  onNavigate,
}: {
  signals: JournalMissingSignal[];
  onNavigate: (view: UiV2View) => void;
}) {
  const { t } = useT();
  return (
    <>
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
      {/* 무료 경로가 먼저다 (v3-surface {#honesty-actions}). 예전엔 이 카드의
          유일한 행동이 **과금 LLM 을 켜라**는 제안뿐이었다 — 자동 초안은
          세션마다 모델을 부른다. 지금 당장, 돈 없이 누락을 메우는 길은
          작성기를 신호로 채워 여는 것이다. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            requestManualEntry({
              title: t("today.missing.seedTitle", { session: shortSid(signals[0].session_id) }),
              body: signals
                .slice(0, MAX_ROWS)
                .map((s) => `- ${formatLocalTs(s.ts)} · ${s.session_id}`)
                .join("\n"),
            })
          }
        >
          {t("today.missing.write")}
        </button>
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
      </div>
    </>
  );
}
