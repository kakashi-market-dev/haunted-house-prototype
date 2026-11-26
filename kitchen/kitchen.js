/* kitchen.js  -  standalone realistic kitchen module (own scene, no dependency on any house file).
 * Needs only three.js r128 (global THREE).
 *
 *   var K = KitchenModule.build(THREE, { quality: '1k' | '2k' (default) | '4k', floorTexSize: metres per floor texture (adjustable tile scale), wallTexSize, renderer: renderer, onProgress: fn(done,total) });
 *   scene.add(K.group);                       // the whole room, origin at the room centre on the floor, door on the +z side
 *   K.update(dt);                             // animates doors/drawers and the flickering light
 *   K.toggle('oven'); K.open(name) / K.close(name); K.interactives  // [{name,label,object,open}]
 *   K.pick(raycaster)  -> interactive under the ray (or null);  K.colliders -> AABBs [{minX,maxX,minZ,maxZ}] for player collision
 *   K.bounds  -> {minX,maxX,minZ,maxZ,height}; K.spawn -> {x,z,yaw} suggested player start; K.exitDoor -> {x,z} doorway centre
 * Textures: Poly Haven (CC0) loaded lazily from dl.polyhaven.org; plain coloured materials are used until they arrive, or if offline.
 */
(function (root) {
  'use strict';
  var PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/';
  var W = 5.2, D = 4.2, H = 2.8; // room width (x), depth (z), height
  // ===== TEXTURE CONFIG (swap floor / wall / tiles here; 'size' = real-world metres covered by one texture image) =====
  var TEX = {
    floor: { id: 'brown_floor_tiles', size: 0.9, tint: 0xffffff, rough: 0.5 },   // option E (ceramic floor)
    wall:  { id: 'damaged_plaster',   size: 1.4, tint: 0xb4aea4, rough: 0.95, nor: 1.2 },
    tiles: { id: 'long_white_tiles',  size: 0.6, tint: 0xe8e4d8, rough: 0.35 }, // tiled wall areas (behind counter)
    ceil:  { id: 'damaged_plaster',   size: 1.4, tint: 0x7d7a74, rough: 1.0 },
    wood:  { id: 'dark_wood',         size: 1.0, tint: 0xb59a86, rough: 0.55 }
  };

  function build(THREE, opt) {
    opt = opt || {};
    var q = opt.quality || '2k'; if (opt.floorTexSize) TEX.floor.size = opt.floorTexSize; if (opt.wallTexSize) TEX.wall.size = opt.wallTexSize;
    var maxAniso = opt.renderer ? opt.renderer.capabilities.getMaxAnisotropy() : 4;
    var group = new THREE.Group(); group.name = 'kitchen';
    var interactives = [], colliders = [], flick = [], tickers = [];
    var loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
    var progress = { done: 0, total: 0 };
    function bump() { progress.done++; if (opt.onProgress) opt.onProgress(progress.done, progress.total); }

    // ---------- materials ----------
    // PBR material from a Poly Haven id. cfg = TEX entry; surfW/surfH = surface size in metres (repeat = surface / cfg.size, so scale is identical everywhere)
    function pbr(cfg, surfW, surfH, fallback) {
      var m = new THREE.MeshStandardMaterial({ color: fallback, roughness: cfg.rough, metalness: 0, envMapIntensity: 0.25 }), id = cfg.id;
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
    var mFloor = pbr(TEX.floor, W, D, 0x8a6a48);
    var mWallA = pbr(TEX.wall, W, H, 0x8d887e), mWallB = pbr(TEX.wall, D, H, 0x8d887e), mWallC = pbr(TEX.wall, D, H, 0x8d887e);
    var mCeil = pbr(TEX.ceil, W, D, 0x55524c);
    var mBack = pbr(TEX.tiles, W, 0.62, 0xc8c4b6);
    var mWood = pbr(TEX.wood, 1.0, 1.0, 0x4a3020), mWoodDoor = pbr(TEX.wood, 0.6, 0.8, 0x4a3020);
    var mTop = new THREE.MeshStandardMaterial({ color: 0x2b2a2a, roughness: 0.28, metalness: 0.1, envMapIntensity: 1 });
    var mEnamel = new THREE.MeshStandardMaterial({ color: 0xbdb9ac, roughness: 0.28, metalness: 0.1, envMapIntensity: 1 });
    var mSteel = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.32, metalness: 0.85, envMapIntensity: 1.2 });
    var mBlack = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.45, metalness: 0.3 });
    var mGlass = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.8, envMapIntensity: 1.5 });
    var mHandle = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.25, metalness: 0.95, envMapIntensity: 1.3 });
    var mTrim = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.6 });
    var mRed = new THREE.MeshStandardMaterial({ color: 0x8c1a14, roughness: 0.5, metalness: 0.4 });

    // ---------- helpers ----------
    function box(w, h, d, m, x, y, z, parent, shadow) {
      var o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); if (shadow !== false) { o.castShadow = true; o.receiveShadow = true; } (parent || group).add(o); return o;
    }
    function cyl(rt, rb, h, m, x, y, z, parent, seg) { var o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 20), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; (parent || group).add(o); return o; }
    function solid(minX, maxX, minZ, maxZ) { colliders.push({ minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ }); }
    function bar(len, x, y, z, parent, vertical) { var g = new THREE.CylinderGeometry(0.011, 0.011, len, 10), o = new THREE.Mesh(g, mHandle); o.position.set(x, y, z); if (!vertical) o.rotation.z = Math.PI / 2; o.castShadow = true; (parent || group).add(o); return o; }
    // hinged door: pivot at the hinge edge. kind 'v' = swings around a vertical axis, 'h' = around a horizontal axis at the bottom (oven)
    function door(name, label, w, h, t, mat, x, y, z, hinge, kind, parent, handle) {
      var pivot = new THREE.Group(); pivot.position.set(x, y, z); (parent || group).add(pivot);
      var side = hinge === 'left' ? 1 : -1;
      var d = box(w, h, t, mat, kind === 'h' ? 0 : side * w / 2, kind === 'h' ? h / 2 : 0, 0, pivot);
      var fx = -side * (w / 2 - 0.05); // free-edge side, in the door's own coordinates
      if (handle === 'bar-v') bar(Math.min(0.3, h * 0.5), fx, 0, t / 2 + 0.03, d, true);
      if (handle === 'bar-h') { bar(0.46, 0, h / 2 - 0.05, t / 2 + 0.045, d); [-1, 1].forEach(function (sg) { box(0.015, 0.015, 0.04, mHandle, sg * 0.22, h / 2 - 0.05, t / 2 + 0.02, d, false); }); }
      if (handle === 'knob-top' || handle === 'knob-bot') { var kb = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), mHandle); kb.position.set(fx, handle === 'knob-top' ? h / 2 - 0.07 : -h / 2 + 0.07, t / 2 + 0.02); d.add(kb); }
      var it = { name: name, label: label, object: pivot, open: false, t: 0, kind: kind, target: kind === 'h' ? 1.5 : side * -1.9, mesh: d };
      interactives.push(it); return it;
    }
    function drawer(name, label, w, h, dd, mat, x, y, z, parent) {
      var g = new THREE.Group(); g.position.set(x, y, z); (parent || group).add(g);
      box(w, h, 0.02, mat, 0, 0, 0, g);
      box(w - 0.06, h - 0.05, dd, mWood, 0, -0.02, -dd / 2, g);
      bar(Math.min(0.3, w * 0.5), 0, h / 2 - 0.05, 0.05, g);
      interactives.push({ name: name, label: label, object: g, open: false, t: 0, kind: 'slide', base: z, target: 0.38, mesh: g.children[0] });
    }

    // ---------- shell ----------
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mFloor); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
    var ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mCeil); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; group.add(ceil);
    function wall(w, mat, x, z, ry) { var m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), mat); m.position.set(x, H / 2, z); m.rotation.y = ry; m.receiveShadow = true; group.add(m); return m; }
    wall(W, mWallA, 0, -D / 2, 0);                                  // back wall (counters)
    wall(D, mWallB, -W / 2, 0, Math.PI / 2);                        // left wall (shelves)
    wall(D, mWallC, W / 2, 0, -Math.PI / 2);                        // right wall (window)
    // front wall with a doorway (centre x=-0.9, width 1.0, height 2.1)
    var dx = -0.9, dw = 1.0, dh = 2.1;
    (function () { var l = W / 2 + dx - dw / 2, r = W / 2 - (dx + dw / 2);
      var a = new THREE.Mesh(new THREE.PlaneGeometry(l, H), mWallA); a.position.set(-W / 2 + l / 2, H / 2, D / 2); a.rotation.y = Math.PI; group.add(a);
      var b = new THREE.Mesh(new THREE.PlaneGeometry(r, H), mWallA); b.position.set(W / 2 - r / 2, H / 2, D / 2); b.rotation.y = Math.PI; group.add(b);
      var c = new THREE.Mesh(new THREE.PlaneGeometry(dw, H - dh), mWallA); c.position.set(dx, dh + (H - dh) / 2, D / 2); c.rotation.y = Math.PI; group.add(c);
      box(0.08, dh, 0.12, mTrim, dx - dw / 2 - 0.04, dh / 2, D / 2 - 0.02); box(0.08, dh, 0.12, mTrim, dx + dw / 2 + 0.04, dh / 2, D / 2 - 0.02); box(dw + 0.16, 0.08, 0.12, mTrim, dx, dh + 0.04, D / 2 - 0.02);
    })();
    // skirting
    [[W, -D / 2 + 0.01, 0, 0], [D, 0, -W / 2 + 0.01, Math.PI / 2], [D, 0, W / 2 - 0.01, Math.PI / 2]].forEach(function (s) { var sk = box(s[0], 0.1, 0.02, mTrim, s[2], 0.05, s[1]); sk.rotation.y = s[3]; });

    // ---------- back wall: tile splash, base cabinets, counter ----------
    var bz = -D / 2; // wall plane
    var splash = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, 0.62), mBack); splash.position.set(0, 1.21, bz + 0.005); splash.receiveShadow = true; group.add(splash);
    var cd = 0.62, ch = 0.86, cz = bz + cd / 2; // cabinet depth/height/centre z
    // layout along x (left to right): fridge | cab | stove | cab | sink cab | cab
    var fr = { x: -W / 2 + 0.45, w: 0.8 };
    // fridge
    (function () {
      var fg = new THREE.Group(); fg.position.set(fr.x, 0, bz + 0.38); group.add(fg);
      box(fr.w, 1.85, 0.72, mEnamel, 0, 0.925, 0, fg);
      solid(fr.x - fr.w / 2, fr.x + fr.w / 2, bz, bz + 0.74);
      // two doors, hinged on the right (front face z = +0.36)
      var itT = door('fridge_top', 'باب الثلاجة', fr.w - 0.02, 1.18, 0.05, mEnamel, fr.w / 2 - 0.01, 0.62 + 0.59, 0.37, 'right', 'v', fg);
      var itB = door('freezer', 'باب الفريزر', fr.w - 0.02, 0.62, 0.05, mEnamel, fr.w / 2 - 0.01, 0.31, 0.37, 'right', 'v', fg);
      // handles on the left edge of the doors
      box(0.025, 0.55, 0.03, mHandle, -fr.w / 2 + 0.05, 0, 0.045, itT.mesh); box(0.025, 0.4, 0.03, mHandle, -fr.w / 2 + 0.05, 0.1, 0.045, itB.mesh);
      // interior shelves & light visible when open
      var inside = new THREE.Group(); fg.add(inside);
      [0.75, 1.0, 1.25, 1.5].forEach(function (y) { box(fr.w - 0.1, 0.015, 0.6, new THREE.MeshStandardMaterial({ color: 0xcfd6d8, roughness: 0.2, transparent: true, opacity: 0.75 }), 0, y, -0.02, inside, false); });
      box(0.12, 0.2, 0.1, new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.7 }), -0.2, 0.84, 0.05, inside); cyl(0.04, 0.04, 0.2, new THREE.MeshStandardMaterial({ color: 0x486a3a, roughness: 0.5 }), 0.15, 1.1, 0.05, inside);
    })();
    // helper to place a base cabinet with a door (or drawer + door)
    function baseCab(x, w, i, kind) {
      box(w, ch - 0.1, cd, mWood, x, 0.1 + (ch - 0.1) / 2, cz); box(w + 0.01, 0.1, cd - 0.04, mBlack, x, 0.05, cz + 0.02, null, false);
      solid(x - w / 2, x + w / 2, bz, bz + cd);
      var fz = cz + cd / 2 + 0.01;
      if (kind === 'drawers') { drawer('drawer' + i + 'a', 'درج', w - 0.02, 0.2, 0.5, mWoodDoor, x, 0.78, fz); drawer('drawer' + i + 'b', 'درج', w - 0.02, 0.28, 0.5, mWoodDoor, x, 0.55, fz); drawer('drawer' + i + 'c', 'درج', w - 0.02, 0.28, 0.5, mWoodDoor, x, 0.28, fz); }
      else if (w > 0.7) {
        var hw = w / 2 - 0.01;
        door('base' + i + 'L', 'باب خزانة', hw, ch - 0.14, 0.022, mWoodDoor, x - w / 2 + 0.005, 0.1 + (ch - 0.14) / 2 + 0.03, fz, 'left', 'v', null, 'knob-top');
        door('base' + i + 'R', 'باب خزانة', hw, ch - 0.14, 0.022, mWoodDoor, x + w / 2 - 0.005, 0.1 + (ch - 0.14) / 2 + 0.03, fz, 'right', 'v', null, 'knob-top');
        box(w - 0.06, 0.012, cd - 0.08, mWood, x, 0.5, cz - 0.02, null, false);
        // contents seen when open
        cyl(0.11, 0.11, 0.22, mSteel, x - w / 4, 0.62, cz - 0.05); cyl(0.07, 0.07, 0.2, mRed, x + w / 4, 0.62, cz - 0.05);
      } else door('base' + i, 'باب خزانة', w - 0.02, ch - 0.14, 0.022, mWoodDoor, x - w / 2 + 0.005, 0.1 + (ch - 0.14) / 2 + 0.03, fz, 'left', 'v', null, 'knob-top');
    }
    var x0 = fr.x + fr.w / 2; // = -2.6+0.85
    var cx = -W / 2 + 0.85;
    baseCab(cx + 0.3, 0.6, 1, 'drawers'); cx += 0.6;
    // stove (width 0.6)
    var sx = cx + 0.3; cx += 0.6;
    (function () {
      var g = new THREE.Group(); g.position.set(sx, 0, cz); group.add(g);
      box(0.6, 0.86, cd, mEnamel, 0, 0.43, 0, g); solid(sx - 0.3, sx + 0.3, bz, bz + cd);
      box(0.6, 0.03, cd, mBlack, 0, 0.875, 0, g);
      box(0.6, 0.18, 0.04, mEnamel, 0, 1.0, -cd / 2 + 0.02, g); // back panel
      [[-0.14, 0.14], [0.14, 0.14], [-0.14, -0.12], [0.14, -0.12]].forEach(function (p, i) {
        var s = i === 0 ? 0.062 : 0.045;
        cyl(s, s, 0.02, mSteel, p[0], 0.9, p[1], g, 24); cyl(s * 0.6, s * 0.6, 0.012, mBlack, p[0], 0.915, p[1], g, 24);
        for (var k = 0; k < 8; k++) { var a = k / 8 * 6.283; var f = box(0.008, 0.01, 0.02, mBlack, p[0] + Math.cos(a) * s * 1.1, 0.92, p[1] + Math.sin(a) * s * 1.1, g, false); f.rotation.y = -a; }
        var gr = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 6, 16), mBlack); gr.rotation.x = Math.PI / 2; gr.position.set(p[0], 0.93, p[1]); g.add(gr);
      });
      // grates bars
      [-0.14, 0.14].forEach(function (x) { box(0.012, 0.012, 0.44, mBlack, x, 0.935, 0.01, g, false); });
      [0.14, -0.12].forEach(function (z) { box(0.5, 0.012, 0.012, mBlack, 0, 0.935, z, g, false); });
      // knobs
      for (var i = 0; i < 5; i++) { var kn = cyl(0.022, 0.026, 0.03, mBlack, -0.22 + i * 0.11, 0.78, cd / 2 + 0.015, g, 14); kn.rotation.x = Math.PI / 2; box(0.004, 0.02, 0.004, mHandle, -0.22 + i * 0.11, 0.78 + 0.0, cd / 2 + 0.033, g, false); }
      // oven door: hinged at the bottom edge, opens downward
      var oit = door('oven', 'باب الفرن', 0.56, 0.52, 0.04, mEnamel, 0, 0.1 + 0.02, cd / 2 + 0.02, 'left', 'h', g), omesh = oit.mesh;
      box(0.38, 0.28, 0.01, mGlass, 0, -0.02, 0.025, omesh, false); bar(0.46, 0, 0.21, 0.065, omesh);
      var oc = box(0.5, 0.45, 0.4, new THREE.MeshStandardMaterial({ color: 0x1f1f20, roughness: 0.6 }), 0, 0.33, 0.0, g, false); oc.position.z = 0.0;
      box(0.5, 0.01, 0.38, mSteel, 0, 0.28, 0.0, g, false); box(0.5, 0.01, 0.38, mSteel, 0, 0.42, 0.0, g, false);
      // pot on a burner
      cyl(0.095, 0.085, 0.12, mSteel, -0.14, 1.0, 0.14, g, 24); cyl(0.098, 0.098, 0.012, mSteel, -0.14, 1.065, 0.14, g, 24); box(0.07, 0.015, 0.018, mBlack, -0.27, 1.065, 0.14, g);
    })();
    // gas cylinder beside the stove
    (function () { var gx = cx + 0.22; cyl(0.15, 0.15, 0.48, mRed, gx, 0.24, bz + 0.2); cyl(0.15, 0.15, 0.05, mRed, gx, 0.5, bz + 0.2).scale.set(1, 0.6, 1); cyl(0.03, 0.03, 0.08, mHandle, gx, 0.58, bz + 0.2); solid(gx - 0.16, gx + 0.16, bz, bz + 0.4); cx += 0.5; })();
    baseCab(cx + 0.3, 0.6, 2); cx += 0.6;
    // sink cabinet (width 0.9)
    var skx = cx + 0.45; baseCab(skx, 0.9, 3); cx += 0.9;
    baseCab(cx + 0.3, 0.6, 4, 'drawers'); cx += 0.6;
    var endX = cx; // right end of cabinets
    // counter top: left of stove, right of stove, with a gap for the stove
    var topY = 0.86 + 0.02;
    function counter(x1, x2) { if (x2 - x1 > 0.01) box(x2 - x1, 0.04, cd + 0.03, mTop, (x1 + x2) / 2, topY, cz + 0.015); }
    counter(-W / 2 + 0.85, sx - 0.3); counter(sx + 0.3, endX);
    // sink basin (dark steel inset) and tap
    box(0.6, 0.012, 0.4, mSteel, skx, topY + 0.022, cz + 0.02, null, false); box(0.54, 0.014, 0.34, mBlack, skx, topY + 0.03, cz + 0.02, null, false);
    cyl(0.018, 0.02, 0.28, mHandle, skx + 0.28, topY + 0.16, bz + 0.1); var sp = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.013, 8, 16, Math.PI), mHandle); sp.position.set(skx + 0.18, topY + 0.3, bz + 0.1); group.add(sp);
    cyl(0.015, 0.015, 0.1, mHandle, skx + 0.08, topY + 0.25, bz + 0.1).position.x = skx + 0.08;

    // ---------- upper cabinets and shelves ----------
    function upperCab(x, w, i) {
      var uz = bz + 0.18, uy = 1.88, uh = 0.7;
      box(w, uh, 0.36, mWood, x, uy, uz); solid(x - w / 2, x + w / 2, bz, bz + 0.36);
      var fz = uz + 0.19;
      var hw = w / 2 - 0.005;
      door('up' + i + 'L', 'باب علوي', hw, uh - 0.04, 0.02, mWoodDoor, x - w / 2 + 0.005, uy, fz, 'left', 'v', null, 'knob-bot');
      door('up' + i + 'R', 'باب علوي', hw, uh - 0.04, 0.02, mWoodDoor, x + w / 2 - 0.005, uy, fz, 'right', 'v', null, 'knob-bot');
      box(w - 0.04, 0.012, 0.3, mWood, x, uy, uz, null, false);
      cyl(0.04, 0.04, 0.12, mEnamel, x - w / 4, uy + 0.07, uz); cyl(0.05, 0.05, 0.14, mEnamel, x + w / 5, uy - 0.28, uz);
    }
    upperCab(-1.55, 0.8, 1); upperCab(1.0, 0.9, 2);
    // range hood above the stove
    (function () { box(0.6, 0.1, 0.46, mSteel, sx, 2.05, bz + 0.25); var c = box(0.28, 0.5, 0.2, mSteel, sx, 2.4, bz + 0.12); box(0.4, 0.03, 0.3, mBlack, sx, 1.99, bz + 0.26, null, false); })();
    // right of the sink: open shelf with jars
    (function () { var x = 1.78; box(0.55, 0.035, 0.26, mWood, x, 1.62, bz + 0.13); box(0.55, 0.035, 0.26, mWood, x, 2.05, bz + 0.13);
      for (var i = 0; i < 3; i++) { cyl(0.05, 0.05, 0.14, new THREE.MeshStandardMaterial({ color: [0x7a5a2a, 0x556644, 0x6a3a3a][i], roughness: 0.3 }), x - 0.18 + i * 0.18, 1.7, bz + 0.13); }
      [0, 1, 2].forEach(function (i) { cyl(0.1, 0.1, 0.012, mEnamel, x, 2.075 + i * 0.014, bz + 0.13); }); })();

    // ---------- left wall: open shelves, hanging pans ----------
    var lz = -W / 2;
    (function () {
      [0.9, 1.4, 1.9].forEach(function (y, j) { box(0.3, 0.04, 1.7, mWood, lz + 0.15, y, 0.1); [-0.6, 0.8].forEach(function (z) { box(0.04, 0.2, 0.02, mTrim, lz + 0.03, y - 0.1, z, null, false); }); });
      // shelf contents
      for (var i = 0; i < 6; i++) cyl(0.05, 0.05, 0.16, new THREE.MeshStandardMaterial({ color: [0x887755, 0x995533, 0x667755, 0xbbaa88, 0x774444, 0x556677][i], roughness: 0.35 }), lz + 0.13, 0.99, -0.65 + i * 0.12);
      for (var j = 0; j < 4; j++) box(0.16, 0.14, 0.14, new THREE.MeshStandardMaterial({ color: 0xaa9a7a, roughness: 0.6 }), lz + 0.16, 1.49, -0.6 + j * 0.2);
      for (var k = 0; k < 5; k++) { cyl(0.1, 0.1, 0.012, mEnamel, lz + 0.15, 1.928 + k * 0.014, 0.25); }
      solid(lz, lz + 0.32, -0.8, 0.9);
      // hanging rail with pans
      var rail = cyl(0.01, 0.01, 1.0, mHandle, lz + 0.08, 1.62, -1.45); rail.rotation.x = Math.PI / 2;
      [-0.3, 0, 0.3].forEach(function (z, i) { var pan = cyl(0.1 + i * 0.01, 0.09, 0.025, mBlack, lz + 0.1, 1.44, -1.45 + z); pan.rotation.z = Math.PI / 2; box(0.01, 0.2, 0.02, mBlack, lz + 0.09, 1.56, -1.45 + z, null, false); });
    })();

    // ---------- right wall: window with night sky, table ----------
    (function () {
      var rx = W / 2;
      var win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), new THREE.MeshBasicMaterial({ color: 0x0a1020 })); win.position.set(rx - 0.012, 1.55, -0.2); win.rotation.y = -Math.PI / 2; group.add(win);
            box(0.06, 0.05, 1.3, mTrim, rx - 0.05, 1.04, -0.2); box(0.04, 1.0, 0.05, mTrim, rx - 0.025, 1.55, -0.2); box(0.04, 0.05, 1.2, mTrim, rx - 0.025, 1.55, -0.2);
      box(0.05, 0.9, 0.05, mTrim, rx - 0.025, 1.55, -0.78); box(0.05, 0.9, 0.05, mTrim, rx - 0.025, 1.55, 0.38);
      for (var i = 0; i < 18; i++) { var s = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), new THREE.MeshBasicMaterial({ color: 0xcfd8ff })); s.position.set(rx - 0.02, 1.15 + Math.random() * 0.85, -0.7 + Math.random() * 1.0); group.add(s); }
      // curtain
      box(0.04, 1.05, 0.28, new THREE.MeshStandardMaterial({ color: 0x3a1818, roughness: 0.95, side: THREE.DoubleSide }), rx - 0.08, 1.55, -0.78); 
      // kitchen table with two chairs
      var tg = new THREE.Group(); tg.position.set(1.2, 0, 0.5); group.add(tg);
      box(1.0, 0.05, 0.7, mWood, 0, 0.76, 0, tg); [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]].forEach(function (p) { box(0.05, 0.74, 0.05, mWood, p[0], 0.37, p[1], tg); });
      solid(1.2 - 0.52, 1.2 + 0.52, 0.5 - 0.37, 0.5 + 0.37);
      cyl(0.09, 0.07, 0.03, mEnamel, 0.1, 0.8, 0.05, tg); cyl(0.045, 0.04, 0.09, new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.3 }), -0.25, 0.84, -0.1, tg);
      [[-0.2, 0.55, 0], [0.4, -0.55, Math.PI]].forEach(function (c) { var cg = new THREE.Group(); cg.position.set(c[0] + 0.2, 0, c[1]); cg.rotation.y = c[2]; tg.add(cg); box(0.42, 0.04, 0.42, mWood, 0, 0.45, 0, cg); box(0.42, 0.45, 0.04, mWood, 0, 0.7, -0.19, cg); [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach(function (p) { box(0.04, 0.45, 0.04, mWood, p[0], 0.22, p[1], cg); }); });
      solid(1.2 - 0.4, 1.2 + 0.7, 0.5 + 0.3, 0.5 + 0.9);
    })();
    // wall clock, pictures, a bin
    (function () { var c = cyl(0.17, 0.17, 0.03, mEnamel, 0.4, 2.3, bz + 0.02); c.rotation.x = Math.PI / 2; box(0.01, 0.12, 0.01, mBlack, 0.4, 2.33, bz + 0.04, null, false); box(0.08, 0.01, 0.01, mBlack, 0.43, 2.3, bz + 0.04, null, false);
      var bin = cyl(0.17, 0.14, 0.45, new THREE.MeshStandardMaterial({ color: 0x2a3a2e, roughness: 0.7 }), W / 2 - 0.3, 0.22, bz + 0.35); solid(W / 2 - 0.5, W / 2, bz, bz + 0.55); })();

    // ---------- grime, damp and sparse blood: separate transparent decals (the Poly Haven textures stay clean and sharp) ----------
    function rnd(seed) { var a = seed; return function () { a = (a * 16807) % 2147483647; return a / 2147483647; }; }
    function decalTex(w, h, paint) { var c = document.createElement('canvas'); c.width = w; c.height = h; var g = c.getContext('2d'); paint(g, w, h); var t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding; return t; }
    function decal(tex, w, h, x, y, z, ry, rx, op) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, opacity: op === undefined ? 1 : op }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; m.renderOrder = 2; group.add(m); return m;
    }
    // dark grime and damp rising from the floor, blotchy top edge
    var grime = decalTex(1024, 256, function (g, w, h) {
      var r = rnd(7), gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(8,6,4,0.78)'); gr.addColorStop(0.35, 'rgba(14,10,6,0.45)'); gr.addColorStop(1, 'rgba(14,10,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 90; i++) { var x = r() * w, y = h * (0.2 + r() * 0.6), rad = 10 + r() * 38; var b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, 'rgba(10,8,5,' + (0.12 + r() * 0.2) + ')'); b.addColorStop(1, 'rgba(10,8,5,0)'); g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    });
    var gh = 0.85;
    decal(grime, W - 0.02, gh, 0, gh / 2 + 0.1, -D / 2 + 0.006, 0);
    decal(grime, D - 0.02, gh, -W / 2 + 0.006, gh / 2 + 0.1, 0, Math.PI / 2);
    decal(grime, D - 0.02, gh, W / 2 - 0.006, gh / 2 + 0.1, 0, -Math.PI / 2);
    decal(grime, W - 0.02, gh, 0, gh / 2 + 0.1, D / 2 - 0.006, Math.PI);
    // damp stains / water leaks running down from the ceiling and window
    var leak = decalTex(256, 512, function (g, w, h) {
      var r = rnd(21); for (var k = 0; k < 4; k++) { var x = w * (0.2 + r() * 0.6), len = h * (0.5 + r() * 0.45); var gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(40,30,12,0.55)'); gr.addColorStop(1, 'rgba(40,30,12,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 4 - r() * 20, 0); g.lineTo(x + 4 + r() * 20, 0); g.lineTo(x + 3, len); g.lineTo(x - 3, len); g.fill(); }
      var b = g.createRadialGradient(w / 2, 20, 0, w / 2, 20, 90); b.addColorStop(0, 'rgba(30,22,8,0.6)'); b.addColorStop(1, 'rgba(30,22,8,0)'); g.fillStyle = b; g.fillRect(0, 0, w, 200);
    });
    decal(leak, 0.9, 1.7, -0.3, H - 0.85, -D / 2 + 0.007, 0, 0, 0.9); decal(leak, 0.8, 1.5, -W / 2 + 0.007, H - 0.8, 1.1, Math.PI / 2, 0, 0.9); decal(leak, 0.7, 1.4, W / 2 - 0.007, H - 0.75, 1.0, -Math.PI / 2, 0, 0.85);
    // sparse, localized blood: a splatter with drips on the front wall beside the doorway, and a drag smear on the floor
    var blood = decalTex(512, 512, function (g, w, h) {
      var r = rnd(99); g.fillStyle = 'rgba(88,6,6,0.92)';
      for (var i = 0; i < 26; i++) { var a = r() * 6.283, d = r() * 120, x = w / 2 + Math.cos(a) * d, y = 160 + Math.sin(a) * d * 0.7, rad = 3 + r() * (d < 40 ? 22 : 9); g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill(); }
      for (var j = 0; j < 7; j++) { var x2 = w / 2 - 70 + j * 24 + r() * 10, len = 80 + r() * 230; g.fillRect(x2 - 2.5, 150, 5, len); g.beginPath(); g.arc(x2, 150 + len, 5.5, 0, 6.283); g.fill(); }
    });
    decal(blood, 0.8, 0.8, -2.1, 1.5, D / 2 - 0.007, Math.PI, 0, 1);
    var smear = decalTex(256, 512, function (g, w, h) {
      var r = rnd(5); g.fillStyle = 'rgba(80,5,5,0.85)'; for (var i = 0; i < 40; i++) { var t = i / 40, x = w * (0.35 + 0.3 * Math.sin(t * 3) ), y = h * (0.05 + 0.9 * t), rad = 12 + r() * 14 - t * 6; g.beginPath(); g.ellipse(x + (r() - 0.5) * 14, y, rad, rad * 1.4, 0, 0, 6.283); g.fill(); }
      for (var k = 0; k < 10; k++) { g.beginPath(); g.arc(w * r(), h * r(), 2 + r() * 6, 0, 6.283); g.fill(); }
    });
    decal(smear, 0.5, 1.5, -0.8, 0.004, 1.3, 0, -Math.PI / 2, 0.9).rotation.z = 0.3;

    // ---------- lights ----------
    var fl = new THREE.Group(); group.add(fl);
    box(1.2, 0.05, 0.2, new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6 }), 0, H - 0.03, 0.0, fl, false);
    var tube = box(1.1, 0.025, 0.1, new THREE.MeshBasicMaterial({ color: 0xe8f2ff }), 0, H - 0.062, 0, fl, false);
    var lamp = new THREE.PointLight(0xdfeaff, 0.75, 9, 1.8); lamp.position.set(0, H - 0.25, 0.1); lamp.castShadow = true; lamp.shadow.mapSize.set(q === '1k' ? 512 : 1024, q === '1k' ? 512 : 1024); lamp.shadow.bias = -0.0008; group.add(lamp);
    var fill = new THREE.PointLight(0xffd9a8, 0.06, 7, 2); fill.position.set(0.8, 1.7, 1.2); group.add(fill);
    var moon = new THREE.DirectionalLight(0x6f86c8, 0.3); moon.position.set(W / 2 + 2, 3, -0.2); moon.target.position.set(0, 0.5, 0); group.add(moon, moon.target);
    var hemi = new THREE.HemisphereLight(0x6a7490, 0x1a1512, 0.1); group.add(hemi);
    var under = new THREE.PointLight(0xffe6c0, 0.12, 2.5, 2); under.position.set(sx, 1.5, bz + 0.3); group.add(under);
    var ft = 0, burst = 0;
    flick.push(function (dt) {
      ft += dt; var v = 1;
      if (burst > 0) { burst -= dt; v = Math.random() < 0.5 ? 0.15 : 0.9; } else if (Math.random() < dt * 0.25) burst = 0.25 + Math.random() * 0.4;
      lamp.intensity = 0.75 * v; tube.material.color.setScalar(0.35 + 0.65 * v).multiply(new THREE.Color(0.9, 0.95, 1));
    });

    // environment map for realistic reflections (generated, no download)
    if (opt.renderer && THREE.PMREMGenerator) {
      var es = new THREE.Scene(); es.background = new THREE.Color(0x1b1d24);
      var eb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); eb.position.set(0, 3, 0); es.add(eb);
      var ew = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicMaterial({ color: 0x4a5a88 })); ew.position.set(5, 1.5, 0); ew.rotation.y = -Math.PI / 2; es.add(ew);
      var pm = new THREE.PMREMGenerator(opt.renderer); group.userData.env = pm.fromScene(es, 0.04).texture; pm.dispose();
    }

    // ---------- API ----------
    function byName(n) { for (var i = 0; i < interactives.length; i++) if (interactives[i].name === n) return interactives[i]; return null; }
    function setOpen(n, v) { var it = byName(n); if (it) it.open = v; }
    function update(dt) {
      for (var i = 0; i < interactives.length; i++) {
        var it = interactives[i], goal = it.open ? 1 : 0; it.t += (goal - it.t) * Math.min(1, dt * 6);
        if (Math.abs(goal - it.t) < 0.001) it.t = goal; var e = it.t * it.t * (3 - 2 * it.t);
        if (it.kind === 'v') it.object.rotation.y = it.target * e; else if (it.kind === 'h') it.object.rotation.x = it.target * e; else it.object.position.z = it.base + it.target * e;
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
      toggle: function (n) { var it = byName(n); if (it) it.open = !it.open; return it; }, open: function (n) { setOpen(n, true); }, close: function (n) { setOpen(n, false); },
      bounds: { minX: -W / 2 + 0.25, maxX: W / 2 - 0.25, minZ: -D / 2 + 0.25, maxZ: D / 2 + 0.6, height: H },
      spawn: { x: dx, z: D / 2 - 0.5, yaw: Math.PI }, exitDoor: { x: dx, z: D / 2 },
      size: { w: W, d: D, h: H }, progress: progress, license: 'Textures: Poly Haven, CC0'
    };
  }
  root.KitchenModule = { build: build, version: '0.1' };
})(typeof window !== 'undefined' ? window : this);
