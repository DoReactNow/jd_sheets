// Serves public/editor/ on 127.0.0.1 for a standalone look at the built GridCraft editor.
// Not used by the app (Next.js serves /editor/ itself); only for the first look (W-002).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { ROOT } from "./lib/toolchain.mjs";

const DIR = path.join(ROOT, "public/editor");
const HOST = "127.0.0.1";
const PORT = Number(process.env.EDITOR_PREVIEW_PORT ?? 47325);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

if (!existsSync(path.join(DIR, "index.html"))) {
  console.error("public/editor is empty: run `npm run editor:build` first");
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(DIR, relative);
  if (!file.startsWith(DIR + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => console.log(`GridCraft preview: http://${HOST}:${PORT}/?sample=sales`));
