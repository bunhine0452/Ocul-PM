// #notion-oauth — 데스크톱 앱의 "Notion 계정 연결" 1단계.
// 앱이 루프백 포트·nonce 를 들고 여기로 오면, Notion authorize 로 302 한다.
// client_id 는 서버 env 에만 산다 (데스크톱에 시크릿/ID 를 심지 않는 이유).
//
// 필요 env: NOTION_OAUTH_CLIENT_ID
// 등록된 redirect URI: https://oculpm.com/api/notion/oauth/callback

export default function handler(
  req: { query: Record<string, string | string[] | undefined> },
  res: {
    redirect: (status: number, url: string) => void;
    status: (code: number) => { send: (body: string) => void };
  },
) {
  const port = Number(req.query.port);
  const state = String(req.query.state ?? "");
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[0-9a-f]{16,64}$/.test(state)) {
    res.status(400).send("invalid port/state");
    return;
  }
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("NOTION_OAUTH_CLIENT_ID not configured");
    return;
  }
  const u = new URL("https://api.notion.com/v1/oauth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("owner", "user");
  u.searchParams.set("redirect_uri", "https://oculpm.com/api/notion/oauth/callback");
  // 루프백 좌표를 state 에 실어 왕복한다 (서버는 무상태).
  u.searchParams.set("state", Buffer.from(JSON.stringify({ p: port, s: state })).toString("base64url"));
  res.redirect(302, u.toString());
}
