// HTTP-сервер для VPS: заменяет Cloudflare Workers + KV.
// Без зависимостей, нужен Node.js 18+. Данные хранятся в файле data/db.json.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import bot from "./bot.js";

// ---------- .env ----------
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {}
}
loadEnv(new URL("./.env", import.meta.url).pathname);

const { BOT_TOKEN, WEBHOOK_SECRET } = process.env;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const DATA_FILE = process.env.DATA_FILE || new URL("./data/db.json", import.meta.url).pathname;

if (!BOT_TOKEN || !WEBHOOK_SECRET) {
  console.error("Заполни BOT_TOKEN и WEBHOOK_SECRET в файле .env (см. .env.example)");
  process.exit(1);
}

// ---------- Замена Cloudflare KV: хранилище в памяти + сохранение в файл ----------
class FileKV {
  constructor(file) {
    this.file = file;
    this.data = new Map();
    this.exp = new Map();
    this.timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [k, v] of Object.entries(j.d || {})) this.data.set(k, v);
      for (const [k, v] of Object.entries(j.e || {})) this.exp.set(k, v);
    } catch {}
  }
  alive(k) {
    const e = this.exp.get(k);
    if (e && e < Date.now()) {
      this.data.delete(k);
      this.exp.delete(k);
      this.dirty();
      return false;
    }
    return this.data.has(k);
  }
  async get(k, type) {
    if (!this.alive(k)) return null;
    const v = this.data.get(k);
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(k, v, opts = {}) {
    this.data.set(k, String(v));
    if (opts.expirationTtl) this.exp.set(k, Date.now() + opts.expirationTtl * 1000);
    else this.exp.delete(k);
    this.dirty();
  }
  async delete(k) {
    this.data.delete(k);
    this.exp.delete(k);
    this.dirty();
  }
  async list({ prefix = "" } = {}) {
    const keys = [];
    for (const k of [...this.data.keys()].sort()) if (k.startsWith(prefix) && this.alive(k)) keys.push({ name: k });
    return { keys, list_complete: true };
  }
  dirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
  }
  flush() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ d: Object.fromEntries(this.data), e: Object.fromEntries(this.exp) }));
    fs.renameSync(tmp, this.file); // атомарная запись: файл не побьётся при падении
  }
}

const DB = new FileKV(DATA_FILE);
const env = { BOT_TOKEN, WEBHOOK_SECRET, ADMIN_USERNAME: process.env.ADMIN_USERNAME || "alvmv", ADMIN_ID: process.env.ADMIN_ID || "", DB };

// ---------- HTTP ----------
const pending = new Set();
const ctx = {
  waitUntil(p) {
    const t = Promise.resolve(p).catch(() => {});
    pending.add(t);
    t.finally(() => pending.delete(t));
  },
};

const MAX_BODY = 1024 * 1024;

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end("too large");
        return;
      }
      chunks.push(c);
    }
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    const init = { method: req.method, headers };
    if (!["GET", "HEAD"].includes(req.method) && body.length) init.body = body;
    const out = await bot.fetch(new Request(new URL(req.url, PUBLIC_URL), init), env, ctx);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end("server error");
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`Найди айфон: слушаю ${HOST}:${PORT}, адрес для Telegram: ${PUBLIC_URL}`);
  // вебхук и кнопка «Играть» ставятся сами (нужен HTTPS-адрес)
  if (PUBLIC_URL.startsWith("https://") && process.env.AUTO_SETUP !== "0") {
    try {
      const r = await bot.fetch(new Request(`${PUBLIC_URL}/setup?key=${encodeURIComponent(WEBHOOK_SECRET)}`), env, ctx);
      console.log("setup:", await r.text());
    } catch (e) {
      console.error("setup failed", e);
    }
  }
});

// ---------- Аккуратная остановка ----------
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 5000))]);
  DB.flush();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
