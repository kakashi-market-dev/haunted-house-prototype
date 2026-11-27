/* mansion.js - standalone exterior model of the haunted mansion (own scene, no dependency on any other game file). v0.1
 * Needs only three.js r128 (global THREE).
 *   var M = MansionModule.build(THREE, { quality: '1k' (default) | '2k', renderer, onProgress: fn(done,total) });
 *   scene.add(M.group); M.update(dt);   M.colliders (rects, walk mode), M.spawn, M.bounds, M.pick(raycaster), M.use(item), M.audio.start()
 * Plan: x east, z south; the entrance (porch + front door) is on the kitchen block at the south end, facing +z. Metres, 1:1 with the ground-floor plan.
 * Textures: Poly Haven (CC0) damaged_plaster (walls), dark_wood (trim). Roof, windows, ground, trees are generated in code.
 */
(function (root) {
  'use strict';
  var PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/';
  var TEX = { wall: { id: 'damaged_plaster', size: 3.0, tint: 0x6a665e, rough: 0.95, nor: 1.0 }, wood: { id: 'dark_wood', size: 1.2, tint: 0x6a5648, rough: 0.7 } };
  function build(THREE, opt) {
    opt = opt || {};
    var q = opt.quality || '1k', group = new THREE.Group(); group.name = 'mansion';
    var loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous'; var progress = { done: 0, total: 0 };
    var maxAniso = opt.renderer ? opt.renderer.capabilities.getMaxAnisotropy() : 4;
    function bump() { progress.done++; if (opt.onProgress) opt.onProgress(progress.done, progress.total); }
    function rnd(seed) { var a = seed; return function () { a = (a * 16807) % 2147483647; return a / 2147483647; }; }
    function canvasTex(w, h, paint, rep) { var c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); var t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; }
    function pbr(cfg, fallback) {
      var m = new THREE.MeshStandardMaterial({ color: fallback, roughness: cfg.rough, metalness: 0, envMapIntensity: 0.1 }), id = cfg.id, ru = 1 / cfg.size;
      function tex(kind, srgb, apply) { progress.total++; loader.load(PH + q + '/' + id + '/' + id + '_' + kind + '_' + q + '.jpg', function (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ru, ru); t.anisotropy = Math.min(8, maxAniso); if (srgb) t.encoding = THREE.sRGBEncoding; apply(t); m.needsUpdate = true; bump(); }, undefined, function () { bump(); }); }
      tex('diff', true, function (t) { m.map = t; m.color.setHex(cfg.tint); }); tex('nor_gl', false, function (t) { m.normalMap = t; m.normalScale = new THREE.Vector2(cfg.nor || 1, cfg.nor || 1); }); tex('rough', false, function (t) { m.roughnessMap = t; m.roughness = 1; });
      return m;
    }
    var mWall = pbr(TEX.wall, 0x4a4640), mWood = pbr(TEX.wood, 0x3a2c22);
    var mTrim = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.85 }), mStone = new THREE.MeshStandardMaterial({ color: 0x3a3834, roughness: 0.95 }), mBlack = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }), mIron = new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.6, metalness: 0.5 });
    var roofTex = canvasTex(256, 256, function (g, w, h) { var r = rnd(5); g.fillStyle = '#1c1a1a'; g.fillRect(0, 0, w, h); for (var y = 0; y < 16; y++) for (var x = -1; x < 12; x++) { var v = 20 + r() * 26 | 0; g.fillStyle = 'rgb(' + v + ',' + (v - 3) + ',' + (v - 4) + ')'; g.fillRect(x * 23 + (y % 2) * 12, y * 16, 21, 14); } for (var i = 0; i < 260; i++) { g.fillStyle = 'rgba(' + (30 + r() * 20 | 0) + ',' + (40 + r() * 30 | 0) + ',25,0.18)'; g.fillRect(r() * w, r() * h, 3 + r() * 10, 2 + r() * 6); } }, [3, 3]);
    var mRoof = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.9 });
    // box with world-scaled UVs
    function boxG(w, h, d, s) { var g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); } return g; }
    function mesh(geo, mat, x, y, z, shadow, parent) { var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; } (parent || group).add(m); return m; }
    function mass(x0, x1, z0, z1, y0, y1, mat) { return mesh(boxG(x1 - x0, y1 - y0, z1 - z0), mat || mWall, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); }
    var colliders = [];
    function solid(x0, x1, z0, z1) { colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }); }
    // ---------- ground, path ----------
    var gTex = canvasTex(256, 256, function (g, w, h) { var r = rnd(9); g.fillStyle = '#1a1e14'; g.fillRect(0, 0, w, h); for (var i = 0; i < 1800; i++) { var v = r(); g.fillStyle = v < 0.5 ? 'rgba(' + (20 + r() * 20 | 0) + ',' + (30 + r() * 26 | 0) + ',14,0.5)' : 'rgba(' + (40 + r() * 20 | 0) + ',' + (32 + r() * 14 | 0) + ',20,0.4)'; g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 9); } }, [60, 60]);
    var ground = mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }), 5, 0, 5, false); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    var pTex = canvasTex(128, 128, function (g, w, h) { var r = rnd(3); g.fillStyle = '#3a3630'; g.fillRect(0, 0, w, h); for (var i = 0; i < 400; i++) { var v = 50 + r() * 50 | 0; g.fillStyle = 'rgb(' + v + ',' + (v - 4) + ',' + (v - 8) + ')'; g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 3, 0, 6.3); g.fill(); } }, [2, 14]);
    var path = mesh(new THREE.PlaneGeometry(3.2, 30), new THREE.MeshStandardMaterial({ map: pTex, roughness: 1 }), 6.0, 0.015, 37, false); path.rotation.x = -Math.PI / 2; path.receiveShadow = true;
    // ---------- masses: floor 1 (y 0..3.2) ----------
    var F = 3.2, S = 6.0, rects = [
      ['front', 3.2, 8.8, 16.2, 20.6], ['spine', 4.4, 8.0, 3.4, 16.4], ['west', -5.6, 4.6, 8.4, 13.4], ['east', 7.8, 21.2, 7.9, 13.6], ['north', 2.4, 9.6, -1.9, 3.6]];
    rects.forEach(function (r) { mass(r[1], r[2], r[3], r[4], 0, F); solid(r[1], r[2], r[3], r[4]); });
    var rects2 = [['front', 3.2, 8.8, 16.2, 20.6, S], ['spine', 4.4, 8.0, 3.4, 16.4, S + 0.6], ['west', -5.6, 4.6, 8.4, 13.4, S - 0.2], ['east', 7.8, 21.2, 7.9, 13.6, S - 0.4], ['north', 2.4, 9.6, -1.9, 3.6, S - 0.4]];
    rects2.forEach(function (r) { mass(r[1] + 0.05, r[2] - 0.05, r[3] + 0.05, r[4] - 0.05, F, r[5]); mass(r[1] - 0.12, r[2] + 0.12, r[3] - 0.12, r[4] + 0.12, F - 0.12, F + 0.1, mTrim); mass(r[1] - 0.12, r[2] + 0.12, r[3] - 0.12, r[4] + 0.12, 0, 0.45, mStone); });
    // ---------- roofs (triangular prisms and cones) ----------
    function prism(x0, x1, z0, z1, yBase, rise, alongX, mat) {
      var w = alongX ? z1 - z0 : x1 - x0, len = alongX ? x1 - x0 : z1 - z0, ov = 0.55, hw = w / 2 + ov, hl = len / 2 + 0.3, sh = new THREE.Shape(); sh.moveTo(-hw, 0); sh.lineTo(hw, 0); sh.lineTo(0, rise); sh.closePath();
      var g = new THREE.ExtrudeGeometry(sh, { depth: hl * 2, bevelEnabled: false }); g.translate(0, 0, -hl);
      // uv in world scale
      var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
      var m = mesh(g, mat || mRoof, (x0 + x1) / 2, yBase, (z0 + z1) / 2); if (alongX) m.rotation.y = Math.PI / 2; return m;
    }
    prism(3.2, 8.8, 16.2, 20.6, S, 2.8, false); prism(4.4, 8.0, 3.4, 16.4, S + 0.6, 2.4, false); prism(-5.6, 4.6, 8.4, 13.4, S - 0.2, 2.6, true); prism(7.8, 21.2, 7.9, 13.6, S - 0.4, 2.8, true); prism(2.4, 9.6, -1.9, 3.6, S - 0.4, 2.6, true);
    // gable end walls under the roof (fill triangles) are covered by the walls; add attic window discs later
    // ---------- towers ----------
    var tw = [[5.0, 7.4, 13.4, 15.8]]; mass(5.0, 7.4, 13.4, 15.8, S + 0.6, 10.2); mass(4.88, 7.52, 13.28, 15.92, 10.0, 10.3, mTrim); mesh(new THREE.ConeGeometry(2.2, 3.4, 4), mRoof, 6.2, 12.0, 14.6).rotation.y = Math.PI / 4; mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), mIron, 6.2, 14.4, 14.6);
    var rt = mesh(new THREE.CylinderGeometry(1.7, 1.8, 9.6, 14), mWall, -4.6, 4.8, 9.8); rt.material = mWall; mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.25, 14), mTrim, -4.6, 9.6, 9.8); mesh(new THREE.ConeGeometry(2.1, 3.6, 14), mRoof, -4.6, 11.5, 9.8); mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), mIron, -4.6, 13.9, 9.8); solid(-6.4, -2.8, 8.0, 11.6);
    // chimneys
    [[18.0, 10.7, 6.0, 9.6], [-1.6, 10.9, 5.8, 9.2], [6.2, 5.0, 6.6, 9.4], [13.0, 12.2, 5.6, 9.0]].forEach(function (c) { mesh(boxG(0.9, c[3] - c[2], 0.9), mStone, c[0], (c[2] + c[3]) / 2, c[1]); mesh(boxG(1.15, 0.2, 1.15), mTrim, c[0], c[3] + 0.1, c[1]); });
    // ---------- porch and entrance (kitchen side, south) ----------
    mass(3.9, 8.1, 20.6, 23.0, 0, 0.4, mStone); [0, 1, 2].forEach(function (k) { mass(4.3 + k * 0.3, 7.7 - k * 0.3, 23.0 + k * 0.45, 23.45 + k * 0.45, 0, 0.4 - k * 0.12, mStone); });
    [4.2, 7.8].forEach(function (x) { [20.9, 22.8].forEach(function (z) { var c = mesh(new THREE.CylinderGeometry(0.17, 0.2, 3.0, 10), mWood, x, 1.9, z); mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 10), mTrim, x, 3.45, z); solid(x - 0.25, x + 0.25, z - 0.25, z + 0.25); }); });
    mass(3.9, 8.1, 20.6, 23.0, 3.45, 3.6, mTrim); prism(3.9, 8.1, 20.6, 23.0, 3.6, 1.4, false);
    var doorG = new THREE.Group(); doorG.position.set(5.4, 0.4, 20.62); group.add(doorG); // hinge on the left edge of the door, door opens outward
    mesh(boxG(1.7, 2.7, 0.2), mTrim, 6.0, 0.4 + 1.35, 20.55); mesh(new THREE.PlaneGeometry(1.2, 2.3), mBlack, 6.0, 0.4 + 1.15, 20.6, false);
    doorG.position.set(5.4, 0.4, 20.65); var dleaf = mesh(boxG(1.2, 2.3, 0.07), mWood, 0.6, 1.15, 0.0, true, doorG); mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.9, roughness: 0.4 }), 1.0, 1.1, 0.06, true, doorG);
    var doorIt = { name: 'frontDoor', label: 'الباب الأمامي', object: doorG, mesh: dleaf, open: false, t: 0 };
    // porch lantern
    var lanternMat = new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xffa040, emissiveIntensity: 1.0 }); mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), lanternMat, 6.0, 3.0, 20.9, false); var lanternL = new THREE.PointLight(0xffa860, 0.9, 9, 2); lanternL.position.set(6.0, 2.9, 21.2); group.add(lanternL);
    // ---------- windows (instanced: dark, lit, boarded) ----------
    function winTex(kind) { return canvasTex(96, 144, function (g, w, h) { var r = rnd(kind * 11 + 3); g.fillStyle = kind === 1 ? '#c8883a' : (kind === 2 ? '#2a2018' : '#0a1018'); g.fillRect(0, 0, w, h); if (kind === 1) { var gr = g.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, 80); gr.addColorStop(0, 'rgba(255,220,140,0.9)'); gr.addColorStop(1, 'rgba(120,60,20,0.2)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } if (kind === 0) { g.strokeStyle = 'rgba(120,150,190,0.25)'; for (var i = 0; i < 5; i++) { g.beginPath(); var x = r() * w, y = r() * h; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 60); g.stroke(); } }
      if (kind === 2) { for (var p = 0; p < 5; p++) { g.fillStyle = 'rgb(' + (50 + r() * 30 | 0) + ',' + (38 + r() * 20 | 0) + ',24)'; g.save(); g.translate(w / 2, 14 + p * 28); g.rotate((r() - 0.5) * 0.16); g.fillRect(-w / 2 - 6, -9, w + 12, 18); g.restore(); } }
      g.strokeStyle = '#20180f'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); if (kind !== 2) { g.beginPath(); g.moveTo(w / 2, 3); g.lineTo(w / 2, h - 3); g.moveTo(3, h * 0.38); g.lineTo(w - 3, h * 0.38); g.stroke(); } }); }
    var winMats = [new THREE.MeshBasicMaterial({ map: winTex(0), color: 0xaab4c8 }), new THREE.MeshBasicMaterial({ map: winTex(1) }), new THREE.MeshBasicMaterial({ map: winTex(2), color: 0x888888 })];
    var winSpots = [[], [], []], wr = rnd(33);
    function inside(px, pz, y) { var list = y < F ? rects : rects2; for (var i = 0; i < list.length; i++) { var r = list[i]; if (px > r[1] - 0.2 && px < r[2] + 0.2 && pz > r[3] - 0.2 && pz < r[4] + 0.2) return true; } return false; }
    function addWin(x, y, z, face, kind) { winSpots[kind].push([x, y, z, face]); }
    function wallWins(r, floorY, sp, skip) { // r = rect [name,x0,x1,z0,z1]
      var x0 = r[1], x1 = r[2], z0 = r[3], z1 = r[4], y = floorY, i, n, v;
      function put(px, pz, face, ox, oz) { if (inside(px + ox * 0.5, pz + oz * 0.5, floorY)) return; if (skip && skip(px, pz, face)) return; v = wr(); addWin(px + ox * 0.02, y, pz + oz * 0.02, face, v < 0.2 ? 1 : (v < 0.34 ? 2 : 0)); }
      n = Math.floor((x1 - x0 - 0.8) / sp); for (i = 0; i < n; i++) { var px = x0 + 0.4 + (x1 - x0 - 0.8) * (i + 0.5) / n; put(px, z1, 'z+', 0, 1); put(px, z0, 'z-', 0, -1); }
      n = Math.floor((z1 - z0 - 0.8) / sp); for (i = 0; i < n; i++) { var pz = z0 + 0.4 + (z1 - z0 - 0.8) * (i + 0.5) / n; put(x1, pz, 'x+', 1, 0); put(x0, pz, 'x-', -1, 0); }
    }
    var skipDoor = function (px, pz, face) { return face === 'z+' && pz > 20 && px > 4.7 && px < 7.3; };
    rects.forEach(function (r) { wallWins(r, 1.6, 2.6, skipDoor); });
    rects2.forEach(function (r) { wallWins(r, F + 1.4, 2.6); });
    addWin(4.0, 1.6, 20.62, 'z+', 0); addWin(8.0, 1.6, 20.62, 'z+', 1);
    [['z+', 6.2, 10.0, 15.94, 0], ['z-', 6.2, 10.0, 13.26, 1], ['x+', 7.54, 10.0, 14.6, 0], ['x-', 4.86, 10.0, 14.6, 1], ['z+', 6.2, 8.2, 15.94, 0]].forEach(function (a) { var o = { 'z+': [0, 1], 'z-': [0, -1], 'x+': [1, 0], 'x-': [-1, 0] }[a[0]]; addWin(a[1] + o[0] * 0.02, a[2], a[3] + o[1] * 0.02, a[0], a[4]); });
    var ang = [0.4, 1.4, 2.5, 3.6, 4.7, 5.8]; ang.forEach(function (a, k) { addWin(-4.6 + Math.sin(a) * 1.72, 6.0 + (k % 2) * 1.8, 9.8 + Math.cos(a) * 1.72, 'r' + a, k % 3 === 0 ? 1 : 0); });
    var wGeo = new THREE.PlaneGeometry(0.95, 1.45), wInst = [], figSpot = null;
    winSpots.forEach(function (list, kind) { var im = new THREE.InstancedMesh(wGeo, winMats[kind], Math.max(1, list.length)); im.count = list.length; var d = new THREE.Object3D(); list.forEach(function (s, i) { d.position.set(s[0], s[1], s[2]); var f = s[3], ry = f === 'z+' ? 0 : f === 'z-' ? Math.PI : f === 'x+' ? Math.PI / 2 : f === 'x-' ? -Math.PI / 2 : Math.atan2(Math.sin(+f.slice(1)), Math.cos(+f.slice(1))); d.rotation.set(0, ry, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }); group.add(im); wInst.push(im); });
    // silhouette in the tower window (appears now and then)
    var figTex = canvasTex(64, 128, function (g, w, h) { g.fillStyle = '#0a0806'; g.beginPath(); g.arc(32, 30, 13, 0, 6.3); g.fill(); g.fillRect(14, 42, 36, 90); }), figMat = new THREE.MeshBasicMaterial({ map: figTex, transparent: true });
    var fig = mesh(new THREE.PlaneGeometry(0.62, 1.2), figMat, 6.2, 9.7, 15.97, false); fig.visible = false;
    // ---------- fence, gate, trees, graves ----------
    var rf = rnd(21);
    function fenceLine(x0, z0, x1, z1) { var len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 0.35), a = Math.atan2(x1 - x0, z1 - z0); var im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 1.5, 0.04), mIron, n), d = new THREE.Object3D(); for (var i = 0; i < n; i++) { var t = i / n; d.position.set(x0 + (x1 - x0) * t, 0.75 + (rf() - 0.5) * 0.04, z0 + (z1 - z0) * t); d.rotation.set((rf() - 0.5) * 0.06, 0, (rf() - 0.5) * 0.06); d.updateMatrix(); im.setMatrixAt(i, d.matrix); } group.add(im);
      [0.35, 1.2].forEach(function (y) { var r = mesh(new THREE.BoxGeometry(0.04, 0.04, len), mIron, (x0 + x1) / 2, y, (z0 + z1) / 2, false); r.rotation.y = a; }); }
    var fx0 = -14, fx1 = 26, fz0 = -9, fz1 = 32;
    fenceLine(fx0, fz0, fx1, fz0); fenceLine(fx0, fz0, fx0, fz1); fenceLine(fx1, fz0, fx1, fz1); fenceLine(fx0, fz1, 4.0, fz1); fenceLine(8.0, fz1, fx1, fz1);
    [4.0, 8.0].forEach(function (x) { mesh(boxG(0.5, 2.2, 0.5), mStone, x, 1.1, fz1); mesh(new THREE.SphereGeometry(0.28, 8, 6), mStone, x, 2.35, fz1); });
    var gateG = new THREE.Group(); gateG.position.set(4.25, 0, fz1); group.add(gateG); for (var gi = 0; gi < 5; gi++) mesh(new THREE.BoxGeometry(0.04, 1.6, 0.04), mIron, 0.15 + gi * 0.3, 0.8, 0, false, gateG); mesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), mIron, 0.75, 1.2, 0, false, gateG); gateG.rotation.y = 0.5; var gate2 = new THREE.Group(); gate2.position.set(7.75, 0, fz1); group.add(gate2); for (gi = 0; gi < 5; gi++) mesh(new THREE.BoxGeometry(0.04, 1.6, 0.04), mIron, -0.15 - gi * 0.3, 0.8, 0, false, gate2); mesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), mIron, -0.75, 1.2, 0, false, gate2); gate2.rotation.y = 0.15;
    solid(fx0 - 1, fx0, fz0, fz1); solid(fx1, fx1 + 1, fz0, fz1); solid(fx0, fx1, fz0 - 1, fz0); solid(fx0, 3.9, fz1, fz1 + 1); solid(8.1, fx1, fz1, fz1 + 1);
    function tree(x, z, s, seed) { var r = rnd(seed), g = new THREE.Group(); g.position.set(x, 0, z); group.add(g); var tk = mesh(new THREE.CylinderGeometry(0.1 * s, 0.22 * s, 3.2 * s, 7), mTrim, 0, 1.6 * s, 0, true, g); tk.rotation.z = (r() - 0.5) * 0.12;
      for (var i = 0; i < 7; i++) { var L = (1.2 + r() * 1.6) * s, b = mesh(new THREE.CylinderGeometry(0.02 * s, 0.07 * s, L, 5), mTrim, 0, 2.0 * s + r() * 1.3 * s, 0, true, g), a = r() * 6.28, tl = 0.7 + r() * 0.7; b.rotation.set(Math.cos(a) * tl, 0, Math.sin(a) * tl); b.position.x = Math.sin(a) * L * 0.3; b.position.z = Math.cos(a) * L * 0.3; var sub = mesh(new THREE.CylinderGeometry(0.01 * s, 0.03 * s, L * 0.6, 4), mTrim, 0, L * 0.45, 0, false, b); sub.rotation.z = 0.8; } solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3); }
    [[-10, 22, 1.5], [-8, 4, 1.7], [-11, -3, 1.4], [16, 24, 1.6], [22, 18, 1.3], [24, 2, 1.8], [12, -5, 1.5], [-3, -6, 1.6], [2, 27, 1.3], [11, 27, 1.2], [-12, 13, 1.7], [23, 28, 1.4]].forEach(function (t, k) { tree(t[0], t[1], t[2], 40 + k * 7); });
    for (var gk = 0; gk < 8; gk++) { var gx = -12 + (gk % 4) * 1.6, gz = 17 + Math.floor(gk / 4) * 2.2, st = mesh(boxG(0.7, 1.0, 0.18), mStone, gx, 0.5, gz); st.rotation.set((rf() - 0.5) * 0.2, (rf() - 0.5) * 0.4, (rf() - 0.5) * 0.15); mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 10, 1, false, 0, 3.14), mStone, gx, 1.0, gz).rotation.x = Math.PI / 2; solid(gx - 0.4, gx + 0.4, gz - 0.2, gz + 0.2); }
    // ---------- sky, moon, lights ----------
    var sp = [], sr = rnd(8); for (var si = 0; si < 320; si++) { var a1 = sr() * 6.283, a2 = 0.12 + sr() * 1.3, R0 = 95; sp.push(Math.cos(a1) * Math.cos(a2) * R0, Math.sin(a2) * R0, Math.sin(a1) * Math.cos(a2) * R0); }
    var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); var stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.7, sizeAttenuation: false, fog: false })); group.add(stars);
    var moonMesh = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 14), new THREE.MeshBasicMaterial({ color: 0xdfe6f5, fog: false })); moonMesh.position.set(-40, 52, -70); group.add(moonMesh);
    var halo = canvasTex(128, 128, function (g, w, h) { var gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(170,190,255,0.5)'); gr.addColorStop(1, 'rgba(170,190,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }); var hs = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, fog: false, transparent: true, depthWrite: false })); hs.scale.set(30, 30, 1); hs.position.copy(moonMesh.position); group.add(hs);
    var sun = new THREE.DirectionalLight(0x7f94cc, 0.75); sun.position.set(-26, 36, -30); sun.target.position.set(6, 0, 8); sun.castShadow = true; var sm = q === '1k' ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm); var sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 5; sc.far = 110; sun.shadow.bias = -0.0006; group.add(sun, sun.target);
    var hemi = new THREE.HemisphereLight(0x3a4668, 0x10120c, 0.35); group.add(hemi);
    if (opt.fog !== false) group.userData.fog = { color: 0x0a0e18, density: 0.016 };
    // ---------- sound ----------
    var A = null, audio = { fear: 0.1 };
    audio.start = function () { if (A) return; var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; var ctx = new AC(); if (ctx.resume) ctx.resume(); var master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      var b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var n = ctx.createBufferSource(); n.buffer = b; n.loop = true; var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 350; f.Q.value = 0.8; var g = ctx.createGain(); g.gain.value = 0.05; var lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 0.035; lfo.connect(lg); lg.connect(g.gain); lfo.start(); n.connect(f); f.connect(g); g.connect(master); n.start();
      var cr = ctx.createOscillator(), cg = ctx.createGain(); cr.type = 'sine'; cr.frequency.value = 46; cg.gain.value = 0.03; cr.connect(cg); cg.connect(master); cr.start(); A = { ctx: ctx, master: master, buf: b }; };
    function hit(freq, qq, peak, dur, type) { if (!A) return; var t = A.ctx.currentTime, s = A.ctx.createBufferSource(); s.buffer = A.buf; var f = A.ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = qq; var g = A.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f); f.connect(g); g.connect(A.master); s.start(t); s.stop(t + dur + 0.1); }
    audio.thunder = function () { hit(90, 0.6, 0.5, 3.5, 'lowpass'); setTimeout(function () { hit(60, 0.6, 0.3, 2.5, 'lowpass'); }, 700); };
    audio.creak = function () { if (!A) return; var t = A.ctx.currentTime, o = A.ctx.createOscillator(), bp = A.ctx.createBiquadFilter(), g = A.ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(160, t + 0.5); o.frequency.linearRampToValueAtTime(100, t + 1.1); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 4; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2); o.connect(bp); bp.connect(g); g.connect(A.master); o.start(t); o.stop(t + 1.3); };
    // ---------- update / use / pick ----------
    var T = 0, flash = 0, nextFlash = 25 + Math.random() * 20, nextFig = 20 + Math.random() * 15, figLeft = 0;
    function use(it) { if (it === doorIt) { doorIt.open = !doorIt.open; audio.creak(); } }
    function update(dt) {
      T += dt; var goal = doorIt.open ? 1 : 0; doorIt.t += (goal - doorIt.t) * Math.min(1, dt * 3); doorG.rotation.y = -doorIt.t * 1.6;
      var lv = 1 + Math.sin(T * 9) * 0.06 + (Math.random() < 0.02 ? -0.4 : 0); lanternL.intensity = 0.9 * lv; lanternMat.emissiveIntensity = lv; winMats[1].color.setScalar(0.85 + 0.15 * Math.sin(T * 5.3) * Math.sin(T * 1.7 + 1));
      nextFlash -= dt; if (nextFlash <= 0) { nextFlash = 35 + Math.random() * 40; flash = 0.5; setTimeout(audio.thunder, 800 + Math.random() * 1500); }
      if (flash > 0) { flash -= dt; var k = Math.max(0, flash) / 0.5, jag = Math.sin(flash * 60) > 0 ? 1 : 0.4; sun.intensity = 0.75 + 3.0 * k * jag; hemi.intensity = 0.35 + 1.2 * k * jag; } else { sun.intensity = 0.75; hemi.intensity = 0.35; }
      nextFig -= dt; if (nextFig <= 0 && figLeft <= 0) { nextFig = 50 + Math.random() * 50; figLeft = 7; fig.visible = true; } if (figLeft > 0) { figLeft -= dt; if (figLeft <= 0) fig.visible = false; }
      gateG.rotation.y = 0.5 + Math.sin(T * 0.4) * 0.06; gate2.rotation.y = 0.15 + Math.sin(T * 0.37 + 1) * 0.05;
    }
    function pick(ray, maxDist) { var h = ray.intersectObject(dleaf, false); return h.length && h[0].distance < (maxDist || 5) ? doorIt : null; }
    group.userData.interactives = [doorIt];
    return { group: group, update: update, colliders: colliders, pick: pick, use: use, audio: audio, interactives: [doorIt], progress: progress, fog: group.userData.fog,
      spawn: { x: 6.0, z: 31, yaw: 0 }, center: { x: 8, y: 4, z: 8 }, bounds: { minX: fx0 - 0.5, maxX: fx1 + 0.5, minZ: fz0 - 0.5, maxZ: fz1 + 8 }, door: { x: 6.0, z: 20.6 }, size: { w: 26.8, d: 22.5, h: 14.8 }, license: 'Textures: Poly Haven, CC0', version: '0.1' };
  }
  root.MansionModule = { build: build, version: '0.1' };
})(typeof window !== 'undefined' ? window : this);
