# Развёртывание на сервере

Стек: PostgreSQL, Redis, миграции, `api`, `engine`, `mock-clinic` и `chatbot-web` (nginx со статикой SPA и прокси `/api/`, `/webhook/` на `api` (алиас `chatbot-api`)). Порты хоста не публикуются; HTTPS и домен обслуживает Nginx Proxy Manager (NPM), `chatbot-web` подключается к его сети `proxy_manager_default` с алиасом `chatbot-web`.

## Первичная установка

```bash
git clone https://github.com/Denmurzik/chatbot-builder.git ~/chatbot-builder
cd ~/chatbot-builder
cp deploy/.env.prod.example deploy/.env.prod
# JWT_SECRET, VAULT_KEY, VAULT_HASH_KEY: openssl rand -base64 32
# POSTGRES_PASSWORD: openssl rand -hex 32 (без / и +, иначе ломается DATABASE_URL)
# MOCK_CLINIC_API_KEY: openssl rand -hex 16
nano deploy/.env.prod
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

`VAULT_KEY` и `VAULT_HASH_KEY` — base64 ровно 32 байта. После первого запуска их менять нельзя: зашифрованные секреты окружений перестанут расшифровываться.

## Обновление

```bash
cd ~/chatbot-builder
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

Миграции применяет сервис `migrate` перед стартом `api` и `engine`.

## Proxy Host в Nginx Proxy Manager

- Domain Names: `chatbot.nsumonkey.top`
- Scheme: `http`, Forward Hostname / IP: `chatbot-web`, Forward Port: `80`
- Включить Websockets Support
- Вкладка SSL: сертификат Let's Encrypt, включить Force SSL

DNS-запись домена должна указывать на сервер.

## Первый автор

Скрипт `seed` в production не используется: зарегистрируйтесь через интерфейс (`https://chatbot.nsumonkey.top`). В окружении бота для тестового API клиники укажите адрес `http://mock-clinic:4010` и ключ `MOCK_CLINIC_API_KEY`.

## Отключение Telegram у опубликованного бота

Если отключить Telegram у опубликованного бота, он остаётся в статусе «Опубликован», но не получает сообщений, пока токен не подключён снова.

## Разрешённые адреса HTTP-запросов

Движок отправляет HTTP-запросы бота только на хосты из `HTTP_ALLOWED_HOSTS` (в `deploy/.env.prod`, через запятую, без схемы и порта). По умолчанию — только `mock-clinic`: остальные адреса получают ошибку «Адрес не разрешён», чтобы сценарий не мог обращаться к внутренней сети сервера. Чтобы разрешить реальный внешний API, добавьте его имя хоста (например, `HTTP_ALLOWED_HOSTS=mock-clinic,api.example.com`) и перезапустите `engine`: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d engine`.

## Telegram через прокси

Если с сервера нет прямого доступа к `api.telegram.org`, можно пустить исходящие запросы `api` и `engine` через контейнер `telegram-proxy` (xray, HTTP-прокси на внутреннем порту `10809`, порты на хосте не публикуются).

1. Скопируйте шаблон конфига и заполните секцию `outbounds` параметрами вашего прокси-сервера (`deploy/xray/config.json` добавлен в `.gitignore` и в git не попадает):
   ```bash
   cp deploy/xray/config.example.json deploy/xray/config.json
   nano deploy/xray/config.json
   ```
2. В `deploy/.env.prod` укажите адрес прокси внутри сети compose:
   ```dotenv
   TELEGRAM_PROXY=http://telegram-proxy:10809
   ```
3. Запустите (или обновите) стек с профилем `telegram-proxy`:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod --profile telegram-proxy up -d --build
   ```

Если `TELEGRAM_PROXY` пуст или не задан, `api` и `engine` обращаются к `api.telegram.org` напрямую, а профиль `telegram-proxy` указывать не нужно.

## Если Telegram не может достучаться до сервера

Если входящие запросы от Telegram к нашему HTTPS-webhook не доходят (например, `getWebhookInfo` возвращает `Connection timed out`), а исходящие к `api.telegram.org` работают через `TELEGRAM_PROXY`, переключите `api` на long polling (`getUpdates` по исходящему соединению через тот же прокси):

1. В `deploy/.env.prod` задайте:
   ```dotenv
   TELEGRAM_POLLING=1
   TELEGRAM_PROXY=http://telegram-proxy:10809
   ```
2. Перезапустите стек с профилем `telegram-proxy`:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod --profile telegram-proxy up -d
   ```

Переопубликовывать ботов не нужно: `api` при старте автоматически поднимает опрос для всех уже опубликованных ботов с подключением Telegram, а webhook снимается при запуске опроса и при следующей публикации.

Важно: при `TELEGRAM_POLLING=1` сервис `api` должен работать строго в одном экземпляре — несколько копий будут конфликтовать за `getUpdates`.

## Проверка без сервера

Нужен заполненный `deploy/.env.prod`. В production cookie помечены `secure`, поэтому войти по http://127.0.0.1:18180 нельзя; ожидаемая проверка — ответ 401 на `/api/auth/me`.

```bash
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.prod up -d --build
curl http://127.0.0.1:18180/                 # HTML SPA
curl -i http://127.0.0.1:18180/api/auth/me   # 401
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.prod down -v
```
