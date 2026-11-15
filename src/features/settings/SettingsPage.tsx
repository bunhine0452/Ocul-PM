/**
 * 설정 — **한 쪽** (4.0, 시안 Settings.dc.html). 11-15 부터는 **상태표**다 (#settings-status).
 *
 * 칸은 넷이다: 에이전트 · 이 프로젝트 · 모양 · 앱. 네 칸이 같은 무게로 서서 고칠 것(플러그인 · 규칙
 * 파일 뒤처짐 · 업데이트)이 세 칸에 흩어졌다 — 맨 위 한 줄이 그것을 모아 말한다(「고칠 것 2 · …」,
 * 없으면 줄이 없다). 행동 설정(파일 열기)은 모양이 아니라 앱에, 이 프로젝트의 캐시 다시 만들기는 이
 * 프로젝트에 — 범위가 다른 두 단추가 한 줄에 서던 것을 갈랐다.
 *
 * 다른 화면의 안내 버튼은 `openSettings("agents" | …)` 로 이 쪽의 칸을 가리킨다 —
 * 마운트 때 대기 중인 칸이 있으면 그리로 스크롤하고, 도착한 칸의 머리를 한 번 표시한다.
 */
import { useCallback, useEffect, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { consumeSettingsSection, onOpenSettingsRequest, type SettingsSection } from "@/lib/settingsNav";
import { AgentsSection } from "./AgentsSection";
import { AppSection } from "./DataSection";
import { DisplaySection } from "./DisplaySection";
import { ProjectSection } from "./ProjectSection";
import { PrefsFixProvider, type PrefsFix } from "./prefsUi";
import "./prefs.css";

export const SECTION_ID: Record<SettingsSection, string> = {
  agents: "prefs-agents",
  project: "prefs-project",
  display: "prefs-display",
  data: "prefs-data",
};

function scrollTo(section: SettingsSection) {
  // 마운트 직후에는 아직 칸이 없다 — 한 프레임 뒤에 찾는다. 포커스도 도착 칸의 머리로 옮긴다: 스크롤만 하면
  // 포커스가 맨 위 「고칠 것」 단추에 남아, 키보드 · 화면 읽기 사용자는 도착 칸까지 Tab 으로 다시 훑었다.
  requestAnimationFrame(() => {
    const el = document.getElementById(SECTION_ID[section]);
    el?.scrollIntoView?.({ block: "start" });
    document.getElementById(`${SECTION_ID[section]}-title`)?.focus({ preventScroll: true });
  });
}

const sameFix = (a: PrefsFix | undefined, b: PrefsFix) =>
  !!a && a.section === b.section && a.label === b.label && a.detail === b.detail && a.mono === b.mono && a.code === b.code;

export function SettingsPage() {
  const { t } = useT();
  const [fixes, setFixes] = useState<ReadonlyMap<string, PrefsFix>>(() => new Map());
  const report = useCallback(
    (key: string, fix: PrefsFix | null) =>
      setFixes((prev) => {
        if (fix ? sameFix(prev.get(key), fix) : !prev.has(key)) return prev;
        const next = new Map(prev);
        if (fix) next.set(key, fix);
        else next.delete(key);
        return next;
      }),
    [],
  );
  const [arrived, setArrived] = useState<{ section: SettingsSection; n: number } | null>(null);
  const go = useCallback((section: SettingsSection) => {
    scrollTo(section);
    setArrived((prev) => ({ section, n: (prev?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    const pending = consumeSettingsSection();
    if (pending) go(pending);
    return onOpenSettingsRequest((section) => {
      consumeSettingsSection();
      if (section) go(section);
    });
  }, [go]);

  const arrivedAt = (s: SettingsSection) => (arrived?.section === s ? arrived.n : 0);
  const items = [...fixes.values()];

  return (
    <>
      <Toolbar title={t("shell.settings.title")} />
      <div className="scroll">
        <div className="page prefs">
          {/* 윗줄의 설정은 톱니 하나라 이름이 안 보인다 — 쪽 머리에 한 번 적는다. */}
          <h1 className="prefs-h">{t("shell.settings.title")}</h1>
          {items.length > 0 ? (
            <p className="prefs-fixes" role="status">
              <span className="chip sm warn">
                {t("prefs.fixes")} <span className="mono">{items.length}</span>
              </span>
              {items.map((f) => (
                <button key={f.section + f.label} type="button" className="prefs-fix" onClick={() => go(f.section)}>
                  {f.label} <span className={f.mono ? "mono" : undefined}>{f.detail}</span>
                  {f.code ? <> <span className="mono">{f.code}</span></> : null}
                </button>
              ))}
            </p>
          ) : null}
          <PrefsFixProvider value={report}>
            <AgentsSection id={SECTION_ID.agents} arrived={arrivedAt("agents")} />
            <ProjectSection id={SECTION_ID.project} arrived={arrivedAt("project")} />
            <DisplaySection id={SECTION_ID.display} arrived={arrivedAt("display")} />
            <AppSection id={SECTION_ID.data} arrived={arrivedAt("data")} />
          </PrefsFixProvider>
        </div>
      </div>
    </>
  );
}
