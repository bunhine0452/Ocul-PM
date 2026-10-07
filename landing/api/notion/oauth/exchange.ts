// #notion-oauth — 3단계(새 흐름): 앱이 루프백으로 받은 code 를 POST 하면 access token 을
// **응답 본문으로** 돌려준다. URL 에는 실리지 않는다 — 옛 흐름은 콜백이 토큰을
// `?token=` 에 실어 리다이렉트해서 브라우저 기록에 남았다 (2026-10-07 외부 보안 피드백).
// client secret 은 여기 env 에만 있고, 이 함수도 토큰을 저장하거나 기록하지 않는다.
//
// 필요 env: NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET

export default async function handler(
  req: { method?: string; body?: unknown },
  res: {
    setHeader: (name: string, value: string) => void;
    status: (code: number) => { json: (body: unknown) => void };
  },
) {
  // 토큰이 든 응답이다 — 어떤 캐시에도 남기지 않는다.
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  let body: unknown = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code.length === 0 || code.length > 512 || /\s/.test(code)) {
    res.status(400).json({ error: "invalid_code" });
    return;
  }

  const id = process.env.NOTION_OAUTH_CLIENT_ID;
  const secret = process.env.NOTION_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    res.status(503).json({ error: "not_configured" });
    return;
  }
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      // Notion 은 교환 때 authorize 의 redirect_uri 와 같은 값을 요구한다.
      redirect_uri: "https://oculpm.com/api/notion/oauth/callback",
    }),
  });
  if (!r.ok) {
    res.status(502).json({ error: "exchange_failed", status: r.status });
    return;
  }
  const data = (await r.json()) as { access_token?: string };
  if (!data.access_token) {
    res.status(502).json({ error: "no_token" });
    return;
  }
  res.status(200).json({ access_token: data.access_token });
}
