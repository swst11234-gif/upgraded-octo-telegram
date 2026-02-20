    setSearchingState();
    sendEvent({ type: 'find' });
  });

  socket.addEventListener('message', (event) => {
    handleServerEvent(event.data);
  });

  socket.addEventListener('close', () => {
    if (currentState === 'chat' || currentState === 'searching') {
      setDisconnectedState();
    }
  });

  socket.addEventListener('error', (error) => {
    console.error('WebSocket error', error);
  });
}

function sendEvent(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function handleServerEvent(rawData) {
  let payload;
  try {
    payload = JSON.parse(rawData);
  } catch (error) {
    console.error('Invalid server payload', error);
    return;
  }

  switch (payload.type) {
    case 'status':
      if (payload.status === 'searching') {
        setSearchingState();
      }
      if (payload.status === 'idle' && currentState !== 'landing') {
        setLandingState();
      }
      break;
    case 'matched':
      setChatState();
      break;
    case 'message':
      if (typeof payload.text === 'string') {
        appendMessage(payload.text, 'peer');
      }
      break;
    case 'disconnected':
      setDisconnectedState();
      break;
    case 'error':
      console.warn('Server error event:', payload.message || 'unknown error');
      break;
    default:
      break;
  }
}

function switchScreen(screenName) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle('is-active', key === screenName);
  });
}

function updateHeaderStatus(text, className) {
  statusPill.textContent = text;
  statusPill.className = `status-pill ${className}`;
}

function clearMessages() {
  messagesEl.innerHTML = '';
}

function appendMessage(text, role) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = text;
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLandingState() {
  currentState = 'landing';
  switchScreen('landing');
}

function setSearchingState() {
  currentState = 'searching';
  switchScreen('searching');
  updateHeaderStatus('Поиск', 'status-searching');
}

function setChatState() {
  currentState = 'chat';
  switchScreen('chat');
  updateHeaderStatus('Подключено', 'status-connected');
  messageInput.focus();
}

function setDisconnectedState() {
  currentState = 'disconnected';
  switchScreen('disconnected');
  updateHeaderStatus('Отключено', 'status-disconnected');
  clearMessages();
}

connectBtn.addEventListener('click', () => {
  connectSocket();
});

cancelBtn.addEventListener('click', () => {
  sendEvent({ type: 'cancel_find' });
  setLandingState();
});

disconnectBtn.addEventListener('click', () => {
  sendEvent({ type: 'disconnect' });
  setDisconnectedState();
});

reportBtn.addEventListener('click', () => {
  sendEvent({ type: 'report' });
  setDisconnectedState();
});

newChatBtn.addEventListener('click', () => {
  clearMessages();
  connectSocket();
  sendEvent({ type: 'find' });
  setSearchingState();
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  sendEvent({ type: 'message', text });
  appendMessage(text, 'self');
  messageInput.value = '';
  messageInput.focus();
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

window.addEventListener('beforeunload', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendEvent({ type: 'disconnect' });
  }
});
+});

