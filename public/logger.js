// public/logger.js
let currentSessionStart = null;

function initLogger(username, ip) {
  currentSessionStart = new Date().toISOString();
  const textarea = document.getElementById('logTextarea');
  const input = document.getElementById('myInput');
  if (!input) return;

  const collected = [];
  let isComposing = false;

  const makeEntry = (word, source) => ({ word, source, time: new Date().toISOString() });

  const appendToTextarea = (entry) => {
    if (!textarea) return;
    const date = new Date(entry.time);
    const line = `[${date.toTimeString().slice(0,8)}.${date.getMilliseconds().toString().padStart(3,'0')}] ${entry.source}: ${entry.word}`;
    textarea.value = textarea.value.trim() === '' ? line + '\n' : textarea.value + line + '\n';
    textarea.scrollTop = textarea.scrollHeight;
  };

  const sendLogs = async () => {
    if (collected.length === 0) return;
    try {
      await fetch('/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, ip, entries: collected, sessionStart: currentSessionStart })
      });
    } catch (err) {
      console.warn('sendLogs err', err);
    }
  };

  const processTokens = (tokens, source, keepLast = false) => {
    if (!tokens || tokens.length === 0) return '';
    let last = '';
    if (keepLast) last = tokens.pop();
    tokens.forEach(tok => {
      const entry = makeEntry(tok, source);
      collected.push(entry);
      appendToTextarea(entry);
    });
    // send right away (could be debounced)
    sendLogs();
    return last;
  };

  input.addEventListener('compositionstart', ()=> isComposing = true);
  input.addEventListener('compositionend', ()=> isComposing = false);

  input.addEventListener('input', (e) => {
    if (isComposing) return;
    const v = e.target.value;
    if (!v) return;
    if (/\s/.test(v)) {
      const trailing = /\s$/.test(v);
      const tokens = v.split(/\s+/).filter(Boolean);
      const keepLast = !trailing;
      e.target.value = processTokens(tokens, 'typed', keepLast);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value.trim();
      if (v !== '') {
        input.value = '';
        const entry = makeEntry(v, 'enter');
        collected.push(entry);
        appendToTextarea(entry);
        sendLogs();
      }
    }
  });

  input.addEventListener('paste', () => {
    setTimeout(() => {
      if (isComposing) return;
      const v = input.value;
      if (!v) return;
      const tokens = v.split(/\s+/).filter(Boolean);
      input.value = processTokens(tokens, 'paste', true);
    }, 0);
  });

  input.addEventListener('blur', () => {
    if (isComposing) return;
    const v = input.value.trim();
    if (v !== '') {
      input.value = '';
      const entry = makeEntry(v, 'blur');
      collected.push(entry);
      appendToTextarea(entry);
      sendLogs();
    }
  });

  // optional: periodically flush logs
  setInterval(sendLogs, 10_000);
}