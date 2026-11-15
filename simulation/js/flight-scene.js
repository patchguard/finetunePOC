/* =========================================================================
   3D launch view (three.js), inspired by Kerbal Space Program.

   - Flight camera: the rocket sits at the origin and the scene is turned so
     +Y is "up" where the rocket is, so the camera orbits the rocket like
     KSP's chase camera (drag to rotate, scroll to zoom; zoom out far enough
     and you see the whole planet).
   - The ground near the pad is a curved patch textured with NASA GIBS imagery
     of the real launch region; the rest of the planet is the NASA Blue Marble
     / Black Marble globe, lit by the real Sun.
   - Sky colour, haze and stars depend on altitude and the Sun's elevation.
   - Exhaust plumes widen as the air thins; smoke stays behind in the air;
     a vapour cone forms near Mach 1; the skin glows with re-entry heat;
     spent stages and fairing halves tumble away.
   - Map view (M): the whole Earth with the flown path, the predicted orbit
     (with apoapsis / periapsis) and the target orbit, like KSP's map.
   ========================================================================= */

const FlightScene = (() => {
  let renderer, scene, camera, controls, canvas, inited = false;
  let world, earth, earthMat, atmo, capGroup, capMesh, capMat, padGroup, sky, skyMat, stars, sunLight, hemi, plumeLight;
  let rocket = null, flightRef = null, smoke, smokeData = [], smokeIdx = 0, sepObjs = [], sepSeen = 0;
  let mapScene, mapCam, mapControls, mapGroup, mapEarth, mapEarthMat, orbitLine, pathLine, targetLine, mapMarker, labelBox;
  let dayTex = null, nightTex = null;
  const capCache = {};
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const tmpQ = new THREE.Quaternion();
  let lastMs = performance.now();

  /* ---------------- shaders ---------------- */
  // ground (globe and launch-region patch): day / night with city lights, sunlight, and haze toward the horizon
  const groundVS = `#include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    void main(){ vUv = uv; vN = normalize((modelMatrix * vec4(normal,0.)).xyz); vW = (modelMatrix*vec4(position,1.)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.);
      #include <logdepthbuf_vertex>
    }`;
  const groundFS = `#include <logdepthbuf_pars_fragment>
    uniform sampler2D dayTex; uniform sampler2D nightTex; uniform vec3 sunDir; uniform vec3 hazeColor; uniform float hazeK; uniform float useNight;
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    void main(){
      #include <logdepthbuf_fragment>
      vec3 day = texture2D(dayTex, vUv).rgb; vec3 night = texture2D(nightTex, vUv).rgb * useNight;
      float d = dot(normalize(vN), normalize(sunDir));
      float k = smoothstep(-0.10, 0.12, d);
      vec3 col = mix(night * vec3(1.25,1.1,0.85) + day * 0.03, day * (0.16 + 0.95 * max(d, 0.0)), k);
      float dist = length(vW - cameraPosition);
      float haze = 1.0 - exp(-dist * hazeK);
      col = mix(col, hazeColor * (0.25 + 0.75 * k), clamp(haze, 0.0, 0.92));
      gl_FragColor = vec4(col, 1.0);
    }`;
  function groundMaterial(map) {
    const blank = new THREE.DataTexture(new Uint8Array([28, 60, 110, 255]), 1, 1); blank.needsUpdate = true;
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
    return new THREE.ShaderMaterial({
      uniforms: { dayTex: { value: map || blank }, nightTex: { value: black }, sunDir: { value: V3(1, 0, 0) }, hazeColor: { value: new THREE.Color('#9fc2ea') }, hazeK: { value: 0 }, useNight: { value: 1 } },
      vertexShader: groundVS, fragmentShader: groundFS,
    });
  }

  /* ---------------- geometry helpers ---------------- */
  // sphere in Earth-fixed coordinates (z = north pole), equirectangular UVs matching GIBS EPSG:4326 images
  function globeGeometry(radius, nLon, nLat, lat0 = -90, lat1 = 90, lon0 = -180, lon1 = 180, origin = null) {
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= nLat; i++) {
      const la = (lat0 + (lat1 - lat0) * i / nLat) * Math.PI / 180;
      for (let j = 0; j <= nLon; j++) {
        const lo = (lon0 + (lon1 - lon0) * j / nLon) * Math.PI / 180;
        const n = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
        const p = n.map(c => c * radius);
        if (origin) { p[0] -= origin[0]; p[1] -= origin[1]; p[2] -= origin[2]; }
        pos.push(...p); nor.push(...n); uv.push(j / nLon, i / nLat);
      }
    }
    for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
      const a = i * (nLon + 1) + j, b = a + nLon + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  function softDot(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }
  function noiseTexture(size, base, spread) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const img = g.createImageData(size, size);
    const [r, gg, b] = base;
    for (let i = 0; i < size * size; i++) { const n = (Math.random() - 0.5) * spread; img.data[i * 4] = r + n; img.data[i * 4 + 1] = gg + n; img.data[i * 4 + 2] = b + n; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  /* ---------------- init ---------------- */
  function init(cv) {
    canvas = cv;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    camera = new THREE.PerspectiveCamera(55, 1, 0.3, 6e7);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.1; controls.enablePan = false;
    controls.maxDistance = 4e7;

    // sky dome follows the camera; colour depends on altitude and Sun elevation
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, transparent: true,
      uniforms: { zenith: { value: new THREE.Color('#2f6fc2') }, horizon: { value: new THREE.Color('#a9cdf0') }, sunDir: { value: V3(0, 1, 0) }, alpha: { value: 1 }, glow: { value: 1 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform float alpha; uniform float glow; varying vec3 vDir;
        void main(){
          #include <logdepthbuf_fragment>
          float e = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, zenith, pow(max(e, 0.0), 0.45));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += vec3(1.0, 0.85, 0.6) * (pow(s, 64.0) * 0.9 + pow(s, 6.0) * 0.18) * glow;
          gl_FragColor = vec4(c, alpha * (e < -0.02 ? 0.95 : 1.0));
        }`,
    });
    sky = new THREE.Mesh(new THREE.SphereGeometry(3e7, 48, 24), skyMat);
    sky.renderOrder = -2; sky.frustumCulled = false;
    scene.add(sky);

    // stars (fixed in the inertial frame)
    const sg = new THREE.BufferGeometry(); const sp = [];
    for (let i = 0; i < 5000; i++) { const v = V3().randomDirection().multiplyScalar(4.5e7); sp.push(v.x, v.y, v.z); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    stars.frustumCulled = false; stars.renderOrder = -1;
    scene.add(stars);

    // lights
    sunLight = new THREE.DirectionalLight(0xfff4e0, 1.25);
    scene.add(sunLight); scene.add(sunLight.target);
    hemi = new THREE.HemisphereLight(0x9fc2ea, 0x2a3326, 0.35);
    scene.add(hemi);
    plumeLight = new THREE.PointLight(0xffa64d, 0, 600, 1.5);
    scene.add(plumeLight);

    // world group: everything fixed to Earth or inertial space, turned so local "up" at the rocket is +Y
    world = new THREE.Group();
    scene.add(world);
    earthMat = groundMaterial();
    earth = new THREE.Mesh(globeGeometry(FLIGHT.R - 250, 360, 180), earthMat);
    earth.frustumCulled = false;
    world.add(earth);
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    loader.load(NASA_GIBS.globeImage('day'), t => { t.anisotropy = 8; dayTex = t; earthMat.uniforms.dayTex.value = t; if (mapEarthMat) mapEarthMat.uniforms.dayTex.value = t; });
    loader.load(NASA_GIBS.globeImage('night'), t => { nightTex = t; earthMat.uniforms.nightTex.value = t; if (mapEarthMat) mapEarthMat.uniforms.nightTex.value = t; });
    // atmosphere limb seen from space
    atmo = new THREE.Mesh(new THREE.SphereGeometry(FLIGHT.R + 90e3, 96, 48), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { sunDir: { value: V3(1, 0, 0) } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vN; varying vec3 vW; void main(){ vN = normalize((modelMatrix*vec4(normal,0.)).xyz); vW = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
        void main(){
          #include <logdepthbuf_fragment>
          vec3 v = normalize(cameraPosition - vW);
          float rim = pow(1.0 - abs(dot(v, normalize(vN))), 4.0);
          float lit = smoothstep(-0.25, 0.3, dot(normalize(vN), normalize(sunDir)));
          gl_FragColor = vec4(vec3(0.35, 0.62, 1.0) * rim * (0.15 + 0.95 * lit), 1.0);
        }`,
    }));
    atmo.frustumCulled = false;
    world.add(atmo);

    // smoke particles (positions stored in the launch-site frame so the smoke stays behind)
    const N = 700;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(N), 1));
    g.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(N), 1));
    smoke = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: softDot(64, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)') }, tint: { value: new THREE.Color('#d9dde3') }, scale: { value: 600 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = clamp(size * scale / -mv.z, 0.0, 512.0); gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform sampler2D map; uniform vec3 tint; varying float vA;
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(tint, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
    }));
    smoke.frustumCulled = false;
    for (let i = 0; i < N; i++) smokeData.push({ life: 0, max: 1, p: V3(), v: V3(), s0: 10 });

    // ---------- map view ----------
    mapScene = new THREE.Scene();
    mapScene.background = new THREE.Color('#02040b');
    mapCam = new THREE.PerspectiveCamera(45, 1, 10, 1e6);
    mapCam.position.set(0, 9000, 22000);
    mapControls = new THREE.OrbitControls(mapCam, canvas);
    mapControls.enableDamping = true; mapControls.minDistance = 7200; mapControls.maxDistance = 250000; mapControls.enabled = false;
    mapGroup = new THREE.Group(); mapGroup.rotation.x = -Math.PI / 2; // inertial z (north) → screen up
    mapScene.add(mapGroup);
    mapEarthMat = groundMaterial();
    mapEarthMat.uniforms.hazeK.value = 0;
    mapEarth = new THREE.Mesh(globeGeometry(6371, 180, 90), mapEarthMat);
    mapGroup.add(mapEarth);
    const ms = new THREE.Points(sg.clone(), new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.4, sizeAttenuation: false }));
    ms.scale.setScalar(0.004); mapScene.add(ms);
    const mkLine = (color, dashed) => { const l = new THREE.Line(new THREE.BufferGeometry(), dashed ? new THREE.LineDashedMaterial({ color, dashSize: 180, gapSize: 140, transparent: true, opacity: 0.6 }) : new THREE.LineBasicMaterial({ color })); l.frustumCulled = false; mapGroup.add(l); return l; };
    orbitLine = mkLine(0x4cc3ff); pathLine = mkLine(0xffcf5a); targetLine = mkLine(0x7cf2c8, true);
    mapMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(64, 'rgba(255,230,120,1)', 'rgba(255,200,60,0)'), depthTest: false }));
    mapMarker.scale.set(500, 500, 1); mapGroup.add(mapMarker);

    window.addEventListener('resize', resize);
    inited = true;
  }

  /* ---------------- launch site: regional ground, pad, tower ---------------- */
  function buildSite(f) {
    if (capGroup) world.remove(capGroup);
    capGroup = new THREE.Group();
    world.add(capGroup);
    const site = f.site;
    const wLat = 7, wLon = Math.min(25, 7 / Math.cos(site.lat * Math.PI / 180));
    let lo0 = site.lon - wLon, lo1 = site.lon + wLon;
    if (lo1 > 180) { lo1 = 180; lo0 = 180 - 2 * wLon; }
    if (lo0 < -180) { lo0 = -180; lo1 = -180 + 2 * wLon; }
    const la0 = site.lat - wLat, la1 = site.lat + wLat;
    capMat = groundMaterial();
    capMat.uniforms.useNight.value = 0.6;
    capMesh = new THREE.Mesh(globeGeometry(FLIGHT.R, 220, 220, la0, la1, lo0, lo1, f.siteEcef), capMat);
    capMesh.frustumCulled = false;
    capGroup.add(capMesh);
    const key = site.id;
    const apply = t => { capMat.uniforms.dayTex.value = t; };
    if (capCache[key]) apply(capCache[key]);
    else {
      const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
      loader.load(NASA_GIBS.regionImage(la0, lo0, la1, lo1, 2048), t => { t.anisotropy = 8; capCache[key] = t; apply(t); });
    }
    if (nightTex) capMat.uniforms.nightTex.value = nightTex;

    // local frame at the pad: x = east, y = up, z = south (Earth-fixed)
    const L = FLIGHT.local(f.siteEcef);
    const south = L.north.map(c => -c);
    padGroup = new THREE.Group();
    padGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(...L.east), V3(...L.up), V3(...south)));
    capGroup.add(padGroup);
    const H = f.rk.height, D = f.rk.diameter;
    // apron with a soft edge blending into the satellite image
    const apronTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
      const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, 'rgba(120,122,118,1)'); gr.addColorStop(0.35, 'rgba(105,110,98,0.95)'); gr.addColorStop(0.7, 'rgba(84,96,72,0.55)'); gr.addColorStop(1, 'rgba(84,96,72,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
      return new THREE.CanvasTexture(c);
    })();
    const apron = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.MeshLambertMaterial({ map: apronTex, transparent: true, depthWrite: false }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = 0.4; apron.renderOrder = 1;
    padGroup.add(apron);
    const concrete = new THREE.MeshStandardMaterial({ map: noiseTexture(128, [150, 150, 146], 26), roughness: 0.95 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(25, D * 7), Math.max(28, D * 7.5), 2, 48), concrete);
    pad.position.y = -0.4; padGroup.add(pad);
    const trench = new THREE.Mesh(new THREE.BoxGeometry(D * 2.2, 1.6, Math.max(30, D * 12)), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 }));
    trench.position.set(0, 0.2, Math.max(15, D * 6)); padGroup.add(trench);
    // launch tower (lattice) with umbilical arm and warning lights
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b2d2d, roughness: 0.7, metalness: 0.3 });
    const tw = Math.max(3, D * 1.3), th = H * 1.08;
    const tower = new THREE.Group(); tower.position.set(-(D * 0.5 + tw * 0.9 + 2), 0, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, th, 0.4), steel); leg.position.set(x * tw / 2, th / 2, z * tw / 2); tower.add(leg); }
    for (let y = 2; y < th; y += Math.max(3, tw)) for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(tw * 1.4, 0.25, 0.25), steel); b.position.y = y; b.rotation.y = r; b.rotation.z = 0.6; tower.add(b); }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(tw * 0.9 + 2, 0.8, 1.2), steel); arm.position.set(tw * 0.45 + 1, th * 0.86, 0); tower.add(arm);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
    for (const y of [th, th * 0.5]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lightMat); l.position.set(0, y + 0.5, 0); tower.add(l); }
    padGroup.add(tower);
    // water tower and hangar for scale
    const wt = new THREE.Group(); wt.position.set(D * 18, 0, -D * 14);
    const wl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 30, 8), new THREE.MeshStandardMaterial({ color: 0x777777 })); wl.position.y = 15; wt.add(wl);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshStandardMaterial({ color: 0xdedede })); tank.position.y = 33; wt.add(tank);
    padGroup.add(wt);
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(H * 0.9, 18, 28), new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.8 }));
    hangar.position.set(-H * 0.9, 9, H * 1.4); padGroup.add(hangar);
    padGroup.add(smoke);
  }

  /* ---------------- rocket model ---------------- */
  function buildRocket(f) {
    if (rocket) scene.remove(rocket.group);
    const rk = f.rk, H = rk.height, D = rk.diameter, R0 = D / 2;
    const white = rk.stages[0].color === '#f2f2f2';
    const bodyColor = white ? 0xeef1f5 : 0x1c1d22;
    const mats = [];
    const mat = (color, opts = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...opts }); mats.push(m); return m; };
    const body = mat(bodyColor), dark = mat(white ? 0x1d1f24 : 0x0e0f12), metal = mat(0x8a8f99, { metalness: 0.7, roughness: 0.35 }), nozzleMat = mat(0x2b2b2e, { metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide });
    const lens = rk.stages.map((s, i) => i === 0 ? H * 0.62 : H * 0.22);
    const group = new THREE.Group();
    const stageGroups = [];
    let y = 0;
    rk.stages.forEach((st, i) => {
      const g = new THREE.Group(); g.position.y = y;
      const Ls = lens[i];
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(R0, R0, Ls, 32), body); tank.position.y = Ls / 2; g.add(tank);
      // engines: booster/first stage clusters of 9 (octaweb), upper stage one vacuum bell
      const bellL = i === 0 ? D * 0.32 : D * (white ? 0.75 : 0.45);
      const bellR = i === 0 ? D * 0.1 : D * (white ? 0.33 : 0.22);
      const positions = st.engines > 1 ? [[0, 0], ...Array.from({ length: st.engines - 1 }, (_, k) => [Math.cos(k / (st.engines - 1) * Math.PI * 2) * R0 * 0.62, Math.sin(k / (st.engines - 1) * Math.PI * 2) * R0 * 0.62])] : [[0, 0]];
      positions.forEach(([x, z]) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.35, bellR, bellL, 18, 1, true), nozzleMat); b.position.set(x, -bellL / 2, z); g.add(b); });
      if (i === 0) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 1.005, R0 * 1.005, Ls * 0.09, 32), dark); band.position.y = Ls * 0.955; g.add(band);
        if (st.reusable) {
          for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2 + Math.PI / 4;
            const leg = new THREE.Mesh(new THREE.BoxGeometry(D * 0.16, Ls * 0.2, D * 0.06), dark); leg.position.set(Math.cos(a) * R0 * 1.02, Ls * 0.1, Math.sin(a) * R0 * 1.02); leg.rotation.y = -a; g.add(leg);
            const fin = new THREE.Mesh(new THREE.BoxGeometry(D * 0.32, D * 0.05, D * 0.26), metal); fin.position.set(Math.cos(a) * (R0 + D * 0.16), Ls * 0.93, Math.sin(a) * (R0 + D * 0.16)); fin.rotation.y = -a; g.add(fin);
          }
        }
        if (!white) for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(D * 0.02, Ls * 0.95, D * 0.02), metal); const a = k * Math.PI / 3; s.position.set(Math.cos(a) * R0 * 1.01, Ls / 2, Math.sin(a) * R0 * 1.01); g.add(s); }
      }
      g.userData = { len: Ls, bellL };
      group.add(g); stageGroups.push(g);
      y += Ls;
    });
    // payload + fairing (two halves)
    const fl = H * 0.16;
    const payload = new THREE.Group(); payload.position.y = y;
    const ps = R0 * 0.75;
    const box = new THREE.Mesh(new THREE.BoxGeometry(ps, ps * 1.3, ps), mat(0xd6a83c, { metalness: 0.8, roughness: 0.3 })); box.position.y = ps * 0.75; payload.add(box);
    const panelMat = mat(0x1d3f9a, { metalness: 0.3, roughness: 0.25, emissive: 0x081633 });
    const panels = [-1, 1].map(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(ps * 0.05, ps * 1.1, ps * 0.9), panelMat); p.position.set(s * ps * 0.55, ps * 0.75, 0); payload.add(p); return p; });
    payload.userData = { panels, ps };
    group.add(payload);
    const prof = [];
    for (let k = 0; k <= 16; k++) { const t = k / 16; prof.push(new THREE.Vector2(Math.max(0.001, R0 * Math.sqrt(1 - Math.pow(Math.max(0, t - 0.25) / 0.75, 2))), t * fl)); }
    const fairing = [0, 1].map(k => { const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 24, k * Math.PI, Math.PI), body); m.position.y = y; group.add(m); return m; });
    // exhaust plume (outer glow + bright core) and a vapour cone near Mach 1
    const plumeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { c0: { value: new THREE.Color('#fff2c4') }, c1: { value: new THREE.Color('#ff7a2a') }, inten: { value: 1 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        varying float vT; varying vec3 vNv; varying vec3 vV; void main(){ vT = uv.y; vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); vNv = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform vec3 c0; uniform vec3 c1; uniform float inten; varying float vT; varying vec3 vNv; varying vec3 vV;
        void main(){
          #include <logdepthbuf_fragment>
          float edge = pow(abs(dot(vNv, vV)), 1.2); vec3 c = mix(c1, c0, pow(vT, 2.2)); gl_FragColor = vec4(c, pow(vT, 1.4) * edge * inten); }`,
    });
    const plume = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 28, 1, true), plumeMat);
    const core = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 18, 1, true), plumeMat.clone());
    core.material.uniforms.c1.value = new THREE.Color('#ffd27a');
    group.add(plume); group.add(core);
    const vapor = new THREE.Mesh(new THREE.ConeGeometry(R0 * 4.5, H * 0.12, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    group.add(vapor);
    const heatGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(128, 'rgba(255,160,80,1)', 'rgba(255,60,20,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    heatGlow.scale.set(D * 6, D * 6, 1); group.add(heatGlow);
    scene.add(group);
    rocket = { group, stageGroups, payload, fairing, plume, core, vapor, heatGlow, mats, lens, H, D, fl, shownStage: 0 };
  }

  /* ---------------- separated pieces ---------------- */
  function spawnSeparations(f) {
    while (sepSeen < f.separations.length) {
      const s = f.separations[sepSeen++];
      const objs = [];
      if (s.kind === 'stage' && rocket.stageGroups[s.idx]) {
        const g = rocket.stageGroups[s.idx].clone(); g.position.set(0, 0, 0);
        const holder = new THREE.Group(); holder.add(g); objs.push({ obj: holder, push: -2.5, side: [0, 0, 0] });
      }
      if (s.kind === 'fairing') rocket.fairing.forEach((m, k) => { const g = m.clone(); g.position.set(0, 0, 0); const holder = new THREE.Group(); holder.add(g); objs.push({ obj: holder, push: 0.3, side: [k ? 4 : -4, 0, 0], offset: rocket.fairingY }); });
      if (s.kind === 'payload') { const g = rocket.payload.clone(); g.position.set(0, 0, 0); g.userData.panels = g.children.filter(c => c.geometry && c.geometry.parameters && c.geometry.parameters.width < rocket.payload.userData.ps * 0.1); const holder = new THREE.Group(); holder.add(g); objs.push({ obj: holder, push: 0.6, side: [0, 0, 0], payload: g, offset: rocket.payloadY }); }
      objs.forEach(o => {
        world.add(o.obj);
        const att = s.att;
        // separation impulse: along the body axis plus sideways for fairing halves
        const L = FLIGHT.local(s.r);
        const sideDir = FLIGHT.vec.norm(FLIGHT.vec.cross(att, L.up.map((c, i) => c + (i === 0 ? 0.01 : 0))));
        const v = FLIGHT.vec.add(FLIGHT.vec.add(s.v, FLIGHT.vec.mul(att, o.push)), FLIGHT.vec.mul(sideDir, o.side[0]));
        const r = FLIGHT.vec.add(s.r, FLIGHT.vec.mul(att, o.offset || 0));
        sepObjs.push({ obj: o.obj, r, v, tSim: s.t, att: att.slice(), spin: V3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4), t: 0, payload: o.payload, rot: new THREE.Quaternion() });
      });
    }
  }
  // pieces follow the flight clock (so they stay correct under time warp and fast-forward)
  function updateSeparations(f) {
    const V = FLIGHT.vec;
    for (let i = sepObjs.length - 1; i >= 0; i--) {
      const s = sepObjs[i];
      let left = f.t - s.tSim;
      while (left > 1e-6) { const dt = Math.min(left, 0.5); stepPiece(s, dt); left -= dt; s.tSim += dt; s.t += dt; }
      const r = V.len(s.r), h = r - FLIGHT.R;
      const rel = V.sub(s.r, f.r);
      s.obj.position.set(rel[0], rel[1], rel[2]);
      s.rot.setFromEuler(new THREE.Euler(s.spin.x * s.t, s.spin.y * s.t, s.spin.z * s.t));
      s.obj.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(...s.att)).multiply(s.rot);
      if (s.payload && s.payload.userData.panels) s.payload.userData.panels.forEach((p, k) => { const open = Math.min(1, s.t / 6); p.scale.set(1, 1, 1 + open * 2.8); });
      if (s.t > 240 || V.len(rel) > 3e5 || h < -50) { world.remove(s.obj); sepObjs.splice(i, 1); }
    }
  }

  function stepPiece(s, dt) {
    const V = FLIGHT.vec;
    const r = V.len(s.r); const gacc = V.mul(s.r, -FLIGHT.MU / r ** 3);
    // drag slows pieces in the atmosphere (they fall behind)
    const h = r - FLIGHT.R; const rho = h < 120e3 ? FLIGHT.atmosphere(h).rho : 0;
    const vs = V.sub(s.v, [-FLIGHT.OMEGA * s.r[1], FLIGHT.OMEGA * s.r[0], 0]);
    const vsl = V.len(vs);
    const drag = vsl > 1 ? V.mul(vs, -0.5 * rho * vsl * 0.004) : [0, 0, 0];
    s.v = V.add(s.v, V.mul(V.add(gacc, drag), dt));
    s.r = V.add(s.r, V.mul(s.v, dt));
  }

  /* ---------------- smoke ---------------- */
  function updateSmoke(f, dt, h, nozzleScene) {
    const pos = smoke.geometry.attributes.position, size = smoke.geometry.attributes.size, alpha = smoke.geometry.attributes.alpha;
    // spawn at the nozzle while low and thrusting
    if (f.thrustOn && h < 9000 && dt > 0) {
      const n = Math.min(12, Math.ceil(dt * (h < 300 ? 70 : 35)));
      const local = padGroup.worldToLocal(nozzleScene.clone());
      for (let k = 0; k < n; k++) {
        const p = smokeData[smokeIdx = (smokeIdx + 1) % smokeData.length];
        p.life = 0; p.max = 18 + Math.random() * 14;
        p.p.copy(local).add(V3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4));
        const ground = h < 60;
        p.v.set((Math.random() - 0.5) * (ground ? 40 : 6), ground ? Math.random() * 6 : -Math.random() * 6, (Math.random() - 0.5) * (ground ? 40 : 6));
        p.s0 = rocket.D * (ground ? 4 : 2.2);
      }
    }
    smokeData.forEach((p, i) => {
      if (p.life >= p.max) { alpha.array[i] = 0; return; }
      p.life += dt;
      p.p.addScaledVector(p.v, dt); p.v.multiplyScalar(Math.exp(-dt / 6)); p.p.x += dt * 2; p.p.y += dt * 0.6;
      if (p.p.y < 1) p.p.y = 1;
      pos.array[i * 3] = p.p.x; pos.array[i * 3 + 1] = p.p.y; pos.array[i * 3 + 2] = p.p.z;
      size.array[i] = p.s0 * (1 + p.life * 0.45);
      alpha.array[i] = 0.55 * (1 - p.life / p.max);
    });
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
  }

  /* ---------------- per-frame ---------------- */
  function start(f) {
    if (!inited) return;
    flightRef = f;
    sepObjs.forEach(s => world.remove(s.obj)); sepObjs = []; sepSeen = 0;
    smokeData.forEach(p => { p.life = p.max; });
    buildSite(f); buildRocket(f);
    const H = f.rk.height;
    camera.position.set(H * 1.4, H * 0.35, H * 1.7);
    controls.target.set(0, H * 0.5, 0);
    controls.minDistance = H * 0.45;
    controls.update();
  }
  function resize() {
    if (!renderer || !canvas) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    mapCam.aspect = w / h; mapCam.updateProjectionMatrix();
  }

  function render(f, { mapMode = false, labels = null } = {}) {
    if (!inited) return;
    if (f !== flightRef) start(f);
    const now = performance.now(); const realDt = Math.min(0.1, (now - lastMs) / 1000); lastMs = now;
    if (canvas.width !== Math.round(canvas.clientWidth * renderer.getPixelRatio())) resize();
    const V = FLIGHT.vec;
    const worldMs = f.launchMs + f.t * 1000;
    const th = FLIGHT.theta(f);
    const sunEci = ORB.sunDir(worldMs);
    const h = FLIGHT.alt(f);
    controls.enabled = !mapMode; mapControls.enabled = mapMode;
    if (labels) labels.hidden = !mapMode;
    if (mapMode) return renderMap(f, sunEci, th, labels);

    // scene frame: x = east, y = up, z = south at the rocket
    const L = FLIGHT.local(f.r);
    const south = L.north.map(c => -c);
    const Mrot = new THREE.Matrix4().makeBasis(V3(...L.east), V3(...L.up), V3(...south)).transpose();
    world.quaternion.setFromRotationMatrix(Mrot);
    const toScene = a => V3(...a).applyMatrix4(Mrot);
    earth.position.set(-f.r[0], -f.r[1], -f.r[2]); earth.rotation.set(0, 0, th);
    atmo.position.copy(earth.position);
    const siteEci = FLIGHT.ecefToEci(f.siteEcef, th);
    capGroup.position.set(siteEci[0] - f.r[0], siteEci[1] - f.r[1], siteEci[2] - f.r[2]); capGroup.rotation.set(0, 0, th);
    stars.quaternion.copy(world.quaternion);

    // light, sky and haze
    const sunScene = toScene(sunEci).normalize();
    sunLight.position.copy(sunScene).multiplyScalar(1000); sunLight.target.position.set(0, 0, 0);
    const sunUp = V.dot(sunEci, L.up);
    const day = THREE.MathUtils.smoothstep(sunUp, -0.12, 0.08);
    const space = Math.pow(THREE.MathUtils.clamp(h / 70000, 0, 1), 0.7);
    const lit = f.sunlit ? 1 : 0;
    sunLight.intensity = 1.35 * Math.max(day, space * lit);
    hemi.intensity = 0.12 + 0.35 * day * (1 - space);
    const zen = new THREE.Color('#2f6fc2').lerp(new THREE.Color('#020611'), 1 - day).lerp(new THREE.Color('#000000'), space);
    const hor = new THREE.Color('#a9cdf0').lerp(new THREE.Color('#0d1730'), 1 - day).lerp(new THREE.Color('#0a1a3a'), space * 0.6);
    if (day > 0.05 && day < 0.6) hor.lerp(new THREE.Color('#f0a060'), 0.35 * (1 - Math.abs(day - 0.3) / 0.3));
    skyMat.uniforms.zenith.value.copy(zen); skyMat.uniforms.horizon.value.copy(hor);
    skyMat.uniforms.sunDir.value.copy(sunScene); skyMat.uniforms.alpha.value = 1 - space * 0.97; skyMat.uniforms.glow.value = day * (1 - space);
    sky.position.copy(camera.position);
    stars.material.opacity = THREE.MathUtils.clamp(1 - day * (1 - space) * 1.6, 0, 0.95);
    const hazeK = 1 / 22000 * Math.exp(-h / 9000);
    [earthMat, capMat].forEach(m => { m.uniforms.sunDir.value.copy(sunScene); m.uniforms.hazeColor.value.copy(hor); m.uniforms.hazeK.value = hazeK; });
    atmo.material.uniforms.sunDir.value.copy(sunScene);
    atmo.visible = h > 25e3;

    // rocket attitude, stages, fairing, payload
    const att = toScene(f.att).normalize();
    const R = rocket;
    R.group.quaternion.setFromUnitVectors(V3(0, 1, 0), att);
    let base = 0; for (let i = 0; i < f.stageIdx; i++) base += R.lens[i];
    R.stageGroups.forEach((g, i) => { g.visible = i >= f.stageIdx; });
    R.group.position.copy(att.clone().multiplyScalar(-base));
    R.fairingY = (base + R.lens.slice(f.stageIdx).reduce((a, b) => a + b, 0)) - base; // fairing / payload base above the current bottom
    R.payloadY = R.fairingY;
    R.fairing.forEach(m => { m.visible = !!f.fairing; });
    R.payload.visible = !f.deployed;
    if (f.deployed && !f._payloadSep) { f._payloadSep = true; f.separations.push({ kind: 'payload', t: f.t, r: f.r.slice(), v: f.v.slice(), att: f.att.slice() }); }
    spawnSeparations(f);
    updateSeparations(f);
    const stackLen = R.lens.slice(f.stageIdx).reduce((a, b) => a + b, 0) + R.fl;
    controls.target.copy(att.clone().multiplyScalar(stackLen * 0.5));
    controls.minDistance = stackLen * 0.6;

    // plume: longer with throttle, wider as the outside pressure drops (under-expanded exhaust in vacuum)
    const st = f.stages[f.stageIdx];
    const on = f.thrustOn && st;
    const vac = 1 - Math.min(1, f.air.p / 101325);
    const sg = R.stageGroups[f.stageIdx];
    const bellL = sg ? sg.userData.bellL : 1;
    const nozzleY = base - base - bellL; // relative to the current bottom
    [R.plume, R.core].forEach((p, k) => {
      p.visible = !!on;
      if (!on) return;
      const flick = 0.92 + Math.random() * 0.12;
      const lenP = R.D * (k ? 1.6 : 3) * (0.6 + f.throttle) * (1 + 2.2 * vac) * flick;
      const wid = R.D * (k ? 0.22 : 0.42) * (1 + (k ? 1.5 : 4.5) * vac);
      p.scale.set(wid, lenP, wid);
      p.position.set(0, base + nozzleY - lenP / 2, 0);
      p.rotation.set(0, 0, 0);
      p.material.uniforms.inten.value = (k ? 1.2 : 0.9) * (0.5 + 0.5 * f.throttle);
    });
    // plume light (lights the pad and smoke, especially at night)
    const nozzleScene = att.clone().multiplyScalar(nozzleY - R.D);
    plumeLight.position.copy(nozzleScene);
    plumeLight.intensity = on ? 3.5 * f.throttle * (1 - space) : 0;
    plumeLight.distance = R.H * 12;
    // vapour cone around Mach 1 in humid low air
    const vc = Math.max(0, 1 - Math.abs(f.mach - 1.02) / 0.12) * (h < 16000 ? 1 : 0);
    R.vapor.material.opacity = vc * 0.35; R.vapor.visible = vc > 0.01;
    R.vapor.position.set(0, base + R.lens[f.stageIdx] * 0.55 + stackLen * 0.15, 0);
    // re-entry / ascent heating: glow on the windward side, skin turns red-hot
    const heat = THREE.MathUtils.clamp((f.skinT - 420) / 500, 0, 1);
    const flux = THREE.MathUtils.clamp(Math.log10(Math.max(1, f.heatFlux)) / 5.5 - 0.55, 0, 1);
    R.heatGlow.visible = flux > 0.02 || heat > 0.05;
    const air = FLIGHT.airVel(f);
    if (R.heatGlow.visible && V.len(air) > 1) {
      const front = toScene(air).normalize().multiplyScalar(-1);
      R.heatGlow.position.copy(front.multiplyScalar(stackLen * 0.35)).add(att.clone().multiplyScalar(stackLen * 0.5)).sub(R.group.position);
      R.heatGlow.position.applyQuaternion(R.group.quaternion.clone().invert());
      const s = R.D * (3 + 14 * Math.max(flux, heat));
      R.heatGlow.scale.set(s, s, 1); R.heatGlow.material.opacity = Math.max(flux, heat);
    }
    R.mats.forEach(m => { if (m.emissive && m !== undefined) { m.emissive.setRGB(heat * 0.9, heat * 0.25, heat * 0.05); } });

    scene.updateMatrixWorld();
    updateSmoke(f, f.ended ? 0 : realDt, h, nozzleScene);
    smoke.material.uniforms.tint.value.setRGB(0.25 + 0.6 * day, 0.25 + 0.6 * day, 0.27 + 0.6 * day);
    smoke.material.uniforms.scale.value = canvas.clientHeight / Math.tan(camera.fov * Math.PI / 360) * 0.5;

    controls.update();
    renderer.render(scene, camera);
  }

  /* ---------------- map view ---------------- */
  function renderMap(f, sunEci, th, labels) {
    const V = FLIGHT.vec, K = 1 / 1000;
    mapEarth.rotation.set(0, 0, th);
    const sunMap = V3(...sunEci).applyAxisAngle(V3(1, 0, 0), -Math.PI / 2);
    mapEarthMat.uniforms.sunDir.value.copy(sunMap);
    const o = FLIGHT.orbit(f);
    // predicted conic from the current state (until it hits the ground)
    const pts = [];
    if (!o.escape) {
      const e = o.e, p = o.p;
      const hv = V.norm(o.hv);
      const P = e > 1e-6 ? V.norm(o.ev) : V.norm(f.r);
      const Q = V.cross(hv, P);
      const nu0 = e > 1e-6 ? Math.atan2(V.dot(f.r, Q), V.dot(f.r, P)) : 0;
      for (let k = 0; k <= 360; k++) {
        const nu = nu0 + k * Math.PI / 180;
        const rr = p / (1 + e * Math.cos(nu));
        if (rr < FLIGHT.R && k > 2) { pts.push(V3(...V.add(V.mul(P, rr * Math.cos(nu) * K), V.mul(Q, rr * Math.sin(nu) * K)))); break; }
        pts.push(V3(...V.add(V.mul(P, rr * Math.cos(nu) * K), V.mul(Q, rr * Math.sin(nu) * K))));
      }
    }
    orbitLine.geometry.dispose(); orbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    pathLine.geometry.dispose(); pathLine.geometry = new THREE.BufferGeometry().setFromPoints([...f.path, f.r].map(r => V3(r[0] * K, r[1] * K, r[2] * K)));
    // target orbit: circle in the target plane
    const n = f.planeN, a1 = V.norm(V.cross(n, [0, 0, 1])), a2 = V.cross(n, a1), rt = (FLIGHT.R + f.ap.target) * K;
    const tp = []; for (let k = 0; k <= 180; k++) { const a = k / 180 * Math.PI * 2; tp.push(V3(...V.add(V.mul(a1, rt * Math.cos(a)), V.mul(a2, rt * Math.sin(a))))); }
    targetLine.geometry.dispose(); targetLine.geometry = new THREE.BufferGeometry().setFromPoints(tp); targetLine.computeLineDistances();
    mapMarker.position.set(f.r[0] * K, f.r[1] * K, f.r[2] * K);
    mapControls.update();
    renderer.render(mapScene, mapCam);
    // HTML labels for apoapsis / periapsis / the rocket
    if (labels) {
      const items = [];
      const proj = (v3, text, cls) => { const w = v3.clone(); mapGroup.localToWorld(w); w.project(mapCam); if (w.z < 1) items.push(`<div class="map-label ${cls}" style="left:${(w.x * 0.5 + 0.5) * 100}%;top:${(-w.y * 0.5 + 0.5) * 100}%">${text}</div>`); };
      proj(mapMarker.position, 'You', 'me');
      if (!o.escape) {
        const P = o.e > 1e-6 ? V.norm(o.ev) : V.norm(f.r);
        const ra = o.a * (1 + o.e), rp = o.a * (1 - o.e);
        proj(V3(...V.mul(P, -ra * K)), `Ap ${(o.ap / 1000).toFixed(0)} km`, 'ap');
        if (rp > FLIGHT.R) proj(V3(...V.mul(P, rp * K)), `Pe ${(o.pe / 1000).toFixed(0)} km`, 'pe');
      }
      labels.innerHTML = items.join('') + `<div class="map-legend">Map view (M): <b style="color:#ffcf5a">flown path</b> · <b style="color:#4cc3ff">predicted orbit</b> · <b style="color:#7cf2c8">target orbit</b> · drag to rotate, scroll to zoom</div>`;
    }
  }

  return { init, start, render, resize, get ready() { return inited; } };
})();
