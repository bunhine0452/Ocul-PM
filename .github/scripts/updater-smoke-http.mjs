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
 *   node updater-smoke-http.mjs latest --out <latest.json> --platform windows|linux \
 *        --version <X.Y.Z> --base-url http://127.0.0.1:<n> --sig <.sig 파일> [--root <폴더>]
 *
 * latest.json 의 키·자산 이름은 릴리스가 쓰는 표(`release/latest-json.mjs` 의 NONMAC)에서
 * 그대로 가져온다 — 스모크가 보는 모양이 릴리스가 내는 모양이다. `--root` 를 주면 그 자산이
 * 서버 루트에 실제로 있는지, 그리고 그 키를 설치본(windows=nsis · linux=appimage)이 업데이터
 * 규칙(`pickUpdaterEntry`)으로 찾는지까지 확인한다. 서명은 `.sig` 파일 내용 그대로.
 * 의존성 0, Node 18+.
 */
import { createReadStream, appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { NONMAC, pickUpdaterEntry } from "./release/latest-json.mjs";

/** 스모크가 까는 설치 형식 — 업데이터가 이 형식의 키를 먼저 찾는다. */
const SMOKE_INSTALLER = { windows: "nsis", linux: "appimage" };

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
      platform: { type: "string" },
      version: { type: "string" },
      "base-url": { type: "string" },
      sig: { type: "string" },
      root: { type: "string" },
      notes: { type: "string" },
    },
  });
  for (const k of ["out", "platform", "version", "base-url", "sig"]) {
    if (!values[k]) throw new Error(`--${k} 가 없다`);
  }
  const spec = NONMAC[values.platform];
  if (!spec) throw new Error(`--platform 은 ${Object.keys(NONMAC).join("|")} 중 하나: ${values.platform}`);
  const asset = spec.asset(values.version);
  const url = `${values["base-url"].replace(/\/+$/, "")}/${asset}`;
  const signature = readFileSync(values.sig, "utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error(`${values.sig} 는 base64 한 덩어리가 아니다`);
  const platforms = {};
  for (const key of spec.keys) platforms[key] = { signature, url };
  if (values.root && !existsSync(join(values.root, asset))) {
    throw new Error(`서버 루트에 릴리스 이름의 자산이 없다: ${join(values.root, asset)}`);
  }
  const [os, installer] = [values.platform, SMOKE_INSTALLER[values.platform]];
  const picked = pickUpdaterEntry(platforms, { os, arch: "x86_64", installer });
  if (!picked) throw new Error(`${os} ${installer} 설치본이 찾을 키가 없다: ${spec.keys.join(",")}`);
  const doc = {
    version: values.version,
    notes: values.notes ?? `updater smoke — ${basename(values.sig)}`,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  };
  writeFileSync(values.out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `updater-smoke-http: ${values.out} ← version ${values.version} · 키 ${spec.keys.join(",")} (${installer} 설치본은 ${picked.target}) · 자산 ${asset} · 서명 ${basename(values.sig)}`,
  );
} else {
  console.error("사용법: updater-smoke-http.mjs serve|latest …");
  process.exit(2);
}
