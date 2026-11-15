/* =========================================================================
   Orbit Viewer (three.js): Earth with NASA GIBS textures, real-time
   satellite positions and orbits, fleet list and satellite management.
   ========================================================================= */

const OrbitView = (() => {
  let renderer, scene, camera, controls, earth, earthMat, atmo, sunSprite, raycaster, debrisPts;
  const satObjs = {};   // id -> { dot, hit, line, model, lastEl }
  const gsObjs = [], siteObjs = [];
  let selectedId = null, tab = 'overview', follow = false, inited = false;
  let lastPanel = 0, nextContactCache = { id: null, t: 0, val: null };
  const R = 1; // Earth radius in scene units

  // ECI / ECEF vector (m) → three.js (y up)
  const toThree = p => new THREE.Vector3(p[0] / ORB.RE, p[2] / ORB.RE, -p[1] / ORB.RE);
  const llToLocal = (lat, lon, r = 1.001) => { const u = ORB.latLonToUnit(lat, lon); return new THREE.Vector3(u[0] * r, u[2] * r, -u[1] * r); };

  function dotTexture(color) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function init() {
    inited = true;
    const canvas = $('#orbit-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#02040b');
    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    camera.position.set(2.2, 1.6, 3.4);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 1.08; controls.maxDistance = 40;
    controls.addEventListener('start', () => { if (follow) { follow = false; renderPanel(true); } });
    raycaster = new THREE.Raycaster();

    // stars
    const sg = new THREE.BufferGeometry(); const sp = [];
    for (let i = 0; i < 4000; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(150 + Math.random() * 50); sp.push(v.x, v.y, v.z); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.8 })));

    // Earth with day/night shader
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    const blank = new THREE.DataTexture(new Uint8Array([20, 60, 120, 255]), 1, 1); blank.needsUpdate = true;
    const blackT = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); blackT.needsUpdate = true;
    earthMat = new THREE.ShaderMaterial({
      uniforms: { dayTex: { value: blank }, nightTex: { value: blackT }, methTex: { value: blackT }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, showMeth: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vUv = uv; vN = normalize((modelMatrix * vec4(normal,0.)).xyz); vW = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.); }`,
      fragmentShader: `uniform sampler2D dayTex; uniform sampler2D nightTex; uniform sampler2D methTex; uniform vec3 sunDir; uniform float showMeth;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 day = texture2D(dayTex, vUv).rgb; vec3 night = texture2D(nightTex, vUv).rgb;
          float d = dot(normalize(vN), normalize(sunDir));
          float k = smoothstep(-0.10, 0.12, d);
          vec3 col = mix(night * vec3(1.25,1.1,0.85) + day * 0.035, day * (0.18 + 0.95 * max(d, 0.0)), k);
          vec4 m = texture2D(methTex, vUv);
          col = mix(col, m.rgb * (0.45 + 0.6 * k), m.a * 0.8 * showMeth);
          vec3 viewDir = normalize(cameraPosition - vW);
          float rim = pow(1.0 - max(dot(viewDir, normalize(vN)), 0.0), 3.0);
          col += vec3(0.25, 0.5, 1.0) * rim * (0.25 + 0.75 * k);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), earthMat);
    scene.add(earth);
    loader.load(NASA_GIBS.globeImage('day'), t => { t.anisotropy = 4; earthMat.uniforms.dayTex.value = t; });
    loader.load(NASA_GIBS.globeImage('night'), t => { earthMat.uniforms.nightTex.value = t; });
    $('#ov-methane').addEventListener('change', e => {
      earthMat.uniforms.showMeth.value = e.target.checked ? 1 : 0;
      if (e.target.checked && earthMat.uniforms.methTex.value === blackT) loader.load(NASA_GIBS.globeImage('methane'), t => { earthMat.uniforms.methTex.value = t; UI.toast('AIRS methane: latest monthly mean at 400 hPa from NASA GIBS.', '', 'NASA data'); });
    });

    // atmosphere halo
    atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.025, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0,0,1.)), 3.0); gl_FragColor = vec4(0.3,0.6,1.0,1.0) * i; }',
    }));
    scene.add(atmo);

    // sun glow
    sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture('#ffdd88'), color: 0xffffff, transparent: true, depthWrite: false }));
    sunSprite.scale.set(8, 8, 1);
    scene.add(sunSprite);

    // ground stations & sites (children of Earth so they rotate with it)
    const gsTex = dotTexture('#9ad1ff'), optTex = dotTexture('#c792ff');
    GROUND_STATIONS.forEach(gs => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gs.optical ? optTex : gsTex, depthTest: true, transparent: true }));
      s.position.copy(llToLocal(gs.lat, gs.lon, 1.004)); s.scale.set(0.035, 0.035, 1); s.userData = gs;
      earth.add(s); gsObjs.push(s);
    });
    SITES.forEach((site, i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(SITE_TYPES[site.type].color), transparent: true }));
      s.position.copy(llToLocal(site.lat, site.lon, 1.003)); s.scale.set(0.03, 0.03, 1); s.userData = { i };
      earth.add(s); siteObjs.push(s);
    });
    debrisPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x8a94a8, size: 0.012 }));
    scene.add(debrisPts);

    // interactions
    canvas.addEventListener('pointerdown', e => { canvas._down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', e => {
      if (!canvas._down || Math.hypot(e.clientX - canvas._down[0], e.clientY - canvas._down[1]) > 5) return;
      pick(e);
    });
    $('#ov-orbits').addEventListener('change', () => Object.values(satObjs).forEach(o => { o.line.visible = $('#ov-orbits').checked; }));
    $('#ov-gs').addEventListener('change', e => gsObjs.forEach(s => { s.visible = e.target.checked; }));
    $('#ov-sites').addEventListener('change', e => siteObjs.forEach(s => { s.visible = e.target.checked; }));
    $('#ov-debris').addEventListener('change', e => { debrisPts.visible = e.target.checked; });
    $('#ov-focus-earth').addEventListener('click', () => { follow = false; controls.target.set(0, 0, 0); camera.position.setLength(Math.max(3, camera.position.length())); renderPanel(true); });
    $('#fleet-toggle').addEventListener('click', () => { $('#fleet-panel').hidden = !$('#fleet-panel').hidden; if (!$('#fleet-panel').hidden) { $('#manage-panel').hidden = true; $('#fleet-toggle').style.right = ''; } renderFleet(); });
    $('#fleet-close').addEventListener('click', () => { $('#fleet-panel').hidden = true; });
    $('#orbit-labels').addEventListener('click', e => { const l = e.target.closest('[data-sat]'); if (l) select(l.dataset.sat); });
    window.addEventListener('resize', resize);
    SIM.on('satellites', () => { syncSats(); renderFleet(); });
    resize();
    syncSats();
  }

  function resize() {
    if (!renderer) return;
    const w = $('#orbit-canvas-wrap').clientWidth, h = $('#orbit-canvas-wrap').clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(m, camera);
    const hits = raycaster.intersectObjects(Object.values(satObjs).map(o => o.hit));
    if (hits.length) select(hits[0].object.userData.id);
  }

  function satColor(s) { return s.status !== 'active' ? '#6b7a94' : s.safeMode ? '#ffc24b' : '#7cf2c8'; }

  function buildModel() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.010, 0.022), new THREE.MeshBasicMaterial({ color: 0xd5dbe6 }));
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x2a5bd7, side: THREE.DoubleSide });
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.012), panelMat); p1.position.x = 0.021;
    const p2 = p1.clone(); p2.position.x = -0.021;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.004, 12), new THREE.MeshBasicMaterial({ color: 0xff8a3d }));
    lens.position.y = -0.007;
    g.add(body, p1, p2, lens);
    return g;
  }

  function syncSats() {
    const S = SIM.state;
    for (const sat of S.satellites) {
      if (satObjs[sat.id]) continue;
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(satColor(sat)), transparent: true, depthWrite: false }));
      dot.scale.set(0.05, 0.05, 1);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.id = sat.id;
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7cf2c8, transparent: true, opacity: 0.45 }));
      line.visible = $('#ov-orbits').checked;
      const model = buildModel(); model.visible = false;
      scene.add(dot, hit, line, model);
      satObjs[sat.id] = { dot, hit, line, model, lastEl: null, color: satColor(sat) };
    }
  }

  function updateOrbitLine(sat, o) {
    const S = SIM.state;
    const el = ORB.propagate(sat.el, S.t);
    if (o.lastEl && Math.abs(o.lastEl.a - el.a) < 50 && Math.abs(o.lastEl.raan - el.raan) < 0.002 && Math.abs(o.lastEl.i - el.i) < 1e-4 && Math.abs(o.lastEl.e - el.e) < 1e-5 && o.statusDrawn === sat.status) return;
    o.lastEl = el; o.statusDrawn = sat.status;
    const pts = [];
    for (let k = 0; k <= 200; k++) {
      const { r } = ORB.coe2rv({ ...el, M: (k / 200) * ORB.TAU });
      pts.push(toThree(r));
    }
    o.line.geometry.dispose();
    o.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const sel = sat.id === selectedId;
    o.line.material.color.set(sat.status !== 'active' ? 0x6b7a94 : sel ? 0x4cc3ff : 0x7cf2c8);
    o.line.material.opacity = sel ? 0.9 : 0.4;
  }

  function frame() {
    if (!inited || UI.active() !== 'orbit') return;
    const S = SIM.state;
    earth.rotation.y = ORB.gmst(S.t);
    const sun = toThree(ORB.sunDir(S.t)).normalize();
    earthMat.uniforms.sunDir.value.copy(sun);
    sunSprite.position.copy(sun.clone().multiplyScalar(120));
    const labels = [];
    const camDist = camera.position.distanceTo(controls.target);
    for (const sat of S.satellites) {
      const o = satObjs[sat.id]; if (!o) continue;
      const visible = sat.status === 'active' || sat.status === 'dead';
      o.dot.visible = o.hit.visible = visible;
      o.line.visible = visible && $('#ov-orbits').checked;
      if (!visible) { o.model.visible = false; continue; }
      const st = ORB.stateAt(sat.el, S.t);
      const p = toThree(st.r);
      o.dot.position.copy(p); o.hit.position.copy(p);
      const col = satColor(sat);
      if (col !== o.color) { o.color = col; o.dot.material.map = dotTexture(col); o.dot.material.needsUpdate = true; }
      const sel = sat.id === selectedId;
      const near = sel && camera.position.distanceTo(p) < 0.6;
      o.model.visible = near; o.dot.visible = !near;
      if (near) {
        o.model.position.copy(p);
        // nadir-pointing frame: -y toward Earth, z along velocity, then the player's manual attitude
        const up = p.clone().normalize();
        const vel = toThree(st.v).normalize();
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, vel).normalize(), up, vel);
        o.model.quaternion.setFromRotationMatrix(m);
        const a = sat.attitude;
        if (a.mode === 'manual') o.model.rotateX(a.pitch * ORB.DEG).rotateZ(a.roll * ORB.DEG).rotateY(a.yaw * ORB.DEG);
        if (a.mode === 'sun') o.model.lookAt(sun.clone().multiplyScalar(100));
        const s = Math.max(0.6, camera.position.distanceTo(p) * 6);
        o.model.scale.setScalar(Math.min(4, s));
      }
      o.dot.scale.setScalar(sel ? 0.07 : 0.05);
      updateOrbitLine(sat, o);
      if (sel && follow) {
        const delta = p.clone().sub(controls.target);
        controls.target.add(delta); camera.position.add(delta);
      }
      labels.push({ p, text: sat.name + (sat.status === 'dead' ? ' (dead)' : sat.safeMode ? ' ⚠' : ''), cls: sel ? 'sel' : sat.status === 'dead' ? 'dead' : '', id: sat.id });
    }
    // debris
    if (debrisPts.visible && S.debris.length) {
      const arr = [];
      S.debris.forEach(d => { const st = ORB.stateAt(d.el, S.t); const p = toThree(st.r); arr.push(p.x, p.y, p.z); });
      debrisPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    }
    controls.update();
    renderer.render(scene, camera);
    drawLabels(labels, camDist);
    if (performance.now() - lastPanel > 300) { renderPanel(); renderFleetLive(); lastPanel = performance.now(); }
  }

  function drawLabels(list, camDist) {
    const box = $('#orbit-labels');
    if (!$('#ov-labels').checked) { box.innerHTML = ''; return; }
    const w = box.clientWidth, h = box.clientHeight;
    const camDir = camera.position.clone();
    let html = '';
    const occluded = p => { // behind Earth?
      const toP = p.clone().sub(camera.position); const t = -camera.position.dot(toP) / toP.lengthSq();
      if (t <= 0 || t >= 1) return false;
      return camera.position.clone().add(toP.multiplyScalar(t)).length() < R;
    };
    for (const l of list) {
      if (occluded(l.p)) continue;
      const v = l.p.clone().project(camera);
      if (v.z > 1) continue;
      html += `<div class="olabel ${l.cls}" data-sat="${l.id}" style="left:${(v.x + 1) / 2 * w}px;top:${(1 - v.y) / 2 * h}px">${esc(l.text)}</div>`;
    }
    if ($('#ov-gs').checked && camDist < 4) {
      gsObjs.forEach(s => {
        const wp = s.getWorldPosition(new THREE.Vector3());
        if (wp.dot(camDir) < 0.2) return;
        const v = wp.project(camera);
        html += `<div class="olabel gs" style="left:${(v.x + 1) / 2 * w}px;top:${(1 - v.y) / 2 * h}px">${esc(s.userData.name)}</div>`;
      });
    }
    box.innerHTML = html;
  }

  /* ---------------- fleet panel ---------------- */
  function renderFleet() {
    const S = SIM.state;
    const list = $('#fleet-list');
    if (!S.satellites.length) { list.innerHTML = '<li class="muted" style="cursor:default">No satellites yet. Configure one on the Design page, then book it on the Launch tab.</li>'; return; }
    list.innerHTML = S.satellites.map(s => `<li data-id="${s.id}" class="${s.id === selectedId ? 'sel' : ''}">
      <b><span class="dot ${s.status !== 'active' ? 'off' : s.safeMode ? 'safe' : 'ok'}"></span>${esc(s.name)}</b><span class="mono" data-f="alt"></span>
      <small data-f="sub"></small></li>`).join('');
    $$('#fleet-list li[data-id]').forEach(li => li.onclick = () => select(li.dataset.id));
    renderFleetLive();
  }
  function renderFleetLive() {
    if ($('#fleet-panel').hidden) return;
    const S = SIM.state;
    $$('#fleet-list li[data-id]').forEach(li => {
      const s = S.satellites.find(x => x.id === li.dataset.id); if (!s) return;
      li.querySelector('[data-f=alt]').textContent = s.status === 'active' ? `${((s.el.a - ORB.RE) / 1000).toFixed(0)} km` : s.status;
      li.querySelector('[data-f=sub]').textContent = s.status === 'active'
        ? `${(s.el.i / ORB.DEG).toFixed(1)}° · ${s.safeMode ? 'SAFE MODE' : s.attitude.mode} · ${s.stats.detections} leaks · ${Math.round(s.soc / Math.max(1, SIM.capacityWh(s)) * 100)}% batt`
        : `ended ${SIM.fmtDate(s.endT || S.t)}`;
    });
  }

  function select(id) {
    selectedId = id;
    const o = satObjs[id];
    if (o) { o.lastEl = null; Object.entries(satObjs).forEach(([k, x]) => { if (k !== id) x.lastEl = null; }); }
    tab = tab || 'overview';
    $('#manage-panel').hidden = false;
    $('#fleet-panel').hidden = true;
    $('#fleet-toggle').style.right = '400px';
    renderPanel(true);
    renderFleet();
  }
  function focusSat() {
    const S = SIM.state, sat = S.satellites.find(s => s.id === selectedId); if (!sat) return;
    const p = toThree(ORB.stateAt(sat.el, S.t).r);
    controls.target.copy(p);
    camera.position.copy(p.clone().add(p.clone().normalize().multiplyScalar(0.12)).add(new THREE.Vector3(0.05, 0.05, 0.05)));
    follow = true;
  }

  /* ---------------- management panel ---------------- */
  function gauge(label, value, frac, cls = '') {
    return `<div class="gauge"><div class="lbl"><span>${label}</span><b>${value}</b></div><div class="bar"><i class="${cls}" style="width:${clamp(frac, 0, 1) * 100}%"></i></div></div>`;
  }

  function renderPanel(force) {
    const S = SIM.state;
    const panel = $('#manage-panel');
    if (panel.hidden) return;
    const sat = S.satellites.find(s => s.id === selectedId);
    if (!sat) { panel.hidden = true; return; }
    // don't rebuild while the player is typing in the panel
    if (!force && panel.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) { updateLive(sat); return; }
    if (!force && panel.dataset.sat === sat.id && panel.dataset.tab === tab && panel.dataset.status === sat.status + sat.safeMode + sat.attitude.mode + !!sat.maneuver) { updateLive(sat); return; }
    panel.dataset.sat = sat.id; panel.dataset.tab = tab; panel.dataset.status = sat.status + sat.safeMode + sat.attitude.mode + !!sat.maneuver;
    const c = sat.comp;
    const active = sat.status === 'active';
    const tabs = ['overview', 'power', 'attitude', 'propulsion', 'comms', 'payload'];
    let body = '';
    if (!active) {
      body = `<p class="note warn">${esc(sat.name)} is ${sat.status === 'dead' ? 'no longer working and is now debris' : 'gone: it re-entered the atmosphere'}.</p>
        <div class="kv"><span>Launched</span><b>${SIM.fmtDate(sat.launched)}</b><span>Ended</span><b>${SIM.fmtDate(sat.endT || S.t)}</b>
        <span>Leaks reported</span><b>${sat.stats.detections}</b><span>Data downlinked</span><b>${DESIGN.fmtMB(sat.stats.downMB)}</b></div>`;
    } else if (tab === 'overview') {
      const el = ORB.propagate(sat.el, S.t);
      const ap = el.a * (1 + el.e) - ORB.RE, pe = el.a * (1 - el.e) - ORB.RE;
      const sso = Math.abs(el.i / ORB.DEG - ORB.ssoInclination(el.a - ORB.RE) / ORB.DEG) < 0.3;
      const ltan = ORB.localSolarTime(((el.raan - ORB.gmst(S.t)) / ORB.DEG), S.t);
      body = `<div class="kv">
        <span>Status</span><b data-l="status"></b><span>Altitude</span><b data-l="alt"></b><span>Apoapsis × periapsis</span><b>${(ap / 1000).toFixed(0)} × ${(pe / 1000).toFixed(0)} km</b>
        <span>Inclination</span><b>${(el.i / ORB.DEG).toFixed(2)}°${sso ? ' (Sun-sync)' : ''}</b><span>Period</span><b>${(ORB.period(el.a) / 60).toFixed(1)} min</b>
        <span>Speed</span><b>${(Math.sqrt(ORB.MU / el.a) / 1000).toFixed(2)} km/s</b>${sso ? `<span>Local time of asc. node</span><b>${Math.floor(ltan)}:${String(Math.floor(ltan % 1 * 60)).padStart(2, '0')}</b>` : ''}
        <span>Position</span><b data-l="pos"></b><span>Sunlight</span><b data-l="sun"></b>
        <span>Radiation dose</span><b>${sat.dose.toFixed(2)} krad</b><span>In orbit since</span><b>${SIM.fmtDate(sat.launched)}</b>
        <span>Design score</span><b>${c.score.total}/100</b></div>
        <h3>Mission so far</h3><div class="kv"><span>Site observations</span><b data-l="obs"></b><span>Leaks reported</span><b data-l="det"></b>
        <span>Data downlinked</span><b data-l="down"></b><span>Ground passes</span><b data-l="passes"></b><span>Science points</span><b data-l="sci"></b></div>
        ${sat.faults.length ? `<h3>Faults</h3><ul class="leak-list">${sat.faults.map(f => `<li><span>${esc(f.text)}</span><span class="mono">${SIM.fmtDate(f.t)}</span></li>`).join('')}</ul>` : ''}
        ${sat.calibDrift ? `<p class="note warn">Calibration drift is reducing sensitivity by 15%.</p><button class="btn small" data-act="recal">Recalibrate ($5,000)</button>` : ''}
        <h3>Operations</h3>
        <div class="row"><button class="btn small ghost" data-act="follow">${follow ? '⊙ Following' : '🎯 Fly camera to satellite'}</button>
        <button class="btn small ${sat.safeMode ? '' : 'ghost'}" data-act="safe">${sat.safeMode ? 'Exit safe mode' : 'Enter safe mode'}</button>
        <button class="btn small danger" data-act="deorbit">Decommission</button></div>`;
    } else if (tab === 'power') {
      body = `<div data-l="powergauges"></div>
        <div class="kv" style="margin-top:8px"><span>Solar array</span><b>${esc(c.array.name)}</b><span>Orbit-average generation</span><b>${c.genAvg.toFixed(1)} W</b>
        <span>Orbit-average load</span><b>${c.avgLoad.toFixed(1)} W</b><span>Peak load</span><b>${c.peakLoad.toFixed(1)} W</b>
        <span>Batteries</span><b>${c.batteries.map(b => esc(b.name.split(' (')[0])).join(', ') || '—'}</b><span>Brownouts</span><b data-l="brown"></b></div>
        <h3>Controls</h3><div class="row">
        <button class="btn small ${sat.instrumentOn ? 'ghost' : ''}" data-act="instr">${sat.instrumentOn ? 'Switch instruments off' : 'Switch instruments on'}</button>
        <button class="btn small ghost" data-act="mode-sun">☀ Sun-point to charge</button></div>
        <p class="fine">Sun-pointing turns the solar panels square to the Sun (+35% power) but the instruments stop looking at Earth.</p>`;
    } else if (tab === 'attitude') {
      const a = sat.attitude;
      const siteOpts = SITES.map(s => `<option value="${s.id}" ${a.targetSite === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      body = `<p class="fine" style="margin-top:0">Reaction wheels (${esc(c.wheels.name)}) turn the satellite by spinning up flywheels. Magnetorquers slowly bleed off the stored momentum against Earth's magnetic field.</p>
        <div class="seg" style="margin:8px 0">${['nadir', 'target', 'sun', 'station', 'manual'].map(m => `<button data-mode="${m}" class="${a.mode === m ? 'on' : ''}">${{ nadir: '⬇ Nadir', target: '🎯 Target', sun: '☀ Sun', station: '📡 Station', manual: '🕹 Manual' }[m]}</button>`).join('')}</div>
        ${a.mode === 'target' ? `<label class="row">Target <select id="att-target"><option value="">Any site in reach</option>${siteOpts}</select></label>
          <p class="fine">Target mode lets steerable instruments (Zoom, LIDAR) look up to their pointing range off the ground track, at the cost of extra wheel momentum.</p>` : ''}
        ${a.mode === 'manual' ? `<canvas class="att-ball" id="att-ball" width="440" height="200"></canvas>
          ${['roll', 'pitch', 'yaw'].map(ax => `<div class="row"><span style="width:44px">${ax}</span><button class="btn small ghost" data-nudge="${ax}:-5">−5°</button>
          <input type="range" min="-45" max="45" step="1" value="${a[ax]}" data-axis="${ax}" style="flex:1"><button class="btn small ghost" data-nudge="${ax}:5">+5°</button><b class="mono" style="width:44px;text-align:right" data-ax="${ax}">${a[ax]}°</b></div>`).join('')}
          <p class="fine">Roll the satellite to look sideways: the instrument footprint moves ${((sat.alt || 500e3) / 1000 * Math.tan(5 * ORB.DEG)).toFixed(0)} km per 5° of roll. Pitch beyond ±10° stops observations.</p>` : ''}
        <div data-l="wheels"></div>
        <div class="row"><button class="btn small ghost" data-act="desat">Desaturate with thrusters</button></div>
        <div class="kv"><span>Pointing quality</span><b data-l="pq"></b><span>Fine pointing hardware</span><b>${c.needsFine ? 'star tracker' : 'sun sensors only'}</b></div>`;
    } else if (tab === 'propulsion') {
      const el = ORB.propagate(sat.el, S.t);
      body = `<div data-l="prop"></div>
        <div class="kv"><span>Thrusters</span><b>${c.engines.map(e => esc(e.name.split(' (')[0])).join(', ') || 'none'}</b>
        ${c.thrustChem ? `<span>Chemical</span><b>${(c.thrustChem).toFixed(2)} N · Isp ${c.ispChem} s</b>` : ''}${c.thrustElec ? `<span>Electric</span><b>${(c.thrustElec * 1000).toFixed(2)} mN · Isp ${c.ispElec} s</b>` : ''}</div>
        <label class="check"><input type="checkbox" id="sk" ${sat.stationKeep ? 'checked' : ''}> Automatic station-keeping at <input type="number" id="sk-alt" value="${Math.round(sat.targetAlt / 1000)}" min="200" max="2000" style="width:80px"> km</label>
        ${sat.maneuver ? `<div class="note">In progress: ${esc(sat.maneuver.label)} <button class="btn small ghost" data-act="cancel">Cancel</button></div>` : ''}
        ${sat.burns.length ? `<div class="note">Scheduled burn: ${esc(sat.burns[0].label)} at ${new Date(sat.burns[0].t).toISOString().slice(11, 19)} UTC</div>` : ''}
        <h3>Change altitude</h3><div class="row"><input type="number" id="mv-alt" value="${Math.round((el.a - ORB.RE) / 1000)}" min="200" max="2000"> km <button class="btn small" data-act="alt">Plan & execute</button></div>
        <p class="fine" data-l="altplan"></p>
        <h3>Change inclination</h3><div class="row"><input type="number" id="mv-inc" value="${(el.i / ORB.DEG).toFixed(1)}" step="0.1" min="0" max="180"> ° <button class="btn small ghost" data-act="inc">Execute</button></div>
        <p class="fine">Plane changes are the most expensive manoeuvre: 1° costs about ${(2 * ORB.circSpeed(el.a) * Math.sin(0.5 * ORB.DEG)).toFixed(0)} m/s.</p>
        <h3>Manual burn</h3><div class="row"><input type="number" id="mv-dv" value="1" min="0.01" step="0.1"> m/s</div>
        <div class="btn-grid">${['prograde', 'retrograde', 'normal', 'antinormal', 'radial', 'antiradial'].map(d => `<button class="btn ghost" data-burn="${d}">${d}</button>`).join('')}</div>`;
    } else if (tab === 'comms') {
      body = `<div data-l="store"></div>
        <div class="kv"><span>Radios</span><b>${c.comms.map(x => esc(x.name) + ' (' + x.rateTxt + ')').join('<br>') || 'none'}</b><span>In contact now</span><b data-l="contact"></b>
        <span>Next contact</span><b data-l="next"></b><span>Queued packets</span><b data-l="queue"></b><span>Data lost (storage full)</span><b data-l="lost"></b></div>
        <label class="check"><input type="checkbox" id="autodl" ${sat.autoDownlink ? 'checked' : ''}> Automatically downlink at every ground pass</label>
        <div class="row"><button class="btn" data-act="tx">📡 Transmit now</button><button class="btn small ghost" data-act="purge">Delete low-priority data</button></div>
        <p class="fine">Downlink time costs ${fmt$(GS_PER_MIN)}/minute on the commercial ground network. Leak detections are sent first. ${c.optical ? 'Laser links only work over the three optical stations when skies are clear.' : ''}${c.comms.some(x => x.directional) ? ' Directional antennas need good pointing during the pass.' : ''}</p>`;
    } else if (tab === 'payload') {
      body = `<div class="row"><button class="btn small ${sat.instrumentOn ? 'ghost' : ''}" data-act="instr">${sat.instrumentOn ? 'Switch instruments off' : 'Switch instruments on'}</button></div>
        ${c.detectors.map(d => `<div class="note"><b>${esc(d.name)}</b><div class="kv" style="margin-top:4px"><span>Effectiveness</span><b>${d.eff}%${sat.calibDrift ? ' (−15% drift)' : ''}</b><span>Swath</span><b>${d.swathKm} km${d.pointKm ? ` (+${d.pointKm} km steerable)` : ''}</b>
          <span>Smallest leak</span><b>${isFinite(d.threshold) ? d.threshold + ' kg/h' : 'cannot see CH₄'}</b><span>Needs sunlight</span><b>${d.dayOnly ? 'yes' : 'no'}</b><span>Data per look</span><b>${d.dataMB} MB</b></div></div>`).join('')}
        <div class="kv"><span>Observations</span><b data-l="obs"></b><span>Leaks reported</span><b data-l="det"></b></div>`;
    }
    panel.innerHTML = `<div class="panel-head"><h3 style="font-size:15px;color:var(--text);text-transform:none;letter-spacing:0">🛰️ ${esc(sat.name)}</h3><button class="icon-btn" id="mp-close" aria-label="Close">✕</button></div>
      <div class="mtabs">${tabs.map(t => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>${body}`;
    bindPanel(sat);
    updateLive(sat);
  }

  function updateLive(sat) {
    const S = SIM.state, c = sat.comp, P = $('#manage-panel');
    const set = (k, v) => { const el = P.querySelector(`[data-l="${k}"]`); if (el) el.innerHTML = v; };
    const st = ORB.stateAt(sat.el, S.t);
    set('status', sat.status !== 'active' ? sat.status : sat.safeMode ? '<span style="color:var(--warn)">SAFE MODE</span>' : sat.maneuver ? 'manoeuvring' : 'operating');
    set('alt', `${(st.alt / 1000).toFixed(1)} km`);
    set('pos', `${st.lat.toFixed(1)}°, ${st.lon.toFixed(1)}°`);
    set('sun', ORB.inEclipse(st.r, ORB.sunDir(S.t)) ? '🌑 eclipse' : '☀ sunlit');
    set('obs', sat.stats.obs.toLocaleString()); set('det', sat.stats.detections); set('down', DESIGN.fmtMB(sat.stats.downMB));
    set('passes', sat.stats.passes.toLocaleString()); set('sci', sat.stats.science.toLocaleString()); set('brown', sat.brownouts || 0); set('lost', DESIGN.fmtMB(sat.stats.lostMB));
    const cap = SIM.capacityWh(sat);
    set('powergauges', cap ? gauge('Battery charge', `${sat.soc.toFixed(1)} / ${cap.toFixed(1)} Wh`, sat.soc / cap, sat.soc < SIM.usableFloor(sat) ? 'fail' : 'good')
      + gauge('Battery health', `${(sat.batteryHealth * 100).toFixed(0)}%${sat.cellFailed ? ' (cell failed)' : ''}`, sat.batteryHealth, sat.batteryHealth < 0.5 ? 'warn' : '')
      : `<p class="note">Powered by the RTG: ${(c.rtgW * Math.pow(0.97, SIM.years())).toFixed(0)} W constant.</p>`);
    const mom = sat.attitude.momentum;
    set('wheels', gauge('Wheel momentum', `${(mom * 100).toFixed(0)}%${mom >= 1 ? ' SATURATED' : ''}`, mom, mom > 0.85 ? 'fail' : mom > 0.6 ? 'warn' : ''));
    set('pq', `${(c.pointing * (mom >= 1 ? 0.3 : 1) * 100).toFixed(0)}%`);
    const dv = SIM.dvLeft(sat);
    set('prop', gauge('Propellant', `${(sat.prop * 1000).toFixed(0)} g · Δv ${dv.toFixed(1)} m/s`, c.propMass ? sat.prop / c.propMass : 0, sat.prop / Math.max(1e-9, c.propMass) < 0.2 ? 'warn' : 'm'));
    const altIn = P.querySelector('#mv-alt');
    if (altIn) {
      const a2 = ORB.RE + (+altIn.value) * 1000;
      const h = ORB.hohmann(sat.el.a, a2);
      set('altplan', c.thrustChem ? `Hohmann transfer: ${h.dv1.toFixed(1)} + ${h.dv2.toFixed(1)} = ${h.total.toFixed(1)} m/s, ${(h.time / 60).toFixed(0)} min.` : c.thrustElec ? `Electric spiral: ${Math.abs(ORB.circSpeed(sat.el.a) - ORB.circSpeed(a2)).toFixed(1)} m/s, about ${(Math.abs(ORB.circSpeed(sat.el.a) - ORB.circSpeed(a2)) / (c.thrustElec / sat.mass) / 86400 / 0.6).toFixed(1)} days.` : 'No thrusters.');
    }
    const capMB = SIM.storageCap(sat);
    set('store', gauge('Storage', `${DESIGN.fmtMB(sat.usedMB)} / ${DESIGN.fmtMB(capMB)}`, sat.usedMB / capMB, sat.usedMB / capMB > 0.9 ? 'fail' : ''));
    set('contact', sat.inContact ? `<span style="color:var(--good)">yes: ${Object.keys(sat.contact).map(id => esc(GROUND_STATIONS.find(g => g.id === id).name)).join(', ')}</span>` : S.coarse ? 'fast-sim' : 'no');
    const q = sat.queue; const hi = q.filter(p => p.prio === 2).length;
    set('queue', `${q.length} (${hi} leak report${hi === 1 ? '' : 's'})`);
    if (P.querySelector('[data-l="next"]')) {
      const now = performance.now();
      if (nextContactCache.id !== sat.id || now - nextContactCache.t > 4000 || (nextContactCache.val && nextContactCache.val.t < S.t)) { nextContactCache = { id: sat.id, t: now, val: SIM.nextContact(sat, 12) }; }
      const nc = nextContactCache.val;
      set('next', nc ? `${esc(nc.gs.name)} in ${Math.max(0, Math.round((nc.t - S.t) / 60000))} min` : 'none in 12 h');
    }
    if (sat.attitude.mode === 'manual') drawAttBall(sat);
  }

  function drawAttBall(sat) {
    const cv = $('#att-ball'); if (!cv) return;
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, a = sat.attitude;
    g.clearRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-a.roll * ORB.DEG);
    const off = a.pitch * 2.5;
    g.fillStyle = '#0d2a52'; g.fillRect(-w, -h * 2 + off, w * 2, h * 2);
    g.fillStyle = '#2b5a2b'; g.fillRect(-w, off, w * 2, h * 2);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-w, off); g.lineTo(w, off); g.stroke();
    g.restore();
    g.strokeStyle = '#ffd257'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2 - 50, h / 2); g.lineTo(w / 2 - 15, h / 2); g.moveTo(w / 2 + 15, h / 2); g.lineTo(w / 2 + 50, h / 2); g.stroke();
    g.fillStyle = '#e7eefc'; g.font = '14px JetBrains Mono';
    g.fillText(`roll ${a.roll}°  pitch ${a.pitch}°  yaw ${a.yaw}°`, 10, h - 10);
    g.fillText('Earth (nadir) ↓ green', 10, 20);
  }

  function act(sat, fn, decisionTitle, before) {
    const r = fn();
    if (r && r.msg) UI.toast(r.msg, r.ok === false ? 'bad' : '', sat.name);
    if (decisionTitle && (!r || r.ok !== false)) SIM.decision('satellite', `${sat.name}: ${decisionTitle}`, before, r && r.msg ? r.msg : 'Done.');
    renderPanel(true);
  }

  function bindPanel(sat) {
    const P = $('#manage-panel');
    $('#mp-close').onclick = () => { P.hidden = true; $('#fleet-toggle').style.right = ''; selectedId = null; follow = false; Object.values(satObjs).forEach(o => { o.lastEl = null; }); };
    $$('[data-tab]', P).forEach(b => b.onclick = () => { tab = b.dataset.tab; renderPanel(true); });
    const on = (sel, fn) => { const el = P.querySelector(sel); if (el) el.onclick = fn; };
    on('[data-act="follow"]', () => { follow = !follow; if (follow) focusSat(); renderPanel(true); });
    on('[data-act="safe"]', () => act(sat, () => { sat.safeMode = !sat.safeMode; sat.manualSafe = sat.safeMode; return { ok: true, msg: sat.safeMode ? 'Safe mode: instruments off, minimum power, slow beacon only.' : 'Back to normal operations.' }; }, sat.safeMode ? 'exit safe mode' : 'enter safe mode', 'Safe mode protects the battery and electronics but stops all science.'));
    on('[data-act="recal"]', () => act(sat, () => { sat.calibDrift = false; SIM.ledger(-5000, `Recalibration ${sat.name}`); return { ok: true, msg: 'Instruments recalibrated against vicarious calibration sites.' }; }, 'recalibrate instruments', 'Recalibration restores sensitivity for a fee.'));
    on('[data-act="deorbit"]', () => {
      UI.modal(`<h2>Decommission ${esc(sat.name)}?</h2><p>The satellite will lower its orbit and burn up in the atmosphere. Responsible disposal earns public trust, but the mission ends.</p>
        <div class="modal-actions"><button class="btn ghost" id="m-no">Cancel</button><button class="btn danger" id="m-yes">Deorbit</button></div>`);
      $('#m-no').onclick = UI.closeModal;
      $('#m-yes').onclick = () => { UI.closeModal(); act(sat, () => SIM.command(sat, { type: 'deorbit' }), 'decommission', 'Deorbiting removes the satellite before it becomes debris.'); };
    });
    on('[data-act="instr"]', () => act(sat, () => { sat.instrumentOn = !sat.instrumentOn; return { ok: true, msg: sat.instrumentOn ? 'Instruments on.' : 'Instruments off: saving power.' }; }));
    on('[data-act="mode-sun"]', () => act(sat, () => { sat.attitude.mode = 'sun'; return { ok: true, msg: 'Slewing to sun-pointing.' }; }, 'sun-pointing', 'Sun-pointing charges faster but stops observations.'));
    $$('[data-mode]', P).forEach(b => b.onclick = () => act(sat, () => { sat.attitude.mode = b.dataset.mode; sat.attitude.momentum = Math.min(1.05, sat.attitude.momentum + 0.03); return { ok: true, msg: `Attitude mode: ${b.dataset.mode}.` }; },
      `attitude ${b.dataset.mode}`, { nadir: 'Nadir pointing looks straight down: steady, low wheel load.', target: 'Target pointing aims steerable instruments at a site, filling the wheels faster.', sun: 'Sun pointing maximises power but stops science.', station: 'Station pointing keeps directional antennas on the ground station.', manual: 'Manual control: you set roll, pitch and yaw yourself.' }[b.dataset.mode]));
    const tgt = P.querySelector('#att-target'); if (tgt) tgt.onchange = () => { sat.attitude.targetSite = tgt.value || null; };
    $$('[data-axis]', P).forEach(r => r.oninput = () => { const ax = r.dataset.axis; const old = sat.attitude[ax]; sat.attitude[ax] = +r.value; sat.attitude.momentum = Math.min(1.05, sat.attitude.momentum + Math.abs(+r.value - old) * 0.002); P.querySelector(`[data-ax="${ax}"]`).textContent = r.value + '°'; drawAttBall(sat); });
    $$('[data-nudge]', P).forEach(b => b.onclick = () => { const [ax, d] = b.dataset.nudge.split(':'); sat.attitude[ax] = clamp(sat.attitude[ax] + +d, -45, 45); sat.attitude.momentum = Math.min(1.05, sat.attitude.momentum + 0.01); renderPanel(true); });
    on('[data-act="desat"]', () => act(sat, () => {
      if (!sat.comp.engines.length || sat.prop <= 0.0005) return { ok: false, msg: 'No thrusters or propellant to unload the wheels; the magnetorquers will do it slowly.' };
      const g = Math.min(sat.prop, 0.002); sat.prop -= g; sat.mass -= g; sat.attitude.momentum = 0.05; return { ok: true, msg: `Wheels desaturated using ${(g * 1000).toFixed(1)} g of propellant.` };
    }));
    const sk = P.querySelector('#sk'); if (sk) sk.onchange = () => { sat.stationKeep = sk.checked; };
    const ska = P.querySelector('#sk-alt'); if (ska) ska.onchange = () => { sat.targetAlt = clamp(+ska.value, 200, 2000) * 1000; };
    on('[data-act="cancel"]', () => act(sat, () => { sat.maneuver = null; return { ok: true, msg: 'Manoeuvre cancelled.' }; }));
    on('[data-act="alt"]', () => act(sat, () => SIM.command(sat, { type: 'altitude', value: clamp(+P.querySelector('#mv-alt').value, 200, 2000) }), `change altitude to ${P.querySelector('#mv-alt').value} km`, 'Lower orbits see finer detail but suffer more drag; higher orbits last longer and see wider areas.'));
    on('[data-act="inc"]', () => act(sat, () => SIM.command(sat, { type: 'inclination', value: clamp(+P.querySelector('#mv-inc').value, 0, 180) }), `change inclination to ${P.querySelector('#mv-inc').value}°`, 'Inclination decides the highest latitude the satellite can see.'));
    $$('[data-burn]', P).forEach(b => b.onclick = () => act(sat, () => SIM.command(sat, { type: 'burn', dir: b.dataset.burn, value: Math.max(0, +P.querySelector('#mv-dv').value) }), `${b.dataset.burn} burn`, 'Prograde raises the opposite side of the orbit, retrograde lowers it, normal/antinormal tilt the plane, radial rotates the orbit.'));
    const adl = P.querySelector('#autodl'); if (adl) adl.onchange = () => { sat.autoDownlink = adl.checked; };
    on('[data-act="tx"]', () => act(sat, () => {
      if (!sat.queue.length) return { ok: true, msg: 'Nothing to send: storage is empty.' };
      sat.forceDownlink = true;
      if (sat.inContact) return { ok: true, msg: `Transmitting ${DESIGN.fmtMB(sat.usedMB)} now.` };
      const nc = SIM.nextContact(sat, 24);
      return { ok: true, msg: nc ? `Out of contact. Transmission queued for ${nc.gs.name} in ${Math.round((nc.t - SIM.state.t) / 60000)} min.` : 'No ground station in view in the next 24 h.' };
    }, 'manual transmission', 'Sending data costs ground-station time but turns observations into leak reports.'));
    on('[data-act="purge"]', () => act(sat, () => { const before = sat.queue.length; sat.queue = sat.queue.filter(p => p.prio > 0); sat.usedMB = sat.queue.reduce((s, p) => s + p.mb, 0); return { ok: true, msg: `Deleted ${before - sat.queue.length} routine images to make room.` }; }));
  }

  function show() {
    if (!inited) init();
    setTimeout(() => { resize(); renderFleet(); }, 30);
  }

  return { show, frame, select };
})();
UI.register('orbit', OrbitView);
