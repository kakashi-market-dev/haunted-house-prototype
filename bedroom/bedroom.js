/* bedroom.js  -  standalone horror bedroom module (own scene, own code, no dependency on any other game file).  v0.1
 * Needs only three.js r128 (global THREE). The room where the player wakes up: hide under the bed, ring the bell on the table.
 *
 *   var B = BedroomModule.build(THREE, { quality: '1k' | '2k' (default) | '4k', floorTexSize, wallTexSize, renderer, onProgress: fn(done,total), onScare: fn() });
 *   scene.add(B.group);  B.update(dt);                 // every frame
 *   B.use(interactive)           // what a tap / E press does: opens doors and drawers, rings the bell, enters the hiding spot; with no argument it leaves the hiding spot
 *   B.hiding  (bool)  B.hideSpot {x,y,z,yaw}  B.exitSpot {x,z}      // while hiding the host places the camera at hideSpot and blocks walking
 *   B.interactives, B.pick(raycaster, maxDist), B.colliders, B.bounds, B.spawn {x,z,yaw}, B.bedSpot {x,y,z} (where the player lies when waking up), B.setCamera(x,z)
 *   B.audio.start()              // from a user gesture; procedural sound, no files: room tone, clock, heartbeat (when scared), creaks, whispers, bell, footsteps
 * Option figures: true -> dolls, wall portraits, flicker figure and visitor are built (default false: none of them).
 * Floor: checkerboard, square size opt.checkerSize (metres, default 0.5).
 * Textures: Poly Haven (CC0): damaged_plaster (upper walls, ceiling), dark_wood (floor, wainscot).  Everything else is generated in code.
 */
(function (root) {
  'use strict';
  var PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/';
  var W = 5.5, D = 4.5, H = 2.7, WH = 1.0; // room: width x, depth z, height; WH = wainscot height
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
    var group = new THREE.Group(); group.name = 'bedroom';
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

    // ---------- shared materials ----------
    // checkerboard floor: dirty off-white / near-black cyan, flat colours, one square = opt.checkerSize metres (default 0.5)
    function checkerMat(surfW, surfH) {
      var S = opt.checkerSize || 0.5, c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
      g.fillStyle = '#aaa598'; g.fillRect(0, 0, 512, 512); g.fillStyle = '#07222b'; g.fillRect(256, 0, 256, 256); g.fillRect(0, 256, 256, 256);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(surfW / (2 * S), surfH / (2 * S)); t.anisotropy = Math.min(16, maxAniso); t.encoding = THREE.sRGBEncoding; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0, envMapIntensity: 0.1 });
    }
    var mFloor = checkerMat(1, 1), mPlaster = pbr(TEX.wall, 1, 1, 0x8d887e), mWain = pbr(TEX.wain, 1, 1, 0x3a2c22), mCeil = pbr(TEX.ceil, 1, 1, 0x55524c);
    var mWood = pbr(TEX.wood, 1, 1, 0x4a3020), mWoodDoor = mWood;
    var mDoorM = std(aged(81, '#3a2c22', { rust: 0, dark: 1.3 }), { rough: 0.8 });
    function plane(w, h, mat, x, y, z, rx, ry) { var g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); var m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; group.add(m); return m; }
    function wallGroup(x, z, ry) { var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; group.add(g); return g; } // local +z points into the room
    function fabric(seed, base, o) { return std(aged(seed, base, o || { rust: 0, dark: 1.2 }), { rough: 0.95 }); }
    var mBlanket = fabric(101, '#5a3a3a'), mMatt = fabric(103, '#b8ae98'), mPillow = fabric(105, '#c4bca8'), mCoat = fabric(107, '#4a3a32'), mCoat2 = fabric(109, '#5a3a44'), mRug = fabric(111, '#5a2c2a');
    var mDark = new THREE.MeshStandardMaterial({ color: 0x120e0c, roughness: 0.95 });
    var mBrass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.32, metalness: 0.9, envMapIntensity: 1.0, side: THREE.DoubleSide });

    // ---------- shell ----------
    plane(W, D, mFloor, 0, 0, 0, -Math.PI / 2, 0); plane(W, D, mCeil, 0, H, 0, Math.PI / 2, 0);
    function wallPair(len, cx, cz, ry) { plane(len, WH, mWain, cx, WH / 2, cz, 0, ry); plane(len, H - WH, mPlaster, cx, WH + (H - WH) / 2, cz, 0, ry); }
    wallPair(W, 0, -D / 2, 0); wallPair(D, -W / 2, 0, Math.PI / 2); wallPair(D, W / 2, 0, -Math.PI / 2);
    var dx = 1.7, dw = 0.9, dh = 2.05;
    (function () { var l = (dx - dw / 2) + W / 2, r = W / 2 - (dx + dw / 2);
      wallPair(l, -W / 2 + l / 2, D / 2, Math.PI); wallPair(r, W / 2 - r / 2, D / 2, Math.PI); plane(dw, H - dh, mPlaster, dx, dh + (H - dh) / 2, D / 2, 0, Math.PI);
      box(0.08, dh, 0.12, mTrim, dx - dw / 2 - 0.04, dh / 2, D / 2 - 0.02); box(0.08, dh, 0.12, mTrim, dx + dw / 2 + 0.04, dh / 2, D / 2 - 0.02); box(dw + 0.16, 0.08, 0.12, mTrim, dx, dh + 0.04, D / 2 - 0.02);
    })();
    [[W, 0, -D / 2 + 0.012, 0], [D, -W / 2 + 0.012, 0, Math.PI / 2], [D, W / 2 - 0.012, 0, Math.PI / 2]].forEach(function (s) { var c = box(s[0], 0.05, 0.03, mTrim, s[1], WH, s[2], null, false); c.rotation.y = s[3]; });
    door('door', 'الباب', dw - 0.02, dh, 0.045, mDoorM, dx + dw / 2, dh / 2, D / 2 - 0.02, 'right', 'v', null, 'bar-v', { rev: true, ajar: 0.1 });
    var bz = -D / 2, lz = -W / 2, rz = W / 2;
    function doll(x, y, z, ry, tilt, parent) { if (!FIG) return new THREE.Group(); var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; (parent || group).add(g); var mD = std(aged(71, '#c9b9a2', { rust: 0, dark: 1.4 }), { rough: 0.8 }), mDr = fabric(73, '#5a4a52');
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.2, 10), mDr); body.position.y = 0.1; g.add(body);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 12), mD); head.position.y = 0.26; head.rotation.z = tilt; g.add(head);
      [-0.022, 0.022].forEach(function (ex) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mDark); e.position.set(ex, 0.012, 0.052); head.add(e); });
      [-1, 1].forEach(function (sd) { var a = box(0.02, 0.12, 0.02, mD, sd * 0.07, 0.12, 0.02, g, false); a.rotation.z = sd * 0.5; }); return g; }

    // ---------- the bed (headboard on the back wall); you can hide underneath ----------
    var bx = -1.3, bw = 1.15, bl = 2.0, railY = 0.34;
    var bedHit;
    (function () {
      var bm = mWood;
      box(bw + 0.1, 1.0, 0.08, bm, bx, 0.75, bz + 0.04); [-1, 1].forEach(function (s) { box(0.08, 1.1, 0.08, bm, bx + s * (bw / 2 + 0.03), 0.55, bz + 0.04); box(0.07, 0.07, 0.07, bm, bx + s * (bw / 2 + 0.03), 0.52, bz + bl - 0.04); box(0.05, 0.4, 0.05, bm, bx + s * (bw / 2 + 0.03), 0.2, bz + bl - 0.04); box(0.05, 0.4, 0.05, bm, bx + s * (bw / 2 + 0.03), 0.2, bz + 0.12); box(0.06, 0.12, bl - 0.1, bm, bx + s * (bw / 2 + 0.03), railY, bz + bl / 2 + 0.04); });
      box(bw, 0.2, bl - 0.1, mMatt, bx, 0.5, bz + bl / 2 + 0.04);
      var bk = box(bw + 0.03, 0.06, 1.25, mBlanket, bx, 0.62, bz + bl - 0.65); bk.rotation.z = 0.02; box(0.03, 0.26, 1.0, mBlanket, bx + bw / 2 + 0.015, 0.5, bz + bl - 0.7);
      var pw = box(0.58, 0.13, 0.36, mPillow, bx, 0.7, bz + 0.38); pw.rotation.y = 0.06; box(0.58, 0.04, 0.36, mPillow, bx + 0.02, 0.62, bz + 0.38);
      doll(bx + 0.3, 0.62, bz + 1.1, 2.3, -0.5); // old doll on the blanket
      // under the bed: a shoe, a box, a doll arm, dust
      box(0.28, 0.17, 0.2, mPaper, bx + 0.2, 0.09, bz + 0.5, null, false).rotation.y = 0.4; box(0.12, 0.06, 0.28, mDark, bx - 0.3, 0.03, bz + 0.8, null, false); box(0.1, 0.05, 0.22, mDark, bx - 0.15, 0.025, bz + 0.7, null, false).rotation.y = 0.5;
      var dm = std(aged(113, '#2a2420', { rust: 0, dark: 2 }), { rough: 1 }); [[0.0, 0.9], [-0.2, 1.4], [0.3, 1.2]].forEach(function (p) { var d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), dm); d.scale.set(1, 0.3, 1); d.position.set(bx + p[0], 0.015, bz + p[1]); group.add(d); });
      solid(bx - bw / 2 - 0.1, bx + bw / 2 + 0.1, bz, bz + bl);
      bedHit = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.2, 0.7, bl), new THREE.MeshBasicMaterial({ visible: false })); bedHit.position.set(bx, 0.4, bz + bl / 2); group.add(bedHit);
    })();
    var hideSpot = { x: bx, y: 0.2, z: bz + 0.95, yaw: Math.PI }, exitSpot = { x: bx + bw / 2 + 0.55, z: bz + 1.3 }, bedSpot = { x: bx, y: 0.85, z: bz + 1.0 };
    var hideIt = { name: 'hide', label: 'الاختباء تحت السرير', object: bedHit, mesh: bedHit, open: false, t: 0, kind: 'hide', noPrefix: true, c: 0, target: 0 }; interactives.push(hideIt);

    // ---------- nightstand with the lamp (the room's main light) and a clock ----------
    var nsx = -0.35, lampPos;
    (function () {
      var g = wallGroup(nsx, bz, 0); carcass(g, 0.46, 0.55, 0.4, mCarc, 0, 0.3, 0.2); box(0.5, 0.03, 0.44, mWood, 0, 0.585, 0.21, g); box(0.46, 0.04, 0.36, mBlack, 0, 0.02, 0.2, g, false);
      drawer('nsDrawer', 'درج الطاولة الجانبية', 0.44, 0.22, 0.34, mDoorM, 0, 0.4, 0.41, g, 'rags'); door('nsDoor', 'باب الطاولة الجانبية', 0.44, 0.2, 0.02, mDoorM, -0.22, 0.17, 0.41, 'left', 'v', g, 'knob-top');
      solid(nsx - 0.25, nsx + 0.25, bz, bz + 0.45);
      cyl(0.07, 0.09, 0.03, mBrass, 0, 0.615, 0.2, g, 14); cyl(0.015, 0.02, 0.25, mBrass, 0, 0.74, 0.2, g, 8);
      var sh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.2, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xe0c898, emissive: 0xb08040, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.9 })); sh.position.set(0, 0.92, 0.2); g.add(sh);
      var ck = box(0.14, 0.1, 0.06, mDark, 0.17, 0.665, 0.12, g, false); var face = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), new THREE.MeshBasicMaterial({ map: canvasTex(64, 64, function (c, w, h) { c.fillStyle = '#c8bfa0'; c.fillRect(0, 0, 64, 64); c.strokeStyle = '#201810'; c.lineWidth = 3; c.beginPath(); c.moveTo(32, 32); c.lineTo(32, 10); c.moveTo(32, 32); c.lineTo(48, 38); c.stroke(); }) })); face.position.set(0.17, 0.665, 0.152); g.add(face);
      var gl = cyl(0.03, 0.025, 0.09, mJar, -0.14, 0.645, 0.3, g, 10); lampPos = new THREE.Vector3(nsx, 0.92 + 0.0, bz + 0.2);
    })();
    // ---------- the table with the bell, a music box, a candle ----------
    var bellIt, bellG, tbx = 2.4, tbz = -1.0;
    (function () {
      box(0.62, 0.05, 1.1, mWood, tbx, 0.75, tbz); [[-0.25, -0.48], [0.25, -0.48], [-0.25, 0.48], [0.25, 0.48]].forEach(function (p) { box(0.06, 0.73, 0.06, mWood, tbx + p[0], 0.365, tbz + p[1]); });
      solid(tbx - 0.34, W / 2, tbz - 0.58, tbz + 0.58);
      var cl = box(0.9, 0.012, 0.5, mRug, tbx, 0.78, tbz, null, false); cl.rotation.y = 0.15; // runner cloth
      bellG = new THREE.Group(); bellG.position.set(tbx - 0.05, 0.795, tbz + 0.02); group.add(bellG);
      var cone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.065, 0.1, 18, 1, true), mBrass); cone.position.y = 0.07; bellG.add(cone); var top = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8, 0, 6.283, 0, 1.57), mBrass); top.position.y = 0.12; bellG.add(top);
      cyl(0.012, 0.012, 0.09, mWood, 0, 0.17, 0, bellG, 8); var cp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mBrass); cp.position.y = 0.03; bellG.add(cp);
      var hitb = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.26, 10), new THREE.MeshBasicMaterial({ visible: false })); hitb.position.y = 0.12; bellG.add(hitb);
      bellIt = { name: 'bell', label: 'قرع الجرس', object: bellG, mesh: hitb, open: false, t: 0, kind: 'bell', noPrefix: true, swing: 0, c: 0, target: 0 }; interactives.push(bellIt);
      box(0.18, 0.1, 0.13, mWood, tbx + 0.02, 0.83, tbz - 0.3).rotation.y = 0.3; box(0.18, 0.015, 0.13, mWood, tbx + 0.02, 0.885, tbz - 0.3).rotation.x = -0.6; // music box with open lid
      cyl(0.03, 0.03, 0.12, mPaper, tbx + 0.1, 0.84, tbz + 0.35, null, 10); var fl = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffb050 })); fl.scale.y = 1.6; fl.position.set(tbx + 0.1, 0.92, tbz + 0.35); group.add(fl); group.userData.flame = fl;
      // chair pulled up to the table
      var ch = new THREE.Group(); ch.position.set(1.65, 0, tbz); ch.rotation.y = -Math.PI / 2 + 0.2; group.add(ch); box(0.42, 0.04, 0.42, mWood, 0, 0.45, 0, ch); box(0.42, 0.5, 0.04, mWood, 0, 0.72, -0.19, ch); [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach(function (p) { box(0.04, 0.45, 0.04, mWood, p[0], 0.22, p[1], ch); }); solid(1.38, 1.95, tbz - 0.3, tbz + 0.3);
    })();
    // ---------- wardrobe on the left wall: hanging coats, shelves, hinged doors ----------
    (function () {
      var z0 = 0.9, wg = wallGroup(lz, z0, Math.PI / 2), lg = carcass(wg, 1.3, 2.0, 0.55, mCarc, 0, 1.03, 0.275);
      var rail = cyl(0.012, 0.012, 1.2, mHandle, 0, 0.7, 0.28, lg, 8); rail.rotation.z = Math.PI / 2;
      [-0.48, -0.3, -0.12, 0.08, 0.26, 0.46].forEach(function (x, i) { box(0.015, 0.12, 0.012, mHandle, x, 0.64, 0.28, lg, false); var c = box(0.34, 0.95 - (i % 2) * 0.25, 0.06, i % 3 ? mCoat : mCoat2, x, 0.22 - (i % 2) * 0.12, 0.28, lg, false); c.rotation.y = (i - 2.5) * 0.04; });
      shelf(lg, 1.3, 0.55, -0.55); [-0.45, -0.05, 0.38].forEach(function (x, i) { boxItem(lg, x, -0.98, 0.0, 0.26, 0.14, 0.34, i + 3); }); [-0.4, 0.1, 0.45].forEach(function (x, i) { boxItem(lg, x, -0.538, 0.05, 0.28, 0.08, 0.3, i); }); shelf(lg, 1.3, 0.55, 0.85); [-0.4, 0, 0.4].forEach(function (x, i) { boxItem(lg, x, 0.858, 0.1, 0.25, 0.1, 0.3, i + 1); });
      var fz = 0.56; door('wardL', 'باب الخزانة', 0.645, 1.96, 0.02, mDoorM, -0.65, 1.03, fz, 'left', 'v', wg, 'knob-top'); door('wardR', 'باب الخزانة', 0.645, 1.96, 0.02, mDoorM, 0.65, 1.03, fz, 'right', 'v', wg, 'knob-top', { ajar: 0.1 });
      solid(lz, lz + 0.58, z0 - 0.66, z0 + 0.66);
    })();
    // ---------- dresser on the front wall with a mirror, music box, brush ----------
    (function () {
      var g = wallGroup(-0.3, D / 2, Math.PI); carcass(g, 1.2, 0.8, 0.45, mCarc, 0, 0.4, 0.225); box(1.24, 0.04, 0.48, mWood, 0, 0.82, 0.235, g);
      [0.64, 0.42, 0.2].forEach(function (y, i) { drawer('dresser' + (i + 1), 'درج الخزانة', 1.16, 0.2, 0.38, mDoorM, 0, y, 0.46, g, i === 1 ? 'rags' : null); });
      solid(-0.3 - 0.62, -0.3 + 0.62, D / 2 - 0.5, D / 2);
      doll(0.35, 0.84, 0.25, 0.4, 0.3, g); box(0.1, 0.012, 0.04, mHandle, -0.3, 0.846, 0.2, g, false); cyl(0.03, 0.03, 0.1, mJar, -0.1, 0.89, 0.3, g, 10);
      var mm = std(canvasTex(128, 192, function (c, w, h) { var gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#7f8f8a'); gr.addColorStop(1, '#3e4a46'); c.fillStyle = gr; c.fillRect(0, 0, w, h); for (var i = 0; i < 20; i++) { var x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 20, b = c.createRadialGradient(x, y, 0, x, y, r); b.addColorStop(0, 'rgba(20,24,20,0.4)'); b.addColorStop(1, 'rgba(20,24,20,0)'); c.fillStyle = b; c.fillRect(x - r, y - r, r * 2, r * 2); } }), { rough: 0.15, metal: 0.7 });
      box(0.62, 0.9, 0.02, mm, 0, 1.45, 0.02, g, false); box(0.68, 0.96, 0.015, mTrim, 0, 1.45, 0.012, g, false);
    })();
    // ---------- rocking chair with a doll, in the corner ----------
    var rocker = new THREE.Group();
    (function () {
      rocker.position.set(-2.05, 0, 1.75); rocker.rotation.y = Math.PI / 2 + 0.5; group.add(rocker);
      box(0.5, 0.04, 0.46, mWood, 0, 0.42, 0, rocker); box(0.5, 0.62, 0.04, mWood, 0, 0.75, -0.22, rocker).rotation.x = -0.15; [-1, 1].forEach(function (s) { box(0.04, 0.3, 0.04, mWood, s * 0.22, 0.58, 0.15, rocker); box(0.04, 0.3, 0.04, mWood, s * 0.22, 0.58, -0.18, rocker); box(0.04, 0.04, 0.7, mWood, s * 0.24, 0.14, 0, rocker); box(0.04, 0.3, 0.04, mWood, s * 0.22, 0.28, 0.2, rocker); box(0.04, 0.3, 0.04, mWood, s * 0.22, 0.28, -0.2, rocker); });
      doll(0, 0.44, 0.02, 0.0, 0.35, rocker); solid(-2.4, -1.7, 1.45, 2.15);
    })();
    // ---------- window with moonlight and curtains on the back wall; framed pictures; shelf with books; rug ----------
    var curt = [];
    (function () {
      var wg = wallGroup(1.0, bz, 0); var win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), new THREE.MeshBasicMaterial({ color: 0x0c1428 })); win.position.set(0, 1.6, 0.012); wg.add(win);
      box(1.0, 0.05, 0.08, mTrim, 0, 2.2, 0.05, wg); box(1.0, 0.05, 0.1, mTrim, 0, 1.0, 0.06, wg); box(0.05, 1.2, 0.08, mTrim, -0.48, 1.6, 0.05, wg); box(0.05, 1.2, 0.08, mTrim, 0.48, 1.6, 0.05, wg); box(0.03, 1.15, 0.04, mTrim, 0, 1.6, 0.04, wg); box(0.9, 0.03, 0.04, mTrim, 0, 1.6, 0.04, wg);
      var ct = fabric(121, '#4a2e30'); [-0.42, 0.42].forEach(function (x) { var c = box(0.38, 1.5, 0.05, ct, x, 1.55, 0.14, wg, false); curt.push(c); });
      box(1.3, 0.02, 0.02, mHandle, 0, 2.32, 0.14, wg, false);
      var pic = function (x, y, w, h, seed, rot, par, z) { var t = canvasTex(96, 128, function (c, ww, hh) { var r = rnd(seed); c.fillStyle = '#8a7e62'; c.fillRect(0, 0, ww, hh); for (var i = 0; i < 30; i++) { c.fillStyle = 'rgba(' + (30 + r() * 40 | 0) + ',' + (25 + r() * 30 | 0) + ',20,0.35)'; c.fillRect(r() * ww, r() * hh, 10 + r() * 30, 8 + r() * 25); } if (FIG) { c.fillStyle = 'rgba(25,18,12,0.75)'; c.beginPath(); c.arc(48, 52, 17, 0, 6.283); c.fill(); c.fillRect(31, 66, 34, 60); } }); var f = box(w + 0.05, h + 0.05, 0.03, mTrim, x, y, z, par, false); f.rotation.z = rot; var p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })); p.position.set(0, 0, 0.017); f.add(p); return f; };
      pic(-0.35, 1.7, 0.3, 0.4, 5, 0, null, bz + 0.03); pic(-1.0, 1.95, 0.26, 0.34, 9, 0.18, null, bz + 0.03);
      var rg = wallGroup(rz, 0.7, -Math.PI / 2); pic(0, 1.6, 0.34, 0.44, 13, 0, rg, 0.03); box(1.0, 0.03, 0.2, mWood, 0, 1.25, 0.1, rg); [-0.3, -0.12, 0.05, 0.2, 0.34].forEach(function (x, i) { var b = box(0.05, 0.2 - (i % 2) * 0.03, 0.14, canMats[i + 2], x, 1.36 - (i % 2) * 0.015, 0.1, rg, false); }); doll(0.38, 1.265, 0.1, -0.3, 0.2, rg).scale.setScalar(0.8);
      var rug = box(2.2, 0.012, 1.5, mRug, -0.2, 0.008, 0.2, null, false); rug.rotation.y = 0.08;
      // toys on the floor: blocks and a ball
      [[0.5, 1.2, 0.2, 0], [0.6, 1.3, 0.15, 1], [0.45, 1.35, 0.1, 2]].forEach(function (p) { var b = box(0.1, 0.1, 0.1, canMats[p[3] + 1], p[0], 0.06, p[1] + 0.05, null, false); b.rotation.y = p[2] * 4; }); var ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), canMats[3]); ball.position.set(0.9, 0.07, 0.8); group.add(ball);
    })();
    // ---------- decals: dust grime, damp stains, cobwebs, child drawings ----------
    function decalTex(w, h, paint) { return canvasTex(w, h, paint); }
    function decal(tex, w, h, x, y, z, ry, rx, op) { var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, opacity: op === undefined ? 1 : op, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.renderOrder = 2; group.add(m); return m; }
    var grime = decalTex(1024, 256, function (g, w, h) { var r = rnd(7), gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(8,6,4,0.55)'); gr.addColorStop(0.4, 'rgba(14,10,6,0.25)'); gr.addColorStop(1, 'rgba(14,10,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (var i = 0; i < 60; i++) { var x = r() * w, y = h * (0.3 + r() * 0.6), rad = 10 + r() * 36, b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(10,8,5,' + (0.08 + r() * 0.14) + ')'); b.addColorStop(1, 'rgba(10,8,5,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } });
    decal(grime, W - 0.02, 0.7, 0, 1.0 + 0.35, -D / 2 + 0.006, 0); decal(grime, D - 0.02, 0.7, -W / 2 + 0.006, 1.35, 0, Math.PI / 2); decal(grime, D - 0.02, 0.7, W / 2 - 0.006, 1.35, 0, -Math.PI / 2);
    var leak = decalTex(256, 512, function (g, w, h) { var r = rnd(21); for (var k = 0; k < 3; k++) { var x = w * (0.25 + r() * 0.5), len = h * (0.5 + r() * 0.4), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(60,44,20,0.45)'); gr.addColorStop(1, 'rgba(60,44,20,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 4 - r() * 20, 0); g.lineTo(x + 4 + r() * 20, 0); g.lineTo(x + 3, len); g.lineTo(x - 3, len); g.fill(); } var b = g.createRadialGradient(w / 2, 20, 0, w / 2, 20, 90); b.addColorStop(0, 'rgba(50,36,14,0.5)'); b.addColorStop(1, 'rgba(50,36,14,0)'); g.fillStyle = b; g.fillRect(0, 0, w, 200); });
    decal(leak, 0.9, 1.1, 2.0, H - 0.55, -D / 2 + 0.007, 0, 0, 0.9); decal(leak, 0.8, 1.0, -W / 2 + 0.007, H - 0.5, -0.9, Math.PI / 2, 0, 0.85);
    var web = decalTex(256, 256, function (g) { g.strokeStyle = 'rgba(225,225,215,0.5)'; g.lineWidth = 1.2; for (var i = 0; i <= 6; i++) { var a = i / 6 * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); g.stroke(); } for (var r = 1; r <= 7; r++) { g.beginPath(); for (var k = 0; k <= 6; k++) { var a2 = k / 6 * Math.PI / 2, rr = r * 34 - (k % 2 ? 6 : 0); var px = Math.cos(a2) * rr, py = Math.sin(a2) * rr; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); } });
    function cobweb(x, y, z, ry, sx, s) { var m = decal(web, s, s, x, y, z, ry, 0, 0.85); m.scale.set(sx, 1, 1); m.position.x += sx * s / 2 * Math.cos(ry); m.position.z += -sx * s / 2 * Math.sin(ry); m.position.y -= s / 2; }
    cobweb(-W / 2 + 0.01, H - 0.01, bz + 0.012, 0, 1, 0.9); cobweb(W / 2 - 0.01, H - 0.01, bz + 0.012, 0, -1, 0.8); cobweb(-W / 2 + 0.012, H - 0.01, D / 2 - 0.01, Math.PI / 2, 1, 0.7);
    var drw = decalTex(256, 160, function (g) { g.fillStyle = '#a89c78'; g.fillRect(0, 0, 256, 160); g.strokeStyle = '#2a1a10'; g.lineWidth = 3; [[50, 90], [128, 85], [206, 95]].forEach(function (p, i) { g.beginPath(); g.arc(p[0], p[1] - 30, 14, 0, 6.283); g.moveTo(p[0], p[1] - 16); g.lineTo(p[0], p[1] + 30); g.moveTo(p[0], p[1]); g.lineTo(p[0] - 22, p[1] + 14); g.moveTo(p[0], p[1]); g.lineTo(p[0] + 22, p[1] + 14); g.moveTo(p[0], p[1] + 30); g.lineTo(p[0] - 14, p[1] + 55); g.moveTo(p[0], p[1] + 30); g.lineTo(p[0] + 14, p[1] + 55); g.stroke(); }); g.fillStyle = '#6a0e0e'; g.fillRect(118, 52, 6, 6); g.fillRect(132, 52, 6, 6); });
    if (FIG) decal(drw, 0.42, 0.26, -W / 2 + 0.01, 1.7, 0.1 - 1.4, Math.PI / 2, 0, 1);

    // ---------- lights: warm bedside lamp (shadows), cold moonlight through the window, very low fill. Calm mood, no blackouts ----------
    var shMap = q === '1k' ? 512 : 1024;
    var lamp = new THREE.PointLight(0xffb870, 0.62, 9, 2); lamp.position.copy(lampPos); lamp.castShadow = true; lamp.shadow.mapSize.set(shMap, shMap); lamp.shadow.bias = -0.0008; group.add(lamp);
    var lampShadeMat = null; group.traverse(function (o) { if (o.isMesh && o.material && o.material.emissiveIntensity === 0.9) lampShadeMat = o.material; });
    var moon = new THREE.SpotLight(0x6a86c8, 0.9, 8, 0.7, 0.7, 1.5); moon.position.set(1.0, 2.2, bz + 0.25); moon.target.position.set(0.7, 0, 0.5); group.add(moon, moon.target);
    var candle = new THREE.PointLight(0xffa850, 0.16, 2.6, 2); candle.position.set(tbx + 0.1, 1.0, tbz + 0.35); group.add(candle);
    var fill = new THREE.PointLight(0x8a7a68, 0.12, 8, 2); fill.position.set(0.8, 2.2, 1.0); group.add(fill);
    group.add(new THREE.HemisphereLight(0x4a5470, 0x1a120e, 0.12));

    // ---------- procedural sound (WebAudio, no files) ----------
    var A = null, audio = { fear: 0.15, beat: 0 }, tm = { tick: 1, creak: 12, whisper: 50, flip: false };
    function noiseBuf(ctx) { var b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
    function envG(t, peak, dur, att) { var g = A.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + (att || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(A.master); return g; }
    function thump(f0, f1, peak, dur, delay) { if (!A) return; var t = A.ctx.currentTime + (delay || 0), o = A.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.connect(envG(t, peak, dur)); o.start(t); o.stop(t + dur + 0.05); }
    function noiseHit(freq, q2, peak, dur, att, type) { if (!A) return; var t = A.ctx.currentTime, n = A.ctx.createBufferSource(); n.buffer = A.nbuf; var f = A.ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q2; n.connect(f); f.connect(envG(t, peak, dur, att)); n.start(t); n.stop(t + dur + 0.1); }
    audio.start = function () {
      if (A) return; var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; var ctx = new AC(); if (ctx.resume) ctx.resume();
      var master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      var d1 = ctx.createOscillator(), dg = ctx.createGain(); d1.type = 'sine'; d1.frequency.value = 52; dg.gain.value = 0.035; d1.connect(dg); dg.connect(master); d1.start();
      var nb = noiseBuf(ctx), wn = ctx.createBufferSource(), wf = ctx.createBiquadFilter(), wg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(); wn.buffer = nb; wn.loop = true; wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.9; wg.gain.value = 0.018; lfo.frequency.value = 0.13; lg.gain.value = 0.012; lfo.connect(lg); lg.connect(wg.gain); wn.connect(wf); wf.connect(wg); wg.connect(master); wn.start(); lfo.start();
      A = { ctx: ctx, master: master, nbuf: nb, drone: dg };
    };
    audio.setFear = function (f) { audio.fear = Math.max(0, Math.min(1, f)); };
    audio.creak = function () { if (!A) return; var t = A.ctx.currentTime, o = A.ctx.createOscillator(), bp = A.ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(150, t + 0.35); o.frequency.linearRampToValueAtTime(105, t + 0.8); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 4; o.connect(bp); bp.connect(envG(t, 0.07, 0.9, 0.08)); o.start(t); o.stop(t + 1); };
    audio.slide = function () { noiseHit(700, 1.2, 0.07, 0.4, 0.05); };
        audio.step = function () { thump(95, 45, 0.22, 0.12); noiseHit(300, 1, 0.08, 0.1, 0.004, 'lowpass'); };
    audio.whisper = function () { if (!A) return; var t = A.ctx.currentTime, n = A.ctx.createBufferSource(); n.buffer = A.nbuf; var bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5; bp.frequency.setValueAtTime(1400, t); bp.frequency.linearRampToValueAtTime(2200, t + 0.6); bp.frequency.linearRampToValueAtTime(1500, t + 1.4); n.connect(bp); bp.connect(envG(t, 0.07, 1.8, 0.5)); n.start(t); n.stop(t + 2); };
    audio.bell = function () { if (!A) return; var t = A.ctx.currentTime; [[1, 0.2], [2.76, 0.12], [5.4, 0.07], [8.93, 0.04]].forEach(function (p) { var o = A.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1046 * p[0]; o.connect(envG(t, p[1], 3.2 / (0.6 + p[0] * 0.3), 0.003)); o.start(t); o.stop(t + 3.5); }); noiseHit(5000, 2, 0.05, 0.05, 0.002); };
    function audioTick(dt) { if (!A) return;
      tm.tick -= dt; if (tm.tick <= 0) { tm.tick = 1; tm.flip = !tm.flip; noiseHit(tm.flip ? 2400 : 2000, 6, 0.028, 0.04, 0.002); }
      tm.creak -= dt; if (tm.creak <= 0) { tm.creak = 14 + Math.random() * 22; audio.creak(); }
      tm.whisper -= dt; if (tm.whisper <= 0) { tm.whisper = 55 + Math.random() * 60; if (!hiding) audio.whisper(); }
      if (audio.fear > 0.35) { audio.beat -= dt; var bpm = 60 + audio.fear * 70; if (audio.beat <= 0) { var pk = 0.12 + audio.fear * 0.35; thump(75, 38, pk, 0.18); thump(62, 33, pk * 0.75, 0.2, 0.17); audio.beat = 60 / bpm; } }
      A.drone.gain.value = 0.03 + audio.fear * 0.05; }

    // ---------- the visitor: seen only from under the bed. Dark trousers, bare pale feet, a long tattered coat. No face. ----------
    var vis = new THREE.Group(); vis.visible = false; group.add(vis);
    var visLegs = [], mTr = std(aged(131, '#4a4440', { rust: 0, dark: 1.0 }), { rough: 1 }), mSkin = new THREE.MeshStandardMaterial({ color: 0x5a5248, roughness: 0.9 });
    [-1, 1].forEach(function (s) { var lg = new THREE.Group(); lg.position.set(s * 0.1, 0.92, 0); vis.add(lg); var up = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.55, 10), mTr); up.position.y = -0.28; lg.add(up); var lo = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.4, 10), mTr); lo.position.y = -0.7; lg.add(lo); var ft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.24), mSkin); ft.position.set(0, -0.9, 0.05); lg.add(ft); visLegs.push(lg); });
    var coat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.0, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1, side: THREE.DoubleSide, map: fabric(141, '#4a403a').map })); coat.position.y = 0.72; vis.add(coat);
    for (var ti = 0; ti < 7; ti++) { var tt = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.25), coat.material); var an = ti / 7 * 6.283; tt.position.set(Math.cos(an) * 0.32, 0.18, Math.sin(an) * 0.32); tt.rotation.y = -an + 1.57; vis.add(tt); }
    var vlight = new THREE.PointLight(0x8a9ac8, 1.0, 3, 2); vlight.position.set(0, 0.7, -0.5); vis.add(vlight);
    var vstate = { phase: 0, t: 0, path: [], i: 0, wait: 0, walkT: 0, stepT: 0, cool: 0 };
    var inPath = [[dx, D / 2 + 0.4], [dx, D / 2 - 0.5], [0.3, 1.0], [-0.9, 0.35], [-1.25, -0.05]];
    var outPath = [[0.2, 0.9], [dx, D / 2 - 0.5], [dx, D / 2 + 0.6]];
    function visitStart() { if (!FIG) return; vstate.phase = 1; vstate.path = inPath; vstate.i = 0; vis.position.set(inPath[0][0], 0, inPath[0][1]); vis.visible = true; audio.setFear(0.45); }
    function visitStop() { vstate.phase = 0; vis.visible = false; vstate.cool = 25; audio.setFear(hiding ? 0.3 : 0.15); }
    function visitUpdate(dt) {
      if (vstate.phase === 0) { return; }
      if (vstate.phase === 1 || vstate.phase === 3) {
        var p = vstate.path[vstate.i], dxv = p[0] - vis.position.x, dzv = p[1] - vis.position.z, dist = Math.hypot(dxv, dzv), sp = 0.62 * dt;
        if (dist < sp) { vis.position.x = p[0]; vis.position.z = p[1]; vstate.i++; if (vstate.i >= vstate.path.length) { if (vstate.phase === 1) { vstate.phase = 2; vstate.wait = 4.2; audio.setFear(0.75); } else { visitStop(); return; } } }
        else { vis.position.x += dxv / dist * sp; vis.position.z += dzv / dist * sp; vis.rotation.y = Math.atan2(dxv, dzv); }
        vstate.walkT += dt * 5.5; var sw = Math.sin(vstate.walkT) * 0.35; visLegs[0].rotation.x = sw; visLegs[1].rotation.x = -sw; vstate.stepT -= dt; if (vstate.stepT <= 0) { audio.step(); vstate.stepT = 0.56; }
      } else if (vstate.phase === 2) {
        visLegs[0].rotation.x = visLegs[1].rotation.x = 0; vis.rotation.y += (Math.atan2(-1.3 - vis.position.x, -1.3 - vis.position.z) - vis.rotation.y) * Math.min(1, dt * 2); vstate.wait -= dt; coat.rotation.y = Math.sin(vstate.walkT * 0.1) * 0.02; vstate.walkT += dt;
        if (vstate.wait <= 0) { vstate.phase = 3; vstate.path = outPath; vstate.i = 0; audio.setFear(0.4); }
      }
    }

    // ---------- bell and the hiding spot ----------
    var hiding = false, rings = 0, hideT = 0, T = 0, dip = 0, dipGap = 9;
    function ring() { bellIt.swing = 1; audio.bell(); rings++; if (rings % 3 === 0) { var wd = byName('wardR'); setTimeout(function () { if (wd) wd.open = !wd.open ? true : wd.open; audio.whisper(); }, 900); } }
    function enterHide() { hiding = true; hideT = 0; audio.setFear(0.3); }
    function exitHide() { hiding = false; visitStop(); vstate.cool = 12; audio.setFear(0.15); }
    function use(it) {
      if (hiding) { exitHide(); return; }
      if (!it) return; if (it.kind === 'hide') { enterHide(); return; } if (it.kind === 'bell') { ring(); return; } it.open = !it.open;
    }
    // generated environment map for reflections (no download)
    if (opt.renderer && THREE.PMREMGenerator) {
      var es = new THREE.Scene(); es.background = new THREE.Color(0x1b1d24);
      var eb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); eb.position.set(0, 3, 0); es.add(eb);
      var pm = new THREE.PMREMGenerator(opt.renderer); group.userData.env = pm.fromScene(es, 0.04).texture; pm.dispose();
    }
    interactives.forEach(function (it) { if (it.kind === 'hide' || it.kind === 'bell') return; var v = !!it.open; Object.defineProperty(it, 'open', { get: function () { return v; }, set: function (x) { x = !!x; if (x !== v) { v = x; if (it.kind === 'slide') audio.slide(); else audio.creak(); } } }); });

    // ---------- API ----------
    function byName(n) { for (var i = 0; i < interactives.length; i++) if (interactives[i].name === n) return interactives[i]; return null; }
    rocker.rotation.order = 'YXZ';
    function update(dt) {
      T += dt;
      for (var i = 0; i < interactives.length; i++) {
        var it = interactives[i]; if (it.kind === 'hide' || it.kind === 'bell') continue; var goal = it.open ? 1 : 0; it.t += (goal - it.t) * Math.min(1, dt * 6);
        if (Math.abs(goal - it.t) < 0.001) it.t = goal; var e = it.t * it.t * (3 - 2 * it.t);
        if (it.kind === 'v') it.object.rotation.y = it.c + (it.target - it.c) * e; else if (it.kind === 'h') it.object.rotation.x = it.target * e; else it.object.position.z = it.base + it.target * e;
      }
      bellIt.swing *= Math.max(0, 1 - dt * 0.9); bellG.rotation.z = Math.sin(T * 17) * bellIt.swing * 0.4; bellG.rotation.x = Math.cos(T * 13) * bellIt.swing * 0.25;
      rocker.rotation.x = Math.sin(T * 0.8) * 0.035; curt.forEach(function (c, k) { c.rotation.z = Math.sin(T * 0.5 + k) * 0.008; });
      var fl = group.userData.flame; if (fl) { fl.scale.y = 1.5 + Math.sin(T * 11) * 0.25 + Math.random() * 0.2; }
      // lamp: gentle breathing, rare short dips
      var v = 1 + Math.sin(T * 1.7) * 0.015; dipGap -= dt; if (dip > 0) { dip -= dt; v = Math.random() < 0.5 ? 0.35 : 0.8; } else if (dipGap <= 0 && !group.userData.freeze) { dip = 0.15 + Math.random() * 0.3; dipGap = 10 + Math.random() * 18; }
      if (group.userData.freeze) v = 1; if (vstate.phase === 2) v *= 0.7;
      lamp.intensity = 0.62 * v; if (lampShadeMat) lampShadeMat.emissiveIntensity = 0.9 * v;
      if (hiding) hideT += dt; if (hiding && vstate.phase === 0 && hideT > 3 && vstate.cool <= 0) visitStart(); if (vstate.cool > 0) vstate.cool -= dt;
      visitUpdate(dt); audioTick(dt);
    }
    function pick(ray, maxDist) {
      var meshes = interactives.map(function (i) { return i.mesh; }), hits = ray.intersectObjects(meshes, false);
      if (!hits.length || hits[0].distance > (maxDist || 2.4)) return null;
      for (var i = 0; i < interactives.length; i++) if (interactives[i].mesh === hits[0].object) return interactives[i];
      return null;
    }
    group.traverse(function (o) { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && group.userData.env) o.material.envMap = group.userData.env; });
    var API = {
      group: group, interactives: interactives, colliders: colliders, update: update, pick: pick, audio: audio, enableAudio: audio.start, use: use, ring: ring, enterHide: enterHide, exitHide: exitHide,
      toggle: function (n) { var it = byName(n); if (it) use(it); return it; }, open: function (n) { var it = byName(n); if (it) it.open = true; }, close: function (n) { var it = byName(n); if (it) it.open = false; },
      setCamera: function (x, z) { group.userData.camX = x; group.userData.camZ = z; }, debug: function (freeze, showVisitor) { group.userData.freeze = freeze; if (showVisitor) { visitStart(); vstate.phase = 2; vstate.wait = 9999; vis.position.set(-1.25, 0, -0.05); vis.rotation.y = Math.PI; } },
      bounds: { minX: -W / 2 + 0.25, maxX: W / 2 - 0.25, minZ: -D / 2 + 0.25, maxZ: D / 2 + 0.6, height: H },
      hideSpot: hideSpot, exitSpot: exitSpot, bedSpot: bedSpot, spawn: { x: 0.45, z: 0.7, yaw: 1.1 }, exitDoor: { x: dx, z: D / 2 }, size: { w: W, d: D, h: H }, progress: progress, license: 'Textures: Poly Haven, CC0', version: '0.1'
    };
    Object.defineProperty(API, 'hiding', { get: function () { return hiding; } });
    return API;
  }
  root.BedroomModule = { build: build, version: '0.1' };
})(typeof window !== 'undefined' ? window : this);
