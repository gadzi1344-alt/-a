// Telegram-бот "Найди айфон" v3 — версия для VPS (Node.js 18+, без зависимостей)
// Логика та же, что была в Cloudflare Worker. Запускается через server.js.
// Env: BOT_TOKEN, WEBHOOK_SECRET, (ADMIN_USERNAME, ADMIN_ID)

import { readFileSync, readdirSync } from "node:fs";

const APP_TEMPLATE = readFileSync(new URL("./app.html", import.meta.url), "utf8");

const START_COINS = 150000; // стартовый баланс
const SELL_RATE = 0.55; // продажа системе за 55% цены
const PAGE_SIZE = 8;

const BANK_RATE_PER_HOUR = 0.006; // 0.6% в час на вклад
const BANK_MAX_HOURS = 24; // проценты копятся максимум за 24 часа между заходами
const CRYPTO_FEE = 0.02; // комиссия 2% при покупке и продаже крипты
const MARKET_FEE = 0.05; // комиссия маркета 5% с продавца
const MARKET_MAX_PRICE = 10000000;
const SPIN_COST = 6300; // цена ОДНОЙ крутки; x1 / x5 / x10 = цена × количество
const MULTS = [1, 5, 10];
const ADMIN_MAX_SPIN = 500; // админ может крутить сколько угодно, но не больше этого за раз
const SAFE_SIZE = 10; // сейф: сколько вещей можно положить
const SPEEDS = [1, 5, 10]; // скорость анимации: x1 / x5 / x10

// Рефералы: ссылка t.me/<бот>?start=ref_<id>
const REF_INVITER = 40000; // тому, кто пригласил
const REF_NEW = 25000; // новому игроку
const REF_MAX = 100; // за сколько друзей максимум платим бонус

// Ежедневный бонус: растёт с каждым днём подряд до 7-го
const DAILY_BASE = 10000;
const DAILY_STEP = 3000;
const DAILY_MAX_STREAK = 7;
const DAILY_CD = 20 * 3600 * 1000; // можно брать раз в 20 часов
const DAILY_KEEP = 48 * 3600 * 1000; // серия сгорает, если пропустить больше 48 часов

// Покупка рублей за Telegram Stars (XTR): [id, звёзд, рублей]
const PACKS = [
  ["p1", 25, 40000],
  ["p2", 50, 90000],
  ["p3", 100, 200000],
  ["p4", 250, 550000],
  ["p5", 500, 1200000],
  ["p6", 1000, 2600000],
].map(([id, stars, coins]) => ({ id, stars, coins }));
const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));
const PACK_RE = /^pack:(\w+):(\d+)$/;
const botName = (env) => env.BOT_USERNAME || "iPhonesAppBot";
const pctText = (x) => String(Math.round(x * 10000) / 100).replace(".", ",");

const DEFAULT_ADMIN = "alvmv";

// [id, название, цена, шанс]
const PHONES = [
  ["4", "iPhone 4", 1000, 30],
  ["4s", "iPhone 4S", 1500, 26],
  ["5", "iPhone 5", 2200, 22],
  ["5c", "iPhone 5C", 2000, 22],
  ["5s", "iPhone 5S", 3000, 18],
  ["6", "iPhone 6", 4200, 15],
  ["6p", "iPhone 6 Plus", 4800, 14],
  ["6s", "iPhone 6S", 5500, 12],
  ["6sp", "iPhone 6S Plus", 6200, 11],
  ["se1", "iPhone SE (2016)", 4000, 14],
  ["7", "iPhone 7", 7500, 10],
  ["7p", "iPhone 7 Plus", 8500, 9],
  ["8", "iPhone 8", 9500, 8],
  ["8p", "iPhone 8 Plus", 10500, 7.5],
  ["x", "iPhone X", 13000, 6],
  ["xr", "iPhone XR", 13500, 6],
  ["xs", "iPhone XS", 15000, 5.5],
  ["xsm", "iPhone XS Max", 17000, 5],
  ["11", "iPhone 11", 17000, 5],
  ["11p", "iPhone 11 Pro", 20000, 4.2],
  ["11pm", "iPhone 11 Pro Max", 22000, 4],
  ["12m", "iPhone 12 mini", 21000, 4],
  ["12", "iPhone 12", 23000, 4],
  ["12p", "iPhone 12 Pro", 27000, 3.2],
  ["12pm", "iPhone 12 Pro Max", 30000, 3],
  ["13m", "iPhone 13 mini", 28000, 3],
  ["13", "iPhone 13", 30000, 3],
  ["13p", "iPhone 13 Pro", 36000, 2.5],
  ["13pm", "iPhone 13 Pro Max", 40000, 1.3],
  ["14", "iPhone 14", 40000, 1.3],
  ["14pl", "iPhone 14 Plus", 43000, 1.2],
  ["14p", "iPhone 14 Pro", 50000, 1],
  ["14pm", "iPhone 14 Pro Max", 55000, 0.9],
  ["15", "iPhone 15", 55000, 0.9],
  ["15pl", "iPhone 15 Plus", 59000, 0.85],
  ["15p", "iPhone 15 Pro", 70000, 0.65],
  ["15pm", "iPhone 15 Pro Max", 78000, 0.6],
  ["16", "iPhone 16", 75000, 0.6],
  ["16pl", "iPhone 16 Plus", 80000, 0.55],
  ["16p", "iPhone 16 Pro", 95000, 0.4],
  ["16pm", "iPhone 16 Pro Max", 105000, 0.12],
  ["17", "iPhone 17", 100000, 0.1],
  ["17air", "iPhone Air", 110000, 0.08],
  ["17p", "iPhone 17 Pro", 125000, 0.06],
  ["17pm", "iPhone 17 Pro Max", 140000, 0.04],
  ["18p", "iPhone 18 Pro", 180000, 0.02],
  ["18pm", "iPhone 18 Pro Max", 200000, 0.012],
  ["duo", "iPhone Duo", 2000000, 0.003, 50], // ЛИМИТКА: всего 50 штук в игре, выпадает только из крутки
].map(([id, name, price, weight, limit]) => ({ id, name, price, weight, limit: limit || 0 }));

const BY_ID = Object.fromEntries(PHONES.map((p) => [p.id, p]));

// Аксессуары: продаются только в магазине (не выпадают при поиске).
const ACCESSORIES = [
  ["acc_pitaka", "PITAKA", 100000],
  ["acc_apmax", "AirPods Max", 80000],
].map(([id, name, price]) => ({ id, name, price, acc: true }));

const ITEMS = [...PHONES, ...ACCESSORIES];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((p) => [p.id, p]));
const sellPrice = (p) => Math.floor(p.price * SELL_RATE);

// редкость определяется ценой
const rarityOf = (p) => (p.limit ? "lim" : p.price >= 180000 ? "myth" : p.price >= 100000 ? "leg" : p.price >= 40000 ? "epi" : p.price >= 10000 ? "rar" : "com");
const RAR_ICON = { lim: "🔥", myth: "💎", leg: "🟡", epi: "🟣", rar: "🔵", com: "⚪" };
const RAR_TAG = { lim: " — ЛИМИТКА!", myth: " — МИФИК!", leg: " — ЛЕГЕНДА!", epi: " — эпик", rar: "", com: "" };
const pct = (x) => (x * 100).toFixed(x < 0.0001 ? 5 : x < 0.01 ? 3 : x < 0.1 ? 2 : 1) + "%";
const TIER_BOOST = { com: 1, rar: 1, epi: 2.5, leg: 3.5, myth: 5 };
const ADMIN_LUCK = { epi: 2, leg: 3, myth: 4 };
const effWeight = (p) => p.weight * (TIER_BOOST[rarityOf(p)] || 1);
function spinOdds() {
  const total = PHONES.reduce((s, p) => s + effWeight(p), 0);
  const share = (k) => PHONES.filter((p) => rarityOf(p) === k).reduce((s, p) => s + effWeight(p), 0) / total;
  return { myth: share("myth"), leg: share("leg"), lim: share("lim"), epi: share("epi") };
}

// Крипта: цена считается по времени (меняется каждые 5 минут)
const CRYPTO = {
  BTC: { name: "Bitcoin", base: 50000, amp: 0.35, k1: 7, k2: 19, ph: 0.0 },
  ETH: { name: "Ethereum", base: 8000, amp: 0.4, k1: 5, k2: 13, ph: 1.7 },
  TON: { name: "Toncoin", base: 500, amp: 0.5, k1: 4, k2: 11, ph: 3.1 },
};
const BUCKET_MS = 5 * 60 * 1000;
function cryptoPrice(sym, now = Date.now()) {
  const c = CRYPTO[sym];
  const b = Math.floor(now / BUCKET_MS);
  const f = (Math.sin(b / c.k1 + c.ph) + 0.6 * Math.sin(b / c.k2 + c.ph * 2)) / 1.6;
  return Math.max(1, Math.round(c.base * (1 + c.amp * f) * 100) / 100);
}

const BTN_FIND = "🎰 Крутить";
const BTN_INV = "🎒 Инвентарь";
const BTN_SHOP = "🏪 Магазин";
const BTN_BANK = "🏦 Банк";
const BTN_MARKET = "🛒 Авито";
const BTN_ADMIN = "👑 Админ-панель";
let ORIGIN = ""; // адрес сервера, подставляется из запроса
const MENU_BUTTONS = [BTN_FIND, BTN_INV, BTN_SHOP, BTN_BANK, BTN_MARKET, BTN_ADMIN];

const BACK = { text: "⬅️ Назад", callback_data: "menu" };
const num = (n) => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// ---------- Админ ----------
const isAdmin = (env, from) =>
  (from.username || "").toLowerCase() === String(env.ADMIN_USERNAME || DEFAULT_ADMIN).replace(/^@/, "").toLowerCase() ||
  (env.ADMIN_ID && String(from.id) === String(env.ADMIN_ID));

function mainKeyboard(admin) {
  const rows = [
    [{ text: BTN_FIND }],
    [{ text: BTN_INV }, { text: BTN_SHOP }],
    [{ text: BTN_BANK }, { text: BTN_MARKET }],
  ];
  if (admin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

// ---------- Telegram ----------
async function tg(env, method, body = {}) {
  // в боте нет кнопок: игра открывается только через меню «Играть»
  if (method === "editMessageReplyMarkup") return { ok: true };
  if (method.startsWith("edit")) delete body.reply_markup;
  if (method === "sendMessage") body.reply_markup = { remove_keyboard: true };
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ---------- Хранилище ----------
async function getUser(env, id) {
  const u = (await env.DB.get(`u:${id}`, "json")) || { coins: START_COINS, inv: {}, last: 0 };
  u.inv ||= {};
  u.bank ||= 0;
  u.bt ||= 0;
  u.crypto ||= {};
  u.safe ||= {};
  return u;
}
const saveUser = (env, id, u) => env.DB.put(`u:${id}`, JSON.stringify(u));

async function syncName(env, from, u) {
  const un = (from.username || "").toLowerCase();
  if (un && u.un !== un) {
    u.un = un;
    await env.DB.put(`n:${un}`, String(from.id));
    return true;
  }
  return false;
}

async function countUsers(env) {
  let n = 0;
  let cursor;
  do {
    const r = await env.DB.list({ prefix: "u:", cursor });
    n += r.keys.length;
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return n;
}

async function resolveTarget(env, arg) {
  if (!arg) return null;
  if (arg.startsWith("@")) return await env.DB.get(`n:${arg.slice(1).toLowerCase()}`);
  if (/^\d+$/.test(arg)) return arg;
  return null;
}

// ---------- Игровая логика ----------
function randomPhone(noLimited = false, luck = null) {
  const pool = noLimited ? PHONES.filter((p) => !p.limit) : PHONES;
  const w = (p) => effWeight(p) * (luck ? luck[rarityOf(p)] || 1 : 1);
  const total = pool.reduce((s, p) => s + w(p), 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= w(p);
    if (r <= 0) return p;
  }
  return pool[0];
}

// ---------- Лимитированные телефоны ----------
const limUsed = async (env, p) => parseInt((await env.DB.get(`lim:${p.id}`)) || "0", 10) || 0;
async function mintLimited(env, p) {
  const n = await limUsed(env, p);
  if (n >= p.limit) return false;
  await env.DB.put(`lim:${p.id}`, String(n + 1));
  return true;
}

async function doSpin(env, u, count, admin = false) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const luck = admin ? ADMIN_LUCK : null;
    let p = randomPhone(false, luck);
    if (p.limit && !(await mintLimited(env, p))) p = randomPhone(true, luck);
    u.inv[p.id] = (u.inv[p.id] || 0) + 1;
    out.push(p);
  }
  return out;
}

function spinLines(list) {
  const c = new Map();
  for (const p of list) c.set(p, (c.get(p) || 0) + 1);
  return [...c]
    .map(([p, n]) => {
      const r = rarityOf(p);
      return `${RAR_ICON[r]} ${p.name}${n > 1 ? " × " + n : ""}${RAR_TAG[r]}`;
    })
    .join("\n");
}

const countItems = (list) => list.reduce((o, p) => ((o[p.id] = (o[p.id] || 0) + 1), o), {});

function spinSellSum(u) {
  let sum = 0;
  for (const [id, n] of Object.entries((u.spin && u.spin.items) || {})) {
    const p = BY_ID[id];
    if (p && !p.limit) sum += sellPrice(p) * Math.min(n, u.inv[id] || 0);
  }
  return sum;
}
function sellLastSpin(u) {
  let sum = 0;
  let cnt = 0;
  const keep = [];
  for (const [id, n] of Object.entries((u.spin && u.spin.items) || {})) {
    const p = BY_ID[id];
    if (!p) continue;
    if (p.limit) {
      keep.push(p.name);
      continue;
    }
    const k = Math.min(n, u.inv[id] || 0);
    if (k > 0) {
      u.inv[id] -= k;
      sum += sellPrice(p) * k;
      cnt += k;
    }
  }
  u.coins += sum;
  u.spin = null;
  return { sum, cnt, keep };
}

function canRescue(u) {
  const hasItems = Object.values(u.inv).some((n) => n > 0);
  const hasCrypto = Object.values(u.crypto).some((n) => n > 0);
  return u.coins < SPIN_COST && u.bank <= 0 && !hasItems && !hasCrypto && Date.now() - (u.rescueAt || 0) > 86400000;
}

async function spinView(env, u, admin, result = "") {
  const duo = PHONES.find((p) => p.limit);
  const left = duo ? duo.limit - (await limUsed(env, duo)) : 0;
  const mult = MULTS.includes(u.mult) ? u.mult : 1;
  const spd = SPEEDS.includes(u.spd) ? u.spd : 1;
  const cost = SPIN_COST * mult;
  const odds = spinOdds();
  const text =
    (result ? result + "\n\n" : "") +
    `🎰 Крутка\n\n` +
    `💎 Одна крутка — ${num(SPIN_COST)} ₽${admin ? " (у админа бесплатно)" : ""}\n` +
    `Выбрано: x${mult} — ${admin ? "бесплатно" : num(cost) + " ₽"}\n\n` +
    `Шансы: 🟣 эпик ${pct(odds.epi)} · 🟡 легенда ${pct(odds.leg)} · 💎 мифик ${pct(odds.myth)}\n` +
    (duo ? `🔥 Лимитка ${duo.name} (${num(duo.price)} ₽) — шанс ${pct(odds.lim)}, осталось ${left} из ${duo.limit}\n` : "") +
    `⚡ Скорость анимации: x${spd}\n` +
    `💰 Баланс: ${num(u.coins)} ₽`;
  const rows = [];
  const sum = result ? spinSellSum(u) : 0;
  if (sum > 0) rows.push([{ text: `💸 Продать всё выпавшее (+${num(sum)} ₽)`, callback_data: "spinsell" }]);
  rows.push(MULTS.map((m) => ({ text: m === mult ? `✅ x${m}` : `x${m}`, callback_data: `mult:${m}` })));
  rows.push(SPEEDS.map((s) => ({ text: (s === spd ? "✅ " : "") + `${s === 1 ? "🐢" : s === 5 ? "⚡" : "🚀"} x${s}`, callback_data: `spd:${s}` })));
  rows.push([{ text: `🎰 Крутить x${mult} — ${admin ? "бесплатно" : num(cost) + " ₽"}`, callback_data: `spin:${mult}` }]);
  rows.push([BACK]);
  return { text, markup: { inline_keyboard: rows } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speedOf = (u) => (SPEEDS.includes(u.spd) ? u.spd : 1);

const skipMarkup = (spd) => ({
  inline_keyboard: [
    [{ text: "⏩ Пропустить", callback_data: "skip" }],
    SPEEDS.map((s) => ({ text: (s === spd ? "✅ " : "") + `${s === 1 ? "🐢" : s === 5 ? "⚡" : "🚀"} x${s}`, callback_data: `spd:${s}` })),
  ],
});

async function animateSpin(env, chatId, messageId, userId, got) {
  let spd = 1;
  const edit = (text) =>
    tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: skipMarkup(spd) }).catch(() => {});
  const skipped = async () => !!(await env.DB.get(`skip:${userId}`));
  const wait = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await skipped()) return true;
      await sleep(Math.max(0, Math.min(250, end - Date.now())));
    }
    return false;
  };
  const pace = (ms) => Math.max(400, ms / spd);
  const spinner = ["◐", "◓", "◑", "◒"];
  const pool = PHONES.filter((p) => !p.limit);
  const rnd = () => pool[Math.floor(Math.random() * pool.length)].name;
  const rolls = got.length > 1 ? 4 : 3;
  for (let i = 0; i < rolls; i++) {
    spd = speedOf(await getUser(env, userId));
    if (await skipped()) return;
    await edit(`🎰 Крутим… ${spinner[i % 4]}\n\n📱 ${rnd()}\n📱 ${rnd()}\n📱 ${rnd()}`);
    if (await wait(pace(1200))) return;
  }
  const step = got.length > 5 ? 2 : 1;
  for (let i = step; i < got.length + step; i += step) {
    spd = speedOf(await getUser(env, userId));
    if (await skipped()) return;
    const k = Math.min(i, got.length);
    await edit(`🎰 Выпадает…\n\n${spinLines(got.slice(0, k))}${k < got.length ? "\n🎰 крутится…" : ""}`);
    if (await wait(pace(1100))) return;
  }
}

async function onSpin(env, cb, a) {
  const userId = cb.from.id;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const admin = isAdmin(env, cb.from);
  const answer = (text, alert = false) => tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });
  const u = await getUser(env, userId);
  const n = MULTS.includes(Number(a)) ? Number(a) : 1;
  const cost = SPIN_COST * n;
  let note = "";
  if (!admin && canRescue(u)) {
    u.coins = SPIN_COST;
    u.rescueAt = Date.now();
    note = "🎁 Ты на нуле, держи бесплатную крутку (раз в сутки)";
  }
  if (!admin && u.coins < cost) {
    if (note) await saveUser(env, userId, u);
    return answer(note ? `${note}. Выбери x1` : `Не хватает денег (нужно ${num(cost)} ₽)`, true);
  }
  if (!admin) u.coins -= cost;
  const got = await doSpin(env, u, n, admin);
  u.spin = { items: countItems(got), text: `🎉 Выпало (x${n}):\n${spinLines(got)}` };
  await saveUser(env, userId, u);
  await env.DB.delete(`skip:${userId}`);
  await answer(note);
  await animateSpin(env, chatId, messageId, userId, got);
  const u2 = await getUser(env, userId);
  const v = await spinView(env, u2, admin, u2.spin ? u2.spin.text : "");
  await tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: v.text, reply_markup: v.markup });
}

async function onSkip(env, cb) {
  const userId = cb.from.id;
  await Promise.all([
    env.DB.put(`skip:${userId}`, "1", { expirationTtl: 60 }),
    tg(env, "answerCallbackQuery", { callback_query_id: cb.id }),
  ]);
  const u = await getUser(env, userId);
  if (u.spin) {
    const v = await spinView(env, u, isAdmin(env, cb.from), u.spin.text);
    await tg(env, "editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: v.text, reply_markup: v.markup });
  }
}

async function onSpeed(env, cb, a) {
  const userId = cb.from.id;
  const u = await getUser(env, userId);
  u.spd = SPEEDS.includes(Number(a)) ? Number(a) : 1;
  await saveUser(env, userId, u);
  await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: `Скорость анимации: x${u.spd}` });
  const v = await spinView(env, u, isAdmin(env, cb.from), u.spin ? u.spin.text : "");
  await tg(env, "editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: v.markup }).catch(() => {});
}

async function onMult(env, cb, a) {
  const userId = cb.from.id;
  const u = await getUser(env, userId);
  u.mult = MULTS.includes(Number(a)) ? Number(a) : 1;
  await saveUser(env, userId, u);
  await tg(env, "answerCallbackQuery", { callback_query_id: cb.id });
  const v = await spinView(env, u, isAdmin(env, cb.from), u.spin ? u.spin.text : "");
  await tg(env, "editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: v.text, reply_markup: v.markup }).catch(() => {});
}

async function onSpinSell(env, cb) {
  const userId = cb.from.id;
  const u = await getUser(env, userId);
  const answer = (text) => tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text });
  if (!u.spin) return answer("Нечего продавать");
  const r = sellLastSpin(u);
  await saveUser(env, userId, u);
  await answer(r.cnt ? `+${num(r.sum)} ₽` : "Нечего продавать");
  const v = await spinView(
    env,
    u,
    isAdmin(env, cb.from),
    `💸 Продано ${r.cnt} шт.: +${num(r.sum)} ₽${r.keep.length ? `\n🔥 Оставил себе: ${r.keep.join(", ")}` : ""}`
  );
  await tg(env, "editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: v.text, reply_markup: v.markup });
}

// кнопка «Играть» рядом со скрепкой (для конкретного чата)
const setMenu = (env, chatId) =>
  ORIGIN
    ? tg(env, "setChatMenuButton", {
        chat_id: chatId,
        menu_button: { type: "web_app", text: "Играть", web_app: { url: ORIGIN + "/app" } },
      }).catch(() => {})
    : null;

// ---------- Банк: проценты ----------
function accrue(u) {
  const now = Date.now();
  const hours = Math.min(BANK_MAX_HOURS, Math.max(0, (now - (u.last || now)) / 3600000));
  if (u.bank > 0 && hours > 0) u.bank = Math.floor(u.bank * (1 + BANK_RATE_PER_HOUR * hours));
  u.last = now;
}

// ---------- Общие помощники для списков ----------
function pageOf(list, page) {
  const last = Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1);
  const p = Math.min(Math.max(0, page || 0), last);
  return { items: list.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE), page: p, last };
}
function navRow(prefix, pg) {
  const row = [];
  if (pg.page > 0) row.push({ text: "◀️", callback_data: `${prefix}:${pg.page - 1}` });
  row.push({ text: `${pg.page + 1}/${pg.last + 1}`, callback_data: "noop" });
  if (pg.page < pg.last) row.push({ text: "▶️", callback_data: `${prefix}:${pg.page + 1}` });
  return row;
}

// ---------- Инвентарь ----------
function inventoryHome(u) {
  const cnt = (acc) => (acc ? ACCESSORIES : PHONES).reduce((s, p) => s + (u.inv[p.id] || 0), 0);
  const worth = (acc) => (acc ? ACCESSORIES : PHONES).reduce((s, p) => s + sellPrice(p) * (u.inv[p.id] || 0), 0);
  return {
    text: `🎒 Инвентарь\n\n📱 Телефонов: ${cnt(false)} шт. (продажа ${num(worth(false))} ₽)\n🎧 Аксессуаров: ${cnt(true)} шт. (продажа ${num(worth(true))} ₽)\n\nВыбери раздел 👇`,
    markup: {
      inline_keyboard: [
        [{ text: "📱 Телефоны", callback_data: "inv:0" }, { text: "🎧 Аксессуары", callback_data: "inva:0" }],
        [BACK],
      ],
    },
  };
}

function inventoryView(u, page, tab) {
  const acc = tab === "a";
  const owned = (acc ? ACCESSORIES : PHONES).filter((p) => u.inv[p.id] > 0);
  const pg = pageOf(owned, page);
  const tot = owned.reduce((s, p) => s + sellPrice(p) * u.inv[p.id], 0);
  const text = `🎒 ${acc ? "Аксессуары" : "Телефоны"}\n` + (owned.length ? "Нажми на вещь, чтобы продать один экземпляр." : "Здесь пока пусто.");
  const rows = pg.items.map((p) => [
    { text: `Продать: ${p.name} × ${u.inv[p.id]} · ${num(sellPrice(p))} ₽`, callback_data: `sell:${p.id}:${pg.page}` },
  ]);
  if (owned.length) rows.push([{ text: `💸 Продать всё за ${num(tot)} ₽`, callback_data: `sellall:${acc ? "a" : "p"}` }]);
  if (owned.length > PAGE_SIZE) rows.push(navRow(acc ? "inva" : "inv", pg));
  rows.push([
    { text: "📱 Телефоны", callback_data: "inv:0" },
    { text: "🎧 Аксессуары", callback_data: "inva:0" },
  ]);
  rows.push([{ text: "⬅️ Назад", callback_data: "invhome" }]);
  return { text, markup: { inline_keyboard: rows } };
}

// ---------- Магазин ----------
function shopHome(u) {
  return {
    text: `🏪 Магазин\n\n💰 На руках: ${num(u.coins)} ₽\n\n📱 Телефоны — можно купить любой, кроме лимитки.\n🎧 Аксессуары — дорогие вещи, которых нет при крутке.\n\nВыбери раздел 👇`,
    markup: {
      inline_keyboard: [
        [{ text: "📱 Телефоны", callback_data: "shop:0" }, { text: "🎧 Аксессуары", callback_data: "shopa:0" }],
        [BACK],
      ],
    },
  };
}

function shopView(u, page, tab) {
  const acc = tab === "a";
  const items = acc ? ACCESSORIES : PHONES.filter((p) => !p.limit);
  const pg = pageOf(items, page);
  const text = `🏪 ${acc ? "Аксессуары" : "Телефоны"}\n💰 На руках: ${num(u.coins)} ₽`;
  const rows = pg.items.map((p) => [
    { text: `${p.name} · ${num(p.price)} ₽${u.coins < p.price ? " ✖" : ""}`, callback_data: `${acc ? "bua" : "buy"}:${p.id}:${pg.page}` },
  ]);
  if (items.length > PAGE_SIZE) rows.push(navRow(acc ? "shopa" : "shop", pg));
  rows.push([
    { text: "📱 Телефоны", callback_data: "shop:0" },
    { text: "🎧 Аксессуары", callback_data: "shopa:0" },
  ]);
  rows.push([{ text: "⬅️ Назад", callback_data: "shophome" }]);
  return { text, markup: { inline_keyboard: rows } };
}

// ---------- Банк ----------
function bankView(u) {
  const perHour = Math.floor(u.bank * BANK_RATE_PER_HOUR);
  const text =
    `🏦 Банк\n\n💰 На руках: ${num(u.coins)} ₽\n🏦 На счёте: ${num(u.bank)} ₽\n` +
    `📈 Доход: +${pctText(BANK_RATE_PER_HOUR)}% в час (≈ ${num(perHour)} ₽ в час)\n` +
    `Проценты копятся максимум за ${BANK_MAX_HOURS} ч между заходами.`;
  return {
    text,
    markup: {
      inline_keyboard: [
        [
          { text: "+1 000", callback_data: "dep:1000" },
          { text: "+10 000", callback_data: "dep:10000" },
          { text: "Внести всё", callback_data: "dep:all" },
        ],
        [
          { text: "−1 000", callback_data: "wd:1000" },
          { text: "−10 000", callback_data: "wd:10000" },
          { text: "Снять всё", callback_data: "wd:all" },
        ],
        [{ text: "💸 Перевод игроку", callback_data: "pay" }],
        [{ text: "🪙 Крипта", callback_data: "crypto" }],
        [BACK],
      ],
    },
  };
}

// ---------- Крипта ----------
function cryptoView(u) {
  const syms = Object.keys(CRYPTO);
  const lines = syms.map((s) => `${s} (${CRYPTO[s].name}): ${num(cryptoPrice(s))} ₽ · у тебя ${(u.crypto[s] || 0).toFixed(4)}`);
  const value = syms.reduce((s, k) => s + (u.crypto[k] || 0) * cryptoPrice(k), 0);
  const text =
    `🪙 Крипта (комиссия ${CRYPTO_FEE * 100}% при покупке и продаже)\n\n${lines.join("\n")}\n\n` +
    `≈ ${num(value)} ₽ в криптовалюте. Цена меняется каждые 5 минут.`;
  const rows = syms.map((s) => [
    { text: `Купить ${s} на 10 000`, callback_data: `cb:${s}:10000` },
    { text: `Продать ${s}`, callback_data: `cs:${s}` },
  ]);
  rows.push([{ text: "🏦 К банку", callback_data: "bank" }]);
  return { text, markup: { inline_keyboard: rows } };
}

// ---------- Авито ----------
async function loadListings(env) {
  const keys = [];
  let cursor;
  do {
    const r = await env.DB.list({ prefix: "m:", cursor });
    for (const k of r.keys) keys.push(k.name);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return keys.sort().reverse();
}

async function marketView(env, userId, page) {
  const keys = await loadListings(env);
  const lots = [];
  for (const key of keys) {
    const l = await env.DB.get(key, "json");
    if (l && BY_ID[l.p]) lots.push({ ...l, id: key.slice(2) });
  }
  const pg = pageOf(lots, page);
  let text = `🛒 Авито — лоты игроков\nКомиссия маркета ${MARKET_FEE * 100}% с продавца.`;
  if (!lots.length) text += "\n\nЛотов пока нет.";
  const rows = pg.items.map((l) => {
    const p = BY_ID[l.p];
    const own = String(l.s) === String(userId);
    return [
      own
        ? { text: `❌ Снять: ${p.name} · ${num(l.price)} ₽`, callback_data: `mc:${l.id}:${pg.page}` }
        : { text: `${p.name} · ${num(l.price)} ₽ (${l.sn ? "@" + l.sn : "игрок"})`, callback_data: `mb:${l.id}:${pg.page}` },
    ];
  });
  if (lots.length > PAGE_SIZE) rows.push(navRow("mk", pg));
  rows.push([{ text: "➕ Выставить телефон", callback_data: "mnew:0" }]);
  rows.push([BACK]);
  return { text, markup: { inline_keyboard: rows } };
}

function marketPickView(u, page) {
  const owned = PHONES.filter((p) => u.inv[p.id] > 0);
  const pg = pageOf(owned, page);
  let text = `➕ Выставить на Авито\nВыбери телефон. Комиссия маркета ${MARKET_FEE * 100}% с продавца, максимум ${num(MARKET_MAX_PRICE)} ₽.`;
  if (!owned.length) text += "\n\nУ тебя нет телефонов.";
  const rows = pg.items.map((p) => [{ text: `${p.name} × ${u.inv[p.id]}`, callback_data: `mls:${p.id}` }]);
  if (owned.length > PAGE_SIZE) rows.push(navRow("mnew", pg));
  rows.push([{ text: "⬅️ Назад", callback_data: "mk:0" }]);
  return { text, markup: { inline_keyboard: rows } };
}

function idsText(userId) {
  return `🆔 Твой ID: ${userId}\nЧтобы выдать деньги игроку: /give @username сумма`;
}

// ---------- Ввод текста после кнопки («Перевод», «Выставить») ----------
async function onState(env, chatId, userId, u, text, kb) {
  const st = u.st;
  u.st = null;
  const say = (t) => tg(env, "sendMessage", { chat_id: chatId, text: t, reply_markup: kb });

  if (st.a === "pay") {
    await saveUser(env, userId, u);
    const [target, amtRaw] = text.split(/\s+/);
    const amt = Math.floor(Number(amtRaw));
    const tid = await resolveTarget(env, target);
    const t = tid ? await env.DB.get(`u:${tid}`, "json") : null;
    if (!tid || !t) return say("Игрок не найден (он должен писать боту).");
    if (String(tid) === String(userId)) return say("Себе переводить нельзя.");
    if (!(amt > 0)) return say("Укажи сумму цифрами, например: @username 500");
    if (u.coins < amt) return say(`Не хватает денег на руках (есть ${num(u.coins)} ₽).`);
    u.coins -= amt;
    t.coins = (t.coins || 0) + amt;
    await saveUser(env, userId, u);
    await saveUser(env, tid, t);
    await tg(env, "sendMessage", {
      chat_id: tid,
      text: `💸 Тебе перевели ${num(amt)} ₽ от ${u.un ? "@" + u.un : "ID " + userId}. Баланс: ${num(t.coins)} ₽`,
    }).catch(() => {});
    return say(`✅ Переведено ${num(amt)} ₽. Баланс: ${num(u.coins)} ₽`);
  }

  if (st.a === "list") {
    await saveUser(env, userId, u);
    const p = BY_ID[st.p];
    const price = Math.floor(Number(String(text).replace(/\s/g, "")));
    if (!p || !(u.inv[p.id] > 0)) return say("У тебя нет этого телефона.");
    if (!(price > 0) || price > MARKET_MAX_PRICE) return say(`Цена от 1 до ${num(MARKET_MAX_PRICE)} ₽. Попробуй снова через «🛒 Авито».`);
    u.inv[p.id]--;
    await saveUser(env, userId, u);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await env.DB.put(`m:${id}`, JSON.stringify({ s: String(userId), sn: u.un || "", p: p.id, price }));
    return say(`✅ ${p.name} выставлен за ${num(price)} ₽. Смотреть: 🛒 Авито.`);
  }

  await saveUser(env, userId, u);
  return say("Ок.");
}

// ---------- Команды админа ----------
const ADMIN_TEXT =
  "👑 Админ-панель\n\nКоманды:\n/give @username сумма — выдать деньги игроку\n/promo КОД сумма [раз] [дней] — создать промокод\n/stats — статистика игры";
const ADMIN_MARKUP = {
  inline_keyboard: [
    [{ text: "📊 Статистика", callback_data: "adm:stats" }],
    [{ text: "💰 +100 000 себе", callback_data: "adm:coins" }],
    [{ text: "🆔 Мой ID", callback_data: "adm:ids" }],
  ],
};

async function onAdminCommand(env, chatId, text) {
  const [cmd, target, amtRaw] = text.split(/\s+/);
  const say = (t) => tg(env, "sendMessage", { chat_id: chatId, text: t });
  if (cmd === "/stats") {
    const n = await countUsers(env);
    const duo = PHONES.find((p) => p.limit);
    const used = duo ? await limUsed(env, duo) : 0;
    await say(`📊 Игроков: ${n}\n📱 Моделей в игре: ${PHONES.length}${duo ? `\n🔥 ${duo.name}: выдано ${used}/${duo.limit}` : ""}`);
    return true;
  }
  if (cmd === "/promo") {
    const parts = text.split(/\s+/);
    const code = (parts[1] || "").toUpperCase();
    const amt = Math.floor(Number(parts[2]));
    const uses = Math.floor(Number(parts[3] || 100));
    const days = Number(parts[4] || 0);
    if (!/^[A-Z0-9]{3,20}$/.test(code) || !(amt > 0) || !(uses > 0)) {
      await say("Формат: /promo КОД сумма [использований] [дней]\nНапример: /promo SUMMER 5000 100 7");
    } else {
      const exp = days > 0 ? Date.now() + days * 86400000 : 0;
      await env.DB.put(`promo:${code}`, JSON.stringify({ c: amt, left: uses, exp }));
      await say(`🎟 Промокод ${code}: +${num(amt)} ₽, использований: ${uses}${exp ? `, до ${new Date(exp).toLocaleDateString("ru-RU")}` : ", без срока"}`);
    }
    return true;
  }
  if (cmd === "/give") {
    const amt = Math.floor(Number(amtRaw));
    const tid = await resolveTarget(env, target);
    const t = tid ? await env.DB.get(`u:${tid}`, "json") : null;
    if (!tid || !t) await say("Игрок не найден. Формат: /give @username 1000");
    else if (!(amt > 0)) await say("Укажи сумму: /give @username 1000");
    else {
      t.coins = (t.coins || 0) + amt;
      await saveUser(env, tid, t);
      await say(`✅ Выдано ${num(amt)} ₽ (${target}). Баланс: ${num(t.coins)} ₽`);
    }
    return true;
  }
  return false;
}

// ---------- Тексты бота ----------
const CHANNEL_URL = "https://t.me/iPhoneNewsGame";
const WELCOME_TEXT =
  "🎰 <b>Найди айфон</b>\n\n" +
  "Крути айфоны, продавай их, храни деньги в банке, покупай крипту и торгуй с другими игроками.\n\n" +
  "📱 <b>Как играть:</b> нажми кнопку «Играть» рядом со скрепкой 📎 внизу чата.\n\n" +
  `📢 Новости, розыгрыши и лимитки: <a href="${CHANNEL_URL}">канал игры</a>`;
const OPEN_TEXT =
  "📱 Игра открывается кнопкой <b>«Играть»</b> рядом со скрепкой 📎\n\n" +
  `📢 <a href="${CHANNEL_URL}">Канал игры</a>`;

// реферал: бонус обоим, только если игрок пришёл по ссылке впервые
async function applyReferral(env, u, userId, existed, payload) {
  const m = /^ref_(\d{3,15})$/.exec(payload || "");
  if (!m || existed || u.ref) return "";
  const rid = m[1];
  if (rid === String(userId)) return "";
  const r = await env.DB.get(`u:${rid}`, "json");
  if (!r) return "";
  u.ref = rid;
  u.coins += REF_NEW;
  if ((r.refs || 0) < REF_MAX) {
    r.refs = (r.refs || 0) + 1;
    r.refEarn = (r.refEarn || 0) + REF_INVITER;
    r.coins = (r.coins || 0) + REF_INVITER;
    await saveUser(env, rid, r);
    await tg(env, "sendMessage", { chat_id: rid, text: `🎉 По твоей ссылке пришёл новый игрок! +${num(REF_INVITER)} ₽` }).catch(() => {});
  }
  return `🎁 Бонус за приглашение: +${num(REF_NEW)} ₽`;
}

// успешная оплата Stars: начисляем рубли один раз на платёж
async function onPayment(env, msg) {
  const pay = msg.successful_payment;
  const say = (t) => tg(env, "sendMessage", { chat_id: msg.chat.id, text: t }).catch(() => {});
  if (!pay || pay.currency !== "XTR") return;
  const key = `pay:${pay.telegram_payment_charge_id}`;
  if (await env.DB.get(key)) return;
  const m = PACK_RE.exec(pay.invoice_payload || "");
  const pack = m && PACK_BY_ID[m[1]];
  if (!pack || String(msg.from.id) !== m[2] || pay.total_amount !== pack.stars) {
    console.error("bad payment", pay);
    return say("Оплата получена, но рубли не начислились автоматически. Напиши в поддержку: /paysupport");
  }
  await env.DB.put(key, JSON.stringify({ u: msg.from.id, p: pack.id, t: Date.now() }));
  const u = await getUser(env, msg.from.id);
  u.coins += pack.coins;
  u.stars = (u.stars || 0) + pack.stars;
  await saveUser(env, msg.from.id, u);
  return say(`✅ Оплата прошла: +${num(pack.coins)} ₽. Баланс: ${num(u.coins)} ₽`);
}

async function onMessage(env, msg) {
  if (msg.successful_payment) return onPayment(env, msg);
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();
  const admin = isAdmin(env, msg.from);
  const kb = mainKeyboard(admin);
  const existed = (await env.DB.get(`u:${userId}`)) !== null;
  const u = await getUser(env, userId);
  let dirty = await syncName(env, msg.from, u);

  if (u.st && (text.startsWith("/") || MENU_BUTTONS.includes(text))) {
    u.st = null;
    dirty = true;
  }
  if (dirty) await saveUser(env, userId, u);

  if (text === "/paysupport") {
    return tg(env, "sendMessage", { chat_id: chatId, text: "Если оплата Stars не начислилась, напиши администратору @alvmv и приложи скрин оплаты." });
  }

  if (text === "/start" || text.startsWith("/start ")) {
    await setMenu(env, chatId);
    const note = await applyReferral(env, u, userId, existed, text.split(/\s+/)[1]);
    if (!u.welcomed) {
      u.welcomed = true;
      await saveUser(env, userId, u);
      await tg(env, "sendMessage", { chat_id: chatId, text: WELCOME_TEXT, parse_mode: "HTML", disable_web_page_preview: true });
      if (note) await tg(env, "sendMessage", { chat_id: chatId, text: note });
      return;
    }
    await saveUser(env, userId, u);
    return tg(env, "sendMessage", { chat_id: chatId, text: OPEN_TEXT, parse_mode: "HTML", disable_web_page_preview: true });
  }

  if (text === "/app") {
    await setMenu(env, chatId);
    return tg(env, "sendMessage", { chat_id: chatId, text: OPEN_TEXT, parse_mode: "HTML", disable_web_page_preview: true });
  }

  if (admin && text.startsWith("/")) {
    if (await onAdminCommand(env, chatId, text)) return;
  }

  if (u.st) return onState(env, chatId, userId, u, text, kb);

  if (admin && text === BTN_ADMIN) {
    return tg(env, "sendMessage", { chat_id: chatId, text: ADMIN_TEXT, reply_markup: ADMIN_MARKUP });
  }

  if (text === BTN_FIND) {
    const v = await spinView(env, u, admin);
    return tg(env, "sendMessage", { chat_id: chatId, text: v.text, reply_markup: v.markup });
  }
  if (text === BTN_INV) {
    const v = inventoryHome(u);
    return tg(env, "sendMessage", { chat_id: chatId, text: v.text, reply_markup: v.markup });
  }
  if (text === BTN_SHOP) {
    const v = shopHome(u);
    return tg(env, "sendMessage", { chat_id: chatId, text: v.text, reply_markup: v.markup });
  }
  if (text === BTN_BANK) {
    accrue(u);
    await saveUser(env, userId, u);
    const v = bankView(u);
    return tg(env, "sendMessage", { chat_id: chatId, text: v.text, reply_markup: v.markup });
  }
  if (text === BTN_MARKET) {
    const v = await marketView(env, userId, 0);
    return tg(env, "sendMessage", { chat_id: chatId, text: v.text, reply_markup: v.markup });
  }

  return tg(env, "sendMessage", { chat_id: chatId, text: OPEN_TEXT, parse_mode: "HTML", disable_web_page_preview: true });
}

async function onCallback(env, cb) {
  const userId = cb.from.id;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const [action, a, b] = (cb.data || "").split(":");
  const answer = (text, alert = false) =>
    tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });

  if (action === "noop") return answer("");

  if (action === "adm") {
    if (!isAdmin(env, cb.from)) return answer("Нет доступа", true);
    if (a === "stats") {
      const n = await countUsers(env);
      const duo = PHONES.find((p) => p.limit);
      const used = duo ? await limUsed(env, duo) : 0;
      return answer(`📊 Игроков: ${n}\n📱 Моделей в игре: ${PHONES.length}${duo ? `\n🔥 ${duo.name}: выдано ${used}/${duo.limit}` : ""}`, true);
    }
    if (a === "coins") {
      const me = await getUser(env, userId);
      me.coins += 100000;
      await saveUser(env, userId, me);
      return answer(`+100000 ₽. Баланс: ${me.coins}`);
    }
    if (a === "ids") {
      await answer("");
      return tg(env, "sendMessage", { chat_id: chatId, text: idsText(userId) });
    }
    return answer("");
  }

  if (action === "spin") return onSpin(env, cb, a);
  if (action === "skip") return onSkip(env, cb);
  if (action === "spinsell") return onSpinSell(env, cb);
  if (action === "mult") return onMult(env, cb, a);
  if (action === "spd") return onSpeed(env, cb, a);

  const u = await getUser(env, userId);
  let toast = "";
  let view;

  if (action === "menu") {
    if (u.st) {
      u.st = null;
      await saveUser(env, userId, u);
    }
    view = { text: "📋 Главное меню — пользуйся кнопками внизу 👇" };
  } else if (action === "invhome") {
    view = inventoryHome(u);
  } else if (action === "shophome") {
    view = shopHome(u);
  } else if (action === "inv") {
    view = inventoryView(u, Number(a) || 0, "p");
  } else if (action === "inva") {
    view = inventoryView(u, Number(a) || 0, "a");
  } else if (action === "shop") {
    view = shopView(u, Number(a) || 0);
  } else if (action === "sell") {
    const p = ITEM_BY_ID[a];
    if (p && u.inv[p.id] > 0) {
      u.inv[p.id]--;
      u.coins += sellPrice(p);
      toast = `Продано: ${p.name} (+${num(sellPrice(p))} ₽)`;
      await saveUser(env, userId, u);
    } else toast = "У тебя нет этого предмета";
    view = inventoryView(u, Number(b) || 0, p && p.acc ? "a" : "p");
  } else if (action === "sellall") {
    let sum = 0;
    const accTab = a === "a";
    for (const p of accTab ? ACCESSORIES : PHONES) {
      if (u.inv[p.id] > 0) {
        sum += sellPrice(p) * u.inv[p.id];
        u.inv[p.id] = 0;
      }
    }
    u.coins += sum;
    toast = sum ? `Продано всё: +${num(sum)} ₽` : "Нечего продавать";
    await saveUser(env, userId, u);
    view = inventoryView(u, 0, accTab ? "a" : "p");
  } else if (action === "shopa") {
    view = shopView(u, Number(a) || 0, "a");
  } else if (action === "buy" || action === "bua") {
    const p = ITEM_BY_ID[a];
    if (!p) toast = "Такого товара нет";
    else if (u.coins < p.price) toast = `Не хватает денег (нужно ${num(p.price)} ₽)`;
    else {
      u.coins -= p.price;
      u.inv[p.id] = (u.inv[p.id] || 0) + 1;
      toast = `Куплено: ${p.name}!`;
      await saveUser(env, userId, u);
    }
    view = shopView(u, Number(b) || 0, action === "bua" ? "a" : "p");

    // ---------- Банк ----------
  } else if (action === "bank") {
    accrue(u);
    await saveUser(env, userId, u);
    view = bankView(u);
  } else if (action === "dep" || action === "wd") {
    accrue(u);
    const from = action === "dep" ? u.coins : u.bank;
    const amt = a === "all" ? from : Number(a);
    if (!(amt > 0)) toast = "Нечего переводить";
    else if (amt > from) toast = action === "dep" ? "Не хватает денег на руках" : "Не хватает денег на счёте";
    else {
      if (action === "dep") {
        u.coins -= amt;
        u.bank += amt;
        toast = `Внесено ${num(amt)} ₽`;
      } else {
        u.bank -= amt;
        u.coins += amt;
        toast = `Снято ${num(amt)} ₽`;
      }
    }
    await saveUser(env, userId, u);
    view = bankView(u);
  } else if (action === "pay") {
    u.st = { a: "pay" };
    await saveUser(env, userId, u);
    await answer("");
    return tg(env, "sendMessage", {
      chat_id: chatId,
      text: "💸 Напиши получателя и сумму одним сообщением:\n@username 500\nили\nID 500\n\nСпишется с рублей на руках. Чтобы отменить, нажми любую кнопку меню.",
    });

    // ---------- Крипта ----------
  } else if (action === "crypto") {
    view = cryptoView(u);
  } else if (action === "cb") {
    const sym = a;
    const amt = Number(b);
    if (!CRYPTO[sym] || !(amt > 0)) toast = "Ошибка";
    else if (u.coins < amt) toast = `Не хватает денег (нужно ${num(amt)} ₽)`;
    else {
      const qty = (amt * (1 - CRYPTO_FEE)) / cryptoPrice(sym);
      u.coins -= amt;
      u.crypto[sym] = (u.crypto[sym] || 0) + qty;
      toast = `Куплено ${qty.toFixed(4)} ${sym}`;
      await saveUser(env, userId, u);
    }
    view = cryptoView(u);
  } else if (action === "cs") {
    const sym = a;
    const have = u.crypto[sym] || 0;
    if (!CRYPTO[sym] || have <= 0) toast = `У тебя нет ${sym}`;
    else {
      const got = Math.floor(have * cryptoPrice(sym) * (1 - CRYPTO_FEE));
      u.coins += got;
      u.crypto[sym] = 0;
      toast = `Продано ${have.toFixed(4)} ${sym}: +${num(got)} ₽`;
      await saveUser(env, userId, u);
    }
    view = cryptoView(u);

    // ---------- Авито ----------
  } else if (action === "mk") {
    view = await marketView(env, userId, Number(a) || 0);
  } else if (action === "mnew") {
    view = marketPickView(u, Number(a) || 0);
  } else if (action === "mls") {
    const p = BY_ID[a];
    if (!p || !(u.inv[p.id] > 0)) {
      toast = "У тебя нет этого телефона";
      view = marketPickView(u, 0);
    } else {
      u.st = { a: "list", p: p.id };
      await saveUser(env, userId, u);
      await answer("");
      return tg(env, "sendMessage", {
        chat_id: chatId,
        text: `💰 За сколько продаёшь ${p.name}? Напиши цену числом (в рублях).\nСистема даёт за него ${num(sellPrice(p))} ₽, магазин просит ${num(p.price)} ₽.\n\nЧтобы отменить, нажми любую кнопку меню.`,
      });
    }
  } else if (action === "mb") {
    const key = `m:${a}`;
    const l = await env.DB.get(key, "json");
    const p = l && BY_ID[l.p];
    if (!l || !p) toast = "Уже продано или снято";
    else if (String(l.s) === String(userId)) toast = "Это твой лот";
    else if (u.coins < l.price) toast = `Не хватает денег (нужно ${num(l.price)} ₽)`;
    else {
      await env.DB.delete(key);
      u.coins -= l.price;
      u.inv[p.id] = (u.inv[p.id] || 0) + 1;
      await saveUser(env, userId, u);
      const seller = await getUser(env, l.s);
      const income = Math.floor(l.price * (1 - MARKET_FEE));
      seller.coins += income;
      await saveUser(env, l.s, seller);
      await tg(env, "sendMessage", {
        chat_id: l.s,
        text: `🛒 Твой ${p.name} купили за ${num(l.price)} ₽. Ты получил ${num(income)} ₽ (комиссия ${MARKET_FEE * 100}%).`,
      });
      toast = `Куплен ${p.name}!`;
    }
    view = await marketView(env, userId, Number(b) || 0);
  } else if (action === "mc") {
    const key = `m:${a}`;
    const l = await env.DB.get(key, "json");
    if (!l) toast = "Лот уже продан или снят";
    else if (String(l.s) !== String(userId)) toast = "Это не твой лот";
    else {
      await env.DB.delete(key);
      u.inv[l.p] = (u.inv[l.p] || 0) + 1;
      await saveUser(env, userId, u);
      toast = "Телефон вернулся в инвентарь";
    }
    view = await marketView(env, userId, Number(b) || 0);
  } else {
    return answer("");
  }

  await answer(toast);
  const res = await tg(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: view.text,
    reply_markup: view.markup || { inline_keyboard: [] },
  });
  if (!res.ok && !String(res.description || "").includes("not modified")) console.error("edit failed", res);
}

// ---------- Веб-приложение (Telegram Mini App) ----------
const jsonRes = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// проверка подписи Telegram (initData): чужой аккаунт подделать нельзя
async function verifyInit(env, initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");
  if (!hash) return null;
  const str = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const enc = new TextEncoder();
  const hmac = async (key, data) =>
    crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(data));
  const secret = await hmac(enc.encode("WebAppData"), env.BOT_TOKEN);
  const hex = [...new Uint8Array(await hmac(secret, str))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== hash) return null;
  if (Date.now() / 1000 - Number(params.get("auth_date")) > 86400) return null;
  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

async function apiState(env, uid, u, admin, wantMarket = false) {
  const keys = wantMarket ? (await loadListings(env)).slice(0, 60) : [];
  const mk = (await Promise.all(keys.map(async (k) => ({ k, l: await env.DB.get(k, "json") }))))
    .filter((x) => x.l)
    .map(({ k, l }) => ({ id: k.slice(2), p: l.p, s: l.sn || String(l.s), price: l.price, own: String(l.s) === String(uid) }));
  const duo = PHONES.find((p) => p.limit);
  const duoLeft = duo ? duo.limit - (await limUsed(env, duo)) : 0;
  let promos = [];
  if (admin) {
    const pr = await env.DB.list({ prefix: "promo:" });
    const ps = await Promise.all(pr.keys.map((k) => env.DB.get(k.name, "json")));
    pr.keys.forEach((k, i) => {
      const p = ps[i];
      if (p) promos.push({ code: k.name.slice(6), c: p.c, left: p.left, exp: p.exp || 0 });
    });
  }
  const now = Date.now();
  const dd = u.daily || { t: 0, streak: 0 };
  const dWait = Math.max(0, dd.t + DAILY_CD - now);
  const nextStreak = now - dd.t < DAILY_KEEP ? Math.min(dd.streak + 1, DAILY_MAX_STREAK) : 1;
  return {
    coins: u.coins, bank: u.bank, inv: u.inv, cr: u.crypto, last: u.last, now, admin: admin ? 1 : 0, mk, duoLeft, duoMax: duo ? duo.limit : 0, cost1: SPIN_COST, promos, safe: u.safe || {},
    sell: SELL_RATE, rate: BANK_RATE_PER_HOUR, packs: PACKS,
    me: { name: u.nm || (u.un ? "@" + u.un : "Игрок"), un: u.un || "", photo: u.ph || "", id: String(uid) },
    ref: { link: `https://t.me/${botName(env)}?start=ref_${uid}`, n: u.refs || 0, earn: u.refEarn || 0, bonus: REF_INVITER, bonusNew: REF_NEW },
    daily: { wait: dWait, streak: dd.streak || 0, amt: DAILY_BASE + (nextStreak - 1) * DAILY_STEP },
  };
}

// ---------- Топы ----------
let ROWS_CACHE = null;
let ROWS_AT = 0;
async function playerRows(env) {
  if (ROWS_CACHE && Date.now() - ROWS_AT < 60000) return ROWS_CACHE;
  const keys = [];
  let cursor;
  do {
    const r = await env.DB.list({ prefix: "u:", cursor });
    for (const k of r.keys) keys.push(k.name);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  const users = await Promise.all(keys.map((k) => env.DB.get(k, "json")));
  const rows = [];
  users.forEach((p, i) => {
    if (!p) return;
    const id = keys[i].slice(2);
    let v = (p.coins || 0) + (p.bank || 0);
    let c = 0;
    for (const [sym, n] of Object.entries(p.crypto || {})) v += n * cryptoPrice(sym);
    for (const [itemId, n] of Object.entries(p.inv || {})) {
      const it = ITEM_BY_ID[itemId];
      if (!it || n <= 0) continue;
      v += sellPrice(it) * n;
      if (!it.acc && (it.limit || rarityOf(it) === "leg" || rarityOf(it) === "myth")) c += n;
    }
    rows.push({ id, n: p.un ? "@" + p.un : "Игрок #" + id.slice(-4), v: Math.floor(v), c });
  });
  ROWS_CACHE = rows;
  ROWS_AT = Date.now();
  return rows;
}

async function topLists(env, uid) {
  const rows = (await playerRows(env)).map((r) => ({ ...r, me: String(r.id) === String(uid) }));
  const rich = [...rows].sort((x, y) => y.v - x.v);
  const rankOf = (list) => {
    const i = list.findIndex((r) => r.me);
    return i >= 0 ? i + 1 : null;
  };
  const top = (list) => list.slice(0, 20).map(({ n, v, c, me }) => ({ n, v, c, me }));
  return { rich: top(rich), me: { rich: rankOf(rich) } };
}

async function handleApi(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ error: "bad request" }, 400);
  }
  const from = await verifyInit(env, body.initData);
  if (!from) return jsonRes({ error: "auth" }, 401);
  const uid = from.id;
  const admin = isAdmin(env, from);
  const u = await getUser(env, uid);
  await syncName(env, from, u);
  if (from.first_name) u.nm = [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 40);
  if (from.photo_url) u.ph = String(from.photo_url);
  accrue(u);
  const { a, x, y, z, w } = body;
  let invoice = null;
  const amtY = Math.floor(Number(y));
  let toast = "";
  let found = null;

  if (a === "spin") {
    const want = Math.floor(Number(x));
    const n = admin && want >= 1 ? Math.min(want, ADMIN_MAX_SPIN) : MULTS.includes(want) ? want : 1;
    const cost = SPIN_COST * n;
    if (!admin && canRescue(u)) {
      u.coins = SPIN_COST;
      u.rescueAt = Date.now();
      toast = "🎁 Ты на нуле: бесплатная крутка раз в сутки. Выбери x1";
    }
    if (!admin && u.coins < cost) toast = toast || `Не хватает денег (нужно ${num(cost)} ₽)`;
    else {
      if (!admin) u.coins -= cost;
      const got = await doSpin(env, u, n, admin);
      found = got.map((p) => p.id);
      u.spin = { items: countItems(got), text: "" };
      toast = "";
    }
  } else if (a === "sellspin") {
    const r = sellLastSpin(u);
    toast = r.cnt ? `+${num(r.sum)} ₽ (продано ${r.cnt})` : "Нечего продавать";
  } else if (a === "buy") {
    const p = ITEM_BY_ID[x];
    if (!p) toast = "Такого товара нет";
    else if (p.limit) toast = "Лимитку купить нельзя";
    else if (u.coins < p.price) toast = "Не хватает денег";
    else {
      u.coins -= p.price;
      u.inv[p.id] = (u.inv[p.id] || 0) + 1;
      toast = `Куплено: ${p.name}`;
    }
  } else if (a === "sell") {
    const p = ITEM_BY_ID[x];
    if (p && u.inv[p.id] > 0) {
      u.inv[p.id]--;
      u.coins += sellPrice(p);
      toast = `+${num(sellPrice(p))} ₽`;
    } else toast = "У тебя нет этого предмета";
  } else if (a === "sellall") {
    let sum = 0;
    for (const p of x === "a" ? ACCESSORIES : PHONES) {
      if (u.inv[p.id] > 0) {
        sum += sellPrice(p) * u.inv[p.id];
        u.inv[p.id] = 0;
      }
    }
    u.coins += sum;
    toast = sum ? `+${num(sum)} ₽` : "Нечего продавать";
  } else if (a === "dep" || a === "wd") {
    const from_ = a === "dep" ? u.coins : u.bank;
    const amt = x === "all" ? from_ : Math.floor(Number(x));
    if (!(amt > 0) || amt > from_) toast = "Не хватает денег";
    else if (a === "dep") {
      u.coins -= amt;
      u.bank += amt;
      toast = `Внесено ${num(amt)} ₽`;
    } else {
      u.bank -= amt;
      u.coins += amt;
      toast = `Снято ${num(amt)} ₽`;
    }
  } else if (a === "cb") {
    if (!CRYPTO[x] || !(amtY > 0)) toast = "Ошибка";
    else if (u.coins < amtY) toast = "Не хватает денег";
    else {
      const qty = (amtY * (1 - CRYPTO_FEE)) / cryptoPrice(x);
      u.coins -= amtY;
      u.crypto[x] = (u.crypto[x] || 0) + qty;
      toast = `Куплено ${qty.toFixed(4)} ${x}`;
    }
  } else if (a === "cs") {
    const have = u.crypto[x] || 0;
    if (!CRYPTO[x] || have <= 0) toast = `У тебя нет ${x}`;
    else {
      const got = Math.floor(have * cryptoPrice(x) * (1 - CRYPTO_FEE));
      u.coins += got;
      u.crypto[x] = 0;
      toast = `+${num(got)} ₽`;
    }
  } else if (a === "pay") {
    const tid = await resolveTarget(env, x);
    const t = tid ? await env.DB.get(`u:${tid}`, "json") : null;
    if (!tid || !t) toast = "Игрок не найден (он должен писать боту)";
    else if (String(tid) === String(uid)) toast = "Себе переводить нельзя";
    else if (!(amtY > 0)) toast = "Укажи сумму";
    else if (u.coins < amtY) toast = "Не хватает денег на руках";
    else {
      u.coins -= amtY;
      t.coins = (t.coins || 0) + amtY;
      await saveUser(env, tid, t);
      toast = `Переведено ${num(amtY)} ₽`;
      await tg(env, "sendMessage", {
        chat_id: tid,
        text: `💸 Тебе перевели ${num(amtY)} ₽ от ${u.un ? "@" + u.un : "ID " + uid}. Баланс: ${num(t.coins)} ₽`,
      }).catch(() => {});
    }
  } else if (a === "mb") {
    const key = `m:${x}`;
    const l = await env.DB.get(key, "json");
    const p = l && BY_ID[l.p];
    if (!l || !p) toast = "Уже продано или снято";
    else if (String(l.s) === String(uid)) toast = "Это твой лот";
    else if (u.coins < l.price) toast = "Не хватает денег";
    else {
      await env.DB.delete(key);
      u.coins -= l.price;
      u.inv[p.id] = (u.inv[p.id] || 0) + 1;
      const seller = await getUser(env, l.s);
      const income = Math.floor(l.price * (1 - MARKET_FEE));
      seller.coins += income;
      await saveUser(env, l.s, seller);
      await tg(env, "sendMessage", {
        chat_id: l.s,
        text: `🛒 Твой ${p.name} купили за ${num(l.price)} ₽. Ты получил ${num(income)} ₽ (комиссия ${MARKET_FEE * 100}%).`,
      }).catch(() => {});
      toast = `Куплено: ${p.name}`;
    }
  } else if (a === "mc") {
    const key = `m:${x}`;
    const l = await env.DB.get(key, "json");
    if (!l) toast = "Лот уже продан или снят";
    else if (String(l.s) !== String(uid)) toast = "Это не твой лот";
    else {
      await env.DB.delete(key);
      u.inv[l.p] = (u.inv[l.p] || 0) + 1;
      toast = "Телефон вернулся в инвентарь";
    }
  } else if (a === "mlist") {
    const p = BY_ID[x];
    const price = Math.floor(Number(y));
    if (!p || !(u.inv[p.id] > 0)) toast = "У тебя нет этого телефона";
    else if (!(price > 0) || price > MARKET_MAX_PRICE) toast = `Цена от 1 до ${num(MARKET_MAX_PRICE)}`;
    else {
      u.inv[p.id]--;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await env.DB.put(`m:${id}`, JSON.stringify({ s: String(uid), sn: u.un || "", p: p.id, price }));
      toast = "Лот выставлен";
    }
  } else if (a === "safein" || a === "safeout") {
    const id = String(x || "");
    const count = Math.max(1, Math.floor(Number(y) || 1));
    const used = Object.values(u.safe).reduce((s, n) => s + n, 0);
    if (!ITEM_BY_ID[id]) toast = "Такой вещи нет";
    else if (a === "safein") {
      const take = Math.min(count, SAFE_SIZE - used, u.inv[id] || 0);
      if (take <= 0) toast = used >= SAFE_SIZE ? "Сейф полон (10/10)" : "Этой вещи нет в инвентаре";
      else {
        u.inv[id] -= take;
        if (u.inv[id] <= 0) delete u.inv[id];
        u.safe[id] = (u.safe[id] || 0) + take;
        toast = `В сейф: ${ITEM_BY_ID[id].name} × ${take}`;
      }
    } else {
      const take = Math.min(count, u.safe[id] || 0);
      if (take <= 0) toast = "Этой вещи нет в сейфе";
      else {
        u.safe[id] -= take;
        if (u.safe[id] <= 0) delete u.safe[id];
        u.inv[id] = (u.inv[id] || 0) + take;
        toast = `Из сейфа: ${ITEM_BY_ID[id].name} × ${take}`;
      }
    }
  } else if (a === "daily") {
    const now = Date.now();
    const d = u.daily || { t: 0, streak: 0 };
    if (now - d.t < DAILY_CD) toast = "Бонус уже получен, зайди позже";
    else {
      const streak = now - d.t < DAILY_KEEP ? Math.min(d.streak + 1, DAILY_MAX_STREAK) : 1;
      const amt = DAILY_BASE + (streak - 1) * DAILY_STEP;
      u.coins += amt;
      u.daily = { t: now, streak };
      toast = `+${num(amt)} ₽ ежедневный бонус (день ${streak})`;
    }
  } else if (a === "stars") {
    const pack = PACK_BY_ID[x];
    if (!pack) toast = "Такого пакета нет";
    else {
      const r = await tg(env, "createInvoiceLink", {
        title: `${num(pack.coins)} ₽ в игре`,
        description: "Игровая валюта для «Найди айфон»",
        payload: `pack:${pack.id}:${uid}`,
        provider_token: "",
        currency: "XTR",
        prices: [{ label: "Рубли", amount: pack.stars }],
      });
      if (r && r.ok) invoice = r.result;
      else {
        console.error("invoice failed", r);
        toast = "Не удалось создать счёт, попробуй позже";
      }
    }
  } else if (a === "promo") {
    const code = String(x || "").trim().toUpperCase();
    const p = /^[A-Z0-9]{3,20}$/.test(code) ? await env.DB.get(`promo:${code}`, "json") : null;
    u.promos ||= [];
    if (!p || p.left <= 0 || (p.exp && Date.now() > p.exp)) toast = "Такого промокода нет или он закончился";
    else if (u.promos.includes(code)) toast = "Этот промокод ты уже активировал";
    else {
      u.coins += p.c;
      u.promos.push(code);
      p.left -= 1;
      if (p.left <= 0) await env.DB.delete(`promo:${code}`);
      else await env.DB.put(`promo:${code}`, JSON.stringify(p));
      toast = `🎟 +${num(p.c)} ₽ по промокоду`;
    }
  } else if (a === "admgive") {
    if (!admin) toast = "Нет доступа";
    else {
      const t = await resolveTarget(env, String(x || "").trim());
      const amt = Math.floor(Number(y));
      const tu = t && String(t) !== String(uid) ? await env.DB.get(`u:${t}`, "json") : null;
      if (!(amt > 0)) toast = "Укажи сумму больше нуля";
      else if (String(t) === String(uid)) {
        u.coins += amt;
        toast = `Выдано себе ${num(amt)} ₽`;
      } else if (!tu) toast = "Игрок не найден (он должен писать боту)";
      else {
        tu.coins = (tu.coins || 0) + amt;
        await saveUser(env, t, tu);
        toast = `Выдано ${num(amt)} ₽`;
      }
    }
  } else if (a === "admpromo") {
    if (!admin) toast = "Нет доступа";
    else {
      const code = String(x || "").trim().toUpperCase();
      const amt = Math.floor(Number(y));
      const uses = Math.floor(Number(z || 100));
      const days = Number(w || 0);
      if (!/^[A-Z0-9]{3,20}$/.test(code) || !(amt > 0) || !(uses > 0)) toast = "Код 3–20 латинских букв или цифр, сумма и использования больше нуля";
      else {
        const exp = days > 0 ? Date.now() + days * 86400000 : 0;
        await env.DB.put(`promo:${code}`, JSON.stringify({ c: amt, left: uses, exp }));
        toast = `Промокод ${code} создан`;
      }
    }
  } else if (a === "admset") {
    const PRESETS = [1000, 50000, 100000, 1000000, 1000000000];
    const amt = Number(x);
    if (!admin) toast = "Нет доступа";
    else if (!PRESETS.includes(amt)) toast = "Такой суммы нет в быстрых кнопках";
    else {
      u.coins = amt;
      toast = `Баланс: ${num(amt)} ₽`;
    }
  } else if (a === "admduo") {
    if (!admin) toast = "Нет доступа";
    else {
      const duo = PHONES.find((p) => p.limit);
      if (await mintLimited(env, duo)) {
        u.inv[duo.id] = (u.inv[duo.id] || 0) + 1;
        toast = `🔥 Тебе выдан ${duo.name}`;
      } else toast = "Лимитка закончилась";
    }
  } else if (a === "admpdel") {
    if (!admin) toast = "Нет доступа";
    else {
      await env.DB.delete(`promo:${String(x || "").toUpperCase()}`);
      toast = "Промокод удалён";
    }
  } else if (a === "adm") {
    if (admin) {
      u.coins += 100000;
      toast = "+100 000 ₽";
    }
  }

  const extra = a === "top" ? { top: await topLists(env, uid) } : {};
  await saveUser(env, uid, u);
  return jsonRes({ toast, found, invoice, ...extra, state: await apiState(env, uid, u, admin, body.t === "market") });
}

// Реальные фото: кладёшь файл в папку img с именем id модели (например 17pm.png, 14p.webp, acc_apmax.jpg)
const IMG_RE = /^([a-z0-9_]+)\.(png|jpe?g|webp|svg)$/i;
const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };
function imgMap() {
  const m = {};
  try {
    for (const f of readdirSync(new URL("./img/", import.meta.url))) {
      const mm = f.match(IMG_RE);
      if (mm) m[mm[1].toLowerCase()] = f;
    }
  } catch {}
  return m;
}

function renderApp() {
  const cr = Object.fromEntries(Object.entries(CRYPTO).map(([k, c]) => [k, [c.base, c.amp, c.k1, c.k2, c.ph]]));
  return APP_TEMPLATE.replace("__P__", () => JSON.stringify(PHONES.map((p) => [p.id, p.name, p.price, p.weight, p.limit])))
    .replace("__A__", () => JSON.stringify(ACCESSORIES.map((p) => [p.id, p.name, p.price])))
    .replace("__C__", () => JSON.stringify(cr))
    .replace("__I__", () => JSON.stringify(imgMap()));
}

// ---------- Точка входа ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    ORIGIN = url.origin;

    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname.startsWith("/img/")) {
      const f = url.pathname.slice(5);
      const mm = f.match(IMG_RE);
      if (!mm) return new Response("not found", { status: 404 });
      try {
        const buf = readFileSync(new URL("./img/" + f, import.meta.url));
        return new Response(buf, { headers: { "content-type": IMG_TYPES[mm[2].toLowerCase()], "cache-control": "public, max-age=3600" } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    }

    if (url.pathname === "/app") {
      return new Response(renderApp(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/api" && request.method === "POST") {
      try {
        return await handleApi(env, request);
      } catch (e) {
        console.error(e);
        return jsonRes({ error: "server" }, 500);
      }
    }

    // Установка вебхука и кнопки «Играть». Сервер делает это сам при старте, вручную: /setup?key=WEBHOOK_SECRET
    if (url.pathname === "/setup") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const res = await tg(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query", "pre_checkout_query"],
      });
      const menu = await tg(env, "setChatMenuButton", {
        menu_button: { type: "web_app", text: "Играть", web_app: { url: `${url.origin}/app` } },
      });
      return new Response(JSON.stringify({ webhook: res, menu }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      const work = (async () => {
        try {
          if (update.message) await onMessage(env, update.message);
          else if (update.callback_query) await onCallback(env, update.callback_query);
          else if (update.pre_checkout_query) {
            const q = update.pre_checkout_query;
            const m = PACK_RE.exec(q.invoice_payload || "");
            const pack = m && PACK_BY_ID[m[1]];
            const ok = !!pack && q.currency === "XTR" && q.total_amount === pack.stars && String(q.from.id) === m[2];
            await tg(env, "answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok, ...(ok ? {} : { error_message: "Товар недоступен" }) });
          }
        } catch (e) {
          console.error(e);
        }
      })();
      if (ctx && ctx.waitUntil) ctx.waitUntil(work);
      else await work;
      return new Response("ok");
    }

    return new Response("Phone bot is running");
  },
};
