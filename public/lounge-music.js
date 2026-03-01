// ═══════════════════════════════════════════════════════════════
// Lounge Music — Web Audio API Synthesized Casino Tracks
// Two tracks: "007 Royale" (spy jazz) & "Wizard of Oz" (mystical)
// No external dependencies, runs entirely in-browser
// ═══════════════════════════════════════════════════════════════

var LoungeMusic = (function() {
  var ctx = null;
  var masterGain = null;
  var isPlaying = false;
  var currentTrack = -1;
  var volume = 0.5;
  var nodes = [];
  var timers = [];
  var loopTimer = null;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function stopAll() {
    timers.forEach(function(t) { clearTimeout(t); clearInterval(t); });
    timers = [];
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    nodes.forEach(function(n) {
      try { n.stop(); } catch(e) {}
      try { n.disconnect(); } catch(e) {}
    });
    nodes = [];
    isPlaying = false;
  }

  // ── Note frequency helper ──
  var NOTE_FREQ = {};
  (function() {
    var names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    for (var oct = 1; oct <= 7; oct++) {
      for (var i = 0; i < 12; i++) {
        var n = (oct - 4) * 12 + (i - 9);
        NOTE_FREQ[names[i] + oct] = 440 * Math.pow(2, n / 12);
      }
    }
  })();

  function freq(note) { return NOTE_FREQ[note] || 440; }

  // ── Sound primitives ──
  function playTone(f, start, dur, type, vol, pan) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, ctx.currentTime + start);
    g.gain.linearRampToValueAtTime((vol || 0.15), ctx.currentTime + start + 0.02);
    g.gain.linearRampToValueAtTime((vol || 0.15) * 0.7, ctx.currentTime + start + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
    if (pan !== undefined) {
      var p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) { p.pan.value = pan; osc.connect(g); g.connect(p); p.connect(masterGain); }
      else { osc.connect(g); g.connect(masterGain); }
    } else {
      osc.connect(g); g.connect(masterGain);
    }
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.05);
    nodes.push(osc);
  }

  function playChord(notes, start, dur, type, vol) {
    notes.forEach(function(n) { playTone(freq(n), start, dur, type || 'triangle', (vol || 0.08)); });
  }

  function playNoise(start, dur, vol) {
    var bufSize = ctx.sampleRate * dur;
    var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    var filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 7000;
    g.gain.setValueAtTime(0, ctx.currentTime + start);
    g.gain.linearRampToValueAtTime(vol || 0.04, ctx.currentTime + start + 0.005);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
    src.connect(filt); filt.connect(g); g.connect(masterGain);
    src.start(ctx.currentTime + start);
    src.stop(ctx.currentTime + start + dur + 0.01);
    nodes.push(src);
  }

  // ═══ TRACK 1: 007 ROYALE — Spy Casino Jazz ═══
  // Smooth walking bass, muted jazzy chords, brushed hi-hat, spy melody
  function playRoyale() {
    var barDur = 2.4; // seconds per bar (100 BPM swing feel)
    var beat = barDur / 4;

    // Chord progression: Dm7 | G7 | Cmaj7 | A7
    var chords = [
      ['D3','F3','A3','C4'],   // Dm7
      ['G3','B3','D4','F4'],   // G7
      ['C3','E3','G3','B3'],   // Cmaj7
      ['A3','C#4','E4','G4'],  // A7
    ];

    // Walking bass pattern
    var bassLines = [
      ['D2','F2','A2','D3'],   // Dm7
      ['G2','B2','D3','F2'],   // G7
      ['C2','E2','G2','C3'],   // Cmaj7
      ['A2','C#3','E3','A2'],  // A7
    ];

    // Spy melody fragments
    var melodies = [
      [['D5',0.5],['E5',0.25],['F5',0.25],['A5',0.75],['G5',0.25],['F5',0.5],['E5',0.5]],
      [['G5',0.5],['A5',0.25],['B5',0.25],['D6',0.75],['C6',0.25],['B5',0.5],['A5',0.5]],
      [['C5',0.75],['E5',0.25],['G5',0.5],['B5',0.5],['A5',0.5],['G5',0.5]],
      [['A5',0.5],['G5',0.25],['F5',0.25],['E5',0.75],['D5',0.25],['C#5',0.5],['D5',0.5]],
    ];

    function playBar(barIdx, offset) {
      var ci = barIdx % 4;
      var chord = chords[ci];
      var bass = bassLines[ci];
      var melody = melodies[ci];

      // Jazzy chord stabs (muted, triangle wave)
      playChord(chord, offset + beat * 0.5, beat * 1.2, 'triangle', 0.05);
      playChord(chord, offset + beat * 2.5, beat * 0.8, 'triangle', 0.04);

      // Walking bass (sine, warm)
      for (var b = 0; b < 4; b++) {
        playTone(freq(bass[b]), offset + beat * b, beat * 0.85, 'sine', 0.18, 0);
      }

      // Brushed hi-hat (noise hits)
      for (var h = 0; h < 4; h++) {
        playNoise(offset + beat * h, 0.06, 0.03);
        if (h % 2 === 1) playNoise(offset + beat * h + beat * 0.5, 0.04, 0.02); // swing
      }

      // Spy melody (sawtooth, filtered)
      var mTime = 0;
      melody.forEach(function(m) {
        playTone(freq(m[0]), offset + mTime * beat, m[1] * beat * 0.9, 'sawtooth', 0.06, 0.3);
        mTime += m[1];
      });
    }

    // Play 8 bars then loop
    var totalBars = 8;
    for (var i = 0; i < totalBars; i++) {
      playBar(i, i * barDur);
    }

    loopTimer = setInterval(function() {
      if (!isPlaying) return;
      for (var i = 0; i < totalBars; i++) {
        playBar(i, i * barDur);
      }
    }, totalBars * barDur * 1000);
  }

  // ═══ TRACK 2: WIZARD OF OZ — Mystical Emerald Casino ═══
  // Ethereal pads, arpeggiated chords, bell-like melody, enchanted feel
  function playWizard() {
    var barDur = 3.0; // slower, dreamlike (80 BPM)
    var beat = barDur / 4;

    // Chord progression: Em | Cmaj | Am | B7
    var chords = [
      ['E3','G3','B3','D4'],   // Em7
      ['C3','E3','G3','B3'],   // Cmaj7
      ['A3','C4','E4','G4'],   // Am7
      ['B3','D#4','F#4','A4'], // B7
    ];

    // Arpeggio patterns (index into chord notes)
    var arpPattern = [0, 1, 2, 3, 2, 1, 0, 3];

    // Mystical melody
    var melodies = [
      [['E5',0.75],['G5',0.5],['B5',0.75],['A5',0.5],['G5',0.5]],
      [['C5',0.5],['E5',0.75],['G5',0.5],['B5',0.75],['G5',0.5]],
      [['A5',0.75],['C6',0.5],['E5',0.5],['G5',0.75],['A5',0.5]],
      [['B5',0.75],['D#5',0.5],['F#5',0.75],['B5',0.5],['A5',0.5]],
    ];

    function playBar(barIdx, offset) {
      var ci = barIdx % 4;
      var chord = chords[ci];
      var melody = melodies[ci];

      // Ethereal pad (sustained, quiet)
      playChord(chord, offset, barDur * 0.95, 'sine', 0.04);

      // Arpeggios (bell-like triangle tones)
      var arpBeat = barDur / arpPattern.length;
      arpPattern.forEach(function(ni, ai) {
        var note = chord[ni];
        // Shift up one octave for sparkle
        var octNote = note.replace(/\d/, function(d) { return parseInt(d) + 1; });
        playTone(freq(octNote), offset + ai * arpBeat, arpBeat * 0.7, 'triangle', 0.07, (ai % 2 === 0) ? -0.3 : 0.3);
      });

      // Deep bass
      var bassNote = chord[0].replace(/\d/, function(d) { return Math.max(1, parseInt(d) - 1); });
      playTone(freq(bassNote), offset, barDur * 0.9, 'sine', 0.14, 0);

      // Soft percussion (muffled hits on 2 and 4)
      playNoise(offset + beat, 0.08, 0.025);
      playNoise(offset + beat * 3, 0.08, 0.025);

      // Melody (sine, pure bell-like)
      var mTime = 0;
      melody.forEach(function(m) {
        playTone(freq(m[0]), offset + mTime * beat, m[1] * beat * 0.85, 'sine', 0.09, 0.2);
        mTime += m[1];
      });

      // Shimmer effect (high frequency sparkles)
      if (barIdx % 2 === 0) {
        playTone(freq('E6'), offset + beat * 1.5, 0.15, 'sine', 0.03, 0.5);
        playTone(freq('B6'), offset + beat * 3.5, 0.1, 'sine', 0.02, -0.5);
      }
    }

    var totalBars = 8;
    for (var i = 0; i < totalBars; i++) {
      playBar(i, i * barDur);
    }

    loopTimer = setInterval(function() {
      if (!isPlaying) return;
      for (var i = 0; i < totalBars; i++) {
        playBar(i, i * barDur);
      }
    }, totalBars * barDur * 1000);
  }

  // ═══ Public API ═══
  return {
    selectTrack: function(idx) {
      ensureCtx();
      stopAll();
      currentTrack = idx;
      isPlaying = true;
      if (idx === 0) playRoyale();
      else if (idx === 1) playWizard();
      this.updateUI();
    },

    playPause: function() {
      if (currentTrack < 0) { this.selectTrack(0); return; }
      ensureCtx();
      if (isPlaying) {
        stopAll();
      } else {
        isPlaying = true;
        if (currentTrack === 0) playRoyale();
        else playWizard();
      }
      this.updateUI();
    },

    stop: function() {
      stopAll();
      currentTrack = -1;
      this.updateUI();
      var nowEl = document.getElementById('la-music-now');
      if (nowEl) nowEl.textContent = 'Stopped';
    },

    setVolume: function(v) {
      volume = v / 100;
      if (masterGain) masterGain.gain.value = volume;
      var icon = document.getElementById('la-vol-icon');
      if (!icon) return;
      if (v == 0) icon.innerHTML = '&#128263;';
      else if (v < 40) icon.innerHTML = '&#128265;';
      else icon.innerHTML = '&#128266;';
    },

    toggleMute: function() {
      if (!masterGain) return;
      if (masterGain.gain.value > 0) {
        masterGain.gain.value = 0;
        document.getElementById('la-volume').value = 0;
        var icon = document.getElementById('la-vol-icon');
        if (icon) icon.innerHTML = '&#128263;';
      } else {
        masterGain.gain.value = volume || 0.5;
        document.getElementById('la-volume').value = (volume || 0.5) * 100;
        this.setVolume((volume || 0.5) * 100);
      }
    },

    updateUI: function() {
      var btn = document.getElementById('la-btn-play');
      if (btn) {
        btn.innerHTML = isPlaying ? '&#10074;&#10074;' : '&#9654;';
        btn.classList.toggle('playing', isPlaying);
      }
      for (var i = 0; i < 2; i++) {
        var el = document.getElementById('la-track-' + i);
        if (el) el.classList.toggle('active', i === currentTrack && isPlaying);
      }
      var nowEl = document.getElementById('la-music-now');
      if (nowEl && currentTrack >= 0) {
        nowEl.textContent = isPlaying ? ['Royale','Wizard of Oz'][currentTrack] : 'Paused';
      }
    },

    isPlaying: function() { return isPlaying; },
    getCurrentTrack: function() { return currentTrack; },
  };
})();
