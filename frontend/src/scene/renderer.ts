// One WebGL renderer, two scenes (target | site), one shared camera, split with a scissor.
// Loaded on demand by SplitScene so three.js stays out of the first paint.
import * as THREE from 'three'
import { GRID, SPAN } from './terrain'

export type Side = 'left' | 'right'
/** polar: sun ~2° up, no sky light, black sky. mars: dusty day. earth: Earth day with blue sky fill. */
export type LightPreset = 'polar' | 'mars' | 'earth'

// Display settings only (how the scene looks), not analysis parameters.
const LIGHTS: Record<LightPreset, { el: number; hemi: number; bg: number; stars: number; sun: number; sunI: number; fogNear: number }> = {
  polar: { el: 2, hemi: 0.2, bg: 0x030407, stars: 0.9, sun: 0xffffff, sunI: 3.2, fogNear: 900 },
  mars: { el: 28, hemi: 0.45, bg: 0xb98c68, stars: 0, sun: 0xfff0dd, sunI: 1.7, fogNear: 300 },
  earth: { el: 42, hemi: 0.42, bg: 0x8fb2d8, stars: 0, sun: 0xffffff, sunI: 1.7, fogNear: 300 },
}
const SUN_AZIMUTH = 2.35
const MORPH_MS = 900
const N = GRID - 1

export interface SplitRenderer {
  setTerrain(side: Side, heights: Float32Array, tone: number, instant: boolean): void
  setLight(side: Side, preset: LightPreset, instant: boolean): void
  setSplit(fraction: number): void
  setAutoRotate(on: boolean): void
  orbit(dAzimuth: number, dElevation: number): void
  zoom(factor: number): void
  dispose(): void
}

interface World {
  scene: THREE.Scene
  geo: THREE.PlaneGeometry
  skirt: THREE.BufferGeometry
  edge: [number, number][]
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  stars: THREE.Points
  starMat: THREE.PointsMaterial
  tone: THREE.Color
  cur: Float32Array | null
  from: Float32Array | null
  to: Float32Array | null
  t0: number
  el: number; elTo: number
  hemiI: number; hemiTo: number
  starO: number; starTo: number
  bg: THREE.Color; bgTo: THREE.Color
  disposables: { dispose(): void }[]
}

function makeWorld(): World {
  const scene = new THREE.Scene()
  const geo = new THREE.PlaneGeometry(SPAN, SPAN, N, N)
  geo.rotateX(-Math.PI / 2) // row 0 of the grid (north) ends up at -z
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GRID * GRID * 3), 3))
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = mesh.receiveShadow = true
  scene.add(mesh)

  // Skirt: dark sides so the tile reads as a cut-out block of ground.
  const edge: [number, number][] = []
  for (let k = 0; k <= N; k++) edge.push([k, 0])
  for (let k = 1; k <= N; k++) edge.push([N, k])
  for (let k = N - 1; k >= 0; k--) edge.push([k, N])
  for (let k = N - 1; k >= 0; k--) edge.push([0, k])
  const skirt = new THREE.BufferGeometry()
  skirt.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edge.length * 6), 3))
  const idx: number[] = []
  for (let k = 0; k < edge.length - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  skirt.setIndex(idx)
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 1, side: THREE.DoubleSide })
  const skirtMesh = new THREE.Mesh(skirt, skirtMat)
  skirtMesh.receiveShadow = true
  scene.add(skirtMesh)

  const sun = new THREE.DirectionalLight(0xffffff, 3.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 600 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.6
  scene.add(sun, sun.target)
  const hemi = new THREE.HemisphereLight(0xbcd4f2, 0x5a4a3c, 0.6)
  scene.add(hemi)

  const starGeo = new THREE.BufferGeometry()
  const pts = new Float32Array(4500 * 3)
  let s = 5
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < 4500; i++) {
    const u = rand() * 2 - 1, t = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u)
    pts.set([900 * r * Math.cos(t), Math.abs(900 * u) + 40, 900 * r * Math.sin(t)], i * 3)
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
  const starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, fog: false })
  const stars = new THREE.Points(starGeo, starMat)
  scene.add(stars)

  const bg = new THREE.Color(0)
  scene.background = bg
  scene.fog = new THREE.Fog(0, 300, 800)
  return {
    scene, geo, skirt, edge, sun, hemi, stars, starMat, tone: new THREE.Color(0x888888),
    cur: null, from: null, to: null, t0: 0,
    el: 20, elTo: 20, hemiI: 0.4, hemiTo: 0.4, starO: 0, starTo: 0, bg, bgTo: new THREE.Color(0),
    disposables: [geo, mat, skirt, skirtMat, starGeo, starMat],
  }
}

function applyHeights(w: World, h: Float32Array) {
  const pos = w.geo.attributes.position as THREE.BufferAttribute
  const col = w.geo.attributes.color as THREE.BufferAttribute
  let mn = Infinity, mx = -Infinity
  for (const v of h) { if (v < mn) mn = v; if (v > mx) mx = v }
  for (let i = 0; i < h.length; i++) {
    pos.setY(i, h[i])
    const k = 0.82 + 0.3 * (h[i] - mn) / (mx - mn + 1e-6)
    col.setXYZ(i, w.tone.r * k, w.tone.g * k, w.tone.b * k)
  }
  w.geo.computeVertexNormals()
  const nm = w.geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < h.length; i++) {
    const s = 0.62 + 0.38 * Math.pow(nm.getY(i), 3)
    col.setXYZ(i, col.getX(i) * s, col.getY(i) * s, col.getZ(i) * s)
  }
  pos.needsUpdate = col.needsUpdate = true
  w.geo.computeBoundingSphere()

  const sp = w.skirt.attributes.position as THREE.BufferAttribute
  const floor = Math.min(-22, mn - 8)
  w.edge.forEach(([i, j], k) => {
    const x = (i / N - 0.5) * SPAN, z = (j / N - 0.5) * SPAN
    sp.setXYZ(k * 2, x, h[j * GRID + i], z)
    sp.setXYZ(k * 2 + 1, x, floor, z)
  })
  sp.needsUpdate = true
  w.skirt.computeVertexNormals()
  w.skirt.computeBoundingSphere()
}

/** Throws when WebGL is unavailable; the caller shows a fallback. */
export function createSplitRenderer(canvas: HTMLCanvasElement, reducedMotion: () => boolean): SplitRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(2, devicePixelRatio))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const cam = new THREE.PerspectiveCamera(38, 1, 1, 2000)
  const worlds: Record<Side, World> = { left: makeWorld(), right: makeWorld() }
  let az = 0.75, elev = 0.7, radius = 285, auto = false, split = 0.5
  let last = performance.now(), frame = 0

  const placeSun = (w: World) => {
    const e = (w.el * Math.PI) / 180, d = 320
    w.sun.position.set(Math.cos(e) * Math.sin(SUN_AZIMUTH) * d, Math.sin(e) * d, Math.cos(e) * Math.cos(SUN_AZIMUTH) * d)
    w.sun.target.position.set(0, 0, 0)
  }

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const W = canvas.clientWidth, H = canvas.clientHeight
    if (W === 0 || H === 0) return
    const pr = renderer.getPixelRatio()
    if (canvas.width !== Math.floor(W * pr) || canvas.height !== Math.floor(H * pr)) {
      renderer.setSize(W, H, false)
      cam.aspect = W / H
      cam.updateProjectionMatrix()
    }
    if (auto && !reducedMotion()) az += dt * 0.05
    const r = radius * (W < 700 ? 1.35 : 1)
    cam.position.set(Math.sin(az) * Math.cos(elev) * r, Math.sin(elev) * r, Math.cos(az) * Math.cos(elev) * r)
    cam.lookAt(0, -24, 0)

    for (const w of [worlds.left, worlds.right]) {
      if (w.from && w.to) {
        const k = Math.min(1, (now - w.t0) / MORPH_MS)
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        const from = w.from, to = w.to
        w.cur = from.map((v, i) => v + (to[i] - v) * e)
        applyHeights(w, w.cur)
        if (k >= 1) { w.cur = to; w.from = w.to = null }
      }
      const a = 1 - Math.pow(0.02, dt)
      w.el += (w.elTo - w.el) * a
      w.hemiI += (w.hemiTo - w.hemiI) * a
      w.starO += (w.starTo - w.starO) * a
      w.bg.lerp(w.bgTo, a)
      w.hemi.intensity = w.hemiI
      w.starMat.opacity = w.starO
      w.stars.visible = w.starO > 0.02
      ;(w.scene.fog as THREE.Fog).color.copy(w.bg)
      placeSun(w)
    }

    const sx = Math.round(W * split)
    renderer.setScissorTest(true)
    renderer.setViewport(0, 0, W, H)
    renderer.setScissor(0, 0, sx, H)
    renderer.render(worlds.left.scene, cam)
    renderer.setScissor(sx, 0, W - sx, H)
    renderer.render(worlds.right.scene, cam)
  }
  frame = requestAnimationFrame(tick)

  return {
    setTerrain(side, heights, tone, instant) {
      const w = worlds[side]
      w.tone.setHex(tone)
      if (!w.cur || instant || reducedMotion()) { w.cur = heights.slice(); w.from = w.to = null; applyHeights(w, w.cur) }
      else { w.from = w.cur.slice(); w.to = heights; w.t0 = performance.now() }
    },
    setLight(side, preset, instant) {
      const w = worlds[side], p = LIGHTS[preset]
      w.elTo = p.el; w.hemiTo = p.hemi; w.starTo = p.stars; w.bgTo.setHex(p.bg)
      w.sun.color.setHex(p.sun); w.sun.intensity = p.sunI
      const fog = w.scene.fog as THREE.Fog
      fog.near = p.fogNear; fog.far = p.fogNear + 500
      if (instant || reducedMotion()) { w.el = p.el; w.hemiI = p.hemi; w.starO = p.stars; w.bg.copy(w.bgTo) }
    },
    setSplit(f) { split = f },
    setAutoRotate(on) { auto = on },
    orbit(dAz, dEl) { az += dAz; elev = Math.max(0.12, Math.min(1.25, elev + dEl)) },
    zoom(f) { radius = Math.max(120, Math.min(380, radius * f)) },
    dispose() {
      cancelAnimationFrame(frame)
      for (const w of [worlds.left, worlds.right]) for (const d of w.disposables) d.dispose()
      renderer.dispose()
    },
  }
}
