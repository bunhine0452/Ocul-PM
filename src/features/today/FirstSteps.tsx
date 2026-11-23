/**
 * 첫 기록까지 세 걸음 (11-15) — 일지가 하나도 없는 프로젝트. 바쁜 날과 같은 틀(날짜 줄 · 두 칸) 안의 카드 하나라
 * 덜 만든 화면처럼 보이지 않는다. 끝난 걸음은 회색 ✓, 다음 걸음만 단추를 갖는다 — 셋째(첫 일지)는 에이전트가 일을
 * 마치면 저절로 끝나는 걸음이라 단추가 없다.
 *
 * 11-23 (#firststeps-inline-install · #plugin-detect-false-positive): 첫 걸음은 이 프로젝트에 **켜진** 설치가
 * 있을 때만 끝난다(`pluginConnection`). 안 끝났으면 그 상태에 맞는 명령을 그 자리에 둔다 — 예전엔 「설정에서
 * 연결」 이 설정으로 데려가 명령을 복사하고, 터미널을 찾아 붙이고, 다시 오늘로 돌아와야 했다. 채운 단추는
 * 둘째 걸음의 「터미널에서 맡기기」 하나다(영수증 규칙 3) — 첫 걸음은 보통 단추와 링크만 갖는다.
 */

import type { ReactNode } from "react";
import { CopyCommand } from "@/components/CopyCommand";
import { NotebookText } from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import { getPlatform } from "@/lib/platform";
import { commandLabelKey, type PluginConnection } from "@/lib/pluginConnection";

/** 첫 걸음의 본문 — 상태마다 무엇이 빠졌는지를 한 문장으로. 모르면 예전 문장. */
export function connectBodyKey(connection: PluginConnection | null): I18nKey {
  switch (connection?.kind) {
    case "notInstalled":
      return "today.first.connectNotInstalled";
    case "marketplaceOnly":
      return "today.first.connectMarketplaceOnly";
    case "otherProject":
      return "today.first.connectOtherProject";
    case "disabled":
      return "today.first.connectDisabled";
    case "windowsOld":
      return "today.first.connectWindowsOld";
    case "unreachable":
      return getPlatform() === "mac" ? "prefs.agents.unreachableMac" : "prefs.agents.unreachableOther";
    default:
      return "today.first.step1Body";
  }
}

export function FirstSteps({
  connection,
  working,
  onConnect,
  onOpenTerminal,
  onHandOff,
  opening,
  receipt,
}: {
  /** 카드 바닥 한 줄 — 첫 활성화가 이 폴더에 쓴 것(`InitReceipt`). */
  receipt?: ReactNode;
  /** 이 프로젝트에서 플러그인이 어떤 상태인가. 모르면 `null`. */
  connection: PluginConnection | null;
  /** 오늘 열린 작업 세션이 있다 — 첫 작업이 이미 넘어갔다(플러그인 없이 붙은 에이전트도 여기서 끝난다). */
  working: boolean;
  /** 설정의 에이전트 칸으로. */
  onConnect: () => void;
  /** 명령을 붙여 넣을 터미널 탭으로. */
  onOpenTerminal: () => void;
  onHandOff: () => void;
  /** 첫 작업을 맡길 터미널을 여는 중. */
  opening: boolean;
}) {
  const { t } = useT();
  const connected = connection?.kind === "connected" || working;
  const lines = connection && "lines" in connection ? connection.lines : null;
  const steps = [
    { id: "connect", title: t("today.first.step1"), body: t(connectBodyKey(connected ? null : connection)), done: connected },
    { id: "task", title: t("today.first.step2"), body: t("today.first.step2Body"), done: working },
    { id: "journal", title: t("today.first.step3"), body: t("today.first.step3Body"), done: false },
  ];
  const nextAt = steps.findIndex((s) => !s.done);
  return (
    <section className="card tdy-card tdy-first" aria-labelledby="tdy-first-h">
      <header className="tdy-ch">
        <NotebookText size={15} className="tdy-first-ico" aria-hidden="true" />
        <h2 id="tdy-first-h">{t("today.first.title")}</h2>
        <span className="tdy-meta">{t("today.first.body")}</span>
      </header>
      <ol className="tdy-steps">
        {steps.map((s, i) => (
          <li key={s.id} className="tdy-step" data-done={s.done ? "" : undefined} data-step={s.id}>
            <span className="tdy-step-mark" aria-hidden="true">
              {s.done ? "✓" : String(i + 1)}
            </span>
            <div className="tdy-grow">
              <div className="tdy-row-title">
                {s.title}
                {s.done ? <span className="tdy-sr"> · {t("today.first.done")}</span> : null}
              </div>
              <div className="tdy-meta">{s.body}</div>
              {i === nextAt && s.id === "connect" && lines ? (
                <div className="tdy-step-cmd">
                  <CopyCommand lines={lines} label={t(commandLabelKey(connection?.kind ?? "notInstalled"))} />
                </div>
              ) : null}
            </div>
            {i === nextAt && s.id === "connect" ? (
              <div className="tdy-step-acts">
                {lines ? (
                  <button type="button" className="btn sm" onClick={onOpenTerminal}>
                    {t("today.first.openTerminal")}
                  </button>
                ) : null}
                <button type="button" className="btn ghost sm" onClick={onConnect}>
                  {t("today.first.connect")}
                </button>
              </div>
            ) : null}
            {i === nextAt && s.id === "task" ? (
              <button type="button" className="btn primary sm" disabled={opening} onClick={onHandOff}>
                {opening ? t("today.busy.opening") : t("today.first.step2Run")}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {receipt}
    </section>
  );
}
