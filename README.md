# updated octo telegram

MVP веб-приложение для анонимного текстового чата 1-на-1 в реальном времени.

- Без аккаунтов
- Без БД и без сохранения сообщений в файлы
- Все данные живут только в памяти процесса сервера на время активной сессии

## Структура проекта

- `client/` — статический фронтенд (HTML/CSS/Vanilla JS)
- `server/` — Node.js + `ws` сервер

## Локальный запуск сервера

```bash
cd server
npm install
npm start
```

По умолчанию сервер запускается на `http://localhost:3000` и WebSocket на том же порту.

## Локальный запуск клиента

Варианты:

1. Открыть `client/index.html` напрямую через `file://` **если** в `client/app.js` явно задан внешний `WS_URL`.
2. Запустить любой статический сервер для папки `client` (рекомендуется), например:

```bash
cd client
python3 -m http.server 8080
```

После этого открыть `http://localhost:8080` в браузере.

## Настройка WebSocket URL на клиенте

В файле `client/app.js` есть константа:

```js
const WS_URL = '';
```

- Если оставить пустой строкой, клиент автоматически использует текущий host страницы:
  - `wss://` для `https`
  - `ws://` для `http`
- Для GitHub Pages нужно указать URL вашего Render-сервера, например:

```js
const WS_URL = 'wss://your-service-name.onrender.com';
```

## Deploy сервера на Render (Web Service)

Создайте Web Service из этого репозитория со следующими параметрами:

- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

Сервер использует `process.env.PORT`, совместимо с Render.

## Deploy клиента на GitHub Pages

Есть два простых варианта:

1. Публиковать папку `client/` через GitHub Pages (например, через GitHub Actions, где в artifact кладётся содержимое `client`).
2. Или вручную копировать содержимое `client/` в ветку/папку, которую публикует Pages.

Перед публикацией обязательно пропишите `WS_URL` в `client/app.js` на URL Render-сервера (`wss://...`).
