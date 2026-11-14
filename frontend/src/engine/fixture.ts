// Test helpers for the engine. Not imported by the app.
// The config is the app's own config.json (generated from config/weights.yaml), so tests
// never repeat a weight, range or threshold: they read it from there.
import type { Config, ParamKey, Site, Target, Value, WindowKey } from '../types'
import configJson from '../../public/data/config.json'

export const config = configJson as Config

type Triple = [number | null, number | null, number | null]

export const val = (value: number | null): Value =>
  ({ value, tier: value === null ? 'missing' : 'estimated', source: value === null ? null : 'test' })

const params = ([a, b, c]: Triple): Record<ParamKey, Value> =>
  ({ slope_mean_deg: val(a), slope_p90_deg: val(b), roughness_m: val(c) })

const plain = ([a, b, c]: Triple) => ({ slope_mean_deg: a, slope_p90_deg: b, roughness_m: c })

const windows = (p: Triple): Record<WindowKey, Record<ParamKey, number | null>> =>
  ({ '3': plain(p), '6': plain(p), '12': plain(p) })

export function makeTarget(p: Triple, body: Target['body'] = 'moon'): Target {
  return {
    id: `target-${body}`, name: 'Test target', lat: 0, lon: 0, note: '', body,
    params: params(p), windows: windows(p),
    low_sun_share: body === 'moon' ? { value: 1, tier: 'by definition', source: null } : null,
    hillshade: '', relief: null,
  }
}

export function makeSite(id: string, p: Triple, lowSun: number | null = 0.5, win?: Partial<Record<WindowKey, Triple>>): Site {
  const w = windows(p)
  for (const [k, t] of Object.entries(win ?? {})) w[k as WindowKey] = plain(t as Triple)
  return {
    id, name: id, lat: 0, lon: 0, why: '', elev_m: null,
    params: params(p), windows: w,
    conditions: { low_sun_share: val(lowSun), bare_ground_share: val(null) },
    depth_evidence: [], known_analog: false, flags: [], hillshade: '', relief: null,
  }
}
