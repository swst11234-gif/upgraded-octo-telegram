# updated octo telegram — Build 02 (Tickets)

MVP веб-приложение для realtime тикетов (help/feedback) через WebSocket.

- Без аккаунтов
- Без БД
- Без сохранения сообщений/логов в файлы
- Все данные живут только в памяти процесса сервера

## Что умеет Build 02

- Создание тикета: `category` (`help|feedback`), `title` (до 80), `body` (до 1000)
- Общая лента тикетов для всех подключённых пользователей
- Просмотр конкретного тикета и ответы в реальном времени
- Автор тикета может:
  - закрыть тикет
  - отметить один ответ как `✅ помогло`
- TTL тикета: 6 часов; если тикет закрыт, он удаляется быстрее — через ~60 секунд после закрытия
- Сервер раз в 60 секунд удаляет просроченные тикеты и рассылает обновления

## Структура

- `docs/` — статический фронтенд (GitHub Pages)
- `server/` — Node.js + `ws` (Render Web Service)

## Локальный запуск server

```bash
cd server
npm install
npm start
```

Сервер использует `PORT` из `process.env.PORT` (по умолчанию 3000).

## Локальный запуск docs (frontend)

Рекомендуемый вариант:

```bash
cd docs
python3 -m http.server 8080
```

Откройте `http://localhost:8080`.

## Настройка WS_URL

В `docs/app.js`:

```js
const WS_URL = '';
```

- Пусто: авто-подключение к текущему хосту (`ws://` или `wss://`)
- Для GitHub Pages обязательно укажите URL Render-сервиса (иначе клиент попытается подключиться к `github.io`, где WebSocket-сервера нет):

```js
const WS_URL = 'wss://your-service-name.onrender.com';
```

- Быстрый способ проверить без нового деплоя: откройте сайт с параметром `?ws=wss://your-service-name.onrender.com` — клиент запомнит этот URL в `localStorage` для следующих заходов.

## Deploy server на Render

Создайте **Web Service**:

- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

## Deploy docs на GitHub Pages

Подойдут оба варианта:

Публикуйте сайт из папки `docs/` (Settings → Pages → Build and deployment → Deploy from a branch, выбрать ветку и `/docs`).

Альтернатива: через GitHub Actions, публикуя содержимое `docs/` как artifact.

Важно: перед деплоем клиента выставьте `WS_URL` на `wss://...` адрес Render.
