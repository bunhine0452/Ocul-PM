import { useEffect, useState } from "react";

import { ChevronRight } from "@/components/Icons";
import { ErrorCard } from "@/components/ErrorCard";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { FileHotspot } from "@/lib/bindings";
import { useT, type Lang } from "@/i18n";

/** 조회 범위 — 최근 90일 (카드 헤더에 그대로 표기). */
const WINDOW_DAYS = 90;
/** 카드에 보여줄 상위 개수. */
const TOP_N = 5;

interface HotspotCardProps {
  projectId: number;
  enabled: boolean;
  /**
   * 그 파일의 마지막 일지(`last_entry_path`)를 일지 화면에서 연다 — Today 의
   * 다른 카드와 같은 핸드오프 경로(MiniEntry 의 onOpen 과 동형이나, 이 카드는
   * 파일 단위 집계라 풀 `JournalEntrySummary` 가 없어 경로 하나만 받는다).
   */
  onOpenEntry?: (relativePath: string) => void;
}

/**
 * journal-scale-round `{#hotspot-card}` — "재발·반복 수정" 신호. 같은 파일에
 * bug/error 일지가 몰려 있으면 상위 5개를 여기 보여준다. 집계·잡음 제거
 * 규칙(허브 파일 제외 등)은 백엔드가 SSOT (`db::hotspot::Db::file_hotspots`
 * 의 doc comment) — 이 카드는 그 결과를 그릴 뿐이다.
 *
 * 0건이어도 숨지 않는다 — HonestyAudit(`{#honesty-audit-unhide}`) /
 * JournalMissingCard(`{#card-unhide}`)와 같은 선: "재발 없음"과 "카드가 안
 * 그려짐"은 다른 사실이라 빈 상태를 조용히 보여준다.
 */
export function HotspotCard({ projectId, enabled, onOpenEntry }: HotspotCardProps) {
  const { t, lang } = useT();
  const [rows, setRows] = useState<FileHotspot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const hits = await oculpmApi.fileHotspots(projectId, WINDOW_DAYS, TOP_N);
        if (!cancelled) setRows(hits);
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
  }, [projectId, enabled, nonce]);

  if (!enabled) return null;
  if (error && !loading) {
    return (
      <ErrorCard
        title={t("today.hotspot.failed")}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }
  if (loading) return null;

  const clean = rows.length === 0;

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
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: "var(--fw-bold)" }}>{t("today.hotspot.title")}</span>
        <span
          style={{
            fontSize: "var(--fs-3)",
            fontWeight: "var(--fw-bold)",
            color: "var(--text-3)",
          }}
        >
          {t("today.hotspot.recent", { days: WINDOW_DAYS, n: rows.length })}
        </span>
      </div>
      {clean ? (
        <div style={{ fontSize: "var(--fs-3)", color: "var(--text-3)", lineHeight: 1.6 }}>
          {t("today.hotspot.zeroNote")}
        </div>
      ) : (
        <>
          <div style={{ fontSize: "var(--fs-3)", color: "var(--text-2)", marginBottom: 6 }}>
            {t("today.hotspot.desc")}
          </div>
          {rows.map((r) => (
            <button
              key={r.file_path}
              type="button"
              className="mini-entry"
              onClick={() => onOpenEntry?.(r.last_entry_path)}
            >
              <div className="mini-entry-body">
                {/* 꼬리 우선 말줄임 — 파일명이 항상 보이도록 앞을 자른다
                    (긴 경로에서 정작 알아볼 파일명이 잘리는 걸 막는 RTL 트릭). */}
                <div
                  className="mini-entry-title mono"
                  style={{
                    direction: "rtl",
                    textAlign: "left",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <bdi>{r.file_path}</bdi>
                </div>
                <div className="mini-entry-meta">
                  <span>{t("today.hotspot.counts", { bug: r.bug_count, error: r.error_count })}</span>
                  <span className="dotsep">·</span>
                  <span>{t("today.hotspot.last", { date: formatWorkday(r.last_workday, lang) })}</span>
                </div>
              </div>
              <ChevronRight size={15} color="var(--text-3)" />
            </button>
          ))}
        </>
      )}
    </section>
  );
}

/** "YYYYMMDD" → UI 언어를 따르는 짧은 날짜 표기 ("9월 4일" / "Sep 4"). */
function formatWorkday(workday: string, lang: Lang): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  const date = new Date(y, m, d);
  if (Number.isNaN(date.getTime())) return workday;
  return date.toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", {
    month: "long",
    day: "numeric",
  });
}
