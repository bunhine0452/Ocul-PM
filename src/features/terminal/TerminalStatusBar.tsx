import { useT } from "@/i18n";
import { requestCheatsheet } from "@/lib/projectActions";
import { TERM_DENSITY_LABEL, type TermDensity } from "./density";
import type { IntegrationStatus } from "./shellStatus";

// 하단 상태바 (TerminalSurface 에서 분리, 2026-09-11 리디자인 2차).
//
// 2026-10-25 시안 A — **상태만** 남긴 얇은 줄이다. 예전에는 작업 폴더·단축키
// 키캡 넷·밀도 세그먼트·글자 크기 스테퍼·감시 상태가 한 줄에 다 있었다.
//   · 작업 폴더는 페인 머리띠가 페인마다 말한다 (포커스 하나만 말하던 것보다 낫다).
//   · 글자 크기·밀도는 머리줄의 `Aa` 메뉴로 갔다. 여기엔 지금 값만 글로 남긴다.
//   · 단축키는 `?` 하나 — 누르면 ⌘/ 단축키 표가 열린다. 전체 목록은 툴팁에도.
// 남은 것은 곁눈질로 읽어야 하는 두 가지, 셸 통합과 일지 감시다.

interface TerminalStatusBarProps {
  compact: boolean;
  shellStatus: IntegrationStatus;
  /** 셸 통합이 꺼져 있을 때만 — 켜는 곳(설정)으로 데려간다. */
  onEnableShell: () => void;
  fontSize: number;
  density: TermDensity;
  watchTone: "on" | "error" | "off";
  watchLabel: string;
  /** 활성 탭의 명령 블록 수 · 실패 수 — 셸 통합이 있을 때만 0 이 아니다 (시안 Terminal). */
  commands?: number;
  failed?: number;
}

export function TerminalStatusBar({
  compact,
  shellStatus,
  onEnableShell,
  fontSize,
  density,
  watchTone,
  watchLabel,
  commands = 0,
  failed = 0,
}: TerminalStatusBarProps) {
  const { t } = useT();
  const shellLabel =
    shellStatus === "active"
      ? t("term.status.shellOn")
      : shellStatus === "pending"
        ? t("term.status.shellPending")
        : t("term.status.shellOff");
  const shellHint =
    shellStatus === "active" ? t("term.shellOn") : shellStatus === "pending" ? t("term.shellPending") : t("term.shellOff");
  return (
    <div className="term-status">
      <span className="ts-seg" title={shellHint}>
        <span className="ts-dot" data-tone={shellStatus === "active" ? "on" : shellStatus === "pending" ? "wait" : "off"} />
        {shellLabel}
        {shellStatus === "off" ? (
          <button type="button" className="ts-link" onClick={onEnableShell}>
            {t("term.status.enable")}
          </button>
        ) : null}
      </span>
      <span className="ts-seg">
        <span className="ts-dot" data-tone={watchTone === "on" ? "on" : watchTone === "error" ? "err" : "off"} />
        {watchLabel}
      </span>
      {commands > 0 ? (
        <span className="ts-seg ts-view" title={t("term.status.blocksHint")}>
          {t("term.status.blocks", { n: commands })}
          {failed > 0 ? ` · ${t("term.status.failed", { n: failed })}` : ""}
        </span>
      ) : null}
      <span className="ts-fill" />
      {compact ? null : (
        <span className="ts-seg ts-view">
          {fontSize}px · {t(TERM_DENSITY_LABEL[density])}
        </span>
      )}
      <button
        type="button"
        className="ts-help"
        onClick={() => requestCheatsheet()}
        aria-label={t("term.kbd.all")}
        title={`${t("term.kbd.all")}: ${t("term.shortcuts")}`}
      >
        ?
      </button>
    </div>
  );
}
