// #notion-oauth — 2단계: Notion 이 돌려준 code 를 access token 으로 교환하고
// (client secret 은 여기 env 에만 있다), 사용자의 로컬 앱(127.0.0.1 루프백)
// 으로 302 한다. 이 함수는 토큰을 저장하지 않는다 — 교환·전달만.
//
// 필요 env: NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET

export default async function handler(
  req: { query: Record<string, string | string[] | undefined> },
  res: {
    redirect: (status: number, url: string) => void;
    status: (code: number) => { send: (body: string) => void };
  },
) {
  const fail = (msg: string) =>
    res
      .status(400)
      .send(
        `<html><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>Notion 연결 실패</h2><p>${msg}</p><p>ocul-pm 앱에서 다시 시도해 주세요.</p></body></html>`,
      );

  const code = String(req.query.code ?? "");
  const rawState = String(req.query.state ?? "");
  if (!code || !rawState) {
    fail("승인이 취소되었거나 응답이 올바르지 않습니다.");
    return;
  }
  let port = 0;
  let state = "";
  try {
    const parsed = JSON.parse(Buffer.from(rawState, "base64url").toString("utf8")) as {
      p: number;
      s: string;
    };
    port = parsed.p;
    state = parsed.s;
  } catch {
    fail("state 해석 실패.");
    return;
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[0-9a-f]{16,64}$/.test(state)) {
    fail("state 형식 오류.");
    return;
  }

  const id = process.env.NOTION_OAUTH_CLIENT_ID;
  const secret = process.env.NOTION_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    res.status(500).send("OAuth env not configured");
    return;
  }
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://oculpm.com/api/notion/oauth/callback",
    }),
  });
  if (!r.ok) {
    fail(`토큰 교환 실패 (HTTP ${r.status}).`);
    return;
  }
  const data = (await r.json()) as { access_token?: string };
  if (!data.access_token) {
    fail("응답에 토큰이 없습니다.");
    return;
  }
  // 로컬 앱으로 전달 — 루프백(127.0.0.1)이라 기기 밖으로 나가지 않는다.
  res.redirect(
    302,
    `http://127.0.0.1:${port}/oculpm/notion?token=${encodeURIComponent(data.access_token)}&state=${state}`,
  );
}
