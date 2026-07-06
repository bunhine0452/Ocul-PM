import { commands } from "@/lib/bindings";

/**
 * v2 U10 — 설정에서 기본 LLM provider/model 을 해석한다 (RetroScreenV2 의
 * generate 경로와 동일 규칙: default_provider → model_{provider} →
 * default_model). 키가 없거나 미설정이면 null — 호출부는 결정적 폴백
 * (`oculpm_generate_summary` 가 provider 없이도 동작)을 그대로 쓴다.
 */
export async function resolveLlmTarget(): Promise<{ provider: string; model: string } | null> {
  const provR = await commands.settingsGet("default_provider");
  const provider = provR.status === "ok" ? provR.data : null;
  if (!provider) return null;
  const mR = await commands.settingsGet(`model_${provider}`);
  let model = mR.status === "ok" ? mR.data : null;
  if (!model) {
    const dm = await commands.settingsGet("default_model");
    model = dm.status === "ok" ? dm.data : null;
  }
  return model ? { provider, model } : null;
}
