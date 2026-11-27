/* library.js  -  standalone horror living room module (own scene, own code, no dependency on any other game file).  v0.1
 * Needs only three.js r128 (global THREE). Library / study: two full bookcases, desk with drawers, filing cabinet, globe, armchair, chair that turns by itself, a book that falls.
 *
 *   var B = LibraryModule.build(THREE, { quality: '1k' | '2k' (default) | '4k', floorTexSize, wallTexSize, renderer, onProgress: fn(done,total), onScare: fn() });
 *   scene.add(B.group);  B.update(dt);                 // every frame
 *   B.use(interactive)           // what a tap / E press does: opens doors and drawers, switches the TV
 *   B.interactives, B.pick(raycaster, maxDist), B.colliders, B.bounds, B.spawn {x,z,yaw}, B.setCamera(x,z)
 *   B.audio.start()              // from a user gesture; procedural sound, no files: room tone, clock, heartbeat (when scared), creaks, whispers, bell, footsteps
 * Floor: checkerboard near-black / dark brownish off-white, square size opt.checkerSize (metres, default 0.25), colours opt.checkerColorA / opt.checkerColorB (CSS strings).
 * Textures: Poly Haven (CC0): damaged_plaster (upper walls, ceiling), dark_wood (floor, wainscot).  Everything else is generated in code.
 */
(function (root) {
  'use strict';
  var PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/';
  var W = 6.0, D = 5.0, H = 2.8, WH = 1.0; // room: width x, depth z, height; WH = wainscot height
  // ===== TEXTURE CONFIG ('size' = real-world metres covered by one texture image; all adjustable) =====
  var TEX = {
    floor: { id: 'dark_wood',         size: 1.2, tint: 0x8a7868, rough: 0.7 },
    wall:  { id: 'damaged_plaster',   size: 1.4, tint: 0xa09282, rough: 0.95, nor: 1.0 },
    wain:  { id: 'dark_wood',         size: 1.0, tint: 0x5e4e42, rough: 0.7 },
    ceil:  { id: 'damaged_plaster',   size: 1.4, tint: 0x6a665e, rough: 1.0 },
    wood:  { id: 'dark_wood',         size: 1.0, tint: 0x7a665a, rough: 0.6 }
  };

  function build(THREE, opt) {
    opt = opt || {};
    var q = opt.quality || '2k'; if (opt.floorTexSize) TEX.floor.size = opt.floorTexSize; if (opt.wallTexSize) TEX.wall.size = opt.wallTexSize; 
    var maxAniso = opt.renderer ? opt.renderer.capabilities.getMaxAnisotropy() : 4;
    var group = new THREE.Group(); group.name = 'library';
    var interactives = [], colliders = [], flick = [];
    var loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
    var progress = { done: 0, total: 0 };
    function bump() { progress.done++; if (opt.onProgress) opt.onProgress(progress.done, progress.total); }
    function rnd(seed) { var a = seed; return function () { a = (a * 16807) % 2147483647; return a / 2147483647; }; }

    // ---------- Poly Haven PBR materials ----------
    function pbr(cfg, surfW, surfH, fallback) {
      var m = new THREE.MeshStandardMaterial({ color: fallback, roughness: cfg.rough, metalness: 0, envMapIntensity: 0.1 }), id = cfg.id;
      var ru = surfW / cfg.size, rv = surfH / cfg.size;
      function tex(kind, srgb, apply) {
        progress.total++;
        loader.load(PH + q + '/' + id + '/' + id + '_' + kind + '_' + q + '.jpg', function (t) {
          t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = Math.min(8, maxAniso); if (srgb) t.encoding = THREE.sRGBEncoding;
          apply(t); m.needsUpdate = true; bump();
        }, undefined, function () { bump(); });
      }
      tex('diff', true, function (t) { m.map = t; m.color.setHex(cfg.tint); });
      tex('nor_gl', false, function (t) { m.normalMap = t; var n = cfg.nor || 1; m.normalScale = new THREE.Vector2(n, n); });
      tex('rough', false, function (t) { m.roughnessMap = t; m.roughness = 1; });
      return m;
    }
    // ---------- procedural aged textures (canvas): yellowed enamel, rusty steel, stained counter, items ----------
    function canvasTex(w, h, paint, srgb) { var c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); var t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb !== false) t.encoding = THREE.sRGBEncoding; return t; }
    // aged(): base colour + blotches + rust drips from the top + chips + scratches + bottom grime. o.rust 0..1, o.dark 0..1
    function aged(seed, base, o) {
      o = o || {}; return canvasTex(512, 512, function (g, w, h) {
        var r = rnd(seed); g.fillStyle = base; g.fillRect(0, 0, w, h);
        for (var i = 0; i < 70; i++) { var x = r() * w, y = r() * h, rad = 20 + r() * 70, b = g.createRadialGradient(x, y, 0, x, y, rad); var dk = r() < 0.6; b.addColorStop(0, dk ? 'rgba(40,28,10,' + (0.08 + r() * 0.16 * (1 + (o.dark || 0))) + ')' : 'rgba(255,240,200,' + (0.04 + r() * 0.07) + ')'); b.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
        var nrust = Math.round(14 * (o.rust === undefined ? 0.5 : o.rust));
        for (var k = 0; k < nrust; k++) { var rx = r() * w, len = 60 + r() * 360, ww = 3 + r() * 16, gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(110,50,16,' + (0.35 + r() * 0.35) + ')'); gr.addColorStop(1, 'rgba(110,50,16,0)'); g.fillStyle = gr; var y0 = r() < 0.5 ? 0 : r() * h * 0.5; g.save(); g.translate(rx, y0); g.fillRect(-ww / 2, 0, ww, len); g.restore(); }
        for (var c = 0; c < 38; c++) { var cx = r() * w, cy = r() * h, cw = 3 + r() * 14, chh = 3 + r() * 10; g.fillStyle = 'rgba(60,34,18,0.9)'; g.fillRect(cx, cy, cw, chh); g.fillStyle = 'rgba(200,190,160,0.55)'; g.fillRect(cx - 1, cy - 1, cw + 2, 1.5); }
        g.strokeStyle = 'rgba(30,24,16,0.35)'; g.lineWidth = 1; for (var s = 0; s < 22; s++) { g.beginPath(); var sx = r() * w, sy = r() * h; g.moveTo(sx, sy); g.lineTo(sx + (r() - 0.5) * 140, sy + (r() - 0.5) * 140); g.stroke(); }
        var bg = g.createLinearGradient(0, h, 0, h * 0.55); bg.addColorStop(0, 'rgba(18,12,6,0.65)'); bg.addColorStop(1, 'rgba(18,12,6,0)'); g.fillStyle = bg; g.fillRect(0, h * 0.55, w, h * 0.45);
      });
    }
    function std(map, o) { o = o || {}; return new THREE.MeshStandardMaterial({ map: map, color: o.color === undefined ? 0xffffff : o.color, roughness: o.rough === undefined ? 0.6 : o.rough, metalness: o.metal || 0, envMapIntensity: 0.12 }); }
    var mFridge = std(aged(3, '#b5a678', { rust: 0.7, dark: 0.8 }), { rough: 0.55 });
    var mStove = std(aged(11, '#a89c74', { rust: 0.8, dark: 1 }), { rough: 0.55 });
    var mSteel = std(aged(17, '#7d7a72', { rust: 1, dark: 1.3 }), { rough: 0.5, metal: 0.55 });
    var mTop = std(aged(23, '#2c2926', { rust: 0.2, dark: 0.4 }), { rough: 0.38 });
    var mInner = std(aged(29, '#9a8d62', { rust: 0.4, dark: 1.2 }), { rough: 0.6 });
    var mCarc = std(aged(31, '#2a2017', { rust: 0, dark: 1.5 }), { rough: 0.85 });
    var mBlack = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.5, metalness: 0.3 });
    var mGlass = new THREE.MeshStandardMaterial({ color: 0x1a1812, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.82, envMapIntensity: 1.2 });
    var mHandle = new THREE.MeshStandardMaterial({ color: 0x8c8479, roughness: 0.45, metalness: 0.8, envMapIntensity: 0.8 });
    var mTrim = new THREE.MeshStandardMaterial({ color: 0x4a382a, roughness: 0.75 });
    var mRed = std(aged(41, '#6e1a12', { rust: 1, dark: 1 }), { rough: 0.55, metal: 0.3 });
    var palette = ['#6a2a22', '#3a4a30', '#8a7a3a', '#3a3a52', '#7a4a22', '#566052', '#8a8470', '#4a2a2a'];
    function labelTex(i) { return canvasTex(64, 64, function (g, w, h) { var r = rnd(i * 13 + 5); g.fillStyle = palette[i % palette.length]; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(230,220,190,0.8)'; g.fillRect(0, 18, w, 26); g.fillStyle = 'rgba(40,20,10,0.8)'; g.fillRect(6, 24, 40 + r() * 10, 5); g.fillRect(6, 33, 30, 4); g.fillStyle = 'rgba(70,40,10,0.35)'; for (var k = 0; k < 6; k++) g.fillRect(r() * w, r() * h, 6 + r() * 10, 12 + r() * 30); }); }
    var canMats = palette.map(function (c, i) { return std(labelTex(i), { rough: 0.5, metal: 0.4 }); });
    var mJar = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.2, transparent: true, opacity: 0.75, envMapIntensity: 1 });
    var mFood = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.9 });
    var mMold = new THREE.MeshStandardMaterial({ color: 0x3e5a36, roughness: 1 });
    var mPlate = std(aged(51, '#cfc7ad', { rust: 0.2, dark: 1 }), { rough: 0.35 });
    var mRag = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1 });
    var mPaper = new THREE.MeshStandardMaterial({ color: 0x8a7e60, roughness: 0.9 });

    // ---------- helpers ----------
    function box(w, h, d, m, x, y, z, parent, shadow) {
      var o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); if (shadow !== false) { o.castShadow = true; o.receiveShadow = true; } (parent || group).add(o); return o;
    }
    function cyl(rt, rb, h, m, x, y, z, parent, seg) { var o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), m); o.position.set(x, y, z); o.receiveShadow = true; (parent || group).add(o); return o; }
    function solid(minX, maxX, minZ, maxZ) { colliders.push({ minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ }); }
    function bar(len, x, y, z, parent, vertical) { var o = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, len, 8), mHandle); o.position.set(x, y, z); if (!vertical) o.rotation.z = Math.PI / 2; (parent || group).add(o); return o; }
    // hollow carcass (open at +z): sides, top, bottom, back. centre at local origin of the returned group.
    function carcass(parent, w, h, d, mat, x, y, z) {
      var g = new THREE.Group(); g.position.set(x, y, z); (parent || group).add(g); var t = 0.02;
      box(t, h, d, mat, -w / 2 + t / 2, 0, 0, g); box(t, h, d, mat, w / 2 - t / 2, 0, 0, g);
      box(w, t, d, mat, 0, h / 2 - t / 2, 0, g); box(w, t, d, mat, 0, -h / 2 + t / 2, 0, g); box(w - 2 * t, h - 2 * t, t, mat, 0, 0, -d / 2 + t / 2, g);
      return g;
    }
    function shelf(g, w, d, y, mat) { return box(w - 0.04, 0.016, d - 0.03, mat || mCarc, 0, y, 0.0, g); }
    // items (small props), base y = surface height in the parent's coordinates
    var seedI = 100;
    function can(p, x, y, z, i) { var o = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.105, 14), canMats[i % canMats.length]); o.position.set(x, y + 0.0525, z); o.rotation.y = i; p.add(o); return o; }
    function jar(p, x, y, z) { cyl(0.04, 0.04, 0.13, mJar, x, y + 0.065, z, p, 12); cyl(0.034, 0.034, 0.08, mFood, x, y + 0.045, z, p, 10); cyl(0.042, 0.042, 0.015, mSteel, x, y + 0.138, z, p, 12); }
    function bottle(p, x, y, z, i) { var m = std(null, { color: [0x3a4a2a, 0x4a3018, 0x2a3a4a][i % 3], rough: 0.2 }); m.transparent = true; m.opacity = 0.85; cyl(0.032, 0.032, 0.16, m, x, y + 0.08, z, p, 12); cyl(0.011, 0.018, 0.07, m, x, y + 0.195, z, p, 10); }
    function plates(p, x, y, z, n, r) { for (var k = 0; k < n; k++) cyl(r || 0.1, (r || 0.1) * 0.8, 0.014, mPlate, x + (k % 2) * 0.004, y + 0.008 + k * 0.016, z, p, 18); }
    function boxItem(p, x, y, z, w, h, d, i) { var o = box(w, h, d, canMats[i % canMats.length], x, y + h / 2, z, p, false); o.rotation.y = (i % 5) * 0.2 - 0.3; return o; }
    function pot(p, x, y, z, rad) { cyl(rad, rad * 0.9, rad * 1.1, mSteel, x, y + rad * 0.55, z, p, 16); cyl(rad * 0.85, rad * 0.85, 0.01, mBlack, x, y + rad * 1.1, z, p, 16); }
    function rag(p, x, y, z) { var o = box(0.2, 0.025, 0.16, mRag, x, y + 0.012, z, p, false); o.rotation.y = 0.5; }
    function bone(p, x, y, z) { box(0.14, 0.03, 0.09, mMold, x, y + 0.015, z, p, false); }
    // fill a cabinet carcass interior surfaces: ys = list of surface heights (local to carcass group), w/d interior extents
    function stock(g, w, d, ys, kind) {
      var r = rnd(seedI++);
      ys.forEach(function (y, si) {
        var n = 4 + Math.floor(r() * 3), x0 = -w / 2 + 0.07;
        for (var k = 0; k < n; k++) {
          var x = x0 + (w - 0.14) * (k + 0.5) / n, z = -d * 0.15 + (r() - 0.5) * d * 0.4, t = Math.floor(r() * 6);
          if (kind === 'plates' && si === 0) { plates(g, x, y, z, 3 + Math.floor(r() * 5)); continue; }
          if (t === 0) can(g, x, y, z, k + si); else if (t === 1) jar(g, x, y, z); else if (t === 2) bottle(g, x, y, z, k); else if (t === 3) boxItem(g, x, y, z, 0.1, 0.17, 0.07, k + si); else if (t === 4) pot(g, x, y, z, 0.08); else plates(g, x, y, z, 2 + Math.floor(r() * 4), 0.085);
        }
      });
    }
    // hinged door: pivot at the hinge edge. kind 'v' = vertical axis, 'h' = horizontal axis at the bottom (oven). o.ajar: closed-state angle (hangs open), o.tilt: tilt (broken hinge)
    function door(name, label, w, h, t, mat, x, y, z, hinge, kind, parent, handle, o) {
      o = o || {};
      var pivot = new THREE.Group(); pivot.position.set(x, y, z); (parent || group).add(pivot);
      var side = hinge === 'left' ? 1 : -1;
      var d = box(w, h, t, mat, kind === 'h' ? 0 : side * w / 2, kind === 'h' ? h / 2 : 0, 0, pivot);
      var fx = -side * (w / 2 - 0.05);
      if (handle === 'bar-v') bar(Math.min(0.3, h * 0.5), fx, 0, t / 2 + 0.03, d, true);
      if (handle === 'bar-h') { bar(0.46, 0, h / 2 - 0.05, t / 2 + 0.045, d); [-1, 1].forEach(function (sg) { box(0.015, 0.015, 0.04, mHandle, sg * 0.22, h / 2 - 0.05, t / 2 + 0.02, d, false); }); }
      if (handle === 'knob-top' || handle === 'knob-bot') { var kb = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), mHandle); kb.position.set(fx, handle === 'knob-top' ? h / 2 - 0.07 : -h / 2 + 0.07, t / 2 + 0.02); d.add(kb); }
      var tgt = kind === 'h' ? 1.5 : side * -1.9 * (o.rev ? -1 : 1), c = kind === 'h' ? 0 : (o.ajar ? (tgt < 0 ? -1 : 1) * o.ajar : 0);
      if (o.tilt) pivot.rotation.z = o.tilt;
      var it = { name: name, label: label, object: pivot, open: false, t: 0, kind: kind, target: tgt, c: c, mesh: d };
      interactives.push(it); return it;
    }
    function drawer(name, label, w, h, dd, mat, x, y, z, parent, kind) {
      var g = new THREE.Group(); g.position.set(x, y, z); (parent || group).add(g);
      box(w, h, 0.02, mat, 0, 0, 0, g); bar(Math.min(0.3, w * 0.5), 0, h / 2 - 0.05, 0.05, g);
      var bw = w - 0.06, by = -h / 2 + 0.02; // open-top drawer box
      box(bw, 0.015, dd, mCarc, 0, by, -dd / 2 - 0.01, g); box(0.015, h - 0.06, dd, mCarc, -bw / 2, by + (h - 0.06) / 2, -dd / 2 - 0.01, g); box(0.015, h - 0.06, dd, mCarc, bw / 2, by + (h - 0.06) / 2, -dd / 2 - 0.01, g); box(bw, h - 0.06, 0.015, mCarc, 0, by + (h - 0.06) / 2, -dd - 0.01, g);
      var r = rnd(seedI++);
      for (var k = 0; k < 6; k++) { var u = box(0.018, 0.012, 0.16 + r() * 0.08, mSteel, -bw / 2 + 0.05 + k * (bw - 0.1) / 5, by + 0.015, -0.14 - r() * 0.16, g, false); u.rotation.y = (r() - 0.5) * 0.4; }
      if (kind === 'rags') rag(g, 0.0, by + 0.01, -0.35); else box(0.12, 0.04, 0.1, mPaper, 0.1, by + 0.03, -0.38, g, false);
      interactives.push({ name: name, label: label, object: g, open: false, t: 0, kind: 'slide', base: z, target: 0.38, c: 0, mesh: g.children[0] });
    }

    function pic(par, x, y, w, h, seed, rot, z) { var t = canvasTex(96, 128, function (c, ww, hh) { var r = rnd(seed); c.fillStyle = '#8a7e62'; c.fillRect(0, 0, ww, hh); for (var i = 0; i < 30; i++) { c.fillStyle = 'rgba(' + (30 + r() * 40 | 0) + ',' + (25 + r() * 30 | 0) + ',20,0.35)'; c.fillRect(r() * ww, r() * hh, 10 + r() * 30, 8 + r() * 25); } c.fillStyle = 'rgba(25,18,12,0.75)'; c.beginPath(); c.arc(48, 52, 17, 0, 6.283); c.fill(); c.fillRect(31, 66, 34, 60); }); var f = box(w + 0.06, h + 0.06, 0.03, mTrim, x, y, z, par, false); f.rotation.z = rot; var p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })); p.position.set(0, 0, 0.017); f.add(p); return f; }
    function decal(tex, w, h, par, x, y, z, op) { var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, opacity: op === undefined ? 1 : op, side: THREE.DoubleSide })); m.position.set(x, y, z); m.renderOrder = 2; par.add(m); return m; }
    var grime = canvasTex(1024, 256, function (g, w, h) { var r = rnd(7), gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(8,6,4,0.55)'); gr.addColorStop(0.4, 'rgba(14,10,6,0.25)'); gr.addColorStop(1, 'rgba(14,10,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (var i = 0; i < 60; i++) { var x = r() * w, y = h * (0.3 + r() * 0.6), rad = 10 + r() * 36, b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(10,8,5,' + (0.08 + r() * 0.14) + ')'); b.addColorStop(1, 'rgba(10,8,5,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } });
    var leak = canvasTex(256, 512, function (g, w, h) { var r = rnd(21); for (var k = 0; k < 3; k++) { var x = w * (0.25 + r() * 0.5), len = h * (0.5 + r() * 0.4), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(60,44,20,0.45)'); gr.addColorStop(1, 'rgba(60,44,20,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 4 - r() * 20, 0); g.lineTo(x + 4 + r() * 20, 0); g.lineTo(x + 3, len); g.lineTo(x - 3, len); g.fill(); } var b = g.createRadialGradient(w / 2, 20, 0, w / 2, 20, 90); b.addColorStop(0, 'rgba(50,36,14,0.5)'); b.addColorStop(1, 'rgba(50,36,14,0)'); g.fillStyle = b; g.fillRect(0, 0, w, 200); });
    var web = canvasTex(256, 256, function (g) { g.strokeStyle = 'rgba(225,225,215,0.5)'; g.lineWidth = 1.2; for (var i = 0; i <= 6; i++) { var a = i / 6 * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); g.stroke(); } for (var r = 1; r <= 7; r++) { g.beginPath(); for (var k = 0; k <= 6; k++) { var a2 = k / 6 * Math.PI / 2, rr = r * 34 - (k % 2 ? 6 : 0), px = Math.cos(a2) * rr, py = Math.sin(a2) * rr; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); } });

    // ---------- materials ----------
    // checkerboard floor: near-black / dark brownish off-white (opt.checkerColorA, opt.checkerColorB), flat colours, one square = opt.checkerSize metres (default 0.25)
    function checkerMat(surfW, surfH) {
      var S = opt.checkerSize || 0.25, c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
      g.fillStyle = opt.checkerColorA || '#060806'; g.fillRect(0, 0, 512, 512); g.fillStyle = opt.checkerColorB || '#8a7d6a'; g.fillRect(256, 0, 256, 256); g.fillRect(0, 256, 256, 256);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(surfW / (2 * S), surfH / (2 * S)); t.anisotropy = Math.min(16, maxAniso); t.encoding = THREE.sRGBEncoding; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0, envMapIntensity: 0.05 });   // matte
    }
    var mFloor = checkerMat(1, 1), mPlaster = pbr(TEX.wall, 1, 1, 0x8d887e), mWain = pbr(TEX.wain, 1, 1, 0x3a2c22), mCeil = pbr(TEX.ceil, 1, 1, 0x55524c), mWood = pbr(TEX.wood, 1, 1, 0x4a3020);
    var mDoorM = std(aged(81, '#3a2c22', { rust: 0, dark: 1.3 }), { rough: 0.8 });
    function fabric(seed, base) { return std(aged(seed, base, { rust: 0, dark: 1.2 }), { rough: 0.95 }); }
    var mRug = fabric(111, '#3a2a30'), mCurt = fabric(121, '#2e3a34'), mLeather = fabric(205, '#4a2a1e'), mDark = new THREE.MeshStandardMaterial({ color: 0x120e0c, roughness: 0.95 });
    var mBrass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.32, metalness: 0.9, envMapIntensity: 1.0, side: THREE.DoubleSide });
    var mGreen = new THREE.MeshStandardMaterial({ color: 0x2a5a3a, emissive: 0x2a7a4a, emissiveIntensity: 0.55, roughness: 0.4, side: THREE.DoubleSide });
    function planeG(g, w, h, mat, x, y, z, rx, ry) { var geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; (g || group).add(m); return m; }
    function wallGroup(x, z, ry) { var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; group.add(g); return g; }
    function wallBuild(g, len, gap) {
      function seg(x0, x1) { if (x1 - x0 < 0.01) return; var c = (x0 + x1) / 2, w = x1 - x0; planeG(g, w, WH, mWain, c, WH / 2, 0); planeG(g, w, H - WH, mPlaster, c, WH + (H - WH) / 2, 0); }
      if (!gap) { seg(-len / 2, len / 2); return; }
      seg(-len / 2, gap.c - gap.w / 2); seg(gap.c + gap.w / 2, len / 2); planeG(g, gap.w, H - gap.h, mPlaster, gap.c, gap.h + (H - gap.h) / 2, 0);
      box(0.08, gap.h, 0.12, mTrim, gap.c - gap.w / 2 - 0.04, gap.h / 2, 0.02, g); box(0.08, gap.h, 0.12, mTrim, gap.c + gap.w / 2 + 0.04, gap.h / 2, 0.02, g); box(gap.w + 0.16, 0.08, 0.12, mTrim, gap.c, gap.h + 0.04, 0.02, g);
    }
    planeG(group, W, D, mFloor, 0, 0, 0, -Math.PI / 2, 0); planeG(group, W, D, mCeil, 0, H, 0, Math.PI / 2, 0);
    var wB = wallGroup(0, -D / 2, 0), wL = wallGroup(-W / 2, 0, Math.PI / 2), wR = wallGroup(W / 2, 0, -Math.PI / 2), wF = wallGroup(0, D / 2, Math.PI);
    var dh = 2.05, dc = 1.8;
    wallBuild(wB, W); wallBuild(wL, D); wallBuild(wR, D); wallBuild(wF, W, { c: dc, w: 0.9, h: dh });
    [wB, wL, wR, wF].forEach(function (g, i) { box(i % 2 ? D : W, 0.05, 0.03, mTrim, 0, WH, 0.015, g, false); });
    door('door', 'الباب', 0.88, dh, 0.045, mDoorM, dc + 0.44, dh / 2, 0.02, 'right', 'v', wF, 'bar-v', { ajar: 0.0 });
    var bz = -D / 2, wz = D / 2;
    // rug
    box(2.6, 0.012, 3.2, mRug, 0.1, 0.007, 0.2, null, false); box(2.3, 0.013, 2.9, fabric(113, '#2a1e22'), 0.1, 0.008, 0.2, null, false);
    // ---------- book helpers ----------
    var bookMats = canMats;
    function books(lg, w, y0, y1, d, seed) { var r = rnd(seed), x = -w / 2 + 0.05; while (x < w / 2 - 0.06) { var bw = 0.03 + r() * 0.045, bh = (y1 - y0) * (0.62 + r() * 0.33), b = box(bw, bh, d * 0.7, bookMats[Math.floor(r() * 8)], x + bw / 2, y0 + 0.008 + bh / 2, 0.0, lg, false); if (r() < 0.09) { b.rotation.z = 0.28; b.position.y -= 0.01; } x += bw + 0.004; if (r() < 0.06) x += 0.12; } }
    function bookcase(wx, cabName) {
      var g = wallGroup(wx, bz, 0), cw = 1.5, ch = 2.3, cd = 0.36, lg = carcass(g, cw, ch, cd, mCarc, 0, ch / 2 + 0.02, cd / 2);
      var ys = [0.52, 0.98, 1.44, 1.9]; ys.forEach(function (y) { shelf(lg, cw, cd, y - ch / 2 - 0.02); });
      [0.52, 0.98, 1.44, 1.9].forEach(function (y, k) { books(lg, cw, y - ch / 2 - 0.02, y - ch / 2 + 0.44, cd, 300 + wx * 10 + k); });
      box(cw + 0.06, 0.05, cd + 0.04, mWood, 0, ch + 0.045, cd / 2, g); box(cw + 0.04, 0.08, cd + 0.02, mTrim, 0, 0.04, cd / 2 + 0.01, g);
      stock(lg, cw - 0.1, cd - 0.05, [-ch / 2 + 0.04], null); // cabinet interior items on bottom
      door(cabName + 'L', 'باب الخزانة', 0.74, 0.5, 0.02, mDoorM, -cw / 2 + 0.01, 0.31, cd + 0.01, 'left', 'v', g, 'knob-top'); door(cabName + 'R', 'باب الخزانة', 0.74, 0.5, 0.02, mDoorM, cw / 2 - 0.01, 0.31, cd + 0.01, 'right', 'v', g, 'knob-top');
      solid(wx - cw / 2, wx + cw / 2, bz, bz + cd + 0.05); return g;
    }
    var bcL = bookcase(-1.75, 'bcA'), bcR = bookcase(1.75, 'bcB');
    // cabinet contents: stacks of old papers and ledgers (visible when the doors open)
    [bcL, bcR].forEach(function (g, k) { var lg = g.children.filter(function (o) { return o.isGroup && o.children.length > 4; })[0]; if (!lg) return; for (var i = 0; i < 4; i++) box(0.3, 0.03 + i * 0.02, 0.22, bookMats[(i + k * 3) % 8], -0.3 + i * 0.05 * (k ? -1 : 1), -1.11 + 0.02 + i * 0.05, 0.14, lg, false).rotation.y = i * 0.35 - 0.4; box(0.28, 0.2, 0.2, mPaper, 0.35, -1.0, 0.15, lg, false); });
    // falling book (scare): sits on the left bookcase shelf, slides out and drops now and then
    var fallBook = box(0.05, 0.27, 0.22, canMats[0], -1.75 + 0.35, 1.585, bz + 0.17, null, false); fallBook.userData = { st: 0, t: 0, vy: 0, home: fallBook.position.clone() };
    // globe with a stand in the middle of the back wall
    var globe;
    (function () {
      var g = wallGroup(0, bz, 0); cyl(0.18, 0.2, 0.03, mWood, 0, 0.015, 0.45, g, 16); cyl(0.025, 0.04, 0.9, mWood, 0, 0.45, 0.45, g, 10); cyl(0.2, 0.2, 0.02, mBrass, 0, 0.92, 0.45, g, 20);
      var tex = canvasTex(256, 128, function (c, w, h) { var r = rnd(9); c.fillStyle = '#2a3a4a'; c.fillRect(0, 0, w, h); c.fillStyle = '#6a5a3a'; for (var i = 0; i < 18; i++) { c.beginPath(); c.ellipse(r() * w, 20 + r() * (h - 40), 8 + r() * 26, 6 + r() * 14, r() * 3, 0, 6.28); c.fill(); } c.strokeStyle = 'rgba(200,170,90,0.5)'; for (i = 1; i < 8; i++) { c.beginPath(); c.moveTo(0, i * h / 8); c.lineTo(w, i * h / 8); c.stroke(); } });
      globe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })); globe.position.set(0, 1.18, 0.45); globe.rotation.z = 0.4; g.add(globe);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.008, 6, 28), mBrass); ring.rotation.y = Math.PI / 2; ring.position.set(0, 1.18, 0.45); g.add(ring);
      pic(g, 0, 1.75, 0.5, 0.65, 17, 0.0, 0.03); solid(-0.25, 0.25, bz, bz + 0.7);
    })();
    // ---------- desk on the right wall, lamp, chair ----------
    var lampPos, chair, chairG;
    function drw(name, label, w, h, dd, x, y, z, parent, items) {
      var g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
      box(w, h, 0.02, mDoorM, 0, 0, 0, g); box(0.2, 0.02, 0.03, mBrass, 0, 0.0, 0.03, g, false);
      var bw = w - 0.05, by = -h / 2 + 0.02;
      box(bw, 0.015, dd, mCarc, 0, by, -dd / 2 - 0.01, g); box(0.015, h - 0.05, dd, mCarc, -bw / 2, by + (h - 0.05) / 2, -dd / 2 - 0.01, g); box(0.015, h - 0.05, dd, mCarc, bw / 2, by + (h - 0.05) / 2, -dd / 2 - 0.01, g); box(bw, h - 0.05, 0.015, mCarc, 0, by + (h - 0.05) / 2, -dd - 0.01, g);
      items(g, by + 0.012, bw, dd);
      interactives.push({ name: name, label: label, object: g, open: false, t: 0, kind: 'slide', base: z, target: 0.36, c: 0, mesh: g.children[0] });
    }
    function paperStack(g, x, y, z, n, rot) { for (var k = 0; k < n; k++) { var p = box(0.2, 0.004, 0.27, mPaper, x, y + 0.003 + k * 0.004, z, g, false); p.rotation.y = rot + k * 0.06; } }
    function envelope(g, x, y, z, rot, wax) { var e = box(0.14, 0.004, 0.09, mPaper, x, y + 0.003, z, g, false); e.rotation.y = rot; if (wax) { var s = cyl(0.014, 0.014, 0.004, mRed, x, y + 0.007, z, g, 10); s.rotation.y = rot; } }
    function key(g, x, y, z, rot) { var k = new THREE.Group(); k.position.set(x, y + 0.008, z); k.rotation.y = rot; g.add(k); box(0.07, 0.008, 0.008, mBrass, 0, 0, 0, k, false); var rg = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.005, 6, 12), mBrass); rg.rotation.x = Math.PI / 2; rg.position.set(-0.045, 0, 0); k.add(rg); box(0.008, 0.008, 0.02, mBrass, 0.03, 0, 0.012, k, false); }
    function photo(g, x, y, z, rot) { var t = canvasTex(64, 80, function (c, w, h) { c.fillStyle = '#9a9078'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(30,22,16,0.8)'; for (var i = 0; i < 3; i++) { c.beginPath(); c.arc(14 + i * 18, 34, 7, 0, 6.28); c.fill(); c.fillRect(8 + i * 18, 42, 12, 28); } c.strokeStyle = 'rgba(120,20,10,0.85)'; c.lineWidth = 3; c.beginPath(); c.moveTo(24, 22); c.lineTo(48, 46); c.moveTo(48, 22); c.lineTo(24, 46); c.stroke(); }); var p = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.125), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })); p.rotation.set(-Math.PI / 2, 0, rot); p.position.set(x, y + 0.01, z); g.add(p); }
    (function () {
      var g = wallGroup(W / 2, -0.4, -Math.PI / 2);
      box(1.7, 0.045, 0.78, mWood, 0, 0.76, 0.42, g); var pl = carcass(g, 0.5, 0.72, 0.7, mCarc, -0.58, 0.36, 0.42), pr = carcass(g, 0.5, 0.72, 0.7, mCarc, 0.58, 0.36, 0.42); box(0.7, 0.5, 0.02, mCarc, 0, 0.45, 0.1, g);
      drw('dkD1', 'درج المكتب', 0.46, 0.2, 0.55, -0.58, 0.63, 0.78, g, function (d, y, w, dd) { paperStack(d, -0.05, y, -0.3, 8, 0.1); envelope(d, 0.1, y + 0.03, -0.25, 0.4, true); envelope(d, -0.12, y + 0.04, -0.4, -0.3, false); });
      drw('dkD2', 'درج المكتب', 0.46, 0.2, 0.55, -0.58, 0.41, 0.78, g, function (d, y, w, dd) { key(d, -0.05, y, -0.3, 0.5); photo(d, 0.08, y, -0.38, 0.3); box(0.1, 0.05, 0.07, mBrass, 0.14, y + 0.025, -0.18, d, false); });
      drw('dkD3', 'درج المكتب', 0.46, 0.2, 0.55, -0.58, 0.19, 0.78, g, function (d, y, w, dd) { boxItem(d, -0.1, y, -0.3, 0.2, 0.05, 0.14, 4); box(0.18, 0.012, 0.12, mBlack, 0.1, y + 0.006, -0.25, d, false); var cd = cyl(0.012, 0.012, 0.1, mPaper, 0.12, y + 0.02, -0.4, d, 8); cd.rotation.z = Math.PI / 2; var cd2 = cyl(0.012, 0.012, 0.07, mPaper, 0.0, y + 0.014, -0.42, d, 8); cd2.rotation.z = 1.2; });
      door('dkDoor', 'باب المكتب', 0.46, 0.66, 0.02, mDoorM, 0.58 + 0.23, 0.36, 0.78, 'right', 'v', g, 'knob-top');
      var sg = carcass(pr, 0.44, 0.04, 0.6, mCarc, 0, 0.0, 0.0); box(0.2, 0.2, 0.22, canMats[2], -0.05, -0.2, 0.0, pr, false); box(0.22, 0.04, 0.18, mPaper, 0.06, -0.33, 0.1, pr, false); box(0.16, 0.14, 0.2, canMats[5], 0.1, -0.25, -0.1, pr, false); boxItem(pr, -0.1, -0.35, 0.08, 0.18, 0.06, 0.12, 1);
      // on the desk
      cyl(0.08, 0.1, 0.03, mBrass, -0.6, 0.8, 0.5, g, 14); cyl(0.012, 0.016, 0.3, mBrass, -0.6, 0.97, 0.5, g, 8); var sh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 0.17, 14, 1, true), mGreen); sh.position.set(-0.6, 1.17, 0.5); g.add(sh);
      var bk = box(0.3, 0.025, 0.21, mPaper, 0.1, 0.795, 0.5, g, false); bk.rotation.y = 0.2; box(0.3, 0.035, 0.22, canMats[6], 0.1, 0.78, 0.5, g, false).rotation.y = 0.2; paperStack(g, 0.55, 0.785, 0.35, 5, 0.5); box(0.12, 0.03, 0.12, mDark, -0.25, 0.795, 0.3, g, false); cyl(0.025, 0.025, 0.05, mBlack, -0.25, 0.835, 0.3, g, 10);
      var pn = box(0.2, 0.012, 0.012, mBrass, -0.3, 0.8, 0.28, g, false); pn.rotation.y = 0.5;
      lampPos = new THREE.Vector3(-0.6, 1.1, 0.5); g.updateMatrixWorld(true); lampPos = g.localToWorld(lampPos);
      // chair at the desk
      chairG = new THREE.Group(); chairG.position.set(W / 2 - 1.35, 0, -0.4); group.add(chairG); chair = new THREE.Group(); chair.rotation.y = -Math.PI / 2 + 0.25; chairG.add(chair);
      box(0.5, 0.06, 0.5, mLeather, 0, 0.46, 0, chair); box(0.5, 0.55, 0.06, mLeather, 0, 0.78, -0.22, chair); cyl(0.03, 0.03, 0.3, mBlack, 0, 0.28, 0, chair, 8); [0, 1, 2, 3, 4].forEach(function (k) { var a = k * 1.2566, l = box(0.28, 0.025, 0.035, mBlack, Math.cos(a) * 0.14, 0.1, Math.sin(a) * 0.14, chair, false); l.rotation.y = -a; });
      [-0.25, 0.25].forEach(function (x) { box(0.04, 0.05, 0.34, mWood, x, 0.64, 0.0, chair, false); });
      solid(W / 2 - 0.85, W / 2, -0.4 - 0.9, -0.4 + 0.9);
    })();
    // ---------- left wall: window with curtains, filing cabinet, armchair with reading lamp ----------
    var curt = [];
    (function () {
      var wgp = wL, wx = 0.8, win = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.3), new THREE.MeshBasicMaterial({ color: 0x0c1428 })); win.position.set(wx, 1.65, 0.012); wgp.add(win);
      box(1.05, 0.05, 0.08, mTrim, wx, 2.32, 0.05, wgp); box(1.1, 0.05, 0.1, mTrim, wx, 0.98, 0.06, wgp); box(0.05, 1.4, 0.08, mTrim, wx - 0.5, 1.65, 0.05, wgp); box(0.05, 1.4, 0.08, mTrim, wx + 0.5, 1.65, 0.05, wgp); box(0.03, 1.3, 0.04, mTrim, wx, 1.65, 0.04, wgp); box(0.95, 0.03, 0.04, mTrim, wx, 1.65, 0.04, wgp);
      [-0.45, 0.45].forEach(function (x) { curt.push(box(0.4, 1.7, 0.05, mCurt, wx + x, 1.6, 0.14, wgp, false)); });
      box(1.3, 0.025, 0.025, mBrass, wx, 2.46, 0.14, wgp, false);
      // filing cabinet (local x -1.3 -> world z 1.3)
      var fg = wallGroup(-W / 2, 1.3, Math.PI / 2), fx = -0.0, fc = carcass(fg, 0.55, 1.3, 0.6, mSteel, 0, 0.67, 0.31);
      [0.28, 0.7, 1.12].forEach(function (y, k) {
        drw('fc' + (k + 1), 'درج الملفات', 0.5, 0.38, 0.52, 0, y - 0.0, 0.62, fg, function (d, yy, w, dd) {
          for (var i = 0; i < 7; i++) { var f = box(0.012, 0.22, 0.26, bookMats[(i + k * 2) % 8], -0.2 + i * 0.065, yy + 0.11, -0.3 + (i % 2) * 0.02, d, false); f.rotation.z = (i % 3 - 1) * 0.06; }
          if (k === 1) photo(d, 0.12, yy + 0.23, -0.2, 0.2);
        });
      });
      fg.children.forEach(function (c) { }); solid(-W / 2, -W / 2 + 0.7, 1.3 - 0.4, 1.3 + 0.4);
      box(0.48, 0.3, 0.015, mCarc, 0, 0.67, 0.0, fg, false);
      // armchair (world), near the window
      var ag = new THREE.Group(); ag.position.set(-W / 2 + 0.95, 0, -0.9); ag.rotation.y = Math.PI / 2 + 0.3; group.add(ag);
      box(0.8, 0.22, 0.8, mLeather, 0, 0.3, 0, ag); box(0.8, 0.6, 0.18, mLeather, 0, 0.7, -0.34, ag); [-1, 1].forEach(function (s) { box(0.16, 0.34, 0.8, mLeather, s * 0.4, 0.45, 0, ag); }); box(0.55, 0.09, 0.5, fabric(207, '#5a3a2a'), 0, 0.46, 0.06, ag);
      box(0.06, 0.2, 0.06, mWood, -0.32, 0.1, -0.3, ag); box(0.06, 0.2, 0.06, mWood, 0.32, 0.1, -0.3, ag); box(0.06, 0.2, 0.06, mWood, -0.32, 0.1, 0.3, ag); box(0.06, 0.2, 0.06, mWood, 0.32, 0.1, 0.3, ag);
      solid(-W / 2 + 0.5, -W / 2 + 1.5, -1.4, -0.4);
      // small round table with candle between window and chair
      var tg = new THREE.Group(); tg.position.set(-W / 2 + 0.5, 0, -1.7); group.add(tg); cyl(0.2, 0.2, 0.03, mWood, 0, 0.58, 0, tg, 16); cyl(0.03, 0.05, 0.56, mWood, 0, 0.28, 0, tg, 8); cyl(0.12, 0.14, 0.02, mWood, 0, 0.01, 0, tg, 12); cyl(0.018, 0.018, 0.09, mPaper, 0.03, 0.66, 0, tg, 8); box(0.004, 0.025, 0.004, mDark, 0.03, 0.725, 0, tg, false);
      solid(-W / 2, -W / 2 + 0.75, -1.95, -1.45);
    })();
    // pictures
    pic(wL, -1.3, 1.7, 0.4, 0.5, 9, 0.1, 0.03); pic(wF, -1.0, 1.7, 0.3, 0.4, 13, 0, 0.03); pic(wF, -2.2, 1.6, 0.32, 0.42, 14, 0.12, 0.03); pic(wR, 1.5, 1.8, 0.5, 0.4, 5, 0, 0.03);
    [[wB, W], [wL, D], [wR, D], [wF, W]].forEach(function (p) { decal(grime, p[1] - 0.02, 0.7, p[0], 0, 1.35, 0.006); });
    [[wB, -W / 2 + 0.45, 1], [wB, W / 2 - 0.45, -1], [wL, D / 2 - 0.4, 1], [wR, -D / 2 + 0.4, -1]].forEach(function (c) { var m = decal(web, 0.9, 0.9, c[0], c[1], H - 0.45, 0.012, 0.85); m.scale.x = c[2]; });
    decal(leak, 0.9, 1.1, wB, 0.0, H - 0.55, 0.007, 0.9); decal(leak, 0.8, 1.0, wL, -1.6, H - 0.5, 0.007, 0.85);
    // ---------- lights ----------
    var shMap = q === '1k' ? 512 : 1024;
    var lamp = new THREE.PointLight(0xffc080, 0.6, 10, 2); lamp.position.copy(lampPos); lamp.castShadow = true; lamp.shadow.mapSize.set(shMap, shMap); lamp.shadow.bias = -0.0008; group.add(lamp);
    var moon = new THREE.SpotLight(0x6a86c8, 0.9, 9, 0.7, 0.7, 1.5); moon.position.set(-W / 2 + 0.3, 2.3, -0.8); moon.target.position.set(-0.8, 0, -0.8); group.add(moon, moon.target);
    group.add(new THREE.HemisphereLight(0x4a5470, 0x1a120e, 0.14));
    var candle = new THREE.PointLight(0xffa850, 0.12, 2.6, 2); candle.position.set(-W / 2 + 0.55, 0.85, -1.7); group.add(candle);
    // ---------- sound ----------
// ---------- procedural sound (WebAudio, no files) ----------
    var A = null, audio = { fear: 0.1, beat: 0 }, tm = { tick: 1, creak: 12, whisper: 60, chime: 40, flip: false, strikes: 0, strikeT: 0 };
    function noiseBuf(ctx) { var b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
    function envG(t, peak, dur, att) { var g = A.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + (att || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(A.master); return g; }
    function noiseHit(freq, q2, peak, dur, att, type) { if (!A) return; var t = A.ctx.currentTime, n = A.ctx.createBufferSource(); n.buffer = A.nbuf; var f = A.ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q2; n.connect(f); f.connect(envG(t, peak, dur, att)); n.start(t); n.stop(t + dur + 0.1); }
    audio.start = function () {
      if (A) return; var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; var ctx = new AC(); if (ctx.resume) ctx.resume();
      var master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      var d1 = ctx.createOscillator(), dg = ctx.createGain(); d1.type = 'sine'; d1.frequency.value = 50; dg.gain.value = 0.035; d1.connect(dg); dg.connect(master); d1.start();
      var nb = noiseBuf(ctx), wn = ctx.createBufferSource(), wf = ctx.createBiquadFilter(), wg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(); wn.buffer = nb; wn.loop = true; wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.9; wg.gain.value = 0.016; lfo.frequency.value = 0.12; lg.gain.value = 0.011; lfo.connect(lg); lg.connect(wg.gain); wn.connect(wf); wf.connect(wg); wg.connect(master); wn.start(); lfo.start();
      A = { ctx: ctx, master: master, nbuf: nb, drone: dg };
    };
    audio.setFear = function (f) { audio.fear = Math.max(0, Math.min(1, f)); };
    audio.creak = function () { if (!A) return; var t = A.ctx.currentTime, o = A.ctx.createOscillator(), bp = A.ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(150, t + 0.35); o.frequency.linearRampToValueAtTime(105, t + 0.8); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 4; o.connect(bp); bp.connect(envG(t, 0.07, 0.9, 0.08)); o.start(t); o.stop(t + 1); };
    audio.slide = function () { noiseHit(700, 1.2, 0.07, 0.4, 0.05); };
    audio.click = function () { noiseHit(1800, 3, 0.1, 0.05, 0.002); };
    audio.whisper = function () { if (!A) return; var t = A.ctx.currentTime, n = A.ctx.createBufferSource(); n.buffer = A.nbuf; var bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5; bp.frequency.setValueAtTime(1400, t); bp.frequency.linearRampToValueAtTime(2200, t + 0.6); bp.frequency.linearRampToValueAtTime(1500, t + 1.4); n.connect(bp); bp.connect(envG(t, 0.07, 1.8, 0.5)); n.start(t); n.stop(t + 2); };
    audio.gong = function () { if (!A) return; var t = A.ctx.currentTime; [[1, 0.16], [2.4, 0.09], [4.1, 0.05]].forEach(function (p) { var o = A.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 196 * p[0]; o.connect(envG(t, p[1], 2.6, 0.004)); o.start(t); o.stop(t + 2.8); }); };
        audio.thud = function () { noiseHit(110, 0.8, 0.3, 0.4, 0.003, 'lowpass'); };
    var tm = { creak: 12, whisper: 50 }, T = 0, chTarget = chair.rotation.y, chWait = 35 + Math.random() * 25, fb = fallBook.userData;
    function audioTick(dt) { if (!A) return;
      tm.creak -= dt; if (tm.creak <= 0) { tm.creak = 14 + Math.random() * 22; audio.creak(); }
      tm.whisper -= dt; if (tm.whisper <= 0) { tm.whisper = 55 + Math.random() * 60; audio.whisper(); }
      A.drone.gain.value = 0.03 + audio.fear * 0.05; }
    function use(it) { if (!it) return; it.open = !it.open; }
    if (opt.renderer && THREE.PMREMGenerator) {
      var es = new THREE.Scene(); es.background = new THREE.Color(0x1b1d24);
      var eb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); eb.position.set(0, 3, 0); es.add(eb);
      var pm = new THREE.PMREMGenerator(opt.renderer); group.userData.env = pm.fromScene(es, 0.04).texture; pm.dispose();
    }
    interactives.forEach(function (it) { var v = !!it.open; Object.defineProperty(it, 'open', { get: function () { return v; }, set: function (x) { x = !!x; if (x !== v) { v = x; if (it.kind === 'slide') audio.slide(); else audio.creak(); } } }); });
    function byName(n) { for (var i = 0; i < interactives.length; i++) if (interactives[i].name === n) return interactives[i]; return null; }
    function update(dt) {
      T += dt;
      for (var i = 0; i < interactives.length; i++) {
        var it = interactives[i], goal = it.open ? 1 : 0; it.t += (goal - it.t) * Math.min(1, dt * 6);
        if (Math.abs(goal - it.t) < 0.001) it.t = goal; var e = it.t * it.t * (3 - 2 * it.t);
        if (it.kind === 'v') it.object.rotation.y = it.c + (it.target - it.c) * e; else if (it.kind === 'h') it.object.rotation.x = it.target * e; else it.object.position.z = it.base + it.target * e;
      }
      curt.forEach(function (c, k) { c.rotation.z = Math.sin(T * 0.5 + k) * 0.008; });
      var fz = group.userData.freeze;
      var v = 1 + Math.sin(T * 1.7) * 0.015; if (fz) v = 1; else if (Math.random() < 0.004) v = 0.4; lamp.intensity = 0.6 * v; mGreen.emissiveIntensity = 0.55 * v;
      candle.intensity = 0.1 + Math.random() * 0.05;
      if (!fz) {
        chWait -= dt; if (chWait <= 0) { chWait = 45 + Math.random() * 40; chTarget = chair.rotation.y + 1.2 + Math.random() * 1.4; audio.creak(); }
        var dr = chTarget - chair.rotation.y; if (Math.abs(dr) > 0.002) { chair.rotation.y += dr * Math.min(1, dt * 1.6); globe.rotation.y += dt * 0.3; }
        if (fb.st === 0) { fb.t += dt; if (fb.t > 50 + Math.random() * 40) { fb.st = 1; fb.t = 0; } }
        else if (fb.st === 1) { fb.t += dt; fallBook.position.z = fb.home.z + Math.min(0.2, fb.t * 0.15); fallBook.rotation.z = fb.t * 0.4; if (fb.t > 1.4) { fb.st = 2; fb.vy = 0; } }
        else if (fb.st === 2) { fb.vy -= 9.8 * dt; fallBook.position.y += fb.vy * dt; fallBook.rotation.z += dt * 3; if (fallBook.position.y < 0.05) { fallBook.position.y = 0.05; fallBook.rotation.z = Math.PI / 2; fb.st = 3; fb.t = 0; audio.thud(); audio.setFear(0.5); } }
        else { fb.t += dt; if (fb.t > 4) audio.setFear(0.1); if (fb.t > 30) { fb.st = 0; fb.t = 0; fallBook.position.copy(fb.home); fallBook.rotation.set(0, 0, 0); } }
      }
      audioTick(dt);
    }
    function pick(ray, maxDist) {
      var meshes = interactives.map(function (i) { return i.mesh; }), hits = ray.intersectObjects(meshes, false);
      if (!hits.length || hits[0].distance > (maxDist || 2.6)) return null;
      for (var i = 0; i < interactives.length; i++) if (interactives[i].mesh === hits[0].object) return interactives[i];
      return null;
    }
    group.traverse(function (o) { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && group.userData.env) o.material.envMap = group.userData.env; });
    return {
      group: group, interactives: interactives, colliders: colliders, update: update, pick: pick, audio: audio, enableAudio: audio.start, use: use,
      toggle: function (n) { var it = byName(n); if (it) use(it); return it; }, open: function (n) { var it = byName(n); if (it) it.open = true; }, close: function (n) { var it = byName(n); if (it) it.open = false; },
      setCamera: function (x, z) { group.userData.camX = x; group.userData.camZ = z; }, debug: function (freeze) { group.userData.freeze = freeze; },
      bounds: { minX: -W / 2 + 0.25, maxX: W / 2 - 0.25, minZ: -D / 2 + 0.25, maxZ: D / 2 + 0.6, height: H },
      spawn: { x: -1.6, z: 1.8, yaw: 0.2 }, exitDoor: { x: -dc, z: D / 2 }, size: { w: W, d: D, h: H }, progress: progress, license: 'Textures: Poly Haven, CC0', version: '0.1'
    };
  }
  root.LibraryModule = { build: build, version: '0.1' };
})(typeof window !== 'undefined' ? window : this);
