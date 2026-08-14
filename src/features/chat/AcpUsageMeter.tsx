import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RefreshCw } from "@/components/Icons";
import { commands, type AcpUsage } from "@/lib/bindings";
import { useT } from "@/i18n";
import { useDismiss } from "./useDismiss";
import { onUsagePanel } from "./usageBus";
import { relativeTime } from "./relativeTime";

// PR-ACP11 — 툴바의 사용량 계기.
//
// 한도는 `usage_update` 에 실려 오는데 **한 번에 한 종류씩**이라, 백엔드가
// 종류별로 누적한 것을 여기서 읽는다. 세션·주간·Fable 세 줄이 다 모이려면
// 턴이 몇 번 돌아야 하므로, 아직 못 본 줄은 그리지 않는다 — 0% 로 그리면
// "여유롭다"는 거짓말이 된다.

/**
 * 한도 종류 → 사람이 읽는 이름. 모르는 종류는 **원문 그대로** 보여 준다.
 *
 * 두 출처의 어휘가 다르다: `_meta` 는 `seven_day` 같은 기계 이름을, `/usage`
 * 는 `week (all models)` 같은 문장을 준다. 후자는 이미 읽을 만하므로 굳이
 * 번역하지 않는다 — 우리가 지어낸 이름이 CLI 가 쓴 이름과 어긋나는 편이 더
 * 나쁘다.
 */
const LIMIT_LABEL: Readonly<Record<string, string>> = {
  five_hour: "acp.limit.session",
  seven_day: "acp.limit.week",
  seven_day_opus: "acp.limit.weekOpus",
  seven_day_fable: "acp.limit.weekFable",
  session: "acp.limit.session",
};

/**
 * 툴바에 붙일 **짧은** 이름. 숫자만 셋을 늘어놓으면 무엇의 %인지 알 수 없고,
 * 그렇다고 "주간 (7일)" 을 다 쓰면 툴바가 넘친다.
 */
const LIMIT_SHORT: Readonly<Record<string, string>> = {
  five_hour: "acp.limit.shortSession",
  session: "acp.limit.shortSession",
  seven_day: "acp.limit.shortWeek",
  seven_day_opus: "acp.limit.shortOpus",
  seven_day_fable: "acp.limit.shortFable",
};

/** `/usage` 가 주는 이름은 문장형이라 여기서 짧은 키로 접는다. */
function shortKeyOf(kind: string): string | undefined {
  const direct = LIMIT_SHORT[kind];
  if (direct) return direct;
  const id = kind.toLowerCase();
  if (id.startsWith("session")) return "acp.limit.shortSession";
  if (id.includes("fable")) return "acp.limit.shortFable";
  if (id.includes("opus")) return "acp.limit.shortOpus";
  if (id.startsWith("week")) return "acp.limit.shortWeek";
  return undefined;
}

function pct(utilization: number | null): number {
  return Math.round(Math.min(1, Math.max(0, utilization ?? 0)) * 100);
}

/** 임계에 따른 색 — 숫자만으로는 "이제 아껴야 하나"가 안 읽힌다. */
function toneOf(utilization: number | null): string {
  const value = utilization ?? 0;
  if (value >= 0.9) return " danger";
  if (value >= 0.75) return " warn";
  return "";
}

export function AcpUsageMeter({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [usage, setUsage] = useState<AcpUsage | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []), cardRef);

  /**
   * 카드는 **document.body 로 띄운다**.
   *
   * 이 계기는 툴바 액션 묶음(`.toolbar-actions`) 안에 있는데, 거기엔 좁은 창
   * 방어용 `overflow-x: auto / overflow-y: hidden` 이 걸려 있다. 그 안에서
   * `position: absolute` 로 아래에 펼치면 **통째로 잘려 아무 것도 안 보인다** —
   * 눌러도 반응이 없는 것처럼 느껴졌던 것이 이것이었다(상태는 멀쩡히 바뀌고
   * 있었다). 부모 클리핑을 벗어나려면 포털밖에 없다.
   */
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    place();
    // 창 크기·스크롤이 바뀌면 앵커도 따라간다 — 포털은 부모를 따라 움직이지
    // 않으므로 우리가 다시 재어 줘야 카드가 버튼 밑에 붙어 있는다.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  /** 상태에 갈무리된 값 읽기 — 왕복이 없다. */
  const read = useCallback(async () => {
    const res = await commands.acpUsage(projectId);
    if (res.status === "ok") setUsage(res.data);
  }, [projectId]);

  /**
   * 진짜 새로고침 — `/usage` 를 보낸다.
   *
   * **토큰을 쓰지 않는다**(실측 2026-08-15: inputTokens=outputTokens=0). CLI 가
   * 로컬에서 답하는 커맨드라서, 세션·주간·Fable 을 공짜로 한 번에 받아 온다.
   *
   * 백엔드가 **일회용 대화**를 파서 묻고 지운다 — 보고 있는 대화에 "/usage" 가
   * 남지 않는다. 그래서 첫 마디 전에도 물어볼 수 있다.
   */
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    // **한 번에 하나만.** 이 조회는 일회용 대화를 하나 파므로, 겹쳐 돌면 그만큼
    // 대화가 생긴다 — 처음 들어갔을 때 "/usage" 가 두 개 생기던 것이 이것이다
    // (StrictMode 이중 마운트 + 재시도 루프가 겹쳤다).
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await commands.acpRefreshUsage(projectId);
      if (res.status === "ok") setUsage(res.data);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [projectId]);

  // `/usage` 나 컴포저 배지에서 열어 달라는 신호. 열면서 값도 새로 읽는다 —
  // 사용자가 지금 알고 싶은 건 **지금** 숫자다.
  useEffect(
    () =>
      onUsagePanel(() => {
        setOpen(true);
        void refresh();
      }),
    [refresh],
  );

  /**
   * **시작하자마자 묻지 않는다.**
   *
   * 이 조회는 일회용 대화를 파고 지우는 일이라 공짜가 아니다. 예전엔 값이 없으면
   * 3초마다 다시 시도했는데, Claude Code 에 처음 들어가는 것만으로 대화가 두 개씩
   * 생겼다. 한도는 대화가 한 번 돌면 알림(`usage_update`)으로 저절로 채워지고,
   * 그 전에 알고 싶으면 사용자가 계기를 누르거나 `/usage` 를 치면 된다.
   *
   * 그래서 주기 조회는 **상태 읽기**뿐이다 — 왕복도 대화 생성도 없다.
   */
  useEffect(() => {
    void read();
    const timer = window.setInterval(() => void read(), 8_000);
    return () => window.clearInterval(timer);
  }, [read]);

  const limits = usage?.limits ?? [];
  if (!limits.length) return null;

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"usage-meter" + (open ? " open" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("acp.usageTitle")}
        onClick={() => setOpen((v) => !v)}
      >
        {limits.map((limit) => {
          const shortKey = shortKeyOf(limit.kind);
          return (
            <span key={limit.kind} className={"usage-pill" + toneOf(limit.utilization)}>
              <span className="usage-pill-name">
                {shortKey ? t(shortKey as Parameters<typeof t>[0]) : limit.kind}
              </span>
              <span className="usage-pill-value">{pct(limit.utilization)}%</span>
            </span>
          );
        })}
      </button>
      {open && anchor
        ? createPortal(
        <div
          ref={cardRef}
          className="usage-card"
          role="dialog"
          aria-label={t("acp.usageTitle")}
          style={{ top: anchor.top, right: anchor.right }}
        >
          <header className="usage-card-head">
            <span className="usage-card-title">{t("acp.usageTitle")}</span>
            <button
              type="button"
              className={"usage-refresh" + (refreshing ? " busy" : "")}
              disabled={refreshing}
              onClick={() => void refresh()}
              aria-label={t("acp.usageRefresh")}
              title={t("acp.usageRefresh")}
            >
              <RefreshCw size={13} />
            </button>
          </header>

          <div className="usage-rows">
            {limits.map((limit) => {
              const labelKey = LIMIT_LABEL[limit.kind];
              // `/usage` 가 준 문장이 있으면 그대로 — 우리가 시간대를 다시
              // 계산하다 틀리느니 CLI 가 쓴 표현을 믿는다.
              const resets =
                limit.resets_text ??
                (limit.resets_at
                  ? relativeTime(new Date(limit.resets_at * 1000).toISOString(), Date.now())
                  : null);
              return (
                <section key={limit.kind} className="usage-row">
                  <div className="usage-row-head">
                    <span className="usage-row-name">
                      {labelKey ? t(labelKey as Parameters<typeof t>[0]) : limit.kind}
                    </span>
                    <span className={"usage-row-pct" + toneOf(limit.utilization)}>
                      {pct(limit.utilization)}
                      <span className="usage-row-unit">%</span>
                    </span>
                  </div>
                  <div className="usage-bar">
                    <span
                      className={"usage-bar-fill" + toneOf(limit.utilization)}
                      style={{ width: `${pct(limit.utilization)}%` }}
                    />
                  </div>
                  {resets ? (
                    <span className="usage-row-reset">
                      {t("acp.usageResets", { at: resets })}
                    </span>
                  ) : null}
                </section>
              );
            })}
          </div>

          {/* `/usage` 가 덧붙이는 "무엇이 기여했나" 대목 — **원문 그대로** 건다.
              표로 뜯지 않는 이유는 백엔드 주석에 적었다: 항목이 계속 늘고 문구도
              CLI 판올림마다 바뀌어서, 파싱해 두면 다음 판에 조용히 빈칸이 된다.
              공백 정렬까지 살려야 오른쪽 % 열이 줄을 맞춘다. */}
          {usage?.detail ? (
            <section className="usage-detail">
              <span className="usage-detail-title">{t("acp.usageDetail")}</span>
              <pre className="usage-detail-body">{usage.detail}</pre>
            </section>
          ) : null}

          {usage && usage.size > 0 ? (
            <footer className="usage-card-foot">
              <Check size={12} />
              {t("acp.usageContext", {
                pct: Math.round((usage.used / Math.max(usage.size, 1)) * 100),
                cost: usage.cost_usd != null ? `$${usage.cost_usd.toFixed(2)}` : "—",
              })}
            </footer>
          ) : null}
        </div>,
        document.body,
        )
        : null}
    </div>
  );
}
