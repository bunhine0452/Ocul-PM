// #notion-oauth — 2단계: Notion 이 돌려준 code 를 사용자의 로컬 앱(127.0.0.1 루프백)
// 으로 302 한다. 이 함수는 토큰을 저장하지 않는다.
//
// 앱에는 **code 만** 넘긴다. 앱이 `exchange` 로 POST 해 토큰을 응답
// 본문으로 받는다. 예전처럼 토큰을 `?token=` 에 실어 리다이렉트하면 그 URL 이 브라우저
// 기록(과 동기화)에 남는다 (2026-10-07 외부 보안 피드백). code 는 한 번 쓰면 끝이고
// client secret 없이는 바꿀 수 없다. 옛 앱(3.8.0 미만)의 서버 교환 분기는 `start` 가 flow=code
// 없는 시작을 거절하면서 없어졌다.
//
// 이 함수는 env 가 필요 없다 (client secret 은 `exchange` 에만 있다).

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

  // 로컬 앱으로 전달 — 루프백(127.0.0.1)이라 기기 밖으로 나가지 않는다.
  res.redirect(
    302,
    `http://127.0.0.1:${port}/oculpm/notion?code=${encodeURIComponent(code)}&state=${state}`,
  );
}
