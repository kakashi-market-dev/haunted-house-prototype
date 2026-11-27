/* livingroom.js  -  standalone horror living room module (own scene, own code, no dependency on any other game file).  v0.1
 * Needs only three.js r128 (global THREE). Living room: old TV that turns on by itself, grandfather clock, fireplace embers, sofa, bookshelf, sideboard.
 *
 *   var B = LivingRoomModule.build(THREE, { quality: '1k' | '2k' (default) | '4k', floorTexSize, wallTexSize, renderer, onProgress: fn(done,total), onScare: fn() });
 *   scene.add(B.group);  B.update(dt);                 // every frame
 *   B.use(interactive)           // what a tap / E press does: opens doors and drawers, switches the TV
 *   B.interactives, B.pick(raycaster, maxDist), B.colliders, B.bounds, B.spawn {x,z,yaw}, B.setCamera(x,z)
 *   B.audio.start()              // from a user gesture; procedural sound, no files: room tone, clock, heartbeat (when scared), creaks, whispers, bell, footsteps
 * Option figures: true -> dolls, wall portraits, flicker figure and visitor are built (default false: none of them).
 * Floor: checkerboard, square size opt.checkerSize (metres, default 0.5).
 * Textures: Poly Haven (CC0): damaged_plaster (upper walls, ceiling), dark_wood (floor, wainscot).  Everything else is generated in code.
 */
(function (root) {
  'use strict';
  var PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/';
  var W = 7.0, D = 5.5, H = 2.8, WH = 1.0; // room: width x, depth z, height; WH = wainscot height
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
    var FIG = opt.figures === true;   // human-like figures (dolls, portraits, flicker figure, visitor) are OFF unless { figures: true }
    var q = opt.quality || '2k'; if (opt.floorTexSize) TEX.floor.size = opt.floorTexSize; if (opt.wallTexSize) TEX.wall.size = opt.wallTexSize; 
    var maxAniso = opt.renderer ? opt.renderer.capabilities.getMaxAnisotropy() : 4;
    var group = new THREE.Group(); group.name = 'livingroom';
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

    var curt = [];
    // ---------- materials ----------
    // checkerboard floor: dirty off-white / near-black cyan, flat colours, one square = opt.checkerSize metres (default 0.5)
    function checkerMat(surfW, surfH) {
      var S = opt.checkerSize || 0.5, c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
      g.fillStyle = '#aaa598'; g.fillRect(0, 0, 512, 512); g.fillStyle = '#07222b'; g.fillRect(256, 0, 256, 256); g.fillRect(0, 256, 256, 256);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(surfW / (2 * S), surfH / (2 * S)); t.anisotropy = Math.min(16, maxAniso); t.encoding = THREE.sRGBEncoding; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0, envMapIntensity: 0.1 });
    }
    var mFloor = checkerMat(1, 1), mPlaster = pbr(TEX.wall, 1, 1, 0x8d887e), mWain = pbr(TEX.wain, 1, 1, 0x3a2c22), mCeil = pbr(TEX.ceil, 1, 1, 0x55524c), mWood = pbr(TEX.wood, 1, 1, 0x4a3020);
    var mDoorM = std(aged(81, '#3a2c22', { rust: 0, dark: 1.3 }), { rough: 0.8 });
    function fabric(seed, base) { return std(aged(seed, base, { rust: 0, dark: 1.2 }), { rough: 0.95 }); }
    var mSofa = fabric(201, '#5a4034'), mCush = fabric(203, '#6a4a3a'), mArm = fabric(205, '#3e4a40'), mRug = fabric(111, '#4a2a2a'), mCurt = fabric(121, '#4a2e30'), mDark = new THREE.MeshStandardMaterial({ color: 0x120e0c, roughness: 0.95 });
    var mBrass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.32, metalness: 0.9, envMapIntensity: 1.0, side: THREE.DoubleSide });
    var mStone = std(aged(207, '#6a645a', { rust: 0, dark: 1.6 }), { rough: 0.9 });
    function planeG(g, w, h, mat, x, y, z, rx, ry) { var geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; (g || group).add(m); return m; }
    function wallGroup(x, z, ry) { var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; group.add(g); return g; } // local +z points into the room
    // wall of length len in group g (local x from -len/2 to len/2), optional door gap {c, w, h}
    function wallBuild(g, len, gap) {
      function seg(x0, x1) { if (x1 - x0 < 0.01) return; var c = (x0 + x1) / 2, w = x1 - x0; planeG(g, w, WH, mWain, c, WH / 2, 0); planeG(g, w, H - WH, mPlaster, c, WH + (H - WH) / 2, 0); }
      if (!gap) { seg(-len / 2, len / 2); return; }
      seg(-len / 2, gap.c - gap.w / 2); seg(gap.c + gap.w / 2, len / 2); planeG(g, gap.w, H - gap.h, mPlaster, gap.c, gap.h + (H - gap.h) / 2, 0);
      box(0.08, gap.h, 0.12, mTrim, gap.c - gap.w / 2 - 0.04, gap.h / 2, 0.02, g); box(0.08, gap.h, 0.12, mTrim, gap.c + gap.w / 2 + 0.04, gap.h / 2, 0.02, g); box(gap.w + 0.16, 0.08, 0.12, mTrim, gap.c, gap.h + 0.04, 0.02, g);
    }
    planeG(group, W, D, mFloor, 0, 0, 0, -Math.PI / 2, 0); planeG(group, W, D, mCeil, 0, H, 0, Math.PI / 2, 0);
    var wB = wallGroup(0, -D / 2, 0), wL = wallGroup(-W / 2, 0, Math.PI / 2), wR = wallGroup(W / 2, 0, -Math.PI / 2), wF = wallGroup(0, D / 2, Math.PI);
    var dh = 2.05, dx = -2.4;
    wallBuild(wB, W); wallBuild(wL, D); wallBuild(wR, D, { c: 1.6, w: 0.9, h: dh }); wallBuild(wF, W, { c: -dx, w: 0.9, h: dh });
    [wB, wL, wR, wF].forEach(function (g, i) { box(i % 2 ? D : W, 0.05, 0.03, mTrim, 0, WH, 0.015, g, false); });
    door('door', 'الباب', 0.88, dh, 0.045, mDoorM, -dx + 0.44, dh / 2, 0.02, 'right', 'v', wF, 'bar-v', { ajar: 0.0 });
    door('door2', 'باب الممر', 0.88, dh, 0.045, mDoorM, 1.6 + 0.44, dh / 2, 0.02, 'right', 'v', wR, 'bar-v', { ajar: 0.12 });
    box(1.0, 2.2, 0.05, mBlack, 1.6, 1.1, -0.2, wR, false); // dark hallway behind the ajar door
    var bz = -D / 2;
    function doll(x, y, z, ry, tilt, parent) { if (!FIG) return new THREE.Group(); var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; (parent || group).add(g); var mD = std(aged(71, '#c9b9a2', { rust: 0, dark: 1.4 }), { rough: 0.8 }), mDr = fabric(73, '#5a4a52');
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.2, 10), mDr); body.position.y = 0.1; g.add(body);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 12), mD); head.position.y = 0.26; head.rotation.z = tilt; g.add(head);
      [-0.022, 0.022].forEach(function (ex) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mDark); e.position.set(ex, 0.012, 0.052); head.add(e); }); return g; }
    function pic(par, x, y, w, h, seed, rot, z) { var t = canvasTex(96, 128, function (c, ww, hh) { var r = rnd(seed); c.fillStyle = '#8a7e62'; c.fillRect(0, 0, ww, hh); for (var i = 0; i < 30; i++) { c.fillStyle = 'rgba(' + (30 + r() * 40 | 0) + ',' + (25 + r() * 30 | 0) + ',20,0.35)'; c.fillRect(r() * ww, r() * hh, 10 + r() * 30, 8 + r() * 25); } if (FIG) { c.fillStyle = 'rgba(25,18,12,0.75)'; c.beginPath(); c.arc(48, 52, 17, 0, 6.283); c.fill(); c.fillRect(31, 66, 34, 60); } }); var f = box(w + 0.06, h + 0.06, 0.03, mTrim, x, y, z, par, false); f.rotation.z = rot; var p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })); p.position.set(0, 0, 0.017); f.add(p); return f; }

    // ---------- sofa and armchair (front = local +z) ----------
    function seat(x, z, ry, w, mat, name) {
      var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; group.add(g); var d = 0.9;
      box(w, 0.28, d, mat, 0, 0.26, 0, g); box(w, 0.5, 0.2, mat, 0, 0.6, -d / 2 + 0.1, g); [-1, 1].forEach(function (s) { box(0.18, 0.32, d, mat, s * (w / 2 - 0.09), 0.5, 0, g); box(0.06, 0.12, 0.06, mWood, s * (w / 2 - 0.1), 0.06, d / 2 - 0.1, g); box(0.06, 0.12, 0.06, mWood, s * (w / 2 - 0.1), 0.06, -d / 2 + 0.1, g); });
      var n = Math.max(1, Math.round((w - 0.36) / 0.62)), cw = (w - 0.36) / n; for (var i = 0; i < n; i++) { var c = box(cw - 0.02, 0.14, d - 0.25, mCush, -((w - 0.36) / 2) + cw * (i + 0.5), 0.47, 0.1, g); c.rotation.z = (i - 1) * 0.02; c.rotation.x = i === 1 ? 0.06 : 0; }
      var tr = Math.abs(Math.sin(ry)) > 0.5; solid(x - (tr ? d : w) / 2 - 0.05, x + (tr ? d : w) / 2 + 0.05, z - (tr ? w : d) / 2 - 0.05, z + (tr ? w : d) / 2 + 0.05); return g;
    }
    var sofa = seat(0.7, -0.3, Math.PI / 2, 2.0, mSofa); doll(0.1, 0.55, 0.45, 0.6, 0.4, sofa); var blk = box(0.8, 0.04, 0.5, mCurt, -0.5, 0.6, 0.15, sofa, false); blk.rotation.set(0.2, 0.3, 0.1);
    seat(-1.2, -1.5, Math.PI / 2 + 0.7, 0.95, mArm);
    // ---------- rug, coffee table with a candle and an old photo ----------
    var rug = box(3.0, 0.012, 2.2, mRug, 1.6, 0.008, -0.3, null, false); rug.rotation.y = 0.05;
    box(1.1, 0.05, 0.6, mWood, 1.9, 0.43, -0.3); [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]].forEach(function (p) { box(0.06, 0.4, 0.06, mWood, 1.9 + p[0], 0.2, -0.3 + p[1]); }); solid(1.3, 2.5, -0.65, 0.05);
    cyl(0.03, 0.03, 0.12, mPaper, 2.1, 0.52, -0.2, null, 10); var cf = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffb050 })); cf.scale.y = 1.6; cf.position.set(2.1, 0.6, -0.2); group.add(cf); group.userData.flame = cf;
    box(0.16, 0.01, 0.12, mPaper, 1.7, 0.462, -0.35, null, false).rotation.y = 0.5; cyl(0.04, 0.035, 0.09, mJar, 1.8, 0.5, -0.1, null, 10);
    // ---------- TV on a stand against the right wall (screen shows static when on) ----------
    var tvIt, tvScreenMat, tvCtx, tvTex, tvLight;
    (function () {
      var g = wallGroup(W / 2, -0.3, -Math.PI / 2); carcass(g, 1.1, 0.5, 0.5, mCarc, 0, 0.27, 0.25); box(1.16, 0.03, 0.54, mWood, 0, 0.535, 0.26, g);
      door('tvDoor', 'باب حامل التلفاز', 0.52, 0.44, 0.02, mDoorM, -0.55, 0.27, 0.5, 'left', 'v', g, 'knob-top'); door('tvDoor2', 'باب حامل التلفاز', 0.52, 0.44, 0.02, mDoorM, 0.55, 0.27, 0.5, 'right', 'v', g, 'knob-top');
      boxItem(g, -0.3, 0.03, 0.2, 0.3, 0.05, 0.22, 2); boxItem(g, -0.28, 0.08, 0.2, 0.25, 0.05, 0.2, 4); boxItem(g, 0.3, 0.03, 0.2, 0.2, 0.18, 0.2, 1);
      var mTv = new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 0.9, metalness: 0 }); var tv = new THREE.Group(); tv.position.set(0, 0.55, 0.26); g.add(tv); box(0.72, 0.56, 0.5, mTv, 0, 0.28, -0.02, tv); box(0.5, 0.4, 0.16, mTv, 0, 0.3, -0.34, tv); box(0.08, 0.04, 0.3, mTv, 0.1, 0.58, -0.05, tv).rotation.z = 0.5; box(0.08, 0.04, 0.3, mTv, 0.0, 0.58, -0.05, tv).rotation.z = -0.5;
      var cv = document.createElement('canvas'); cv.width = 96; cv.height = 72; tvCtx = cv.getContext('2d'); tvTex = new THREE.CanvasTexture(cv); tvTex.minFilter = tvTex.magFilter = THREE.NearestFilter;
      tvScreenMat = new THREE.MeshBasicMaterial({ map: tvTex, color: 0x0a0c0c }); var sc = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.42), tvScreenMat); sc.position.set(-0.04, 0.3, 0.235); tv.add(sc);
      tvLight = new THREE.PointLight(0x9ab8ff, 0, 5, 2); tvLight.position.set(0, 0.85, 0.6); g.add(tvLight);
      var hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.64, 0.3), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, 0.3, 0.2); tv.add(hit);
      tvIt = { name: 'tv', label: 'تشغيل / إيقاف التلفاز', object: hit, mesh: hit, open: false, t: 0, kind: 'tv', noPrefix: true, c: 0, target: 0 }; interactives.push(tvIt);
      solid(W / 2 - 0.65, W / 2, -0.3 - 0.62, -0.3 + 0.62);
    })();
    // ---------- fireplace with dying embers (back wall centre) ----------
    var ember = [], fireLight;
    (function () {
      var g = wB; box(0.3, 1.25, 0.4, mStone, -0.85, 0.625, 0.2, g); box(0.3, 1.25, 0.4, mStone, 0.85, 0.625, 0.2, g); box(2.0, 0.3, 0.4, mStone, 0, 1.15, 0.2, g); box(2.2, 0.06, 0.5, mWood, 0, 1.33, 0.25, g); box(1.4, 1.0, 0.04, new THREE.MeshBasicMaterial({ color: 0x070504 }), 0, 0.5, 0.03, g, false); box(1.4, 0.05, 0.35, mStone, 0, 0.025, 0.2, g);
      for (var i = 0; i < 9; i++) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.04 + (i % 3) * 0.012, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff5a14 })); e.scale.y = 0.6; e.position.set(-0.4 + i * 0.1, 0.07 + (i % 2) * 0.03, 0.12 + (i % 3) * 0.05); g.add(e); ember.push(e); }
      var lg = box(0.7, 0.07, 0.07, mWood, 0, 0.1, 0.12, g, false); lg.rotation.z = 0.1; box(0.5, 0.07, 0.07, mDark, 0.1, 0.17, 0.15, g, false);
      fireLight = new THREE.PointLight(0xff6a20, 0.55, 5, 2); fireLight.position.set(0, 0.35, 0.5); wB.add(fireLight);
      pic(g, 0, 1.95, 0.8, 1.0, 3, 0, 0.04); doll(-0.8, 1.36, 0.28, 0.2, -0.3, g); cyl(0.04, 0.04, 0.12, mJar, 0.7, 1.42, 0.3, g, 8); box(0.2, 0.14, 0.12, mCarc, 0.45, 1.43, 0.25, g, false);
      solid(-1.1, 1.1, bz, bz + 0.5);
    })();
    // ---------- grandfather clock (right of the fireplace) with a swinging pendulum behind a glass door ----------
    var pend;
    (function () {
      var g = wallGroup(2.7, bz, 0); box(0.5, 0.3, 0.32, mWood, 0, 0.15, 0.17, g); carcass(g, 0.42, 1.35, 0.3, mCarc, 0, 0.98, 0.17); box(0.5, 0.45, 0.34, mWood, 0, 1.88, 0.17, g); box(0.56, 0.06, 0.38, mWood, 0, 2.14, 0.17, g);
      var face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, function (c) { c.fillStyle = '#b8ae90'; c.fillRect(0, 0, 128, 128); c.strokeStyle = '#201810'; c.lineWidth = 4; for (var i = 0; i < 12; i++) { var a = i / 12 * 6.283; c.beginPath(); c.moveTo(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); c.lineTo(64 + Math.sin(a) * 58, 64 - Math.cos(a) * 58); c.stroke(); } c.lineWidth = 5; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 24); c.moveTo(64, 64); c.lineTo(92, 78); c.stroke(); }) })); face.position.set(0, 1.88, 0.347); g.add(face);
      pend = new THREE.Group(); pend.position.set(0, 1.55, 0.2); g.add(pend); box(0.012, 0.7, 0.012, mBrass, 0, -0.35, 0, pend, false); cyl(0.085, 0.085, 0.02, mBrass, 0, -0.72, 0, pend, 18).rotation.x = Math.PI / 2;
      [-0.1, 0.1].forEach(function (x, i) { box(0.006, 0.5, 0.006, mBrass, x, 1.3, 0.12, g, false); cyl(0.03, 0.03, 0.22 - i * 0.04, mBrass, x, 0.95 - i * 0.1, 0.12, g, 10); });
      var inL = new THREE.PointLight(0xffc070, 0.25, 1.6, 2); inL.position.set(0, 1.2, 0.3); g.add(inL);
      var mGl = new THREE.MeshStandardMaterial({ color: 0x2a3a30, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false });
      var cd = door('clockDoor', 'باب الساعة', 0.38, 1.25, 0.012, mGl, -0.19, 0.98, 0.34, 'left', 'v', g, 'knob-top'); var dm = cd.mesh;
      [[0, 0.615, 0.38, 0.03], [0, -0.615, 0.38, 0.03], [-0.175, 0, 0.03, 1.25], [0.175, 0, 0.03, 1.25]].forEach(function (f) { box(f[2], f[3], 0.02, mWood, f[0], f[1], 0, dm, false); });
      solid(2.4, 3.05, bz, bz + 0.5);
    })();
    // ---------- bookshelf with books (back wall, left) and a cabinet below ----------
    (function () {
      var g = wallGroup(-2.2, bz, 0), lg = carcass(g, 1.3, 2.1, 0.32, mCarc, 0, 1.08, 0.16), r = rnd(55); [-0.5, -0.05, 0.4, 0.8].forEach(function (y) { shelf(lg, 1.3, 0.32, y); });
      [-0.1, 0.35, 0.78].forEach(function (y, si) { var x = -0.58; while (x < 0.55) { var bw = 0.03 + r() * 0.04, bh = 0.2 + r() * 0.12, b = box(bw, bh, 0.2, canMats[Math.floor(r() * 8)], x + bw / 2, y + 0.008 + bh / 2, 0, lg, false); if (r() < 0.12) b.rotation.z = 0.25; x += bw + 0.004; if (r() < 0.07) x += 0.15; } });
      var x2 = -0.55; for (var k = 0; k < 6; k++) { box(0.2, 0.04, 0.18, canMats[k], x2 + 0.15, -0.97 + 0.02 + k * 0.04, 0.0, lg, false).rotation.y = k * 0.2; } doll(-0.35, 0.8 + 0.07, 0.0, 0.3, 0.2, lg);
      door('cabL', 'باب الخزانة', 0.64, 0.56, 0.02, mDoorM, -0.65, 0.3, 0.33, 'left', 'v', g, 'knob-top'); door('cabR', 'باب الخزانة', 0.64, 0.56, 0.02, mDoorM, 0.65, 0.3, 0.33, 'right', 'v', g, 'knob-top');
      solid(-2.9, -1.5, bz, bz + 0.4);
    })();
    // ---------- sideboard on the left wall with the lamp, drawers and dishes; window with curtains ----------
    var lampPos;
    (function () {
      var g = wallGroup(-W / 2, 1.3, Math.PI / 2), lg = carcass(g, 1.5, 0.82, 0.45, mCarc, 0, 0.42, 0.225); box(1.56, 0.04, 0.5, mWood, 0, 0.85, 0.24, g);
      drawer('sbD1', 'درج الخزانة', 0.7, 0.24, 0.38, mDoorM, -0.36, 0.7, 0.46, g, 'rags'); drawer('sbD2', 'درج الخزانة', 0.7, 0.24, 0.38, mDoorM, 0.36, 0.7, 0.46, g, null);
      stock(lg, 1.4, 0.4, [-0.38], 'plates'); door('sbL', 'باب الخزانة', 0.74, 0.4, 0.02, mDoorM, -0.75, 0.27, 0.47, 'left', 'v', g, 'knob-top'); door('sbR', 'باب الخزانة', 0.74, 0.4, 0.02, mDoorM, 0.75, 0.27, 0.47, 'right', 'v', g, 'knob-top');
      cyl(0.08, 0.1, 0.03, mBrass, 0.4, 0.88, 0.25, g, 14); cyl(0.015, 0.02, 0.28, mBrass, 0.4, 1.03, 0.25, g, 8);
      var sh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.22, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xe0c898, emissive: 0xb08040, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.9 })); sh.position.set(0.4, 1.2, 0.25); g.add(sh); lampPos = new THREE.Vector3(-W / 2 + 0.25, 1.2, 1.3 - 0.4);
      doll(-0.3, 0.87, 0.25, 0.5, 0.3, g); solid(-W / 2, -W / 2 + 0.55, 1.3 - 0.78, 1.3 + 0.78);
      var wg = wL; var wz = 0.5; var win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), new THREE.MeshBasicMaterial({ color: 0x0c1428 })); win.position.set(wz, 1.6, 0.012); wg.add(win);
      box(1.0, 0.05, 0.08, mTrim, wz, 2.2, 0.05, wg); box(1.0, 0.05, 0.1, mTrim, wz, 1.0, 0.06, wg); box(0.05, 1.2, 0.08, mTrim, wz - 0.48, 1.6, 0.05, wg); box(0.05, 1.2, 0.08, mTrim, wz + 0.48, 1.6, 0.05, wg); box(0.03, 1.15, 0.04, mTrim, wz, 1.6, 0.04, wg); box(0.9, 0.03, 0.04, mTrim, wz, 1.6, 0.04, wg);
      [-0.42, 0.42].forEach(function (x) { curt.push(box(0.38, 1.5, 0.05, mCurt, wz + x, 1.55, 0.14, wg, false)); });
      pic(wL, -1.3, 1.7, 0.4, 0.5, 9, 0.12, 0.03); pic(wF, 0.9, 1.6, 0.3, 0.4, 13, 0, 0.03); pic(wF, 1.5, 1.8, 0.3, 0.4, 14, 0.2, 0.03); pic(wR, -1.6, 1.7, 0.5, 0.35, 5, 0, 0.03);
    })();
    // ---------- decals: grime, damp stains, cobwebs ----------
    function decal(tex, w, h, par, x, y, z, op) { var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, opacity: op === undefined ? 1 : op, side: THREE.DoubleSide })); m.position.set(x, y, z); m.renderOrder = 2; par.add(m); return m; }
    var grime = canvasTex(1024, 256, function (g, w, h) { var r = rnd(7), gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(8,6,4,0.55)'); gr.addColorStop(0.4, 'rgba(14,10,6,0.25)'); gr.addColorStop(1, 'rgba(14,10,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (var i = 0; i < 60; i++) { var x = r() * w, y = h * (0.3 + r() * 0.6), rad = 10 + r() * 36, b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(10,8,5,' + (0.08 + r() * 0.14) + ')'); b.addColorStop(1, 'rgba(10,8,5,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } });
    [[wB, W], [wL, D], [wR, D], [wF, W]].forEach(function (p) { decal(p[0] === wF || p[0] === wR ? grime : grime, p[1] - 0.02, 0.7, p[0], 0, 1.35, 0.006); });
    var leak = canvasTex(256, 512, function (g, w, h) { var r = rnd(21); for (var k = 0; k < 3; k++) { var x = w * (0.25 + r() * 0.5), len = h * (0.5 + r() * 0.4), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(60,44,20,0.45)'); gr.addColorStop(1, 'rgba(60,44,20,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 4 - r() * 20, 0); g.lineTo(x + 4 + r() * 20, 0); g.lineTo(x + 3, len); g.lineTo(x - 3, len); g.fill(); } var b = g.createRadialGradient(w / 2, 20, 0, w / 2, 20, 90); b.addColorStop(0, 'rgba(50,36,14,0.5)'); b.addColorStop(1, 'rgba(50,36,14,0)'); g.fillStyle = b; g.fillRect(0, 0, w, 200); });
    decal(leak, 0.9, 1.1, wB, 2.9, H - 0.55, 0.007, 0.9); decal(leak, 0.8, 1.0, wL, -1.6, H - 0.5, 0.007, 0.85); decal(leak, 0.9, 1.1, wR, -1.0, H - 0.55, 0.007, 0.85);
    var web = canvasTex(256, 256, function (g) { g.strokeStyle = 'rgba(225,225,215,0.5)'; g.lineWidth = 1.2; for (var i = 0; i <= 6; i++) { var a = i / 6 * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); g.stroke(); } for (var r = 1; r <= 7; r++) { g.beginPath(); for (var k = 0; k <= 6; k++) { var a2 = k / 6 * Math.PI / 2, rr = r * 34 - (k % 2 ? 6 : 0), px = Math.cos(a2) * rr, py = Math.sin(a2) * rr; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); } });
    [[wB, -W / 2 + 0.45, 1], [wB, W / 2 - 0.45, -1], [wL, D / 2 - 0.4, 1], [wR, -D / 2 + 0.4, -1]].forEach(function (c) { var m = decal(web, 0.9, 0.9, c[0], c[1], H - 0.45, 0.012, 0.85); m.scale.x = c[2]; });

    // ---------- lights: warm lamp (shadows), fireplace glow, cold moonlight, TV glow, very low fill ----------
    var shMap = q === '1k' ? 512 : 1024;
    var lamp = new THREE.PointLight(0xffb870, 0.6, 10, 2); lamp.position.copy(lampPos); lamp.castShadow = true; lamp.shadow.mapSize.set(shMap, shMap); lamp.shadow.bias = -0.0008; group.add(lamp);
    var lampShadeMat = null; group.traverse(function (o) { if (o.isMesh && o.material && o.material.emissiveIntensity === 0.9) lampShadeMat = o.material; });
    var moon = new THREE.SpotLight(0x6a86c8, 0.9, 9, 0.7, 0.7, 1.5); moon.position.set(-W / 2 + 0.3, 2.3, -0.5); moon.target.position.set(-1.0, 0, -0.5); group.add(moon, moon.target);
    group.add(new THREE.HemisphereLight(0x4a5470, 0x1a120e, 0.14));
    var candle = new THREE.PointLight(0xffa850, 0.12, 2.6, 2); candle.position.set(2.1, 0.9, -0.2); group.add(candle);

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
      var tn = ctx.createBufferSource(), tf = ctx.createBiquadFilter(), tg = ctx.createGain(); tn.buffer = nb; tn.loop = true; tf.type = 'highpass'; tf.frequency.value = 2500; tg.gain.value = 0; tn.connect(tf); tf.connect(tg); tg.connect(master); tn.start();
      A = { ctx: ctx, master: master, nbuf: nb, drone: dg, tvGain: tg };
    };
    audio.setFear = function (f) { audio.fear = Math.max(0, Math.min(1, f)); };
    audio.creak = function () { if (!A) return; var t = A.ctx.currentTime, o = A.ctx.createOscillator(), bp = A.ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(150, t + 0.35); o.frequency.linearRampToValueAtTime(105, t + 0.8); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 4; o.connect(bp); bp.connect(envG(t, 0.07, 0.9, 0.08)); o.start(t); o.stop(t + 1); };
    audio.slide = function () { noiseHit(700, 1.2, 0.07, 0.4, 0.05); };
    audio.click = function () { noiseHit(1800, 3, 0.1, 0.05, 0.002); };
    audio.whisper = function () { if (!A) return; var t = A.ctx.currentTime, n = A.ctx.createBufferSource(); n.buffer = A.nbuf; var bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5; bp.frequency.setValueAtTime(1400, t); bp.frequency.linearRampToValueAtTime(2200, t + 0.6); bp.frequency.linearRampToValueAtTime(1500, t + 1.4); n.connect(bp); bp.connect(envG(t, 0.07, 1.8, 0.5)); n.start(t); n.stop(t + 2); };
    audio.gong = function () { if (!A) return; var t = A.ctx.currentTime; [[1, 0.16], [2.4, 0.09], [4.1, 0.05]].forEach(function (p) { var o = A.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 196 * p[0]; o.connect(envG(t, p[1], 2.6, 0.004)); o.start(t); o.stop(t + 2.8); }); };
    function audioTick(dt) { if (!A) return;
      tm.tick -= dt; if (tm.tick <= 0) { tm.tick = 1; tm.flip = !tm.flip; noiseHit(tm.flip ? 1500 : 1200, 6, 0.04, 0.05, 0.002); }
      tm.creak -= dt; if (tm.creak <= 0) { tm.creak = 14 + Math.random() * 22; audio.creak(); }
      tm.whisper -= dt; if (tm.whisper <= 0) { tm.whisper = 55 + Math.random() * 60; audio.whisper(); }
      tm.chime -= dt; if (tm.chime <= 0 && tm.strikes === 0) { tm.chime = 70 + Math.random() * 60; tm.strikes = 3; tm.strikeT = 0; }
      if (tm.strikes > 0) { tm.strikeT -= dt; if (tm.strikeT <= 0) { audio.gong(); tm.strikes--; tm.strikeT = 2.2; } }
      A.tvGain.gain.value = tvOn ? 0.05 * (tvFlash > 0 ? 0.3 : 1) : 0; A.drone.gain.value = 0.03 + audio.fear * 0.05; }

    // ---------- TV: static, with a dark figure that flickers in and out when it turns itself on ----------
    var tvOn = false, tvFlash = 0, tvAuto = 35 + Math.random() * 20, tvAutoLeft = 0, tvAcc = 0, T = 0, burst = 0, dipGap = 12, dip = 0, fdark = 0;
    function tvDraw() {
      var w = 96, h = 72, id = tvCtx.createImageData(w, h), d = id.data, fig = FIG && tvOn && (T % 7 > 5.2 || tvAutoLeft > 0 && T % 3 > 1.6), v;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { v = 60 + Math.random() * 150; if (fig) { var dxp = x - 48, inb = (Math.abs(dxp) < 9 && y > 26 && y < 68) || (dxp * dxp + (y - 20) * (y - 20) < 70); if (inb) v = 8; } var i = (y * w + x) * 4; d[i] = v; d[i + 1] = v; d[i + 2] = v * 1.05; d[i + 3] = 255; }
      tvCtx.putImageData(id, 0, 0); tvTex.needsUpdate = true;
    }
    function setTV(on) { if (on === tvOn) return; tvOn = on; audio.click(); tvScreenMat.color.setHex(on ? 0xffffff : 0x0a0c0c); if (!on) { tvLight.intensity = 0; tvScreenMat.map = null; tvScreenMat.needsUpdate = true; } else { tvScreenMat.map = tvTex; tvScreenMat.needsUpdate = true; audio.setFear(0.4); } if (!on) audio.setFear(0.1); }
    // ---------- use / API ----------
    function use(it) { if (!it) return; if (it.kind === 'tv') { tvAutoLeft = 0; setTV(!tvOn); return; } it.open = !it.open; }
    if (opt.renderer && THREE.PMREMGenerator) {
      var es = new THREE.Scene(); es.background = new THREE.Color(0x1b1d24);
      var eb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); eb.position.set(0, 3, 0); es.add(eb);
      var pm = new THREE.PMREMGenerator(opt.renderer); group.userData.env = pm.fromScene(es, 0.04).texture; pm.dispose();
    }
    interactives.forEach(function (it) { if (it.kind === 'tv') return; var v = !!it.open; Object.defineProperty(it, 'open', { get: function () { return v; }, set: function (x) { x = !!x; if (x !== v) { v = x; if (it.kind === 'slide') audio.slide(); else audio.creak(); } } }); });
    function byName(n) { for (var i = 0; i < interactives.length; i++) if (interactives[i].name === n) return interactives[i]; return null; }
    function update(dt) {
      T += dt;
      for (var i = 0; i < interactives.length; i++) {
        var it = interactives[i]; if (it.kind === 'tv') continue; var goal = it.open ? 1 : 0; it.t += (goal - it.t) * Math.min(1, dt * 6);
        if (Math.abs(goal - it.t) < 0.001) it.t = goal; var e = it.t * it.t * (3 - 2 * it.t);
        if (it.kind === 'v') it.object.rotation.y = it.c + (it.target - it.c) * e; else if (it.kind === 'h') it.object.rotation.x = it.target * e; else it.object.position.z = it.base + it.target * e;
      }
      pend.rotation.z = Math.sin(T * 3.1) * 0.22; curt.forEach(function (c, k) { c.rotation.z = Math.sin(T * 0.5 + k) * 0.008; });
      var fl = group.userData.flame; if (fl) fl.scale.y = 1.5 + Math.sin(T * 11) * 0.25 + Math.random() * 0.2;
      var fv = 0.8 + Math.sin(T * 7) * 0.12 + Math.random() * 0.15; fireLight.intensity = 0.5 * fv; ember.forEach(function (m, k) { m.material.color.setRGB(1, 0.25 + 0.2 * Math.sin(T * 2 + k), 0.05); });
      var v = 1 + Math.sin(T * 1.7) * 0.015; dipGap -= dt; if (dip > 0) { dip -= dt; v = Math.random() < 0.5 ? 0.35 : 0.8; } else if (dipGap <= 0 && !group.userData.freeze) { dip = 0.15 + Math.random() * 0.3; dipGap = 10 + Math.random() * 18; }
      if (group.userData.freeze) v = 1; lamp.intensity = 0.6 * v; if (lampShadeMat) lampShadeMat.emissiveIntensity = 0.9 * v;
      // the TV switches itself on now and then, runs about 12 s, then off
      if (!group.userData.freeze) { if (!tvOn) { tvAuto -= dt; if (tvAuto <= 0) { tvAuto = 70 + Math.random() * 60; tvAutoLeft = 12; setTV(true); } } else if (tvAutoLeft > 0) { tvAutoLeft -= dt; if (tvAutoLeft <= 0) setTV(false); } }
      if (tvOn) { tvAcc += dt; if (tvAcc > 0.07) { tvAcc = 0; tvDraw(); } tvLight.intensity = 0.55 * (0.7 + Math.random() * 0.5); tvFlash = Math.random() < 0.05 ? 0.1 : tvFlash - dt; }
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
      setCamera: function (x, z) { group.userData.camX = x; group.userData.camZ = z; }, debug: function (freeze, tv) { group.userData.freeze = freeze; if (tv) { tvAutoLeft = 9999; setTV(true); T = 5.5; } },
      bounds: { minX: -W / 2 + 0.25, maxX: W / 2 - 0.25, minZ: -D / 2 + 0.25, maxZ: D / 2 + 0.6, height: H },
      spawn: { x: -2.4, z: 1.9, yaw: 0.35 }, exitDoor: { x: dx, z: D / 2 }, size: { w: W, d: D, h: H }, progress: progress, license: 'Textures: Poly Haven, CC0', version: '0.1'
    };
  }
  root.LivingRoomModule = { build: build, version: '0.1' };
})(typeof window !== 'undefined' ? window : this);
