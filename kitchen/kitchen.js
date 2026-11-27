/* kitchen.js  -  standalone decayed horror kitchen module (own scene, no dependency on any house file).  v0.3
 * Needs only three.js r128 (global THREE).
 *
 *   var K = KitchenModule.build(THREE, { quality: '1k' | '2k' (default) | '4k', floorTexSize: metres per floor texture (tile scale),
 *                                        wallTexSize, renderer: renderer, onProgress: fn(done,total) });
 *   scene.add(K.group);                       // the whole room, origin at the room centre on the floor, doorway on the +z side
 *   K.update(dt);                             // animates doors/drawers and the flickering light
 *   K.toggle('oven'); K.open(name) / K.close(name); K.interactives  // [{name,label,object,open}]
 *   K.pick(raycaster)  -> interactive under the ray (or null);  K.colliders -> AABBs [{minX,maxX,minZ,maxZ}] for player collision
 *   K.bounds  -> {minX,maxX,minZ,maxZ,height}; K.spawn -> {x,z,yaw} suggested player start; K.exitDoor -> {x,z} doorway centre
 * Option figures: true -> dolls, wall portraits, flicker figure and visitor are built (default false: none of them).
 * Option wallClock: true -> pale round wall clock above the shelves (default off, it read as a face).
 * Floor: checkerboard near-black / dark green, square size opt.checkerSize (metres, default 0.25), colours opt.checkerColorA / opt.checkerColorB (CSS strings).
 * Textures: Poly Haven (CC0) for floor/walls/tiles/wood, loaded lazily from dl.polyhaven.org; plain colours until they arrive or if offline.
 * Fixtures (fridge, stove, rusty steel, grime, cobwebs, cracks, blood) are drawn procedurally in canvases, nothing else is downloaded.
 */
(function (root) {
  'use strict';
  var PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/';
  var W = 5.2, D = 4.2, H = 2.8; // room width (x), depth (z), height
  // ===== TEXTURE CONFIG (swap floor / wall / tiles here; 'size' = real-world metres covered by one texture image) =====
  var TEX = {
    floor: { id: 'brown_floor_tiles', size: 0.9, tint: 0x9a928a, rough: 0.5 },   // option E (ceramic floor)
    wall:  { id: 'damaged_plaster',   size: 1.4, tint: 0x8c877e, rough: 0.95, nor: 1.2 },
    tiles: { id: 'long_white_tiles',  size: 0.6, tint: 0xd8d0bc, rough: 0.35 },  // tiled wall areas (behind counter)
    ceil:  { id: 'damaged_plaster',   size: 1.4, tint: 0x6d6a64, rough: 1.0 },
    wood:  { id: 'dark_wood',         size: 1.0, tint: 0x9a8576, rough: 0.6 }
  };

  function build(THREE, opt) {
    opt = opt || {};
    var FIG = opt.figures === true;   // human-like figures (dolls, portraits, flicker figure, visitor) are OFF unless { figures: true }
    var q = opt.quality || '2k'; if (opt.floorTexSize) TEX.floor.size = opt.floorTexSize; if (opt.wallTexSize) TEX.wall.size = opt.wallTexSize;
    var maxAniso = opt.renderer ? opt.renderer.capabilities.getMaxAnisotropy() : 4;
    var group = new THREE.Group(); group.name = 'kitchen';
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
    // checkerboard floor: near-black / dark green (opt.checkerColorA, opt.checkerColorB), flat colours, one square = opt.checkerSize metres (default 0.25)
    function checkerMat(surfW, surfH) {
      var S = opt.checkerSize || 0.25, c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
      g.fillStyle = opt.checkerColorA || '#060806'; g.fillRect(0, 0, 512, 512); g.fillStyle = opt.checkerColorB || '#134d24'; g.fillRect(256, 0, 256, 256); g.fillRect(0, 256, 256, 256);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(surfW / (2 * S), surfH / (2 * S)); t.anisotropy = Math.min(16, maxAniso); t.encoding = THREE.sRGBEncoding; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0, envMapIntensity: 0.1 });
    }
    var mFloor = checkerMat(W, D);
    var mWallA = pbr(TEX.wall, W, H, 0x8d887e), mWallB = pbr(TEX.wall, D, H, 0x8d887e), mWallC = pbr(TEX.wall, D, H, 0x8d887e);
    var mCeil = pbr(TEX.ceil, W, D, 0x55524c);
    var mBack = pbr(TEX.tiles, W, 0.62, 0xc8c4b6);
    var mWood = pbr(TEX.wood, 1.0, 1.0, 0x4a3020), mWoodDoor = pbr(TEX.wood, 0.6, 0.8, 0x4a3020);

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
      var tgt = kind === 'h' ? 1.5 : side * -1.9, c = kind === 'h' ? 0 : (o.ajar ? side * -o.ajar : 0);
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

    // ---------- shell ----------
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mFloor); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
    var ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mCeil); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; group.add(ceil);
    function wall(w, mat, x, z, ry) { var m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), mat); m.position.set(x, H / 2, z); m.rotation.y = ry; m.receiveShadow = true; group.add(m); return m; }
    wall(W, mWallA, 0, -D / 2, 0); wall(D, mWallB, -W / 2, 0, Math.PI / 2); wall(D, mWallC, W / 2, 0, -Math.PI / 2);
    var dx = -0.9, dw = 1.0, dh = 2.1;
    (function () { var l = W / 2 + dx - dw / 2, r = W / 2 - (dx + dw / 2);
      var a = new THREE.Mesh(new THREE.PlaneGeometry(l, H), mWallA); a.position.set(-W / 2 + l / 2, H / 2, D / 2); a.rotation.y = Math.PI; group.add(a);
      var b = new THREE.Mesh(new THREE.PlaneGeometry(r, H), mWallA); b.position.set(W / 2 - r / 2, H / 2, D / 2); b.rotation.y = Math.PI; group.add(b);
      var c = new THREE.Mesh(new THREE.PlaneGeometry(dw, H - dh), mWallA); c.position.set(dx, dh + (H - dh) / 2, D / 2); c.rotation.y = Math.PI; group.add(c);
      box(0.08, dh, 0.12, mTrim, dx - dw / 2 - 0.04, dh / 2, D / 2 - 0.02); box(0.08, dh, 0.12, mTrim, dx + dw / 2 + 0.04, dh / 2, D / 2 - 0.02); box(dw + 0.16, 0.08, 0.12, mTrim, dx, dh + 0.04, D / 2 - 0.02);
    })();
    [[W, -D / 2 + 0.01, 0, 0], [D, 0, -W / 2 + 0.01, Math.PI / 2], [D, 0, W / 2 - 0.01, Math.PI / 2]].forEach(function (s) { var sk = box(s[0], 0.1, 0.02, mTrim, s[2], 0.05, s[1]); sk.rotation.y = s[3]; });

    // ---------- back wall: tile splash, base cabinets, counter ----------
    var bz = -D / 2;
    var splash = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, 0.62), mBack); splash.position.set(0, 1.21, bz + 0.005); splash.receiveShadow = true; group.add(splash);
    var cd = 0.62, ch = 0.86, cz = bz + cd / 2;

    // ---- FRIDGE: now on the front wall, right of the doorway, facing into the room ----
    var FR = { x: 1.9, w: 0.8, d: 0.72 };
    (function () {
      var fg = new THREE.Group(); fg.position.set(FR.x, 0, D / 2 - FR.d / 2 - 0.02); fg.rotation.y = Math.PI; group.add(fg);
      solid(FR.x - FR.w / 2, FR.x + FR.w / 2, D / 2 - FR.d - 0.02, D / 2);
      var body = carcass(fg, FR.w, 1.85, FR.d, mFridge, 0, 0.925, 0);
      // yellowed inner liner (slightly inside the outer shell)
      box(FR.w - 0.05, 1.8, 0.008, mInner, 0, 0.925, -FR.d / 2 + 0.03, fg, false); box(0.008, 1.8, FR.d - 0.06, mInner, -FR.w / 2 + 0.03, 0.925, 0, fg, false); box(0.008, 1.8, FR.d - 0.06, mInner, FR.w / 2 - 0.03, 0.925, 0, fg, false); box(FR.w - 0.05, 0.008, FR.d - 0.06, mInner, 0, 1.82, 0, fg, false);
      box(FR.w - 0.04, 0.03, FR.d - 0.05, mInner, 0, 0.62, 0, fg, false); // divider freezer / fridge
      var gl = new THREE.MeshStandardMaterial({ color: 0x9aa59a, roughness: 0.2, transparent: true, opacity: 0.55 });
      [0.78, 1.04, 1.30, 1.56].forEach(function (y, i) {
        box(FR.w - 0.07, 0.012, FR.d - 0.08, gl, 0, y, 0.0, fg, false);
        var r = rnd(200 + i); for (var k = 0; k < 4; k++) { var x = -0.27 + k * 0.18, z = -0.12 + (r() - 0.5) * 0.14, t = (k + i) % 5;
          if (t === 0) jar(fg, x, y + 0.006, z); else if (t === 1) bottle(fg, x, y + 0.006, z, k); else if (t === 2) can(fg, x, y + 0.006, z, k + i); else if (t === 3) boxItem(fg, x, y + 0.006, z, 0.11, 0.14, 0.08, k + i); else { cyl(0.07, 0.07, 0.03, mMold, x, y + 0.02, z, fg, 12); } }
      });
      // spoiled food on the bottom shelf
      cyl(0.09, 0.09, 0.05, mFood, 0.18, 0.66, 0.0, fg, 14); cyl(0.07, 0.07, 0.03, mMold, 0.18, 0.7, 0.0, fg, 12); boxItem(fg, -0.2, 0.635, 0.0, 0.18, 0.12, 0.2, 3);
      // freezer: frosted blocks, ice
      var fm = new THREE.MeshStandardMaterial({ color: 0xc9d6dc, roughness: 0.9 }); [-0.2, 0.0, 0.2].forEach(function (x, i) { box(0.15, 0.1 + i * 0.03, 0.2, fm, x, 0.11 + i * 0.015 + 0.05, -0.05, fg, false); });
      box(0.5, 0.012, 0.4, fm, 0, 0.3, 0, fg, false); [0.1, -0.1].forEach(function (x) { box(0.12, 0.08, 0.16, mMold, x, 0.35, 0.0, fg, false); });
      // doors (hinged on the +x side in fridge coordinates)
      var itT = door('fridge_top', 'باب الثلاجة', FR.w - 0.02, 1.18, 0.05, mFridge, FR.w / 2 - 0.01, 0.62 + 0.59 + 0.02, FR.d / 2 + 0.02, 'right', 'v', fg);
      var itB = door('freezer', 'باب الفريزر', FR.w - 0.02, 0.6, 0.05, mFridge, FR.w / 2 - 0.01, 0.31, FR.d / 2 + 0.02, 'right', 'v', fg, null, { ajar: 0.12 });
      box(0.025, 0.55, 0.03, mHandle, -FR.w / 2 + 0.05, 0, 0.045, itT.mesh); box(0.025, 0.4, 0.03, mHandle, -FR.w / 2 + 0.05, 0.1, 0.045, itB.mesh);
      // door shelves with bottles (on the inner face of the main door)
      [-0.25, 0.05, 0.35].forEach(function (y, i) { box(FR.w - 0.12, 0.02, 0.07, mInner, 0, y, -0.06, itT.mesh, false); bottle(itT.mesh, -0.2 + i * 0.12, y + 0.01, -0.06, i); can(itT.mesh, 0.15, y + 0.01, -0.06, i + 2); });
      box(FR.w - 0.1, 0.05, 0.01, mMold, 0, -0.52, -0.03, itT.mesh, false); // mould line along the door seal
    })();

    // helper: base cabinet with hollow carcass and stocked interior
    function baseCab(x, w, i, kind, o) {
      o = o || {}; var g = carcass(null, w, 0.76, cd, mCarc, x, 0.48, cz);
      box(w + 0.01, 0.1, cd - 0.04, mBlack, x, 0.05, cz + 0.02, null, false); solid(x - w / 2, x + w / 2, bz, bz + cd);
      var fz = cz + cd / 2 + 0.01;
      if (kind === 'drawers') {
        drawer('drawer' + i + 'a', 'درج', w - 0.02, 0.2, 0.5, mWoodDoor, x, 0.78, fz, null, 'rags'); drawer('drawer' + i + 'b', 'درج', w - 0.02, 0.28, 0.5, mWoodDoor, x, 0.55, fz); drawer('drawer' + i + 'c', 'درج', w - 0.02, 0.28, 0.5, mWoodDoor, x, 0.28, fz, null, 'rags');
      } else {
        shelf(g, w, cd, -0.02); stock(g, w - 0.04, cd, [-0.37, -0.012], kind === 'plates' ? 'plates' : null);
        var hw = w / 2 - 0.01, dy = 0.1 + (ch - 0.14) / 2 + 0.03;
        if (w > 0.7) {
          door('base' + i + 'L', 'باب خزانة', hw, ch - 0.14, 0.022, mWoodDoor, x - w / 2 + 0.005, dy, fz, 'left', 'v', null, 'knob-top', o.ajarL ? { ajar: o.ajarL, tilt: o.tiltL } : null);
          if (!o.missingR) door('base' + i + 'R', 'باب خزانة', hw, ch - 0.14, 0.022, mWoodDoor, x + w / 2 - 0.005, dy, fz, 'right', 'v', null, 'knob-top');
        } else door('base' + i, 'باب خزانة', w - 0.02, ch - 0.14, 0.022, mWoodDoor, x - w / 2 + 0.005, dy, fz, 'left', 'v', null, 'knob-top');
      }
      return g;
    }
    var cx = -W / 2;
    baseCab(cx + 0.4, 0.8, 0, 'plates', { ajarL: 0.25 }); cx += 0.8;
    baseCab(cx + 0.3, 0.6, 1, 'drawers'); cx += 0.6;
    // stove (width 0.6), hollow body with a real oven cavity
    var sx = cx + 0.3; cx += 0.6;
    (function () {
      var g = new THREE.Group(); g.position.set(sx, 0, cz); group.add(g); solid(sx - 0.3, sx + 0.3, bz, bz + cd);
      var t = 0.02;
      box(t, 0.86, cd, mStove, -0.3 + t / 2, 0.43, 0, g); box(t, 0.86, cd, mStove, 0.3 - t / 2, 0.43, 0, g); box(0.56, 0.86, t, mStove, 0, 0.43, -cd / 2 + t / 2, g);
      box(0.56, 0.02, cd - 0.02, mStove, 0, 0.11, 0, g); box(0.6, 0.03, cd, mBlack, 0, 0.875, 0, g);
      box(0.6, 0.22, t, mStove, 0, 0.75, cd / 2 - t / 2, g); box(0.6, 0.1, t, mStove, 0, 0.055, cd / 2 - t / 2, g); [-1, 1].forEach(function (s) { box(0.02, 0.52, t, mStove, s * 0.29, 0.38, cd / 2 - t / 2, g); });
      box(0.6, 0.18, 0.04, mStove, 0, 1.0, -cd / 2 + 0.02, g);
      // oven cavity (dark lined) with racks, a tray and burnt food
      var cav = new THREE.MeshStandardMaterial({ color: 0x1e1812, roughness: 0.9 });
      box(0.5, 0.45, 0.01, cav, 0, 0.38, -0.25, g, false); box(0.01, 0.45, 0.5, cav, -0.25, 0.38, 0, g, false); box(0.01, 0.45, 0.5, cav, 0.25, 0.38, 0, g, false); box(0.5, 0.01, 0.5, cav, 0, 0.605, 0, g, false); box(0.5, 0.01, 0.5, cav, 0, 0.155, 0, g, false);
      [0.28, 0.46].forEach(function (y) { box(0.48, 0.008, 0.46, mSteel, y > 0.4 ? 0 : 0, y, 0.0, g, false); for (var k = 0; k < 6; k++) box(0.006, 0.01, 0.46, mSteel, -0.2 + k * 0.08, y + 0.008, 0, g, false); });
      box(0.4, 0.025, 0.34, mBlack, 0, 0.17, 0.0, g, false); cyl(0.08, 0.08, 0.04, mFood, 0.0, 0.2, 0.0, g, 14); cyl(0.05, 0.05, 0.03, mBlack, -0.12, 0.485, 0.0, g, 10);
      [[-0.14, 0.14], [0.14, 0.14], [-0.14, -0.12], [0.14, -0.12]].forEach(function (p, i) {
        var s = i === 0 ? 0.062 : 0.045; cyl(s, s, 0.02, mSteel, p[0], 0.9, p[1], g, 20); cyl(s * 0.6, s * 0.6, 0.012, mBlack, p[0], 0.915, p[1], g, 20);
        var gr = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 6, 14), mBlack); gr.rotation.x = Math.PI / 2; gr.position.set(p[0], 0.93, p[1]); g.add(gr);
      });
      [-0.14, 0.14].forEach(function (x) { box(0.012, 0.012, 0.44, mBlack, x, 0.935, 0.01, g, false); }); [0.14, -0.12].forEach(function (z) { box(0.5, 0.012, 0.012, mBlack, 0, 0.935, z, g, false); });
      for (var i = 0; i < 5; i++) { var kn = cyl(0.022, 0.026, 0.03, mBlack, -0.22 + i * 0.11, 0.76, cd / 2 + 0.015, g, 12); kn.rotation.x = Math.PI / 2; }
      var oit = door('oven', 'باب الفرن', 0.56, 0.52, 0.04, mStove, 0, 0.12, cd / 2 + 0.02, 'left', 'h', g), om = oit.mesh;
      box(0.38, 0.28, 0.01, mGlass, 0, -0.02, 0.025, om, false); bar(0.46, 0, 0.21, 0.065, om);
      pot(g, -0.14, 0.89, 0.14, 0.09); box(0.07, 0.015, 0.018, mBlack, -0.27, 1.06, 0.14, g);
    })();
    // gas cylinder beside the stove
    (function () { var gx = cx + 0.22; cyl(0.15, 0.15, 0.48, mRed, gx, 0.24, bz + 0.2, null, 20); cyl(0.09, 0.15, 0.05, mRed, gx, 0.5, bz + 0.2, null, 20); cyl(0.03, 0.03, 0.08, mHandle, gx, 0.56, bz + 0.2); solid(gx - 0.16, gx + 0.16, bz, bz + 0.4); cx += 0.5; })();
    baseCab(cx + 0.3, 0.6, 2); cx += 0.6;
    var skx = cx + 0.45; baseCab(skx, 0.9, 3, null, { ajarL: 0.5, tiltL: 0.04 }); cx += 0.9;
    baseCab(cx + 0.3, 0.6, 4, 'drawers'); cx += 0.6;
    var endX = cx, topY = 0.86 + 0.02;
    function counter(x1, x2) { if (x2 - x1 > 0.01) box(x2 - x1, 0.04, cd + 0.03, mTop, (x1 + x2) / 2, topY, cz + 0.015); }
    counter(-W / 2, sx - 0.3); counter(sx + 0.3, endX);
    box(0.6, 0.012, 0.4, mSteel, skx, topY + 0.022, cz + 0.02, null, false); box(0.54, 0.014, 0.34, mBlack, skx, topY + 0.03, cz + 0.02, null, false);
    cyl(0.018, 0.02, 0.28, mHandle, skx + 0.28, topY + 0.16, bz + 0.1); var sp = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.013, 8, 16, Math.PI), mHandle); sp.position.set(skx + 0.18, topY + 0.3, bz + 0.1); group.add(sp);
    // dirty dishes piled in the sink, and clutter on the counter
    plates(group, skx - 0.05, topY + 0.03, cz + 0.02, 5, 0.1); pot(group, skx + 0.12, topY + 0.03, cz + 0.05, 0.07); rag(group, -2.1, topY + 0.02, cz); bottle(group, -1.8, topY + 0.02, cz - 0.08, 1); can(group, -1.7, topY + 0.02, cz, 3); can(group, -1.64, topY + 0.02, cz - 0.05, 5); boxItem(group, 1.7, topY + 0.02, cz, 0.12, 0.2, 0.08, 1);

    // ---------- upper cabinets (hollow, stocked), one door hanging off its hinge ----------
    function upperCab(x, w, i, o) {
      o = o || {}; var uy = 1.88, uh = 0.7, uz = bz + 0.18, g = carcass(null, w, uh, 0.36, mCarc, x, uy, uz); solid(x - w / 2, x + w / 2, bz, bz + 0.36);
      shelf(g, w, 0.36, 0.0); stock(g, w - 0.04, 0.36, [-uh / 2 + 0.02, 0.008], 'plates');
      var fz = uz + 0.19, hw = w / 2 - 0.005;
      door('up' + i + 'L', 'باب علوي', hw, uh - 0.04, 0.02, mWoodDoor, x - w / 2 + 0.005, uy, fz, 'left', 'v', null, 'knob-bot', o.ajarL ? { ajar: o.ajarL, tilt: o.tiltL } : null);
      door('up' + i + 'R', 'باب علوي', hw, uh - 0.04, 0.02, mWoodDoor, x + w / 2 - 0.005, uy, fz, 'right', 'v', null, 'knob-bot');
    }
    upperCab(-2.15, 0.8, 0); upperCab(-1.25, 0.8, 1, { ajarL: 0.9, tiltL: 0.16 }); upperCab(1.0, 0.9, 2);
    (function () { box(0.6, 0.1, 0.46, mSteel, sx, 2.05, bz + 0.25); box(0.28, 0.5, 0.2, mSteel, sx, 2.4, bz + 0.12); box(0.4, 0.03, 0.3, mBlack, sx, 1.99, bz + 0.26, null, false); })();
    (function () { var x = 1.78; box(0.55, 0.035, 0.26, mWood, x, 1.62, bz + 0.13); box(0.55, 0.035, 0.26, mWood, x, 2.05, bz + 0.13);
      jar(group, x - 0.15, 1.64, bz + 0.13); can(group, x, 1.64, bz + 0.13, 2); bottle(group, x + 0.17, 1.64, bz + 0.13, 0); plates(group, x, 2.07, bz + 0.13, 4); })();

    // ---------- left wall: open shelves, hanging pans ----------
    var lz = -W / 2;
    (function () {
      [0.9, 1.4, 1.9].forEach(function (y) { box(0.3, 0.04, 1.7, mWood, lz + 0.15, y, 0.1); [-0.6, 0.8].forEach(function (z) { box(0.04, 0.2, 0.02, mTrim, lz + 0.03, y - 0.1, z, null, false); }); });
      var sg = new THREE.Group(); sg.position.set(lz + 0.15, 0, 0.1); sg.rotation.y = 0; group.add(sg);
      var r = rnd(321); [0.92, 1.42, 1.92].forEach(function (y, si) { for (var k = 0; k < 7; k++) { var z = -0.7 + k * 0.23, t = (k + si) % 5; if (t === 0) jar(sg, 0, y + 0.0, z); else if (t === 1) can(sg, 0, y, z, k + si); else if (t === 2) bottle(sg, 0, y, z, k); else if (t === 3) boxItem(sg, 0, y, z, 0.1, 0.16, 0.08, k); else plates(sg, 0, y, z, 3, 0.09); } });
      solid(lz, lz + 0.32, -0.8, 0.9);
      var rail = cyl(0.01, 0.01, 1.0, mHandle, lz + 0.08, 1.62, -1.45); rail.rotation.x = Math.PI / 2;
      [-0.3, 0, 0.3].forEach(function (z, i) { var pan = cyl(0.1 + i * 0.01, 0.09, 0.025, mBlack, lz + 0.1, 1.44, -1.45 + z); pan.rotation.z = Math.PI / 2; box(0.01, 0.2, 0.02, mBlack, lz + 0.09, 1.56, -1.45 + z, null, false); });
    })();

    // ---------- right wall: window, table ----------
    (function () {
      var rx = W / 2;
      var win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), new THREE.MeshBasicMaterial({ color: 0x0a1020 })); win.position.set(rx - 0.012, 1.55, -0.2); win.rotation.y = -Math.PI / 2; group.add(win);
      box(0.06, 0.05, 1.3, mTrim, rx - 0.05, 1.04, -0.2); box(0.04, 1.0, 0.05, mTrim, rx - 0.025, 1.55, -0.2); box(0.04, 0.05, 1.2, mTrim, rx - 0.025, 1.55, -0.2);
      box(0.05, 0.9, 0.05, mTrim, rx - 0.025, 1.55, -0.78); box(0.05, 0.9, 0.05, mTrim, rx - 0.025, 1.55, 0.38);
      var cur = new THREE.MeshStandardMaterial({ color: 0x2e1414, roughness: 0.95, side: THREE.DoubleSide }); box(0.04, 1.05, 0.28, cur, rx - 0.08, 1.55, -0.78); box(0.04, 0.7, 0.18, cur, rx - 0.08, 1.7, 0.3);
      var tg = new THREE.Group(); tg.position.set(1.0, 0, 0.5); group.add(tg);
      box(1.0, 0.05, 0.7, mWood, 0, 0.76, 0, tg); [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]].forEach(function (p) { box(0.05, 0.74, 0.05, mWood, p[0], 0.37, p[1], tg); });
      solid(1.0 - 0.52, 1.0 + 0.52, 0.5 - 0.37, 0.5 + 0.37);
      plates(tg, 0.1, 0.785, 0.05, 2, 0.09); bottle(tg, -0.25, 0.785, -0.1, 1); rag(tg, 0.3, 0.785, 0.1);
      var c = new THREE.Group(); c.position.set(-0.75, 0, 0.62); c.rotation.set(0, 0.6, 0); tg.add(c); // toppled chair
      box(0.42, 0.04, 0.42, mWood, 0, 0.45, 0, c); box(0.42, 0.45, 0.04, mWood, 0, 0.7, -0.19, c);
      var c2 = new THREE.Group(); c2.position.set(-0.2, 0, -0.55); c2.rotation.y = Math.PI; tg.add(c2); box(0.42, 0.04, 0.42, mWood, 0, 0.45, 0, c2); box(0.42, 0.45, 0.04, mWood, 0, 0.7, -0.19, c2); [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach(function (p) { box(0.04, 0.45, 0.04, mWood, p[0], 0.22, p[1], c2); });
      solid(0.0, 0.5, 0.85, 1.35); solid(0.55, 1.05, -0.3, 0.1);
    })();
    if (opt.wallClock === true) (function () { var c = cyl(0.17, 0.17, 0.03, mPlate, 0.4, 2.3, bz + 0.02); c.rotation.x = Math.PI / 2; box(0.01, 0.12, 0.01, mBlack, 0.4, 2.33, bz + 0.04, null, false); box(0.08, 0.01, 0.01, mBlack, 0.43, 2.3, bz + 0.04, null, false);
      cyl(0.17, 0.14, 0.45, std(null, { color: 0x1f2a22, rough: 0.7 }), W / 2 - 0.3, 0.22, bz + 0.35); solid(W / 2 - 0.5, W / 2, bz, bz + 0.55); })();

    // ---------- decals: grime, damp, rust, cobwebs, cracks, blood (separate layers, the Poly Haven textures stay sharp) ----------
    function decalTex(w, h, paint) { return canvasTex(w, h, paint); }
    function decal(tex, w, h, x, y, z, ry, rx, op) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, opacity: op === undefined ? 1 : op, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; m.renderOrder = 2; group.add(m); return m;
    }
    var grime = decalTex(1024, 256, function (g, w, h) {
      var r = rnd(7), gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(8,6,4,0.8)'); gr.addColorStop(0.35, 'rgba(14,10,6,0.45)'); gr.addColorStop(1, 'rgba(14,10,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 90; i++) { var x = r() * w, y = h * (0.2 + r() * 0.6), rad = 10 + r() * 38, b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(10,8,5,' + (0.12 + r() * 0.2) + ')'); b.addColorStop(1, 'rgba(10,8,5,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    });
    var gh = 0.85; decal(grime, W - 0.02, gh, 0, gh / 2 + 0.1, -D / 2 + 0.006, 0); decal(grime, D - 0.02, gh, -W / 2 + 0.006, gh / 2 + 0.1, 0, Math.PI / 2); decal(grime, D - 0.02, gh, W / 2 - 0.006, gh / 2 + 0.1, 0, -Math.PI / 2); decal(grime, W - 0.02, gh, 0, gh / 2 + 0.1, D / 2 - 0.006, Math.PI);
    var leak = decalTex(256, 512, function (g, w, h) {
      var r = rnd(21); for (var k = 0; k < 4; k++) { var x = w * (0.2 + r() * 0.6), len = h * (0.5 + r() * 0.45), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(40,30,12,0.55)'); gr.addColorStop(1, 'rgba(40,30,12,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 4 - r() * 20, 0); g.lineTo(x + 4 + r() * 20, 0); g.lineTo(x + 3, len); g.lineTo(x - 3, len); g.fill(); }
      var b = g.createRadialGradient(w / 2, 20, 0, w / 2, 20, 90); b.addColorStop(0, 'rgba(30,22,8,0.6)'); b.addColorStop(1, 'rgba(30,22,8,0)'); g.fillStyle = b; g.fillRect(0, 0, w, 200);
    });
    decal(leak, 0.9, 1.7, -0.3, H - 0.85, -D / 2 + 0.007, 0, 0, 0.9); decal(leak, 0.8, 1.5, -W / 2 + 0.007, H - 0.8, 1.1, Math.PI / 2, 0, 0.9); decal(leak, 0.7, 1.4, W / 2 - 0.007, H - 0.75, 1.0, -Math.PI / 2, 0, 0.85);
    // rust run-off below the tap and the stove hood, onto the tiles
    var rust = decalTex(256, 256, function (g, w, h) { var r = rnd(61); for (var k = 0; k < 7; k++) { var x = w * (0.15 + r() * 0.7), len = h * (0.4 + r() * 0.6), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(120,52,16,0.75)'); gr.addColorStop(1, 'rgba(120,52,16,0)'); g.fillStyle = gr; g.fillRect(x - 3 - r() * 6, 0, 6 + r() * 12, len); } });
    decal(rust, 0.4, 0.6, skx + 0.28, 1.2, bz + 0.012, 0, 0, 0.9); decal(rust, 0.5, 0.5, sx, 1.55, bz + 0.012, 0, 0, 0.8);
    // cobwebs: spokes and arcs from a corner
    var web = decalTex(256, 256, function (g, w, h) { g.strokeStyle = 'rgba(225,225,215,0.55)'; g.lineWidth = 1.2; for (var i = 0; i <= 6; i++) { var a = i / 6 * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); g.stroke(); } for (var r = 1; r <= 7; r++) { g.beginPath(); for (var k = 0; k <= 6; k++) { var a2 = k / 6 * Math.PI / 2, rr = r * 34 - (k % 2 ? 6 : 0) + Math.sin(k * 1.3 + r) * 3; var px = Math.cos(a2) * rr, py = Math.sin(a2) * rr; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); } });
    function cobweb(x, y, z, ry, sx, sy, s) { var m = decal(web, s, s, x, y, z, ry, 0, 0.9); m.scale.set(sx, sy, 1); m.position.x += sx * s / 2 * Math.cos(ry); m.position.z += -sx * s / 2 * Math.sin(ry); m.position.y += sy * -s / 2; return m; }
    cobweb(-W / 2 + 0.01, H - 0.01, bz + 0.012, 0, 1, 1, 0.9); cobweb(W / 2 - 0.01, H - 0.01, bz + 0.012, 0, -1, 1, 0.8); cobweb(-W / 2 + 0.012, H - 0.01, bz + 0.01, Math.PI / 2, -1, 1, 0.7);
    cobweb(-1.65, 2.23, bz + 0.37, 0, 1, 1, 0.35); cobweb(W / 2 - 0.01, H - 0.01, D / 2 - 0.012, Math.PI, 1, 1, 0.85); cobweb(-W / 2 + 0.014, 1.95, 0.9, Math.PI / 2, 1, 1, 0.3);
    // cracked floor tiles
    var crack = decalTex(512, 512, function (g, w, h) { var r = rnd(77); g.strokeStyle = 'rgba(10,8,6,0.9)'; g.lineWidth = 2.2; function seg(x, y, a, n) { g.beginPath(); g.moveTo(x, y); for (var i = 0; i < n; i++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * (14 + r() * 24); y += Math.sin(a) * (14 + r() * 24); g.lineTo(x, y); if (r() < 0.22) seg(x, y, a + (r() < 0.5 ? 1 : -1), 4 + Math.floor(r() * 4)); } g.stroke(); } seg(260, 40, 1.5, 14); seg(120, 300, 0.4, 9); });
    decal(crack, 1.2, 1.2, 0.2, 0.003, 1.0, 0, -Math.PI / 2, 0.9); decal(crack, 1.0, 1.0, -1.6, 0.003, 0.2, 0, -Math.PI / 2, 0.9);
    // cracked window pane
    var wc = decalTex(256, 256, function (g, w, h) { g.strokeStyle = 'rgba(210,225,255,0.75)'; g.lineWidth = 1.5; var cx2 = 140, cy2 = 110, r = rnd(5); for (var i = 0; i < 9; i++) { var a = i / 9 * 6.283 + r() * 0.3, x = cx2, y = cy2; g.beginPath(); g.moveTo(x, y); for (var k = 0; k < 5; k++) { a += (r() - 0.5) * 0.4; x += Math.cos(a) * 28; y += Math.sin(a) * 28; g.lineTo(x, y); } g.stroke(); } });
    decal(wc, 1.1, 0.9, W / 2 - 0.016, 1.55, -0.2, -Math.PI / 2, 0, 0.9);
    // sparse blood: splatter with drips on the front wall left of the door, and a drag smear on the floor
    var blood = decalTex(512, 512, function (g, w, h) {
      var r = rnd(99); g.fillStyle = 'rgba(88,6,6,0.92)';
      for (var i = 0; i < 26; i++) { var a = r() * 6.283, d = r() * 120, x = w / 2 + Math.cos(a) * d, y = 160 + Math.sin(a) * d * 0.7, rad = 3 + r() * (d < 40 ? 22 : 9); g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill(); }
      for (var j = 0; j < 7; j++) { var x2 = w / 2 - 70 + j * 24 + r() * 10, len = 80 + r() * 230; g.fillRect(x2 - 2.5, 150, 5, len); g.beginPath(); g.arc(x2, 150 + len, 5.5, 0, 6.283); g.fill(); }
    });
    decal(blood, 0.8, 0.8, -2.1, 1.5, D / 2 - 0.007, Math.PI, 0, 1);
    var smear = decalTex(256, 512, function (g, w, h) {
      var r = rnd(5); g.fillStyle = 'rgba(80,5,5,0.85)'; for (var i = 0; i < 40; i++) { var t = i / 40, x = w * (0.35 + 0.3 * Math.sin(t * 3)), y = h * (0.05 + 0.9 * t), rad = 12 + r() * 14 - t * 6; g.beginPath(); g.ellipse(x + (r() - 0.5) * 14, y, rad, rad * 1.4, 0, 0, 6.283); g.fill(); }
      for (var k = 0; k < 10; k++) { g.beginPath(); g.arc(w * r(), h * r(), 2 + r() * 6, 0, 6.283); g.fill(); }
    });
    decal(smear, 0.5, 1.5, -0.8, 0.004, 1.3, 0, -Math.PI / 2, 0.9).rotation.z = 0.3;

    // ---------- eerie props and details (v0.3) ----------
    var mDoll = std(aged(71, '#c9b9a2', { rust: 0, dark: 1.4 }), { rough: 0.8 }), mDress = std(aged(73, '#5a4a52', { rust: 0, dark: 1.6 }), { rough: 0.95 }), mEye = new THREE.MeshBasicMaterial({ color: 0x050505 });
    function doll(x, y, z, ry, tilt) { if (!FIG) return new THREE.Group(); var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; group.add(g);
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.2, 10), mDress); body.position.y = 0.1; g.add(body);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 12), mDoll); head.position.y = 0.26; head.rotation.z = tilt; g.add(head);
      [-0.022, 0.022].forEach(function (ex) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), mEye); e.position.set(ex, 0.012, 0.052); head.add(e); });
      [-1, 1].forEach(function (sd) { var a = box(0.02, 0.12, 0.02, mDoll, sd * 0.07, 0.12, 0.02, g, false); a.rotation.z = sd * 0.5; }); return g; }
    doll(0.75, 0.785, 0.4, Math.atan2(dx - 0.75, D / 2 - 0.4), 0.25);
    box(0.14, 0.08, 0.1, mWood, 1.2, 0.825, 0.5, null, false); box(0.14, 0.015, 0.1, mWood, 1.2, 0.87, 0.5, null, false).rotation.x = -0.9;
    doll(lz + 0.15, 0.94, -0.45, Math.PI / 2, 0.0); doll(lz + 0.15, 1.44, 0.55, Math.PI / 2 + 0.3, -0.35); doll(lz + 0.15, 1.94, 0.0, Math.PI / 2 - 0.2, 0.5);
    [-0.06, 0.06].forEach(function (o) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff3018 })); e.position.set(skx + 0.18 + o, 0.34, cz - 0.2); group.add(e); });
    var hands = decalTex(512, 256, function (g, w, h) { var r = rnd(8); g.fillStyle = 'rgba(70,5,5,0.85)'; for (var k = 0; k < 5; k++) { var x = 60 + k * 95 + r() * 20, y = 80 + r() * 90 - k * 4, a = (r() - 0.5) * 0.5; g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-20, 0, 40, 52); [-22, -11, 0, 11, 22].forEach(function (fx, i) { g.fillRect(fx - 4, -34 + Math.abs(i - 2) * 9, 8, 36); }); g.fillRect(-34, 8, 14, 8); g.fillRect(-10, 52, 20, 100 * r()); g.restore(); } });
    decal(hands, 0.9, 0.45, -W / 2 + 0.008, 1.1, -1.1, Math.PI / 2, 0, 0.95);
    var tally = decalTex(256, 128, function (g, w, h) { g.strokeStyle = 'rgba(15,10,8,0.9)'; g.lineWidth = 3; for (var b = 0; b < 4; b++) { for (var i = 0; i < 4; i++) { g.beginPath(); g.moveTo(14 + b * 60 + i * 9, 20); g.lineTo(14 + b * 60 + i * 9 + 1, 80); g.stroke(); } g.beginPath(); g.moveTo(8 + b * 60, 70); g.lineTo(50 + b * 60, 28); g.stroke(); } });
    decal(tally, 0.7, 0.35, W / 2 - 0.01, 1.0, -1.45, -Math.PI / 2, 0, 0.9);
    var msg = decalTex(512, 128, function (g, w, h) { g.fillStyle = 'rgba(95,6,6,0.9)'; g.font = 'bold 74px serif'; g.textAlign = 'center'; g.direction = 'rtl'; g.fillText('نامي يا صغيرتي', w / 2, 86); for (var i = 0; i < 9; i++) g.fillRect(40 + (i * 53) % 430, 70, 3, 20 + (i * 17) % 38); });
    decal(msg, 1.5, 0.375, 0.9, 2.0, D / 2 - 0.009, Math.PI, 0, 0.95);
    var drw = decalTex(128, 160, function (g, w, h) { g.fillStyle = '#9a8e6e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a1a10'; g.lineWidth = 3; g.beginPath(); g.arc(64, 50, 16, 0, 6.283); g.moveTo(64, 66); g.lineTo(64, 115); g.moveTo(64, 80); g.lineTo(38, 100); g.moveTo(64, 80); g.lineTo(90, 100); g.moveTo(64, 115); g.lineTo(46, 150); g.moveTo(64, 115); g.lineTo(84, 150); g.stroke(); g.fillStyle = '#7a0a0a'; g.fillRect(55, 45, 6, 6); g.fillRect(68, 45, 6, 6); g.fillRect(40, 20, 50, 4); });
    if (FIG) { decal(drw, 0.24, 0.3, W / 2 - 0.01, 1.5, 0.9, -Math.PI / 2, 0, 1); decal(drw, 0.2, 0.25, W / 2 - 0.01, 1.35, 1.25, -Math.PI / 2, 0, 1).rotation.z = 0.12; }
    cyl(0.008, 0.008, 0.9, mRag, 0.5, H - 0.45, 0.0); (function () { var sh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 1, metalness: 0 })); sh.position.set(0.5, 1.55, 0.0); group.add(sh); })();
    solid(0.45, 0.55, -0.05, 0.05);

    // ---------- lights (one shadow-casting light only, for performance) ----------
    var fl = new THREE.Group(); group.add(fl);
    box(1.2, 0.05, 0.2, new THREE.MeshStandardMaterial({ color: 0x555048, roughness: 0.7 }), 0, H - 0.03, 0.0, fl, false);
    var tube = box(1.1, 0.025, 0.1, new THREE.MeshBasicMaterial({ color: 0xe8f2ff }), 0, H - 0.062, 0, fl, false);
    var lamp = new THREE.PointLight(0xcfe0c4, 0.34, 8, 2); lamp.position.set(0, H - 0.25, 0.1); lamp.castShadow = true; lamp.shadow.mapSize.set(q === '1k' ? 512 : 1024, q === '1k' ? 512 : 1024); lamp.shadow.bias = -0.0008; group.add(lamp);
    var moon = new THREE.DirectionalLight(0x5a70b0, 0.07); moon.position.set(W / 2 + 2, 3, -0.2); moon.target.position.set(0, 0.5, 0); group.add(moon, moon.target);
    var hemi = new THREE.HemisphereLight(0x4a5470, 0x100c0a, 0.025); group.add(hemi);
    var under = new THREE.PointLight(0xffe6c0, 0.04, 2.5, 2); under.position.set(sx, 1.5, bz + 0.3); group.add(under);
    // fluorescent flicker with real blackouts; a dark figure shows for a split second when the light returns
    var burst = 0, gap = 3, black = 0, fig = null, figSpots = [[-2.1, 1.7], [2.3, -0.9], [0.6, -1.6]], figT = 0, scareCb = opt.onScare, A = null;
    var figTex = canvasTex(128, 320, function (g, w, h) { g.fillStyle = '#000'; g.beginPath(); g.arc(64, 38, 24, 0, 6.283); g.fill(); g.fillRect(36, 58, 56, 150); g.fillRect(24, 62, 14, 130); g.fillRect(90, 62, 14, 130); g.fillRect(40, 200, 20, 120); g.fillRect(68, 200, 20, 120); g.fillStyle = 'rgba(200,20,10,0.9)'; g.fillRect(52, 34, 6, 4); g.fillRect(70, 34, 6, 4); });
    fig = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.7), new THREE.MeshBasicMaterial({ map: figTex, transparent: true, depthWrite: false })); fig.visible = false; fig.position.y = 0.85; if (FIG) group.add(fig);
    group.userData.camX = 0; group.userData.camZ = 0;
    function thump() { if (!A) return; var o = A.ctx.createOscillator(), g = A.ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(70, A.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(28, A.ctx.currentTime + 0.5); g.gain.setValueAtTime(0.5, A.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, A.ctx.currentTime + 0.6); o.connect(g); g.connect(A.ctx.destination); o.start(); o.stop(A.ctx.currentTime + 0.7); }
    function enableAudio() { // call from a user gesture. Fluorescent hum + low drone; the hum follows the light.
      if (A) return; var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; var ctx = new AC(); if (ctx.resume) ctx.resume();
      var hum = ctx.createOscillator(), hg = ctx.createGain(), dr = ctx.createOscillator(), dg = ctx.createGain(); hum.type = 'sawtooth'; hum.frequency.value = 100; hg.gain.value = 0.012; dr.type = 'sine'; dr.frequency.value = 43; dg.gain.value = 0.05;
      hum.connect(hg); hg.connect(ctx.destination); dr.connect(dg); dg.connect(ctx.destination); hum.start(); dr.start(); A = { ctx: ctx, hg: hg };
    }
    flick.push(function (dt) {
      if (group.userData.freeze) { lamp.intensity = 0.34; if (group.userData.showFig) { fig.position.set(2.2, 0.85, -0.9); fig.rotation.y = Math.atan2(group.userData.camX - 2.2, group.userData.camZ + 0.9); fig.visible = true; figT = 0; } else fig.visible = false; return; }
      var v = 1; gap -= dt;
      if (black > 0) { black -= dt; v = 0; if (black <= 0) { gap = 3 + Math.random() * 6; if (Math.random() < 0.6) { var p = figSpots[Math.floor(Math.random() * figSpots.length)]; fig.position.set(p[0], 0.85, p[1]); fig.rotation.y = Math.atan2(group.userData.camX - p[0], group.userData.camZ - p[1]); fig.visible = true; figT = 0.35; } } }
      else if (burst > 0) { burst -= dt; v = Math.random() < 0.55 ? 0.03 : 0.8; if (burst <= 0) { black = 0.5 + Math.random() * 1.6; thump(); if (scareCb) scareCb(); } }
      else if (gap <= 0) burst = 0.35 + Math.random() * 0.6;
      if (figT > 0) { figT -= dt; if (figT <= 0) fig.visible = false; }
      lamp.intensity = 0.34 * v; tube.material.color.setScalar(0.04 + 0.5 * v).multiply(new THREE.Color(0.9, 0.95, 1)); if (A) A.hg.gain.value = 0.012 * (v > 0.5 ? 1 : 0.15);
    });

    // generated environment map for reflections (no download)
    if (opt.renderer && THREE.PMREMGenerator) {
      var es = new THREE.Scene(); es.background = new THREE.Color(0x1b1d24);
      var eb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); eb.position.set(0, 3, 0); es.add(eb);
      var ew = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicMaterial({ color: 0x4a5a88 })); ew.position.set(5, 1.5, 0); ew.rotation.y = -Math.PI / 2; es.add(ew);
      var pm = new THREE.PMREMGenerator(opt.renderer); group.userData.env = pm.fromScene(es, 0.04).texture; pm.dispose();
    }

    // ---------- API ----------
    function byName(n) { for (var i = 0; i < interactives.length; i++) if (interactives[i].name === n) return interactives[i]; return null; }
    function update(dt) {
      for (var i = 0; i < interactives.length; i++) {
        var it = interactives[i], goal = it.open ? 1 : 0; it.t += (goal - it.t) * Math.min(1, dt * 6);
        if (Math.abs(goal - it.t) < 0.001) it.t = goal; var e = it.t * it.t * (3 - 2 * it.t);
        if (it.kind === 'v') it.object.rotation.y = it.c + (it.target - it.c) * e; else if (it.kind === 'h') it.object.rotation.x = it.target * e; else it.object.position.z = it.base + it.target * e;
      }
      for (var f = 0; f < flick.length; f++) flick[f](dt);
    }
    function pick(ray, maxDist) {
      var meshes = interactives.map(function (i) { return i.mesh; }), hits = ray.intersectObjects(meshes, false);
      if (!hits.length || hits[0].distance > (maxDist || 2.4)) return null;
      for (var i = 0; i < interactives.length; i++) if (interactives[i].mesh === hits[0].object) return interactives[i];
      return null;
    }
    group.traverse(function (o) { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && group.userData.env) o.material.envMap = group.userData.env; });
    return {
      group: group, interactives: interactives, colliders: colliders, update: update, pick: pick,
      toggle: function (n) { var it = byName(n); if (it) it.open = !it.open; return it; }, open: function (n) { var it = byName(n); if (it) it.open = true; }, close: function (n) { var it = byName(n); if (it) it.open = false; },
      bounds: { minX: -W / 2 + 0.25, maxX: W / 2 - 0.25, minZ: -D / 2 + 0.25, maxZ: D / 2 + 0.6, height: H },
      spawn: { x: dx, z: D / 2 - 0.5, yaw: Math.PI }, exitDoor: { x: dx, z: D / 2 },
      enableAudio: enableAudio, debug: function (freeze, showFig) { group.userData.freeze = freeze; group.userData.showFig = showFig; }, setCamera: function (x, z) { group.userData.camX = x; group.userData.camZ = z; }, size: { w: W, d: D, h: H }, progress: progress, license: 'Textures: Poly Haven, CC0', version: '0.3'
    };
  }
  root.KitchenModule = { build: build, version: '0.3' };
})(typeof window !== 'undefined' ? window : this);
