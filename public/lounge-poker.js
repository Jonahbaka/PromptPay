(function() {
  var pokerState = null;
  var timelineSeen = null;
  var styleInjected = false;

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.pp-holdem-shell{position:relative;overflow:hidden;margin:20px 0;padding:22px;border-radius:28px;background:',
      'radial-gradient(circle at 20% 10%,rgba(56,189,248,.12),transparent 24%),',
      'radial-gradient(circle at 80% 0%,rgba(14,165,233,.12),transparent 28%),',
      'linear-gradient(180deg,#081019 0%,#05080d 100%);',
      'border:1px solid rgba(148,163,184,.16);box-shadow:0 30px 80px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.04)}',
      '.pp-holdem-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px}',
      '.pp-holdem-title{font-size:19px;font-weight:800;letter-spacing:.08em;color:#e2e8f0;text-transform:uppercase}',
      '.pp-holdem-sub{font-size:12px;color:#94a3b8;max-width:560px;line-height:1.5}',
      '.pp-holdem-actions{display:flex;gap:10px;flex-wrap:wrap}',
      '.pp-holdem-btn{border:none;border-radius:14px;padding:11px 15px;font:inherit;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(135deg,#0ea5e9,#2563eb);box-shadow:0 10px 25px rgba(37,99,235,.28)}',
      '.pp-holdem-btn.secondary{background:rgba(255,255,255,.05);color:#dbeafe;border:1px solid rgba(255,255,255,.12);box-shadow:none}',
      '.pp-holdem-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}',
      '.pp-holdem-notice{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:16px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.18);margin-bottom:16px}',
      '.pp-holdem-notice-badge{width:32px;height:32px;flex:0 0 32px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#22c55e,#14b8a6);color:#02110b;font-weight:900}',
      '.pp-holdem-notice-text{font-size:12px;line-height:1.5;color:#cbd5e1}',
      '.pp-holdem-scene{position:relative;height:620px;perspective:1600px}',
      '.pp-holdem-floor{position:absolute;inset:70px 0 0;background:radial-gradient(circle at 50% 0%,rgba(30,41,59,.45),transparent 55%)}',
      '.pp-holdem-table{position:absolute;inset:82px 26px 110px;border-radius:50% / 39%;transform:rotateX(62deg);transform-style:preserve-3d;background:',
      'radial-gradient(circle at 50% 48%,rgba(34,197,94,.14) 0%,rgba(5,84,63,.96) 45%,rgba(7,55,45,.98) 63%,rgba(43,29,11,.98) 70%,rgba(11,11,13,1) 80%);',
      'box-shadow:0 45px 90px rgba(0,0,0,.65),inset 0 0 40px rgba(255,255,255,.08)}',
      '.pp-table-rim{position:absolute;inset:74px 18px 102px;border-radius:50% / 39%;border:2px solid rgba(183,138,55,.45);transform:rotateX(62deg);pointer-events:none}',
      '.pp-betting-line{position:absolute;left:50%;width:44%;height:26%;border:2px solid rgba(255,255,255,.12);border-top:none;border-radius:0 0 46% 46%;transform:translateX(-50%)}',
      '.pp-betting-line.top{top:132px}',
      '.pp-betting-line.bottom{bottom:150px;transform:translateX(-50%) rotate(180deg)}',
      '.pp-dealer-dot{position:absolute;left:50%;top:50%;width:18px;height:18px;border-radius:50%;transform:translate(-50%,-110%);background:linear-gradient(135deg,#fde68a,#f59e0b);box-shadow:0 0 18px rgba(245,158,11,.4)}',
      '.pp-pot{position:absolute;top:50%;left:50%;transform:translate(-50%,-55%);text-align:center;z-index:5}',
      '.pp-pot-label{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#93c5fd}',
      '.pp-pot-val{color:#fff;font-size:26px;font-weight:800;margin-top:6px}',
      '.pp-pot-chips{display:flex;justify-content:center;gap:6px;margin-top:10px}',
      '.pp-board{position:absolute;top:50%;left:50%;transform:translate(-50%,-2%);display:flex;gap:12px;z-index:6}',
      '.pp-card{width:58px;height:82px;border-radius:12px;border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(226,232,240,.92));color:#111827;font-size:19px;font-weight:800;box-shadow:0 12px 24px rgba(0,0,0,.28)}',
      '.pp-card.back{background:linear-gradient(135deg,#0f172a,#1e293b);color:#67e8f9}',
      '.pp-seat{position:absolute;display:flex;flex-direction:column;align-items:center;gap:10px;z-index:8}',
      '.pp-seat.top{top:8px;left:50%;transform:translateX(-50%)}',
      '.pp-seat.bottom{bottom:0;left:50%;transform:translateX(-50%)}',
      '.pp-avatar{width:104px;height:104px;border-radius:50%;position:relative;overflow:hidden;border:1px solid rgba(148,163,184,.26);box-shadow:0 20px 40px rgba(0,0,0,.35)}',
      '.pp-avatar.ai{background:radial-gradient(circle at 50% 20%,rgba(255,255,255,.22),transparent 34%),linear-gradient(180deg,#243b53,#0b1726)}',
      '.pp-avatar.human{background:radial-gradient(circle at 50% 18%,rgba(255,255,255,.18),transparent 28%),linear-gradient(180deg,#4b5563,#111827)}',
      '.pp-avatar-face{position:absolute;left:50%;top:16px;transform:translateX(-50%);width:56px;height:70px;border-radius:48% 48% 42% 42%;background:linear-gradient(180deg,#f4d0b4,#d9aa8a)}',
      '.pp-avatar-face.ai-face{background:linear-gradient(180deg,#edc8ac,#c58f73)}',
      '.pp-avatar-hair{position:absolute;left:50%;top:10px;transform:translateX(-50%);width:64px;height:34px;border-radius:48px 48px 20px 20px;background:linear-gradient(180deg,#111827,#334155)}',
      '.pp-avatar-hair.ai-hair{background:linear-gradient(180deg,#1f2937,#0f172a)}',
      '.pp-avatar-eye{position:absolute;top:31px;width:8px;height:8px;border-radius:50%;background:#111827;box-shadow:0 0 12px rgba(255,255,255,.16)}',
      '.pp-avatar-eye.left{left:16px}.pp-avatar-eye.right{right:16px}',
      '.pp-avatar-mouth{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);width:18px;height:8px;border-bottom:2px solid rgba(15,23,42,.72);border-radius:0 0 14px 14px}',
      '.pp-avatar-projector{position:absolute;inset:0;background:repeating-linear-gradient(180deg,rgba(255,255,255,.08) 0 2px,transparent 2px 6px);mix-blend-mode:screen;opacity:.3}',
      '.pp-avatar.ai.bluffing{box-shadow:0 0 32px rgba(236,72,153,.28),0 20px 40px rgba(0,0,0,.35)}',
      '.pp-avatar.ai.annoyed{box-shadow:0 0 32px rgba(248,113,113,.28),0 20px 40px rgba(0,0,0,.35)}',
      '.pp-avatar.ai.pleased{box-shadow:0 0 32px rgba(34,197,94,.28),0 20px 40px rgba(0,0,0,.35)}',
      '.pp-seat-panel{min-width:250px;border-radius:20px;padding:13px 15px;background:rgba(2,6,23,.72);border:1px solid rgba(148,163,184,.18);text-align:center;backdrop-filter:blur(8px)}',
      '.pp-seat.active .pp-seat-panel{border-color:#38bdf8;box-shadow:0 0 0 1px rgba(56,189,248,.25),0 0 26px rgba(56,189,248,.18)}',
      '.pp-seat-name{color:#fff;font-size:14px;font-weight:800}',
      '.pp-seat-role{font-size:11px;color:#93c5fd;margin-top:3px;letter-spacing:.12em;text-transform:uppercase}',
      '.pp-seat-stack,.pp-seat-action{font-size:12px;color:#cbd5e1;margin-top:5px}',
      '.pp-hole{display:flex;gap:8px}',
      '.pp-chip-stack{display:flex;align-items:flex-end;justify-content:center;gap:3px;min-height:28px}',
      '.pp-chip{width:24px;height:8px;border-radius:999px;border:1px solid rgba(255,255,255,.24);box-shadow:0 3px 6px rgba(0,0,0,.24)}',
      '.pp-chip.red{background:linear-gradient(180deg,#fb7185,#be123c)}',
      '.pp-chip.blue{background:linear-gradient(180deg,#60a5fa,#1d4ed8)}',
      '.pp-chip.green{background:linear-gradient(180deg,#4ade80,#15803d)}',
      '.pp-chip.gold{background:linear-gradient(180deg,#fde68a,#b45309)}',
      '.pp-controls{display:grid;grid-template-columns:1fr auto;gap:14px;margin-top:18px;align-items:end}',
      '.pp-raise{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:18px;background:rgba(15,23,42,.55);border:1px solid rgba(148,163,184,.12)}',
      '.pp-raise input[type=range]{width:100%}',
      '.pp-raise-meta{display:flex;justify-content:space-between;font-size:12px;color:#93c5fd}',
      '.pp-log{margin-top:14px;min-height:38px;color:#cbd5e1;font-size:12px;padding:12px 14px;border-radius:16px;background:rgba(15,23,42,.52);border:1px solid rgba(148,163,184,.12)}',
      '@media (max-width:900px){.pp-holdem-scene{height:660px}.pp-seat-panel{min-width:195px}.pp-controls{grid-template-columns:1fr}.pp-board{gap:8px}.pp-card{width:50px;height:74px;font-size:17px}.pp-seat.top{top:0}.pp-avatar{width:88px;height:88px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function ensureUi() {
    injectStyles();
    if (document.getElementById('la-holdem-root')) return;
    var lobby = document.querySelector('#calls-tab-lounge .la-lobby');
    if (!lobby) return;

    var shell = document.createElement('section');
    shell.className = 'pp-holdem-shell';
    shell.id = 'la-holdem-root';
    shell.innerHTML = [
      '<div class="pp-holdem-head">',
      '  <div>',
      '    <div class="pp-holdem-title">Texas Holdem Lounge Table</div>',
      '    <div class="pp-holdem-sub">Heads-up social poker with an AI table partner, animated chip flow, and live state synced from the server.</div>',
      '  </div>',
      '  <div class="pp-holdem-actions">',
      '    <button class="pp-holdem-btn" id="pp-holdem-join">Join Table</button>',
      '    <button class="pp-holdem-btn secondary" id="pp-holdem-refresh">Sync State</button>',
      '  </div>',
      '</div>',
      '<div class="pp-holdem-notice">',
      '  <div class="pp-holdem-notice-badge">i</div>',
      '  <div class="pp-holdem-notice-text"><strong>Table policy:</strong> this lounge is for entertainment, learning, and social strategy only. No cash wagering, staking, or prize-based gambling is permitted here. Chips and scores are table props for play sessions only.</div>',
      '</div>',
      '<div class="pp-holdem-scene">',
      '  <div class="pp-holdem-floor"></div>',
      '  <div class="pp-holdem-table"></div>',
      '  <div class="pp-table-rim"></div>',
      '  <div class="pp-betting-line top"></div>',
      '  <div class="pp-betting-line bottom"></div>',
      '  <div class="pp-dealer-dot"></div>',
      '  <div class="pp-seat top" id="pp-seat-top"></div>',
      '  <div class="pp-pot">',
      '    <div class="pp-pot-label">Main Pot</div>',
      '    <div class="pp-pot-val" id="pp-pot-val">$0.00</div>',
      '    <div class="pp-pot-chips" id="pp-pot-chips"></div>',
      '  </div>',
      '  <div class="pp-board" id="pp-board"></div>',
      '  <div class="pp-seat bottom" id="pp-seat-bottom"></div>',
      '</div>',
      '<div class="pp-controls">',
      '  <div class="pp-raise">',
      '    <div class="pp-raise-meta"><span id="pp-phase">Waiting</span><span id="pp-call-meta">Call: $0.00</span></div>',
      '    <input type="range" id="pp-raise-slider" min="2" max="40" value="4">',
      '    <div class="pp-raise-meta"><span>Raise To</span><span id="pp-raise-val">$4.00</span></div>',
      '  </div>',
      '  <div class="pp-holdem-actions">',
      '    <button class="pp-holdem-btn secondary" id="pp-fold">Fold</button>',
      '    <button class="pp-holdem-btn secondary" id="pp-check">Check</button>',
      '    <button class="pp-holdem-btn secondary" id="pp-call">Call</button>',
      '    <button class="pp-holdem-btn" id="pp-raise">Raise</button>',
      '  </div>',
      '</div>',
      '<div class="pp-log" id="pp-holdem-log">Join the table to start a social play session.</div>'
    ].join('');

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
    document.getElementById('pp-raise-slider').addEventListener('input', function(event) {
      document.getElementById('pp-raise-val').textContent = money(Number(event.target.value));
    });
  }

  function money(value) {
    return '$' + Number(value || 0).toFixed(2);
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
    if (!window.authToken) return false;
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

  function chipStackHtml(amount) {
    var value = Number(amount || 0);
    var tiers = [
      { color: 'gold', count: Math.max(0, Math.min(3, Math.floor(value / 40))) },
      { color: 'blue', count: Math.max(1, Math.min(4, Math.floor(value / 15) || (value > 0 ? 1 : 0))) },
      { color: 'red', count: Math.max(0, Math.min(4, Math.floor(value / 8))) },
      { color: 'green', count: Math.max(0, Math.min(5, Math.floor(value / 3))) }
    ];
    var html = '<div class="pp-chip-stack">';
    tiers.forEach(function(tier) {
      for (var i = 0; i < tier.count; i += 1) html += '<div class="pp-chip ' + tier.color + '"></div>';
    });
    html += '</div>';
    return html;
  }

  function cardHtml(card) {
    if (!card || card.hidden) return '<div class="pp-card back">?</div>';
    var red = card.suit === 'H' || card.suit === 'D';
    return '<div class="pp-card" style="color:' + (red ? '#b91c1c' : '#111827') + '">' + card.code + '</div>';
  }

  function avatarHtml(seat) {
    var classes = 'pp-avatar ' + (seat.isBot ? 'ai ' : 'human ') + (seat.avatarMood || 'idle');
    var hairClass = seat.isBot ? 'pp-avatar-hair ai-hair' : 'pp-avatar-hair';
    var faceClass = seat.isBot ? 'pp-avatar-face ai-face' : 'pp-avatar-face';
    return [
      '<div class="' + classes + '">',
      '  <div class="' + hairClass + '"></div>',
      '  <div class="' + faceClass + '">',
      '    <div class="pp-avatar-eye left"></div>',
      '    <div class="pp-avatar-eye right"></div>',
      '    <div class="pp-avatar-mouth"></div>',
      '  </div>',
      seat.isBot ? '  <div class="pp-avatar-projector"></div>' : '',
      '</div>'
    ].join('');
  }

  function seatHtml(seat, active) {
    var hole = (seat.holeCards || []).map(cardHtml).join('');
    return [
      avatarHtml(seat),
      '<div class="pp-seat-panel">',
      '  <div class="pp-seat-name">' + seat.displayName + '</div>',
      '  <div class="pp-seat-role">' + (seat.isBot ? 'AI opponent' : 'Human player') + '</div>',
      '  <div class="pp-seat-stack">Stack: ' + money(seat.stack) + ' | In pot: ' + money(seat.committed) + '</div>',
      '  <div class="pp-seat-action">' + (seat.lastAction ? ('Last action: ' + seat.lastAction) : 'Awaiting action') + '</div>',
      '  ' + chipStackHtml(seat.stack),
      '</div>',
      '<div class="pp-hole">' + hole + '</div>'
    ].join('');
  }

  function renderSeat(targetId, seat, active, isTop) {
    var el = document.getElementById(targetId);
    if (!el) return;
    el.className = 'pp-seat ' + (isTop ? 'top' : 'bottom') + (active ? ' active' : '');
    if (!seat) {
      el.innerHTML = '<div class="pp-seat-panel">Seat unavailable</div>';
      return;
    }
    el.innerHTML = seatHtml(seat, active);
  }

  function renderBoard(board) {
    var el = document.getElementById('pp-board');
    if (!el) return;
    var html = '';
    var cards = board || [];
    for (var i = 0; i < 5; i += 1) html += cardHtml(cards[i] || null);
    el.innerHTML = html;
  }

  function renderPot() {
    document.getElementById('pp-pot-val').textContent = money(pokerState ? pokerState.pot : 0);
    document.getElementById('pp-pot-chips').innerHTML = chipStackHtml(pokerState ? pokerState.pot : 0);
  }

  function renderControls() {
    var actions = pokerState && pokerState.availableActions;
    document.getElementById('pp-phase').textContent = pokerState ? ('Phase: ' + pokerState.phase + ' | Hand #' + pokerState.handNumber) : 'Waiting';
    document.getElementById('pp-call-meta').textContent = 'Call: ' + money(actions ? actions.callAmount : 0);
    var slider = document.getElementById('pp-raise-slider');
    var raiseVal = document.getElementById('pp-raise-val');
    if (actions) {
      slider.min = String(actions.minRaiseTo);
      slider.max = String(Math.max(actions.minRaiseTo, actions.maxRaiseTo));
      slider.value = String(actions.minRaiseTo);
      raiseVal.textContent = money(actions.minRaiseTo);
    }
    document.getElementById('pp-fold').disabled = !actions || !actions.canFold;
    document.getElementById('pp-check').disabled = !actions || !actions.canCheck;
    document.getElementById('pp-call').disabled = !actions || !actions.canCall;
    document.getElementById('pp-raise').disabled = !actions;
    slider.disabled = !actions;
  }

  function topSeat() {
    if (!pokerState || !pokerState.seats) return null;
    return pokerState.seats.find(function(seat) { return seat && seat.isBot; }) || pokerState.seats[0];
  }

  function bottomSeat() {
    if (!pokerState || !pokerState.seats) return null;
    return pokerState.seats.find(function(seat) { return seat && !seat.isBot; }) || pokerState.seats[1];
  }

  function updateLog() {
    var log = document.getElementById('pp-holdem-log');
    if (!log) return;
    if (!pokerState) {
      log.textContent = 'Join the table to start a social play session.';
      return;
    }
    if (pokerState.showdownWinners && pokerState.showdownWinners.length) {
      log.textContent = pokerState.showdownWinners.map(function(winner) {
        var seat = pokerState.seats[winner.seatIndex];
        return seat.displayName + ' collected ' + money(winner.amount) + ' with ' + winner.handLabel;
      }).join(' | ');
      return;
    }
    if (pokerState.timeline && timelineSeen !== pokerState.timeline.ts) {
      timelineSeen = pokerState.timeline.ts;
      log.textContent = pokerState.timeline.eventType.replace(/_/g, ' ') + ' | ' + JSON.stringify(pokerState.timeline.payload);
      return;
    }
    log.textContent = 'Play session active. Chips have no cash value and no wagering is allowed.';
  }

  function renderState() {
    ensureUi();
    if (!pokerState) return;
    renderBoard(pokerState.board);
    renderPot();
    renderSeat('pp-seat-top', topSeat(), topSeat() && topSeat().seatIndex === pokerState.actingSeatIndex, true);
    renderSeat('pp-seat-bottom', bottomSeat(), bottomSeat() && bottomSeat().seatIndex === pokerState.actingSeatIndex, false);
    renderControls();
    updateLog();
  }

  window.PromptPayPoker = {
    onSocketOpen: function() {
      sendAuth();
      if (pokerState && pokerState.tableId) send({ type: 'poker:reconnect', tableId: pokerState.tableId });
    },
    onSocketMessage: function(msg) {
      if (msg.type === 'poker:authenticated') return;
      if (msg.type === 'poker:state') {
        pokerState = msg.state;
        renderState();
        return;
      }
      if (msg.type === 'poker:error') {
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
