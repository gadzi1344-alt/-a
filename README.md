# Найди айфон — версия для VPS

Node.js 18+ (лучше 20+), без зависимостей и без `npm install`. Данные — в `data/db.json`.

## Запуск

```bash
cd /opt/najdi-iphone
cp .env.example .env && nano .env     # BOT_TOKEN, WEBHOOK_SECRET, PUBLIC_URL
node server.js
```

При старте с `PUBLIC_URL=https://...` сервер сам ставит вебхук и кнопку «Играть».
Вручную: `https://ТВОЙ-ДОМЕН/setup?key=WEBHOOK_SECRET`.

## HTTPS (обязателен для Mini App)

Нужен домен, направленный на IP сервера. Самый простой вариант — Caddy (сам выпускает сертификат):

```
game.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

## Автозапуск (systemd)

`/etc/systemd/system/najdi-iphone.service`:

```ini
[Unit]
Description=Najdi iPhone bot
After=network.target

[Service]
WorkingDirectory=/opt/najdi-iphone
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
chown -R www-data /opt/najdi-iphone
systemctl daemon-reload && systemctl enable --now najdi-iphone
journalctl -u najdi-iphone -f
```

## Админ

Админ — `@alvmv` (переменная `ADMIN_USERNAME`). Чтобы привязать ещё и к числовому ID, укажи `ADMIN_ID` (узнать: кнопка «🆔 Мой ID» в админ-панели бота).

## Бэкап и перенос

Все данные игроков — один файл `data/db.json`. Копируй его (`cp data/db.json backup.json`).
Перенос с Cloudflare KV: ключи те же (`u:ID`, `n:username`, `m:...`, `promo:...`, `lim:duo`) — значения можно положить в `db.json` в поле `"d"` (значение каждого ключа — строка JSON).

## Фото айфонов

Модели рисуются SVG-иллюстрациями. Реальные фото можно добавить в папку `img` (имена файлов по таблице в `PHOTOS.md`, например `17pm.png`).
