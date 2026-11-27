/* bathroom.js  -  standalone decayed horror bathroom module (own scene, own code, no dependency on any other game file).  v0.1
 * Needs only three.js r128 (global THREE).
 *
 *   var B = BathroomModule.build(THREE, { quality: '1k' | '2k' (default) | '4k', floorTexSize: m per floor texture (default 0.9), wallTexSize: m per plaster texture (default 1.4),
 *                                         tileTexSize: m per wall tile texture (default 0.6), renderer, onProgress: fn(done,total), onScare: fn() });
 *   scene.add(B.group);  B.update(dt);                 // every frame
 *   B.toggle(name) / B.open(name) / B.close(name);  B.interactives  // [{name,label,object,open}] doors, cabinets, drawers, the room door
 *   B.pick(raycaster, maxDist)  -> interactive or null;  B.colliders -> AABBs [{minX,maxX,minZ,maxZ}];  B.bounds;  B.spawn {x,z,yaw};  B.exitDoor {x,z}
 *   B.setCamera(x, z)           // tell the module where the player is (used for the scare figure and the heartbeat)
 *   B.audio.start()             // call from a user gesture; procedural sound (no audio files): drone, flicker buzz, heartbeat, drips, creaks, stingers
 *   B.audio.setFear(0..1) / B.audio.stinger() / B.audio.creak()
 * Option lamps: 1 -> single-lamp variant (one ceiling lamp, default keeps the three lamps).
 * Option figures: true -> dolls, wall portraits, flicker figure and visitor are built (default false: none of them).
 * Floor: checkerboard near-black / dark brownish off-white, square size opt.checkerSize (metres, default 0.25), colours opt.checkerColorA / opt.checkerColorB (CSS strings).
 * Textures: Poly Haven (CC0) loaded lazily from dl.polyhaven.org: brown_floor_tiles (floor), long_white_tiles (tinted dark grey-green, lower walls), damaged_plaster (upper walls, ceiling), dark_wood.
 * Everything else (tub, toilet, props, grime, cracks, blood, cobwebs) is generated in code.
 */
(function (root) {
  'use strict';
  var PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/';
  var W = 7, D = 5.5, H = 2.7, TH = 1.5; // room: width x, depth z, height; TH = tiled height of the walls
  // ===== TEXTURE CONFIG ('size' = real-world metres covered by one texture image; all adjustable) =====
  var TEX = {
    floor: { id: 'brown_floor_tiles', size: 0.9, tint: 0x9a928a, rough: 0.5 },
    wall:  { id: 'damaged_plaster',   size: 1.4, tint: 0x8c877e, rough: 0.95, nor: 1.2 },
    tiles: { id: 'long_white_tiles',  size: 0.6, tint: 0x46564c, rough: 0.3 },   // dark grey-green tinted tiles
    ceil:  { id: 'damaged_plaster',   size: 1.4, tint: 0x5a5750, rough: 1.0 },
    wood:  { id: 'dark_wood',         size: 1.0, tint: 0x9a8576, rough: 0.6 }
  };

  function build(THREE, opt) {
    opt = opt || {};
    var FIG = opt.figures === true;   // human-like figures (dolls, portraits, flicker figure, visitor) are OFF unless { figures: true }
    var q = opt.quality || '2k'; if (opt.floorTexSize) TEX.floor.size = opt.floorTexSize; if (opt.wallTexSize) TEX.wall.size = opt.wallTexSize; if (opt.tileTexSize) TEX.tiles.size = opt.tileTexSize;
    var maxAniso = opt.renderer ? opt.renderer.capabilities.getMaxAnisotropy() : 4;
    var group = new THREE.Group(); group.name = 'bathroom';
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

    // ---------- shared PBR materials (uv scaled in metres so one texture set serves every wall piece) ----------
    // checkerboard floor: near-black / dark brownish off-white (opt.checkerColorA, opt.checkerColorB), flat colours, one square = opt.checkerSize metres (default 0.25)
    function checkerMat(surfW, surfH) {
      var S = opt.checkerSize || 0.25, c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
      g.fillStyle = opt.checkerColorA || '#060806'; g.fillRect(0, 0, 512, 512); g.fillStyle = opt.checkerColorB || '#8a7d6a'; g.fillRect(256, 0, 256, 256); g.fillRect(0, 256, 256, 256);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(surfW / (2 * S), surfH / (2 * S)); t.anisotropy = Math.min(16, maxAniso); t.encoding = THREE.sRGBEncoding; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0, envMapIntensity: 0.05 });   // matte
    }
    var mFloor = checkerMat(1, 1), mPlaster = pbr(TEX.wall, 1, 1, 0x8d887e), mTile = pbr(TEX.tiles, 1, 1, 0x3e4a42), mCeil = pbr(TEX.ceil, 1, 1, 0x55524c);
    var mWood = pbr(TEX.wood, 1, 1, 0x4a3020), mWoodDoor = mWood;
    var mDoorM = std(aged(81, '#35271e', { rust: 0, dark: 1.6 }), { rough: 0.8 });
    var mTub = std(aged(91, '#bdb59c', { rust: 0.9, dark: 1.3 }), { rough: 0.35 });
    var mDirty = std(aged(93, '#3a3a2c', { rust: 0.6, dark: 1.8 }), { rough: 0.5 });
    function plane(w, h, mat, x, y, z, rx, ry) { var g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); var m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; group.add(m); return m; }
    function wallGroup(x, z, ry) { var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; group.add(g); return g; } // local +z points into the room

    // ---------- shell ----------
    plane(W, D, mFloor, 0, 0, 0, -Math.PI / 2, 0); plane(W, D, mCeil, 0, H, 0, Math.PI / 2, 0);
    function wallPair(len, cx, cz, ry) { var dxn = Math.cos(ry), dzn = -Math.sin(ry); // wall of length len centred at cx,cz facing ry
      plane(len, TH, mTile, cx, TH / 2, cz, 0, ry); plane(len, H - TH, mPlaster, cx, TH + (H - TH) / 2, cz, 0, ry); }
    wallPair(W, 0, -D / 2, 0); wallPair(D, -W / 2, 0, Math.PI / 2); wallPair(D, W / 2, 0, -Math.PI / 2);
    var dx = -2.3, dw = 0.95, dh = 2.05;
    (function () { var l = (dx - dw / 2) + W / 2, r = W / 2 - (dx + dw / 2);
      wallPair(l, -W / 2 + l / 2, D / 2, Math.PI); wallPair(r, W / 2 - r / 2, D / 2, Math.PI); plane(dw, H - dh, mPlaster, dx, dh + (H - dh) / 2, D / 2, 0, Math.PI);
      box(0.08, dh, 0.12, mTrim, dx - dw / 2 - 0.04, dh / 2, D / 2 - 0.02); box(0.08, dh, 0.12, mTrim, dx + dw / 2 + 0.04, dh / 2, D / 2 - 0.02); box(dw + 0.16, 0.08, 0.12, mTrim, dx, dh + 0.04, D / 2 - 0.02);
    })();
    // tile cap strip and skirting
    [[W, 0, -D / 2 + 0.012, 0], [D, -W / 2 + 0.012, 0, Math.PI / 2], [D, W / 2 - 0.012, 0, Math.PI / 2]].forEach(function (s) { var c = box(s[0], 0.04, 0.025, mTrim, s[1], TH, s[2], null, false); c.rotation.y = s[3]; });
    // the room door (hinged on its right edge, opens into the room)
    door('door', 'الباب', dw - 0.02, dh, 0.045, mDoorM, dx + dw / 2, dh / 2, D / 2 - 0.02, 'right', 'v', null, 'bar-v', { rev: true });
    var bz = -D / 2, lz = -W / 2, rz = W / 2;

    // ---------- bathtub with murky water, curtain, rubber duck, a hand under the surface ----------
    var tbx = -2.2, tbz = bz + 0.43, tl = 1.75, tw = 0.8, th = 0.56;
    (function () {
      box(tl, th, 0.07, mTub, tbx, th / 2, tbz + tw / 2 - 0.035); box(tl, th, 0.07, mTub, tbx, th / 2, tbz - tw / 2 + 0.035); box(0.07, th, tw, mTub, tbx - tl / 2 + 0.035, th / 2, tbz); box(0.07, th, tw, mTub, tbx + tl / 2 - 0.035, th / 2, tbz); box(tl, 0.1, tw, mTub, tbx, 0.05, tbz);
      box(tl - 0.14, 0.01, tw - 0.14, mDirty, tbx, 0.105, tbz, null, false);
      var wt = new THREE.Mesh(new THREE.PlaneGeometry(tl - 0.16, tw - 0.16), new THREE.MeshStandardMaterial({ color: 0x141c12, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.9, envMapIntensity: 1.5 })); wt.rotation.x = -Math.PI / 2; wt.position.set(tbx, 0.36, tbz); group.add(wt);
      solid(tbx - tl / 2, tbx + tl / 2, tbz - tw / 2, tbz + tw / 2);
      cyl(0.02, 0.02, 0.2, mHandle, tbx - tl / 2 + 0.14, th + 0.1, bz + 0.1); var sp = box(0.03, 0.03, 0.14, mHandle, tbx - tl / 2 + 0.14, th + 0.2, bz + 0.17, null, false);
      var yel = new THREE.MeshStandardMaterial({ color: 0xb8a030, roughness: 0.4 }); var db = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), yel); db.scale.set(1, 0.8, 1.2); db.position.set(tbx + 0.35, 0.39, tbz + 0.08); group.add(db);
      var dh2 = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), yel); dh2.position.set(tbx + 0.35, 0.45, tbz + 0.14); group.add(dh2); box(0.03, 0.012, 0.03, new THREE.MeshStandardMaterial({ color: 0x8a4a10 }), tbx + 0.35, 0.445, tbz + 0.18, null, false);
      if (FIG) { var arm = cyl(0.025, 0.02, 0.4, mDoll0(), tbx - 0.3, 0.37, tbz - 0.05); arm.rotation.z = 1.3; arm.rotation.y = 0.4; [-0.03, -0.01, 0.01, 0.03].forEach(function (o, i) { var f = cyl(0.006, 0.006, 0.07, mDoll0(), tbx - 0.12 + i * 0.002, 0.405, tbz - 0.07 + o, null, 5); f.rotation.z = 1.3 + i * 0.05; }); }
      var rod = cyl(0.012, 0.012, tl + 0.15, mHandle, tbx, 1.95, tbz + tw / 2 + 0.05); rod.rotation.z = Math.PI / 2;
      var ct = canvasTex(256, 512, function (g, w, h) { var r = rnd(5); g.fillStyle = '#566456'; g.fillRect(0, 0, w, h); for (var f = 0; f < 10; f++) { var gr = g.createLinearGradient(f * 26, 0, f * 26 + 26, 0); gr.addColorStop(0, 'rgba(0,0,0,0.0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(f * 26, 0, 26, h); }
        for (var i = 0; i < 40; i++) { var x = r() * w, y = r() * h, rad = 10 + r() * 40, b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(20,20,10,' + (0.2 + r() * 0.3) + ')'); b.addColorStop(1, 'rgba(20,20,10,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
        g.fillStyle = 'rgba(95,8,8,0.8)'; for (var k = 0; k < 4; k++) { var hx = 60 + k * 45, hy = 200 + r() * 120; g.fillRect(hx - 12, hy, 24, 30); [-12, -4, 4, 12].forEach(function (fx, j) { g.fillRect(fx + hx - 3, hy - 22 + (j === 0 || j === 3 ? 8 : 0), 6, 24); }); g.fillRect(hx - 3, hy + 30, 6, 60 * r()); }
        var hm = g.createLinearGradient(0, h - 90, 0, h); hm.addColorStop(0, 'rgba(10,18,8,0)'); hm.addColorStop(1, 'rgba(10,18,8,0.8)'); g.fillStyle = hm; g.fillRect(0, h - 90, w, 90); });
      var cm = new THREE.MeshStandardMaterial({ map: ct, transparent: true, opacity: 0.93, roughness: 0.9, side: THREE.DoubleSide }); var cur = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.4), cm); cur.position.set(tbx + 0.2, 1.22, tbz + tw / 2 + 0.05); group.add(cur);
      for (var i = 0; i < 9; i++) { var rg = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 10), mHandle); rg.position.set(tbx - 0.35 + i * 0.12, 1.93, tbz + tw / 2 + 0.05); rg.rotation.y = Math.PI / 2; group.add(rg); }
    })();
    function mDoll0() { if (!mDoll0.m) mDoll0.m = std(aged(71, '#bdb0a0', { rust: 0, dark: 1.4 }), { rough: 0.7 }); return mDoll0.m; }

    // ---------- vanity with sink, cracked mirror cabinet ----------
    var vx = 0.6, vw = 0.95, vd = 0.5, vz = bz + vd / 2;
    (function () {
      var g = carcass(null, vw, 0.76, vd, mCarc, vx, 0.48, vz); solid(vx - vw / 2, vx + vw / 2, bz, bz + vd);
      box(vw + 0.01, 0.1, vd - 0.04, mBlack, vx, 0.05, vz + 0.02, null, false);
      shelf(g, vw, vd, -0.1); stock(g, vw - 0.04, vd, [-0.37, -0.092]);
      var fz = vz + vd / 2 + 0.01; box(vw, 0.04, vd + 0.03, mTop, vx, 0.88, vz + 0.015);
      drawer('vanityDrawer', 'درج', vw - 0.02, 0.16, 0.4, mDoorM, vx, 0.77, fz, null, 'rags');
      door('vanityL', 'باب الخزانة', vw / 2 - 0.01, 0.56, 0.022, mDoorM, vx - vw / 2 + 0.005, 0.38, fz, 'left', 'v', null, 'knob-top');
      door('vanityR', 'باب الخزانة', vw / 2 - 0.01, 0.56, 0.022, mDoorM, vx + vw / 2 - 0.005, 0.38, fz, 'right', 'v', null, 'knob-top', { ajar: 0.35 });
      var bs = cyl(0.2, 0.16, 0.05, mTub, vx, 0.915, vz + 0.02, null, 20); bs.scale.set(1.3, 1, 1); var ib = cyl(0.17, 0.14, 0.012, mDirty, vx, 0.94, vz + 0.02, null, 20); ib.scale.set(1.3, 1, 1);
      cyl(0.016, 0.018, 0.2, mHandle, vx, 0.99, bz + 0.1); var sp = box(0.02, 0.02, 0.12, mHandle, vx, 1.09, bz + 0.15, null, false);
      var mm = std(canvasTex(256, 256, function (g2, w, h) { var gr = g2.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#8fa09a'); gr.addColorStop(1, '#4a5652'); g2.fillStyle = gr; g2.fillRect(0, 0, w, h); for (var i = 0; i < 40; i++) { var x = Math.random() * w, y = Math.random() * h, rad = 6 + Math.random() * 30, b = g2.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(20,24,20,0.35)'); b.addColorStop(1, 'rgba(20,24,20,0)'); g2.fillStyle = b; g2.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
        g2.strokeStyle = 'rgba(235,245,240,0.9)'; g2.lineWidth = 2; var cx = 150, cy = 110, r = rnd(12); for (var k = 0; k < 13; k++) { var a = k / 13 * 6.283 + r() * 0.3, x = cx, y = cy; g2.beginPath(); g2.moveTo(x, y); for (var s = 0; s < 6; s++) { a += (r() - 0.5) * 0.5; x += Math.cos(a) * (26 + r() * 20); y += Math.sin(a) * (26 + r() * 20); g2.lineTo(x, y); } g2.stroke(); }
        g2.strokeStyle = 'rgba(40,2,2,0.9)'; g2.lineWidth = 4; g2.beginPath(); g2.moveTo(cx, cy); g2.lineTo(cx - 6, cy + 120); g2.stroke(); }), { rough: 0.12, metal: 0.75 });
      var mg = carcass(null, 0.7, 0.8, 0.14, mCarc, vx, 1.7, bz + 0.07); shelf(mg, 0.7, 0.14, 0.0); stock(mg, 0.66, 0.14, [-0.38, 0.008]);
      door('mirror', 'خزانة المرآة', 0.69, 0.78, 0.02, mm, vx - 0.35 + 0.005, 1.7, bz + 0.15, 'left', 'v', null, 'knob-bot');
      box(0.72, 0.82, 0.01, mTrim, vx, 1.7, bz + 0.005, null, false);
      can(group, vx - 0.3, 0.9, vz - 0.12, 3); bottle(group, vx + 0.32, 0.9, vz - 0.12, 0); plates(group, vx - 0.33, 0.9, vz + 0.12, 1, 0.04);
      // toothbrush cup and a razor
      cyl(0.03, 0.025, 0.09, mJar, vx + 0.3, 0.945, vz + 0.12, null, 10); box(0.015, 0.1, 0.01, mRed, vx + 0.3, 1.0, vz + 0.12, null, false); box(0.1, 0.01, 0.03, mSteel, vx - 0.2, 0.905, vz + 0.2, null, false);
    })();

    // ---------- toilet, plunger, cleaner bottle, paper holder ----------
    var tx = 2.1;
    (function () {
      box(0.5, 0.42, 0.2, mTub, tx, 0.74, bz + 0.12); box(0.54, 0.035, 0.24, mTub, tx, 0.965, bz + 0.12);
      var bowl = cyl(0.21, 0.15, 0.38, mTub, tx, 0.2, bz + 0.5, null, 20); bowl.scale.set(1, 1, 1.35); box(0.3, 0.2, 0.3, mTub, tx, 0.28, bz + 0.3);
      var seat = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 20), mWood); seat.rotation.x = Math.PI / 2; seat.scale.set(1, 1.3, 1); seat.position.set(tx, 0.4, bz + 0.5); group.add(seat);
      var wtr = cyl(0.17, 0.17, 0.01, mDirty, tx, 0.37, bz + 0.5, null, 16); wtr.scale.set(1, 1, 1.3);
      var lid = box(0.4, 0.03, 0.42, mWood, tx, 0.62, bz + 0.42); lid.rotation.x = -1.3; lid.position.set(tx, 0.7, bz + 0.27);
      solid(tx - 0.28, tx + 0.28, bz, bz + 0.8);
      box(0.012, 0.012, 0.12, mHandle, tx + 0.3, 1.0, bz + 0.1, null, false);
      var rh = box(0.14, 0.012, 0.012, mHandle, tx + 0.7, 0.9, bz + 0.03, null, false); cyl(0.05, 0.05, 0.1, mPaper, tx + 0.7, 0.9, bz + 0.07, null, 12).rotation.z = Math.PI / 2;
      var pl = cyl(0.012, 0.012, 0.55, mWood, tx + 0.65, 0.3, bz + 0.18, null, 6); pl.rotation.z = 0.12; var cup = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, 6.283, 0, 1.5), mRed); cup.position.set(tx + 0.7, 0.04, bz + 0.18); cup.rotation.x = Math.PI; cup.scale.set(1, 0.8, 1); group.add(cup);
      solid(tx + 0.6, tx + 0.8, bz, bz + 0.3);
      var cb = std(null, { color: 0x2a6a74, rough: 0.2 }); cb.transparent = true; cb.opacity = 0.85; cyl(0.045, 0.05, 0.22, cb, tx - 0.55, 0.11, bz + 0.2, null, 12); cyl(0.02, 0.04, 0.06, mRed, tx - 0.55, 0.25, bz + 0.2, null, 8); box(0.05, 0.03, 0.03, mRed, tx - 0.55, 0.285, bz + 0.22, null, false);
    })();

    // ---------- tall linen cabinet and low drawer cabinet on the left wall, first aid box on the right wall ----------
    (function () {
      var z0 = -0.3, wg = wallGroup(lz, z0, Math.PI / 2), lg = carcass(wg, 0.9, 1.9, 0.45, mCarc, 0, 0.95 + 0.03, 0.225); lg.position.y = 1.0;
      [-0.45, 0.0, 0.45].forEach(function (y) { shelf(lg, 0.9, 0.45, y); }); stock(lg, 0.86, 0.45, [-0.93, -0.44, 0.01, 0.46], 'plates');
      [-0.3, 0.2].forEach(function (z, i) { var r = rnd(400 + i); [-0.3, 0.0, 0.3].forEach(function (x, j) { var rg2 = box(0.18, 0.1, 0.22, mRag, x, -0.38 + 0.05 + (i * 0.45), -0.03, lg, false); rg2.rotation.y = r() - 0.5; }); });
      var fz = 0.46; door('linenL', 'خزانة المناشف', 0.445, 1.86, 0.02, mDoorM, -0.45, 1.0, fz, 'left', 'v', wg, 'knob-top'); door('linenR', 'خزانة المناشف', 0.445, 1.86, 0.02, mDoorM, 0.45, 1.0, fz, 'right', 'v', wg, 'knob-top', { ajar: 0.15 });
      solid(lz, lz + 0.47, z0 - 0.46, z0 + 0.46);
      var z1 = 1.5, g2 = wallGroup(lz, z1, Math.PI / 2); carcass(g2, 0.8, 0.76, 0.42, mCarc, 0, 0.48, 0.21); box(0.82, 0.04, 0.45, mTop, 0, 0.88, 0.22, g2); box(0.8, 0.1, 0.38, mBlack, 0, 0.05, 0.2, g2, false);
      drawer('drawer1', 'درج', 0.78, 0.22, 0.36, mDoorM, 0, 0.74, 0.43, g2, 'rags'); drawer('drawer2', 'درج', 0.78, 0.26, 0.36, mDoorM, 0, 0.49, 0.43, g2); drawer('drawer3', 'درج', 0.78, 0.22, 0.36, mDoorM, 0, 0.25, 0.43, g2, 'rags');
      solid(lz, lz + 0.46, z1 - 0.42, z1 + 0.42); // first aid box on the right wall
      var wr = wallGroup(rz, -1.0, -Math.PI / 2), fa = carcass(wr, 0.34, 0.26, 0.1, std(aged(95, '#c9c4b0', { rust: 0.5, dark: 1.2 }), { rough: 0.5 }), 0, 1.45, 0.05);
      stock(fa, 0.3, 0.1, [-0.11]); box(0.12, 0.06, 0.04, mRed, 0.0, -0.09, 0.0, fa, false); box(0.1, 0.04, 0.05, mPaper, 0.08, -0.09, 0.0, fa, false);
      var crs = canvasTex(64, 64, function (g, w, h) { g.fillStyle = '#c9c4b0'; g.fillRect(0, 0, w, h); g.fillStyle = '#8a1a14'; g.fillRect(24, 8, 16, 48); g.fillRect(8, 24, 48, 16); g.fillStyle = 'rgba(60,5,5,0.7)'; g.fillRect(10, 40, 8, 20); });
      door('firstaid', 'صندوق الإسعافات', 0.33, 0.25, 0.015, std(crs, { rough: 0.5 }), -0.17, 1.45, 0.105, 'left', 'v', wr, 'knob-bot');
      // small stool with a bucket and mop, and a hamper
      var hp = cyl(0.25, 0.22, 0.6, std(aged(97, '#4a3a2a', { rust: 0, dark: 1.4 }), { rough: 0.9 }), 3.0, 0.3, 1.9, null, 14); cyl(0.26, 0.26, 0.03, mWood, 3.0, 0.62, 1.9, null, 14); solid(2.72, 3.28, 1.62, 2.18);
      var bk = cyl(0.14, 0.11, 0.28, mSteel, 2.6, 0.14, 2.35, null, 12); cyl(0.12, 0.12, 0.01, mDirty, 2.6, 0.27, 2.35, null, 12); cyl(0.01, 0.01, 1.2, mWood, 2.55, 0.6, 2.45, null, 6).rotation.z = 0.15; solid(2.4, 2.8, 2.15, 2.55);
      var sc = box(0.34, 0.04, 0.3, mTub, -1.2, 0.02, 0.9, null, false); sc.rotation.y = 0.5;
    })();
    // window with bars (right wall) and a towel rail
    (function () { var wr = wallGroup(rz, 0.35, -Math.PI / 2); var win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55), new THREE.MeshBasicMaterial({ color: 0x080d18 })); win.position.set(0, 1.9, 0.012); wr.add(win);
      box(0.9, 0.05, 0.06, mTrim, 0, 1.6, 0.04, wr); box(0.9, 0.05, 0.06, mTrim, 0, 2.2, 0.04, wr); box(0.05, 0.6, 0.06, mTrim, -0.43, 1.9, 0.04, wr); box(0.05, 0.6, 0.06, mTrim, 0.43, 1.9, 0.04, wr); [-0.2, 0, 0.2].forEach(function (x) { box(0.015, 0.55, 0.015, mSteel, x, 1.9, 0.03, wr, false); });
      var tr = wallGroup(rz, -1.9, -Math.PI / 2); box(0.5, 0.015, 0.015, mHandle, 0, 1.2, 0.08, tr, false); box(0.34, 0.5, 0.012, mRag, 0.05, 0.95, 0.085, tr, false); })();
    // spare dolls' parts and clutter on the floor
    rag(group, -0.6, 0.0, 1.2); bottle(group, -1.0, 0.0, 0.2, 2); can(group, 1.2, 0.0, 0.4, 4); can(group, 1.3, 0.0, 0.5, 6); boxItem(group, 3.0, 0.0, -0.4, 0.3, 0.14, 0.2, 2);
    // wall shelf above the toilet with stocked items and an eyes-in-the-dark detail
    (function () { var sw = wallGroup(tx, bz, 0); box(0.9, 0.03, 0.18, mWood, 0, 1.55, 0.1, sw); [0.1, -0.1].forEach(function (z) { }); jar(sw, -0.25, 1.565, 0.1); bottle(sw, 0, 1.565, 0.1, 1); can(sw, 0.25, 1.565, 0.1, 5); })();

    // ---------- decals: grime, damp, rust, cobwebs, cracks, puddles, blood (separate layers, the Poly Haven textures stay sharp) ----------
    function decalTex(w, h, paint) { return canvasTex(w, h, paint); }
    function decal(tex, w, h, x, y, z, ry, rx, op) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, opacity: op === undefined ? 1 : op, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; m.renderOrder = 2; group.add(m); return m;
    }
    var grime = decalTex(1024, 256, function (g, w, h) {
      var r = rnd(7), gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(8,6,4,0.8)'); gr.addColorStop(0.35, 'rgba(14,10,6,0.45)'); gr.addColorStop(1, 'rgba(14,10,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 90; i++) { var x = r() * w, y = h * (0.2 + r() * 0.6), rad = 10 + r() * 38, b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(10,8,5,' + (0.12 + r() * 0.2) + ')'); b.addColorStop(1, 'rgba(10,8,5,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    });
    var gh = 0.9; decal(grime, W - 0.02, gh, 0, gh / 2 + 0.08, -D / 2 + 0.006, 0); decal(grime, D - 0.02, gh, -W / 2 + 0.006, gh / 2 + 0.08, 0, Math.PI / 2); decal(grime, D - 0.02, gh, W / 2 - 0.006, gh / 2 + 0.08, 0, -Math.PI / 2); decal(grime, W - 0.02, gh, 0, gh / 2 + 0.08, D / 2 - 0.006, Math.PI);
    var leak = decalTex(256, 512, function (g, w, h) {
      var r = rnd(21); for (var k = 0; k < 4; k++) { var x = w * (0.2 + r() * 0.6), len = h * (0.5 + r() * 0.45), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(40,30,12,0.6)'); gr.addColorStop(1, 'rgba(40,30,12,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 4 - r() * 20, 0); g.lineTo(x + 4 + r() * 20, 0); g.lineTo(x + 3, len); g.lineTo(x - 3, len); g.fill(); }
      var b = g.createRadialGradient(w / 2, 20, 0, w / 2, 20, 90); b.addColorStop(0, 'rgba(30,22,8,0.65)'); b.addColorStop(1, 'rgba(30,22,8,0)'); g.fillStyle = b; g.fillRect(0, 0, w, 200);
    });
    decal(leak, 1.0, 1.4, -0.4, H - 0.7, -D / 2 + 0.007, 0, 0, 0.95); decal(leak, 0.9, 1.3, -W / 2 + 0.007, H - 0.65, 1.2, Math.PI / 2, 0, 0.95); decal(leak, 0.9, 1.3, W / 2 - 0.007, H - 0.65, 0.9, -Math.PI / 2, 0, 0.9); decal(leak, 0.8, 1.2, 1.5, H - 0.6, D / 2 - 0.007, Math.PI, 0, 0.9);
    var rust = decalTex(256, 256, function (g, w, h) { var r = rnd(61); for (var k = 0; k < 7; k++) { var x = w * (0.15 + r() * 0.7), len = h * (0.4 + r() * 0.6), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(120,52,16,0.75)'); gr.addColorStop(1, 'rgba(120,52,16,0)'); g.fillStyle = gr; g.fillRect(x - 3 - r() * 6, 0, 6 + r() * 12, len); } });
    decal(rust, 0.4, 0.5, vx, 0.72, bz + 0.012, 0, 0, 0.9); decal(rust, 0.4, 0.5, tbx - tl / 2 + 0.14, 0.9, bz + 0.012, 0, 0, 0.85); decal(rust, 0.4, 0.5, tx, 0.7, bz + 0.012, 0, 0, 0.8);
    var web = decalTex(256, 256, function (g, w, h) { g.strokeStyle = 'rgba(225,225,215,0.55)'; g.lineWidth = 1.2; for (var i = 0; i <= 6; i++) { var a = i / 6 * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); g.stroke(); } for (var r = 1; r <= 7; r++) { g.beginPath(); for (var k = 0; k <= 6; k++) { var a2 = k / 6 * Math.PI / 2, rr = r * 34 - (k % 2 ? 6 : 0) + Math.sin(k * 1.3 + r) * 3; var px = Math.cos(a2) * rr, py = Math.sin(a2) * rr; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); } });
    function cobweb(x, y, z, ry, sx, sy, s) { var m = decal(web, s, s, x, y, z, ry, 0, 0.9); m.scale.set(sx, sy, 1); m.position.x += sx * s / 2 * Math.cos(ry); m.position.z += -sx * s / 2 * Math.sin(ry); m.position.y += sy * -s / 2; return m; }
    cobweb(-W / 2 + 0.01, H - 0.01, bz + 0.012, 0, 1, 1, 1.0); cobweb(W / 2 - 0.01, H - 0.01, bz + 0.012, 0, -1, 1, 0.9); cobweb(-W / 2 + 0.012, H - 0.01, bz + 0.01, Math.PI / 2, -1, 1, 0.8); cobweb(W / 2 - 0.01, H - 0.01, D / 2 - 0.012, Math.PI, 1, 1, 0.9); cobweb(0.2, H - 0.01, bz + 0.012, 0, 1, 1, 0.6);
    var crack = decalTex(512, 512, function (g, w, h) { var r = rnd(77); g.strokeStyle = 'rgba(10,8,6,0.9)'; g.lineWidth = 2.2; function seg(x, y, a, n) { g.beginPath(); g.moveTo(x, y); for (var i = 0; i < n; i++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * (14 + r() * 24); y += Math.sin(a) * (14 + r() * 24); g.lineTo(x, y); if (r() < 0.22) seg(x, y, a + (r() < 0.5 ? 1 : -1), 4 + Math.floor(r() * 4)); } g.stroke(); } seg(260, 40, 1.5, 14); seg(120, 300, 0.4, 9); });
    decal(crack, 0.9, 0.9, 0.4, 0.003, 0.6, 0, -Math.PI / 2, 0.9);
    // wall tile damage: a few dark patches of missing tiles at tile height
    var miss = decalTex(256, 256, function (g, w, h) { var r = rnd(33); for (var i = 0; i < 9; i++) { g.fillStyle = 'rgba(30,26,20,0.92)'; var x = r() * 200, y = r() * 200; g.fillRect(x, y, 30 + r() * 30, 14 + r() * 16); g.strokeStyle = 'rgba(10,10,8,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 60, y + 30 + r() * 30); g.stroke(); } });
    decal(miss, 0.9, 0.9, 0.9, 1.0, bz + 0.011, 0, 0, 1); decal(miss, 0.8, 0.8, -W / 2 + 0.011, 1.0, -1.7, Math.PI / 2, 0, 1); decal(miss, 0.8, 0.8, W / 2 - 0.011, 1.0, 1.7, -Math.PI / 2, 0, 1);
    // puddles with a wet sheen, floor drain
    var pud = decalTex(256, 256, function (g, w, h) { var b = g.createRadialGradient(128, 128, 0, 128, 128, 120); b.addColorStop(0, 'rgba(4,8,6,0.85)'); b.addColorStop(0.7, 'rgba(4,8,6,0.55)'); b.addColorStop(1, 'rgba(4,8,6,0)'); g.fillStyle = b; g.fillRect(0, 0, w, h); });
    decal(pud, 1.4, 1.1, -1.3, 0.004, -0.9, 0, -Math.PI / 2, 0.9);
    cyl(0.12, 0.12, 0.008, mBlack, 0.0, 0.004, 0.5, null, 16); [-0.06, 0, 0.06].forEach(function (o) { box(0.2, 0.01, 0.012, mSteel, 0, 0.01, 0.5 + o, null, false); });
    // sparse blood: smear from the tub to the door, handprints by the door, drips on the sink tiles, a message above the tub, a handprint on the mirror side
    var smear = decalTex(256, 512, function (g, w, h) {
      var r = rnd(5); g.fillStyle = 'rgba(80,5,5,0.85)'; for (var i = 0; i < 46; i++) { var t = i / 46, x = w * (0.35 + 0.3 * Math.sin(t * 3)), y = h * (0.04 + 0.92 * t), rad = 12 + r() * 14 - t * 6; g.beginPath(); g.ellipse(x + (r() - 0.5) * 14, y, rad, rad * 1.4, 0, 0, 6.283); g.fill(); }
      for (var k = 0; k < 12; k++) { g.beginPath(); g.arc(w * r(), h * r(), 2 + r() * 6, 0, 6.283); g.fill(); }
    });
    var sm = decal(smear, 0.55, 3.6, -1.6, 0.005, 0.9, 0, -Math.PI / 2, 0.9); sm.rotation.set(-Math.PI / 2, 0, 0); sm.rotation.z = -0.62; sm.position.set(-1.9, 0.005, -0.1);
    var hands = decalTex(512, 256, function (g, w, h) { var r = rnd(8); g.fillStyle = 'rgba(70,5,5,0.85)'; for (var k = 0; k < 5; k++) { var x = 60 + k * 95 + r() * 20, y = 80 + r() * 90 - k * 4, a = (r() - 0.5) * 0.5; g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-20, 0, 40, 52); [-22, -11, 0, 11, 22].forEach(function (fx, i) { g.fillRect(fx - 4, -34 + Math.abs(i - 2) * 9, 8, 36); }); g.fillRect(-34, 8, 14, 8); g.fillRect(-10, 52, 20, 100 * r()); g.restore(); } });
    decal(hands, 1.0, 0.5, W / 2 - 0.012, 1.55, 2.0, -Math.PI / 2, 0, 0.95); decal(hands, 0.8, 0.4, -2.9 + 0.0, 1.9, D / 2 - 0.012, Math.PI, 0, 0.9);
    var drip = decalTex(256, 256, function (g, w, h) { g.fillStyle = 'rgba(88,6,6,0.9)'; var r = rnd(2); for (var j = 0; j < 5; j++) { var x = 40 + j * 40 + r() * 10, len = 60 + r() * 150; g.fillRect(x - 3, 0, 6, len); g.beginPath(); g.arc(x, len, 6, 0, 6.283); g.fill(); } });
    decal(drip, 0.5, 0.5, vx - 0.55, 1.2, bz + 0.012, 0, 0, 0.95);
    var msg = decalTex(512, 128, function (g, w, h) { g.fillStyle = 'rgba(95,6,6,0.92)'; g.font = 'bold 66px serif'; g.textAlign = 'center'; g.direction = 'rtl'; g.fillText('لا تفتحي الستارة', w / 2, 82); for (var i = 0; i < 9; i++) g.fillRect(50 + (i * 53) % 410, 66, 3, 20 + (i * 17) % 38); });
    decal(msg, 1.6, 0.4, tbx, 2.2, bz + 0.009, 0, 0, 0.95);
    var tally = decalTex(256, 128, function (g, w, h) { g.strokeStyle = 'rgba(15,10,8,0.9)'; g.lineWidth = 3; for (var b = 0; b < 4; b++) { for (var i = 0; i < 4; i++) { g.beginPath(); g.moveTo(14 + b * 60 + i * 9, 20); g.lineTo(14 + b * 60 + i * 9 + 1, 80); g.stroke(); } g.beginPath(); g.moveTo(8 + b * 60, 70); g.lineTo(50 + b * 60, 28); g.stroke(); } });
    decal(tally, 0.7, 0.35, W / 2 - 0.01, 2.0, -0.4, -Math.PI / 2, 0, 0.9);

    // ---------- lights: three dim fluorescent fixtures spread across the room (one shadow light, two without), shared blackouts ----------
    var shMap = q === '1k' ? 512 : 1024, tubeMat = new THREE.MeshBasicMaterial({ color: 0xe8f2ff }), tubeMat2 = new THREE.MeshBasicMaterial({ color: 0xe8f2ff }), tubeMat3 = new THREE.MeshBasicMaterial({ color: 0xe8f2ff });
    function fixture(x, z, mat) { box(1.1, 0.05, 0.18, new THREE.MeshStandardMaterial({ color: 0x555048, roughness: 0.7 }), x, H - 0.03, z, null, false); box(1.0, 0.025, 0.09, mat, x, H - 0.062, z, null, false); }
    fixture(-1.7, 0.3, tubeMat); fixture(1.8, -0.4, tubeMat2); fixture(-0.2, 1.9, tubeMat3);
    var lampA = new THREE.PointLight(0xcfe0c4, 0.34, 9, 2); lampA.position.set(-1.7, H - 0.3, 0.3); lampA.castShadow = true; lampA.shadow.mapSize.set(shMap, shMap); lampA.shadow.bias = -0.0008; group.add(lampA);
    var lampB = new THREE.PointLight(0xd4e0c8, 0.3, 9, 2); lampB.position.set(1.8, H - 0.3, -0.4); group.add(lampB);
    var lampC = new THREE.PointLight(0xc8d8c8, 0.22, 7, 2); lampC.position.set(-0.2, H - 0.3, 1.9); group.add(lampC);
    var LK = (opt.lamps === 1) ? 1.7 : 1; if (opt.lamps === 1) { lampB.visible = false; lampC.visible = false; }   // single-lamp variant: only lampA lights the room
    var moon = new THREE.DirectionalLight(0x5a70b0, 0.05); moon.position.set(W / 2 + 2, 3, -0.2); moon.target.position.set(0, 0.5, 0); group.add(moon, moon.target);
    group.add(new THREE.HemisphereLight(0x4a5470, 0x100c0a, 0.05));

    // ---------- procedural sound (WebAudio, no files): drone, flicker buzz, heartbeat, drips, creaks, stingers ----------
    var A = null, audio = { fear: 0.15, beat: 0, drip: 3 };
    function noiseBuf(ctx) { var b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
    function envG(t, peak, dur, att) { var g = A.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + (att || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(A.master); return g; }
    function thump(f0, f1, peak, dur, delay) { if (!A) return; var t = A.ctx.currentTime + (delay || 0), o = A.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.connect(envG(t, peak, dur)); o.start(t); o.stop(t + dur + 0.05); }
    audio.start = function () {
      if (A) return; var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; var ctx = new AC(); if (ctx.resume) ctx.resume();
      var master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      var d1 = ctx.createOscillator(), d2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), dg = ctx.createGain(); d1.type = d2.type = 'sawtooth'; d1.frequency.value = 41; d2.frequency.value = 42.7; lp.type = 'lowpass'; lp.frequency.value = 140; dg.gain.value = 0.05; d1.connect(lp); d2.connect(lp); lp.connect(dg); dg.connect(master); d1.start(); d2.start();
      var bz2 = ctx.createOscillator(), bg = ctx.createGain(), bp = ctx.createBiquadFilter(); bz2.type = 'sawtooth'; bz2.frequency.value = 100; bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.8; bg.gain.value = 0.012; bz2.connect(bp); bp.connect(bg); bg.connect(master); bz2.start();
      A = { ctx: ctx, master: master, buzz: bg, nbuf: noiseBuf(ctx), drone: dg };
    };
    audio.setFear = function (f) { audio.fear = Math.max(0, Math.min(1, f)); };
    audio.stinger = function () { if (!A) return; var t = A.ctx.currentTime, n = A.ctx.createBufferSource(); n.buffer = A.nbuf; var bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(3500, t); bp.frequency.exponentialRampToValueAtTime(300, t + 0.8); n.connect(bp); bp.connect(envG(t, 0.35, 0.9, 0.005)); n.start(t); n.stop(t + 1);
      [220, 233, 311, 466].forEach(function (f, i) { var o = A.ctx.createOscillator(), lp = A.ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 1.3); lp.type = 'lowpass'; lp.frequency.value = 900; o.connect(lp); lp.connect(envG(t, 0.06, 1.4, 0.02)); o.start(t); o.stop(t + 1.5); }); thump(60, 25, 0.6, 0.7); };
    audio.creak = function () { if (!A) return; var t = A.ctx.currentTime, o = A.ctx.createOscillator(), bp = A.ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(150, t + 0.35); o.frequency.linearRampToValueAtTime(105, t + 0.8); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 9; o.connect(bp); bp.connect(envG(t, 0.12, 0.85, 0.08)); o.start(t); o.stop(t + 0.9); };
    audio.slide = function () { if (!A) return; var t = A.ctx.currentTime, n = A.ctx.createBufferSource(); n.buffer = A.nbuf; var bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2; n.connect(bp); bp.connect(envG(t, 0.08, 0.4, 0.05)); n.start(t); n.stop(t + 0.5); };
    audio.dripSound = function () { if (!A) return; var t = A.ctx.currentTime, o = A.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.09); o.connect(envG(t, 0.05, 0.14, 0.003)); o.start(t); o.stop(t + 0.2); };
    function audioTick(dt) { if (!A) return; audio.drip -= dt; if (audio.drip <= 0) { audio.dripSound(); audio.drip = 2.5 + Math.random() * 6; }
      audio.beat -= dt; var bpm = 52 + audio.fear * 85; if (audio.beat <= 0) { var pk = 0.18 + audio.fear * 0.5; thump(75, 38, pk, 0.18); thump(62, 33, pk * 0.75, 0.2, 0.17); audio.beat = 60 / bpm; } A.drone.gain.value = 0.04 + audio.fear * 0.07; }

    // ---------- flicker, blackouts and the figure ----------
    var burst = 0, gap = 3, black = 0, figT = 0, scareCb = opt.onScare, indep = 0, figSpots = [[-2.0, bz + 0.5], [0.2, 1.4], [3.0, 0.3], [-2.9, 2.1]];
    var figTex = canvasTex(128, 320, function (g, w, h) { g.fillStyle = '#000'; g.beginPath(); g.arc(64, 38, 24, 0, 6.283); g.fill(); g.fillRect(36, 58, 56, 150); g.fillRect(24, 62, 14, 130); g.fillRect(90, 62, 14, 130); g.fillRect(40, 200, 20, 120); g.fillRect(68, 200, 20, 120); g.fillStyle = 'rgba(200,20,10,0.9)'; g.fillRect(52, 34, 6, 4); g.fillRect(70, 34, 6, 4); });
    var fig = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.7), new THREE.MeshBasicMaterial({ map: figTex, transparent: true, depthWrite: false })); fig.visible = false; fig.position.y = 0.85; if (FIG) group.add(fig);
    group.userData.camX = 0; group.userData.camZ = 0;
    function setLights(v, v3) { lampA.intensity = 0.34 * v * LK; lampB.intensity = 0.3 * v; lampC.intensity = 0.22 * v * v3; var c = 0.04 + 0.5 * v; tubeMat.color.setScalar(c); tubeMat2.color.setScalar(c); tubeMat3.color.setScalar(0.04 + 0.5 * v * v3); if (A) A.buzz.gain.value = 0.012 * (v > 0.5 ? 1 : 0.15); }
    flick.push(function (dt) {
      if (group.userData.freeze) { setLights(1, 1); if (group.userData.showFig) { fig.position.set(-0.6, 0.85, 1.2); fig.rotation.y = Math.atan2(group.userData.camX + 0.6, group.userData.camZ - 1.2); fig.visible = true; } else fig.visible = false; return; }
      var v = 1, v3 = 1; gap -= dt; indep -= dt; if (indep <= 0 && black <= 0 && burst <= 0) { v3 = Math.random() < 0.5 ? 0.1 : 1; if (indep < -0.25) indep = 1 + Math.random() * 5; }
      if (black > 0) { black -= dt; v = 0; v3 = 0; if (black <= 0) { gap = 3 + Math.random() * 6; if (Math.random() < 0.65) { var p = figSpots[Math.floor(Math.random() * figSpots.length)]; fig.position.set(p[0], 0.85, p[1]); fig.rotation.y = Math.atan2(group.userData.camX - p[0], group.userData.camZ - p[1]); fig.visible = true; figT = 0.4; audio.stinger(); } audio.setFear(0.15); } }
      else if (burst > 0) { burst -= dt; v = Math.random() < 0.55 ? 0.03 : 0.8; v3 = v; if (burst <= 0) { black = 0.6 + Math.random() * 1.8; audio.setFear(0.9); thump(70, 28, 0.5, 0.6); if (scareCb) scareCb(); } }
      else if (gap <= 0) burst = 0.35 + Math.random() * 0.6;
      if (figT > 0) { figT -= dt; if (figT <= 0) fig.visible = false; }
      setLights(v, v3);
    });
    // generated environment map for reflections (no download)
    if (opt.renderer && THREE.PMREMGenerator) {
      var es = new THREE.Scene(); es.background = new THREE.Color(0x1b1d24);
      var eb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); eb.position.set(0, 3, 0); es.add(eb);
      var pm = new THREE.PMREMGenerator(opt.renderer); group.userData.env = pm.fromScene(es, 0.04).texture; pm.dispose();
    }
    // opening anything makes a sound (door and cabinets creak, drawers slide)
    interactives.forEach(function (it) { var v = !!it.open; Object.defineProperty(it, 'open', { get: function () { return v; }, set: function (x) { x = !!x; if (x !== v) { v = x; if (it.kind === 'slide') audio.slide(); else audio.creak(); } } }); });

    // ---------- API ----------
    function byName(n) { for (var i = 0; i < interactives.length; i++) if (interactives[i].name === n) return interactives[i]; return null; }
    function update(dt) {
      for (var i = 0; i < interactives.length; i++) {
        var it = interactives[i], goal = it.open ? 1 : 0; it.t += (goal - it.t) * Math.min(1, dt * 6);
        if (Math.abs(goal - it.t) < 0.001) it.t = goal; var e = it.t * it.t * (3 - 2 * it.t);
        if (it.kind === 'v') it.object.rotation.y = it.c + (it.target - it.c) * e; else if (it.kind === 'h') it.object.rotation.x = it.target * e; else it.object.position.z = it.base + it.target * e;
      }
      for (var f = 0; f < flick.length; f++) flick[f](dt); audioTick(dt);
    }
    function pick(ray, maxDist) {
      var meshes = interactives.map(function (i) { return i.mesh; }), hits = ray.intersectObjects(meshes, false);
      if (!hits.length || hits[0].distance > (maxDist || 2.4)) return null;
      for (var i = 0; i < interactives.length; i++) if (interactives[i].mesh === hits[0].object) return interactives[i];
      return null;
    }
    group.traverse(function (o) { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && group.userData.env) o.material.envMap = group.userData.env; });
    return {
      group: group, interactives: interactives, colliders: colliders, update: update, pick: pick, audio: audio, enableAudio: audio.start,
      toggle: function (n) { var it = byName(n); if (it) it.open = !it.open; return it; }, open: function (n) { var it = byName(n); if (it) it.open = true; }, close: function (n) { var it = byName(n); if (it) it.open = false; },
      setCamera: function (x, z) { group.userData.camX = x; group.userData.camZ = z; }, debug: function (freeze, showFig) { group.userData.freeze = freeze; group.userData.showFig = showFig; },
      bounds: { minX: -W / 2 + 0.25, maxX: W / 2 - 0.25, minZ: -D / 2 + 0.25, maxZ: D / 2 + 0.6, height: H },
      spawn: { x: dx, z: D / 2 - 0.6, yaw: 0 }, exitDoor: { x: dx, z: D / 2 }, size: { w: W, d: D, h: H }, progress: progress, license: 'Textures: Poly Haven, CC0', version: '0.1'
    };
  }
  root.BathroomModule = { build: build, version: '0.1' };
})(typeof window !== 'undefined' ? window : this);
