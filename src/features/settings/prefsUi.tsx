/**
 * 설정 한 쪽의 조각 — 칸(카드) · 줄(라벨 · 값 · 동작) · 고르기(라디오 묶음) · 「고칠 것」 보고.
 * 네 칸이 같은 모양으로 서도록 한 곳에 둔다.
 *
 * 11-15 (#settings-status): 줄은 세 칸 격자다 — 라벨 240px · 값 · 동작. 동작 단추는 모든 줄에서 오른쪽
 * 한 세로선에 선다(세 세로선이던 것). 설명이 두 줄을 넘으면 줄 아래 전체 폭으로 내려간다 — 200px 칸에서
 * 세 줄로 꺾여 조사가 줄 머리로 갔다.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { RadioSeg, type RadioSegOption } from "@/components/RadioSeg";
import type { SettingsSection } from "@/lib/settingsNav";

export function PrefsCard({
  id,
  title,
  action,
  arrived = 0,
  children,
}: {
  id: string;
  title: string;
  /** 칸 머리 오른쪽 — 「다시 확인」 같은 칸 전체의 동작. */
  action?: ReactNode;
  /** 다른 화면에서 이 칸으로 바로 왔다 — 올 때마다 늘어나는 수(머리를 한 번 표시한다). */
  arrived?: number;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="card prefs-card" aria-labelledby={titleId}>
      <div className="prefs-head">
        {/* 도착 표시 — 새로 그려질 때만 옅은 면에서 사라진다(@starting-style). 움직임은 응답일 때만. */}
        {arrived > 0 ? <span key={arrived} className="prefs-arrive" aria-hidden="true" /> : null}
        <h2 id={titleId}>{title}</h2>
        {action ? <div className="prefs-head-act">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** 설명이 라벨 칸(240px)에서 두 줄을 넘는가 — 한글 · 전각은 한 칸, 그 밖은 반 칸 남짓으로 어림한다. */
export function isLongMeta(text: string): boolean {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    // 한글 자모 · CJK 기호와 한자 · 한글 음절 · 전각 — 글자 하나가 한 칸(12px).
    const wide =
      (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3000 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xff00 && cp <= 0xffef);
    width += wide ? 12 : 6.6;
  }
  return width > 2 * 236;
}

export function PrefsRow({
  label,
  meta,
  actions,
  children,
}: {
  label: string;
  meta?: ReactNode;
  /** 줄의 동작 단추 — 오른쪽 한 세로선. 테두리 단추(`btn sm`)만, ghost 는 윗줄 · 툴바 몫이다. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const long = typeof meta === "string" && isLongMeta(meta);
  return (
    <div className={"prefs-row" + (long ? " has-long-meta" : "") + (actions ? "" : " no-act")}>
      <div className="prefs-label">
        <div className="prefs-name">{label}</div>
        {meta && !long ? <div className="prefs-meta">{meta}</div> : null}
      </div>
      <div className="prefs-val">{children}</div>
      {actions ? <div className="prefs-act">{actions}</div> : null}
      {meta && long ? <div className="prefs-meta prefs-meta-long">{meta}</div> : null}
    </div>
  );
}

/** 여럿 중 하나 — `.seg` 라디오 묶음 (게이트 규칙 21). 지금 값이 목록에 없으면 아무것도 안 고른다. */
export function PrefsSeg<T extends string>(props: {
  label: string;
  value: T | null;
  options: ReadonlyArray<RadioSegOption<T>>;
  onChange: (next: T) => void;
}) {
  return <RadioSeg<T> {...props} />;
}

/** 맨 위 「고칠 것」 한 줄의 한 항목 — 어느 칸의 무엇이 어떻게. */
export interface PrefsFix {
  section: SettingsSection;
  label: string;
  detail: string;
  /** 판 번호처럼 기계 글씨인가 (영수증 규칙 2). */
  mono?: boolean;
}

type Report = (key: string, fix: PrefsFix | null) => void;
const FixContext = createContext<Report>(() => {});
export const PrefsFixProvider = FixContext.Provider;

/** 칸이 고칠 것을 맨 위 한 줄에 올린다 — 없어지면 내린다. */
export function useReportFix(key: string, fix: PrefsFix | null): void {
  const report = useContext(FixContext);
  const sig = fix ? `${fix.section}\0${fix.label}\0${fix.detail}\0${fix.mono ? 1 : 0}` : "";
  useEffect(() => {
    report(key, fix);
    return () => report(key, null);
    // 같은 내용이면 다시 올리지 않는다 — 객체는 그릴 때마다 새로 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, key, sig]);
}
