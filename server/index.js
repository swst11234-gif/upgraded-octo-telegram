'use strict';

const http = require('http');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const MAX_MESSAGE_LENGTH = 500;
const MIN_MESSAGE_INTERVAL_MS = 300;

// FIFO queue for clients waiting for a partner.
const waitingQueue = [];

// Active 1-on-1 pair connections: socket -> partnerSocket.
const partners = new Map();

// Simple per-socket anti-spam timestamp.
const lastMessageAt = new Map();

/**
 * Send JSON to socket if still open.
 * @param {WebSocket} socket
 * @param {Record<string, unknown>} payload
 */
function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/**
 * Remove socket from waiting queue if it exists there.
 * @param {WebSocket} socket
 */
function removeFromQueue(socket) {
  const index = waitingQueue.indexOf(socket);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

/**
 * Get a waiting socket that is open and not same socket.
 * @param {WebSocket} socket
 * @returns {WebSocket | undefined}
 */
function getNextAvailablePartner(socket) {
  while (waitingQueue.length > 0) {
    const candidate = waitingQueue.shift();
    if (!candidate || candidate === socket) {
      continue;
    }
    if (candidate.readyState === WebSocket.OPEN && !partners.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Break active pair for a socket and notify both sides.
 * @param {WebSocket} socket
 * @param {string} reason
 */
function disconnectPair(socket, reason = 'disconnected') {
  const partner = partners.get(socket);
  if (!partner) {
    return;
  }

  partners.delete(socket);
  partners.delete(partner);

  sendJson(socket, { type: 'disconnected', reason });
  sendJson(partner, { type: 'disconnected', reason });
}

/**
 * Handle find request: enqueue or pair instantly.
 * @param {WebSocket} socket
 */
function handleFind(socket) {
  if (partners.has(socket)) {
    return;
  }

  removeFromQueue(socket);

  const partner = getNextAvailablePartner(socket);
  if (!partner) {
    waitingQueue.push(socket);
    sendJson(socket, { type: 'status', status: 'searching' });
    return;
  }

  partners.set(socket, partner);
  partners.set(partner, socket);

  sendJson(socket, { type: 'matched' });
  sendJson(partner, { type: 'matched' });
}

/**
 * Handle incoming message and forward it to active partner.
 * @param {WebSocket} socket
 * @param {unknown} rawText
 */
function handleMessage(socket, rawText) {
  if (typeof rawText !== 'string') {
    return;
  }

  const text = rawText.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    return;
  }

  const now = Date.now();
  const lastAt = lastMessageAt.get(socket) || 0;
  if (now - lastAt < MIN_MESSAGE_INTERVAL_MS) {
    return;
  }

  const partner = partners.get(socket);
  if (!partner || partner.readyState !== WebSocket.OPEN) {
    return;
  }

  lastMessageAt.set(socket, now);
  sendJson(partner, { type: 'message', text });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, service: 'updated-octo-telegram-server' }));
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  sendJson(socket, { type: 'status', status: 'idle' });

  socket.on('message', (messageBuffer) => {
    let payload;
    try {
      payload = JSON.parse(messageBuffer.toString());
    } catch {
      sendJson(socket, { type: 'error', message: 'Invalid JSON payload' });
      return;
    }

    if (!payload || typeof payload.type !== 'string') {
      return;
    }

    switch (payload.type) {
      case 'find':
        handleFind(socket);
        break;
      case 'cancel_find':
        removeFromQueue(socket);
        sendJson(socket, { type: 'status', status: 'idle' });
        break;
      case 'message':
        handleMessage(socket, payload.text);
        break;
      case 'disconnect':
        disconnectPair(socket, 'disconnected');
        removeFromQueue(socket);
        sendJson(socket, { type: 'status', status: 'idle' });
        break;
      case 'report':
        disconnectPair(socket, 'reported');
        removeFromQueue(socket);
        sendJson(socket, { type: 'status', status: 'idle' });
        break;
      default:
        sendJson(socket, { type: 'error', message: 'Unknown event type' });
    }
  });

  socket.on('close', () => {
    removeFromQueue(socket);
    disconnectPair(socket, 'disconnected');
    partners.delete(socket);
    lastMessageAt.delete(socket);
  });

  socket.on('error', () => {
    removeFromQueue(socket);
    disconnectPair(socket, 'disconnected');
    partners.delete(socket);
    lastMessageAt.delete(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
