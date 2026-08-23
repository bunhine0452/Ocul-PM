// 설정 → 코드 탭 (#lsp-settings-screen).
//
// 두 덩어리다.
//   · 편집기 — 저장 시 포맷·들여쓰기. 타입 있는 `Settings` 필드.
//   · 언어 서버 — 언어별 켜기/끄기·실행 경로 오버라이드. 이쪽은 **동적 키**
//     (`code_lsp_off_<lang>` / `code_lsp_cmd_<lang>`)라 `Settings` 객체에 넣지
//     않는다: 지원 언어가 늘 때마다 필드를 늘리면 레지스트리(SERVERS)와 두 벌의
//     진실이 된다. 백엔드가 언어 id 로 키를 파생하고 여기서도 그 규칙을 따른다.
//
// SettingsPanel 에 직접 넣지 않은 이유는 그 파일이 이미 1,800줄이 넘기 때문이다.
import { useCallback, useEffect, useState } from "react";

import { commands, type LspServerInfo, type LspServerState } from "@/lib/bindings";
import { useSettings } from "@/contexts/SettingsContext";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { Input } from "@/components/ui/input";

/** 백엔드 `state.rs` 의 키 규칙과 **같은 문자열**이어야 한다. */
const disabledKey = (languageId: string) => `code_lsp_off_${languageId}`;
const commandKey = (languageId: string) => `code_lsp_cmd_${languageId}`;

/** 언어 서버 설치 안내 — 자동 설치는 하지 않는다는 결정의 반대편(설계 SSOT). */
const INSTALL_HINT: Record<string, string> = {
  rust: "rustup component add rust-analyzer",
  typescript: "npm i -g typescript-language-server typescript",
  python: "npm i -g pyright",
  go: "go install golang.org/x/tools/gopls@latest",
};

interface Row {
  info: LspServerInfo;
  disabled: boolean;
  command: string;
}

export function CodeSettings({
  Section,
  Field,
  Toggle,
}: {
  Section: React.ComponentType<{ title: string; description?: string; children: React.ReactNode }>;
  Field: React.ComponentType<{ label: string; hint?: string; children: React.ReactNode }>;
  Toggle: React.ComponentType<{ checked: boolean; onChange: (v: boolean) => void; label: string }>;
}) {
  const { t } = useT();
  const { settings, set } = useSettings();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;

  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    if (projectId == null) {
      setRows([]);
      return;
    }
    const res = await commands.lspStatus(projectId);
    if (res.status !== "ok") {
      setRows([]);
      return;
    }
    const next = await Promise.all(
      res.data.map(async (info) => {
        const [off, cmd] = await Promise.all([
          commands.settingsGet(disabledKey(info.language_id)),
          commands.settingsGet(commandKey(info.language_id)),
        ]);
        return {
          info,
          disabled: off.status === "ok" && off.data === "true",
          command: cmd.status === "ok" ? (cmd.data ?? "") : "",
        };
      }),
    );
    setRows(next);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 설정을 바꾸면 **이미 떠 있는 서버는 그대로다** — 끄기·경로 변경은 다음
   * 기동에만 적용된다. 조용히 어긋나게 두지 않고 그 자리에서 서버를 정리한다.
   */
  const writeAndRestart = useCallback(
    async (key: string, value: string) => {
      const res = await commands.settingsSet(key, value);
      if (res.status === "error") {
        toast.destructive(tError(res.error));
        return;
      }
      if (projectId != null) await commands.lspStop(projectId);
      await load();
    },
    [projectId, load],
  );

  return (
    <>
      <Section title={t("settings.code.editorTitle")} description={t("settings.code.editorDesc")}>
        <Toggle
          checked={settings.codeFormatOnSave}
          onChange={(v) => void set("codeFormatOnSave", v)}
          label={t("settings.code.formatOnSave")}
        />
        <p className="text-[11px] text-muted-foreground/80">
          {t("settings.code.formatOnSaveHint")}
        </p>
        <Field label={t("settings.code.tabSize")}>
          <Input
            type="number"
            min={1}
            max={16}
            value={settings.codeTabSize}
            onChange={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n)) void set("codeTabSize", Math.min(16, Math.max(1, n)));
            }}
            className="w-24 font-mono"
          />
        </Field>
        <Toggle
          checked={settings.codeInsertSpaces}
          onChange={(v) => void set("codeInsertSpaces", v)}
          label={t("settings.code.insertSpaces")}
        />
      </Section>

      <Section title={t("settings.code.lspTitle")} description={t("settings.code.lspDesc")}>
        {projectId == null ? (
          <p className="text-xs text-muted-foreground">{t("settings.code.lspNeedsProject")}</p>
        ) : rows == null ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <ServerRow
                key={row.info.language_id}
                row={row}
                onToggle={(next) =>
                  void writeAndRestart(disabledKey(row.info.language_id), next ? "false" : "true")
                }
                onCommand={(cmd) => void writeAndRestart(commandKey(row.info.language_id), cmd)}
              />
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground/80">{t("settings.code.noAutoInstall")}</p>
      </Section>
    </>
  );
}

function ServerRow({
  row,
  onToggle,
  onCommand,
}: {
  row: Row;
  onToggle: (enabled: boolean) => void;
  onCommand: (command: string) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(row.command);
  // 바깥에서 다시 읽어 왔으면(저장 후 reload) 그 값을 따른다.
  useEffect(() => setDraft(row.command), [row.command]);

  const { info } = row;
  const missing = info.state === "missing";

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{info.language_id}</span>
        <StateBadge state={info.state} disabled={row.disabled} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onToggle(row.disabled)}
          className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent/30 cursor-pointer"
        >
          {row.disabled ? t("settings.code.enable") : t("settings.code.disable")}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder={info.command}
          spellCheck={false}
          onChange={(e) => setDraft(e.currentTarget.value)}
          // Enter 또는 포커스 이탈에 저장한다 — 글자마다 저장하면 서버가
          // 한 글자 칠 때마다 재시작한다.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={() => draft !== row.command && onCommand(draft.trim())}
          className="font-mono text-xs"
        />
      </div>
      <p className="text-[11px] text-muted-foreground/80">
        {t("settings.code.commandHint", { command: info.command })}
      </p>

      {/* 미설치는 조용히 지나가지 않는다 — 설치 방법을 그 자리에 적는다.
          (자동 설치는 하지 않는 것이 이 앱의 결정이다.) */}
      {missing ? (
        <p className="text-[11px] text-muted-foreground">
          {t("settings.code.missing")}{" "}
          <code className="font-mono text-foreground/80">
            {INSTALL_HINT[info.language_id] ?? info.command}
          </code>
        </p>
      ) : null}
      {info.detail ? (
        <p className="text-[11px] text-muted-foreground/80">{info.detail}</p>
      ) : null}
    </div>
  );
}

function StateBadge({ state, disabled }: { state: LspServerState; disabled: boolean }) {
  const { t } = useT();
  if (disabled) {
    return <Badge tone="muted">{t("settings.code.stateOff")}</Badge>;
  }
  switch (state) {
    case "ready":
      return <Badge tone="ok">{t("code.lsp.ready")}</Badge>;
    case "indexing":
      return <Badge tone="ok">{t("code.lsp.indexing")}</Badge>;
    case "starting":
      return <Badge tone="muted">{t("code.lsp.starting")}</Badge>;
    case "missing":
      return <Badge tone="warn">{t("code.lsp.missing")}</Badge>;
    case "failed":
      return <Badge tone="warn">{t("code.lsp.failed")}</Badge>;
    default:
      return <Badge tone="muted">{t("settings.code.stateIdle")}</Badge>;
  }
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "text-primary border-primary/40"
      : tone === "warn"
        ? "text-destructive border-destructive/40"
        : "text-muted-foreground border-border";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>{children}</span>
  );
}
