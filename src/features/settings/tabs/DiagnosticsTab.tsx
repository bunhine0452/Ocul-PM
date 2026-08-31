// 진단 탭 — 환경 정보와 피드백 이슈 열기.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { commands, type DbHealth } from "@/lib/bindings";
import { RefreshCw, Bug, MessageSquare } from "@/components/Icons";
import { formatBytes } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { Section, Stat } from "./ui";
import { DoctorSection } from "./DoctorSection";
import { AutomationTroubleshooting } from "../automation/AutomationTroubleshooting";

/** 크기 지표는 f64 라 바인딩이 `number | null` 로 낸다 — 숫자일 때만 표기. */
function fmtBytes(n: number | null | undefined): string | undefined {
  return typeof n === "number" ? formatBytes(n) : undefined;
}
// (formatBytes 는 `lib/format` 공용 — Phase 4 에서 세 벌을 하나로.)

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
  const [compacting, setCompacting] = useState(false);
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

  // 색인 정리·프로젝트 삭제 뒤에도 파일은 저절로 줄지 않는다 — VACUUM 은 몇 초
  // 걸리고 그동안 DB 호출이 줄을 서므로 사용자가 직접 누른다.
  async function compact() {
    if (compacting) return;
    setCompacting(true);
    const res = await commands.dbCompact();
    if (res.status === "ok") {
      setHealth(res.data);
      toast.info(t("settings.db.compactDone", { size: fmtBytes(res.data.db_bytes) ?? "?" }));
    } else {
      toast.destructive(t("settings.db.compactFailed", { error: res.error }));
    }
    setCompacting(false);
  }

  const topTables = health?.top_tables ?? [];

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
      <DoctorSection />
      <Section
        title={t("settings.db.title")}
        description={t("settings.db.desc")}
      >
        <div className="grid grid-cols-3 gap-2">
          <Stat label="SQLite" value={health?.sqlite_version} />
          <Stat label="sqlite-vec" value={health?.vec_version} />
          <Stat label={t("settings.db.schema")} value={health ? `v${health.schema_version}` : undefined} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t("settings.db.size")} value={fmtBytes(health?.db_bytes)} />
          <Stat label={t("settings.db.wal")} value={fmtBytes(health?.wal_bytes)} />
          <Stat label={t("settings.db.free")} value={fmtBytes(health?.free_bytes)} />
        </div>
        {topTables.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("settings.db.topTables")}
            </div>
            <ul className="text-[11px] font-mono space-y-0.5">
              {topTables.map((row) => (
                <li key={row.name} className="flex justify-between gap-3">
                  <span className="truncate">{row.name}</span>
                  <span className="text-muted-foreground tabular-nums">{fmtBytes(row.bytes) ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="text-[11px] font-mono break-all text-muted-foreground">
          {health?.path ?? t("settings.db.noPath")}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={check} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            {t("settings.db.refresh")}
          </Button>
          <Button onClick={compact} disabled={compacting || !health} variant="outline" size="sm">
            {compacting ? t("settings.db.compacting") : t("settings.db.compact")}
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground">{t("settings.db.compactHint")}</div>
      </Section>

      {/* 자동화 문제 해결 — 에디터와 **같은 컴포넌트**. 세 번째 항목("결과가
          이상하다")이 발동 원장을 자동화 디버깅의 정식 경로로 가리킨다 (설계 §2.5). */}
      <Section
        title={t("automation.trouble.title")}
        description={t("automation.trouble.desc")}
      >
        <AutomationTroubleshooting compact />
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
