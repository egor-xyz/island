import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/* ==========================================================================
   Constants & state
   ========================================================================== */

const HALF = 5; // block half-size (block is 10 x 10)
const GROUND_H = 2.6; // sand strata height (y from -2.6 to 0)
const BASE_LEVEL = 1.1; // resting water level
const ISLAND = new THREE.Vector2(-2.6, -2.6);
const ISLAND_R = 2.45;
const ISLAND_PEAK = 1.9;
const DECK_Y = 1.52;
const JETTY_Y = 1.44;
const MAX_RINGS = 10;

const FLAVOURS = {
  turquoise: { color: "#7ff7ee", atten: "#12c2c4", caustic: "#e6fffb" },
  sapphire: { color: "#7fb0ff", atten: "#1a5cf0", caustic: "#e3eeff" },
  lime: { color: "#c4fa6e", atten: "#62d016", caustic: "#f4ffe0" },
};

const params = { firmness: 50, damping: 30, tide: 0, paused: false, flavour: "turquoise" };
const counters = { landings: 0, fed: 0 };
let level = BASE_LEVEL;
let simTime = 0;

const rand = mulberry32(7);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ==========================================================================
   Renderer, scene, camera, lights
   ========================================================================== */

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xece9e4, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 300);
const DEFAULT_CAM = new THREE.Vector3(21.5, 16.5, 23.5);
const DEFAULT_TARGET = new THREE.Vector3(0, -0.2, 0);
camera.position.copy(DEFAULT_CAM);
fitCameraToAspect();

const hemi = new THREE.HemisphereLight(0xfffaf2, 0xcdbfa8, 1.15);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
sun.position.set(-11, 19, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -15;
sun.shadow.camera.right = 15;
sun.shadow.camera.top = 15;
sun.shadow.camera.bottom = -15;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);

const fill = new THREE.DirectionalLight(0xdfeaff, 0.45);
fill.position.set(12, 6, 10);
scene.add(fill);

/* ==========================================================================
   Procedural textures
   ========================================================================== */

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

function canvasTexture(c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function strataTexture(phase) {
  const W = 1024;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const r = mulberry32(31 + phase * 13);
  const wave = (x, a, f, p) => a * Math.sin((x / W) * Math.PI * 2 * f + p);

  // cream sand
  const cream = g.createLinearGradient(0, 0, 0, H * 0.6);
  cream.addColorStop(0, "#f7f3ea");
  cream.addColorStop(1, "#efe8da");
  g.fillStyle = cream;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${150 + r() * 60},${130 + r() * 50},${100 + r() * 40},${0.05 + r() * 0.08})`;
    g.fillRect(r() * W, r() * H * 0.6, 1 + r() * 2, 1 + r() * 2);
  }

  const band = (yTop, yBot, fill) => {
    g.beginPath();
    g.moveTo(0, yTop(0));
    for (let x = 0; x <= W; x += 8) g.lineTo(x, yTop(x));
    for (let x = W; x >= 0; x -= 8) g.lineTo(x, yBot(x));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };

  const f1 = (x) => H * 0.54 + wave(x, 9, 2, phase) + wave(x, 4, 5, phase * 2.1);
  const f2 = (x) => H * 0.72 + wave(x, 7, 2, phase + 1.4) + wave(x, 3, 7, phase);
  const f3 = (x) => H * 0.775 + wave(x, 6, 3, phase + 0.3);

  // blue seep line (water glow along the sand)
  g.lineWidth = 3;
  g.strokeStyle = "rgba(120,170,235,0.55)";
  g.beginPath();
  for (let x = 0; x <= W; x += 8) g.lineTo(x, f1(x) - 6);
  g.stroke();

  const beige = g.createLinearGradient(0, H * 0.5, 0, H * 0.76);
  beige.addColorStop(0, "#e2cfae");
  beige.addColorStop(1, "#d3bb93");
  band(f1, f2, beige);
  band(f2, f3, "#efe4cf");

  const brown = g.createLinearGradient(0, H * 0.76, 0, H);
  brown.addColorStop(0, "#9a8170");
  brown.addColorStop(1, "#7c6656");
  band(f3, () => H + 2, brown);

  // speckles in the brown layer
  for (let i = 0; i < 520; i++) {
    const x = r() * W;
    const y = f3(x) + 6 + r() * (H - f3(x) - 10);
    const s = 1 + r() * 2.6;
    g.fillStyle = `rgba(255,250,240,${0.45 + r() * 0.45})`;
    g.beginPath();
    g.ellipse(x, y, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // dark grain in beige
  for (let i = 0; i < 900; i++) {
    const x = r() * W;
    const y = f1(x) + r() * (f2(x) - f1(x));
    g.fillStyle = `rgba(120,95,60,${0.08 + r() * 0.12})`;
    g.fillRect(x, y, 1.5, 1.5);
  }
  g.fillStyle = "rgba(60,45,35,0.35)";
  g.fillRect(0, H - 3, W, 3);
  return canvasTexture(c);
}

function sandTexture() {
  const [c, g] = makeCanvas(512, 512);
  const r = mulberry32(5);
  g.fillStyle = "#eadfc7";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 40; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 30 + r() * 80;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() > 0.5;
    grd.addColorStop(0, dark ? "rgba(190,165,120,0.18)" : "rgba(255,250,235,0.25)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${120 + r() * 80},${100 + r() * 60},${70 + r() * 40},${0.08 + r() * 0.12})`;
    g.fillRect(r() * 512, r() * 512, 1.3, 1.3);
  }
  return canvasTexture(c);
}

function frondTexture(hue) {
  const W = 256;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const r = mulberry32(11 + hue);
  g.clearRect(0, 0, W, H);
  const cx = W / 2;
  const n = 34;
  for (let k = 0; k < n; k++) {
    const s = 0.1 + (k / n) * 0.9;
    const y = H - s * H;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, (s - 0.06) / 0.96)), 0.5);
    const len = (W / 2 - 4) * env;
    const base = 9 * (1 - s * 0.5) + 2;
    for (const side of [-1, 1]) {
      const tipX = cx + side * len;
      const tipY = y - 34 * env - 6;
      const midX = cx + side * len * 0.5;
      const midY = y - 10 * env;
      g.fillStyle = `hsl(${hue + r() * 16}, ${50 + r() * 16}%, ${28 + r() * 14}%)`;
      g.beginPath();
      g.moveTo(cx, y - base * 0.5);
      g.quadraticCurveTo(midX, midY - base * 0.9, tipX, tipY);
      g.quadraticCurveTo(midX, midY + base * 0.6, cx, y + base * 0.5);
      g.closePath();
      g.fill();
    }
  }
  g.strokeStyle = "#7c8a3a";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx, H);
  g.lineTo(cx, 8);
  g.stroke();
  return canvasTexture(c);
}

function thatchTexture() {
  const [c, g] = makeCanvas(256, 128);
  const r = mulberry32(3);
  g.fillStyle = "#cfa86b";
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 700; i++) {
    const x = r() * 256;
    g.strokeStyle = `rgba(${r() > 0.5 ? "120,85,40" : "245,220,160"},${0.15 + r() * 0.3})`;
    g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (r() - 0.5) * 6, 128);
    g.stroke();
  }
  for (let y = 26; y < 128; y += 26) {
    g.fillStyle = "rgba(110,75,35,0.25)";
    g.fillRect(0, y, 256, 2);
  }
  return canvasTexture(c);
}

function ringTexture() {
  const [c, g] = makeCanvas(256, 16);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 === 0 ? "#e94a3c" : "#fbf6ee";
    g.fillRect(i * 32, 0, 32, 16);
  }
  return canvasTexture(c);
}

function rayTexture() {
  const [c, g] = makeCanvas(128, 128);
  const r = mulberry32(17);
  g.fillStyle = "#2d3946";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(235,240,245,${0.6 + r() * 0.4})`;
    g.beginPath();
    g.arc(r() * 128, r() * 128, 1 + r() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  return canvasTexture(c);
}

function blobShadowTexture() {
  const [c, g] = makeCanvas(256, 256);
  g.filter = "blur(22px)";
  g.fillStyle = "rgba(70,55,40,1)";
  g.beginPath();
  g.roundRect(58, 58, 140, 140, 16);
  g.fill();
  return canvasTexture(c);
}

/* ==========================================================================
   Caustics shader chunk (shared by floor + water)
   ========================================================================== */

const CAUSTIC_GLSL = /* glsl */ `
float causticPattern(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

const sharedUniforms = {
  uTime: { value: 0 },
  uLevel: { value: BASE_LEVEL },
  uCausticColor: { value: new THREE.Color(FLAVOURS.turquoise.caustic) },
};

function addCaustics(material, { strength, scale, belowWater, key }) {
  const uStrength = { value: strength };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uLevel = sharedUniforms.uLevel;
    shader.uniforms.uCausticColor = sharedUniforms.uCausticColor;
    shader.uniforms.uCStrength = uStrength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCWorld;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vCWorld;
uniform float uTime;
uniform float uLevel;
uniform vec3 uCausticColor;
uniform float uCStrength;
${CAUSTIC_GLSL}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  float cMask = ${belowWater ? "smoothstep(0.0, 0.12, uLevel - vCWorld.y)" : "smoothstep(uLevel - 0.25, uLevel - 0.05, vCWorld.y)"};
  float cVal = causticPattern(vCWorld.xz * ${scale.toFixed(3)} + vec2(0.0, vCWorld.y * 0.15), uTime * 0.55);
  totalEmissiveRadiance += uCausticColor * cVal * uCStrength * cMask;
}`,
      );
  };
  material.customProgramCacheKey = () => `caustic-${key}`;
  return uStrength;
}

/* ==========================================================================
   Diorama root (tips as a whole)
   ========================================================================== */

const tiltGroup = new THREE.Group();
scene.add(tiltGroup);

// soft ground shadow
const shadowY = -GROUND_H - 1.35;
const catcher = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.ShadowMaterial({ color: 0x4a3a28, opacity: 0.07 }),
);
catcher.rotation.x = -Math.PI / 2;
catcher.position.y = shadowY;
catcher.receiveShadow = true;
scene.add(catcher);

const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.MeshBasicMaterial({
    map: blobShadowTexture(),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    toneMapped: false,
  }),
);
blob.rotation.x = -Math.PI / 2;
blob.position.set(2.6, shadowY + 0.01, -0.6);
scene.add(blob);

/* ---------- ground block with strata ---------- */

const sideMats = [0, 1, 2, 3].map(
  (i) => new THREE.MeshStandardMaterial({ map: strataTexture(i), roughness: 0.92 }),
);
const sandTopMat = new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 0.95 });
addCaustics(sandTopMat, { strength: 0.85, scale: 0.32, belowWater: true, key: "floor" });
const bottomMat = new THREE.MeshStandardMaterial({ color: 0x6f5a4b, roughness: 1 });
const ground = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, GROUND_H, HALF * 2), [
  sideMats[0],
  sideMats[1],
  sandTopMat,
  bottomMat,
  sideMats[2],
  sideMats[3],
]);
ground.position.y = -GROUND_H / 2;
ground.receiveShadow = true;
ground.castShadow = true;
tiltGroup.add(ground);

/* ---------- island ---------- */

function islandRadius(theta) {
  return ISLAND_R * (1 + 0.07 * Math.sin(3 * theta + 0.5) + 0.04 * Math.sin(7 * theta + 1.3));
}

function islandProfile(rr) {
  return ISLAND_PEAK * Math.pow(smoothstep(1, 0.22, rr), 0.55);
}

function islandHeight(x, z) {
  const dx = x - ISLAND.x;
  const dz = z - ISLAND.y;
  const d = Math.hypot(dx, dz);
  const R = islandRadius(Math.atan2(dz, dx));
  return islandProfile(d / R);
}

function islandWaterRadius() {
  // approximate radius where the mound meets the current water line
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (islandProfile(m) > level) lo = m;
    else hi = m;
  }
  return lo * ISLAND_R;
}

const island = (() => {
  const rings = 30;
  const segs = 72;
  const pos = [];
  const col = [];
  const idx = [];
  const dry = new THREE.Color("#eedfbf");
  const wet = new THREE.Color("#d6c29c");
  const grass = new THREE.Color("#a9b874");
  const tmp = new THREE.Color();
  const push = (x, z, rr) => {
    const cx = clamp(x, -HALF + 0.005, HALF - 0.005);
    const cz = clamp(z, -HALF + 0.005, HALF - 0.005);
    const y = islandProfile(rr) - 0.01;
    pos.push(cx, y, cz);
    tmp.copy(wet).lerp(dry, smoothstep(BASE_LEVEL - 0.25, BASE_LEVEL + 0.08, y));
    if (rr < 0.38) tmp.lerp(grass, smoothstep(0.38, 0.15, rr) * 0.55);
    col.push(tmp.r, tmp.g, tmp.b);
  };
  push(ISLAND.x, ISLAND.y, 0);
  for (let q = 1; q <= rings; q++) {
    const rr = q / rings;
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const R = islandRadius(th) * rr;
      push(ISLAND.x + Math.cos(th) * R, ISLAND.y + Math.sin(th) * R, rr);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let q = 1; q < rings; q++) {
    const a0 = 1 + (q - 1) * segs;
    const b0 = 1 + q * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  tiltGroup.add(mesh);
  return mesh;
})();

// bushes & rocks on the island
(() => {
  const bushGeo = new THREE.IcosahedronGeometry(0.3, 1);
  const greens = ["#4f7a2e", "#5d8a35", "#3f6a28", "#6b9440"];
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    const d = 0.3 + rand() * 0.95;
    const x = ISLAND.x + Math.cos(a) * d;
    const z = ISLAND.y + Math.sin(a) * d;
    const m = new THREE.Mesh(
      bushGeo,
      new THREE.MeshStandardMaterial({ color: greens[i % 4], roughness: 0.9, flatShading: true }),
    );
    const s = 0.6 + rand() * 0.7;
    m.scale.set(s, s * 0.62, s);
    m.position.set(x, islandHeight(x, z) + 0.05, z);
    m.rotation.y = rand() * 3;
    m.castShadow = true;
    m.receiveShadow = true;
    tiltGroup.add(m);
  }
  const rockGeo = new THREE.DodecahedronGeometry(0.14, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#a39a8c", roughness: 0.9, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const d = 1.4 + rand() * 0.4;
    const x = ISLAND.x + Math.cos(a) * d;
    const z = ISLAND.y + Math.sin(a) * d;
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.position.set(x, islandHeight(x, z), z);
    m.scale.setScalar(0.7 + rand());
    m.castShadow = true;
    tiltGroup.add(m);
  }
})();

/* ==========================================================================
   Palms
   ========================================================================== */

const frondTextures = [frondTexture(88), frondTexture(100), frondTexture(110)];
const frondMats = frondTextures.map(
  (map) =>
    new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.75,
    }),
);
const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
const coconutMat = new THREE.MeshStandardMaterial({ color: "#6b4a2b", roughness: 0.7 });
const hitMat = new THREE.MeshBasicMaterial();

function makeFrondGeometry(L, lift, droop) {
  const n = 14;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let r = 0; r <= n; r++) {
    const s = r / n;
    const X = s * L;
    const Y = s * L * lift - droop * (s * L) * (s * L);
    const w = 0.34 * L * (s < 0.12 ? s / 0.12 : 1);
    pos.push(X, Y - w * 0.38, -w, X, Y, 0, X, Y - w * 0.38, w);
    uv.push(0, s, 0.5, s, 1, s);
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c;
      const b = a + 1;
      const cc = a + 3;
      const d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const frondGeos = [
  makeFrondGeometry(1.25, 0.55, 0.55),
  makeFrondGeometry(1.4, 0.45, 0.5),
  makeFrondGeometry(1.1, 0.7, 0.75),
  makeFrondGeometry(1.5, 0.35, 0.42),
];

function makeTrunkGeometry(curve, H) {
  const segs = 18;
  const rad = 9;
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [];
  const col = [];
  const idx = [];
  const light = new THREE.Color("#a58561");
  const dark = new THREE.Color("#7a5e42");
  const tmp = new THREE.Color();
  for (let s = 0; s <= segs; s++) {
    const u = s / segs;
    const p = curve.getPointAt(u);
    const N = frames.normals[s];
    const B = frames.binormals[s];
    let r = 0.06 + 0.045 * (1 - u) + Math.max(0, 0.1 - u) * 0.9;
    r *= 1 + (s % 2) * 0.07;
    tmp.copy(s % 2 ? dark : light).lerp(light, u * 0.3);
    for (let k = 0; k <= rad; k++) {
      const a = (k / rad) * Math.PI * 2;
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r;
      pos.push(p.x + ca * N.x + sa * B.x, p.y + ca * N.y + sa * B.y, p.z + ca * N.z + sa * B.z);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let k = 0; k < rad; k++) {
      const a = s * (rad + 1) + k;
      const b = a + rad + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const palms = [];
const palmHits = [];

function makePalm(x, z, H, leanDir, leanAmt, seed) {
  const r = mulberry32(seed);
  const root = new THREE.Group();
  root.position.set(x, islandHeight(x, z) - 0.06, z);
  tiltGroup.add(root);

  const top = new THREE.Vector3(Math.cos(leanDir) * leanAmt, H, Math.sin(leanDir) * leanAmt);
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(top.x * 0.05, H * 0.35, top.z * 0.05),
    new THREE.Vector3(top.x * 0.5, H * 0.72, top.z * 0.5),
    top,
  );
  const trunk = new THREE.Mesh(makeTrunkGeometry(curve, H), trunkMat);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  root.add(trunk);

  const crown = new THREE.Group();
  crown.position.copy(top);
  root.add(crown);
  const fronds = [];
  const count = 9 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / count) * Math.PI * 2 + r() * 0.4;
    const inner = new THREE.Group();
    const basePitch = -0.15 + r() * 0.65;
    inner.rotation.z = basePitch;
    const mesh = new THREE.Mesh(frondGeos[Math.floor(r() * frondGeos.length)], frondMats[i % 3]);
    mesh.rotation.x = (r() - 0.5) * 0.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    inner.add(mesh);
    pivot.add(inner);
    crown.add(pivot);
    fronds.push({ inner, basePitch, phase: r() * 6.28 });
  }
  const nutGeo = new THREE.SphereGeometry(0.065, 10, 8);
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(nutGeo, coconutMat);
    const a = (i / 3) * Math.PI * 2 + r();
    nut.position.set(Math.cos(a) * 0.09, -0.08, Math.sin(a) * 0.09);
    nut.castShadow = true;
    crown.add(nut);
  }

  // invisible pick volumes
  const trunkHit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, H, 8), hitMat);
  trunkHit.position.set(top.x * 0.5, H / 2, top.z * 0.5);
  trunkHit.visible = false;
  const crownHit = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), hitMat);
  crownHit.position.copy(top);
  crownHit.visible = false;
  root.add(trunkHit, crownHit);

  const palm = {
    root,
    crown,
    fronds,
    H,
    bend: new THREE.Vector2(),
    bendV: new THREE.Vector2(),
    held: false,
    target: new THREE.Vector2(),
    phase: r() * 6.28,
  };
  trunkHit.userData.palm = palm;
  crownHit.userData.palm = palm;
  palmHits.push(trunkHit, crownHit);
  palms.push(palm);
}

(() => {
  const spots = [
    [-2.55, -2.65, 3.3, 0.9],
    [-2.0, -2.9, 2.9, 1.1],
    [-3.1, -2.1, 2.7, 1.0],
    [-2.9, -3.3, 3.1, 0.8],
    [-2.2, -2.1, 2.4, 1.2],
    [-3.4, -2.8, 2.2, 1.1],
    [-1.8, -3.4, 2.5, 1.0],
    [-2.6, -1.8, 2.1, 1.25],
    [-3.3, -3.6, 2.0, 1.0],
  ];
  spots.forEach(([x, z, H, lean], i) => {
    const dir = Math.atan2(z - ISLAND.y, x - ISLAND.x) + (rand() - 0.5) * 0.6;
    makePalm(x, z, H, dir, lean, 100 + i * 7);
  });
})();

/* ==========================================================================
   Bungalows, jetty, pontoon
   ========================================================================== */

const woodMat = new THREE.MeshStandardMaterial({ color: "#a98461", roughness: 0.85 });
const stiltMat = new THREE.MeshStandardMaterial({ color: "#7e6146", roughness: 0.9 });
const wallMat = new THREE.MeshStandardMaterial({ color: "#f1e6d2", roughness: 0.85 });
const roofMat = new THREE.MeshStandardMaterial({ map: thatchTexture(), roughness: 0.95, flatShading: true });
const darkMat = new THREE.MeshStandardMaterial({ color: "#4a3a2e", roughness: 0.8 });
const stiltGeo = new THREE.CylinderGeometry(0.035, 0.04, 1, 6);

function addStilt(x, z, top) {
  const bottom = Math.max(0, islandHeight(x, z) - 0.05);
  const h = top - bottom;
  if (h <= 0.02) return;
  const s = new THREE.Mesh(stiltGeo, stiltMat);
  s.scale.y = h;
  s.position.set(x, bottom + h / 2, z);
  s.castShadow = true;
  tiltGroup.add(s);
}

function makeBungalow(x, z, facing) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = facing;
  g.scale.set(0.85, 1, 0.85);
  tiltGroup.add(g);
  for (const [sx, sz] of [
    [-0.48, -0.48],
    [0.48, -0.48],
    [-0.48, 0.48],
    [0.48, 0.48],
    [0, 0.48],
    [0, -0.48],
  ]) {
    const s = new THREE.Mesh(stiltGeo, stiltMat);
    s.scale.y = DECK_Y;
    s.position.set(sx, DECK_Y / 2, sz);
    s.castShadow = true;
    g.add(s);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 1.2), woodMat);
  deck.position.y = DECK_Y;
  const hut = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.7), wallMat);
  hut.position.set(0, DECK_Y + 0.28, -0.08);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.02), darkMat);
  door.position.set(0, DECK_Y + 0.19, 0.28);
  const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), darkMat);
  win1.position.set(0.25, DECK_Y + 0.32, 0.28);
  const win2 = win1.clone();
  win2.position.x = -0.25;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.5, 4, 1), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, DECK_Y + 0.53 + 0.25, -0.08);
  const lounger = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.34), wallMat);
  lounger.position.set(0.38, DECK_Y + 0.06, 0.38);
  for (const m of [deck, hut, door, win1, win2, roof, lounger]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function plankRun(x0, z0, x1, z1, y, width, posts = true) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  const n = Math.max(1, Math.round(len / 0.13));
  const geos = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const pg = new THREE.BoxGeometry(0.105, 0.045, width * (0.96 + rand() * 0.06));
    pg.rotateY(-ang);
    pg.translate(x0 + dx * t, y + (rand() - 0.5) * 0.008, z0 + dz * t);
    geos.push(pg);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), woodMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  tiltGroup.add(mesh);
  if (posts) {
    const pn = Math.max(1, Math.round(len / 0.8));
    const nx = -Math.sin(ang) * (width / 2);
    const nz = Math.cos(ang) * (width / 2);
    for (let i = 0; i <= pn; i++) {
      const t = i / pn;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      addStilt(px + nx, pz + nz, y);
      addStilt(px - nx, pz - nz, y);
    }
  }
}

(() => {
  // main jetty from the island out along z = -2.0
  plankRun(-1.25, -2.0, 4.05, -2.0, JETTY_Y, 0.36);
  const xs = [0.3, 1.95, 3.6];
  for (const x of xs) {
    makeBungalow(x, -3.45, Math.PI); // north row, door faces the jetty
    makeBungalow(x, -0.55, 0); // south row
    plankRun(x, -2.18, x, -2.83, JETTY_Y, 0.28);
    plankRun(x, -1.82, x, -1.17, JETTY_Y, 0.28);
  }
  // walkway to the seaplane pontoon
  plankRun(-2.15, -1.2, -2.15, 0.12, 1.34, 0.3);
})();

const pontoon = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.42), woodMat);
pontoon.position.set(-1.5, BASE_LEVEL + 0.05, 0.34);
pontoon.castShadow = true;
pontoon.receiveShadow = true;
tiltGroup.add(pontoon);
const pontoonFloats = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 0.08, 0.36),
  new THREE.MeshStandardMaterial({ color: "#d8d2c8", roughness: 0.7 }),
);
pontoonFloats.position.y = -0.07;
pontoon.add(pontoonFloats);

/* ==========================================================================
   Sea floor decor: coral, seagrass, rocks
   ========================================================================== */

const seagrass = [];
(() => {
  const coralCols = ["#ff8a7a", "#f6b14a", "#b77fd6", "#ff6f91", "#ffd27a", "#ff9f6b"];
  const openSpot = () => {
    for (let k = 0; k < 50; k++) {
      const x = -4.4 + rand() * 8.8;
      const z = -4.4 + rand() * 8.8;
      if (Math.hypot(x - ISLAND.x, z - ISLAND.y) < 2.75) continue;
      return [x, z];
    }
    return [3, 3];
  };
  const branchGeo = new THREE.CapsuleGeometry(0.035, 0.22, 3, 6);
  const brainGeo = new THREE.IcosahedronGeometry(0.17, 2);
  {
    const p = brainGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 1 + 0.08 * Math.sin(v.x * 40) * Math.sin(v.z * 40) * Math.sin(v.y * 30);
      v.multiplyScalar(n);
      p.setXYZ(i, v.x, v.y * 0.75, v.z);
    }
    brainGeo.computeVertexNormals();
  }
  for (let i = 0; i < 16; i++) {
    const [x, z] = openSpot();
    const color = coralCols[i % coralCols.length];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (i % 3 === 0) {
      const b = new THREE.Mesh(brainGeo, mat);
      b.position.y = 0.06;
      g.add(b);
    } else {
      const n = 5 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const b = new THREE.Mesh(branchGeo, mat);
        b.position.set((rand() - 0.5) * 0.2, 0.12, (rand() - 0.5) * 0.2);
        b.rotation.set((rand() - 0.5) * 1.1, 0, (rand() - 0.5) * 1.1);
        b.scale.setScalar(0.7 + rand() * 0.6);
        g.add(b);
      }
    }
    g.traverse((m) => {
      if (m.isMesh) m.castShadow = true;
    });
    tiltGroup.add(g);
  }

  const bladeGeo = new THREE.PlaneGeometry(0.035, 0.42);
  bladeGeo.translate(0, 0.21, 0);
  const grassMat = new THREE.MeshStandardMaterial({ color: "#5f9a3c", roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 22; i++) {
    const [x, z] = openSpot();
    const clump = new THREE.Group();
    clump.position.set(x, 0, z);
    const n = 6 + Math.floor(rand() * 5);
    const blades = [];
    for (let k = 0; k < n; k++) {
      const b = new THREE.Mesh(bladeGeo, grassMat);
      b.position.set((rand() - 0.5) * 0.22, 0, (rand() - 0.5) * 0.22);
      b.rotation.y = rand() * Math.PI;
      b.scale.y = 0.6 + rand() * 0.9;
      clump.add(b);
      blades.push({ mesh: b, phase: rand() * 6.28, base: (rand() - 0.5) * 0.3 });
    }
    tiltGroup.add(clump);
    seagrass.push(...blades);
  }

  const rockGeo = new THREE.DodecahedronGeometry(0.16, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#b8ad9b", roughness: 0.95, flatShading: true });
  for (let i = 0; i < 10; i++) {
    const [x, z] = openSpot();
    const r = new THREE.Mesh(rockGeo, rockMat);
    r.position.set(x, 0.03, z);
    r.scale.set(0.6 + rand(), 0.4 + rand() * 0.5, 0.6 + rand());
    r.rotation.y = rand() * 3;
    tiltGroup.add(r);
  }
})();

/* ==========================================================================
   Water: height-field wave simulation + jelly slab mesh
   ========================================================================== */

const G = 112;
const V = G + 1;
const DX = (HALF * 2) / G;
const NTOP = V * V;
let simH = new Float32Array(NTOP);
let simP = new Float32Array(NTOP);
const landMask = new Uint8Array(NTOP);
const dispY = new Float32Array(NTOP);

function updateMask() {
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const land = islandHeight(-HALF + i * DX, -HALF + j * DX) > level - 0.02;
      landMask[k] = land ? 1 : 0;
      if (land) {
        simH[k] = 0;
        simP[k] = 0;
      }
    }
  }
}

function stepSim() {
  const C = 0.12 + params.firmness * 0.0026;
  const damp = 1 - (0.0015 + (params.damping / 100) * 0.03);
  const h = simH;
  const p = simP;
  for (let j = 0; j < V; j++) {
    const jm = j > 0 ? j - 1 : j;
    const jp = j < V - 1 ? j + 1 : j;
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      if (landMask[k]) {
        p[k] = 0;
        continue;
      }
      const hc = h[k];
      const kl = j * V + (i > 0 ? i - 1 : i);
      const kr = j * V + (i < V - 1 ? i + 1 : i);
      const ku = jm * V + i;
      const kd = jp * V + i;
      const l = landMask[kl] ? hc : h[kl];
      const r = landMask[kr] ? hc : h[kr];
      const u = landMask[ku] ? hc : h[ku];
      const d = landMask[kd] ? hc : h[kd];
      let n = (2 * hc - p[k] + C * (l + r + u + d - 4 * hc)) * damp;
      if (n > 0.6) n = 0.6;
      else if (n < -0.6) n = -0.6;
      p[k] = n;
    }
  }
  simP = h;
  simH = p;
}

// keep the mean water height at zero so pokes never drain or fill the lagoon
function rebalanceSim() {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < NTOP; k++) {
    if (landMask[k]) continue;
    sum += simH[k];
    n++;
  }
  if (!n) return;
  const m = sum / n;
  for (let k = 0; k < NTOP; k++) {
    if (landMask[k]) continue;
    simH[k] -= m;
    simP[k] -= m;
  }
}

function disturb(x, z, amount, radius) {
  const ci = (x + HALF) / DX;
  const cj = (z + HALF) / DX;
  const R = Math.ceil((radius * 2.2) / DX);
  const i0 = Math.max(0, Math.floor(ci - R));
  const i1 = Math.min(V - 1, Math.ceil(ci + R));
  const j0 = Math.max(0, Math.floor(cj - R));
  const j1 = Math.min(V - 1, Math.ceil(cj + R));
  const inv = 1 / (radius * radius);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * V + i;
      if (landMask[k]) continue;
      const dx = (i - ci) * DX;
      const dz = (j - cj) * DX;
      const d2 = (dx * dx + dz * dz) * inv;
      if (d2 < 5) simH[k] += amount * Math.exp(-d2);
    }
  }
}

// water geometry: top grid + 4 side walls whose top edge follows the surface
const NSIDE = 2 * V;
const wTotal = NTOP + 4 * NSIDE;
const wPos = new Float32Array(wTotal * 3);
const wNor = new Float32Array(wTotal * 3);
const wUv = new Float32Array(wTotal * 2);
const wIdx = [];
const edges = [
  { list: (t) => t, normal: [0, 0, -1] }, // z = -HALF (j = 0)
  { list: (t) => G * V + t, normal: [0, 0, 1] }, // z = +HALF
  { list: (t) => t * V, normal: [-1, 0, 0] }, // x = -HALF
  { list: (t) => t * V + G, normal: [1, 0, 0] }, // x = +HALF
];

for (let j = 0; j < V; j++) {
  for (let i = 0; i < V; i++) {
    const k = j * V + i;
    wPos[k * 3] = -HALF + i * DX;
    wPos[k * 3 + 1] = level;
    wPos[k * 3 + 2] = -HALF + j * DX;
    wUv[k * 2] = i / G;
    wUv[k * 2 + 1] = 1 - j / G;
  }
}
for (let j = 0; j < G; j++) {
  for (let i = 0; i < G; i++) {
    const a = j * V + i;
    wIdx.push(a, a + V, a + 1, a + 1, a + V, a + V + 1);
  }
}
edges.forEach((e, ei) => {
  const base = NTOP + ei * NSIDE;
  for (let t = 0; t < V; t++) {
    const src = e.list(t);
    for (let b = 0; b < 2; b++) {
      const v = base + t * 2 + b;
      wPos[v * 3] = wPos[src * 3];
      wPos[v * 3 + 1] = b === 0 ? level : 0.002;
      wPos[v * 3 + 2] = wPos[src * 3 + 2];
      wNor[v * 3] = e.normal[0];
      wNor[v * 3 + 1] = e.normal[1];
      wNor[v * 3 + 2] = e.normal[2];
      wUv[v * 2] = t / G;
      wUv[v * 2 + 1] = b === 0 ? 1 : 0;
    }
  }
  // decide winding so faces point outward
  const p = (v) => new THREE.Vector3(wPos[v * 3], wPos[v * 3 + 1], wPos[v * 3 + 2]);
  const tA = base;
  const bA = base + 1;
  const tB = base + 2;
  const n = new THREE.Vector3()
    .subVectors(p(bA), p(tA))
    .cross(new THREE.Vector3().subVectors(p(tB), p(tA)));
  const flip = n.dot(new THREE.Vector3(...e.normal)) < 0;
  for (let t = 0; t < G; t++) {
    const ta = base + t * 2;
    const ba = ta + 1;
    const tb = ta + 2;
    const bb = ta + 3;
    if (flip) wIdx.push(ta, tb, ba, tb, bb, ba);
    else wIdx.push(ta, ba, tb, tb, ba, bb);
  }
});

const waterGeo = new THREE.BufferGeometry();
const wPosAttr = new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage);
const wNorAttr = new THREE.BufferAttribute(wNor, 3).setUsage(THREE.DynamicDrawUsage);
waterGeo.setAttribute("position", wPosAttr);
waterGeo.setAttribute("normal", wNorAttr);
waterGeo.setAttribute("uv", new THREE.BufferAttribute(wUv, 2));
waterGeo.setIndex(wIdx);
waterGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 9);
waterGeo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, 0, -HALF), new THREE.Vector3(HALF, 3, HALF));

function rippleNormalTexture() {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  const waves = [];
  const r = mulberry32(21);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const f = 1 + Math.floor(r() * 6);
    waves.push([Math.cos(a) * f, Math.sin(a) * f, r() * 6.28, 1 / f]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, ph, amp] of waves) {
        // integer frequencies keep the texture tileable
        const kxi = Math.round(kx);
        const kyi = Math.round(ky);
        const arg = ((kxi * x + kyi * y) / S) * Math.PI * 2 + ph;
        const cs = Math.cos(arg) * amp;
        dx += cs * kxi;
        dy += cs * kyi;
      }
      const n = new THREE.Vector3(-dx * 0.25, -dy * 0.25, 1).normalize();
      const o = (y * S + x) * 4;
      img.data[o] = (n.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { srgb: false, repeat: [5, 5] });
}

const rippleTex = rippleNormalTexture();
const waterMat = new THREE.MeshPhysicalMaterial({
  color: FLAVOURS.turquoise.color,
  metalness: 0,
  roughness: 0.04,
  transmission: 1,
  thickness: 1.4,
  ior: 1.33,
  attenuationColor: new THREE.Color(FLAVOURS.turquoise.atten),
  attenuationDistance: 2.4,
  specularIntensity: 1,
  clearcoat: 0.35,
  clearcoatRoughness: 0.1,
  normalMap: rippleTex,
  normalScale: new THREE.Vector2(0.12, 0.12),
  envMapIntensity: 0.85,
});
addCaustics(waterMat, { strength: 0.55, scale: 0.42, belowWater: false, key: "water" });

const water = new THREE.Mesh(waterGeo, waterMat);
water.receiveShadow = true;
water.raycast = () => {};
tiltGroup.add(water);

// thin bright rim along the top edges of the slab
const rimGeo = new THREE.BufferGeometry();
const rimPos = new Float32Array(4 * V * 3);
rimGeo.setAttribute("position", new THREE.BufferAttribute(rimPos, 3).setUsage(THREE.DynamicDrawUsage));
const rimIdx = [];
for (let e = 0; e < 4; e++) for (let t = 0; t < G; t++) rimIdx.push(e * V + t, e * V + t + 1);
rimGeo.setIndex(rimIdx);
const rim = new THREE.LineSegments(
  rimGeo,
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
);
rim.frustumCulled = false;
water.add(rim);

const slosh = {
  tilt: new THREE.Vector2(), // x = rotation about X, y = rotation about Z
  tiltV: new THREE.Vector2(),
  tiltTarget: new THREE.Vector2(),
  e: new THREE.Vector2(),
  eV: new THREE.Vector2(),
  wob: 0,
  wobV: 0,
};

function updateWaterGeometry() {
  const t = simTime;
  const ex = clamp(slosh.e.x - slosh.tilt.x, -0.09, 0.09) + slosh.tilt.x;
  const ez = clamp(slosh.e.y - slosh.tilt.y, -0.09, 0.09) + slosh.tilt.y;
  const h = simH;
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * DX;
    const sz1 = Math.sin(1.2 * z - 1.6 * t + 0.5) * 0.009;
    for (let i = 0; i < V; i++) {
      const x = -HALF + i * DX;
      const k = j * V + i;
      let y =
        level +
        h[k] +
        Math.sin(0.9 * x + 1.3 * t) * 0.012 +
        sz1 +
        Math.sin(1.9 * (x + z) + 2.1 * t) * 0.006 +
        z * ex -
        x * ez;
      if (y < 0.05) y = 0.05;
      dispY[k] = y;
      wPos[k * 3 + 1] = y;
    }
  }
  const inv2 = 1 / (2 * DX);
  for (let j = 0; j < V; j++) {
    const jm = j > 0 ? j - 1 : j;
    const jp = j < V - 1 ? j + 1 : j;
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const im = i > 0 ? i - 1 : i;
      const ip = i < V - 1 ? i + 1 : i;
      const nx = -(dispY[j * V + ip] - dispY[j * V + im]) * inv2;
      const nz = -(dispY[jp * V + i] - dispY[jm * V + i]) * inv2;
      const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      wNor[k * 3] = nx * il;
      wNor[k * 3 + 1] = il;
      wNor[k * 3 + 2] = nz * il;
    }
  }
  for (let e = 0; e < 4; e++) {
    const base = NTOP + e * NSIDE;
    for (let tt = 0; tt < V; tt++) {
      const src = edges[e].list(tt);
      wPos[(base + tt * 2) * 3 + 1] = dispY[src];
      const ri = (e * V + tt) * 3;
      rimPos[ri] = wPos[src * 3];
      rimPos[ri + 1] = dispY[src] + 0.004;
      rimPos[ri + 2] = wPos[src * 3 + 2];
    }
  }
  wPosAttr.needsUpdate = true;
  wNorAttr.needsUpdate = true;
  rimGeo.attributes.position.needsUpdate = true;
}

function heightAt(x, z) {
  const fx = clamp((x + HALF) / DX, 0, G - 0.001);
  const fz = clamp((z + HALF) / DX, 0, G - 0.001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * V + i;
  const a = lerp(dispY[k], dispY[k + 1], tx);
  const b = lerp(dispY[k + V], dispY[k + V + 1], tx);
  return lerp(a, b, tz) * (1 + slosh.wob);
}

// invisible pick volume for the whole block (top face = water, sides = tip)
const blockHit = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 1, HALF * 2), hitMat);
blockHit.visible = false;
tiltGroup.add(blockHit);

function applyLevel() {
  level = BASE_LEVEL + params.tide / 100;
  sharedUniforms.uLevel.value = level;
  blockHit.scale.y = level + GROUND_H;
  blockHit.position.y = (level - GROUND_H) / 2;
  updateMask();
}

/* ==========================================================================
   Fish school
   ========================================================================== */

const FISH_N = 46;
const fishGeo = (() => {
  const body = new THREE.SphereGeometry(0.085, 12, 8);
  body.scale(0.6, 0.95, 2.1);
  const tail = new THREE.ConeGeometry(0.085, 0.15, 4);
  tail.rotateX(Math.PI / 2);
  tail.scale(0.22, 1, 1);
  tail.translate(0, 0, -0.24);
  return mergeGeometries([body, tail]);
})();
const fishMesh = new THREE.InstancedMesh(
  fishGeo,
  new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15 }),
  FISH_N,
);
fishMesh.frustumCulled = false;
fishMesh.castShadow = true;
tiltGroup.add(fishMesh);

const fish = [];
{
  const palette = ["#ffd23f", "#ffb347", "#f6e27a", "#9fd8ff", "#ffffff", "#ff8c42"];
  const c = new THREE.Color();
  for (let i = 0; i < FISH_N; i++) {
    const p = new THREE.Vector3(1.5 + (rand() - 0.5) * 2, 0.4 + rand() * 0.4, 1.5 + (rand() - 0.5) * 2);
    const v = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(0.8);
    fish.push({
      p,
      v,
      offset: new THREE.Vector3((rand() - 0.5) * 1.6, (rand() - 0.5) * 0.3, (rand() - 0.5) * 1.6),
      phase: rand() * 6.28,
      scale: 0.75 + rand() * 0.5,
    });
    c.set(palette[i % palette.length]);
    fishMesh.setColorAt(i, c);
  }
  fishMesh.instanceColor.needsUpdate = true;
}

const stir = { p: new THREE.Vector3(), t: -10 };
const dummy = new THREE.Object3D();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function schoolCenter(t) {
  return tmpV2.set(1.3 + 2.1 * Math.sin(0.13 * t), 0.55, 1.2 + 2.1 * Math.sin(0.17 * t + 1));
}

function avoidWorld(p, acc, strength) {
  const lim = HALF - 0.45;
  if (p.x > lim) acc.x -= (p.x - lim) * strength;
  if (p.x < -lim) acc.x -= (p.x + lim) * strength;
  if (p.z > lim) acc.z -= (p.z - lim) * strength;
  if (p.z < -lim) acc.z -= (p.z + lim) * strength;
  const dx = p.x - ISLAND.x;
  const dz = p.z - ISLAND.y;
  const d = Math.hypot(dx, dz);
  const keep = 2.55;
  if (d < keep) {
    acc.x += (dx / d) * (keep - d) * strength;
    acc.z += (dz / d) * (keep - d) * strength;
  }
}

function updateFish(dt) {
  const t = simTime;
  const food = foodCenter();
  const center = food ? tmpV2.copy(food) : schoolCenter(t);
  const fleeing = t - stir.t < 0.9;
  const acc = new THREE.Vector3();
  for (let i = 0; i < FISH_N; i++) {
    const f = fish[i];
    acc.set(0, 0, 0);
    tmpV.copy(center).addScaledVector(f.offset, food ? 0.25 : 1);
    acc.subVectors(tmpV, f.p).multiplyScalar(food ? 2.2 : 0.9);
    for (let j = 0; j < FISH_N; j++) {
      if (j === i) continue;
      const q = fish[j].p;
      const dx = f.p.x - q.x;
      const dy = f.p.y - q.y;
      const dz = f.p.z - q.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.06 && d2 > 1e-6) {
        const s = 0.04 / d2;
        acc.x += dx * s;
        acc.y += dy * s;
        acc.z += dz * s;
      }
    }
    let maxSpeed = food ? 2.4 : 1.4;
    if (fleeing) {
      const dx = f.p.x - stir.p.x;
      const dz = f.p.z - stir.p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4) {
        const s = (2.4 - d) * 14;
        acc.x += (dx / (d + 0.01)) * s;
        acc.z += (dz / (d + 0.01)) * s;
        maxSpeed = 4.2;
      }
    }
    avoidWorld(f.p, acc, 12);
    f.v.addScaledVector(acc, dt);
    const sp = f.v.length();
    if (sp > maxSpeed) f.v.multiplyScalar(maxSpeed / sp);
    if (sp < 0.45) f.v.multiplyScalar(0.45 / Math.max(sp, 1e-3));
    f.v.y *= 0.9;
    f.p.addScaledVector(f.v, dt);
    f.p.y = clamp(f.p.y, 0.18, level - 0.2);
    f.p.x = clamp(f.p.x, -HALF + 0.2, HALF - 0.2);
    f.p.z = clamp(f.p.z, -HALF + 0.2, HALF - 0.2);

    dummy.position.copy(f.p);
    tmpV.copy(f.v).normalize();
    dummy.quaternion.setFromUnitVectors(Z_AXIS, tmpV);
    dummy.rotateY(Math.sin(t * 14 + f.phase) * 0.22);
    dummy.scale.setScalar(f.scale);
    dummy.updateMatrix();
    fishMesh.setMatrixAt(i, dummy.matrix);
  }
  fishMesh.instanceMatrix.needsUpdate = true;
}

/* ==========================================================================
   Eagle rays
   ========================================================================== */

const rayMat = new THREE.MeshStandardMaterial({ map: rayTexture(), roughness: 0.55, side: THREE.DoubleSide });
const rays = [];

function makeRayGeometry() {
  const zs = [0.42, 0.3, 0.17, 0.04, -0.08, -0.2, -0.3];
  const fs = [-1, -0.62, -0.28, 0, 0.28, 0.62, 1];
  const pos = [];
  const uv = [];
  const idx = [];
  for (const z of zs) {
    const w = z > -0.02 ? 0.8 * (1 - (z + 0.02) / 0.48) : 0.8 * (1 - (-0.02 - z) / 0.32);
    for (const f of fs) {
      const x = f * Math.max(w, 0.03);
      const zz = z - 0.2 * f * f;
      const y = 0.045 * (1 - Math.abs(f)) * (z > -0.25 ? 1 : 0.4);
      pos.push(x, y, zz);
      uv.push(f * 0.5 + 0.5, (z + 0.4) / 0.85);
    }
  }
  const C = fs.length;
  for (let r = 0; r < zs.length - 1; r++) {
    for (let c = 0; c < C - 1; c++) {
      const a = r * C + c;
      idx.push(a, a + 1, a + C, a + 1, a + C + 1, a + C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

for (let i = 0; i < 3; i++) {
  const geo = makeRayGeometry();
  const base = Float32Array.from(geo.attributes.position.array);
  const mesh = new THREE.Mesh(geo, rayMat);
  mesh.castShadow = true;
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.014, 0.95, 4),
    new THREE.MeshStandardMaterial({ color: "#26303a" }),
  );
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -0.75;
  const group = new THREE.Group();
  group.add(mesh, tail);
  const s = 0.95 + i * 0.12;
  group.scale.setScalar(s);
  group.position.set(-1 + i * 1.6, 0.35, 2.2 - i * 1.4);
  tiltGroup.add(group);
  rays.push({
    group,
    mesh,
    base,
    heading: rand() * Math.PI * 2,
    speed: 0.65 + rand() * 0.2,
    target: new THREE.Vector2(),
    retarget: 0,
    phase: rand() * 6.28,
    depth: 0.28 + i * 0.12,
    bank: 0,
  });
}

function updateRays(dt) {
  const t = simTime;
  const food = foodCenter();
  for (const r of rays) {
    r.retarget -= dt;
    const p = r.group.position;
    if (r.retarget <= 0 || Math.hypot(r.target.x - p.x, r.target.y - p.z) < 0.6) {
      for (let k = 0; k < 30; k++) {
        const x = -4 + rand() * 8;
        const z = -4 + rand() * 8;
        if (Math.hypot(x - ISLAND.x, z - ISLAND.y) > 3.0) {
          r.target.set(x, z);
          break;
        }
      }
      r.retarget = 6 + rand() * 6;
    }
    const tx = food ? food.x + Math.cos(r.phase) * 0.8 : r.target.x;
    const tz = food ? food.z + Math.sin(r.phase) * 0.8 : r.target.y;
    // avoid island and walls by bending the desired heading
    let dx = tx - p.x;
    let dz = tz - p.z;
    const ix = p.x - ISLAND.x;
    const iz = p.z - ISLAND.y;
    const id = Math.hypot(ix, iz);
    if (id < 3.2) {
      dx += (ix / id) * (3.2 - id) * 3;
      dz += (iz / id) * (3.2 - id) * 3;
    }
    const lim = HALF - 0.9;
    if (Math.abs(p.x) > lim) dx -= Math.sign(p.x) * (Math.abs(p.x) - lim) * 4;
    if (Math.abs(p.z) > lim) dz -= Math.sign(p.z) * (Math.abs(p.z) - lim) * 4;
    const desired = Math.atan2(dx, dz);
    let dh = desired - r.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const turn = clamp(dh, -1, 1) * 0.9;
    r.heading += turn * dt;
    r.bank = lerp(r.bank, -turn * 0.5, 1 - Math.exp(-3 * dt));
    const sp = r.speed * (food ? 1.4 : 1);
    p.x += Math.sin(r.heading) * sp * dt;
    p.z += Math.cos(r.heading) * sp * dt;
    p.x = clamp(p.x, -HALF + 0.6, HALF - 0.6);
    p.z = clamp(p.z, -HALF + 0.6, HALF - 0.6);
    p.y = clamp(r.depth + Math.sin(t * 0.5 + r.phase) * 0.08, 0.2, level - 0.25);
    r.group.rotation.set(0, r.heading, r.bank, "YXZ");

    // flap the wings
    const arr = r.mesh.geometry.attributes.position.array;
    const b = r.base;
    for (let v = 0; v < arr.length; v += 3) {
      const ax = Math.abs(b[v]);
      arr[v + 1] = b[v + 1] + Math.sin(t * 2.2 + r.phase - ax * 2.2) * 0.17 * Math.pow(ax / 0.8, 1.5);
    }
    r.mesh.geometry.attributes.position.needsUpdate = true;
    r.mesh.geometry.computeVertexNormals();
  }
}

/* ==========================================================================
   Food
   ========================================================================== */

const foodGeo = new THREE.SphereGeometry(0.04, 6, 5);
const foodMat = new THREE.MeshStandardMaterial({ color: "#c7743a", roughness: 0.6 });
const pellets = [];
const foodC = new THREE.Vector3();

function feed() {
  counters.fed++;
  let cx = 1.5;
  let cz = 1.5;
  for (let k = 0; k < 40; k++) {
    cx = -3.2 + rand() * 7;
    cz = -0.2 + rand() * 4;
    if (Math.hypot(cx - ISLAND.x, cz - ISLAND.y) > 3) break;
  }
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(foodGeo, foodMat);
    m.position.set(cx + (rand() - 0.5) * 0.9, level + 2.2 + rand() * 1.2, cz + (rand() - 0.5) * 0.9);
    m.castShadow = true;
    tiltGroup.add(m);
    pellets.push({ mesh: m, vy: 0, state: "air", age: 0, phase: rand() * 6.28 });
  }
  updateCounters();
}

function foodCenter() {
  let n = 0;
  foodC.set(0, 0, 0);
  for (const p of pellets) {
    if (p.state !== "sink") continue;
    foodC.add(p.mesh.position);
    n++;
  }
  if (!n) return null;
  return foodC.multiplyScalar(1 / n);
}

function removePellet(i) {
  tiltGroup.remove(pellets[i].mesh);
  pellets.splice(i, 1);
}

function updateFood(dt) {
  for (let i = pellets.length - 1; i >= 0; i--) {
    const p = pellets[i];
    const m = p.mesh.position;
    p.age += dt;
    if (p.state === "air") {
      p.vy -= 7 * dt;
      m.y += p.vy * dt;
      const surf = heightAt(m.x, m.z);
      if (m.y <= surf) {
        p.state = "sink";
        disturb(m.x, m.z, -0.03, 0.14);
        slosh.wobV += 0.004;
      }
    } else {
      m.y = Math.max(0.08, m.y - 0.16 * dt);
      m.x += Math.sin(simTime * 2 + p.phase) * 0.05 * dt;
      for (const f of fish) {
        if (f.p.distanceToSquared(m) < 0.035) {
          removePellet(i);
          break;
        }
      }
    }
    if (pellets[i] === p && p.age > 30) removePellet(i);
  }
}

/* ==========================================================================
   Floating rings
   ========================================================================== */

const ringGeo = new THREE.TorusGeometry(0.28, 0.085, 12, 36);
const ringMat = new THREE.MeshStandardMaterial({ map: ringTexture(), roughness: 0.45 });
const ringHitGeo = new THREE.SphereGeometry(0.5, 10, 8);
const rings = [];

function spawnRing(x, z, fromSky) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(ringGeo, ringMat);
  mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const hit = new THREE.Mesh(ringHitGeo, hitMat);
  hit.visible = false;
  group.add(mesh, hit);
  group.position.set(x, fromSky ? level + 3.5 : level, z);
  tiltGroup.add(group);
  const ring = {
    group,
    hit,
    vel: new THREE.Vector3(0, 0, 0),
    state: fromSky ? "air" : "float",
    spin: 0,
    spinV: 0,
    track: new THREE.Vector3(),
  };
  hit.userData.ring = ring;
  rings.push(ring);
  updateCounters();
  return ring;
}

function randomOpenWater() {
  for (let k = 0; k < 60; k++) {
    const x = -4.2 + rand() * 8.4;
    const z = -0.2 + rand() * 4.4;
    if (Math.hypot(x - ISLAND.x, z - ISLAND.y) < 3) continue;
    if (Math.abs(z - 1.05) < 0.6 && x < 0.2) continue; // seaplane berth
    return [x, z];
  }
  return [2.5, 2.5];
}

const UP = new THREE.Vector3(0, 1, 0);
const ringNormal = new THREE.Vector3();
const ringQ = new THREE.Quaternion();

function updateRings(dt) {
  const iwr = islandWaterRadius() + 0.35;
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    const p = r.group.position;
    if (r.state === "float") {
      const e = 0.12;
      const gx = (heightAt(p.x + e, p.z) - heightAt(p.x - e, p.z)) / (2 * e);
      const gz = (heightAt(p.x, p.z + e) - heightAt(p.x, p.z - e)) / (2 * e);
      r.vel.x += (-gx * 4 + Math.sin(simTime * 0.3 + i) * 0.02) * dt;
      r.vel.z += (-gz * 4 + Math.cos(simTime * 0.23 + i * 2) * 0.02) * dt;
      r.vel.multiplyScalar(Math.exp(-0.8 * dt));
      p.x += r.vel.x * dt;
      p.z += r.vel.z * dt;
      const lim = HALF - 0.38;
      if (Math.abs(p.x) > lim) {
        p.x = Math.sign(p.x) * lim;
        r.vel.x *= -0.5;
      }
      if (Math.abs(p.z) > lim) {
        p.z = Math.sign(p.z) * lim;
        r.vel.z *= -0.5;
      }
      const dx = p.x - ISLAND.x;
      const dz = p.z - ISLAND.y;
      const d = Math.hypot(dx, dz);
      if (d < iwr) {
        p.x = ISLAND.x + (dx / d) * iwr;
        p.z = ISLAND.y + (dz / d) * iwr;
      }
      p.y = heightAt(p.x, p.z) - 0.015;
      ringNormal.set(-gx, 1, -gz).normalize();
      ringQ.setFromUnitVectors(UP, ringNormal);
      r.spin += r.spinV * dt;
      r.spinV *= Math.exp(-dt);
      r.group.quaternion.copy(ringQ).multiply(tmpQ.setFromAxisAngle(UP, r.spin + i));
    } else if (r.state === "air" || r.state === "off") {
      r.vel.y -= 9.8 * dt;
      p.addScaledVector(r.vel, dt);
      r.spin += 6 * dt;
      r.group.rotation.set(r.spin * 0.3, r.spin, 0);
      const inside = Math.abs(p.x) < HALF - 0.1 && Math.abs(p.z) < HALF - 0.1;
      if (r.state === "air" && inside) {
        const surf = heightAt(p.x, p.z);
        const dI = Math.hypot(p.x - ISLAND.x, p.z - ISLAND.y);
        if (dI < iwr && p.y < islandHeight(p.x, p.z) + 0.1) {
          // bounce off the island into the lagoon
          const dx = (p.x - ISLAND.x) / dI;
          const dz = (p.z - ISLAND.y) / dI;
          r.vel.set(dx * 2.5, 2.2, dz * 2.5);
          p.y = islandHeight(p.x, p.z) + 0.12;
        } else if (p.y <= surf) {
          const impact = clamp(-r.vel.y / 7, 0.2, 1.4);
          disturb(p.x, p.z, -0.22 * impact, 0.32);
          slosh.wobV += 0.02 * impact;
          stir.p.copy(p);
          stir.t = simTime;
          r.vel.set(r.vel.x * 0.25, 0, r.vel.z * 0.25);
          r.spinV = 2;
          r.state = "float";
        }
      } else if (!inside && p.y < level && r.state !== "off") {
        r.state = "off";
        updateCounters();
      }
      if (p.y < -14) {
        tiltGroup.remove(r.group);
        rings.splice(i, 1);
        updateCounters();
      }
    }
  }
}

const tmpQ = new THREE.Quaternion();

/* ==========================================================================
   Seaplane
   ========================================================================== */

const planeWhite = new THREE.MeshStandardMaterial({ color: "#f7f6f2", roughness: 0.35, metalness: 0.05 });
const planeAccent = new THREE.MeshStandardMaterial({ color: "#2bb3a3", roughness: 0.4 });
const planeDark = new THREE.MeshStandardMaterial({ color: "#2a3138", roughness: 0.3, metalness: 0.2 });

const seaplane = (() => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.8, 6, 14), planeWhite);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 1.12);
  body.position.set(0, 0.45, 0);
  const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.113, 0.62, 4, 14), planeAccent);
  stripe.rotation.x = Math.PI / 2;
  stripe.scale.set(1, 1, 0.28);
  stripe.position.set(0, 0.43, -0.02);
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.16), planeDark);
  cockpit.position.set(0, 0.54, 0.28);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.035, 0.27), planeWhite);
  wing.position.set(0, 0.6, 0.12);
  const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.037, 0.27), planeAccent);
  tipL.position.set(0.82, 0.6, 0.12);
  const tipR = tipL.clone();
  tipR.position.x = -0.82;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.26, 0.2), planeWhite);
  fin.position.set(0, 0.64, -0.5);
  const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.08, 0.2), planeAccent);
  finTip.position.set(0, 0.75, -0.5);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.14), planeWhite);
  stab.position.set(0, 0.5, -0.52);
  const parts = [body, stripe, cockpit, wing, tipL, tipR, fin, finTip, stab];
  const floatGeo = new THREE.CapsuleGeometry(0.055, 0.82, 4, 10);
  const strutGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.36, 5);
  for (const sx of [-0.27, 0.27]) {
    const f = new THREE.Mesh(floatGeo, planeWhite);
    f.rotation.x = Math.PI / 2;
    f.position.set(sx, 0.06, 0.02);
    parts.push(f);
    for (const sz of [0.22, -0.18]) {
      const s = new THREE.Mesh(strutGeo, planeDark);
      s.position.set(sx * 0.6, 0.25, sz);
      s.rotation.z = sx > 0 ? 0.55 : -0.55;
      parts.push(s);
    }
    const ws = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.42, 4), planeDark);
    ws.position.set(sx * 1.4, 0.48, 0.12);
    ws.rotation.z = sx > 0 ? -0.75 : 0.75;
    parts.push(ws);
  }
  const prop = new THREE.Group();
  prop.position.set(0, 0.45, 0.6);
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 10), planeAccent);
  hub.rotation.x = Math.PI / 2;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.012), planeDark);
  prop.add(hub, blade);
  parts.push(prop);
  for (const p of parts) {
    p.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    g.add(p);
  }
  g.scale.setScalar(0.95);
  tiltGroup.add(g);
  return { group: g, prop };
})();

const DOCK = new THREE.Vector3(-1.25, 0, 1.08);
const CIRCLE = { cx: 0, cy: 7.5, cz: 0, R: 16, w: 0.32 };
const AWAY_TIME = 14;
const plane = {
  state: "docked",
  t: 0,
  dur: 1,
  curve: null,
  theta: 0,
  awayT: 0,
  prev: new THREE.Vector3(),
  heading: Math.PI / 2,
  roll: 0,
  propSpeed: 0,
};

function circlePoint(theta, out = new THREE.Vector3()) {
  return out.set(CIRCLE.cx + Math.cos(theta) * CIRCLE.R, CIRCLE.cy, CIRCLE.cz + Math.sin(theta) * CIRCLE.R);
}

function planeTakeoff() {
  const L = level;
  plane.theta = 0.2;
  const pts = [
    new THREE.Vector3(DOCK.x, L, DOCK.z),
    new THREE.Vector3(0.8, L, 1.25),
    new THREE.Vector3(3.4, L + 0.03, 1.6),
    new THREE.Vector3(6.2, L + 0.9, 2.2),
    new THREE.Vector3(10.5, L + 3.2, 3.1),
    circlePoint(plane.theta),
  ];
  plane.curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  plane.dur = plane.curve.getLength() / 3.6;
  plane.t = 0;
  plane.state = "takeoff";
}

function planeLand() {
  const L = level;
  const pts = [
    seaplane.group.position.clone(),
    new THREE.Vector3(-13, 5, 5.5),
    new THREE.Vector3(-9, 2.6, 3),
    new THREE.Vector3(-6.2, L + 0.45, 1.6),
    new THREE.Vector3(-4.4, L, 1.3),
    new THREE.Vector3(-2.7, L, 1.12),
    new THREE.Vector3(DOCK.x, L, DOCK.z),
  ];
  // if already over the scene's west side, skip the first big detour
  if (pts[0].x < -7) pts.splice(1, 1);
  plane.curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  plane.dur = plane.curve.getLength() / 5.5;
  plane.t = 0;
  plane.state = "landing";
}

function planeButton() {
  if (plane.state === "docked") planeTakeoff();
  else if (plane.state === "away") planeLand();
}

const lookM = new THREE.Matrix4();
const planeQ = new THREE.Quaternion();

function updatePlane(dt) {
  const g = seaplane.group;
  const pos = g.position;
  plane.prev.copy(pos);
  if (plane.state === "docked") {
    const y = heightAt(DOCK.x, DOCK.z);
    pos.set(DOCK.x, y - 0.03, DOCK.z);
    const e = 0.4;
    const pitch = (heightAt(DOCK.x + e, DOCK.z) - heightAt(DOCK.x - e, DOCK.z)) / (2 * e);
    const roll = (heightAt(DOCK.x, DOCK.z + e) - heightAt(DOCK.x, DOCK.z - e)) / (2 * e);
    g.rotation.set(0, Math.PI / 2, 0);
    g.rotateX(-pitch * 0.8);
    g.rotateZ(roll * 0.8);
    plane.propSpeed = lerp(plane.propSpeed, 0, 1 - Math.exp(-1.5 * dt));
  } else {
    plane.propSpeed = lerp(plane.propSpeed, 40, 1 - Math.exp(-2 * dt));
    if (plane.state === "takeoff" || plane.state === "landing") {
      plane.t += dt / plane.dur;
      const tt = clamp(plane.t, 0, 1);
      const u = plane.state === "takeoff" ? tt * tt * (0.6 + 0.4 * tt) : 1 - (1 - tt) * (1 - tt);
      plane.curve.getPointAt(u, pos);
      // stay on the surface while on the water
      if (pos.y < level + 0.12) pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) - 0.03);
      const onWater = pos.y < level + 0.08 && Math.abs(pos.x) < HALF && Math.abs(pos.z) < HALF;
      const speed = plane.prev.distanceTo(pos) / Math.max(dt, 1e-4);
      if (onWater && speed > 0.8 && dt > 0) {
        disturb(pos.x - 0.4 * Math.sign(pos.x - plane.prev.x), pos.z, -0.012 * Math.min(speed, 5), 0.18);
      }
      if (plane.t >= 1) {
        if (plane.state === "takeoff") {
          plane.state = "away";
          plane.awayT = 0;
        } else {
          plane.state = "docked";
          counters.landings++;
          disturb(DOCK.x, DOCK.z, -0.05, 0.4);
          updateCounters();
        }
      }
      if (plane.state === "landing" && plane.t > 0.55 && !plane.splashed && onWater) {
        plane.splashed = true;
        disturb(pos.x, pos.z, -0.16, 0.4);
        slosh.wobV += 0.03;
      }
    } else if (plane.state === "away") {
      plane.awayT += dt;
      plane.theta -= CIRCLE.w * dt;
      circlePoint(plane.theta, pos);
      pos.y += Math.sin(plane.awayT * 0.7) * 0.4;
      if (plane.awayT > AWAY_TIME) planeLand();
    }
    if (plane.state !== "landing") plane.splashed = false;
    const vel = tmpV.subVectors(pos, plane.prev);
    if (vel.lengthSq() > 1e-7 && plane.state !== "docked") {
      const target = tmpV2.copy(pos).add(vel);
      lookM.lookAt(target, pos, UP);
      planeQ.setFromRotationMatrix(lookM);
      const newHeading = Math.atan2(vel.x, vel.z);
      let dh = newHeading - plane.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      plane.heading = newHeading;
      const yawRate = dt > 0 ? dh / dt : 0;
      plane.roll = lerp(plane.roll, clamp(-yawRate * 0.6, -0.65, 0.65), 1 - Math.exp(-3 * dt));
      planeQ.multiply(tmpQ.setFromAxisAngle(Z_AXIS, plane.roll));
      g.quaternion.slerp(planeQ, 1 - Math.exp(-7 * dt));
    }
  }
  seaplane.prop.rotation.z += plane.propSpeed * dt;
}

/* ==========================================================================
   Springs: tilt + slosh + jelly wobble + palms
   ========================================================================== */

function updateSprings(dt, tipping) {
  const f = params.firmness;
  const Kb = 18 + f * 0.8;
  const Db = 2.5 + f * 0.05;
  const Ks = 7 + f * 0.55;
  const Ds = 0.9 + f * 0.025;
  if (tipping) {
    const prevX = slosh.tilt.x;
    const prevY = slosh.tilt.y;
    const k = 1 - Math.exp(-14 * dt);
    slosh.tilt.x = lerp(slosh.tilt.x, slosh.tiltTarget.x, k);
    slosh.tilt.y = lerp(slosh.tilt.y, slosh.tiltTarget.y, k);
    if (dt > 0) slosh.tiltV.set((slosh.tilt.x - prevX) / dt, (slosh.tilt.y - prevY) / dt);
  } else {
    slosh.tiltV.x += (-Kb * slosh.tilt.x - Db * slosh.tiltV.x) * dt;
    slosh.tiltV.y += (-Kb * slosh.tilt.y - Db * slosh.tiltV.y) * dt;
    slosh.tilt.addScaledVector(slosh.tiltV, dt);
  }
  slosh.eV.x += (Ks * (slosh.tilt.x - slosh.e.x) - Ds * slosh.eV.x) * dt;
  slosh.eV.y += (Ks * (slosh.tilt.y - slosh.e.y) - Ds * slosh.eV.y) * dt;
  slosh.e.addScaledVector(slosh.eV, dt);
  tiltGroup.rotation.set(slosh.tilt.x, 0, slosh.tilt.y);

  const Kw = 30 + f * 1.4;
  const Dw = 1.2 + f * 0.04;
  slosh.wobV += (-Kw * slosh.wob - Dw * slosh.wobV) * dt;
  slosh.wob = clamp(slosh.wob + slosh.wobV * dt, -0.14, 0.14);
  water.scale.y = 1 + slosh.wob;

  for (const p of palms) {
    if (p.held) {
      const k = 1 - Math.exp(-16 * dt);
      const px = p.bend.x;
      const py = p.bend.y;
      p.bend.x = lerp(p.bend.x, p.target.x, k);
      p.bend.y = lerp(p.bend.y, p.target.y, k);
      if (dt > 0) p.bendV.set((p.bend.x - px) / dt, (p.bend.y - py) / dt);
    } else {
      p.bendV.x += (-34 * p.bend.x - 2.2 * p.bendV.x) * dt;
      p.bendV.y += (-34 * p.bend.y - 2.2 * p.bendV.y) * dt;
      p.bend.addScaledVector(p.bendV, dt);
    }
    const wind = Math.sin(simTime * 0.9 + p.phase) * 0.015;
    p.root.rotation.set(p.bend.y + wind, 0, -p.bend.x + wind * 0.6);
    p.crown.rotation.set(p.bend.y * 0.6, 0, -p.bend.x * 0.6);
    for (const fr of p.fronds) {
      fr.inner.rotation.z = fr.basePitch + Math.sin(simTime * 1.4 + fr.phase) * 0.05 - p.bendV.length() * 0.01;
    }
  }
  for (const s of seagrass) {
    s.mesh.rotation.z = s.base + Math.sin(simTime * 1.2 + s.phase) * 0.18;
  }
}

/* ==========================================================================
   Controls & pointer interactions
   ========================================================================== */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const drag = {
  mode: null,
  pointerId: null,
  startY: 0,
  startX: 0,
  grabLocal: new THREE.Vector3(),
  palm: null,
  ring: null,
  last: new THREE.Vector3(),
  plane: new THREE.Plane(),
};

function setNdc(e) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

const invTilt = new THREE.Matrix4();
function localRay() {
  tiltGroup.updateMatrixWorld();
  invTilt.copy(tiltGroup.matrixWorld).invert();
  return raycaster.ray.clone().applyMatrix4(invTilt);
}

function pick() {
  const candidates = [...palmHits, ...rings.map((r) => r.hit), island, blockHit];
  const hits = raycaster.intersectObjects(candidates, false);
  if (!hits.length) return null;
  const h = hits[0];
  if (h.object.userData.palm) return { kind: "palm", palm: h.object.userData.palm, point: h.point };
  if (h.object.userData.ring) {
    const ring = h.object.userData.ring;
    if (ring.state === "float") return { kind: "ring", ring, point: h.point };
    return null;
  }
  if (h.object === island) return null;
  if (h.object === blockHit) {
    const local = tiltGroup.worldToLocal(h.point.clone());
    if (h.face && h.face.normal.y > 0.5) return { kind: "water", point: local };
    if (h.face && Math.abs(h.face.normal.y) < 0.5) return { kind: "side", point: local };
  }
  return null;
}

const planeHit = new THREE.Vector3();
function rayToLocalPlaneY(y, out) {
  const ray = localRay();
  drag.plane.set(UP, -y);
  return ray.intersectPlane(drag.plane, out);
}

function onPointerDown(e) {
  if (e.button !== 0 || !e.isPrimary || drag.mode) return;
  setNdc(e);
  const hit = pick();
  if (!hit) return;
  drag.mode = hit.kind;
  drag.pointerId = e.pointerId;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = "grabbing";
  if (hit.kind === "water") {
    drag.last.copy(hit.point);
    disturb(hit.point.x, hit.point.z, -0.12, 0.25);
    stir.p.copy(hit.point);
    stir.t = simTime;
  } else if (hit.kind === "side") {
    drag.grabLocal.copy(hit.point);
  } else if (hit.kind === "palm") {
    drag.palm = hit.palm;
    hit.palm.held = true;
    hit.palm.target.copy(hit.palm.bend);
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    camDir.y = 0;
    camDir.normalize();
    drag.plane.setFromNormalAndCoplanarPoint(camDir.negate(), hit.point);
    drag.grabLocal.copy(hit.point);
    drag.palmBend0 = hit.palm.bend.clone();
  } else if (hit.kind === "ring") {
    drag.ring = hit.ring;
    hit.ring.state = "held";
    hit.ring.vel.set(0, 0, 0);
    drag.last.copy(hit.ring.group.position);
    const p0 = rayToLocalPlaneY(level + 0.6, planeHit);
    drag.grabOffset = p0 ? new THREE.Vector3(hit.ring.group.position.x - p0.x, 0, hit.ring.group.position.z - p0.z) : new THREE.Vector3();
  }
}

function onPointerMove(e) {
  setNdc(e);
  if (!drag.mode) {
    if (e.buttons === 0) {
      const hit = pick();
      canvas.style.cursor = !hit
        ? "default"
        : hit.kind === "water"
          ? "crosshair"
          : hit.kind === "side"
            ? "ns-resize"
            : "grab";
    }
    return;
  }
  if (e.pointerId !== drag.pointerId) return;
  if (drag.mode === "water") {
    const p = rayToLocalPlaneY(level, planeHit);
    if (!p) return;
    if (Math.abs(p.x) > HALF || Math.abs(p.z) > HALF) return;
    const dist = p.distanceTo(drag.last);
    const steps = Math.min(12, Math.ceil(dist / 0.12));
    const amt = -clamp(dist * 0.5, 0.02, 0.13);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      disturb(lerp(drag.last.x, p.x, t), lerp(drag.last.z, p.z, t), amt, 0.24);
    }
    drag.last.copy(p);
    stir.p.copy(p);
    stir.t = simTime;
  } else if (drag.mode === "side") {
    const dy = (drag.startY - e.clientY) * 0.0045;
    const theta = clamp(dy, -0.15, 0.15);
    const ax = -drag.grabLocal.z;
    const az = drag.grabLocal.x;
    const len = Math.hypot(ax, az) || 1;
    slosh.tiltTarget.set((ax / len) * theta, (az / len) * theta);
  } else if (drag.mode === "palm") {
    const hitP = raycaster.ray.intersectPlane(drag.plane, planeHit);
    if (!hitP) return;
    const palm = drag.palm;
    const dx = hitP.x - drag.grabLocal.x;
    const dz = hitP.z - drag.grabLocal.z;
    const k = 1.3 / palm.H;
    const v = new THREE.Vector2(dx * k, dz * k);
    if (v.length() > 0.7) v.setLength(0.7);
    palm.target.copy(drag.palmBend0).add(v);
  } else if (drag.mode === "ring") {
    const p = rayToLocalPlaneY(level + 0.6, planeHit);
    if (!p) return;
    p.add(drag.grabOffset);
    p.x = clamp(p.x, -HALF - 3, HALF + 3);
    p.z = clamp(p.z, -HALF - 3, HALF + 3);
    drag.ringTarget = p.clone();
  }
}

function endDrag(e) {
  if (!drag.mode || (e && e.pointerId !== drag.pointerId)) return;
  if (drag.mode === "side") {
    slosh.tiltTarget.set(0, 0);
    slosh.wobV += Math.min(0.5, slosh.tilt.length() * 1.6);
    // a little splash along the edges as the jelly lets go
    const n = slosh.tilt.length();
    if (n > 0.02) {
      for (let i = 0; i < 6; i++) {
        const t = -HALF + 0.5 + i * 1.8;
        disturb(t, -HALF + 0.2, -0.05 * n * 10, 0.4);
        disturb(HALF - 0.2, t, -0.05 * n * 10, 0.4);
      }
    }
  } else if (drag.mode === "palm") {
    drag.palm.held = false;
    drag.palm = null;
  } else if (drag.mode === "ring") {
    const r = drag.ring;
    const v = r.track.clone().multiplyScalar(0.5);
    v.y = 0;
    if (v.length() > 3.6) v.setLength(3.6);
    r.vel.set(v.x, 2.4 + v.length() * 0.35, v.z);
    r.state = "air";
    r.track.set(0, 0, 0);
    drag.ring = null;
    drag.ringTarget = null;
  }
  try {
    if (drag.pointerId !== null) canvas.releasePointerCapture(drag.pointerId);
  } catch {
    // pointer already released
  }
  drag.mode = null;
  drag.pointerId = null;
  controls.enabled = true;
  canvas.style.cursor = "default";
}

// register before OrbitControls so we can veto orbiting when grabbing
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

const controls = new OrbitControls(camera, canvas);
controls.target.copy(DEFAULT_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 12;
controls.maxDistance = 55;
controls.maxPolarAngle = Math.PI * 0.47;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.update();

function updateHeldRing(dt) {
  const r = drag.ring;
  if (!r || !drag.ringTarget) {
    if (r) r.group.position.y = lerp(r.group.position.y, level + 0.6, 1 - Math.exp(-10 * dt));
    return;
  }
  drag.last.copy(r.group.position);
  r.group.position.lerp(drag.ringTarget, 1 - Math.exp(-18 * dt));
  if (dt > 0) r.track.lerp(tmpV.subVectors(r.group.position, drag.last).multiplyScalar(1 / dt), 0.3);
  r.group.rotation.set(Math.sin(simTime * 3) * 0.15, simTime, 0);
}

/* ==========================================================================
   UI wiring
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const ui = {
  landings: $("c-landings"),
  fed: $("c-fed"),
  afloat: $("c-afloat"),
  progress: $("progress"),
  status: document.querySelector(".status"),
  statusText: $("status-text"),
  pause: $("btn-pause"),
};

function updateCounters() {
  ui.landings.textContent = counters.landings;
  ui.fed.textContent = counters.fed;
  ui.afloat.textContent = rings.filter((r) => r.state !== "off").length;
}

function setFlavour(name) {
  const f = FLAVOURS[name];
  params.flavour = name;
  waterMat.color.set(f.color);
  waterMat.attenuationColor.set(f.atten);
  sharedUniforms.uCausticColor.value.set(f.caustic);
  document.querySelectorAll(".tile").forEach((t) => t.classList.toggle("selected", t.dataset.flavour === name));
}

$("btn-plane").addEventListener("click", planeButton);
$("btn-feed").addEventListener("click", feed);
$("btn-ring").addEventListener("click", () => {
  if (rings.length >= MAX_RINGS) return;
  const [x, z] = randomOpenWater();
  spawnRing(x, z, true);
});
document.querySelectorAll(".tile").forEach((t) => t.addEventListener("click", () => setFlavour(t.dataset.flavour)));

function bindSlider(id, key, fmt, onChange) {
  const input = $(`s-${id}`);
  const out = $(`v-${id}`);
  input.addEventListener("input", () => {
    params[key] = Number(input.value);
    out.textContent = fmt(params[key]);
    if (onChange) onChange();
  });
  return { input, out };
}
const sliders = {
  firmness: bindSlider("firmness", "firmness", (v) => `${v}`),
  damping: bindSlider("damping", "damping", (v) => `${v}`),
  tide: bindSlider("tide", "tide", (v) => `${v > 0 ? "+" : ""}${v} cm`, applyLevel),
};

function setPaused(p) {
  params.paused = p;
  ui.pause.textContent = p ? "Resume" : "Pause";
  ui.status.classList.toggle("paused", p);
  ui.statusText.textContent = p ? "WEBGL · PAUSED" : "WEBGL · LIVE";
}
$("btn-pause").addEventListener("click", () => setPaused(!params.paused));

function resetAll() {
  simH.fill(0);
  simP.fill(0);
  for (const r of rings) tiltGroup.remove(r.group);
  rings.length = 0;
  for (let i = pellets.length - 1; i >= 0; i--) removePellet(i);
  counters.landings = 0;
  counters.fed = 0;
  slosh.tilt.set(0, 0);
  slosh.tiltV.set(0, 0);
  slosh.tiltTarget.set(0, 0);
  slosh.e.set(0, 0);
  slosh.eV.set(0, 0);
  slosh.wob = 0;
  slosh.wobV = 0;
  for (const p of palms) {
    p.bend.set(0, 0);
    p.bendV.set(0, 0);
    p.held = false;
  }
  plane.state = "docked";
  plane.splashed = false;
  plane.roll = 0;
  params.firmness = 50;
  params.damping = 30;
  params.tide = 0;
  for (const [key, s] of Object.entries(sliders)) {
    s.input.value = params[key];
    s.out.textContent = key === "tide" ? "0 cm" : `${params[key]}`;
  }
  applyLevel();
  setFlavour("turquoise");
  setPaused(false);
  initialRings();
  updateCounters();
}
$("btn-reset").addEventListener("click", resetAll);

const camAnim = { active: false, t: 0, fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3() };
$("btn-view").addEventListener("click", () => {
  camAnim.active = true;
  camAnim.t = 0;
  camAnim.fromPos.copy(camera.position);
  camAnim.fromTarget.copy(controls.target);
});

function initialRings() {
  spawnRing(1.1, 2.5, false);
  spawnRing(-0.6, 3.4, false);
}

/* ==========================================================================
   Resize & loop
   ========================================================================== */

function fitCameraToAspect() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  // pull back a little on narrow screens so the block stays in frame
  camera.fov = aspect < 1.4 ? 30 + (1.4 - aspect) * 26 : 30;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCameraToAspect();
});

applyLevel();
initialRings();
updateCounters();
updateWaterGeometry();

let last = performance.now();
let dropTimer = 0;

function frame(now) {
  const real = Math.min((now - last) / 1000, 0.05);
  last = now;
  const dt = params.paused ? 0 : real;

  if (camAnim.active) {
    camAnim.t = Math.min(1, camAnim.t + real / 0.9);
    const k = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.fromPos, DEFAULT_CAM, k);
    controls.target.lerpVectors(camAnim.fromTarget, DEFAULT_TARGET, k);
    if (camAnim.t >= 1) camAnim.active = false;
  }
  controls.update();

  if (dt > 0) {
    simTime += dt;
    stepSim();
    stepSim();
    rebalanceSim();
    dropTimer -= dt;
    if (dropTimer <= 0) {
      const [x, z] = randomOpenWater();
      disturb(x, z, -0.012, 0.15);
      dropTimer = 0.6 + rand() * 0.9;
    }
    updateSprings(dt, drag.mode === "side");
    updateWaterGeometry();
    updateFish(dt);
    updateRays(dt);
    updateFood(dt);
    updateRings(dt);
    updateHeldRing(dt);
    updatePlane(dt);
  } else {
    updateHeldRing(real);
  }

  pontoon.position.y = heightAt(-1.5, 0.34) + 0.03;
  sharedUniforms.uTime.value = simTime;
  rippleTex.offset.set(simTime * 0.006, simTime * 0.004);

  const progress =
    plane.state === "docked"
      ? 1
      : plane.state === "away"
        ? 1 - plane.awayT / AWAY_TIME
        : plane.state === "takeoff"
          ? 1 - plane.t * 0.15
          : plane.t;
  ui.progress.style.width = `${clamp(progress, 0, 1) * 100}%`;

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);

// expose a tiny handle for automated checks
window.__atoll = { plane, rings, counters, params, drag, slosh, camera };
