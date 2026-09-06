import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { Copy, Puzzle, RefreshCw } from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
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
// 닫기 버튼이 없는 이유: 표시 조건이 이미 **첫 5분**이다. 부르는 쪽이
// `totalEntries === 0` 일 때만 `show` 를 준다 — 일지가 한 건이라도 쌓이면
// 영영 사라진다. 세션 한정 닫기는 다음 실행에 또 뜨고, 영구 닫기는 설정 키가
// 필요한데 그건 이 레인의 파일 밖이다.

type Probe = { cli: boolean; installed: boolean } | null;

/** 명령 한 줄 — 복사가 목적이라 줄바꿈 없이 한 줄로 붙들어 둔다. */
const CMD_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
  fontSize: "var(--fs-5)",
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
  const [probe, setProbe] = useState<Probe>(null);
  const [checking, setChecking] = useState(false);

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
    if (!show) return;
    void check();
  }, [show, check]);

  if (!show || !probe || !probe.cli || probe.installed) return null;

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.info(t("plugin.copyToast")));
  };

  return (
    <div className="card card-pad" role="status" style={{ marginBottom: 16 }}>
      <div className="stat-top">
        <Puzzle size={15} color="var(--accent-text)" />
        <strong>{t("today.plugin.title")}</strong>
      </div>
      <div className="first-run-sub">{t("today.plugin.body")}</div>
      <div className="first-run-sub" style={{ color: "var(--text-3)", marginBottom: 8 }}>
        {t("today.plugin.how")}
      </div>
      {PLUGIN_INSTALL_COMMANDS.map((c) => (
        <div key={c} className="mono" style={CMD_ROW}>
          <code style={CMD_CODE}>{c}</code>
          <button className="btn sm" onClick={() => copy(c)}>
            <Copy size={12} /> {t("plugin.copy")}
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
