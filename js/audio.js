/* ============================================================
 * RED ALERT · WEB REMAKE —— 程序合成音效 + 可选 BGM
 * 全部声音由 WebAudio 实时合成（零素材、零版权风险）。
 * ============================================================ */
'use strict';

const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true, bgmOn = false, bgmTimer = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // 预生成噪声
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function gain(v, t) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t ?? ctx.currentTime);
    return g;
  }

  function env(g, t, a, peak, dec, end) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(end || 0.0001, 0.0001), t + a + dec);
  }

  function osc(type, f0, f1, dur, peak, dest) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = gain(0, t);
    env(g, t, 0.005, peak, dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, peak, fType, f0, f1, q) {
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = fType || 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q || 1;
    const g = gain(0, t);
    env(g, t, 0.004, peak, dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /* 距离衰减 + 声道pan */
  function pan(x) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, x)); p.connect(master); }
    return p || master;
  }

  const api = {
    resume, get enabled(){return enabled;}, set enabled(v){enabled=v; if(!v) stopBgm();},
    get ctx(){return ensure();},

    click()   { if(!enabled) return; resume(); if(!ctx) return; osc('square', 880, 520, 0.05, 0.10); },
    select()  { if(!enabled) return; resume(); if(!ctx) return; osc('triangle', 660, 990, 0.07, 0.10); },
    deny()    { if(!enabled) return; resume(); if(!ctx) return; osc('sawtooth', 220, 110, 0.22, 0.14); },
    place()   { if(!enabled) return; resume(); if(!ctx) return;
                osc('square', 180, 90, 0.16, 0.20); noise(0.18, 0.16, 'lowpass', 900, 300); },
    ready()   { if(!enabled) return; resume(); if(!ctx) return;
                osc('triangle', 784, 784, 0.12, 0.16); setTimeout(()=>{ osc('triangle', 1175, 1175, 0.18, 0.16); }, 120); },
    gun()     { if(!enabled) return; resume(); if(!ctx) return;
                noise(0.07, 0.14, 'bandpass', 1400, 700, 1.2); osc('square', 320, 120, 0.05, 0.07); },
    rocket()  { if(!enabled) return; resume(); if(!ctx) return;
                noise(0.5, 0.16, 'bandpass', 500, 1800, 0.8); },
    laser()   { if(!enabled) return; resume(); if(!ctx) return;
                osc('sawtooth', 1800, 420, 0.16, 0.10); },
    tesla()   { if(!enabled) return; resume(); if(!ctx) return;
                noise(0.28, 0.22, 'highpass', 2200, 4000, 0.7);
                osc('sawtooth', 140, 60, 0.26, 0.14); },
    explode(sz){ if(!enabled) return; resume(); if(!ctx) return;
                const k = sz || 1;
                noise(0.55*k, 0.30*Math.min(k,1.6), 'lowpass', 1600, 60);
                osc('sine', 90*k, 30, 0.5*k, 0.30); },
    nuke()    { if(!enabled) return; resume(); if(!ctx) return;
                noise(1.8, 0.4, 'lowpass', 2000, 40);
                osc('sine', 60, 24, 1.8, 0.42);
                osc('sawtooth', 120, 40, 1.4, 0.18); },
    buildOk() { if(!enabled) return; resume(); if(!ctx) return;
                osc('square', 440, 440, 0.09, 0.12);
                setTimeout(()=>osc('square', 660, 660, 0.09, 0.12), 90);
                setTimeout(()=>osc('square', 880, 880, 0.16, 0.12), 180); },
    cash()    { if(!enabled) return; resume(); if(!ctx) return;
                osc('triangle', 1319, 1319, 0.06, 0.10);
                setTimeout(()=>osc('triangle', 1760, 1760, 0.1, 0.10), 70); },
    alarm()   { if(!enabled) return; resume(); if(!ctx) return;
                osc('square', 620, 780, 0.28, 0.12); setTimeout(()=>osc('square', 620, 780, 0.28, 0.12), 340); },
    sat()     { if(!enabled) return; resume(); if(!ctx) return;
                osc('sine', 400, 2400, 1.2, 0.14); noise(1.2, 0.08, 'highpass', 3000, 6000); },
    cap()     { if(!enabled) return; resume(); if(!ctx) return;
                osc('square', 300, 900, 0.3, 0.14); },
    win()     { if(!enabled) return; resume(); if(!ctx) return;
                [523,659,784,1047].forEach((f,i)=>setTimeout(()=>osc('triangle', f, f, 0.3, 0.16), i*160)); },
    lose()    { if(!enabled) return; resume(); if(!ctx) return;
                [392,330,262,196].forEach((f,i)=>setTimeout(()=>osc('sawtooth', f, f*0.97, 0.4, 0.14), i*220)); },
    unitAck() { if(!enabled) return; resume(); if(!ctx) return; osc('square', 1040, 1320, 0.05, 0.07); },
    moveAck() { if(!enabled) return; resume(); if(!ctx) return; osc('triangle', 700, 1000, 0.06, 0.07); },
  };

  /* ---------------- 可选 BGM：极简工业节奏（程序生成） ---------------- */
  const BASS = [55, 55, 73.42, 65.41];      // A1 A1 D2 C2
  const LEAD = [440, 523.25, 587.33, 493.88];
  let step = 0, nextT = 0;

  function scheduleBeat(t) {
    const s = step % 16;
    // kick
    if (s % 4 === 0) {
      const o = ctx.createOscillator(), g = gain(0, t);
      o.type='sine'; o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(40,t+0.14);
      g.gain.setValueAtTime(0.30,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.16);
      o.connect(g); g.connect(master); o.start(t); o.stop(t+0.2);
    }
    // hat
    if (s % 2 === 1) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=7000;
      const g = gain(0, t);
      g.gain.setValueAtTime(0.06,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.05);
      src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t+0.08);
    }
    // bass every 4
    if (s % 4 === 0) {
      const f = BASS[(Math.floor(step/4)) % BASS.length];
      const o = ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f;
      const fl = ctx.createBiquadFilter(); fl.type='lowpass'; fl.frequency.value=420;
      const g = gain(0, t);
      g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.16,t+0.02);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.4);
      o.connect(fl); fl.connect(g); g.connect(master); o.start(t); o.stop(t+0.45);
    }
    // sparse lead
    if (s === 6 || s === 14) {
      const f = LEAD[Math.floor(step/16) % LEAD.length];
      const o = ctx.createOscillator(); o.type='triangle'; o.frequency.value=f;
      const g = gain(0, t);
      g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.07,t+0.03);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
      o.connect(g); g.connect(master); o.start(t); o.stop(t+0.55);
    }
    step++;
  }

  function bgmTick() {
    if (!bgmOn || !ctx) return;
    const rate = 60 / 132 / 2;              // 132bpm 八分音符
    while (nextT < ctx.currentTime + 0.25) {
      if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;
      scheduleBeat(nextT);
      nextT += rate;
    }
  }

  function startBgm() {
    resume(); if (!ctx || !enabled) return;
    if (bgmOn) return;
    bgmOn = true; nextT = ctx.currentTime + 0.1; step = 0;
    bgmTimer = setInterval(bgmTick, 90);
  }
  function stopBgm() {
    bgmOn = false;
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }
  api.startBgm = startBgm;
  api.stopBgm = stopBgm;
  Object.defineProperty(api, 'bgmOn', { get: () => bgmOn });

  return api;
})();
