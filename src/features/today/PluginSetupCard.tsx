import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { Copy, Puzzle, RefreshCw, X } from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { claudeInstallApi } from "@/api/claudeSurface";
import { PLUGIN_INSTALL_COMMANDS } from "@/features/skills/pluginDocs";
import { openSettings } from "@/lib/settingsNav";
import { toast } from "@/lib/toast";

// Claude Code 플러그인 온보딩 (v3-surface {#plugin-onboarding}).
//
// 그전까지 미설치를 알리는 자리는 **0곳**이었다. 안내는 규칙·스킬 화면의
// "추가하기 → 플러그인" 과 설정 → ocul-pm 뿐 — 둘 다 처음 온 사람이 찾아갈 리
// 없는 깊이다. 그런데 이 플러그인이 없으면 세션 종료 훅이 없고, 그래서
// "일지 없이 끝난 세션" 을 아예 셀 수 없다.
//
// **판정 근거는 둘 다 코드에 있다** (추측 배지를 띄우지 않는다):
//   · `claude_plugin_status` — `~/.claude/plugins/**` 를 얕게 훑어
//     `name == "oculpm"` 인 `plugin.json` 을 찾는다 (commands/mcp.rs).
//     설계상 **놓칠 수는 있어도 오탐은 없다** — 그래서 문구는 "미설치" 가
//     아니라 "찾지 못했다" 다.
//   · `check_cli_available("claude")` — Claude Code 자체가 있는가.
//     없으면 이 카드는 그냥 소음이라 그리지 않는다 (Cursor·Gemini 사용자).
//
// 닫기 (v3-release {#plugin-card-dismiss}). 표시 조건은 이미 좁다 — 부르는
// 쪽이 `totalEntries === 0` 일 때만 `show` 를 주므로 일지 한 건이면 영영
// 사라진다. 그래도 **안 깔기로 고른 사람**에게는 그 조건이 참인 채로 남고,
// 그때 카드를 내릴 길이 없으면 카드가 사용자를 이긴다.
//
// 세션 한정 닫기는 다음 실행에 또 뜬다 — 그건 닫은 게 아니라 미룬 것이다.
// 그래서 SQLite 설정(`plugin_card_dismissed`)에 적는다. `lastSeenVersion` ·
// `coreModelSeeded` 와 같은 규약이고, localStorage 는 이 저장소에서 금지다.

type Probe = { cli: boolean; installed: boolean } | null;

/** 명령 한 줄 — 복사가 목적이라 줄바꿈 없이 한 줄로 붙들어 둔다. */
const CMD_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
  fontSize: "var(--fs-3)",
};
const CMD_CODE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  padding: "3px 6px",
  borderRadius: 4,
  background: "var(--bg-inset)",
  color: "var(--text-2)",
};

export function PluginSetupCard({
  show,
  onNavigate,
}: {
  /** 첫 5분인가 — 이 프로젝트에 일지가 한 건도 없을 때만 참. */
  show: boolean;
  onNavigate: (view: UiV2View) => void;
}) {
  const { t } = useT();
  const settings = useOptionalSettings();
  const [probe, setProbe] = useState<Probe>(null);
  const [checking, setChecking] = useState(false);
  // 설정이 **있는데 아직 안 읽힌** 동안은 기다린다 — 그때 `dismissed` 는
  // 기본값 false 라, 닫아 둔 사용자에게 카드가 잠깐 떴다 사라진다. 설정
  // 컨텍스트가 아예 없는 자리(공급자 없이 이 카드만 그리는 테스트)에서는
  // 기다릴 것이 없으므로 예전처럼 탐침 결과만으로 판정한다.
  const settingsPending = settings != null && !settings.loaded;
  const dismissed = settings?.settings.pluginCardDismissed ?? false;

  const check = useCallback(async () => {
    setChecking(true);
    try {
      // 실패는 둘 다 **모른다**로 접히고(래퍼가 null), 모르면 카드를 안 그린다
      // — 추측으로 배지를 띄우지 않는 것이 이 카드의 전제다.
      const [plugin, cli] = await Promise.all([
        claudeInstallApi.pluginStatus(),
        claudeInstallApi.cli("claude"),
      ]);
      setProbe({ cli: cli?.available ?? false, installed: plugin?.installed ?? false });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // 닫아 둔 사용자에게는 탐침도 돌리지 않는다 — 결과를 쓸 데가 없다.
    // 설정이 아직 안 읽혔으면 그것도 아직 모르므로 기다린다.
    if (!show || settingsPending || dismissed) return;
    void check();
  }, [show, settingsPending, dismissed, check]);

  if (!show || settingsPending || dismissed || !probe || !probe.cli || probe.installed) {
    return null;
  }

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.info(t("plugin.copyToast")));
  };

  return (
    <div className="card card-pad" role="status">
      <div className="stat-top">
        <Puzzle size={15} color="var(--accent-text)" />
        <strong>{t("today.plugin.title")}</strong>
        {/* 닫으면 다시 안 뜬다. 설정이 없는 자리(테스트·마운트 전)에서는
            버튼을 안 그린다 — 눌러도 아무 일 없는 버튼이 더 나쁘다. */}
        {settings?.set ? (
          <button
            className="btn ghost sm right"
            onClick={() => void settings.set("pluginCardDismissed", true)}
            aria-label={t("common.dismiss")}
            title={t("today.plugin.dismissHint")}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <div className="first-run-sub">{t("today.plugin.body")}</div>
      <div className="first-run-sub" style={{ color: "var(--text-3)", marginBottom: 8 }}>
        {t("today.plugin.how")}
      </div>
      {PLUGIN_INSTALL_COMMANDS.map((c) => (
        <div key={c} className="mono" style={CMD_ROW}>
          <code style={CMD_CODE}>{c}</code>
          <button className="btn sm" onClick={() => copy(c)}>
            <Copy size={13} /> {t("plugin.copy")}
          </button>
        </div>
      ))}
      <div className="first-run-actions">
        <button className="btn sm" onClick={() => void check()} disabled={checking}>
          <RefreshCw size={13} /> {t("today.plugin.recheck")}
        </button>
        <button
          className="btn sm"
          onClick={() => {
            onNavigate("settings");
            openSettings("oculpm");
          }}
        >
          {t("today.plugin.settings")}
        </button>
      </div>
      <div className="first-run-sub" style={{ color: "var(--text-3)" }}>
        {t("today.plugin.notFoundNote")}
      </div>
    </div>
  );
}
