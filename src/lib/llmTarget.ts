import { settingsApi } from "@/api/settings";

/** 못 읽은 키는 없는 키와 같다 — 결정적 폴백으로 간다. */
const read = (key: string) => settingsApi.get(key).catch(() => null);

/**
 * v2 U10 — 설정에서 기본 LLM provider/model 을 해석한다 (규칙:
 * default_provider → model_{provider} → default_model). 키가 없거나
 * 미설정이면 null — 호출부는 결정적 폴백
 * (`oculpm_generate_summary` 가 provider 없이도 동작)을 그대로 쓴다.
 */
export async function resolveLlmTarget(): Promise<{ provider: string; model: string } | null> {
  const provider = await read("default_provider");
  if (!provider) return null;
  const model = (await read(`model_${provider}`)) || (await read("default_model"));
  return model ? { provider, model } : null;
}
