// SolusCipher Chat Widget — loads dynamically on client websites
(function() {
  const host = window.SolusCipherChat?.endpoint || location.origin;
  const css = `
    .sc-chat{position:fixed;bottom:20px;right:20px;z-index:999999;font-family:'DM Sans',sans-serif}
    .sc-toggle{width:60px;height:60px;background:#c9a84c;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:transform 0.2s}
    .sc-toggle:hover{transform:scale(1.05)}
    .sc-window{position:fixed;bottom:90px;right:20px;width:380px;height:520px;background:#112240;border:1px solid rgba(201,168,76,0.3);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);display:none;flex-direction:column}
    .sc-window.open{display:flex}
    .sc-head{background:${window.SolusCipherChat?.color || '#c9a84c'};color:#0a1628;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-radius:8px 8px 0 0}
    .sc-head-left{display:flex;align-items:center;gap:10px}
    .sc-avatar{width:32px;height:32px;background:#0a1628;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#c9a84c}
    .sc-info div:first-child{font-weight:700;font-size:14px}
    .sc-info div:last-child{font-size:11px;opacity:0.7}
    .sc-close{background:none;border:none;font-size:20px;color:#0a1628;cursor:pointer}
    .sc-messages{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#0a1628}
    .sc-msg{padding:10px 13px;border-radius:12px;max-width:80%;font-size:13px;line-height:1.5}
    .sc-bot{background:#112240;border:1px solid rgba(201,168,76,0.2);align-self:flex-start;border-radius:4px 12px 12px 12px;color:#f0efe9}
    .sc-user{background:#c9a84c;color:#0a1628;align-self:flex-end;border-radius:12px 4px 12px 12px;font-weight:500}
    .sc-input-row{display:flex;gap:6px;padding:10px;border-top:1px solid rgba(201,168,76,0.2);background:#112240;border-radius:0 0 8px 8px}
    .sc-input{flex:1;padding:8px 11px;border:1px solid rgba(201,168,76,0.3);border-radius:4px;background:#0a1628;color:#f0efe9;outline:none;font-size:13px}
    .sc-input:focus{border-color:#c9a84c}
    .sc-send{background:#c9a84c;color:#0a1628;border:none;border-radius:4px;padding:0 14px;font-weight:700;cursor:pointer}
    .sc-send:disabled{opacity:0.5;cursor:not-allowed}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.innerHTML = `
    <div class="sc-chat">
      <div class="sc-window" id="sc-window">
        <div class="sc-head">
          <div class="sc-head-left">
            <div class="sc-avatar">${(window.SolusCipherChat?.botName||'Bot').charAt(0).toUpperCase()}</div>
            <div class="sc-info">
              <div>${window.SolusCipherChat?.botName || 'AI Assistant'}</div>
              <div>Online · SolusCipher AI</div>
            </div>
          </div>
          <button class="sc-close" id="sc-close">×</button>
        </div>
        <div class="sc-messages" id="sc-messages"></div>
        <div class="sc-input-row">
          <input class="sc-input" id="sc-input" placeholder="Type a message..." />
          <button class="sc-send" id="sc-send">↑</button>
        </div>
      </div>
      <div class="sc-toggle" id="sc-toggle">💬</div>
    </div>
  `;
  document.body.appendChild(container);

  const state = {
    open: false,
    history: [],
    ended: false,
  };

  const el = (id) => document.getElementById(id);
  const msgs = el('sc-messages');
  const win = el('sc-window');
  const toggle = el('sc-toggle');
  const close = el('sc-close');
  const input = el('sc-input');
  const send = el('sc-send');

  function addMsg(text, isUser = false) {
    const div = document.createElement('div');
    div.className = `sc-msg ${isUser ? 'sc-user' : 'sc-bot'}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'sc-msg sc-bot';
    div.id = 'sc-typing';
    div.textContent = '...';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    const t = el('sc-typing');
    if (t) t.remove();
  }

  toggle.onclick = () => {
    state.open = !state.open;
    win.classList.toggle('open', state.open);
    if (state.open && msgs.children.length === 0) {
      addMsg(window.SolusCipherChat?.welcome || 'Hi! 👋 How can I help you today?');
    }
  };
  close.onclick = () => { state.open = false; win.classList.remove('open'); };

  async function send() {
    const text = input.value.trim();
    if (!text || state.ended) return;
    input.value = '';
    addMsg(text, true);
    state.history.push({ role: 'user', content: text });
    send.disabled = true;
    addTyping();

    try {
      const endpoint = `${host}/chat/${window.SolusCipherChat?.provider || 'groq'}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.history,
          system: window.SolusCipherChat?.system || 'You are a helpful assistant.',
          model: window.SolusCipherChat?.model || ''
        })
      });
      const data = await res.json();
      removeTyping();
      if (data.reply) {
        state.history.push({ role: 'assistant', content: data.reply });
        addMsg(data.reply);
      } else {
        addMsg('Sorry, I had an issue. Please refresh.');
        state.ended = true;
      }
    } catch (err) {
      removeTyping();
      addMsg('Connection error. Please try again.');
      state.ended = true;
    }
    send.disabled = false;
  }

  send.onclick = send;
  input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
})();
