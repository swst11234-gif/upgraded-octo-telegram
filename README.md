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
- TTL тикета: 6 часов (после истечения тикет и ответы полностью удаляются из памяти)
- Сервер раз в 60 секунд удаляет просроченные тикеты и рассылает обновления

## Структура

- `client/` — статический фронтенд (GitHub Pages)
- `server/` — Node.js + `ws` (Render Web Service)

## Локальный запуск server

```bash
cd server
npm install
npm start
```

Сервер использует `PORT` из `process.env.PORT` (по умолчанию 3000).

## Локальный запуск client

Рекомендуемый вариант:

```bash
cd client
python3 -m http.server 8080
```

Откройте `http://localhost:8080`.

## Настройка WS_URL

В `client/app.js`:

```js
const WS_URL = '';
```

- Пусто: авто-подключение к текущему хосту (`ws://` или `wss://`)
- Для GitHub Pages укажите URL Render-сервиса:

```js
const WS_URL = 'wss://your-service-name.onrender.com';
```

## Deploy server на Render

Создайте **Web Service**:

- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

## Deploy client на GitHub Pages

Подойдут оба варианта:

1. Публиковать из `root` (если `client` перенесён в публикуемую директорию)
2. Публиковать через GitHub Actions из папки `client/` (или `/docs`, если копируете туда)

Важно: перед деплоем клиента выставьте `WS_URL` на `wss://...` адрес Render.
