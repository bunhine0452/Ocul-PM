// 진단 탭 — 환경 정보와 피드백 이슈 열기.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { commands, type DbHealth } from "@/lib/bindings";
import { RefreshCw, Bug, MessageSquare } from "@/components/Icons";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { Section, Stat } from "./ui";

// GitHub repo behind feedback issues + the updater endpoint.
export const FEEDBACK_REPO = "bunhine0452/Ocul-PM";

/** Short OS label for prefilling feedback issues (best-effort from the webview UA). */
export function platformLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  return ua.slice(0, 60);
}

export function DiagnosticsTab({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    onError(null);
    const res = await commands.dbHealth();
    if (res.status === "ok") {
      setHealth(res.data);
    } else {
      onError(res.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    check();
    commands.appInfo().then((res) => {
      if (res.status === "ok") setVersion(res.data.version);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openIssue(kind: "bug" | "feature") {
    const isBug = kind === "bug";
    const title = isBug ? t("settings.feedback.bugTitle") : t("settings.feedback.featureTitle");
    const body = [
      isBug
        ? t("settings.feedback.bugBody1")
        : t("settings.feedback.featureBody1"),
      isBug
        ? t("settings.feedback.bugBody2")
        : t("settings.feedback.featureBody2"),
      "---",
      t("settings.feedback.appVersion", { version: version ?? "?" }),
      `- OS: ${platformLabel()}`,
    ].join("\n");
    const url =
      `https://github.com/${FEEDBACK_REPO}/issues/new` +
      `?labels=${encodeURIComponent(isBug ? "bug" : "enhancement")}` +
      `&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    void commands.openUrl(url).then((res) => {
      if (res.status === "error") toast.destructive(t("settings.feedback.openFailed", { error: res.error }));
    });
  }

  return (
    <>
      <Section
        title={t("settings.db.title")}
        description={t("settings.db.desc")}
      >
        <div className="grid grid-cols-3 gap-2">
          <Stat label="SQLite" value={health?.sqlite_version} />
          <Stat label="sqlite-vec" value={health?.vec_version} />
          <Stat label={t("settings.db.schema")} value={health ? `v${health.schema_version}` : undefined} />
        </div>
        <div className="text-[11px] font-mono break-all text-muted-foreground">
          {health?.path ?? t("settings.db.noPath")}
        </div>
        <Button onClick={check} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          {t("settings.db.refresh")}
        </Button>
      </Section>

      <Section
        title={t("settings.feedback.title")}
        description={t("settings.feedback.desc")}
      >
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => openIssue("bug")} variant="outline" size="sm">
            <Bug className="w-3.5 h-3.5 mr-1.5" />
            {t("settings.feedback.bug")}
          </Button>
          <Button onClick={() => openIssue("feature")} variant="outline" size="sm">
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            {t("settings.feedback.feature")}
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t("settings.feedback.note")}
        </div>
      </Section>
    </>
  );
}
