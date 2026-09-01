/**
 * 설정 → 데이터 → 지난 대화 들여오기 (Osaurus 라운드 Phase 7
 * `#conversation-import`).
 *
 * 다른 도구에서 나눈 대화를 이 프로젝트의 기록으로 옮긴다. 흐름은 셋뿐이다:
 * 파일 고르기 → **목록에서 고르기** → 들여오기.
 *
 * # 왜 목록이 중간에 있는가
 *
 * export 한 파일에는 수백 개의 대화가 들어 있고 대부분은 이 프로젝트와 무관
 * 하다. 통째로 돌리면 무관한 대화 수백 건에 과금하고 일지를 오염시킨다.
 * 스캔은 **완전히 오프라인**이라 여기까지는 한 푼도 나가지 않는다.
 *
 * # 이미 들여온 대화
 *
 * 목록에서 사라지지 않고 「들여옴」으로 표시된 채 남아 선택만 막힌다 —
 * 사라지면 "왜 이 대화가 안 보이지" 가 된다. 판정은 백엔드가 원본 날짜의
 * 워크데이에서 결정적 슬러그를 찾아 한다.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "@/components/Icons";
import { importApi } from "@/api/import";
import { toAppError } from "@/api/invoke";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useT, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";
import type { EntryType, ImportReport, ImportScan } from "@/lib/bindings";
import { Section } from "../tabs/ui";

/** 한 번에 들여올 수 있는 최대 건수 — 백엔드 `MAX_PER_RUN` 과 같은 값. */
const MAX_PER_RUN = 50;

const TYPE_KEY: Record<EntryType, I18nKey> = {
  feature: "entryType.feature",
  bug: "entryType.bug",
  error: "entryType.error",
  refactor: "entryType.refactor",
  chore: "entryType.chore",
};

/** `20250714` → `2025-07-14`. 8자가 아니면 그대로 둔다. */
export function formatWorkday(w: string): string {
  return w.length === 8 ? `${w.slice(0, 4)}-${w.slice(4, 6)}-${w.slice(6, 8)}` : w;
}

export function ConversationImportSection() {
  const { t } = useT();
  const { state } = useWorkspace();
  // 임포트는 **프로젝트에 일지를 쓴다** — 열린 프로젝트가 없으면 성립하지
  // 않는다. 섹션을 숨기지는 않는다 (없어지면 기능이 사라진 줄 안다).
  const projectId = state.currentProjectId;

  const [path, setPath] = useState<string | null>(null);
  const [scan, setScan] = useState<ImportScan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPath(null);
    setScan(null);
    setPicked(new Set());
    setReport(null);
  };

  const choose = async () => {
    if (projectId == null) return;
    setBusy(true);
    try {
      const chosen = await importApi.pickExport();
      if (!chosen) return;
      // 파일을 고르자마자 스캔한다 — 무과금이므로 버튼을 하나 더 둘 이유가 없다.
      const next = await importApi.scan(projectId, chosen);
      setPath(chosen);
      setScan(next);
      setPicked(new Set());
      setReport(null);
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PER_RUN) next.add(id);
      return next;
    });
  };

  const runImport = async () => {
    if (projectId == null || !path || !scan || picked.size === 0) return;
    const chosen = scan.candidates.filter((c) => picked.has(c.source_id));
    setBusy(true);
    try {
      const outcome = await importApi.run(
        projectId,
        path,
        chosen.map((c) => c.source_id),
        chosen.map((c) => c.guessed_type),
      );
      setReport(outcome);
      // 들여온 것은 이제 중복이다 — 목록을 다시 읽어 「들여옴」으로 잠근다.
      setScan(await importApi.scan(projectId, path));
      setPicked(new Set());
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("settings.import.title")} description={t("settings.import.desc")}>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={choose}
          disabled={busy || projectId == null}
          className="flex-1"
        >
          {busy && !scan ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 mr-2" />
          )}
          {t("settings.import.pick")}
        </Button>
        {scan && (
          <Button variant="outline" onClick={reset} disabled={busy}>
            {t("common.cancel")}
          </Button>
        )}
      </div>

      {projectId == null && (
        <p className="text-xs text-muted-foreground">{t("settings.import.noProject")}</p>
      )}

      {scan && (
        <div className="rounded-lg border border-border bg-background p-3 space-y-3">
          <p className="text-sm font-medium text-foreground">
            {t("settings.import.found", { count: String(scan.candidates.length) })}
          </p>

          {scan.candidates.length > 0 && (
            <ul className="space-y-1 max-h-64 overflow-y-auto" role="list">
              {scan.candidates.map((c) => {
                const done = scan.already.includes(c.source_id);
                const checked = picked.has(c.source_id);
                return (
                  <li key={c.source_id}>
                    <label
                      className={`flex items-start gap-2 text-xs rounded px-1.5 py-1 ${
                        done ? "opacity-55" : "hover:bg-muted/50 cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        disabled={done || busy}
                        onChange={() => toggle(c.source_id)}
                        aria-label={c.title}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-foreground">{c.title}</span>
                        <span className="block text-muted-foreground font-mono text-[11px]">
                          {formatWorkday(c.workday)} · {t(TYPE_KEY[c.guessed_type])} ·{" "}
                          {t("settings.import.turns", { count: String(c.message_count) })}
                          {done ? ` · ${t("settings.import.already")}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {scan.skipped.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("settings.import.skipped", { count: String(scan.skipped.length) })}
            </p>
          )}

          {report ? (
            <ImportOutcome report={report} />
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">{t("settings.import.costNote")}</p>
              <Button onClick={runImport} disabled={busy || picked.size === 0} className="w-full">
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
                {t("settings.import.run", { count: String(picked.size) })}
              </Button>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

/**
 * 결말. 들여온 것·건너뛴 것·실패한 것을 **전부** 센다 — 부분 실패를 허용하는
 * 임포트에서 "몇 건 됐다" 만 말하면 나머지가 어디 갔는지 알 수 없다.
 */
function ImportOutcome({ report }: { report: ImportReport }) {
  const { t } = useT();
  return (
    <div className="space-y-1.5 pt-1 border-t border-border/60">
      <p className="text-sm font-medium text-[color:var(--primary)]">
        {t("settings.import.done", {
          imported: String(report.imported),
          duplicates: String(report.duplicates),
          failed: String(report.failed),
        })}
      </p>
      {report.entries
        .filter((e) => e.outcome === "failed")
        .map((e) => (
          <p key={e.source_id} className="text-xs font-mono text-destructive/80 break-all">
            {e.title} — {e.detail}
          </p>
        ))}
      <p className="text-[11px] text-muted-foreground">{t("settings.import.verifyNote")}</p>
    </div>
  );
}
