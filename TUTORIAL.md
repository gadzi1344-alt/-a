# Туториал: запуск «Найди айфон» на VPS с нуля

Что получится: игра в Telegram (Mini App со стеклянным дизайном), работает 24/7 на твоём сервере, админ — `@alvmv`.

Что понадобится:
- аккаунт Telegram и аккаунт GitHub;
- VPS на Ubuntu 22.04/24.04 (хватит 1 ГБ памяти) и доступ по SSH;
- домен (можно поддомен, например `game.твойдомен.ru`).

---

## Шаг 1. Создай бота

1. В Telegram открой **@BotFather** → `/newbot`.
2. Придумай название и username (должен кончаться на `bot`).
3. BotFather пришлёт **токен** вида `123456:ABC...`. Сохрани его, он понадобится в шаге 6. Никому его не показывай.

## Шаг 2. Направь домен на сервер

1. В панели, где куплен домен, открой DNS-записи.
2. Добавь запись **A**: имя `game` (или `@` для самого домена), значение — IP твоего VPS.
3. Подожди 5–30 минут. Проверка: `ping game.твойдомен.ru` должен показать IP сервера.

## Шаг 3. Залей проект на GitHub

1. Распакуй `najdi-iphone-git.zip`. Получится папка `najdi-iphone`.
2. На github.com: **New repository** → имя `najdi-iphone` → **Private** → **Create** (без README).
3. В терминале, внутри папки проекта:

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/najdi-iphone.git
git push -u origin main
```

Перед `git push` проверь `git status`: файла `.env` быть не должно (его блокирует `.gitignore`).

Без терминала: в репозитории **Add file → Upload files** и перетащи файлы из папки.

## Шаг 4. Подготовь сервер

Подключись: `ssh root@IP_СЕРВЕРА`. Затем:

```bash
apt update && apt install -y git curl ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs caddy
node --version        # должно быть v22.x
```

Открой нужные порты:

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

## Шаг 5. Скачай проект на сервер

```bash
cd /opt
git clone https://github.com/ТВОЙ_ЛОГИН/najdi-iphone.git
cd najdi-iphone
```

Для приватного репозитория GitHub попросит логин и вместо пароля **токен**: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → права `repo`.

## Шаг 6. Настрой `.env`

```bash
cp .env.example .env
nano .env
```

Заполни:

| Переменная | Что писать |
|---|---|
| `BOT_TOKEN` | токен из шага 1 |
| `WEBHOOK_SECRET` | любая длинная случайная строка (например, результат `openssl rand -hex 24`) |
| `PUBLIC_URL` | `https://game.твойдомен.ru` (без слэша в конце) |
| `ADMIN_USERNAME` | `alvmv` (уже стоит) |
| `ADMIN_ID` | необязательно, числовой ID админа (см. шаг 10) |

Сохранить в nano: `Ctrl+O`, `Enter`, выйти: `Ctrl+X`.

## Шаг 7. Включи HTTPS (Caddy)

Telegram открывает Mini App только по HTTPS. Caddy сам получит сертификат.

```bash
nano /etc/caddy/Caddyfile
```

Замени всё содержимое на:

```
game.твойдомен.ru {
    reverse_proxy 127.0.0.1:8787
}
```

Применить: `systemctl restart caddy`.

## Шаг 8. Автозапуск через systemd

```bash
nano /etc/systemd/system/najdi-iphone.service
```

Вставь:

```ini
[Unit]
Description=Najdi iPhone bot
After=network.target

[Service]
WorkingDirectory=/opt/najdi-iphone
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Запусти:

```bash
systemctl daemon-reload
systemctl enable --now najdi-iphone
journalctl -u najdi-iphone -f
```

В логе должно быть: `слушаю 127.0.0.1:8787` и строка `setup:` с `"ok":true`. Это значит, что вебхук и кнопка «Играть» установились. Выйти из просмотра логов: `Ctrl+C`.

## Шаг 9. Проверь игру

1. Открой своего бота, нажми **Start**.
2. Нажми кнопку **«Играть»** рядом со скрепкой.
3. Должна открыться игра: крутка, магазин, вещи, банк, Авито.

## Шаг 10. Админ

1. Зайди в бота с аккаунта **@alvmv** и открой игру.
2. Вкладка 👤 (справа сверху) → внизу появится **«👑 Админ-панель»**: баланс себе, выдача денег игрокам, промокоды, iPhone Duo.
3. В чате с ботом у админа есть кнопка «👑 Админ-панель» и команды `/give @username сумма`, `/promo КОД сумма`, `/stats`.
4. Для надёжности привяжи ещё и ID: в чате нажми «👑 Админ-панель» → «🆔 Мой ID», впиши число в `ADMIN_ID` в `.env` и выполни `systemctl restart najdi-iphone`.

---

## Обновление игры

Поменял код на GitHub? На сервере:

```bash
cd /opt/najdi-iphone
git pull
systemctl restart najdi-iphone
```

`.env` и база игроков при этом не трогаются.

## Бэкап

Все данные игроков лежат в `/opt/najdi-iphone/data/db.json`. Копируй этот файл:

```bash
cp /opt/najdi-iphone/data/db.json ~/backup-$(date +%F).json
```

## Если что-то не работает

| Симптом | Что делать |
|---|---|
| В логе «Заполни BOT_TOKEN и WEBHOOK_SECRET» | не заполнен `.env` или он лежит не в `/opt/najdi-iphone` |
| Игра пишет «Открой через Telegram» | открыто не через кнопку «Играть» в боте, либо неверный `BOT_TOKEN` |
| Бот молчит | `journalctl -u najdi-iphone -n 50`, проверь `PUBLIC_URL` (только `https://`) и `systemctl status caddy` |
| Сертификат не выдаётся | домен ещё не указывает на сервер (шаг 2) или закрыты порты 80/443 |
| Кнопки «Играть» нет | перезапусти сервис и отправь боту `/start` |
| Нет админ-панели | заходи с аккаунта, у которого username ровно `alvmv`, или заполни `ADMIN_ID` |

Полезные команды: `systemctl status najdi-iphone`, `systemctl restart najdi-iphone`, `journalctl -u najdi-iphone -f`.
