(function() {
  var pokerState = null;
  var timelineSeen = null;

  function ensureUi() {
    if (document.getElementById('la-holdem-root')) return;
    var lobby = document.querySelector('#calls-tab-lounge .la-lobby');
    if (!lobby) return;

    var style = document.createElement('style');
    style.textContent = `
      .pp-holdem-shell { position:relative; overflow:hidden; margin:20px 0; padding:18px; border-radius:24px; background:
        radial-gradient(circle at 50% 20%, rgba(0,255,255,.18), transparent 30%),
        radial-gradient(circle at 50% 100%, rgba(99,102,241,.18), transparent 35%),
        linear-gradient(180deg, #08111f 0%, #050913 100%);
        border:1px solid rgba(99,102,241,.25); box-shadow:0 30px 80px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.03);
      }
      .pp-holdem-head { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
      .pp-holdem-title { font-size:18px; font-weight:800; letter-spacing:.08em; color:#dbeafe; text-transform:uppercase; }
      .pp-holdem-sub { font-size:12px; color:#94a3b8; }
      .pp-holdem-actions { display:flex; gap:10px; flex-wrap:wrap; }
      .pp-holdem-btn { border:none; border-radius:12px; padding:10px 14px; font:inherit; font-weight:700; cursor:pointer; color:#fff; background:linear-gradient(135deg,#0ea5e9,#2563eb); }
      .pp-holdem-btn.secondary { background:rgba(255,255,255,.06); color:#dbeafe; border:1px solid rgba(255,255,255,.1); }
      .pp-holdem-btn:disabled { opacity:.45; cursor:not-allowed; }
      .pp-holdem-scene { position:relative; height:520px; perspective:1400px; }
      .pp-holdem-table { position:absolute; inset:68px 24px 70px; border-radius:50% / 38%; transform:rotateX(62deg); transform-style:preserve-3d;
        background:
          radial-gradient(circle at 50% 45%, rgba(16,185,129,.25), rgba(6,78,59,.95) 62%, rgba(3,7,18,.96) 64%, rgba(71,85,105,.9) 68%, rgba(2,6,23,1) 76%);
        box-shadow:0 40px 80px rgba(0,0,0,.65), inset 0 0 35px rgba(255,255,255,.08);
      }
      .pp-pot { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; z-index:2; }
      .pp-pot-label { color:#93c5fd; font-size:11px; letter-spacing:.18em; text-transform:uppercase; }
      .pp-pot-val { color:#fff; font-size:24px; font-weight:800; margin-top:6px; }
      .pp-board { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); display:flex; gap:10px; z-index:3; margin-top:68px; }
      .pp-card { width:54px; height:78px; border-radius:10px; border:1px solid rgba(255,255,255,.14); display:flex; align-items:center; justify-content:center;
        background:linear-gradient(180deg, rgba(255,255,255,.96), rgba(226,232,240,.92)); color:#111827; font-size:18px; font-weight:800; box-shadow:0 12px 24px rgba(0,0,0,.28); }
      .pp-card.back { background:linear-gradient(135deg, rgba(15,23,42,.95), rgba(30,41,59,.95)); color:#67e8f9; }
      .pp-seat { position:absolute; display:flex; flex-direction:column; align-items:center; gap:8px; z-index:4; }
      .pp-seat.top { top:10px; left:50%; transform:translateX(-50%); }
      .pp-seat.bottom { bottom:0; left:50%; transform:translateX(-50%); }
      .pp-seat-panel { min-width:220px; border-radius:18px; padding:12px 14px; background:rgba(2,6,23,.72); border:1px solid rgba(148,163,184,.18); text-align:center; backdrop-filter:blur(8px); }
      .pp-seat-name { color:#fff; font-size:14px; font-weight:700; }
      .pp-seat-stack { color:#93c5fd; font-size:12px; margin-top:2px; }
      .pp-seat-action { color:#f8fafc; font-size:11px; min-height:16px; margin-top:4px; opacity:.88; }
      .pp-seat.active .pp-seat-panel { border-color:#22d3ee; box-shadow:0 0 0 1px rgba(34,211,238,.25), 0 0 30px rgba(34,211,238,.16); }
      .pp-hole { display:flex; gap:8px; }
      .pp-hologram { width:110px; height:110px; border-radius:50%; position:relative; overflow:hidden;
        background:radial-gradient(circle at 50% 38%, rgba(224,231,255,.9), rgba(56,189,248,.35) 35%, rgba(15,23,42,.12) 62%, rgba(2,6,23,0) 72%);
        border:1px solid rgba(34,211,238,.45); box-shadow:0 0 22px rgba(34,211,238,.3), inset 0 0 16px rgba(255,255,255,.18);
      }
      .pp-hologram:before { content:''; position:absolute; inset:0; background:
        repeating-linear-gradient(180deg, rgba(255,255,255,.18) 0 2px, transparent 2px 6px),
        radial-gradient(circle at 50% 0%, rgba(34,211,238,.55), transparent 55%);
        mix-blend-mode:screen; animation:ppHolo 6s linear infinite;
      }
      .pp-hologram-face { position:absolute; inset:22px 28px 18px; border-radius:46% 46% 50% 50%; border:1px solid rgba(191,219,254,.45); }
      .pp-hologram-face:before, .pp-hologram-face:after { content:''; position:absolute; top:28px; width:10px; height:10px; border-radius:50%; background:#a5f3fc; box-shadow:0 0 12px rgba(165,243,252,.9); }
      .pp-hologram-face:before { left:18px; } .pp-hologram-face:after { right:18px; }
      .pp-hologram-mouth { position:absolute; left:50%; bottom:20px; width:30px; height:10px; transform:translateX(-50%); border-bottom:2px solid #67e8f9; border-radius:0 0 20px 20px; }
      .pp-hologram.bluffing { box-shadow:0 0 26px rgba(236,72,153,.35), inset 0 0 18px rgba(244,114,182,.25); }
      .pp-hologram.annoyed { box-shadow:0 0 26px rgba(248,113,113,.35), inset 0 0 18px rgba(248,113,113,.22); }
      .pp-hologram.pleased { box-shadow:0 0 26px rgba(34,197,94,.35), inset 0 0 18px rgba(74,222,128,.22); }
      .pp-controls { display:grid; grid-template-columns:1fr auto; gap:12px; margin-top:16px; align-items:end; }
      .pp-raise { display:flex; flex-direction:column; gap:8px; }
      .pp-raise input[type=range] { width:100%; }
      .pp-raise-meta { display:flex; justify-content:space-between; font-size:12px; color:#93c5fd; }
      .pp-log { margin-top:14px; min-height:34px; color:#cbd5e1; font-size:12px; }
      @keyframes ppHolo { from { transform:translateY(0); } to { transform:translateY(18px); } }
      @media (max-width: 900px) {
        .pp-holdem-scene { height:560px; }
        .pp-seat-panel { min-width:180px; }
        .pp-controls { grid-template-columns:1fr; }
      }
    `;
    document.head.appendChild(style);

    var shell = document.createElement('section');
    shell.className = 'pp-holdem-shell';
    shell.id = 'la-holdem-root';
    shell.innerHTML = `
      <div class="pp-holdem-head">
        <div>
          <div class="pp-holdem-title">Texas Holdem Hologram Table</div>
          <div class="pp-holdem-sub">Authoritative heads-up table with a live bot seat, event timeline, and reconnectable state.</div>
        </div>
        <div class="pp-holdem-actions">
          <button class="pp-holdem-btn" id="pp-holdem-join">Join Table</button>
          <button class="pp-holdem-btn secondary" id="pp-holdem-refresh">Sync State</button>
        </div>
      </div>
      <div class="pp-holdem-scene">
        <div class="pp-holdem-table"></div>
        <div class="pp-seat top" id="pp-seat-top"></div>
        <div class="pp-pot">
          <div class="pp-pot-label">Main Pot</div>
          <div class="pp-pot-val" id="pp-pot-val">$0</div>
        </div>
        <div class="pp-board" id="pp-board"></div>
        <div class="pp-seat bottom" id="pp-seat-bottom"></div>
      </div>
      <div class="pp-controls">
        <div class="pp-raise">
          <div class="pp-raise-meta"><span id="pp-phase">Waiting</span><span id="pp-call-meta">Call: $0</span></div>
          <input type="range" id="pp-raise-slider" min="2" max="40" value="4">
          <div class="pp-raise-meta"><span>Raise To</span><span id="pp-raise-val">$4</span></div>
        </div>
        <div class="pp-holdem-actions">
          <button class="pp-holdem-btn secondary" id="pp-fold">Fold</button>
          <button class="pp-holdem-btn secondary" id="pp-check">Check</button>
          <button class="pp-holdem-btn secondary" id="pp-call">Call</button>
          <button class="pp-holdem-btn" id="pp-raise">Raise</button>
        </div>
      </div>
      <div class="pp-log" id="pp-holdem-log">Join the table to start a hand.</div>
    `;
    lobby.insertBefore(shell, lobby.children[2] || null);

    document.getElementById('pp-holdem-join').addEventListener('click', joinTable);
    document.getElementById('pp-holdem-refresh').addEventListener('click', syncState);
    document.getElementById('pp-fold').addEventListener('click', function() { sendAction('fold'); });
    document.getElementById('pp-check').addEventListener('click', function() { sendAction('check'); });
    document.getElementById('pp-call').addEventListener('click', function() { sendAction('call'); });
    document.getElementById('pp-raise').addEventListener('click', function() {
      var slider = document.getElementById('pp-raise-slider');
      sendAction('raise', Number(slider.value));
    });
    document.getElementById('pp-raise-slider').addEventListener('input', function(e) {
      document.getElementById('pp-raise-val').textContent = '$' + Number(e.target.value).toFixed(2);
    });
  }

  function send(payload) {
    if (!window.ws || window.ws.readyState !== 1) {
      if (typeof showToast === 'function') showToast('Poker socket is not connected');
      return false;
    }
    window.ws.send(JSON.stringify(payload));
    return true;
  }

  function sendAuth() {
    if (typeof window.authToken === 'undefined' || !window.authToken) return false;
    return send({ type: 'auth', token: window.authToken });
  }

  function joinTable() {
    ensureUi();
    sendAuth();
    send({ type: 'poker:join_table' });
  }

  function syncState() {
    ensureUi();
    sendAuth();
    send({ type: 'poker:state' });
  }

  function sendAction(action, amount) {
    if (!pokerState || !pokerState.availableActions) return;
    sendAuth();
    send({ type: 'poker:action', action: action, amount: amount });
  }

  function cardHtml(card) {
    if (!card) return '<div class="pp-card back">?</div>';
    if (card.hidden) return '<div class="pp-card back">?</div>';
    var red = card.suit === 'H' || card.suit === 'D';
    return '<div class="pp-card" style="color:' + (red ? '#b91c1c' : '#111827') + '">' + card.code + '</div>';
  }

  function renderSeat(targetId, seat, active, isTop) {
    var el = document.getElementById(targetId);
    if (!el) return;
    if (!seat) {
      el.innerHTML = '<div class="pp-seat-panel">Empty seat</div>';
      el.className = 'pp-seat ' + (isTop ? 'top' : 'bottom');
      return;
    }
    var hole = (seat.holeCards || []).map(cardHtml).join('');
    var avatar = seat.isBot
      ? '<div class="pp-hologram ' + seat.avatarMood + '"><div class="pp-hologram-face"><div class="pp-hologram-mouth"></div></div></div>'
      : '';
    el.className = 'pp-seat ' + (isTop ? 'top' : 'bottom') + (active ? ' active' : '');
    el.innerHTML =
      avatar +
      '<div class="pp-seat-panel">' +
      '<div class="pp-seat-name">' + seat.displayName + (seat.isBot ? ' · AI' : '') + '</div>' +
      '<div class="pp-seat-stack">Stack: $' + Number(seat.stack || 0).toFixed(2) + ' · In pot: $' + Number(seat.committed || 0).toFixed(2) + '</div>' +
      '<div class="pp-seat-action">' + (seat.lastAction ? ('Last action: ' + seat.lastAction) : '&nbsp;') + '</div>' +
      '</div>' +
      '<div class="pp-hole">' + hole + '</div>';
  }

  function renderBoard(board) {
    var el = document.getElementById('pp-board');
    if (!el) return;
    var cards = board || [];
    var html = '';
    for (var i = 0; i < 5; i += 1) html += cardHtml(cards[i] || null);
    el.innerHTML = html;
  }

  function renderControls() {
    var actions = pokerState && pokerState.availableActions;
    document.getElementById('pp-phase').textContent = pokerState ? ('Phase: ' + pokerState.phase + ' · Hand #' + pokerState.handNumber) : 'Waiting';
    document.getElementById('pp-call-meta').textContent = 'Call: $' + Number(actions ? actions.callAmount : 0).toFixed(2);
    document.getElementById('pp-pot-val').textContent = '$' + Number(pokerState ? pokerState.pot : 0).toFixed(2);
    var slider = document.getElementById('pp-raise-slider');
    var raiseVal = document.getElementById('pp-raise-val');
    if (actions) {
      slider.min = String(actions.minRaiseTo);
      slider.max = String(Math.max(actions.minRaiseTo, actions.maxRaiseTo));
      slider.value = String(actions.minRaiseTo);
      raiseVal.textContent = '$' + Number(actions.minRaiseTo).toFixed(2);
    }
    document.getElementById('pp-fold').disabled = !actions || !actions.canFold;
    document.getElementById('pp-check').disabled = !actions || !actions.canCheck;
    document.getElementById('pp-call').disabled = !actions || !actions.canCall;
    document.getElementById('pp-raise').disabled = !actions;
    slider.disabled = !actions;
  }

  function renderState() {
    ensureUi();
    if (!pokerState) return;
    renderBoard(pokerState.board);
    renderSeat('pp-seat-top', pokerState.seats[0] && pokerState.seats[0].isBot ? pokerState.seats[0] : pokerState.seats[1], pokerState.actingSeatIndex === 1 || (pokerState.seats[0] && pokerState.seats[0].isBot && pokerState.actingSeatIndex === 0), true);
    renderSeat('pp-seat-bottom', pokerState.seats.find(function(seat) { return seat && !seat.isBot; }) || pokerState.seats[0], pokerState.seats.find(function(seat) { return seat && !seat.isBot && seat.seatIndex === pokerState.actingSeatIndex; }) != null, false);
    renderControls();

    if (pokerState.timeline && timelineSeen !== pokerState.timeline.ts) {
      timelineSeen = pokerState.timeline.ts;
      var log = document.getElementById('pp-holdem-log');
      var text = pokerState.timeline.eventType.replace(/_/g, ' ') + ' · ' + JSON.stringify(pokerState.timeline.payload);
      log.textContent = text;
    }
    if (pokerState.showdownWinners && pokerState.showdownWinners.length) {
      document.getElementById('pp-holdem-log').textContent = pokerState.showdownWinners.map(function(winner) {
        var seat = pokerState.seats[winner.seatIndex];
        return seat.displayName + ' won $' + Number(winner.amount).toFixed(2) + ' with ' + winner.handLabel;
      }).join(' · ');
    }
  }

  window.PromptPayPoker = {
    onSocketOpen: function() {
      sendAuth();
      if (pokerState && pokerState.tableId) send({ type: 'poker:reconnect', tableId: pokerState.tableId });
    },
    onSocketMessage: function(msg) {
      if (msg.type === 'poker:state') {
        pokerState = msg.state;
        renderState();
      } else if (msg.type === 'poker:error') {
        if (typeof showToast === 'function') showToast(msg.message || 'Poker error');
        var log = document.getElementById('pp-holdem-log');
        if (log) log.textContent = msg.message || 'Poker error';
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUi);
  } else {
    ensureUi();
  }
})();
