/* Background sound, shared by every page: quiet lofi music plus a very light rain.
   - On by default. Browsers only allow sound after the visitor's first click, tap or key press,
     so if playback is blocked it starts on that first interaction.
   - One button (<button id="music">) mutes / unmutes both. The choice is remembered.
   - Keeps its place across pages (positions saved for this tab).
   Sounds (public domain, CC0 — free to use without attribution):
   - "Old Age" and "Opinions" by HoliznaCC0, "Chill Beats" collection: https://opengameart.org/content/chill-beats-collection
   - "Rain (loopable)" #3 by Ylmir, softened with a low-pass filter: https://opengameart.org/content/rain-loopable */
(() => {
  const MUSIC_VOL = .25, RAIN_VOL = .22;               // both kept quiet; the rain sits well under the music
  const XFADE = 2.5;                                   // seconds of crossfade between rain loops (no gap, no click)
  const base = new URL('.', document.currentScript.src);
  const url = f => new URL('music/' + f, base).href;
  const TRACKS = ['old-age.m4a', 'opinions.m4a'].map(url), RAIN = url('rain.m4a');

  const local = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
  const session = (k, v) => { try { return v === undefined ? sessionStorage.getItem(k) : sessionStorage.setItem(k, v); } catch { return null; } };
  const saved = () => { try { return JSON.parse(session('musicPos')) || {}; } catch { return {}; } };

  let on = local('music') !== 'off';
  const pos = saved();
  let i = (pos.i || 0) % TRACKS.length, r = pos.r ? 1 : 0;   // current track, active rain element

  const make = (src, t) => {
    const a = new Audio(); a.preload = on ? 'auto' : 'none'; a.src = src; a.volume = 0; a._start = t || 0;
    a.addEventListener('loadedmetadata', () => { if (a._start) { a.currentTime = Math.min(a._start, Math.max(0, a.duration - 1)); a._start = 0; } });
    return a;
  };
  const music = make(TRACKS[i], pos.t);
  const rain = [make(RAIN, r === 0 ? pos.rt : 0), make(RAIN, r === 1 ? pos.rt : 0)];
  music.addEventListener('ended', () => { i = (i + 1) % TRACKS.length; music.src = TRACKS[i]; if (on) music.play().catch(() => {}); });
  rain.forEach((a, k) => a.addEventListener('ended', () => {
    if (r !== k) return;
    r = 1 - k;                                         // the other loop takes over (normally already playing)
    if (on && rain[r].paused) { rain[r].currentTime = 0; rain[r].play().catch(() => {}); }
  }));

  const save = () => session('musicPos', JSON.stringify({
    i, t: music._start || music.currentTime || 0, r, rt: rain[r]._start || rain[r].currentTime || 0 }));
  setInterval(save, 1000);
  addEventListener('pagehide', () => { save(); [music, ...rain].forEach(a => a.pause()); });

  // iPhone ignores audio.volume, so there the levels go through Web Audio (created during a tap).
  const volumeWorks = (() => { const a = new Audio(); a.volume = .5; return a.volume === .5; })();
  let ctx;
  function webAudio() {
    ctx = new AudioContext();
    [music, ...rain].forEach(a => { a._gain = ctx.createGain(); ctx.createMediaElementSource(a).connect(a._gain).connect(ctx.destination); });
  }
  const setVol = (a, v) => { v = Math.max(0, Math.min(1, v)); if (a._gain) a._gain.gain.value = v; else a.volume = v; };

  // one small loop drives everything: the master fade and the rain crossfade
  let level = 0, target = 0, step = 0;                 // master level 0..1
  setInterval(() => {
    if (level !== target) level = step > 0 ? Math.min(target, level + step) : Math.max(target, level + step);
    setVol(music, MUSIC_VOL * level);
    const a = rain[r], b = rain[1 - r];
    if (on && !a.paused && a.duration && a.duration - a.currentTime < XFADE && b.paused) {
      b.currentTime = 0; b.play().catch(() => {});     // start the next loop underneath the ending one
    }
    rain.forEach(x => {
      const left = x.duration ? x.duration - x.currentTime : XFADE;
      const k = Math.min(1, x.currentTime / XFADE, left / XFADE);   // fade in at the start, out at the end
      setVol(x, RAIN_VOL * level * (x.paused ? 0 : Math.sin(Math.max(0, k) * Math.PI / 2)));
    });
    if (level === 0 && target === 0 && !on) [music, ...rain].forEach(x => { if (!x.paused) x.pause(); });
  }, 30);
  const fadeTo = (to, ms) => { target = to; step = (to - level) / Math.max(1, ms / 30); };

  async function play(fromGesture) {
    if (!volumeWorks && !ctx && fromGesture && window.AudioContext) webAudio();
    if (!volumeWorks && !ctx) return false;            // wait for a tap so the volume can be controlled
    try {
      if (ctx) await ctx.resume();
      await music.play();
    } catch { waiting(true); return false; }
    rain[r].play().catch(() => {});                    // the rain is a bonus: never let it block the music
    waiting(false);
    const first = !session('musicStarted'); session('musicStarted', 1);
    fadeTo(1, first ? 2500 : 700);                     // long fade the first time, quick when changing page
    return true;
  }

  // blocked by the browser? start on the first interaction (ignoring the mute button itself)
  const EVENTS = ['pointerdown', 'keydown', 'touchend'];
  const kick = e => {
    if (e.target.closest && e.target.closest('#music')) return;
    if (!on || !music.paused) return unlisten();
    play(true).then(ok => { if (ok) unlisten(); });
  };
  const listen = () => EVENTS.forEach(t => addEventListener(t, kick, true));
  const unlisten = () => EVENTS.forEach(t => removeEventListener(t, kick, true));

  // The mute button. With in-place page changes (router.js) each page brings a new button, so re-attach on "page:enter".
  let btn = null, isWaiting = false;
  function paint() {
    if (!btn) return;
    btn.setAttribute('aria-pressed', on);
    btn.title = on ? 'Mute music and rain' : 'Play music and rain';
    btn.classList.toggle('waiting', isWaiting && on);    // on, but the browser still waits for a first click
    btn.dataset.hint = matchMedia('(pointer:coarse)').matches ? 'Tap for sound' : 'Click for sound';
  }
  function waiting(w) { isWaiting = w; paint(); }
  async function toggle() {
    if (on && music.paused) { if (await play(true)) unlisten(); return; }   // blocked until now: this click starts it
    on = !on; local('music', on ? 'on' : 'off'); paint();
    if (on) { [music, ...rain].forEach(a => a.preload = 'auto'); if (!(await play(true))) listen(); }
    else { unlisten(); waiting(false); fadeTo(0, 500); }
  }
  function bind() {
    btn = document.getElementById('music');
    if (btn && !btn._bound) { btn._bound = true; btn.addEventListener('click', toggle); }
    paint();
  }
  document.addEventListener('page:enter', bind);
  bind();

  const resume = () => { if (on) play(false).then(ok => { if (!ok) listen(); }); };
  // coming back with the Back button: pick up wherever another page left off
  addEventListener('pageshow', e => {
    if (!e.persisted) return;
    const s = saved(); level = 0;
    const ti = (s.i || 0) % TRACKS.length;
    if (ti !== i) { i = ti; music._start = s.t || 0; music.src = TRACKS[i]; } else if (s.t) music.currentTime = s.t;
    rain.forEach(a => a.pause()); r = s.r ? 1 : 0; if (s.rt) rain[r].currentTime = s.rt;
    resume();
  });
  resume();
})();
