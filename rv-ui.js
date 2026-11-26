/* rv-ui.js  -  Interface layer for the horror house game (menus, pause, settings, loading, credits, HUD polish).
 *
 * INTEGRATION (one include, no house code is changed):
 *   <script src="rv-ui.js"></script>      <- place it AFTER the game script, before </body>
 *
 * The layer only touches the house through things that already exist:
 *   - DOM ids: #startbtn (starts the game), #overlay (old start screen, hidden by this layer), #end (win/lose screen), #hintkeys
 *   - window.G.S / window.G.P (read state, and yaw/pitch for the sensitivity setting)
 *   - browser APIs it wraps non-invasively: requestAnimationFrame (pause) and AudioContext (pause + volume)
 *   - URL parameter ?q=low (already supported by the house) for the quality setting
 * Public API: window.HouseUI = { start(), pause(), resume(), toggle(), openSettings(), openCredits(), showMenu(), setCharacter({src}), settings }
 * Everything is namespaced "rv-" so it cannot collide with house CSS/JS.
 */
(function () {
  'use strict';
  var VERSION = '0.6';
  var LS = 'rv_ui_settings';
  var S0 = { vol: 0.9, sens: 1, bright: 1, quality: 'auto', hints: true };
  var set = {}; try { set = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) {}
  Object.keys(S0).forEach(function (k) { if (set[k] === undefined) set[k] = S0[k]; });
  var qs = new URLSearchParams(location.search);
  if (qs.get('q') === 'low') set.quality = 'low';
  function save() { try { localStorage.setItem(LS, JSON.stringify(set)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function G() { return window.G || null; }

  // ---------- non-invasive pause (requestAnimationFrame) and audio (AudioContext) hooks ----------
  var paused = false, held = [], rawRAF = window.requestAnimationFrame.bind(window), ctxs = [], vgains = [];
  window.requestAnimationFrame = function (cb) {
    if (paused) { held.push(cb); return 0; }
    return rawRAF(function (t) {
      if (paused) { held.push(cb); return; }
      var g = G(), y0, p0;
      if (g && g.P && g.S && g.S.started) { y0 = g.P.yaw; p0 = g.P.pitch; }
      cb(t);
      if (y0 !== undefined && set.sens !== 1) { // sensitivity: scale the look delta the game applied this frame
        var dy = g.P.yaw - y0, dp = g.P.pitch - p0;
        if (Math.abs(dy) < 0.6 && Math.abs(dp) < 0.6) { g.P.yaw += dy * (set.sens - 1); g.P.pitch = Math.max(-1.2, Math.min(1.2, g.P.pitch + dp * (set.sens - 1))); }
      }
    });
  };
  ['AudioContext', 'webkitAudioContext'].forEach(function (nm) {
    var Orig = window[nm]; if (!Orig) return;
    window[nm] = function () {
      var c = new Orig(); try { var vg = c.createGain(); vg.gain.value = set.vol; vg.connect(c.destination); Object.defineProperty(c, 'destination', { get: function () { return vg; } }); vgains.push(vg); } catch (e) {}
      ctxs.push(c); return c;
    };
    window[nm].prototype = Orig.prototype;
  });
  function applyVol() { vgains.forEach(function (g) { g.gain.value = set.vol; }); }

  // ---------- styles ----------
  var css = '' +
  '#overlay{display:none!important}' +
  '#rv-root,#rv-root *{box-sizing:border-box;font-family:"Segoe UI",Tahoma,Arial,sans-serif}' +
  '#rv-root{position:fixed;inset:0;z-index:60;pointer-events:none;color:#e8e2d4;direction:rtl}' +
  '.rv-scr{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:auto;padding:calc(14px + env(safe-area-inset-top)) 16px calc(14px + env(safe-area-inset-bottom));overflow:auto}' +
  '.rv-scr.on{display:flex}' +
  '.rv-bg{background:radial-gradient(ellipse at 50% 35%,#2a1d17 0,#0d0807 55%,#000 100%)}' +
  '.rv-bg:before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 30% 110%,rgba(120,10,10,.35),transparent 55%),radial-gradient(ellipse at 80% -10%,rgba(60,70,90,.18),transparent 50%);animation:rvfl 7s infinite}' +
  '.rv-bg:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,255,255,.015) 0 1px,transparent 1px 3px);pointer-events:none}' +
  '@keyframes rvfl{0%,100%{opacity:.9}6%{opacity:.5}8%{opacity:1}45%{opacity:.85}47%{opacity:.4}49%{opacity:1}}' +
  '.rv-dim{background:rgba(0,0,0,.72);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}' +
  '.rv-wrap{position:relative;display:flex;gap:22px;align-items:center;justify-content:center;max-width:900px;width:100%;margin:auto}' +
  '.rv-col{display:flex;flex-direction:column;align-items:center;text-align:center}' +
  '.rv-title{font-size:44px;line-height:1.2;margin:0;color:#d8c18a;letter-spacing:1px;text-shadow:0 0 22px rgba(160,20,20,.6),0 3px 0 #2a0a0a;font-weight:700}' +
  '.rv-sub{font-size:13px;opacity:.6;margin:6px 0 18px;letter-spacing:.5px}' +
  '.rv-btn{pointer-events:auto;cursor:pointer;display:block;width:min(280px,78vw);margin:7px auto;padding:13px 18px;font-size:18px;color:#f0e6cc;border:1px solid #7a6538;background:linear-gradient(#3a2d20,#1e1710);border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,230,170,.12);font-family:inherit;touch-action:manipulation}' +
  '.rv-btn:active{transform:scale(.97);background:linear-gradient(#2a1f16,#140f0a)}' +
  '.rv-btn.pri{border-color:#a02a2a;background:linear-gradient(#7a2a24,#3d1210);font-weight:700}' +
  '.rv-btn.sm{width:auto;display:inline-block;padding:9px 16px;font-size:15px;margin:4px}' +
  '.rv-card{position:relative;pointer-events:auto;background:rgba(18,13,10,.92);border:1px solid #5a4a2c;border-radius:14px;padding:18px 20px;width:min(460px,100%);max-height:100%;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.8)}' +
  '.rv-card h2{margin:0 0 12px;font-size:24px;color:#d8c18a;text-align:center}' +
  '.rv-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;font-size:15px}' +
  '.rv-row label{flex:0 0 38%}' +
  '.rv-row input[type=range]{flex:1;accent-color:#b5392f;height:28px;direction:ltr}' +
  '.rv-val{flex:0 0 40px;text-align:left;font-size:13px;opacity:.7;direction:ltr}' +
  '.rv-seg{display:flex;gap:6px;flex:1}.rv-seg button{flex:1;pointer-events:auto;padding:9px 4px;border-radius:8px;border:1px solid #5a4a2c;background:#1b140e;color:#e8e2d4;font-family:inherit;font-size:14px}.rv-seg button.on{background:#7a2a24;border-color:#b5392f}' +
  '.rv-sw{width:52px;height:30px;border-radius:15px;background:#2a2118;border:1px solid #5a4a2c;position:relative;pointer-events:auto;cursor:pointer;flex:0 0 auto}.rv-sw:after{content:"";position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;background:#8a8070;transition:all .15s}.rv-sw.on{background:#a02a2a}.rv-sw.on:after{right:25px;background:#f0e6cc}' +
  '.rv-note{font-size:12px;opacity:.55;text-align:center;margin-top:8px;line-height:1.6}' +
  /* character slot (empty until HouseUI.setCharacter is called) */
  '#rv-riven{display:none;position:relative;width:200px;height:290px;flex:0 0 auto;border:1px solid rgba(216,193,138,.3);border-radius:14px;background:radial-gradient(ellipse at 50% 30%,rgba(90,20,20,.25),rgba(0,0,0,.55));flex-direction:column;align-items:center;justify-content:flex-end;overflow:hidden;pointer-events:none}' +
  '#rv-riven svg{position:absolute;inset:0;width:100%;height:100%;animation:rvbr 5s ease-in-out infinite}' +
  '#rv-riven img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}' +
  '@keyframes rvbr{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}' +
  '#rv-riven .cap{position:relative;z-index:1;width:100%;padding:8px;text-align:center;font-size:12px;background:linear-gradient(transparent,rgba(0,0,0,.85));line-height:1.5}' +
  '#rv-riven .cap b{display:block;font-size:15px;color:#d8c18a;letter-spacing:1px}' +
  /* loading */
  '#rv-load .bar{width:min(300px,70vw);height:6px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;margin:16px auto 10px}#rv-load .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7a2a24,#d8c18a);transition:width .25s}' +
  '#rv-load .tip{font-size:13px;opacity:.7;min-height:40px;max-width:320px;line-height:1.7}' +
  /* credits */
  '.rv-cred{max-height:62vh;overflow:auto;text-align:center;line-height:2;font-size:15px}.rv-cred h3{margin:14px 0 2px;color:#d8c18a;font-size:15px;font-weight:600}.rv-cred p{margin:0;opacity:.85}' +
  /* in-game pause button + HUD polish */
  '#rv-pausebtn{position:fixed;z-index:61;top:calc(8px + env(safe-area-inset-top));right:10px;width:42px;height:42px;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(20,16,12,.65);color:#fff;font-size:16px;display:none;align-items:center;justify-content:center;padding:0;pointer-events:auto;touch-action:manipulation}' +
  'body.rv-playing #rv-pausebtn{display:flex}body.rv-paused #rv-pausebtn{display:none}' +
  'body.rv-playing #obj{width:calc(100% - 116px);max-width:480px;border-radius:10px;border:1px solid rgba(216,193,138,.25);background:rgba(10,7,5,.6)}' +
  'body.landscape.rv-playing #obj{max-width:42%;width:auto}' +
  '#inv{top:calc(58px + env(safe-area-inset-top))}' +
  '.chip{background:rgba(14,10,8,.7)!important;border-color:rgba(216,193,138,.35)!important;backdrop-filter:blur(2px)}' +
  '#stam{height:5px!important;width:140px!important;border:1px solid rgba(255,255,255,.12)}#stam i{background:linear-gradient(90deg,#8a2a22,#d8c18a)!important}' +
  '.tb{width:50px!important;height:50px!important;background:rgba(14,10,8,.7)!important;border-color:rgba(216,193,138,.4)!important}' +
  '#act{border-color:rgba(216,193,138,.7)!important;box-shadow:0 0 24px rgba(160,30,30,.45)!important}' +
  '#toast{font-size:17px!important;letter-spacing:.2px}' +
  '#game canvas{filter:brightness(var(--rv-br,1))}' +
  '#end{background:radial-gradient(ellipse at center,rgba(40,8,8,.93),rgba(0,0,0,.98))!important}' +
  '#end .btn{pointer-events:auto}' +
  '.rv-fadeout{animation:rvfo .5s forwards}@keyframes rvfo{to{opacity:0}}' +
  /* landscape / small */
  'body.landscape .rv-title{font-size:32px}body.landscape .rv-sub{margin:4px 0 8px}body.landscape .rv-btn{padding:9px 14px;font-size:16px;margin:5px auto}body.landscape #rv-riven{width:150px;height:230px}body.landscape .rv-wrap{gap:28px}' +
  'body.portrait .rv-wrap{flex-direction:column;gap:12px}body.portrait #rv-riven{width:150px;height:200px}body.portrait .rv-title{font-size:38px}' +
  'body.landscape .rv-card{padding:12px 16px}body.landscape .rv-row{margin:4px 0}body.landscape .rv-card h2{font-size:20px;margin-bottom:6px}' +
  '@media(max-height:420px){#rv-riven{display:none!important}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------- DOM ----------
  var root = document.createElement('div'); root.id = 'rv-root';
  root.innerHTML =
    '<div class="rv-scr rv-bg on" id="rv-load"><div class="rv-col"><h1 class="rv-title">بيت التهويدة</h1><div class="bar"><i id="rv-lb"></i></div><div class="tip" id="rv-tip"></div></div></div>' +
    '<div class="rv-scr rv-bg" id="rv-menu"><div class="rv-wrap"><div id="rv-riven"></div>' +
      '<div class="rv-col"><h1 class="rv-title">بيت التهويدة</h1><div class="rv-sub">لعبة رعب · الإصدار <span id="rv-ver"></span></div>' +
      '<button class="rv-btn pri" id="rv-play">ابدأ اللعب</button><button class="rv-btn" id="rv-opt">الإعدادات</button><button class="rv-btn" id="rv-cre">الاعتمادات</button>' +
      '<div class="rv-note">سماعات مفضّلة · يعمل بالطول وبالعرض</div></div></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-pause"><div class="rv-card" style="width:min(340px,100%)"><h2>إيقاف مؤقت</h2>' +
      '<button class="rv-btn pri" id="rv-res">استئناف</button><button class="rv-btn" id="rv-opt2">الإعدادات</button><button class="rv-btn" id="rv-rst">إعادة البدء</button><button class="rv-btn" id="rv-tomenu">القائمة الرئيسية</button><div class="rv-note" id="rv-conf" style="display:none"></div></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-set"><div class="rv-card"><h2>الإعدادات</h2>' +
      '<div class="rv-row"><label>الصوت</label><input type="range" id="s-vol" min="0" max="100"><span class="rv-val" id="v-vol"></span></div>' +
      '<div class="rv-row"><label>حساسية النظر</label><input type="range" id="s-sens" min="40" max="220"><span class="rv-val" id="v-sens"></span></div>' +
      '<div class="rv-row"><label>السطوع</label><input type="range" id="s-br" min="70" max="160"><span class="rv-val" id="v-br"></span></div>' +
      '<div class="rv-row"><label>الجودة</label><div class="rv-seg" id="s-q"><button data-q="auto">تلقائي</button><button data-q="low">منخفض</button></div></div>' +
      '<div class="rv-row"><label>تلميحات لوحة المفاتيح</label><div class="rv-sw" id="s-hint"></div></div>' +
      '<div class="rv-row"><label>ملء الشاشة</label><button class="rv-btn sm" id="s-fs">تبديل</button></div>' +
      '<div class="rv-row"><label>اللغة</label><span>العربية</span></div>' +
      '<div class="rv-note" id="s-qn" style="display:none">تغيير الجودة يعيد تحميل الصفحة.</div>' +
      '<button class="rv-btn" id="s-back" style="margin-top:12px">رجوع</button></div></div>' +
    '<div class="rv-scr rv-dim" id="rv-cred"><div class="rv-card"><h2>الاعتمادات</h2><div class="rv-cred">' +
      '<h3>الفكرة والتوجيه</h3><p>محمد و Mohamed</p><h3>تصميم البيت والألغاز</h3><p>Mohamed ومساعده الذكي</p><h3>الواجهة والقوائم</h3><p>محمد ومساعده الذكي</p>' +
      '<h3>الخامات</h3><p>Poly Haven (ترخيص CC0)</p><h3>المحرك</h3><p>three.js</p><h3>الأصوات</h3><p>مولّدة داخل المتصفح</p></div><button class="rv-btn" id="c-back" style="margin-top:10px">رجوع</button></div></div>';
  document.body.appendChild(root);
  var pb = document.createElement('button'); pb.id = 'rv-pausebtn'; pb.textContent = '❚❚'; pb.setAttribute('aria-label', 'إيقاف مؤقت'); document.body.appendChild(pb);
  $('rv-ver').textContent = VERSION;

  var scr = ['rv-load', 'rv-menu', 'rv-pause', 'rv-set', 'rv-cred'];
  function show(id) { scr.forEach(function (s) { $(s).classList.toggle('on', s === id); }); }
  function hideAll() { scr.forEach(function (s) { $(s).classList.remove('on'); }); }
  var prev = 'rv-menu';

  // ---------- loading ----------
  var tips = ['استخدم المصباح بحذر: الظلام يخفي كل شيء.', 'الأبواب تُفتح على مفصلاتها. اقترب وانظر إليها.', 'الاختباء قد ينقذك عندما تسمع الخطوات.', 'اقرأ الأوراق والملاحظات، فهي تحمل الرموز.', 'لا تركض إلا عند الضرورة، فالتحمل محدود.'];
  var tipI = 0; $('rv-tip').textContent = tips[0]; var tipT = setInterval(function () { tipI = (tipI + 1) % tips.length; $('rv-tip').textContent = tips[tipI]; }, 1800);
  var t0 = Date.now(), prog = 0, loadT = setInterval(function () {
    var ready = document.readyState === 'complete' && G();
    var target = ready ? 100 : Math.min(85, (Date.now() - t0) / 20);
    prog += (target - prog) * 0.25; $('rv-lb').style.width = prog + '%';
    if (ready && prog > 96 && Date.now() - t0 > 1100) { clearInterval(loadT); clearInterval(tipT); afterLoad(); }
  }, 120);
  function afterLoad() {
    if (qs.get('autostart') === '1' || sessionStorage.getItem('rv_auto') === '1') { sessionStorage.removeItem('rv_auto'); start(); } else show('rv-menu');
  }

  // ---------- game control ----------
  var playing = false;
  function start() {
    var b = $('startbtn'); if (b) b.click();
    playing = true; document.body.classList.add('rv-playing'); hideAll(); applyHints();
  }
  function pause() {
    if (!playing || paused) return; var g = G(); if (g && g.S && g.S.over) return;
    paused = true; document.body.classList.add('rv-paused'); ctxs.forEach(function (c) { try { c.suspend(); } catch (e) {} }); try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    $('rv-conf').style.display = 'none'; pend = null; show('rv-pause');
  }
  function resume() {
    if (!paused) return; paused = false; document.body.classList.remove('rv-paused'); hideAll(); ctxs.forEach(function (c) { try { c.resume(); } catch (e) {} });
    var h = held; held = []; h.forEach(function (cb) { rawRAF(cb); });
  }
  function toggle() { if (paused) resume(); else pause(); }
  var pend = null;
  function confirm(kind, msg) {
    var n = $('rv-conf'); if (pend === kind) { pend = null; n.style.display = 'none'; try { sessionStorage.setItem('rv_auto', kind === 'restart' ? '1' : '0'); } catch (e) {} location.href = location.pathname + (kind === 'restart' ? '?autostart=1' : ''); return; }
    pend = kind; n.textContent = msg; n.style.display = 'block'; n.style.color = '#e0a090';
  }
  function showMenu() { if (paused) { paused = false; ctxs.forEach(function (c) { try { c.resume(); } catch (e) {} }); var h = held; held = []; h.forEach(function (cb) { rawRAF(cb); }); } show('rv-menu'); }
  function applyHints() { var h = $('hintkeys'); if (h) h.style.setProperty('display', set.hints ? '' : 'none', set.hints ? '' : 'important'); }

  $('rv-play').onclick = start;
  $('rv-opt').onclick = function () { prev = 'rv-menu'; syncSet(); show('rv-set'); };
  $('rv-opt2').onclick = function () { prev = 'rv-pause'; syncSet(); show('rv-set'); };
  $('rv-cre').onclick = function () { show('rv-cred'); };
  $('c-back').onclick = function () { show('rv-menu'); };
  $('s-back').onclick = function () { show(prev); };
  $('rv-res').onclick = resume; pb.onclick = pause;
  $('rv-rst').onclick = function () { confirm('restart', 'اضغط مرة أخرى لتأكيد إعادة البدء. سيضيع التقدم.'); };
  $('rv-tomenu').onclick = function () { confirm('menu', 'اضغط مرة أخرى للعودة إلى القائمة الرئيسية. سيضيع التقدم.'); };
  addEventListener('keydown', function (e) { if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && playing) { e.preventDefault(); toggle(); } });
  document.addEventListener('visibilitychange', function () { if (document.hidden && playing) pause(); });

  // ---------- settings ----------
  function syncSet() {
    $('s-vol').value = Math.round(set.vol * 100); $('v-vol').textContent = Math.round(set.vol * 100) + '%';
    $('s-sens').value = Math.round(set.sens * 100); $('v-sens').textContent = set.sens.toFixed(1) + 'x';
    $('s-br').value = Math.round(set.bright * 100); $('v-br').textContent = Math.round(set.bright * 100) + '%';
    [].forEach.call($('s-q').children, function (b) { b.classList.toggle('on', b.dataset.q === set.quality); });
    $('s-hint').classList.toggle('on', !!set.hints);
  }
  function applyAll() { applyVol(); document.documentElement.style.setProperty('--rv-br', set.bright); applyHints(); }
  $('s-vol').oninput = function () { set.vol = this.value / 100; save(); applyAll(); syncSet(); };
  $('s-sens').oninput = function () { set.sens = this.value / 100; save(); syncSet(); };
  $('s-br').oninput = function () { set.bright = this.value / 100; save(); applyAll(); syncSet(); };
  $('s-hint').onclick = function () { set.hints = !set.hints; save(); applyAll(); syncSet(); };
  [].forEach.call($('s-q').children, function (b) { b.onclick = function () {
    if (set.quality === b.dataset.q) return; set.quality = b.dataset.q; save(); syncSet(); $('s-qn').style.display = 'block';
    var u = new URLSearchParams(location.search); if (set.quality === 'low') u.set('q', 'low'); else u.delete('q');
    if (!playing) { location.search = u.toString(); } else { $('s-qn').textContent = 'سيُطبَّق عند إعادة البدء أو إعادة تحميل الصفحة.'; }
  }; });
  $('s-fs').onclick = function () { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} };
  applyAll();

  // ---------- end screen: add a "main menu" button ----------
  var endEl = $('end');
  if (endEl) { var mb = document.createElement('button'); mb.className = 'btn'; mb.textContent = 'القائمة الرئيسية'; mb.onclick = function () { location.href = location.pathname; }; endEl.appendChild(mb); }

  // ---------- public API ----------
  window.HouseUI = {
    version: VERSION, settings: set, start: start, pause: pause, resume: resume, toggle: toggle, showMenu: showMenu,
    openSettings: function () { prev = paused ? 'rv-pause' : 'rv-menu'; syncSet(); show('rv-set'); }, openCredits: function () { show('rv-cred'); },
    // The character slot is empty and hidden until art exists: HouseUI.setCharacter({ src: 'character.png', caption: 'name' })
    setCharacter: function (o) { var slot = $('rv-riven'); if (!slot || !o || !o.src) return; var im = slot.querySelector('img') || document.createElement('img'); im.src = o.src; slot.appendChild(im); if (o.caption) { var cap = document.createElement('div'); cap.className = 'cap'; cap.innerHTML = o.caption; slot.appendChild(cap); } slot.style.display = 'flex'; }
  };
})();
