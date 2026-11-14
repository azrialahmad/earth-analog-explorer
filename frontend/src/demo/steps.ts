// The guided demo, built from the loaded data and the engine. Every number in a caption
// comes from rankSites or config at the moment the tour starts: nothing is hard-coded.
import type { AppData, ParamKey, RankedSite, Target, Weights } from '../types'
import { defaultWeights, rankSites } from '../engine'
import { fmt, pct } from '../ui'

export interface DemoActions {
  pickTarget: (id: string) => void
  selectSite: (id: string | null) => void
  setRelit: (on: boolean) => void
  setWeights: (w: Weights) => void
  resetWeights: () => void
}

export interface DemoStep {
  /** How long the step stays on screen. */
  ms: number
  caption: string
  apply: (a: DemoActions) => void
}

/** The weight the tour raises, and the value it raises it to (the top of the weights slider). */
const DEMO_PARAM: ParamKey = 'roughness_m'
const DEMO_WEIGHT = 3

// semicolons, because site names contain commas ("Etna, Italy")
const names = (r: RankedSite[]) => r.slice(0, 3).map(x => x.site.name).join('; ')

export function buildDemoSteps(data: AppData): DemoStep[] {
  const { config, targets, sites } = data
  const w0 = defaultWeights(config)
  const rank = (t: Target, w: Weights = w0) => rankSites(sites, t, config, w)
  const steps: DemoStep[] = []

  const moons = targets.filter(t => t.body === 'moon')
  const mars = targets.find(t => t.body === 'mars')
  const first = moons[0]
  if (!first) return steps

  // 1. The first Moon target and its best match.
  const r1 = rank(first)
  const top = r1[0]
  steps.push({
    ms: 10000,
    caption: top?.terrainMatch != null
      ? `${first.name}: ${sites.length} Earth sites ranked by how closely their ground matches. Best match: ${top.site.name}, Terrain Match ${fmt(top.terrainMatch)}.`
      : `${first.name}: no Earth site can be scored against it yet.`,
    apply: a => { a.resetWeights(); a.setRelit(false); a.pickTarget(first.id); a.selectSite(top?.site.id ?? null) },
  })

  // 2. The first Moon target (in order) that has a flagged site, and its best flagged site.
  let flagTarget: Target | null = null
  let flagged: RankedSite | null = null
  for (const t of moons) {
    const f = rank(t).find(r => r.warning.fired)
    if (f) { flagTarget = t; flagged = f; break }
  }
  const { terrain_match_min: tmMin, low_sun_share_max: sunMax } = config.warning

  if (flagTarget && flagged && flagTarget.id !== first.id) {
    steps.push({
      ms: 12000,
      caption: `No site at ${first.name} trips the light warning: none has both a Terrain Match of at least ${fmt(tmMin)} and a low sun for under ${pct(sunMax)} of daylight.`,
      apply: () => {},
    })
  }
  if (flagTarget && flagged) {
    const ft = flagTarget, f = flagged
    steps.push({
      ms: 12000,
      caption: `${ft.id === first.id ? '' : `At ${ft.name}, `}${f.site.name} matches the ground at ${fmt(f.terrainMatch)}, but the sun is under 10° for only ${pct(f.lowSunShare)} of daylight there. The ground matches; the light doesn't.`,
      apply: a => { a.pickTarget(ft.id); a.selectSite(f.site.id) },
    })
    steps.push({
      ms: 11000,
      caption: `Light it like the pole: the same ${f.site.name} ground under a low polar sun with no sky. The shadows go black, as they would at ${ft.name}.`,
      apply: a => a.setRelit(true),
    })

    // 3. Move one weight and report what the engine does with it.
    const w1: Weights = { ...w0, [DEMO_PARAM]: DEMO_WEIGHT }
    const before = rank(ft), after = rank(ft, w1)
    const same = before.slice(0, 3).every((r, i) => r.site.id === after[i]?.site.id)
    const label = config.params[DEMO_PARAM].label
    steps.push({
      ms: 13000,
      caption: `Weights are a judgement call. Raise ${label} from ${fmt(w0[DEMO_PARAM], 1)} to ${fmt(DEMO_WEIGHT, 1)}: ` +
        (same ? `the top three holds (${names(after)}).` : `the top three becomes ${names(after)}.`),
      apply: a => { a.setRelit(false); a.setWeights(w1); a.selectSite(after[0]?.site.id ?? null) },
    })
  } else {
    steps.push({
      ms: 10000,
      caption: 'No site trips the light warning with the current data.',
      apply: () => {},
    })
  }

  // 4. Mars: terrain only.
  if (mars) {
    const rm = rank(mars)
    const best = rm[0]
    steps.push({
      ms: 11000,
      caption: best?.terrainMatch != null
        ? `Mars: ${mars.name}. Terrain ranks the same way (best: ${best.site.name}, ${fmt(best.terrainMatch)}); the lighting axis and the warning switch off.`
        : `Mars: ${mars.name}. The lighting axis and the warning switch off here. Its terrain values are not computed yet, so no site is scored.`,
      apply: a => { a.setRelit(false); a.resetWeights(); a.pickTarget(mars.id); a.selectSite(best?.site.id ?? null) },
    })
  }

  steps.push({
    ms: 6000,
    caption: 'That is the demo. Everything here is live: pick a target, open a site, or change the weights yourself.',
    apply: () => {},
  })
  return steps
}
