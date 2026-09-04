// LLM 탭 — 공급자·모델·키·폴백 체인.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { commands } from "@/lib/bindings";
import { KeyRound } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { coreModelTarget, DEFAULTS, PROVIDERS, providerModel, type Provider } from "@/lib/settings";
import { useReachability } from "../useReachability";
import { useT } from "@/i18n";
import { useSaveSetting } from "../saveSetting";
import { useDeferredCommit } from "../useDeferredCommit";
import { secretName, Section, Field, NumberSlider } from "./ui";

export function LlmTab({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const { settings } = useSettings();
  const save = useSaveSetting();
  // 생성 파라미터 슬라이더 둘 — 라벨이 초안을 읽으므로 드래그 중에도 숫자가
  // 즉시 따라오고, 디스크 쓰기만 손을 뗀 뒤 한 번이다 ({#settings-slider}).
  const temperature = useDeferredCommit(settings.temperature, (v) => save("temperature", v));
  const maxTokens = useDeferredCommit(settings.maxTokens, (v) => save("maxTokens", v));
  const [provider, setProvider] = useState<Provider>(settings.defaultProvider);
  // 오프라인 표시 (Phase 7) — 마지막 관측만 읽는다. 프로브를 쏘지 않으므로
  // 설정 화면을 여는 것만으로 네트워크가 나가지 않는다.
  const reach = useReachability();
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState<Record<Provider, boolean | null>>({
    anthropic: null,
    openai: null,
    gemini: null,
    nim: null,
    openrouter: null,
  });
  const [verifying, setVerifying] = useState(false);

  // Cached presence check — does NOT unlock the keychain.
  const refreshKeyStatus = async (p: Provider) => {
    const res = await commands.secretHas(secretName(p));
    if (res.status === "ok") {
      setHasKey((prev) => ({ ...prev, [p]: res.data }));
      onError(null);
    } else {
      onError(res.error);
    }
  };

  useEffect(() => {
    for (const p of PROVIDERS) refreshKeyStatus(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async () => {
    if (!apiKey) return;
    const res = await commands.secretSet(secretName(provider), apiKey);
    if (res.status === "ok") {
      setApiKey("");
      await refreshKeyStatus(provider);
    } else {
      onError(res.error);
    }
  };

  const clearKey = async () => {
    const res = await commands.secretDelete(secretName(provider));
    if (res.status === "ok") {
      await refreshKeyStatus(provider);
    } else {
      onError(res.error);
    }
  };

  // Force a real keychain read for every provider — prompts the user once.
  const verifyAll = async () => {
    setVerifying(true);
    try {
      for (const p of PROVIDERS) {
        const res = await commands.secretVerify(secretName(p));
        if (res.status === "ok") {
          setHasKey((prev) => ({ ...prev, [p]: res.data }));
        } else {
          onError(res.error);
        }
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <Section title={t("settings.keys.title")} description={t("settings.keys.desc")}>
        <select
          value={provider}
          onChange={(e) => setProvider(e.currentTarget.value as Provider)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p} {hasKey[p] === true ? t("settings.keys.saved") : hasKey[p] === false ? t("settings.keys.unset") : ""}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="w-3.5 h-3.5" />
          <span>
            {hasKey[provider] === null
              ? t("settings.keys.checking")
              : hasKey[provider]
              ? t("settings.keys.inKeychain")
              : t("settings.keys.noKey")}
          </span>
        </div>

        <Input
          type="password"
          placeholder={t("settings.keys.placeholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />

        <div className="flex gap-2">
          <Button
            onClick={saveKey}
            disabled={!apiKey}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("common.save")}
          </Button>
          <Button
            onClick={clearKey}
            disabled={!hasKey[provider]}
            variant="outline"
            className="flex-1"
          >
            {t("common.delete")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
          <span>
            {t("settings.keys.cacheNote")}
          </span>
          <button
            onClick={verifyAll}
            disabled={verifying}
            className="shrink-0 text-primary hover:underline disabled:opacity-50 cursor-pointer"
            title={t("settings.keys.verifyTitle")}
          >
            {verifying ? t("settings.keys.checking") : t("settings.keys.verify")}
          </button>
        </div>
      </Section>

      <Section title={t("settings.provider.title")} description={t("settings.provider.desc")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PROVIDERS.map((p) => {
            const isActive = settings.defaultProvider === p;
            // 못 닿아도 고를 수 있다 — 지금 못 닿는다는 것이 영원히 못 닿는다는
            // 뜻은 아니고, 설정은 사용자의 의도이지 네트워크의 상태가 아니다.
            const offline = reach.offline(p);
            return (
              <button
                key={p}
                onClick={() => save("defaultProvider", p)}
                title={
                  offline
                    ? `${t("llm.offline.hint")}${reach.detail(p) ? ` (${reach.detail(p)})` : ""}`
                    : undefined
                }
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all cursor-pointer capitalize ${
                  isActive
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-background border-border hover:border-primary/45 text-muted-foreground hover:text-foreground"
                } ${offline ? "opacity-60" : ""}`}
              >
                {p}
                {offline && (
                  <span className="block text-[10px] font-normal normal-case opacity-80">
                    {t("llm.offline.badge")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t("settings.models.title")} description={t("settings.models.desc")}>
        <Field label="Anthropic">
          <Input
            placeholder="claude-sonnet-4-6"
            value={settings.modelAnthropic}
            onChange={(e) => save("modelAnthropic", e.currentTarget.value)}
          />
        </Field>
        <Field label="OpenAI">
          <Input
            placeholder="gpt-4o-mini"
            value={settings.modelOpenai}
            onChange={(e) => save("modelOpenai", e.currentTarget.value)}
          />
        </Field>
        <Field label="Gemini">
          <Input
            placeholder="gemini-2.5-flash"
            value={settings.modelGemini}
            onChange={(e) => save("modelGemini", e.currentTarget.value)}
          />
        </Field>
        <Field label="NVIDIA NIM" hint={t("settings.models.nimHint")}>
          <Input
            placeholder="meta/llama-3.3-70b-instruct"
            value={settings.modelNim}
            onChange={(e) => save("modelNim", e.currentTarget.value)}
          />
        </Field>
        <Field label="OpenRouter" hint={t("settings.models.openrouterHint")}>
          <Input
            placeholder="openai/gpt-4o-mini"
            value={settings.modelOpenrouter}
            onChange={(e) => save("modelOpenrouter", e.currentTarget.value)}
          />
        </Field>
        <Field label={t("settings.models.fallbackDefault")}>
          <Input
            placeholder="claude-opus-4-7"
            value={settings.defaultModel}
            onChange={(e) => save("defaultModel", e.currentTarget.value)}
          />
        </Field>
      </Section>

      {/* 배경 작업 모델 (Osaurus 라운드 D2). 대화 모델과 의도적으로 분리한다 —
          자동 화해·일지 초안·스케줄·감시가 배경에서 조용히, 자주, 과금되며 돈다.
          미설정이면 그 작업들은 오류가 아니라 **조용히 건너뛴다**. */}
      <Section title={t("settings.coreModel.title")} description={t("settings.coreModel.desc")}>
        <Field label={t("settings.coreModel.provider")}>
          <select
            value={settings.coreProvider}
            onChange={(e) => save("coreProvider", e.currentTarget.value as Provider | "")}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t("settings.coreModel.unset")}</option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("settings.coreModel.model")} hint={t("settings.coreModel.hint")}>
          <Input
            placeholder={DEFAULTS.modelAnthropic}
            value={settings.coreModel}
            onChange={(e) => save("coreModel", e.currentTarget.value)}
          />
        </Field>
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>
            {coreModelTarget(settings)
              ? t("settings.coreModel.ready")
              : t("settings.coreModel.gate")}
          </span>
          <button
            onClick={() => {
              save("coreProvider", settings.defaultProvider);
              save("coreModel", providerModel(settings, settings.defaultProvider));
            }}
            className="shrink-0 text-primary hover:underline cursor-pointer"
          >
            {t("settings.coreModel.copyFromChat")}
          </button>
        </div>
      </Section>

      <Section
        title={t("settings.fallback.title")}
        description={t("settings.fallback.desc")}
      >
        <Field label={t("settings.fallback.field")} hint={t("settings.fallback.hint")}>
          <textarea
            value={settings.fallbackModels}
            onChange={(e) => save("fallbackModels", e.currentTarget.value)}
            placeholder={"openai:gpt-4o-mini\nanthropic:claude-3.5-haiku-latest"}
            rows={3}
            spellCheck={false}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
      </Section>

      <Section title={t("settings.gen.title")} description={t("settings.gen.desc")}>
        <Field label={t("settings.gen.temperature", { value: temperature.value.toFixed(2) })} hint={t("settings.gen.temperatureHint")}>
          <NumberSlider
            ariaLabel={t("settings.gen.temperature", { value: temperature.value.toFixed(2) })}
            value={temperature.value}
            min={0}
            max={1}
            step={0.05}
            onChange={temperature.change}
            onCommit={temperature.flush}
          />
        </Field>
        <Field label={t("settings.gen.maxTokens", { value: maxTokens.value })}>
          <NumberSlider
            ariaLabel={t("settings.gen.maxTokens", { value: maxTokens.value })}
            value={maxTokens.value}
            min={256}
            max={32768}
            step={256}
            onChange={maxTokens.change}
            onCommit={maxTokens.flush}
          />
        </Field>
        <Field label={t("settings.gen.systemPrompt")} hint={t("settings.gen.systemPromptHint")}>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => save("systemPrompt", e.currentTarget.value)}
            placeholder={t("settings.gen.systemPromptPlaceholder")}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
      </Section>
    </>
  );
}
