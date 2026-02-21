'use strict';

// For GitHub Pages set your Render endpoint explicitly, for example:
// const WS_URL = 'wss://your-service.onrender.com';
const WS_URL = '';

const screens = {
  feed: document.getElementById('screen-feed'),
  create: document.getElementById('screen-create'),
  ticket: document.getElementById('screen-ticket'),
};

const feedList = document.getElementById('feed-list');
const repliesList = document.getElementById('replies-list');
const ticketMeta = document.getElementById('ticket-meta');
const warningEl = document.getElementById('warning');

const openCreateBtn = document.getElementById('open-create-btn');
const cancelCreateBtn = document.getElementById('cancel-create-btn');
const backToFeedBtn = document.getElementById('back-to-feed-btn');
const closeTicketBtn = document.getElementById('close-ticket-btn');

const createForm = document.getElementById('create-form');
const categoryInput = document.getElementById('category-input');
const titleInput = document.getElementById('title-input');
const bodyInput = document.getElementById('body-input');

const replyForm = document.getElementById('reply-form');
const replyInput = document.getElementById('reply-input');

const sessionId = getOrCreateSessionId();
let socket;
let isConnected = false;
let currentTicketId = null;
let currentTicket = null;
let currentReplies = [];

function getOrCreateSessionId() {
  const key = 'uot_session_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `sess_${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function resolveWsUrl() {
  if (WS_URL) return WS_URL;

  // On GitHub Pages current host is github.io and not your Render websocket server.
  if (window.location.hostname.endsWith('github.io')) {
    return null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function connect() {
  const targetWsUrl = resolveWsUrl();
  if (!targetWsUrl) {
    showWarning(
      'Для GitHub Pages укажите WS_URL в docs/app.js (wss://<ваш-render-сервис>.onrender.com).',
      { persist: true }
    );
    return;
  }

  try {
    socket = new WebSocket(targetWsUrl);
  } catch {
    showWarning('Не удалось создать WebSocket. Проверьте WS_URL.', { persist: true });
    return;
  }

  socket.addEventListener('open', () => {
    isConnected = true;
    hideWarning();
    send({ type: 'list_tickets' });
  });

  socket.addEventListener('message', (event) => {
    handleMessage(event.data);
  });

  socket.addEventListener('close', () => {
    isConnected = false;
    showWarning('Соединение с сервером потеряно.', { persist: true });
  });

  socket.addEventListener('error', () => {
    showWarning('Ошибка WebSocket. Проверьте WS_URL и сервер Render.', { persist: true });
  });
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showWarning('Нет соединения с сервером.', { persist: false });
    return;
  }
  socket.send(JSON.stringify(payload));
}

function handleMessage(rawData) {
  let payload;
  try {
    payload = JSON.parse(rawData);
  } catch {
    showWarning('Некорректный ответ от сервера.');
    return;
  }

  if (payload.type === 'tickets') {
    renderTickets(payload.tickets || []);
    return;
  }

  if (payload.type === 'ticket_state') {
    currentTicket = payload.ticket || null;
    currentReplies = payload.replies || [];
    renderTicketScreen();
    return;
  }

  if (payload.type === 'new_reply' && payload.ticketId === currentTicketId) {
    currentReplies.push(payload.reply);
    if (currentTicket) currentTicket.repliesCount = currentReplies.length;
    renderTicketScreen();
    return;
  }

  if (payload.type === 'ticket_updated' && currentTicket && payload.ticket.id === currentTicket.id) {
    currentTicket = payload.ticket;
    renderTicketScreen();
    return;
  }

  if (payload.type === 'ticket_deleted' && payload.ticketId === currentTicketId) {
    currentTicketId = null;
    currentTicket = null;
    currentReplies = [];
    showScreen('feed');
    showWarning('Тикет истёк и удалён по TTL.');
    send({ type: 'list_tickets' });
    return;
  }

  if (payload.type === 'warn' || payload.type === 'error') {
    showWarning(payload.message || 'Ошибка действия.');
  }
}

function hasBlockedLink(text) {
  return /(https?:\/\/|t\.me\/|@\w+)/i.test(text);
}

function hideWarning() {
  warningEl.classList.add('hidden');
  warningEl.textContent = '';
  window.clearTimeout(showWarning.timer);
}

function showWarning(text, options = {}) {
  const persist = options.persist === true;
  warningEl.textContent = text;
  warningEl.classList.remove('hidden');
  window.clearTimeout(showWarning.timer);

  if (!persist) {
    showWarning.timer = window.setTimeout(() => warningEl.classList.add('hidden'), 2800);
  }
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('is-active', key === name);
  });
}

function formatLeft(expiresAt) {
  const ms = Math.max(0, expiresAt - Date.now());
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours > 0) return `${hours}ч ${rest}м`;
  return `${rest}м`;
}

function renderTickets(tickets) {
  if (!tickets.length) {
    feedList.innerHTML = '<div class="panel">Пока нет тикетов.</div>';
    return;
  }

  feedList.innerHTML = '';
  for (const ticket of tickets) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ticket-item';
    item.innerHTML = `
      <div class="ticket-meta">
        <span class="badge ${ticket.category}">${ticket.category}</span>
        ${ticket.closed ? '<span class="badge closed">closed</span>' : ''}
        ${ticket.bestReplyId ? '<span class="badge best">best selected</span>' : ''}
      </div>
      <h4>${escapeHtml(ticket.title)}</h4>
      <p>${escapeHtml(ticket.body.slice(0, 120))}${ticket.body.length > 120 ? '…' : ''}</p>
      <div class="ticket-row">
        <span>Ответов: ${ticket.repliesCount}</span>
        <span>TTL: ${formatLeft(ticket.expiresAt)}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      if (!isConnected) {
        showWarning('Нет соединения с сервером.', { persist: false });
        return;
      }

      currentTicketId = ticket.id;
      send({ type: 'join_ticket', ticketId: ticket.id });
      showScreen('ticket');
    });

    feedList.appendChild(item);
  }
}

function renderTicketScreen() {
  if (!currentTicket) return;

  const isAuthor = currentTicket.authorSessionId === sessionId;
  closeTicketBtn.classList.toggle('hidden', !isAuthor || currentTicket.closed);

  ticketMeta.innerHTML = `
    <div class="ticket-meta">
      <span class="badge ${currentTicket.category}">${currentTicket.category}</span>
      ${currentTicket.closed ? '<span class="badge closed">closed</span>' : ''}
      ${currentTicket.bestReplyId ? '<span class="badge best">best selected</span>' : ''}
      <span class="badge">TTL: ${formatLeft(currentTicket.expiresAt)}</span>
    </div>
    <h3>${escapeHtml(currentTicket.title)}</h3>
    <p>${escapeHtml(currentTicket.body)}</p>
  `;

  repliesList.innerHTML = '';
  if (!currentReplies.length) {
    repliesList.innerHTML = '<div class="panel">Пока нет ответов.</div>';
    return;
  }

  for (const reply of currentReplies) {
    const item = document.createElement('div');
    item.className = 'reply-item';
    const isBest = currentTicket.bestReplyId === reply.id;

    item.innerHTML = `
      <div class="reply-header">
        <div class="ticket-row">
          <span class="badge">${reply.sessionId === sessionId ? 'Вы' : 'Пользователь'}</span>
          ${isBest ? '<span class="badge best">✅ помогло</span>' : ''}
        </div>
      </div>
      <p>${escapeHtml(reply.text)}</p>
    `;

    if (isAuthor && !currentTicket.closed) {
      const markBtn = document.createElement('button');
      markBtn.type = 'button';
      markBtn.className = 'btn';
      markBtn.textContent = '✅ помогло';
      markBtn.addEventListener('click', () => {
        send({ type: 'mark_best_reply', ticketId: currentTicket.id, replyId: reply.id, sessionId });
      });
      item.querySelector('.reply-header').appendChild(markBtn);
    }

    repliesList.appendChild(item);
  }
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

openCreateBtn.addEventListener('click', () => {
  showScreen('create');
});

cancelCreateBtn.addEventListener('click', () => {
  showScreen('feed');
});

backToFeedBtn.addEventListener('click', () => {
  if (currentTicketId) {
    send({ type: 'leave_ticket', ticketId: currentTicketId });
  }
  currentTicketId = null;
  currentTicket = null;
  currentReplies = [];
  showScreen('feed');
  send({ type: 'list_tickets' });
});

createForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const category = categoryInput.value;
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  if (!title || !body) return;

  if (hasBlockedLink(title) || hasBlockedLink(body)) {
    showWarning('Ссылки временно запрещены.');
    return;
  }

  send({ type: 'create_ticket', category, title, body, authorSessionId: sessionId });
  createForm.reset();
  categoryInput.value = 'help';
  showScreen('feed');
});

replyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!currentTicket) return;

  const text = replyInput.value.trim();
  if (!text) return;

  if (text.length > 500) {
    showWarning('Максимум 500 символов.');
    return;
  }

  if (hasBlockedLink(text)) {
    showWarning('Ссылки временно запрещены.');
    return;
  }

  send({ type: 'post_reply', ticketId: currentTicket.id, text, sessionId });
  replyInput.value = '';
});

closeTicketBtn.addEventListener('click', () => {
  if (!currentTicket) return;
  send({ type: 'close_ticket', ticketId: currentTicket.id, sessionId });
});

connect();
showScreen('feed');
