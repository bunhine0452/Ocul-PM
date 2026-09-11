// 모델 id 입력 + 프로바이더의 실제 목록 (감사 라운드 2026-09-11 B2).
//
// 예전엔 모델 id 를 외워 쳤고, placeholder 는 구세대 모델을 예로 들었다.
// 이제 칸에 초점이 오면 `llm_list_models` 로 **그 키가 쓸 수 있는 목록**을
// 한 번 받아 `<datalist>` 로 띄운다 — 네이티브 자동완성이라 새 컴포넌트가
// 아니고, 타이핑도 그대로 된다. 키가 없거나 실패하면 목록 없이 칸만 남고
// 이유를 한 줄로 적는다. 프로바이더별로 한 번만 부른다.

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { llmApi } from "@/api/llm";
import { toAppError } from "@/api/invoke";
import type { ModelInfo } from "@/lib/bindings";
import type { Provider } from "@/lib/settings";

type Fetch = { state: "idle" } | { state: "loading" } | { state: "ok"; rows: ModelInfo[] } | { state: "error"; message: string };

const cache = new Map<Provider, ModelInfo[]>();

/** 테스트·키 교체 뒤에 목록을 다시 받게 한다. */
export function resetModelListCache(provider?: Provider): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

interface ModelInputProps {
  provider: Provider;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}

export function ModelInput({ provider, value, placeholder, onChange }: ModelInputProps) {
  const { t } = useT();
  const listId = useId();
  const [fetch, setFetch] = useState<Fetch>(() =>
    cache.has(provider) ? { state: "ok", rows: cache.get(provider)! } : { state: "idle" },
  );

  const load = async () => {
    if (fetch.state !== "idle") return;
    setFetch({ state: "loading" });
    try {
      const rows = await llmApi.listModels(provider);
      cache.set(provider, rows);
      setFetch({ state: "ok", rows });
    } catch (e) {
      const err = toAppError(e);
      setFetch({ state: "error", message: err.detail ?? err.code });
    }
  };

  const rows = fetch.state === "ok" ? fetch.rows : [];
  return (
    <div className="flex flex-col gap-1">
      <Input
        list={rows.length > 0 ? listId : undefined}
        placeholder={placeholder}
        value={value}
        onFocus={() => void load()}
        onChange={(e) => onChange(e.currentTarget.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {rows.length > 0 && (
        <datalist id={listId}>
          {rows.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label !== m.id ? m.label : undefined}
            </option>
          ))}
        </datalist>
      )}
      <span className="text-fs-1 text-muted-foreground min-h-[1em]" aria-live="polite">
        {fetch.state === "loading" && t("settings.models.listLoading")}
        {fetch.state === "ok" && t("settings.models.listReady", { n: rows.length })}
        {fetch.state === "error" && t("settings.models.listFailed", { error: fetch.message })}
      </span>
    </div>
  );
}
