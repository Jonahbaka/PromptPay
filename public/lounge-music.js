// ═══════════════════════════════════════════════════════════════
// Lounge Music — HTML5 Audio Player for Casino Tracks
// Track 0: "Casino Royale Romp" (spy jazz)
// Track 1: "Emerald City Jackpot" (mystical casino)
// ═══════════════════════════════════════════════════════════════

var LoungeMusic = (function() {
  var tracks = [
    { src: '/videos/Casino_Royale_Romp', name: 'Royale' },
    { src: '/videos/Emerald_City_Jackpot', name: 'Wizard of Oz' },
  ];

  var audio = null;
  var isPlaying = false;
  var currentTrack = -1;
  var volume = 0.5;
  var muted = false;
  var savedVolume = 0.5;

  function createAudio(idx) {
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audio = new Audio();
    // Try mp3 first (smaller), fall back to mp4
    var src = tracks[idx].src;
    audio.src = src + '.mp3';
    audio.volume = volume;
    audio.loop = true;
    audio.preload = 'auto';
    // If mp3 fails, try mp4
    audio.onerror = function() {
      if (audio.src.indexOf('.mp3') !== -1) {
        audio.src = src + '.mp4';
      }
    };
  }

  // ═══ Public API (same interface as before) ═══
  return {
    selectTrack: function(idx) {
      if (idx < 0 || idx >= tracks.length) return;
      currentTrack = idx;
      createAudio(idx);
      audio.play().then(function() {
        isPlaying = true;
        LoungeMusic.updateUI();
      }).catch(function(e) {
        // Autoplay blocked — user needs to click play
        isPlaying = false;
        LoungeMusic.updateUI();
      });
      isPlaying = true;
      this.updateUI();
    },

    playPause: function() {
      if (currentTrack < 0) { this.selectTrack(0); return; }
      if (!audio) { createAudio(currentTrack); }
      if (isPlaying) {
        audio.pause();
        isPlaying = false;
      } else {
        audio.play().catch(function() {});
        isPlaying = true;
      }
      this.updateUI();
    },

    stop: function() {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      isPlaying = false;
      currentTrack = -1;
      this.updateUI();
      var nowEl = document.getElementById('la-music-now');
      if (nowEl) nowEl.textContent = 'Stopped';
    },

    setVolume: function(v) {
      volume = v / 100;
      savedVolume = volume;
      muted = (v == 0);
      if (audio) audio.volume = volume;
      var icon = document.getElementById('la-vol-icon');
      if (!icon) return;
      if (v == 0) icon.innerHTML = '&#128263;';
      else if (v < 40) icon.innerHTML = '&#128265;';
      else icon.innerHTML = '&#128266;';
    },

    toggleMute: function() {
      if (!audio) return;
      if (!muted) {
        savedVolume = volume;
        volume = 0;
        audio.volume = 0;
        muted = true;
        document.getElementById('la-volume').value = 0;
        var icon = document.getElementById('la-vol-icon');
        if (icon) icon.innerHTML = '&#128263;';
      } else {
        volume = savedVolume || 0.5;
        audio.volume = volume;
        muted = false;
        document.getElementById('la-volume').value = volume * 100;
        this.setVolume(volume * 100);
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
        nowEl.textContent = isPlaying ? tracks[currentTrack].name : 'Paused';
      }
    },

    isPlaying: function() { return isPlaying; },
    getCurrentTrack: function() { return currentTrack; },
  };
})();
