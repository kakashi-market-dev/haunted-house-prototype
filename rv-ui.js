/* rv-ui.js v0.7  -  Cinematic horror interface layer for the house game.
 * Menus, animated main menu (fog, embers, flicker, house silhouette, generated ambience), chapters, journal, pause, settings,
 * loading, game over, ending, credits, HUD polish. Arabic / RTL, portrait and landscape.
 *
 * INTEGRATION (one include, no house code is changed):   <script src="rv-ui.js"></script>   after the game script, before </body>
 * It REPLACES the old start screen (#overlay is hidden; the new title and menu start the game by clicking #startbtn) and the old
 * win/lose card (#end is hidden; the layer shows its own Game Over / Ending screens from the same #e-title text).
 * Touch points with the house (all already existing): #startbtn #overlay #end #e-title #e-body #inv #hintkeys, window.G (S, P, K, D),
 * the browser's requestAnimationFrame / AudioContext (wrapped for pause + volume), and the ?q=low URL option.
 * Public API: window.HouseUI = { start, pause, resume, toggle, showMenu, openSettings, openCredits, openJournal, setCharacter, settings }
 * Everything is prefixed "rv-" so it cannot collide with house CSS/JS.
 */
(function () {
  'use strict';
  var VERSION = '0.7';
  var LS = 'rv_ui_settings';
  var S0 = { vol: 0.9, music: 0.7, sens: 1, bright: 1, quality: 'auto', hints: true, fx: true, vib: true };
  var set = {}; try { set = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) {}
  Object.keys(S0).forEach(function (k) { if (set[k] === undefined) set[k] = S0[k]; });
  var qs = new URLSearchParams(location.search);
  if (qs.get('q') === 'low') set.quality = 'low';
  function save() { try { localStorage.setItem(LS, JSON.stringify(set)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function G() { return window.G || null; }

  // ---------- non-invasive hooks: pause (requestAnimationFrame), game audio volume (AudioContext), sensitivity ----------
  var paused = false, held = [], rawRAF = window.requestAnimationFrame.bind(window), ctxs = [], vgains = [];
  window.requestAnimationFrame = function (cb) {
    if (paused) { held.push(cb); return 0; }
    return rawRAF(function (t) {
      if (paused) { held.push(cb); return; }
      var g = G(), y0, p0;
      if (g && g.P && g.S && g.S.started) { y0 = g.P.yaw; p0 = g.P.pitch; }
      cb(t);
      if (y0 !== undefined && set.sens !== 1) {
        var dy = g.P.yaw - y0, dp = g.P.pitch - p0;
        if (Math.abs(dy) < 0.6 && Math.abs(dp) < 0.6) { g.P.yaw += dy * (set.sens - 1); g.P.pitch = Math.max(-1.2, Math.min(1.2, g.P.pitch + dp * (set.sens - 1))); }
      }
    });
  };
  var RawAC = window.AudioContext || window.webkitAudioContext;
  ['AudioContext', 'webkitAudioContext'].forEach(function (nm) {
    var Orig = window[nm]; if (!Orig) return;
    window[nm] = function () {
      var c = new Orig(); try { var vg = c.createGain(); vg.gain.value = set.vol; vg.connect(c.destination); Object.defineProperty(c, 'destination', { get: function () { return vg; } }); vgains.push(vg); } catch (e) {}
      ctxs.push(c); return c;
    };
    window[nm].prototype = Orig.prototype;
  });

  // ---------- generated menu ambience (own AudioContext, separate from the game's) ----------
  var amb = { ctx: null, master: null, nodes: [], timer: null, on: false, level: 1 };
  function ambInit() {
    if (amb.ctx) return true;
    try {
      amb.ctx = new RawAC();
      amb.master = amb.ctx.createGain(); amb.master.gain.value = 0; amb.master.connect(amb.ctx.destination);
      return true;
    } catch (e) { return false; }
  }
  function noiseBuf(c) { var n = c.sampleRate * 2, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0), last = 0; for (var i = 0; i < n; i++) { var w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 6; } return b; }
  function ambStart(level) {
    amb.level = level === undefined ? 1 : level;
    if (!ambInit()) return; var c = amb.ctx; try { c.resume(); } catch (e) {}
    if (!amb.on) {
      amb.on = true; var m = amb.master;
      [48, 48.6, 72.4].forEach(function (f, i) { var o = c.createOscillator(), g = c.createGain(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f; g.gain.value = i === 2 ? 0.05 : 0.16; o.connect(g); g.connect(m); o.start(); amb.nodes.push(o); });
      var src = c.createBufferSource(); src.buffer = noiseBuf(c); src.loop = true; var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.8; var g2 = c.createGain(); g2.gain.value = 0.5;
      var l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.1; lg.gain.value = 0.3; l.connect(lg); lg.connect(g2.gain); l.start(); amb.nodes.push(l);
      src.connect(f); f.connect(g2); g2.connect(m); src.start(); amb.nodes.push(src);
      // music box with feedback echo
      var dl = c.createDelay(1.5); dl.delayTime.value = 0.46; var fb = c.createGain(); fb.gain.value = 0.42; dl.connect(fb); fb.connect(dl); var eo = c.createGain(); eo.gain.value = 0.5; dl.connect(eo); eo.connect(m);
      amb.box = c.createGain(); amb.box.gain.value = 0.5; amb.box.connect(m); amb.box.connect(dl);
      var MEL = [0, 3, 7, 12, 7, 3, 0, 3, 7, 10, 7, 3, -2, 3, 5, 10, 5, 3, 0, 5, 8, 12, 8, 5, 3, 0, 3, -2, 0], mi = 0, tick = 0;
      amb.timer = setInterval(function () {
        if (!amb.on) return; tick++;
        if (tick % 2 === 0 || Math.random() < 0.15) {
          var semi = MEL[mi++ % MEL.length], o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = 'triangle'; o.frequency.value = 330 * Math.pow(2, semi / 12) * (1 + (Math.random() - 0.5) * 0.006);
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8); o.connect(g); g.connect(amb.box); o.start(t); o.stop(t + 1.9);
        }
        if (tick % 29 === 0) { // distant rumble
          var s2 = c.createBufferSource(); s2.buffer = noiseBuf(c); var f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 160; var g3 = c.createGain(), t2 = c.currentTime; g3.gain.setValueAtTime(0.0001, t2); g3.gain.linearRampToValueAtTime(0.6, t2 + 1.2); g3.gain.exponentialRampToValueAtTime(0.0001, t2 + 4); s2.connect(f2); f2.connect(g3); g3.connect(m); s2.start(t2); s2.stop(t2 + 4.2);
        }
      }, 900);
    }
    ambLevel();
  }
  function ambLevel() { if (!amb.ctx) return; var v = (amb.on ? set.music : 0) * set.vol * (amb.level || 1) * 0.5; amb.master.gain.setTargetAtTime(v, amb.ctx.currentTime, 0.4); }
  function ambStop(fast) {
    if (!amb.ctx || !amb.on) return; amb.master.gain.setTargetAtTime(0, amb.ctx.currentTime, fast ? 0.15 : 0.7);
    var c = amb.ctx, nodes = amb.nodes, t = amb.timer; amb.on = false; amb.nodes = []; amb.timer = null; clearInterval(t);
    setTimeout(function () { nodes.forEach(function (n) { try { n.stop(); } catch (e) {} }); }, fast ? 500 : 3200);
  }
  function stinger(kind) { // short one-off sounds on the menu context
    if (!ambInit()) return; var c = amb.ctx; try { c.resume(); } catch (e) {} var t = c.currentTime;
    var o = c.createOscillator(), g = c.createGain();
    if (kind === 'click') { o.type = 'sine'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.12); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18 * set.vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); }
    else if (kind === 'die') { o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(30, t + 2); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28 * set.vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2); }
    else { o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(440, t + 1.2); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16 * set.vol, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2); }
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 2.3);
  }
  function applyVol() { vgains.forEach(function (g) { g.gain.value = set.vol; }); ambLevel(); }

  // ---------- styles ----------
  var NOISE = (function () { var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d'), d = g.createImageData(128, 128); for (var i = 0; i < d.data.length; i += 4) { var v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 34; } g.putImageData(d, 0, 0); return c.toDataURL(); })();
  var css = '' +
  '#overlay,#end{display:none!important}' +
  ':root{--rv-gold:#d9c08a;--rv-blood:#9a1c1c;--rv-bone:#efe6d2}' +
  '#rv-root,#rv-root *{box-sizing:border-box;font-family:"Segoe UI",Tahoma,Arial,sans-serif}' +
  '#rv-root{position:fixed;inset:0;z-index:60;pointer-events:none;color:var(--rv-bone);direction:rtl}' +
  '.rv-scr{position:absolute;inset:0;display:none;pointer-events:auto;overflow:hidden;opacity:0;transition:opacity .6s}' +
  '.rv-scr.on{display:block}.rv-scr.vis{opacity:1}' +
  '.rv-bgd{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,#2b1a16 0,#0e0807 52%,#020101 100%)}' +
  '#rv-fx{position:absolute;inset:0;width:100%;height:100%}' +
  '.rv-grain{position:absolute;inset:-50%;width:200%;height:200%;background:url(' + NOISE + ');opacity:.55;animation:rvgr .5s steps(5) infinite;pointer-events:none;mix-blend-mode:overlay}' +
  '@keyframes rvgr{0%{transform:translate(0,0)}20%{transform:translate(-5%,3%)}40%{transform:translate(4%,-6%)}60%{transform:translate(-3%,5%)}80%{transform:translate(6%,2%)}100%{transform:translate(0,0)}}' +
  '.rv-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 30%,rgba(0,0,0,.85) 100%)}' +
  '.rv-scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 1px,transparent 1px 3px);opacity:.5}' +
  '#rv-flash{position:absolute;inset:0;background:#cfd8ff;opacity:0;pointer-events:none;mix-blend-mode:screen}' +
  '.rv-house{position:absolute;left:0;right:0;bottom:30%;height:34%;opacity:.8;pointer-events:none}.rv-house svg{width:100%;height:100%}' +
  '.rv-win{animation:rvwin 3.7s infinite}.rv-win2{animation:rvwin 5.3s infinite .8s}@keyframes rvwin{0%,100%{opacity:.95}7%{opacity:.35}9%{opacity:1}52%{opacity:.8}54%{opacity:.15}57%{opacity:1}}' +
  '.rv-tcol{position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;align-items:center;text-align:center;padding:calc(7vh + env(safe-area-inset-top)) 16px 0}' +
  '.rv-chap{font-size:13px;letter-spacing:6px;color:var(--rv-gold);opacity:.8;margin-bottom:8px}' +
  '.rv-title{position:relative;font-size:clamp(46px,13vw,104px);line-height:1.05;margin:0;font-weight:900;color:var(--rv-bone);letter-spacing:2px;text-shadow:0 0 30px rgba(154,28,28,.75),0 0 3px rgba(0,0,0,.9),0 5px 0 #3a0808;animation:rvglitch 6s infinite}' +
  '.rv-title:before,.rv-title:after{content:attr(data-t);position:absolute;left:0;right:0;top:0;opacity:0}' +
  '.rv-title:before{color:#ff2a2a;animation:rvg1 6s infinite}.rv-title:after{color:#3fe0ff;animation:rvg2 6s infinite}' +
  '@keyframes rvglitch{0%,93%,100%{transform:none}94%{transform:translateX(-3px) skewX(-4deg)}96%{transform:translateX(4px)}98%{transform:translateX(-2px)}}' +
  '@keyframes rvg1{0%,93%,100%{opacity:0}94%{opacity:.8;transform:translate(-5px,1px)}97%{opacity:.7;transform:translate(3px,-1px)}}' +
  '@keyframes rvg2{0%,93%,100%{opacity:0}95%{opacity:.8;transform:translate(5px,-1px)}98%{opacity:.6;transform:translate(-3px,1px)}}' +
  '.rv-drips{position:absolute;left:0;right:0;top:100%;height:90px;pointer-events:none;overflow:visible}' +
  '.rv-drips i{position:absolute;top:-6px;width:5px;border-radius:0 0 4px 4px;background:linear-gradient(#6a0a0a,#b01818);transform-origin:top;animation:rvdr 7s infinite}' +
  '@keyframes rvdr{0%{height:0;opacity:0}10%{opacity:1}55%{height:var(--h)}85%{height:var(--h);opacity:1}100%{height:var(--h);opacity:0}}' +
  '.rv-tag{margin-top:14px;font-size:14px;opacity:.65;letter-spacing:1px}' +
  '.rv-menu{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;padding:0 20px calc(5vh + env(safe-area-inset-bottom))}' +
  '.rv-mi{pointer-events:auto;cursor:pointer;position:relative;display:block;width:min(340px,86vw);text-align:center;padding:13px 10px;margin:3px 0;font-size:21px;letter-spacing:2px;color:#cfc4ac;background:transparent;border:0;border-top:1px solid rgba(217,192,138,.0);border-bottom:1px solid rgba(217,192,138,.14);font-family:inherit;font-weight:600;text-shadow:0 2px 8px #000;transition:all .25s;touch-action:manipulation}' +
  '.rv-mi:before,.rv-mi:after{content:"";position:absolute;top:50%;width:0;height:2px;background:var(--rv-blood);transition:width .25s}.rv-mi:before{right:0}.rv-mi:after{left:0}' +
  '.rv-mi:hover,.rv-mi:active,.rv-mi.f{color:#fff;letter-spacing:4px;background:linear-gradient(90deg,transparent,rgba(120,18,18,.35),transparent)}.rv-mi:hover:before,.rv-mi:hover:after,.rv-mi:active:before,.rv-mi:active:after{width:22px}' +
  '.rv-mi.pri{font-size:25px;color:var(--rv-bone);border-bottom-color:rgba(154,28,28,.7)}' +
  '.rv-mi.dis{opacity:.35;pointer-events:none}' +
  '.rv-ver{position:absolute;left:12px;bottom:calc(8px + env(safe-area-inset-bottom));font-size:11px;opacity:.4;direction:ltr}' +
  '.rv-tap{position:absolute;left:0;right:0;bottom:calc(14vh + env(safe-area-inset-bottom));text-align:center;font-size:17px;letter-spacing:4px;color:var(--rv-gold);animation:rvbl 2.2s infinite;text-shadow:0 0 12px #000}' +
  '@keyframes rvbl{0%,100%{opacity:.25}50%{opacity:.95}}' +
  /* panels */
  '.rv-panel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:calc(14px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom))}' +
  '.rv-dim .rv-bgd{background:rgba(3,1,1,.82);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
  '.rv-card{position:relative;background:linear-gradient(rgba(24,16,13,.94),rgba(12,8,6,.96));border:1px solid rgba(217,192,138,.35);border-radius:6px;padding:20px 22px;width:min(480px,100%);max-height:100%;overflow:auto;box-shadow:0 0 0 1px #000,0 14px 50px rgba(0,0,0,.9),inset 0 0 40px rgba(120,18,18,.12)}' +
  '.rv-card:before{content:"";position:absolute;inset:4px;border:1px solid rgba(217,192,138,.12);pointer-events:none}' +
  '.rv-card h2{margin:0 0 14px;font-size:26px;color:var(--rv-gold);text-align:center;letter-spacing:3px;font-weight:700;text-shadow:0 0 14px rgba(154,28,28,.5)}' +
  '.rv-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;font-size:15px}.rv-row label{flex:0 0 36%}' +
  '.rv-row input[type=range]{flex:1;accent-color:#b5392f;height:28px;direction:ltr}.rv-val{flex:0 0 42px;text-align:left;font-size:13px;opacity:.7;direction:ltr}' +
  '.rv-seg{display:flex;gap:6px;flex:1}.rv-seg button{flex:1;padding:9px 4px;border-radius:4px;border:1px solid rgba(217,192,138,.3);background:#140e0a;color:var(--rv-bone);font-family:inherit;font-size:14px}.rv-seg button.on{background:#7a1f1f;border-color:#c04040}' +
  '.rv-sw{width:52px;height:30px;border-radius:15px;background:#241a14;border:1px solid rgba(217,192,138,.3);position:relative;cursor:pointer;flex:0 0 auto}.rv-sw:after{content:"";position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;background:#8a8070;transition:all .15s}.rv-sw.on{background:#a02a2a}.rv-sw.on:after{right:25px;background:#f0e6cc}' +
  '.rv-note{font-size:12px;opacity:.55;text-align:center;margin-top:8px;line-height:1.6}' +
  '.rv-btn{cursor:pointer;display:block;width:100%;margin:8px 0 0;padding:12px 16px;font-size:17px;color:var(--rv-bone);border:1px solid rgba(217,192,138,.4);background:linear-gradient(#2e2018,#170f0b);border-radius:4px;font-family:inherit;touch-action:manipulation;letter-spacing:1px}' +
  '.rv-btn:active{transform:scale(.98)}.rv-btn.pri{border-color:#b03030;background:linear-gradient(#7a2222,#3a0e0e)}.rv-btn.sm{display:inline-block;width:auto;padding:8px 16px;font-size:14px;margin:0}' +
  /* chapters */
  '.rv-chs{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:6px 0}' +
  '.rv-ch{position:relative;pointer-events:auto;cursor:pointer;width:200px;height:230px;border:1px solid rgba(217,192,138,.4);border-radius:6px;overflow:hidden;background:linear-gradient(#1c120e,#050303);display:flex;flex-direction:column;justify-content:flex-end;padding:12px;text-align:center}' +
  '.rv-ch .art{position:absolute;inset:0;opacity:.85}.rv-ch b{position:relative;display:block;font-size:20px;color:var(--rv-gold)}.rv-ch span{position:relative;font-size:12px;opacity:.7}' +
  '.rv-ch.lock{filter:grayscale(1) brightness(.55);cursor:default}.rv-ch.lock:after{content:"\\1F512";position:absolute;top:38%;left:0;right:0;font-size:34px;text-align:center}' +
  '.rv-ch:not(.lock):active{transform:scale(.98)}' +
  /* journal */
  '.rv-jr{max-height:56vh;overflow:auto;font-size:14px;line-height:1.9}.rv-jr .e{padding:9px 12px;margin:7px 0;background:rgba(255,255,255,.04);border-right:3px solid var(--rv-blood);border-radius:3px}.rv-jr h4{margin:10px 0 4px;color:var(--rv-gold);font-size:14px}' +
  '.rv-slots{display:flex;flex-wrap:wrap;gap:8px}.rv-slot{padding:8px 12px;border:1px solid rgba(217,192,138,.4);background:rgba(0,0,0,.4);border-radius:4px;font-size:13px}' +
  '.rv-cred{max-height:58vh;overflow:auto;text-align:center;line-height:2;font-size:15px}.rv-cred h3{margin:16px 0 2px;color:var(--rv-gold);font-size:14px;font-weight:600;letter-spacing:2px}.rv-cred p{margin:0;opacity:.85}' +
  /* loading */
  '.rv-bar{width:min(320px,70vw);height:3px;background:rgba(255,255,255,.1);margin:20px auto 12px;overflow:hidden}.rv-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#6a0a0a,#d9c08a);transition:width .25s}' +
  '.rv-tip{font-size:13px;opacity:.7;min-height:42px;max-width:340px;line-height:1.8;text-align:center}' +
  '.rv-center{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;padding:0 16px}' +
  /* game over / ending */
  '#rv-over .rv-bgd{background:radial-gradient(ellipse at center,#3a0707 0,#0a0101 60%,#000 100%)}' +
  '#rv-over h1{font-size:clamp(38px,11vw,78px);margin:0;color:#c21f1f;font-weight:900;letter-spacing:3px;text-shadow:0 0 30px #7a0000,0 3px 0 #200000;animation:rvdie 4s infinite}' +
  '@keyframes rvdie{0%,90%,100%{transform:none;opacity:1}92%{transform:translateX(-4px);opacity:.6}94%{transform:translateX(5px);opacity:1}96%{transform:translateX(-2px)}}' +
  '.rv-ov-b{max-width:420px;text-align:center;font-size:15px;line-height:1.9;opacity:.8;margin:16px 0 8px}' +
  '#rv-end .rv-bgd{background:linear-gradient(#0e0d14 0,#3a2a24 70%,#b08a5a 100%)}' +
  '#rv-end h1{font-size:clamp(34px,10vw,70px);margin:0;color:#f2e2b8;font-weight:900;text-shadow:0 0 24px rgba(255,200,120,.5)}' +
  '.rv-stats{display:flex;gap:16px;margin:12px 0;font-size:14px}.rv-stats div{padding:8px 14px;border:1px solid rgba(217,192,138,.4);background:rgba(0,0,0,.35);text-align:center;border-radius:4px}.rv-stats b{display:block;font-size:20px;color:var(--rv-gold)}' +
  '#rv-danger{position:fixed;inset:0;z-index:7;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(120,0,0,0) 35%,rgba(160,0,0,.55) 100%);transition:opacity .4s}' +
  '#rv-grain2{position:fixed;inset:-50%;width:200%;height:200%;z-index:8;pointer-events:none;background:url(' + NOISE + ');opacity:.22;mix-blend-mode:overlay;animation:rvgr .5s steps(5) infinite;display:none}body.rv-fx #rv-grain2{display:block}' +
  /* HUD polish */
  '#rv-pausebtn,#rv-jbtn{position:fixed;z-index:61;top:calc(8px + env(safe-area-inset-top));width:42px;height:42px;border-radius:4px;border:1px solid rgba(217,192,138,.45);background:rgba(14,9,7,.7);color:var(--rv-bone);font-size:15px;display:none;align-items:center;justify-content:center;padding:0;touch-action:manipulation}' +
  '#rv-pausebtn{right:10px}#rv-jbtn{right:60px}body.rv-playing #rv-pausebtn,body.rv-playing #rv-jbtn{display:flex}body.rv-paused #rv-pausebtn,body.rv-paused #rv-jbtn{display:none}' +
  '#rv-chtag{position:fixed;z-index:9;left:12px;top:calc(10px + env(safe-area-inset-top));font-size:11px;letter-spacing:3px;color:var(--rv-gold);opacity:.6;display:none}body.rv-playing #rv-chtag{display:none}' +
  'body.rv-playing #obj{left:8px!important;right:112px!important;width:auto!important;max-width:none!important;transform:none!important;border-radius:3px;border:1px solid rgba(217,192,138,.28);background:linear-gradient(rgba(14,9,7,.78),rgba(8,5,4,.7))}' +
  'body.landscape.rv-playing #obj{right:auto!important;max-width:44%!important}' +
  '#inv{top:calc(58px + env(safe-area-inset-top))!important;gap:6px!important}' +
  '.chip{background:linear-gradient(rgba(36,24,18,.85),rgba(14,9,7,.85))!important;border:1px solid rgba(217,192,138,.5)!important;border-radius:4px!important;padding:5px 10px!important;color:var(--rv-bone)!important;box-shadow:0 0 10px rgba(0,0,0,.6),inset 0 0 8px rgba(217,192,138,.1)}' +
  '#stam{height:4px!important;width:150px!important;border:1px solid rgba(217,192,138,.25)}#stam i{background:linear-gradient(90deg,#7a1818,#d9c08a)!important}' +
  '.tb{width:50px!important;height:50px!important;border-radius:6px!important;background:rgba(14,9,7,.72)!important;border:1px solid rgba(217,192,138,.5)!important}' +
  '#act{border:1px solid rgba(217,192,138,.8)!important;box-shadow:0 0 26px rgba(160,30,30,.5)!important}' +
  '#lvl{border:1px solid rgba(217,192,138,.25);border-radius:3px!important}' +
  '#game canvas{filter:brightness(var(--rv-br,1))}' +
  'body.landscape .rv-title{font-size:clamp(34px,9vw,64px)}body.landscape .rv-tcol{padding-top:4vh}body.landscape .rv-mi{padding:7px 10px;font-size:17px}body.landscape .rv-mi.pri{font-size:19px}body.landscape .rv-menu{padding-bottom:2vh}' +
  'body.landscape .rv-ch{width:170px;height:170px}body.landscape .rv-card{padding:12px 16px}body.landscape .rv-row{margin:4px 0}body.landscape .rv-card h2{font-size:20px;margin-bottom:6px}body.landscape .rv-house{bottom:0;height:62%}' +
  'body.landscape .rv-tcol{align-items:center}' +
  '@media(max-height:340px){.rv-tag,.rv-chap{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------- DOM ----------
  var houseSVG = '<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice"><defs><linearGradient id="rvh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0807"/><stop offset="1" stop-color="#000"/></linearGradient><radialGradient id="rvm" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e9e2d0" stop-opacity=".9"/><stop offset="1" stop-color="#e9e2d0" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="300" cy="46" r="46" fill="url(#rvm)" opacity=".35"/><circle cx="300" cy="46" r="13" fill="#d8d2c0" opacity=".85"/>' +
    '<path d="M0 200V170Q90 150 200 168T400 160V200z" fill="#050303"/>' +
    '<g fill="url(#rvh)" stroke="#000"><path d="M140 170V112L200 70L260 112V170z"/><path d="M128 114L200 58L272 114L262 114L200 70L138 114z" fill="#0a0605"/><rect x="226" y="52" width="12" height="28"/><rect x="100" y="132" width="44" height="38"/><path d="M96 134L122 112L148 134z"/></g>' +
    '<g fill="#e8a24a"><rect class="rv-win" x="156" y="124" width="14" height="18"/><rect class="rv-win2" x="228" y="124" width="14" height="18"/><rect class="rv-win2" x="188" y="92" width="12" height="15" opacity=".8"/></g>' +
    '<g stroke="#050303" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M44 175V120M44 140L26 120M44 132L64 112M44 150L30 138M64 112L74 100M26 120L16 110"/><path d="M350 172V128M350 146L334 130M350 138L368 120M368 120L376 110"/></g>' +
    '<path d="M0 200V182Q100 168 200 180T400 176V200z" fill="#000"/></svg>';
  var root = document.createElement('div'); root.id = 'rv-root';
  var drips = ''; for (var di = 0; di < 7; di++) drips += '<i style="right:' + (6 + di * 14 + (di % 3) * 3) + '%;--h:' + (26 + (di * 17) % 52) + 'px;animation-delay:' + (di * 0.9) + 's"></i>';
  function bgBlock(extra) { return '<div class="rv-bgd"></div>' + (extra || '') + '<div class="rv-grain"></div><div class="rv-vig"></div><div class="rv-scan"></div>'; }
  root.innerHTML =
    '<div class="rv-scr" id="rv-load">' + bgBlock() + '<div class="rv-center"><div class="rv-chap">جارٍ التحميل</div><h1 class="rv-title" data-t="بيت التهويدة" style="font-size:clamp(36px,10vw,72px)">بيت التهويدة</h1><div class="rv-bar"><i id="rv-lb"></i></div><div class="rv-tip" id="rv-tip"></div></div></div>' +
    '<div class="rv-scr" id="rv-main"><div class="rv-bgd"></div><canvas id="rv-fx"></canvas><div class="rv-house">' + houseSVG + '</div><div class="rv-grain"></div><div class="rv-vig"></div><div class="rv-scan"></div><div id="rv-flash"></div>' +
      '<div class="rv-tcol"><div class="rv-chap">الفصل الأول · الليلة الأولى</div><h1 class="rv-title" data-t="بيت التهويدة">بيت التهويدة<div class="rv-drips">' + drips + '</div></h1><div class="rv-tag" id="rv-tag">لا تدعها تغني</div></div>' +
      '<div class="rv-tap" id="rv-tap">المس الشاشة للدخول</div>' +
      '<div class="rv-menu" id="rv-mlist" style="display:none"><button class="rv-mi pri" id="m-new">لعبة جديدة</button><button class="rv-mi" id="m-ch">الفصول</button><button class="rv-mi" id="m-set">الإعدادات</button><button class="rv-mi" id="m-cre">الاعتمادات</button></div>' +
      '<div class="rv-ver">v' + VERSION + '</div><div id="rv-riven" style="display:none"></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-chs">' + bgBlock() + '<div class="rv-panel"><div class="rv-card" style="width:min(520px,100%)"><h2>الفصول</h2><div class="rv-chs">' +
      '<div class="rv-ch" id="ch1"><div class="art" style="background:radial-gradient(circle at 50% 30%,#6a3a1a 0,#1a0e0a 50%,#000 100%)"></div><b>اليوم الأول</b><span>الليلة الأولى · متاح</span></div>' +
      '<div class="rv-ch lock" id="ch2"><div class="art" style="background:radial-gradient(circle at 50% 30%,#2a3a5a 0,#0a0e18 55%,#000 100%)"></div><b>اليوم الثاني</b><span>قريبا</span></div></div><button class="rv-btn" id="ch-back">رجوع</button></div></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-jr">' + bgBlock() + '<div class="rv-panel"><div class="rv-card"><h2>المذكرة</h2><div class="rv-jr" id="jr-body"></div><button class="rv-btn" id="jr-back">رجوع</button></div></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-pause">' + bgBlock() + '<div class="rv-panel"><div class="rv-card" style="width:min(340px,100%)"><h2>إيقاف مؤقت</h2><button class="rv-btn pri" id="p-res">استئناف</button><button class="rv-btn" id="p-jr">المذكرة والحقيبة</button><button class="rv-btn" id="p-set">الإعدادات</button><button class="rv-btn" id="p-rst">إعادة الفصل</button><button class="rv-btn" id="p-menu">القائمة الرئيسية</button><div class="rv-note" id="p-conf" style="display:none"></div></div></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-set">' + bgBlock() + '<div class="rv-panel"><div class="rv-card"><h2>الإعدادات</h2>' +
      '<div class="rv-row"><label>الصوت العام</label><input type="range" id="s-vol" min="0" max="100"><span class="rv-val" id="v-vol"></span></div>' +
      '<div class="rv-row"><label>الموسيقى والأجواء</label><input type="range" id="s-mus" min="0" max="100"><span class="rv-val" id="v-mus"></span></div>' +
      '<div class="rv-row"><label>حساسية النظر</label><input type="range" id="s-sens" min="40" max="220"><span class="rv-val" id="v-sens"></span></div>' +
      '<div class="rv-row"><label>السطوع</label><input type="range" id="s-br" min="70" max="160"><span class="rv-val" id="v-br"></span></div>' +
      '<div class="rv-row"><label>الجودة</label><div class="rv-seg" id="s-q"><button data-q="auto">تلقائي</button><button data-q="low">منخفض</button></div></div>' +
      '<div class="rv-row"><label>تأثير الفيلم والحبيبات</label><div class="rv-sw" id="s-fx"></div></div>' +
      '<div class="rv-row"><label>الاهتزاز</label><div class="rv-sw" id="s-vib"></div></div>' +
      '<div class="rv-row"><label>تلميحات لوحة المفاتيح</label><div class="rv-sw" id="s-hint"></div></div>' +
      '<div class="rv-row"><label>ملء الشاشة</label><button class="rv-btn sm" id="s-fs">تبديل</button></div>' +
      '<div class="rv-note" id="s-qn" style="display:none">تغيير الجودة يُطبَّق بعد إعادة التحميل.</div><button class="rv-btn" id="s-back">رجوع</button></div></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-cred">' + bgBlock() + '<div class="rv-panel"><div class="rv-card"><h2>الاعتمادات</h2><div class="rv-cred">' +
      '<h3>الفكرة والتوجيه</h3><p>محمد و Mohamed</p><h3>تصميم البيت والألغاز</h3><p>Mohamed ومساعده الذكي</p><h3>الواجهة والقوائم</h3><p>محمد ومساعده الذكي</p>' +
      '<h3>الخامات</h3><p>Poly Haven (ترخيص CC0)</p><h3>المحرك</h3><p>three.js</p><h3>الأصوات والموسيقى</h3><p>مولّدة داخل المتصفح</p><h3>شكر خاص</h3><p>لكل من يجرؤ على إكمال الليلة</p></div><button class="rv-btn" id="c-back" style="margin-top:12px">رجوع</button></div></div></div>' +
    '<div class="rv-scr" id="rv-over">' + bgBlock() + '<div class="rv-center"><div class="rv-chap" style="color:#c04040">انتهت الليلة</div><h1 id="o-title">أمسكت بك</h1><div class="rv-ov-b" id="o-body"></div><div style="width:min(300px,80vw)"><button class="rv-btn pri" id="o-retry">حاول مجددا</button><button class="rv-btn" id="o-menu">القائمة الرئيسية</button></div></div></div>' +
    '<div class="rv-scr" id="rv-end">' + bgBlock() + '<div class="rv-center"><div class="rv-chap">نهاية اليوم الأول</div><h1 id="e-t">نجوتَ</h1><div class="rv-ov-b" id="e-b"></div><div class="rv-stats"><div><b id="e-time">0</b>الدقائق</div><div><b id="e-notes">0</b>ملاحظات</div></div><div style="width:min(300px,80vw)"><button class="rv-btn pri" id="e-menu">القائمة الرئيسية</button><button class="rv-btn" id="e-cred">الاعتمادات</button></div></div></div>';
  document.body.appendChild(root);
  var pb = document.createElement('button'); pb.id = 'rv-pausebtn'; pb.textContent = '❚❚'; pb.setAttribute('aria-label', 'إيقاف مؤقت');
  var jb = document.createElement('button'); jb.id = 'rv-jbtn'; jb.textContent = '☰'; jb.setAttribute('aria-label', 'المذكرة');
  var chtag = document.createElement('div'); chtag.id = 'rv-chtag'; chtag.textContent = 'اليوم الأول';
  var dang = document.createElement('div'); dang.id = 'rv-danger'; var gr2 = document.createElement('div'); gr2.id = 'rv-grain2';
  [pb, jb, chtag, dang, gr2].forEach(function (n) { document.body.appendChild(n); });

  var scrs = ['rv-load', 'rv-main', 'rv-chs', 'rv-jr', 'rv-pause', 'rv-set', 'rv-cred', 'rv-over', 'rv-end'];
  var cur = null;
  function show(id) {
    scrs.forEach(function (s) { var e = $(s); if (s === id) { e.classList.add('on'); setTimeout(function () { e.classList.add('vis'); }, 20); } else { e.classList.remove('vis'); e.classList.remove('on'); } });
    cur = id; fxRun(id === 'rv-main' || id === 'rv-load');
  }
  function hideAll() { show(null); }

  // ---------- canvas fog / embers (main menu only) ----------
  var fx = { run: false, c: null, g: null, parts: [], fog: [], last: 0, flashT: 0 };
  function fxInit() {
    var c = $('rv-fx'); fx.c = c; fx.g = c.getContext('2d'); fxSize();
    fx.fog = []; for (var i = 0; i < 7; i++) fx.fog.push({ x: Math.random(), y: 0.45 + Math.random() * 0.5, r: 0.25 + Math.random() * 0.3, s: (Math.random() - 0.5) * 0.02, a: 0.05 + Math.random() * 0.06 });
    fx.parts = []; for (var j = 0; j < 46; j++) fx.parts.push(mkP(true));
  }
  function mkP(init) { return { x: Math.random(), y: init ? Math.random() : 1.05, vy: 0.02 + Math.random() * 0.05, vx: (Math.random() - 0.5) * 0.02, r: 0.6 + Math.random() * 1.8, a: 0.2 + Math.random() * 0.6, hot: Math.random() < 0.5 }; }
  function fxSize() { var c = fx.c; if (!c) return; c.width = Math.ceil(innerWidth / 2); c.height = Math.ceil(innerHeight / 2); }
  addEventListener('resize', fxSize);
  function fxRun(on) { if (on && !fx.run) { fx.run = true; if (!fx.c) fxInit(); fx.last = performance.now(); rawRAF(fxFrame); } else if (!on) fx.run = false; }
  function fxFrame(t) {
    if (!fx.run) return; rawRAF(fxFrame); if (t - fx.last < 40) return; var dt = Math.min(0.1, (t - fx.last) / 1000); fx.last = t;
    var g = fx.g, w = fx.c.width, h = fx.c.height; g.clearRect(0, 0, w, h); g.globalCompositeOperation = 'lighter';
    fx.fog.forEach(function (f) { f.x += f.s * dt; if (f.x < -0.3) f.x = 1.3; if (f.x > 1.3) f.x = -0.3; var gr = g.createRadialGradient(f.x * w, f.y * h, 0, f.x * w, f.y * h, f.r * w); gr.addColorStop(0, 'rgba(120,125,140,' + f.a + ')'); gr.addColorStop(1, 'rgba(120,125,140,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    fx.parts.forEach(function (p, i) { p.y -= p.vy * dt; p.x += p.vx * dt + Math.sin(t / 900 + i) * 0.0004; if (p.y < -0.05) fx.parts[i] = mkP(false); g.beginPath(); g.fillStyle = p.hot ? 'rgba(255,140,60,' + p.a + ')' : 'rgba(200,200,210,' + p.a * 0.5 + ')'; g.arc(p.x * w, p.y * h, p.r, 0, 6.3); g.fill(); });
    g.globalCompositeOperation = 'source-over';
    // lightning
    fx.flashT -= dt; if (fx.flashT < -9 + Math.random() * -9 && cur === 'rv-main') { fx.flashT = 0.35; thunder(); }
    var fl = $('rv-flash'); if (fl) fl.style.opacity = fx.flashT > 0 ? (Math.random() < 0.6 ? 0.28 * (fx.flashT / 0.35) : 0.05) : 0;
  }
  function thunder() { if (!amb.ctx || !amb.on) return; var c = amb.ctx, s = c.createBufferSource(); s.buffer = noiseBuf(c); var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; var g = c.createGain(), t = c.currentTime + 0.25; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9 * set.music * set.vol, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 3); s.connect(f); f.connect(g); g.connect(c.destination); s.start(t); s.stop(t + 3.2); }

  // ---------- loading ----------
  var tips = ['استخدم المصباح بحذر: الظلام يخفي كل شيء.', 'الأبواب تُفتح على مفصلاتها. اقترب وانظر إليها.', 'الاختباء قد ينقذك عندما تسمع الخطوات.', 'اقرأ الأوراق والملاحظات، فهي تحمل الرموز.', 'لا تركض إلا عند الضرورة، فالتحمل محدود.', 'إذا توقفت التهويدة، فهي قريبة.'];
  var tipI = 0; $('rv-tip').textContent = tips[0]; var tipT = setInterval(function () { tipI = (tipI + 1) % tips.length; $('rv-tip').textContent = tips[tipI]; }, 1800);
  var t0 = Date.now(), prog = 0, loadT = setInterval(function () {
    var ready = document.readyState === 'complete' && G();
    var target = ready ? 100 : Math.min(85, (Date.now() - t0) / 20); prog += (target - prog) * 0.25; $('rv-lb').style.width = prog + '%';
    if (ready && prog > 96 && Date.now() - t0 > 1400) { clearInterval(loadT); clearInterval(tipT); afterLoad(); }
  }, 120);
  show('rv-load');
  function afterLoad() {
    if (qs.get('autostart') === '1' || sessionStorage.getItem('rv_auto') === '1') { sessionStorage.removeItem('rv_auto'); entered = true; start(); return; }
    var skipTitle = sessionStorage.getItem('rv_entered') === '1'; show('rv-main');
    if (skipTitle) enter(); else { $('rv-tap').style.display = ''; }
  }

  // ---------- title -> menu ----------
  var entered = false;
  function enter() {
    if (entered && $('rv-mlist').style.display !== 'none') return; entered = true; try { sessionStorage.setItem('rv_entered', '1'); } catch (e) {}
    ambStart(1); $('rv-tap').style.display = 'none'; var m = $('rv-mlist'); m.style.display = 'flex'; m.style.opacity = 0; m.style.transition = 'opacity 1.2s'; setTimeout(function () { m.style.opacity = 1; }, 30); stinger('open');
  }
  $('rv-main').addEventListener('click', function (e) { if (!entered || $('rv-mlist').style.display === 'none') enter(); });

  // ---------- game control ----------
  var playing = false, tStart = 0;
  function start() {
    stinger('click'); ambStop(false); var b = $('startbtn'); if (b) b.click();
    playing = true; tStart = Date.now(); document.body.classList.add('rv-playing'); applyAll(); hideAll(); dangerLoop();
  }
  function pause() {
    if (!playing || paused) return; var g = G(); if (g && g.S && g.S.over) return;
    paused = true; document.body.classList.add('rv-paused'); ctxs.forEach(function (c) { try { c.suspend(); } catch (e) {} }); try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    $('p-conf').style.display = 'none'; pend = null; show('rv-pause'); ambStart(0.35);
  }
  function resume() {
    if (!paused) return; paused = false; document.body.classList.remove('rv-paused'); hideAll(); ambStop(true); ctxs.forEach(function (c) { try { c.resume(); } catch (e) {} });
    var h = held; held = []; h.forEach(function (cb) { rawRAF(cb); });
  }
  function toggle() { if (paused) resume(); else pause(); }
  var pend = null;
  function confirmDo(kind, msg) {
    var n = $('p-conf'); if (pend === kind) { pend = null; try { sessionStorage.setItem('rv_auto', kind === 'restart' ? '1' : '0'); } catch (e) {} location.href = location.pathname + (kind === 'restart' ? '?autostart=1' : ''); return; }
    pend = kind; n.textContent = msg; n.style.display = 'block'; n.style.color = '#e0a090';
  }
  function showMenu() { if (paused) resume(); show('rv-main'); ambStart(1); }
  function applyHints() { var h = $('hintkeys'); if (h) h.style.setProperty('display', set.hints ? '' : 'none', set.hints ? '' : 'important'); }

  // danger vignette: pulses when the monster is close
  function dangerLoop() {
    var g = G(); if (g && g.K && g.P && g.S && g.S.awake && !g.S.over && !paused) { var d = Math.hypot(g.P.x - g.K.x, g.P.z - g.K.z); var v = Math.max(0, Math.min(1, (14 - d) / 12)); dang.style.opacity = v * (0.55 + 0.45 * Math.abs(Math.sin(Date.now() / (700 - v * 450)))); }
    else dang.style.opacity = 0;
    if (playing) setTimeout(dangerLoop, 200);
  }

  // ---------- journal ----------
  function openJournal() {
    var g = G(), h = '<h4>الحقيبة</h4>', chips = [].map.call(document.querySelectorAll('#inv .chip'), function (c) { return c.textContent; });
    h += chips.length ? '<div class="rv-slots">' + chips.map(function (c) { return '<div class="rv-slot">' + c + '</div>'; }).join('') + '</div>' : '<div class="e">الحقيبة فارغة.</div>';
    h += '<h4>الملاحظات</h4>'; var log = g && g.S && g.S.log || [];
    h += log.length ? log.map(function (e) { return '<div class="e">' + e[1] + '</div>'; }).join('') : '<div class="e">لا توجد ملاحظات بعد. افحص الأشياء حولك.</div>';
    $('jr-body').innerHTML = h; prevScr = paused || playing ? 'rv-pause' : 'rv-main'; if (playing && !paused) pause(); show('rv-jr');
  }
  var prevScr = 'rv-main';

  // ---------- end / game over (replace the old #end card) ----------
  var endEl = $('end'), endSeen = false;
  function onEnd() {
    if (!endEl || endSeen) return; if (endEl.style.display !== 'flex') return; endSeen = true;
    var title = ($('e-title') || {}).textContent || '', body = ($('e-body') || {}).textContent || '', win = title.indexOf('نجو') >= 0;
    dang.style.opacity = 0; try { if (set.vib && !win && navigator.vibrate) navigator.vibrate([200, 80, 300]); } catch (e) {}
    if (win) {
      var g = G(); $('e-t').textContent = title; $('e-b').textContent = body; $('e-time').textContent = Math.max(1, Math.round((Date.now() - tStart) / 60000)); $('e-notes').textContent = (g && g.S && g.S.log ? g.S.log.length : 0);
      show('rv-end'); ambStart(0.8); stinger('win');
    } else { $('o-title').textContent = title; $('o-body').textContent = body; show('rv-over'); ambStart(0.5); stinger('die'); }
  }
  if (endEl) new MutationObserver(onEnd).observe(endEl, { attributes: true, attributeFilter: ['style'] });

  // ---------- wiring ----------
  function click(id, fn) { $(id).addEventListener('click', function (e) { e.stopPropagation(); stinger('click'); fn(e); }); }
  click('m-new', start);
  click('m-ch', function () { show('rv-chs'); });
  click('m-set', function () { prevScr = 'rv-main'; syncSet(); show('rv-set'); });
  click('m-cre', function () { show('rv-cred'); });
  click('ch1', start); click('ch-back', function () { show('rv-main'); }); $('ch2').addEventListener('click', function () { stinger('click'); });
  click('c-back', function () { show('rv-main'); }); click('s-back', function () { show(prevScr); });
  click('jr-back', function () { show('rv-pause'); });
  click('p-res', resume); click('p-jr', openJournal);
  click('p-set', function () { prevScr = 'rv-pause'; syncSet(); show('rv-set'); });
  click('p-rst', function () { confirmDo('restart', 'اضغط مرة أخرى لتأكيد إعادة الفصل. سيضيع التقدم.'); });
  click('p-menu', function () { confirmDo('menu', 'اضغط مرة أخرى للعودة إلى القائمة الرئيسية. سيضيع التقدم.'); });
  click('o-retry', function () { try { sessionStorage.setItem('rv_auto', '1'); } catch (e) {} location.href = location.pathname + '?autostart=1'; });
  click('o-menu', function () { try { sessionStorage.setItem('rv_auto', '0'); } catch (e) {} location.href = location.pathname; });
  click('e-menu', function () { try { sessionStorage.setItem('rv_auto', '0'); } catch (e) {} location.href = location.pathname; });
  click('e-cred', function () { prevScr = 'rv-end'; show('rv-cred'); $('c-back').onclick = function () { show('rv-end'); }; });
  pb.onclick = pause; jb.onclick = openJournal;
  addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && playing && cur !== 'rv-over' && cur !== 'rv-end') { e.preventDefault(); if (cur === 'rv-set' || cur === 'rv-jr') show('rv-pause'); else toggle(); }
    if (e.key === 'Enter' && cur === 'rv-main') enter();
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && playing) pause(); });

  // ---------- settings ----------
  function syncSet() {
    $('s-vol').value = Math.round(set.vol * 100); $('v-vol').textContent = Math.round(set.vol * 100) + '%';
    $('s-mus').value = Math.round(set.music * 100); $('v-mus').textContent = Math.round(set.music * 100) + '%';
    $('s-sens').value = Math.round(set.sens * 100); $('v-sens').textContent = set.sens.toFixed(1) + 'x';
    $('s-br').value = Math.round(set.bright * 100); $('v-br').textContent = Math.round(set.bright * 100) + '%';
    [].forEach.call($('s-q').children, function (b) { b.classList.toggle('on', b.dataset.q === set.quality); });
    $('s-hint').classList.toggle('on', !!set.hints); $('s-fx').classList.toggle('on', !!set.fx); $('s-vib').classList.toggle('on', !!set.vib);
  }
  function applyAll() { applyVol(); document.documentElement.style.setProperty('--rv-br', set.bright); applyHints(); document.body.classList.toggle('rv-fx', !!set.fx && playing); }
  $('s-vol').oninput = function () { set.vol = this.value / 100; save(); applyAll(); syncSet(); };
  $('s-mus').oninput = function () { set.music = this.value / 100; save(); applyAll(); syncSet(); };
  $('s-sens').oninput = function () { set.sens = this.value / 100; save(); syncSet(); };
  $('s-br').oninput = function () { set.bright = this.value / 100; save(); applyAll(); syncSet(); };
  [['s-hint', 'hints'], ['s-fx', 'fx'], ['s-vib', 'vib']].forEach(function (p) { $(p[0]).onclick = function () { set[p[1]] = !set[p[1]]; save(); applyAll(); syncSet(); if (p[1] === 'vib' && set.vib && navigator.vibrate) navigator.vibrate(60); }; });
  [].forEach.call($('s-q').children, function (b) { b.onclick = function () {
    if (set.quality === b.dataset.q) return; set.quality = b.dataset.q; save(); syncSet(); $('s-qn').style.display = 'block';
    var u = new URLSearchParams(location.search); if (set.quality === 'low') u.set('q', 'low'); else u.delete('q');
    if (!playing) location.search = u.toString(); else $('s-qn').textContent = 'سيُطبَّق عند إعادة الفصل أو إعادة تحميل الصفحة.';
  }; });
  $('s-fs').onclick = function () { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} };
  applyAll();

  // ---------- public API ----------
  window.HouseUI = {
    version: VERSION, settings: set, start: start, pause: pause, resume: resume, toggle: toggle, showMenu: showMenu, openJournal: openJournal,
    openSettings: function () { prevScr = paused ? 'rv-pause' : 'rv-main'; syncSet(); show('rv-set'); }, openCredits: function () { show('rv-cred'); },
    // The character slot is empty and hidden by design: HouseUI.setCharacter({ src: 'character.png' }) shows art on the title screen later.
    setCharacter: function (o) { var s = $('rv-riven'); if (!s || !o || !o.src) return; s.style.cssText = 'position:absolute;left:5%;bottom:18%;width:26%;max-width:220px;pointer-events:none'; s.innerHTML = '<img style="width:100%" src="' + o.src.replace(/"/g, '') + '">'; }
  };
})();
