#!/usr/bin/env node
/**
 * 업데이터 스모크의 로컬 업데이트 서버 (크로스플랫폼 L-UPD `#w3-updater-smoke`).
 *
 * 스모크 판(portability.yml bundle 잡이 `--config` 로 굽는 N)은 업데이터 엔드포인트가
 * `http://127.0.0.1:<port>/latest.json` 이고 공개 키가 그 잡의 일회용 키다. 이 서버가 그
 * 자리에서 latest.json 과 새 판(N+1 = 릴리스와 같은 설정의 설치 파일)을 내준다. 요청마다
 * 한 줄(JSON)을 접근 로그에 남긴다 — 스모크는 그 로그로 「앱이 물었다 · 받았다 · 안
 * 물었다(deb)」 를 판정한다.
 *
 *   node updater-smoke-http.mjs serve  --root <폴더> --port <n> --log <접근 로그>
 *   node updater-smoke-http.mjs latest --out <latest.json> --version <X.Y.Z> \
 *        --url <설치 파일 URL> --sig <.sig 파일> --keys <키,키>
 *
 * latest.json 모양은 릴리스(`.github/scripts/release/latest-json.mjs`)와 같다 —
 * `platforms.<키>.{url, signature}`, 서명은 `.sig` 파일 내용 그대로(base64 한 덩어리).
 * 의존성 0, Node 18+.
 */
import { createReadStream, appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "serve") {
  const { values } = parseArgs({
    args: rest,
    options: { root: { type: "string" }, port: { type: "string" }, log: { type: "string" } },
  });
  const root = resolve(values.root ?? ".");
  const port = Number(values.port);
  const log = resolve(values.log ?? "access.log");
  if (!Number.isInteger(port) || port <= 0) throw new Error(`--port 가 이상하다: ${values.port}`);

  const server = createServer((req, res) => {
    const started = Date.now();
    const name = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
    const path = resolve(join(root, name));
    let status = 404;
    let bytes = 0;
    const done = () =>
      appendFileSync(
        log,
        `${JSON.stringify({
          t: new Date(started).toISOString(),
          method: req.method,
          path: `/${name}`,
          status,
          bytes,
          ms: Date.now() - started,
          ua: req.headers["user-agent"] ?? "",
        })}\n`,
      );
    // 루트 밖으로 못 나간다.
    if (!name || (path !== root && !path.startsWith(root + sep))) {
      res.writeHead(404).end();
      done();
      return;
    }
    let size;
    try {
      const st = statSync(path);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch {
      res.writeHead(404).end();
      done();
      return;
    }
    status = 200;
    const type = name.endsWith(".json") ? "application/json" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Cache-Control": "no-store" });
    if (req.method === "HEAD") {
      res.end();
      done();
      return;
    }
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
    });
    stream.on("error", () => res.destroy());
    res.on("close", done);
    stream.pipe(res);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`updater-smoke-http: listening http://127.0.0.1:${port}/ root=${root} log=${log}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} else if (cmd === "latest") {
  const { values } = parseArgs({
    args: rest,
    options: {
      out: { type: "string" },
      version: { type: "string" },
      url: { type: "string" },
      sig: { type: "string" },
      keys: { type: "string" },
      notes: { type: "string" },
    },
  });
  for (const k of ["out", "version", "url", "sig", "keys"]) {
    if (!values[k]) throw new Error(`--${k} 가 없다`);
  }
  const signature = readFileSync(values.sig, "utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error(`${values.sig} 는 base64 한 덩어리가 아니다`);
  const platforms = {};
  for (const key of values.keys.split(",").map((s) => s.trim()).filter(Boolean)) {
    platforms[key] = { signature, url: values.url };
  }
  const doc = {
    version: values.version,
    notes: values.notes ?? `updater smoke — ${basename(values.sig)}`,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  };
  writeFileSync(values.out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`updater-smoke-http: ${values.out} ← version ${values.version} · 서명 ${basename(values.sig)} · 키 ${Object.keys(platforms).join(",")}`);
} else {
  console.error("사용법: updater-smoke-http.mjs serve|latest …");
  process.exit(2);
}
