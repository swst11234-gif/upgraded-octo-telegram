'use strict';

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const TICKET_TTL_MS = 6 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const CLOSED_TICKET_REMOVE_MS = 60 * 1000;
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 1000;
const MAX_REPLY_LENGTH = 500;
const RATE_LIMIT_MS = 300;

/** @type {Map<string, {
 * id: string,
 * category: 'help' | 'feedback',
 * title: string,
 * body: string,
 * authorSessionId: string,
 * createdAt: number,
 * expiresAt: number,
 * closed: boolean,
 * closedAt: number | null,
 * bestReplyId: string | null
 * }>} */
const tickets = new Map();

/** @type {Map<string, Array<{
 * id: string,
 * ticketId: string,
 * text: string,
 * sessionId: string,
 * createdAt: number
 * }>>} */
const repliesByTicket = new Map();

/** @type {Map<WebSocket, Set<string>>} */
const socketSubscriptions = new Map();

/** @type {Map<string, Set<WebSocket>>} */
const ticketSubscribers = new Map();

/** @type {Map<WebSocket, number>} */
const lastActionAt = new Map();

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function isRateLimited(ws) {
  const now = Date.now();
  const last = lastActionAt.get(ws) || 0;
  if (now - last < RATE_LIMIT_MS) {
    return true;
  }
  lastActionAt.set(ws, now);
  return false;
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function containsBlockedLink(text) {
  return /(https?:\/\/|t\.me\/|@\w+)/i.test(text);
}

function getTicketPublic(ticket) {
  const replies = repliesByTicket.get(ticket.id) || [];
  return {
    id: ticket.id,
    category: ticket.category,
    title: ticket.title,
    body: ticket.body,
    authorSessionId: ticket.authorSessionId,
    createdAt: ticket.createdAt,
    expiresAt: ticket.expiresAt,
    closed: ticket.closed,
    closedAt: ticket.closedAt,
    bestReplyId: ticket.bestReplyId,
    repliesCount: replies.length,
  };
}

function getLiveTicketsList() {
  const now = Date.now();
  const list = [];

  for (const ticket of tickets.values()) {
    if (ticket.expiresAt > now) {
      list.push(getTicketPublic(ticket));
    }
  }

  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

function broadcastTicketsList() {
  const payload = { type: 'tickets', tickets: getLiveTicketsList() };
  for (const client of wss.clients) {
    sendJson(client, payload);
  }
}

function subscribeSocketToTicket(ws, ticketId) {
  let socketSet = socketSubscriptions.get(ws);
  if (!socketSet) {
    socketSet = new Set();
    socketSubscriptions.set(ws, socketSet);
  }
  socketSet.add(ticketId);

  let subscribers = ticketSubscribers.get(ticketId);
  if (!subscribers) {
    subscribers = new Set();
    ticketSubscribers.set(ticketId, subscribers);
  }
  subscribers.add(ws);
}

function unsubscribeSocketFromTicket(ws, ticketId) {
  const socketSet = socketSubscriptions.get(ws);
  if (socketSet) {
    socketSet.delete(ticketId);
    if (socketSet.size === 0) {
      socketSubscriptions.delete(ws);
    }
  }

  const subscribers = ticketSubscribers.get(ticketId);
  if (subscribers) {
    subscribers.delete(ws);
    if (subscribers.size === 0) {
      ticketSubscribers.delete(ticketId);
    }
  }
}

function unsubscribeSocketFromAll(ws) {
  const subscribed = socketSubscriptions.get(ws);
  if (!subscribed) return;

  for (const ticketId of subscribed) {
    const subscribers = ticketSubscribers.get(ticketId);
    if (!subscribers) continue;
    subscribers.delete(ws);
    if (subscribers.size === 0) {
      ticketSubscribers.delete(ticketId);
    }
  }

  socketSubscriptions.delete(ws);
}

function broadcastTicketEvent(ticketId, payload) {
  const subscribers = ticketSubscribers.get(ticketId);
  if (!subscribers) return;

  for (const ws of subscribers) {
    sendJson(ws, payload);
  }
}

function removeTicket(ticketId) {
  tickets.delete(ticketId);
  repliesByTicket.delete(ticketId);

  const subscribers = ticketSubscribers.get(ticketId);
  if (subscribers) {
    for (const ws of subscribers) {
      const socketSet = socketSubscriptions.get(ws);
      if (socketSet) {
        socketSet.delete(ticketId);
        if (socketSet.size === 0) {
          socketSubscriptions.delete(ws);
        }
      }
      sendJson(ws, { type: 'ticket_deleted', ticketId });
    }
    ticketSubscribers.delete(ticketId);
  }
}

function cleanupExpiredTickets() {
  const now = Date.now();
  let removed = false;

  for (const [ticketId, ticket] of tickets.entries()) {
    const expiredByTtl = ticket.expiresAt <= now;
    const expiredByClosedAge = ticket.closed && ticket.closedAt && now - ticket.closedAt >= CLOSED_TICKET_REMOVE_MS;

    if (expiredByTtl || expiredByClosedAge) {
      removeTicket(ticketId);
      removed = true;
    }
  }

  if (removed) {
    broadcastTicketsList();
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, service: 'updated-octo-telegram-ticket-server' }));
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  sendJson(ws, { type: 'tickets', tickets: getLiveTicketsList() });

  ws.on('message', (rawBuffer) => {
    let payload;
    try {
      payload = JSON.parse(rawBuffer.toString());
    } catch {
      sendJson(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    if (!payload || typeof payload.type !== 'string') {
      return;
    }

    if ([
      'create_ticket',
      'post_reply',
      'close_ticket',
      'mark_best_reply',
    ].includes(payload.type) && isRateLimited(ws)) {
      sendJson(ws, { type: 'warn', message: 'Too many actions. Try again shortly.' });
      return;
    }

    if (payload.type === 'list_tickets') {
      sendJson(ws, { type: 'tickets', tickets: getLiveTicketsList() });
      return;
    }

    if (payload.type === 'create_ticket') {
      const category = payload.category === 'feedback' ? 'feedback' : payload.category === 'help' ? 'help' : '';
      const title = sanitizeText(payload.title);
      const body = sanitizeText(payload.body);
      const authorSessionId = sanitizeText(payload.authorSessionId);

      if (!category || !title || !body || !authorSessionId) {
        sendJson(ws, { type: 'error', message: 'Invalid create_ticket payload' });
        return;
      }

      if (title.length > MAX_TITLE_LENGTH || body.length > MAX_BODY_LENGTH) {
        sendJson(ws, { type: 'error', message: 'Ticket is too long' });
        return;
      }

      if (containsBlockedLink(title) || containsBlockedLink(body)) {
        sendJson(ws, { type: 'warn', message: 'Links are temporarily blocked' });
        return;
      }

      const now = Date.now();
      const ticket = {
        id: genId('t'),
        category,
        title,
        body,
        authorSessionId,
        createdAt: now,
        expiresAt: now + TICKET_TTL_MS,
        closed: false,
        closedAt: null,
        bestReplyId: null,
      };

      tickets.set(ticket.id, ticket);
      repliesByTicket.set(ticket.id, []);
      broadcastTicketsList();
      return;
    }

    if (payload.type === 'join_ticket') {
      const ticketId = sanitizeText(payload.ticketId);
      const ticket = tickets.get(ticketId);

      if (!ticket) {
        sendJson(ws, { type: 'error', message: 'Ticket not found' });
        return;
      }

      if (ticket.expiresAt <= Date.now()) {
        removeTicket(ticketId);
        broadcastTicketsList();
        sendJson(ws, { type: 'error', message: 'Ticket expired' });
        return;
      }

      subscribeSocketToTicket(ws, ticketId);
      sendJson(ws, {
        type: 'ticket_state',
        ticket: getTicketPublic(ticket),
        replies: repliesByTicket.get(ticketId) || [],
      });
      return;
    }

    if (payload.type === 'leave_ticket') {
      const ticketId = sanitizeText(payload.ticketId);
      if (ticketId) {
        unsubscribeSocketFromTicket(ws, ticketId);
      }
      return;
    }

    if (payload.type === 'post_reply') {
      const ticketId = sanitizeText(payload.ticketId);
      const text = sanitizeText(payload.text);
      const sessionId = sanitizeText(payload.sessionId);
      const ticket = tickets.get(ticketId);

      if (!ticket || !text || !sessionId) {
        sendJson(ws, { type: 'error', message: 'Invalid reply payload' });
        return;
      }

      if (ticket.closed) {
        sendJson(ws, { type: 'warn', message: 'Ticket is closed' });
        return;
      }

      if (text.length > MAX_REPLY_LENGTH) {
        sendJson(ws, { type: 'warn', message: 'Reply is too long' });
        return;
      }

      if (containsBlockedLink(text)) {
        sendJson(ws, { type: 'warn', message: 'Links are temporarily blocked' });
        return;
      }

      const reply = {
        id: genId('r'),
        ticketId,
        text,
        sessionId,
        createdAt: Date.now(),
      };

      const replies = repliesByTicket.get(ticketId) || [];
      replies.push(reply);
      repliesByTicket.set(ticketId, replies);

      broadcastTicketEvent(ticketId, { type: 'new_reply', ticketId, reply });
      broadcastTicketsList();
      return;
    }

    if (payload.type === 'close_ticket') {
      const ticketId = sanitizeText(payload.ticketId);
      const sessionId = sanitizeText(payload.sessionId);
      const ticket = tickets.get(ticketId);

      if (!ticket || !sessionId) {
        sendJson(ws, { type: 'error', message: 'Invalid close_ticket payload' });
        return;
      }

      if (ticket.authorSessionId !== sessionId) {
        sendJson(ws, { type: 'warn', message: 'Only author can close ticket' });
        return;
      }

      ticket.closed = true;
      ticket.closedAt = Date.now();
      broadcastTicketEvent(ticketId, { type: 'ticket_updated', ticket: getTicketPublic(ticket) });
      broadcastTicketsList();
      return;
    }

    if (payload.type === 'mark_best_reply') {
      const ticketId = sanitizeText(payload.ticketId);
      const replyId = sanitizeText(payload.replyId);
      const sessionId = sanitizeText(payload.sessionId);
      const ticket = tickets.get(ticketId);

      if (!ticket || !replyId || !sessionId) {
        sendJson(ws, { type: 'error', message: 'Invalid mark_best_reply payload' });
        return;
      }

      if (ticket.authorSessionId !== sessionId) {
        sendJson(ws, { type: 'warn', message: 'Only author can mark best reply' });
        return;
      }

      const replies = repliesByTicket.get(ticketId) || [];
      const exists = replies.some((reply) => reply.id === replyId);
      if (!exists) {
        sendJson(ws, { type: 'error', message: 'Reply not found' });
        return;
      }

      ticket.bestReplyId = replyId;
      broadcastTicketEvent(ticketId, { type: 'ticket_updated', ticket: getTicketPublic(ticket) });
      broadcastTicketsList();
      return;
    }

    sendJson(ws, { type: 'error', message: 'Unknown event type' });
  });

  ws.on('close', () => {
    unsubscribeSocketFromAll(ws);
    lastActionAt.delete(ws);
  });

  ws.on('error', () => {
    unsubscribeSocketFromAll(ws);
    lastActionAt.delete(ws);
  });
});

setInterval(cleanupExpiredTickets, CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Ticket server listening on ${PORT}`);
});
