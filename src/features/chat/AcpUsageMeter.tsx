import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RefreshCw } from "@/components/Icons";
import { commands, type AcpUsage } from "@/lib/bindings";
import { useT } from "@/i18n";
import { useDismiss } from "./useDismiss";
import { onUsagePanel } from "./usageBus";
import { relativeTime } from "./relativeTime";
import { parseUsageDetail } from "./usageDetail";

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

/**
 * 계기는 **부모가 다시 그려도 그대로 있어야 한다.**
 *
 * 이 위젯은 대화 화면의 툴바에 산다. 답이 흐르는 동안 그 화면은 초당 수십 번
 * 다시 그려지는데, 계기가 같이 딸려 그려질 이유가 없다 — 프로젝트 id 말고는
 * 밖에서 오는 것이 없고, 숫자는 자기 타이머가 갱신한다.
 */
export const AcpUsageMeter = memo(function AcpUsageMeter({
  projectId,
  provider = "claude",
}: {
  projectId: number;
  provider?: "claude" | "codex";
}) {
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
    const res = await commands.acpUsage(projectId, provider);
    if (res.status === "ok") setUsage(res.data);
  }, [projectId, provider]);

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
      const res = await commands.acpRefreshUsage(projectId, provider);
      if (res.status === "ok") setUsage(res.data);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [projectId, provider]);

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
   * 값이 없으면 한 번 물어본다 (에이전트가 붙을 때까지 몇 번 다시 시도).
   *
   * 예전에 이 자리에서 대화가 쌓였던 것은 **물어볼 때마다 대화를 팠기** 때문이고,
   * 지금은 어댑터가 사는 동안 전용 대화 하나만 쓰고 그것도 목록에서 감춘다.
   * 그래서 다시 물어봐도 된다 — 안 물어보면 첫 대화 전까지 계기가 안 뜬다.
   *
   * 값이 생기면 멈추고, 그 뒤로는 **상태 읽기**만 한다(왕복 없음).
   */
  const hasLimits = (usage?.limits.length ?? 0) > 0;
  useEffect(() => {
    if (hasLimits) return;
    let tries = 0;
    const ask = () => {
      tries += 1;
      void refresh();
      // 에이전트가 아직 안 붙었으면 실패한다 — 몇 번만 다시 본다. 무한히
      // 두드리면 어댑터가 영영 안 뜨는 상황에서 조용히 계속 돈다.
      if (tries >= 5) window.clearInterval(timer);
    };
    const timer = window.setInterval(ask, 4_000);
    ask();
    return () => window.clearInterval(timer);
  }, [hasLimits, refresh]);

  useEffect(() => {
    // 안 보이는 동안에는 두드리지 않는다 — Claude Code 화면은 keep-alive 라
    // 다른 화면에 가 있어도 이 타이머가 영원히 돌았다(8초마다 IPC).
    // `getClientRects().length === 0` 이면 `display:none` 아래다.
    const timer = window.setInterval(() => {
      if (!wrapRef.current?.getClientRects().length) return;
      void read();
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [read]);

  /** 원문을 모양별로 뜯어 둔다 — 문자열이 그대로면 다시 뜯지 않는다. */
  const detail = useMemo(
    () => (usage?.detail ? parseUsageDetail(usage.detail) : []),
    [usage?.detail],
  );

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

          {/* `/usage` 가 덧붙이는 "무엇이 기여했나" 대목.
              모양별로 뜯어 그린다 — 원문을 통째로 `<pre>` 에 걸었더니 좁은
              카드에서 한 문장이 네 줄로 접히고 그 아래가 잘려, 정보가 있는데
              읽히지 않았다. **모르는 줄은 예전 그대로** 고정폭 원문으로 남는다
              (usageDetail.ts) — 파서가 CLI 판올림을 앞질러 빈칸을 만들지 않게. */}
          {detail.length ? (
            <section className="usage-detail">
              <span className="usage-detail-title">{t("acp.usageDetail")}</span>
              <div className="usage-detail-body">
                {detail.map((block, at) => {
                  const key = `${block.kind}-${at}`;
                  if (block.kind === "note") {
                    return (
                      <p key={key} className="usage-note">
                        {block.text}
                      </p>
                    );
                  }
                  if (block.kind === "stat") {
                    return (
                      <p key={key} className="usage-stat">
                        {block.text}
                      </p>
                    );
                  }
                  if (block.kind === "share") {
                    return (
                      <div key={key} className="usage-share">
                        <div className="usage-share-head">
                          <span className="usage-share-text">{block.text}</span>
                          <span className="usage-share-pct">
                            {block.pct}
                            <span className="usage-row-unit">%</span>
                          </span>
                        </div>
                        <div className="usage-bar">
                          <span
                            className="usage-bar-fill"
                            style={{ width: `${Math.min(100, block.pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  }
                  if (block.kind === "top") {
                    return (
                      <div key={key} className="usage-top">
                        <span className="usage-top-label">{block.label}</span>
                        <div className="usage-top-items">
                          {block.items.map((item) => (
                            <span key={item.name} className="usage-chip" title={item.name}>
                              <span className="usage-chip-name">{item.name}</span>
                              {item.pct != null ? (
                                <span className="usage-chip-pct">{item.pct}%</span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <pre key={key} className="usage-raw">
                      {block.text}
                    </pre>
                  );
                })}
              </div>
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
});
