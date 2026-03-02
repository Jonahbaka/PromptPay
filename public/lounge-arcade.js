(function() {
  var injected = false;

  function injectStyles() {
    if (injected) return;
    injected = true;
    var style = document.createElement('style');
    style.textContent = [
      '#luxe-arena.pp-arcade{background:radial-gradient(circle at 20% 0%,rgba(59,130,246,.18),transparent 26%),radial-gradient(circle at 80% 0%,rgba(16,185,129,.16),transparent 30%),linear-gradient(180deg,#05070d,#09131f 46%,#05070d 100%);color:#e5eef8;overflow:auto}',
      '#luxe-arena.pp-arcade *{box-sizing:border-box}',
      '#luxe-arena.pp-arcade .pp-arcade-shell{min-height:100%;display:flex;flex-direction:column}',
      '#luxe-arena.pp-arcade .pp-arcade-topbar{display:flex;align-items:center;gap:10px;padding:14px 18px calc(14px + env(safe-area-inset-top,0px)) 18px;border-bottom:1px solid rgba(148,163,184,.14);background:rgba(6,10,18,.72);backdrop-filter:blur(10px)}',
      '#luxe-arena.pp-arcade .pp-topbar-actions{display:flex;align-items:center;gap:10px;margin-left:auto}',
      '#luxe-arena.pp-arcade .pp-arcade-title{flex:1;font-size:15px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}',
      '#luxe-arena.pp-arcade .pp-arcade-sub{font-size:11px;color:#93a4b8;margin-top:3px}',
      '#luxe-arena.pp-arcade .pp-arcade-btn{width:42px;height:42px;border-radius:50%;border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.7);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}',
      '#luxe-arena.pp-arcade .pp-arcade-main{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px;padding:18px;flex:1;min-height:0;max-width:100%;overflow:hidden}',
      '#luxe-arena.pp-arcade .pp-scene{position:relative;min-height:720px;border-radius:30px;padding:22px;background:linear-gradient(180deg,rgba(15,23,42,.58),rgba(2,6,23,.84));border:1px solid rgba(148,163,184,.14);overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.42)}',
      '#luxe-arena.pp-arcade .pp-scene:before{content:"";position:absolute;inset:-10% 8% auto;height:40%;background:radial-gradient(circle,rgba(255,255,255,.08),transparent 68%);filter:blur(28px);pointer-events:none}',
      '#luxe-arena.pp-arcade .pp-scene:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(190,24,93,.08),transparent 16%,transparent 84%,rgba(14,165,233,.08));pointer-events:none}',
      '#luxe-arena.pp-arcade .pp-vegas-wall{position:absolute;top:18px;bottom:18px;width:70px;border-radius:28px;background:linear-gradient(180deg,rgba(91,33,182,.1),rgba(30,41,59,.42));border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 0 26px rgba(251,191,36,.06),0 14px 40px rgba(0,0,0,.22);pointer-events:none}',
      '#luxe-arena.pp-arcade .pp-vegas-wall.left{left:14px}',
      '#luxe-arena.pp-arcade .pp-vegas-wall.right{right:14px}',
      '#luxe-arena.pp-arcade .pp-neon-badge{position:absolute;top:26px;left:50%;transform:translateX(-50%);z-index:3;padding:8px 16px;border-radius:999px;background:rgba(7,13,24,.78);border:1px solid rgba(251,191,36,.32);box-shadow:0 0 24px rgba(251,191,36,.12);font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#f8d991}',
      '#luxe-arena.pp-arcade .pp-stage{position:relative;height:100%;display:flex;flex-direction:column;justify-content:space-between}',
      '#luxe-arena.pp-arcade .pp-seat-row{display:flex;justify-content:center;z-index:2}',
      '#luxe-arena.pp-arcade .pp-player{display:flex;flex-direction:column;align-items:center;gap:12px}',
      '#luxe-arena.pp-arcade .pp-avatar{width:104px;height:104px;border-radius:50%;position:relative;overflow:hidden;border:1px solid rgba(148,163,184,.28);box-shadow:0 18px 36px rgba(0,0,0,.34)}',
      '#luxe-arena.pp-arcade .pp-avatar.ai{background:radial-gradient(circle at 50% 14%,rgba(255,255,255,.18),transparent 28%),linear-gradient(180deg,#2c4055,#0f172a)}',
      '#luxe-arena.pp-arcade .pp-avatar.human{background:radial-gradient(circle at 50% 14%,rgba(255,255,255,.15),transparent 28%),linear-gradient(180deg,#5b6474,#111827)}',
      '#luxe-arena.pp-arcade .pp-face{position:absolute;left:50%;top:16px;transform:translateX(-50%);width:58px;height:72px;border-radius:48% 48% 42% 42%;background:linear-gradient(180deg,#f3d1ba,#d6ab8d)}',
      '#luxe-arena.pp-arcade .pp-face.ai-face{background:linear-gradient(180deg,#ebc5ab,#c88d72)}',
      '#luxe-arena.pp-arcade .pp-hair{position:absolute;left:50%;top:9px;transform:translateX(-50%);width:66px;height:34px;border-radius:42px 42px 22px 22px;background:linear-gradient(180deg,#111827,#334155)}',
      '#luxe-arena.pp-arcade .pp-hair.ai-hair{background:linear-gradient(180deg,#17212e,#0b1220)}',
      '#luxe-arena.pp-arcade .pp-eye{position:absolute;top:31px;width:8px;height:8px;border-radius:50%;background:#111827}',
      '#luxe-arena.pp-arcade .pp-eye.left{left:16px}.pp-eye.right{right:16px}',
      '#luxe-arena.pp-arcade .pp-mouth{position:absolute;left:50%;bottom:17px;transform:translateX(-50%);width:18px;height:8px;border-bottom:2px solid rgba(15,23,42,.8);border-radius:0 0 14px 14px}',
      '#luxe-arena.pp-arcade .pp-avatar.ai .pp-projector{position:absolute;inset:0;background:repeating-linear-gradient(180deg,rgba(255,255,255,.08) 0 2px,transparent 2px 6px);mix-blend-mode:screen;opacity:.35}',
      '#luxe-arena.pp-arcade .pp-avatar.ai.thinking{box-shadow:0 0 30px rgba(56,189,248,.24),0 18px 36px rgba(0,0,0,.34)}',
      '#luxe-arena.pp-arcade .pp-avatar.ai.pleased{box-shadow:0 0 30px rgba(34,197,94,.24),0 18px 36px rgba(0,0,0,.34)}',
      '#luxe-arena.pp-arcade .pp-avatar.ai.bluffing{box-shadow:0 0 30px rgba(236,72,153,.24),0 18px 36px rgba(0,0,0,.34)}',
      '#luxe-arena.pp-arcade .pp-player-card{min-width:230px;padding:14px 16px;border-radius:20px;background:rgba(2,6,23,.74);border:1px solid rgba(148,163,184,.18);text-align:center;backdrop-filter:blur(8px)}',
      '#luxe-arena.pp-arcade .pp-player.active .pp-player-card{border-color:#38bdf8;box-shadow:0 0 0 1px rgba(56,189,248,.22),0 0 26px rgba(56,189,248,.14)}',
      '#luxe-arena.pp-arcade .pp-player-name{font-size:15px;font-weight:800;color:#fff}',
      '#luxe-arena.pp-arcade .pp-player-meta{font-size:12px;color:#8fb6d9;margin-top:4px}',
      '#luxe-arena.pp-arcade .pp-player-score{font-size:13px;color:#cbd5e1;margin-top:6px}',
      '#luxe-arena.pp-arcade .pp-board-zone{position:relative;display:flex;justify-content:center;align-items:center;padding:56px 24px 18px}',
      '#luxe-arena.pp-arcade .pp-platform{position:absolute;inset:30px 7% 14px;border-radius:50%/30%;transform:rotateX(64deg);background:radial-gradient(circle at 50% 50%,rgba(20,83,45,.92) 0,rgba(7,55,45,.98) 52%,rgba(43,29,11,.98) 67%,rgba(11,11,13,1) 79%);box-shadow:0 36px 84px rgba(0,0,0,.58),inset 0 0 40px rgba(255,255,255,.07)}',
      '#luxe-arena.pp-arcade .pp-platform.checkers{background:radial-gradient(circle at 50% 50%,rgba(6,95,70,.92) 0,rgba(6,78,59,.98) 50%,rgba(28,25,23,.98) 68%,rgba(10,10,10,1) 80%)}',
      '#luxe-arena.pp-arcade .pp-board-shell{position:relative;z-index:2;width:min(78vw,520px);max-width:calc(100vw - 110px);aspect-ratio:1;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 42px rgba(0,0,0,.36)}',
      '#luxe-arena.pp-arcade .pp-square{position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .14s ease,background .2s ease}',
      '#luxe-arena.pp-arcade .pp-square.light{background:linear-gradient(135deg,#d7d2c8,#b7b0a5)}',
      '#luxe-arena.pp-arcade .pp-square.dark{background:linear-gradient(135deg,#2b313a,#161d26)}',
      '#luxe-arena.pp-arcade .pp-square.emerald.light{background:linear-gradient(135deg,#2b5a45,#234838)}',
      '#luxe-arena.pp-arcade .pp-square.emerald.dark{background:linear-gradient(135deg,#0f241c,#08140f)}',
      '#luxe-arena.pp-arcade .pp-square.selected{box-shadow:inset 0 0 0 4px rgba(59,130,246,.8)}',
      '#luxe-arena.pp-arcade .pp-square.valid:after{content:"";position:absolute;width:26%;height:26%;border-radius:50%;background:rgba(34,197,94,.55)}',
      '#luxe-arena.pp-arcade .pp-square.capture{box-shadow:inset 0 0 0 4px rgba(248,113,113,.8)}',
      '#luxe-arena.pp-arcade .pp-piece{position:relative;width:76%;height:76%;display:flex;align-items:center;justify-content:center;transform:translateY(-2px)}',
      '#luxe-arena.pp-arcade .pp-checker{width:74%;height:74%;border-radius:50%;box-shadow:0 8px 16px rgba(0,0,0,.36),inset 0 2px 5px rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.14)}',
      '#luxe-arena.pp-arcade .pp-checker.gold{background:linear-gradient(180deg,#fde68a,#b45309)}',
      '#luxe-arena.pp-arcade .pp-checker.crimson{background:linear-gradient(180deg,#fb7185,#be123c)}',
      '#luxe-arena.pp-arcade .pp-checker.king:after{content:"K";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:900;color:#0f172a}',
      '#luxe-arena.pp-arcade .pp-piece svg{width:100%;height:100%;filter:drop-shadow(0 6px 12px rgba(0,0,0,.34))}',
      '#luxe-arena.pp-arcade .pp-sidepanel{display:flex;flex-direction:column;gap:14px;min-height:0;min-width:0}',
      '#luxe-arena.pp-arcade .pp-panel{padding:14px 16px;border-radius:22px;background:rgba(2,6,23,.72);border:1px solid rgba(148,163,184,.14)}',
      '#luxe-arena.pp-arcade .pp-panel-title{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#8fb6d9;margin-bottom:8px}',
      '#luxe-arena.pp-arcade .pp-insight{font-size:13px;line-height:1.55;color:#dbe7f5;min-height:60px}',
      '#luxe-arena.pp-arcade .pp-start-strip{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;position:relative;z-index:3;margin:54px 0 8px}',
      '#luxe-arena.pp-arcade .pp-start-tab{border:none;border-radius:999px;padding:10px 14px;background:rgba(7,13,24,.82);color:#f8fbff;font-size:12px;font-weight:800;letter-spacing:.04em;border:1px solid rgba(255,255,255,.1);cursor:pointer}',
      '#luxe-arena.pp-arcade .pp-start-tab.primary{background:linear-gradient(135deg,#0ea5e9,#2563eb);border:none}',
      '#luxe-arena.pp-arcade .pp-start-tab.accent{background:linear-gradient(135deg,#f59e0b,#ec4899);border:none}',
      '#luxe-arena.pp-arcade .pp-action-stack{display:flex;flex-direction:column;gap:10px}',
      '#luxe-arena.pp-arcade .pp-action-wide{width:100%;justify-content:center;display:flex;align-items:center;gap:8px}',
      '#luxe-arena.pp-arcade .pp-chat{flex:1;min-height:140px;max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:8px}',
      '#luxe-arena.pp-arcade .pp-chat-msg{padding:10px 12px;border-radius:14px;background:rgba(15,23,42,.64);font-size:12px;color:#d7e4f3;word-break:break-word}',
      '#luxe-arena.pp-arcade .pp-chat-msg.system{color:#93a4b8;font-style:italic}',
      '#luxe-arena.pp-arcade .pp-chat-compose{display:flex;gap:8px;margin-top:10px;max-width:100%}',
      '#luxe-arena.pp-arcade .pp-chat-compose input{flex:1;min-width:0;border:none;border-radius:16px;padding:12px 14px;background:rgba(15,23,42,.74);color:#fff;outline:none}',
      '#luxe-arena.pp-arcade .pp-chat-compose button{border:none;border-radius:16px;padding:0 14px;background:linear-gradient(135deg,#0ea5e9,#2563eb);color:#fff;font-weight:700;cursor:pointer;flex:0 0 auto}',
      '#luxe-arena.pp-arcade .pp-chiprail{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:8px}',
      '#luxe-arena.pp-arcade .pp-chip{width:26px;height:10px;border-radius:999px;border:1px solid rgba(255,255,255,.24);box-shadow:0 4px 8px rgba(0,0,0,.24)}',
      '#luxe-arena.pp-arcade .pp-chip.gold{background:linear-gradient(180deg,#fde68a,#b45309)}',
      '#luxe-arena.pp-arcade .pp-chip.blue{background:linear-gradient(180deg,#60a5fa,#1d4ed8)}',
      '#luxe-arena.pp-arcade .pp-chip.red{background:linear-gradient(180deg,#fb7185,#be123c)}',
      '#luxe-arena.pp-arcade .pp-controls{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:14px;position:sticky;bottom:0;z-index:6;padding:12px 0 calc(10px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,rgba(5,8,14,0),rgba(5,8,14,.88) 36%,rgba(5,8,14,.98));backdrop-filter:blur(8px)}',
      '#luxe-arena.pp-arcade .pp-control{border:none;border-radius:16px;padding:10px 14px;background:rgba(15,23,42,.7);color:#e5eef8;font-weight:700;cursor:pointer;border:1px solid rgba(148,163,184,.14)}',
      '#luxe-arena.pp-arcade .pp-control.primary{background:linear-gradient(135deg,#0ea5e9,#2563eb);border:none}',
      '#luxe-arena.pp-arcade .pp-lesson-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:14;padding:24px;background:rgba(2,6,23,.16)}',
      '#luxe-arena.pp-arcade .pp-lesson-overlay.hidden{display:none}',
      '#luxe-arena.pp-arcade .pp-lesson-card{max-width:420px;padding:22px 24px;border-radius:26px;background:linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,.08));border:1px solid rgba(255,255,255,.22);box-shadow:0 24px 60px rgba(0,0,0,.32);backdrop-filter:blur(18px);cursor:pointer;transition:transform .2s ease,opacity .35s ease,filter .35s ease}',
      '#luxe-arena.pp-arcade .pp-lesson-card h3{font-size:18px;margin:0 0 10px;color:#fff}',
      '#luxe-arena.pp-arcade .pp-lesson-card p{font-size:13px;line-height:1.65;color:#dbe7f5;margin:0 0 12px}',
      '#luxe-arena.pp-arcade .pp-lesson-card small{display:block;color:#93a4b8;letter-spacing:.08em;text-transform:uppercase}',
      '#luxe-arena.pp-arcade .pp-lesson-card.dissolve{opacity:0;transform:scale(.94);filter:blur(14px)}',
      '#luxe-arena.pp-arcade .pp-mode-note{position:absolute;left:50%;bottom:100px;transform:translateX(-50%);z-index:2;padding:10px 14px;border-radius:16px;background:rgba(15,23,42,.76);border:1px solid rgba(148,163,184,.14);font-size:12px;color:#dce7f6;max-width:min(520px,calc(100vw - 72px));text-align:center}',
      '#luxe-arena.pp-arcade .pp-floating-gift{position:fixed;right:max(16px,env(safe-area-inset-right,0px) + 12px);bottom:max(18px,env(safe-area-inset-bottom,0px) + 12px);z-index:10001;border:none;border-radius:999px;padding:14px 18px;background:linear-gradient(135deg,#f59e0b,#ec4899);color:#fff;font-weight:800;box-shadow:0 18px 36px rgba(0,0,0,.32);cursor:pointer}',
      '@media (max-width:1024px){#luxe-arena.pp-arcade .pp-arcade-main{grid-template-columns:1fr}#luxe-arena.pp-arcade .pp-scene{min-height:640px}#luxe-arena.pp-arcade .pp-sidepanel{order:2}}',
      '@media (max-width:720px){#luxe-arena.pp-arcade .pp-arcade-topbar{padding-left:12px;padding-right:12px}#luxe-arena.pp-arcade .pp-arcade-main{padding:12px;gap:12px}#luxe-arena.pp-arcade .pp-scene{padding:14px 14px 124px;min-height:580px;border-radius:24px}#luxe-arena.pp-arcade .pp-avatar{width:86px;height:86px}#luxe-arena.pp-arcade .pp-player-card{min-width:0;width:min(100%,220px);padding:12px}#luxe-arena.pp-arcade .pp-board-zone{padding:62px 8px 20px}#luxe-arena.pp-arcade .pp-board-shell{width:min(100%,420px);max-width:calc(100vw - 44px)}#luxe-arena.pp-arcade .pp-mode-note{bottom:150px;max-width:calc(100vw - 32px)}#luxe-arena.pp-arcade .pp-vegas-wall{width:26px;top:64px;bottom:160px}#luxe-arena.pp-arcade .pp-chat-compose{flex-wrap:wrap}#luxe-arena.pp-arcade .pp-chat-compose button{min-height:42px}#luxe-arena.pp-arcade .pp-controls{justify-content:stretch;padding-top:10px}#luxe-arena.pp-arcade .pp-control{flex:1 1 140px}#luxe-arena.pp-arcade .pp-neon-badge{top:16px;font-size:10px;letter-spacing:.12em}#luxe-arena.pp-arcade .pp-start-strip{margin-top:44px}#luxe-arena.pp-arcade .pp-floating-gift{bottom:max(92px,env(safe-area-inset-bottom,0px) + 86px)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function baseState() {
    if (window.laAIMoveTimer) clearTimeout(window.laAIMoveTimer);
    if (window.laDemoTimer) clearTimeout(window.laDemoTimer);
    window.laBoard = window.laBoard || [];
    window.laSelected = null;
    window.laValidMoves = [];
    window.laTurn = 'gold';
    window.laScoreGold = 0;
    window.laScoreHolo = 0;
    window.laCapturedGold = [];
    window.laCapturedHolo = [];
    window.laCheerLevel = 0;
    window.laMoveCount = 0;
    window.laAIEnabled = false;
    window.laAIDifficulty = 'medium';
    window.laAIColor = 'holo';
    window.laLessonActive = false;
    window.laCurrentLessonMode = 'chess';
    window.laCurrentLessonIdx = 0;
    window.laHumanOpponentName = 'Ruby Seat';
    window.laAIMoveTimer = null;
    window.laDemoTimer = null;
    window.laDemoMode = false;
    window.laDemoDifficulty = 'medium';
  }

  function pieceSvg(type, color) {
    var fill = color === 'gold' ? 'url(#ppGoldG)' : 'url(#ppCrimsonG)';
    var defs = '<defs><linearGradient id="ppGoldG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fde68a"/><stop offset="100%" stop-color="#b45309"/></linearGradient><linearGradient id="ppCrimsonG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fb7185"/><stop offset="100%" stop-color="#be123c"/></linearGradient></defs>';
    var icons = {
      K: '<svg viewBox="0 0 45 45">' + defs + '<g fill="' + fill + '" stroke="#0f172a" stroke-width="1.5"><path d="M22.5 11.63V6M20 8h5"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"/><path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z"/></g></svg>',
      Q: '<svg viewBox="0 0 45 45">' + defs + '<g fill="' + fill + '" stroke="#0f172a" stroke-width="1.5"><circle cx="6" cy="12" r="2.5"/><circle cx="14" cy="9" r="2.5"/><circle cx="22.5" cy="8" r="2.5"/><circle cx="31" cy="9" r="2.5"/><circle cx="39" cy="12" r="2.5"/><path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-8.5-14.5-8.5 14.5-7.5-13.5L9 26z"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 3.5-1 5.5-3 2-5 2.5-5 4 0 .5 0 1 1 1.5 1 .5 2.5 1 4.5 1h22c2 0 3.5-.5 4.5-1 1-.5 1-1 1-1.5 0-1.5-2-2-5-4-2-2-2-4-1-5.5 1-2 2.5-2 2.5-4"/></g></svg>',
      R: '<svg viewBox="0 0 45 45">' + defs + '<g fill="' + fill + '" stroke="#0f172a" stroke-width="1.5"><path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5"/><path d="M34 14l-3 3H14l-3-3"/><path d="M15 17v7h15v-7"/><path d="M14 29.5v-13h17v13H14z"/></g></svg>',
      B: '<svg viewBox="0 0 45 45">' + defs + '<g fill="' + fill + '" stroke="#0f172a" stroke-width="1.5"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2z"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><circle cx="22.5" cy="8" r="2.5"/></g></svg>',
      N: '<svg viewBox="0 0 45 45">' + defs + '<g fill="' + fill + '" stroke="#0f172a" stroke-width="1.5"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3"/><circle cx="14" cy="15.5" r="1" fill="#0f172a" stroke="none"/></g></svg>',
      P: '<svg viewBox="0 0 45 45">' + defs + '<g fill="' + fill + '" stroke="#0f172a" stroke-width="1.5"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"/></g></svg>'
    };
    return icons[type] || '';
  }

  function initGameBoard(mode) {
    baseState();
    window.laGameMode = mode;
    window.laBoard = Array.from({ length: 8 }, function() { return Array(8).fill(null); });
    if (mode === 'chess') {
      var back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
      for (var c = 0; c < 8; c += 1) {
        window.laBoard[0][c] = { type: back[c], color: 'holo' };
        window.laBoard[1][c] = { type: 'P', color: 'holo' };
        window.laBoard[6][c] = { type: 'P', color: 'gold' };
        window.laBoard[7][c] = { type: back[c], color: 'gold' };
      }
    } else {
      for (var r = 0; r < 3; r += 1) for (var c2 = 0; c2 < 8; c2 += 1) if ((r + c2) % 2 === 1) window.laBoard[r][c2] = { type: 'C', color: 'holo' };
      for (var r2 = 5; r2 < 8; r2 += 1) for (var c3 = 0; c3 < 8; c3 += 1) if ((r2 + c3) % 2 === 1) window.laBoard[r2][c3] = { type: 'C', color: 'gold' };
    }
    renderArcade();
    setInsight(mode === 'chess' ? 'Gold opens the board. Build space, then pressure the center.' : 'Gold moves first. Hunt diagonals and keep your king lanes clean.');
  }

  function getValidMoves(r, c) {
    var piece = window.laBoard[r] && window.laBoard[r][c];
    if (!piece) return [];
    var moves = [];
    var enemy = piece.color === 'gold' ? 'holo' : 'gold';
    if (window.laGameMode === 'checkers') {
      var dirs = piece.type === 'CK' ? [-1, 1] : (piece.color === 'gold' ? [-1] : [1]);
      for (var i = 0; i < dirs.length; i += 1) {
        for (var dc = -1; dc <= 1; dc += 2) {
          var nr = r + dirs[i];
          var nc = c + dc;
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          if (!window.laBoard[nr][nc]) {
            moves.push({ r: nr, c: nc });
          } else if (window.laBoard[nr][nc].color === enemy) {
            var jr = nr + dirs[i];
            var jc = nc + dc;
            if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 && !window.laBoard[jr][jc]) moves.push({ r: jr, c: jc, jump: { r: nr, c: nc } });
          }
        }
      }
      return moves;
    }

    function addLinear(dirs) {
      dirs.forEach(function(dir) {
        var nr = r + dir[0];
        var nc = c + dir[1];
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          if (!window.laBoard[nr][nc]) {
            moves.push({ r: nr, c: nc });
          } else {
            if (window.laBoard[nr][nc].color === enemy) moves.push({ r: nr, c: nc });
            break;
          }
          nr += dir[0];
          nc += dir[1];
        }
      });
    }

    if (piece.type === 'P') {
      var dir = piece.color === 'gold' ? -1 : 1;
      var startRow = piece.color === 'gold' ? 6 : 1;
      if (r + dir >= 0 && r + dir < 8 && !window.laBoard[r + dir][c]) {
        moves.push({ r: r + dir, c: c });
        if (r === startRow && !window.laBoard[r + (2 * dir)][c]) moves.push({ r: r + (2 * dir), c: c });
      }
      [-1, 1].forEach(function(offset) {
        var nr = r + dir;
        var nc = c + offset;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && window.laBoard[nr][nc] && window.laBoard[nr][nc].color === enemy) moves.push({ r: nr, c: nc });
      });
    } else if (piece.type === 'N') {
      [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(function(step) {
        var nr = r + step[0];
        var nc = c + step[1];
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && (!window.laBoard[nr][nc] || window.laBoard[nr][nc].color === enemy)) moves.push({ r: nr, c: nc });
      });
    } else if (piece.type === 'K') {
      for (var dr = -1; dr <= 1; dr += 1) {
        for (var dc2 = -1; dc2 <= 1; dc2 += 1) {
          if (!dr && !dc2) continue;
          var nr2 = r + dr;
          var nc2 = c + dc2;
          if (nr2 >= 0 && nr2 < 8 && nc2 >= 0 && nc2 < 8 && (!window.laBoard[nr2][nc2] || window.laBoard[nr2][nc2].color === enemy)) moves.push({ r: nr2, c: nc2 });
        }
      }
    } else if (piece.type === 'R') {
      addLinear([[-1, 0], [1, 0], [0, -1], [0, 1]]);
    } else if (piece.type === 'B') {
      addLinear([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
    } else if (piece.type === 'Q') {
      addLinear([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]);
    }
    if (window.laGameMode === 'checkers') {
      var forced = getForcedCaptureMoves(piece.color);
      if (forced.length > 0) {
        return moves.filter(function(move) {
          return !!move.jump && forced.some(function(forcedMove) {
            return forcedMove.from.r === r && forcedMove.from.c === c && forcedMove.to.r === move.r && forcedMove.to.c === move.c;
          });
        });
      }
      return moves;
    }
    return moves.filter(function(move) { return isLegalChessMove(r, c, move, piece.color); });
  }

  function cloneBoard(board) {
    return board.map(function(row) {
      return row.map(function(cell) {
        return cell ? { type: cell.type, color: cell.color } : null;
      });
    });
  }

  function applyMoveOnBoard(board, from, move) {
    var copy = cloneBoard(board);
    var moving = copy[from.r][from.c];
    if (!moving) return copy;
    if (move.jump) copy[move.jump.r][move.jump.c] = null;
    copy[move.r][move.c] = moving;
    copy[from.r][from.c] = null;
    if (moving.type === 'P' && ((moving.color === 'gold' && move.r === 0) || (moving.color === 'holo' && move.r === 7))) moving.type = 'Q';
    if (moving.type === 'C' && ((moving.color === 'gold' && move.r === 0) || (moving.color === 'holo' && move.r === 7))) moving.type = 'CK';
    return copy;
  }

  function findKing(board, color) {
    for (var r = 0; r < 8; r += 1) {
      for (var c = 0; c < 8; c += 1) {
        if (board[r][c] && board[r][c].type === 'K' && board[r][c].color === color) return { r: r, c: c };
      }
    }
    return null;
  }

  function attacksSquare(board, fromR, fromC, targetR, targetC) {
    var piece = board[fromR][fromC];
    if (!piece) return false;
    var dr = targetR - fromR;
    var dc = targetC - fromC;
    if (piece.type === 'P') {
      var dir = piece.color === 'gold' ? -1 : 1;
      return dr === dir && Math.abs(dc) === 1;
    }
    if (piece.type === 'N') {
      return (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2);
    }
    if (piece.type === 'K') {
      return Math.max(Math.abs(dr), Math.abs(dc)) === 1;
    }
    function clearPath(stepR, stepC) {
      var r = fromR + stepR;
      var c = fromC + stepC;
      while (r !== targetR || c !== targetC) {
        if (board[r][c]) return false;
        r += stepR;
        c += stepC;
      }
      return true;
    }
    if (piece.type === 'R' || piece.type === 'Q') {
      if (dr === 0 && dc !== 0) return clearPath(0, dc > 0 ? 1 : -1);
      if (dc === 0 && dr !== 0) return clearPath(dr > 0 ? 1 : -1, 0);
    }
    if (piece.type === 'B' || piece.type === 'Q') {
      if (Math.abs(dr) === Math.abs(dc) && dr !== 0) return clearPath(dr > 0 ? 1 : -1, dc > 0 ? 1 : -1);
    }
    return false;
  }

  function isKingInCheck(board, color) {
    var king = findKing(board, color);
    if (!king) return true;
    var enemy = color === 'gold' ? 'holo' : 'gold';
    for (var r = 0; r < 8; r += 1) {
      for (var c = 0; c < 8; c += 1) {
        if (board[r][c] && board[r][c].color === enemy && attacksSquare(board, r, c, king.r, king.c)) return true;
      }
    }
    return false;
  }

  function isLegalChessMove(fromR, fromC, move, color) {
    return !isKingInCheck(applyMoveOnBoard(window.laBoard, { r: fromR, c: fromC }, move), color);
  }

  function getForcedCaptureMoves(color) {
    var forced = [];
    for (var r = 0; r < 8; r += 1) {
      for (var c = 0; c < 8; c += 1) {
        var piece = window.laBoard[r][c];
        if (!piece || piece.color !== color) continue;
        var dirs = piece.type === 'CK' ? [-1, 1] : (piece.color === 'gold' ? [-1] : [1]);
        for (var i = 0; i < dirs.length; i += 1) {
          for (var dc = -1; dc <= 1; dc += 2) {
            var nr = r + dirs[i];
            var nc = c + dc;
            var jr = nr + dirs[i];
            var jc = nc + dc;
            if (jr < 0 || jr > 7 || jc < 0 || jc > 7 || nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
            if (window.laBoard[nr][nc] && window.laBoard[nr][nc].color !== color && !window.laBoard[jr][jc]) {
              forced.push({ from: { r: r, c: c }, to: { r: jr, c: jc, jump: { r: nr, c: nc } } });
            }
          }
        }
      }
    }
    return forced;
  }

  function hasAnyLegalMove(color) {
    for (var r = 0; r < 8; r += 1) {
      for (var c = 0; c < 8; c += 1) {
        if (window.laBoard[r][c] && window.laBoard[r][c].color === color && getValidMoves(r, c).length > 0) return true;
      }
    }
    return false;
  }

  function evaluateGameState() {
    if (window.laGameMode === 'checkers') {
      var nextColor = window.laTurn;
      if (!hasAnyLegalMove(nextColor)) {
        var winner = nextColor === 'gold' ? 'Nova' : 'You';
        setInsight(winner + ' wins. No legal checkers moves remain.');
        pushChat(winner + ' wins by locking the board.', true);
        window.laAIEnabled = false;
        stopAutomation();
      }
      return;
    }

    var side = window.laTurn;
    var inCheck = isKingInCheck(window.laBoard, side);
    var canMove = hasAnyLegalMove(side);
    if (!canMove && inCheck) {
      var winnerName = side === 'gold' ? 'Nova' : 'You';
      setInsight('Checkmate. ' + winnerName + ' closes the board.');
      pushChat('Checkmate. ' + winnerName + ' wins the chess table.', true);
      window.laAIEnabled = false;
      stopAutomation();
      return;
    }
    if (!canMove) {
      setInsight('Stalemate. No legal move remains for ' + (side === 'gold' ? 'you' : 'Nova') + '.');
      pushChat('Stalemate. The chess table ends drawn.', true);
      window.laAIEnabled = false;
      stopAutomation();
      return;
    }
    if (inCheck) {
      setInsight((side === 'gold' ? 'You are' : 'Nova is') + ' in check. Resolve the threat first.');
      pushChat((side === 'gold' ? 'You are' : 'Nova is') + ' in check.', true);
    }
  }

  function getContinuationJump(from, color) {
    if (window.laGameMode !== 'checkers') return null;
    var chainMoves = getValidMoves(from.r, from.c).filter(function(move) { return !!move.jump; });
    if (chainMoves.length === 0) return null;
    window.laSelected = { r: from.r, c: from.c };
    window.laValidMoves = chainMoves;
    window.laTurn = color;
    return chainMoves;
  }

  function advanceAfterMove(target, movedColor, actorName) {
    var continuation = getContinuationJump(target, movedColor);
    if (continuation) {
      setInsight(actorName + ' must continue the capture chain before ending the turn.');
      pushChat(actorName + ' continues the jump sequence.', true);
      return false;
    }
    window.laTurn = movedColor === 'gold' ? 'holo' : 'gold';
    window.laSelected = null;
    window.laValidMoves = [];
    evaluateGameState();
    return true;
  }

  function applyMove(from, move) {
    var moving = window.laBoard[from.r][from.c];
    var movingColor = moving ? moving.color : window.laTurn;
    var captured = window.laBoard[move.r][move.c];
    if (move.jump) {
      captured = window.laBoard[move.jump.r][move.jump.c];
      window.laBoard[move.jump.r][move.jump.c] = null;
    }
    if (captured) {
      if (window.laTurn === 'gold') {
        window.laScoreGold += 1;
        window.laCapturedGold.push(captured.type);
      } else {
        window.laScoreHolo += 1;
        window.laCapturedHolo.push(captured.type);
      }
    }
    window.laBoard[move.r][move.c] = moving;
    window.laBoard[from.r][from.c] = null;
    if (window.laGameMode === 'chess' && moving.type === 'P' && ((moving.color === 'gold' && move.r === 0) || (moving.color === 'holo' && move.r === 7))) moving.type = 'Q';
    if (window.laGameMode === 'checkers' && moving.type === 'C' && ((moving.color === 'gold' && move.r === 0) || (moving.color === 'holo' && move.r === 7))) moving.type = 'CK';
    window.laMoveCount += 1;
    return advanceAfterMove({ r: move.r, c: move.c }, movingColor, movingColor === 'gold' ? 'You' : 'Nova');
  }

  function renderSquare(r, c) {
    var piece = window.laBoard[r][c];
    var isLight = (r + c) % 2 === 0;
    var selected = window.laSelected && window.laSelected.r === r && window.laSelected.c === c;
    var valid = window.laValidMoves.some(function(move) { return move.r === r && move.c === c; });
    var capture = valid && (!!piece || window.laValidMoves.find(function(move) { return move.r === r && move.c === c && move.jump; }));
    var cls = ['pp-square', window.laGameMode === 'checkers' ? 'emerald' : '', isLight ? 'light' : 'dark', selected ? 'selected' : '', valid ? 'valid' : '', capture ? 'capture' : ''].join(' ').trim();
    var inner = '';
    if (piece) {
      if (window.laGameMode === 'checkers') {
        inner = '<div class="pp-piece"><div class="pp-checker ' + (piece.color === 'gold' ? 'gold' : 'crimson') + (piece.type === 'CK' ? ' king' : '') + '"></div></div>';
      } else {
        inner = '<div class="pp-piece">' + pieceSvg(piece.type, piece.color) + '</div>';
      }
    }
    return '<div class="' + cls + '" onclick="handleTileClick(' + r + ',' + c + ')">' + inner + '</div>';
  }

  function chipRail(score) {
    var count = Math.max(1, Math.min(6, score + 1));
    var html = '';
    for (var i = 0; i < count; i += 1) html += '<div class="pp-chip ' + (i % 3 === 0 ? 'gold' : (i % 3 === 1 ? 'blue' : 'red')) + '"></div>';
    return html;
  }

  function getThemeMeta(mode) {
    if (mode === 'checkers') {
      return {
        title: '&#128142; Emerald Quest',
        badge: 'Emerald City Social Table',
        subtitle: window.laLessonActive
          ? 'Guided lesson mode. Tap the glass card when you are ready to continue.'
          : (window.laAIEnabled
            ? 'Wizard-of-Oz inspired checkers against a live AI rival.'
            : 'A yellow-brick social table for friendly checkers and demos.')
      };
    }
    return {
      title: '&#127919; MI6 Royale',
      badge: '007 Social Strategy Table',
      subtitle: window.laLessonActive
        ? 'Guided lesson mode. Tap the glass card when you are ready to continue.'
        : (window.laAIEnabled
          ? '007-inspired chess against a live AI rival.'
          : 'A spy-lounge table for social chess, demos, and lessons.')
    };
  }

  function setInsight(text) {
    var el = document.getElementById('pp-arcade-insight');
    if (el) el.textContent = text;
  }

  function pushChat(text, system) {
    var chat = document.getElementById('pp-arcade-chat');
    if (!chat) return;
    var item = document.createElement('div');
    item.className = 'pp-chat-msg' + (system ? ' system' : '');
    item.textContent = text;
    chat.appendChild(item);
    chat.scrollTop = chat.scrollHeight;
  }

  function stopAutomation() {
    if (window.laAIMoveTimer) clearTimeout(window.laAIMoveTimer);
    if (window.laDemoTimer) clearTimeout(window.laDemoTimer);
    window.laAIMoveTimer = null;
    window.laDemoTimer = null;
    window.laDemoMode = false;
  }

  function ensureShell(mode) {
    injectStyles();
    var arena = document.getElementById('luxe-arena');
    if (!arena) return null;
    arena.className = 'luxe-arena-overlay pp-arcade';
    arena.style.display = '';
    if (!arena.dataset.ppArcadeMounted) {
      arena.innerHTML = [
        '<div class="pp-arcade-shell">',
        '  <div class="pp-arcade-topbar">',
        '    <div>',
        '      <div class="pp-arcade-title" id="pp-arcade-title">Strategy Lounge</div>',
        '      <div class="pp-arcade-sub" id="pp-arcade-sub">Cinematic board play with human and AI avatars.</div>',
        '    </div>',
        '    <div class="pp-topbar-actions">',
        '      <button class="pp-arcade-btn" onclick="showGiftModal()" title="Gift a Drink">&#127870;</button>',
        '      <button class="pp-arcade-btn" onclick="leaveLuxeGame()" title="Leave">&#10005;</button>',
        '    </div>',
        '  </div>',
        '  <div class="pp-arcade-main">',
        '    <div class="pp-scene">',
        '      <div class="pp-vegas-wall left"></div>',
        '      <div class="pp-vegas-wall right"></div>',
        '      <div class="pp-neon-badge" id="pp-neon-badge">PromptPay Vegas Social Lounge</div>',
        '      <div class="pp-stage">',
        '        <div class="pp-start-strip">',
        '          <button class="pp-start-tab" onclick="startLuxeGame(laGameMode || \'chess\')">Start Table</button>',
        '          <button class="pp-start-tab primary" onclick="startAIGame(laGameMode || \'chess\', laAIDifficulty || \'medium\')">Play Nova</button>',
        '          <button class="pp-start-tab accent" onclick="startDemoGame(laGameMode || \'chess\')">Demo Moves</button>',
        '          <button class="pp-start-tab" onclick="startLesson(laGameMode || \'chess\', 0)">Lessons</button>',
        '        </div>',
        '        <div class="pp-seat-row"><div class="pp-player" id="pp-opponent"></div></div>',
        '        <div class="pp-board-zone">',
        '          <div class="pp-platform" id="pp-platform"></div>',
        '          <div class="pp-board-shell" id="pp-board-shell"></div>',
        '          <div class="pp-mode-note" id="pp-mode-note"></div>',
        '        </div>',
        '        <div class="pp-seat-row"><div class="pp-player" id="pp-user"></div></div>',
        '      </div>',
        '      <div class="pp-controls">',
        '        <button class="pp-control" onclick="showGiftModal()">Gift a Drink</button>',
        '        <button class="pp-control" onclick="showSendMoneyModal()">Send Money</button>',
        '        <button class="pp-control primary" onclick="startAIGame(laGameMode, laAIDifficulty || \'medium\')">Restart vs AI</button>',
        '      </div>',
        '      <div class="pp-lesson-overlay hidden" id="pp-lesson-overlay">',
        '        <div class="pp-lesson-card" id="pp-lesson-card" onclick="dismissLessonOverlay()">',
        '          <small id="pp-lesson-kicker">Lesson</small>',
        '          <h3 id="pp-lesson-title">Lesson</h3>',
        '          <p id="pp-lesson-body">Tap anywhere on this glass card when you are ready to continue.</p>',
        '          <small>Tap to continue</small>',
        '        </div>',
        '      </div>',
        '    </div>',
        '    <div class="pp-sidepanel">',
        '      <div class="pp-panel">',
        '        <div class="pp-panel-title">Table Brief</div>',
        '        <div class="pp-insight" id="pp-arcade-insight">Opening the lounge…</div>',
      '      </div>',
        '      <div class="pp-panel">',
        '        <div class="pp-panel-title">Table Service</div>',
        '        <div class="pp-action-stack">',
        '          <button class="pp-control pp-action-wide" onclick="showGiftModal()">&#127870; Gift a Drink</button>',
        '          <button class="pp-control pp-action-wide" onclick="showSendMoneyModal()">&#128176; Send Money</button>',
        '        </div>',
        '      </div>',
        '      <div class="pp-panel">',
        '        <div class="pp-panel-title">Table Talk</div>',
        '        <div class="pp-chat" id="pp-arcade-chat"></div>',
        '        <div class="pp-chat-compose">',
        '          <input id="la-chat-input" placeholder="Say something at the table…" onkeydown="if(event.key===\'Enter\'){sendLoungeChat();}">',
        '          <button onclick="sendLoungeChat()">Send</button>',
        '        </div>',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>',
        '<button class="pp-floating-gift" onclick="showGiftModal()">Gift a Drink</button>'
      ].join('');
      arena.dataset.ppArcadeMounted = '1';
    }
    document.getElementById('pp-platform').className = 'pp-platform' + (mode === 'checkers' ? ' checkers' : '');
    document.getElementById('pp-mode-note').textContent = mode === 'checkers'
      ? 'Friendly strategy only. No wagering, no cash value, no gambling.'
      : 'Friendly strategy only. Practice, learn, and play socially.';
    return arena;
  }

  function renderArcade() {
    ensureShell(window.laGameMode || 'chess');
    var boardShell = document.getElementById('pp-board-shell');
    if (!boardShell) return;
    var html = '';
    for (var r = 0; r < 8; r += 1) for (var c = 0; c < 8; c += 1) html += renderSquare(r, c);
    boardShell.innerHTML = html;

    var opponentName = window.laAIEnabled ? 'Nova' : window.laHumanOpponentName;
    var opponentRole = window.laAIEnabled ? 'AI table rival' : 'Human seat';
    document.getElementById('pp-opponent').className = 'pp-player' + (window.laTurn === 'holo' ? ' active' : '');
    document.getElementById('pp-user').className = 'pp-player' + (window.laTurn === 'gold' ? ' active' : '');
    document.getElementById('pp-opponent').innerHTML = [
      '<div class="pp-avatar ' + (window.laAIEnabled ? 'ai ' + (window.laAITone || 'thinking') : 'human') + '">',
      '  <div class="pp-hair ' + (window.laAIEnabled ? 'ai-hair' : '') + '"></div>',
      '  <div class="pp-face ' + (window.laAIEnabled ? 'ai-face' : '') + '"><div class="pp-eye left"></div><div class="pp-eye right"></div><div class="pp-mouth"></div></div>',
      window.laAIEnabled ? '<div class="pp-projector"></div>' : '',
      '</div>',
      '<div class="pp-player-card"><div class="pp-player-name">' + opponentName + '</div><div class="pp-player-meta">' + opponentRole + '</div><div class="pp-player-score">Captured: ' + window.laCapturedHolo.length + ' | Score: ' + window.laScoreHolo + '</div><div class="pp-chiprail">' + chipRail(window.laScoreHolo) + '</div></div>'
    ].join('');
    document.getElementById('pp-user').innerHTML = [
      '<div class="pp-avatar human"><div class="pp-hair"></div><div class="pp-face"><div class="pp-eye left"></div><div class="pp-eye right"></div><div class="pp-mouth"></div></div></div>',
      '<div class="pp-player-card"><div class="pp-player-name">You</div><div class="pp-player-meta">Human player</div><div class="pp-player-score">Captured: ' + window.laCapturedGold.length + ' | Score: ' + window.laScoreGold + '</div><div class="pp-chiprail">' + chipRail(window.laScoreGold) + '</div></div>'
    ].join('');

    var theme = getThemeMeta(window.laGameMode);
    document.getElementById('pp-arcade-title').innerHTML = theme.title;
    document.getElementById('pp-arcade-sub').textContent = theme.subtitle;
    document.getElementById('pp-neon-badge').textContent = theme.badge;
  }

  function queueAITurn(delayMs) {
    if (window.laAIMoveTimer) clearTimeout(window.laAIMoveTimer);
    if (!window.laAIEnabled || window.laDemoMode || window.laTurn !== window.laAIColor) return;
    window.laAIMoveTimer = setTimeout(function() {
      window.laAIMoveTimer = null;
      executeAITurn();
    }, delayMs || 550);
  }

  function queueDemoTurn(delayMs) {
    if (window.laDemoTimer) clearTimeout(window.laDemoTimer);
    if (!window.laDemoMode) return;
    window.laDemoTimer = setTimeout(function() {
      window.laDemoTimer = null;
      executeDemoTurn();
    }, delayMs || 700);
  }

  function handleTileClick(r, c) {
    if (window.laDemoMode) return;
    if (window.laAIEnabled && window.laTurn === window.laAIColor) return;
    var piece = window.laBoard[r] && window.laBoard[r][c];
    var valid = window.laValidMoves.find(function(move) { return move.r === r && move.c === c; });
    if (window.laSelected && valid) {
      var turnAdvanced = applyMove(window.laSelected, valid);
      renderArcade();
      pushChat('Move played to ' + String.fromCharCode(97 + c) + (8 - r) + '.', false);
      if (turnAdvanced) {
        setInsight(window.laGameMode === 'chess'
          ? 'Move complete. Keep your king covered while you pressure files and diagonals.'
          : 'Clean diagonal. Watch for the return jump before you overextend.');
        queueAITurn(650);
      }
      return;
    }
    if (piece && piece.color === window.laTurn) {
      window.laSelected = { r: r, c: c };
      window.laValidMoves = getValidMoves(r, c);
      renderArcade();
      setInsight(piece.color === 'gold'
        ? 'Selected your piece. Green markers are safe lines, red markers are captures.'
        : 'Opponent piece selected.');
      return;
    }
    window.laSelected = null;
    window.laValidMoves = [];
    renderArcade();
  }

  function executeBotTurn(botColor, difficulty, botName) {
    var move = LoungeAI.getMove(window.laBoard, window.laGameMode, botColor, difficulty || 'medium');
    if (!move) {
      setInsight(botName + ' is out of legal moves.');
      pushChat(botName + ' has no legal move left.', true);
      stopAutomation();
      window.laAIEnabled = false;
      return false;
    }

    var legal = getValidMoves(move.from.r, move.from.c).find(function(entry) {
      return entry.r === move.to.r && entry.c === move.to.c;
    });
    if (!legal) {
      setInsight(botName + ' attempted an illegal move and automation stopped.');
      pushChat(botName + ' failed move validation.', true);
      stopAutomation();
      window.laAIEnabled = false;
      return false;
    }

    applyMove(move.from, legal);
    if (botColor === 'holo') {
      window.laAITone = (window.laCapturedHolo.length > window.laCapturedGold.length) ? 'pleased' : 'thinking';
    }
    renderArcade();
    pushChat(botName + ' played ' + String.fromCharCode(97 + legal.c) + (8 - legal.r) + '.', true);
    return true;
  }

  function executeAITurn() {
    if (!window.laAIEnabled || window.laTurn !== window.laAIColor) return;
    try {
      window.laAITone = 'thinking';
      renderArcade();
      if (!executeBotTurn(window.laAIColor, window.laAIDifficulty, 'Nova')) {
        window.laAITone = 'annoyed';
        renderArcade();
        return;
      }
      if (window.laTurn === window.laAIColor) {
        window.laAITone = 'bluffing';
        renderArcade();
        setInsight('Nova has another forced capture and keeps the sequence alive.');
        queueAITurn(420);
        return;
      }
      setInsight(window.laGameMode === 'chess'
        ? 'Nova answered. Reassess the center before you commit another piece.'
        : 'Nova answered on the diagonal. Look for a forcing jump or king lane.');
    } catch (error) {
      window.laAIEnabled = false;
      window.laAITone = 'annoyed';
      renderArcade();
      setInsight('The AI routine hit an error and has been disabled for safety.');
      pushChat('AI move failed. Restart the match.', true);
    }
  }

  function executeDemoTurn() {
    if (!window.laDemoMode) return;
    try {
      var color = window.laTurn;
      var name = color === 'gold' ? 'Atlas' : 'Nova';
      if (!executeBotTurn(color, window.laDemoDifficulty, name)) return;
      setInsight(name + ' is showing a demo line. Tap Play Nova when you want control.');
      if (window.laDemoMode && hasAnyLegalMove(window.laTurn)) {
        queueDemoTurn(window.laTurn === color ? 360 : 820);
      }
    } catch (error) {
      stopAutomation();
      setInsight('Demo mode stopped after an automation error.');
      pushChat('Demo mode halted. Start a fresh table to continue.', true);
    }
  }

  function showLessonOverlay(mode, idx) {
    var overlay = document.getElementById('pp-lesson-overlay');
    var card = document.getElementById('pp-lesson-card');
    var info = LoungeLessons.getLessonInfo();
    if (!overlay || !card || !info) return;
    document.getElementById('pp-lesson-kicker').textContent = mode.toUpperCase() + ' lesson ' + (idx + 1);
    document.getElementById('pp-lesson-title').textContent = info.lesson.title;
    document.getElementById('pp-lesson-body').textContent = info.lesson.desc + ' ' + info.hint;
    card.classList.remove('dissolve');
    overlay.classList.remove('hidden');
  }

  function dismissLessonOverlay() {
    var overlay = document.getElementById('pp-lesson-overlay');
    var card = document.getElementById('pp-lesson-card');
    if (!overlay || !card) return;
    card.classList.add('dissolve');
    setTimeout(function() {
      overlay.classList.add('hidden');
      card.classList.remove('dissolve');
    }, 320);
  }

  function startLuxeGame(mode) {
    baseState();
    window.laGameMode = mode;
    stopAutomation();
    ensureShell(mode);
    initGameBoard(mode);
    document.getElementById('pp-arcade-chat').textContent = '';
    setInsight('Join the table to start a social play session. Invite a friend or restart against Nova at any time.');
    pushChat((mode === 'chess' ? 'Chess' : 'Checkers') + ' table is ready. Invite a friend or switch to AI anytime.', true);
  }

  function startAIGame(mode, difficulty) {
    baseState();
    window.laGameMode = mode;
    window.laAIEnabled = true;
    window.laDemoMode = false;
    window.laAIDifficulty = difficulty || 'medium';
    window.laAIColor = 'holo';
    window.laAITone = 'thinking';
    ensureShell(mode);
    initGameBoard(mode);
    document.getElementById('pp-arcade-chat').textContent = '';
    setInsight(mode === 'chess'
      ? 'Nova is online. Expect measured development on easy and sharper tactical pressure on hard.'
      : 'Nova is online. Watch for capture ladders and king races.');
    pushChat('Playing ' + mode + ' vs AI on ' + (difficulty || 'medium') + '.', true);
  }

  function startDemoGame(mode) {
    baseState();
    window.laGameMode = mode;
    window.laAIEnabled = false;
    window.laDemoMode = true;
    window.laDemoDifficulty = 'medium';
    ensureShell(mode);
    initGameBoard(mode);
    document.getElementById('pp-arcade-chat').textContent = '';
    setInsight(mode === 'chess'
      ? 'Demo mode is live. Atlas and Nova will trade spy-table moves for you.'
      : 'Demo mode is live. Atlas and Nova will trade emerald-table moves for you.');
    pushChat('Demo mode started. Sit back and watch a few sample moves.', true);
    queueDemoTurn(700);
  }

  function startLesson(mode, idx) {
    baseState();
    window.laGameMode = mode;
    window.laLessonActive = true;
    window.laCurrentLessonMode = mode;
    window.laCurrentLessonIdx = idx || 0;
    ensureShell(mode);
    LoungeLessons.startLesson(mode, window.laCurrentLessonIdx);
    renderArcade();
    setInsight('Lesson mode is active. Read the glass card, tap it away, then explore the highlighted ideas at your own pace.');
    pushChat('Lesson started: ' + (LoungeLessons.getLessonInfo() ? LoungeLessons.getLessonInfo().lesson.title : ''), true);
    showLessonOverlay(mode, window.laCurrentLessonIdx);
  }

  function nextLessonHint() {
    var hint = LoungeLessons.nextHint();
    setInsight(hint);
    showLessonOverlay(window.laCurrentLessonMode, window.laCurrentLessonIdx);
  }

  function nextLesson() {
    var info = LoungeLessons.getLessonInfo();
    if (!info) return;
    var next = window.laCurrentLessonIdx < info.total - 1 ? window.laCurrentLessonIdx + 1 : 0;
    startLesson(window.laCurrentLessonMode, next);
  }

  function prevLesson() {
    if (window.laCurrentLessonIdx > 0) startLesson(window.laCurrentLessonMode, window.laCurrentLessonIdx - 1);
  }

  function leaveLuxeGame() {
    stopAutomation();
    var arena = document.getElementById('luxe-arena');
    if (arena) arena.style.display = 'none';
    baseState();
  }

  function sendLoungeChat() {
    var input = document.getElementById('la-chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    pushChat(text, false);
    input.value = '';
  }

  window.initGameBoard = initGameBoard;
  window.getValidMoves = getValidMoves;
  window.handleTileClick = handleTileClick;
  window.renderGameBoard = renderArcade;
  window.queueAITurn = queueAITurn;
  window.executeAITurn = executeAITurn;
  window.startLuxeGame = startLuxeGame;
  window.startAIGame = startAIGame;
  window.startDemoGame = startDemoGame;
  window.startLesson = startLesson;
  window.nextLessonHint = nextLessonHint;
  window.nextLesson = nextLesson;
  window.prevLesson = prevLesson;
  window.leaveLuxeGame = leaveLuxeGame;
  window.dismissLessonOverlay = dismissLessonOverlay;
  window.sendLoungeChat = sendLoungeChat;
})();
