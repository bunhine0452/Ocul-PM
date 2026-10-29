/**
 * 설정 · 이 프로젝트 — 규칙 파일(AGENTS.md 템플릿) 판과 `.oculpm` 의 자리.
 *
 * 규칙 파일은 에이전트가 기록하는 방법 자체라, 앱이 든 판보다 낮으면 새 규칙이
 * 안 걸린다. 올리기는 앱이 든 판으로 바꾸고 어댑터(AGENTS.md 등)를 다시 맞춘다
 * (이전 판은 `_template.md.bak` 으로 남는다). 디스크가 앱보다 **새로우면** 고칠
 * 길은 앱 업데이트뿐이라 말만 한다.
 */
import { useCallback, useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { toAppError } from "@/api/invoke";
import { projectsApi, type TemplateGap } from "@/api/projects";
import { useProjectRuntime } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { tildePath } from "@/lib/osPath";
import { getPlatform } from "@/lib/platform";
import { requestOculpmActivate } from "@/lib/projectActions";
import { toast } from "@/lib/toast";
import { PrefsCard, PrefsRow } from "./prefsUi";

type Template =
  | { state: "loading" }
  | { state: "current" }
  | { state: "behind"; gap: TemplateGap }
  | { state: "ahead"; gap: TemplateGap }
  | { state: "unknown" };

/** `.oculpm` 의 절대 경로 — 루트의 구분자를 따른다. */
export function oculpmDirOf(root: string): string {
  const sep = getPlatform() === "windows" && root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}.oculpm`;
}

export function ProjectSection({ id }: { id: string }) {
  const { t } = useT();
  const { currentProjectId: projectId, currentProjectRoot: root, oculpmStatus } = useProjectRuntime();
  const recording = oculpmStatus?.initialized === true;
  const [template, setTemplate] = useState<Template>({ state: "loading" });
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    if (projectId == null) return;
    try {
      const [behind, ahead] = await Promise.all([
        projectsApi.templateUpgrade(projectId),
        projectsApi.templateAhead(projectId),
      ]);
      if (behind) setTemplate({ state: "behind", gap: behind });
      else if (ahead) setTemplate({ state: "ahead", gap: ahead });
      else setTemplate({ state: "current" });
    } catch {
      setTemplate({ state: "unknown" });
    }
  }, [projectId]);

  useEffect(() => {
    if (recording) void probe();
  }, [recording, probe]);

  const upgrade = async () => {
    if (projectId == null || busy) return;
    setBusy(true);
    try {
      await projectsApi.applyTemplateUpgrade(projectId);
      toast.info(t("agents.upgrade.done"));
      await probe();
    } catch (e) {
      toast.destructive(t("agents.upgrade.failed", { error: tError(toAppError(e)) }));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (!root) return;
    try {
      await revealItemInDir(oculpmDirOf(root));
    } catch (e) {
      toast.destructive(t("prefs.project.revealFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  let rules;
  if (!recording)
    rules = (
      <>
        <span className="chip sm">{t("prefs.project.off")}</span>
        <button type="button" className="btn sm primary" onClick={() => requestOculpmActivate()}>
          {t("prefs.project.turnOn")}
        </button>
      </>
    );
  else if (template.state === "loading") rules = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (template.state === "unknown") rules = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else if (template.state === "behind")
    rules = (
      <>
        <span className="chip sm warn">
          {t("prefs.project.behind", { from: template.gap.from_version, to: template.gap.to_version })}
        </span>
        <button type="button" className="btn sm" onClick={() => void upgrade()} disabled={busy}>
          {t("prefs.project.upgrade")}
        </button>
      </>
    );
  else if (template.state === "ahead")
    rules = (
      <span className="chip sm warn" title={t("prefs.project.aheadHint")}>
        {t("prefs.project.ahead", { disk: template.gap.from_version, app: template.gap.to_version })}
      </span>
    );
  else rules = <span className="chip sm ok">{t("prefs.project.current")}</span>;

  return (
    <PrefsCard id={id} title={t("prefs.project.title")}>
      <PrefsRow label={t("prefs.project.rules")}>
        <span className="mono">AGENTS.md</span>
        {rules}
      </PrefsRow>
      <PrefsRow label={t("prefs.project.where")}>
        <span className="mono">{root ? tildePath(oculpmDirOf(root)) : "—"}</span>
        <button type="button" className="btn ghost sm prefs-push" onClick={() => void reveal()}>
          {t("prefs.project.reveal")}
        </button>
      </PrefsRow>
    </PrefsCard>
  );
}
