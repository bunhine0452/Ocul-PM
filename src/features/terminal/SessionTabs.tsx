/**
 * 터미널 탭 줄 — 세션마다 번호 · 이름, 그리고 **예외만** (영수증 규칙 1).
 *
 * 탭 폭의 2/3 를 「실행 중 · 일지 1건」 같은 평상 낱말이 먹고 살아 있는 세션마다 초록 점이 섰다. 이제 평상
 * 낱말과 일지 수는 툴팁으로 가고, 보이는 낱말은 기다림 사유 · 끝남 코드 · 일지 없음 · 최근 소식 없음뿐이다.
 * 점은 살아 있음 회색, 기다림 앰버 + 고리, 끝남 빈 고리, 실패 빨강 — 색만이 아니라 모양으로도 갈린다.
 * 낱말은 모두 낱말일 뿐이다 — 「일지 없음」 을 눌러도 그 탭을 고를 뿐, 기록 부탁은 칸 위 띠의 단추 하나가 한다
 * (같은 앰버 낱말 가운데 하나만 몰래 일을 시키면 영수증 규칙 4 — 같은 모양 같은 뜻 — 에 어긋난다).
 *
 * 키보드는 탭 목록의 관례 — 고른 탭만 Tab 이 멈추고(roving), ←/→/Home/End 로 옮기며 고른다. Delete 는 닫기.
 * 닫기 ×는 점 자리에 겹친 마우스 표적이다: 탭 목록 안의 단추는 목록이 탭만 품는다는 약속을 깬다
 * (axe `aria-required-children`) — 키보드 · 화면 읽기는 Delete(`aria-keyshortcuts`)로 닫는다.
 *
 * 넘치면 스크롤바 없이 끝에 「+3」 — 숨은 세션 목록이 뜬다. 숨은 쪽에 기다리는 세션이 있으면 앰버로 말한다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import type { TermInfo } from "@/api/terminal";
import { X } from "@/components/Icons";
import { useT } from "@/i18n";
import { useMenuKeys } from "./menuKeys";
import { oscTitle, sessionLabel, sessionName, sessionNumber, type SessionView } from "./status";

export interface SessionTabsProps {
  sessions: TermInfo[];
  active: number | null;
  /** 칸에 떠 있는 세션 — 크게 보는 동안은 고른 칸 하나. */
  shown: ReadonlySet<number>;
  viewOf: (s: TermInfo) => SessionView;
  recordsOf: (s: TermInfo) => number;
  /** `keepFocus` — 키보드로 옮길 때는 입력을 터미널로 넘기지 않는다(다음 화살표도 탭 줄이 받게). */
  onPick: (id: number, keepFocus?: boolean) => void;
  onClose: (id: number) => void;
}

/** 점 — 탭 · 칸 머리 · 숨은 목록 · 레인 띠가 같은 모양을 쓴다 (영수증 규칙 4). */
export function SessionDot({ view }: { view: SessionView }) {
  return <span className={"tm-dot is-" + view.mark + (view.norec ? " is-norec" : "")} aria-hidden="true" />;
}

/** 예외 낱말 — 평상이면 아무것도 없다. */
export function SessionWord({ view }: { view: SessionView }) {
  if (!view.word) return null;
  return <span className={"tm-meta" + (view.tone ? " is-" + view.tone : "")}>{view.word}</span>;
}

/**
 * 툴팁 — 이름(제목이 잘렸을 때) · 안의 프로그램이 붙인 제목(이름이 「시도 n」 이라 제목이 안 보일 때) · 평상
 * 낱말 · 일지 수 · 기다리는 까닭.
 */
function tooltip(t: ReturnType<typeof useT>["t"], s: TermInfo, view: SessionView, records: number): string {
  const name = sessionName(t, s);
  const title = oscTitle(s);
  const parts = title && title !== name ? [name, title, view.plain] : [name, view.plain];
  if (records > 0) parts.push(t("terminal.records", { n: records }));
  if (s.status?.msg && view.mark === "wait") parts.push(s.status.msg);
  return parts.join(" · ");
}

export function SessionTabs({ sessions, active, shown, viewOf, recordsOf, onPick, onClose }: SessionTabsProps) {
  const { t } = useT();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState<number[]>([]);

  // 넘친 탭 — 스크롤 칸의 보이는 폭 밖으로 (조금이라도) 나간 탭. 폭을 모르면(첫 페인트) 없다고 친다.
  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const out: number[] = [];
    if (r.width > 0) {
      for (const el of box.querySelectorAll<HTMLElement>(".tm-tab")) {
        const b = el.getBoundingClientRect();
        if (b.right > r.right + 1 || b.left < r.left - 1) out.push(Number(el.dataset.tabId));
      }
    }
    setHidden((prev) => (prev.length === out.length && prev.every((id, i) => id === out[i]) ? prev : out));
  }, []);

  // 고른 탭이 바뀌면(⇧⌘] · 숨은 목록) 보이게 — 예전엔 넘친 탭을 골라도 화면 밖에 남았다. 고른 탭이 바뀔 때만:
  // 세션 목록은 상태 신호마다 새로 오니, 거기 걸면 사람이 옆으로 굴려 보던 탭 줄이 신호마다 되돌아갔다.
  useLayoutEffect(() => {
    scrollRef.current
      ?.querySelector<HTMLElement>(".tm-tab.is-active")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
  }, [active, measure]);
  // 넘친 탭은 목록이 바뀔 때마다 다시 잰다(이름 · 낱말이 바뀌면 폭도 바뀐다).
  useLayoutEffect(() => measure(), [sessions, measure]);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(box);
    box.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      box.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...(scrollRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const at = tabs.indexOf((e.target as Element).closest<HTMLButtonElement>('[role="tab"]') as HTMLButtonElement);
    if (at < 0) return;
    if (e.key === "Delete") {
      e.preventDefault();
      onClose(sessions[at].id);
      return;
    }
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : null;
    if (to == null) return;
    e.preventDefault();
    tabs[to].focus();
    onPick(sessions[to].id, true);
  };

  const hiddenSessions = sessions.filter((s) => hidden.includes(s.id));
  return (
    <div className="tm-tabs">
      <div
        className="tm-tabs-scroll"
        role="tablist"
        aria-label={t("terminal.listAria")}
        ref={scrollRef}
        onKeyDown={onKeyDown}
      >
        {sessions.map((s) => {
          const view = viewOf(s);
          const records = recordsOf(s);
          const isActive = s.id === active;
          const label = sessionLabel(t, s);
          return (
            <div
              key={s.id}
              // `data-term-id` 가 아니다 — 끌어다 놓은 파일은 커서 아래 **칸**의 세션이 받는다(`dropFiles.termIdAt`).
              data-tab-id={s.id}
              className={
                "tm-tab" +
                (isActive ? " is-active" : shown.has(s.id) ? " is-shown" : "") +
                (view.mark === "wait" ? " is-wait" : "") +
                (view.mark === "fail" ? " is-fail" : "")
              }
            >
              <button
                type="button"
                role="tab"
                className="tm-pick"
                aria-selected={isActive}
                tabIndex={isActive || (active == null && s === sessions[0]) ? 0 : -1}
                aria-keyshortcuts="Delete"
                title={tooltip(t, s, view, records)}
                onClick={() => onPick(s.id)}
              >
                <SessionDot view={view} />{" "}
                <span className="tm-num">{sessionNumber(s.id)}</span>{" "}
                <span className="tm-name">{sessionName(t, s)}</span> <SessionWord view={view} />
                {view.norec ? (
                  <>
                    {" "}
                    <span className="tm-norec" title={t("terminal.noRecordTitle")}>
                      {t("terminal.noRecord")}
                    </span>
                  </>
                ) : null}
              </button>
              <span
                className="tm-close"
                aria-hidden="true"
                title={t("terminal.closeAria", { name: label })}
                onClick={() => onClose(s.id)}
              >
                <X size={11} />
              </span>
            </div>
          );
        })}
      </div>
      {hiddenSessions.length > 0 ? (
        <MoreSessions sessions={hiddenSessions} viewOf={viewOf} onPick={(id) => onPick(id)} />
      ) : null}
    </div>
  );
}

/**
 * 「+3」 — 숨은 세션 목록 (⌘O 프로젝트 목록과 같은 모양 · 키보드: ↑↓ · Home · End · Esc · Tab 은 닫기).
 * 숨은 쪽에 기다리는 세션이 있으면 앰버 「기다림 1」 — 화면 밖에서 Claude 가 기다리는 것을 놓치지 않게.
 */
function MoreSessions({
  sessions,
  viewOf,
  onPick,
}: {
  sessions: TermInfo[];
  viewOf: (s: TermInfo) => SessionView;
  onPick: (id: number) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const waiting = sessions.filter((s) => viewOf(s).mark === "wait").length;
  useMenuKeys(open, wrapRef, (refocus) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  });

  const label =
    t("terminal.moreAria", { n: sessions.length }) + (waiting > 0 ? " · " + t("terminal.moreWaiting", { n: waiting }) : "");
  return (
    <div className="tm-more-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tm-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tm-num">+{sessions.length}</span>
        {waiting > 0 ? <span className="tm-more-wait">{t("terminal.moreWaiting", { n: waiting })}</span> : null}
      </button>
      {open ? (
        <div className="tm-more-pop" role="menu" aria-label={t("terminal.moreAria", { n: sessions.length })}>
          {sessions.map((s) => {
            const view = viewOf(s);
            return (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                className="tm-more-item"
                onClick={() => {
                  setOpen(false);
                  onPick(s.id);
                }}
              >
                <SessionDot view={view} />
                <span className="tm-num">{sessionNumber(s.id)}</span>
                <span className="tm-name">{sessionName(t, s)}</span>
                <SessionWord view={view} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
