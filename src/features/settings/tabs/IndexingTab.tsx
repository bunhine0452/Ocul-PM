// 인덱싱 탭 — 임베딩·청킹·자동 색인 설정.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { commands, type IndexProgress } from "@/lib/bindings";
import { RefreshCw } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { useSaveSetting } from "../saveSetting";
import { useDeferredCommit } from "../useDeferredCommit";
import { Section, Field, Toggle, NumberSlider } from "./ui";

export function IndexingTab() {
  const { t } = useT();
  const { settings } = useSettings();
  const save = useSaveSetting();
  // 슬라이더 넷 — 드래그 중에는 라벨까지 초안이 끌고 가고, SQLite 쓰기와 창
  // 브로드캐스트는 손을 뗀 뒤 한 번이다 (v2.42.0 `{#settings-slider}`).
  const chunkSize = useDeferredCommit(settings.chunkSize, (v) => save("chunkSize", v));
  const chunkOverlap = useDeferredCommit(settings.chunkOverlap, (v) => save("chunkOverlap", v));
  const topK = useDeferredCommit(settings.ragTopK, (v) => save("ragTopK", v));
  const ctxEntries = useDeferredCommit(settings.oculpmContextEntries, (v) =>
    save("oculpmContextEntries", v),
  );
  const maxKb = useDeferredCommit(settings.maxFileSizeKb, (v) => save("maxFileSizeKb", v));
  // 런처 창에는 워크스페이스가 없다 (멀티 창 I2) — 재색인 버튼은 프로젝트
  // 창에서만 활성화된다.
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const [reindexing, setReindexing] = useState(false);

  const reindex = async () => {
    if (projectId == null || reindexing) return;
    setReindexing(true);
    // 재구축은 이름 그대로 처음부터다. 색인은 blake3 해시 게이트라 비우지 않으면
    // 오염된 행(벤더 디렉터리·minified 청크)이 규칙을 고쳐도 그대로 남는다
    // (improvement-audit-round D1). 그전엔 이 버튼이 증분 색인을 돌리면서
    // "처음부터" 라고 적혀 있었다.
    const cleared = await commands.clearProjectIndex(projectId);
    if (cleared.status === "error") {
      setReindexing(false);
      toast.destructive(t("settings.index.reindexFailed", { error: cleared.error }));
      return;
    }
    const channel = new Channel<IndexProgress>();
    const res = await commands.indexProject(projectId, channel);
    setReindexing(false);
    if (res.status === "ok") toast.info(t("settings.index.reindexDone"));
    else toast.destructive(t("settings.index.reindexFailed", { error: res.error }));
  };

  return (
    <>
      <Section
        title={t("settings.index.title")}
        description={t("settings.index.desc")}
      >
        <Toggle
          checked={settings.autoIndex}
          onChange={(v) => save("autoIndex", v)}
          label={t("settings.index.auto")}
        />
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={reindex}
            disabled={projectId == null || reindexing}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? "animate-spin" : ""}`} />
            {reindexing ? t("settings.index.rebuilding") : t("settings.index.rebuild")}
          </Button>
          {projectId == null ? (
            <span className="text-[11px] text-muted-foreground">{t("settings.index.pickProject")}</span>
          ) : null}
        </div>
      </Section>

      <Section
        title={t("settings.chunk.title")}
        description={t("settings.chunk.desc")}
      >
        <Field label={t("settings.chunk.size", { n: chunkSize.value })}>
          <NumberSlider
            ariaLabel={t("settings.chunk.size", { n: chunkSize.value })}
            value={chunkSize.value}
            min={5}
            max={120}
            onChange={chunkSize.change}
            onCommit={chunkSize.flush}
          />
        </Field>
        <Field label={t("settings.chunk.overlap", { n: chunkOverlap.value })} hint={t("settings.chunk.overlapHint")}>
          <NumberSlider
            ariaLabel={t("settings.chunk.overlap", { n: chunkOverlap.value })}
            value={chunkOverlap.value}
            min={0}
            max={Math.max(0, chunkSize.value - 1)}
            onChange={chunkOverlap.change}
            onCommit={chunkOverlap.flush}
          />
        </Field>
      </Section>

      <Section title={t("settings.retrieval.title")} description={t("settings.retrieval.desc")}>
        <Field label={t("settings.retrieval.topK", { n: topK.value })}>
          <NumberSlider
            ariaLabel={t("settings.retrieval.topK", { n: topK.value })}
            value={topK.value}
            min={0}
            max={20}
            onChange={topK.change}
            onCommit={topK.flush}
          />
        </Field>
      </Section>

      <Section
        title={t("settings.aiContext.title")}
        description={t("settings.aiContext.desc")}
      >
        <Toggle
          checked={settings.includeOculpmContext}
          onChange={(v) => save("includeOculpmContext", v)}
          label={t("settings.aiContext.inject")}
        />
        {settings.includeOculpmContext && (
          <Field
            label={t("settings.aiContext.entries", { n: ctxEntries.value })}
            hint={t("settings.aiContext.entriesHint")}
          >
            <NumberSlider
              ariaLabel={t("settings.aiContext.entries", { n: ctxEntries.value })}
              value={ctxEntries.value}
              min={0}
              max={15}
              onChange={ctxEntries.change}
              onCommit={ctxEntries.flush}
            />
          </Field>
        )}
      </Section>

      <Section title={t("settings.scan.title")} description={t("settings.scan.desc")}>
        <Field label={t("settings.scan.maxSize", { n: maxKb.value })} hint={t("settings.scan.maxSizeHint")}>
          <NumberSlider
            ariaLabel={t("settings.scan.maxSize", { n: maxKb.value })}
            value={maxKb.value}
            min={50}
            max={4096}
            step={50}
            onChange={maxKb.change}
            onCommit={maxKb.flush}
          />
        </Field>
        <Field
          label={t("settings.scan.exclude")}
          hint={t("settings.scan.excludeHint")}
        >
          <textarea
            value={settings.excludePatterns}
            onChange={(e) => save("excludePatterns", e.currentTarget.value)}
            placeholder={"dist/**\n*.test.ts\nfixtures/**"}
            rows={5}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
        <p className="text-[11px] text-muted-foreground/80 italic">
          {t("settings.scan.applyNote")}
        </p>
      </Section>
    </>
  );
}
