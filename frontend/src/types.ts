export type ParamKey = 'slope_mean_deg' | 'slope_p90_deg' | 'roughness_m'
export const PARAM_KEYS: ParamKey[] = ['slope_mean_deg', 'slope_p90_deg', 'roughness_m']
export type WindowKey = '3' | '6' | '12'
export const WINDOW_KEYS: WindowKey[] = ['3', '6', '12']
export type Tier = 'computed' | 'cited' | 'estimated' | 'missing' | 'by definition'

export interface Value { value: number | null; tier: Tier; source: string | null; res_m?: number }
export type Weights = Record<ParamKey, number>

export interface Config {
  main_window_km: number
  window_sizes_km: number[]
  params: Record<ParamKey, { label: string; unit: string; weight: number; range: number }>
  warning: { terrain_match_min: number; low_sun_share_max: number }
  stability: { runs: number; top_n: number; seed: number; dirichlet_concentration: number; noise_rel: number }
  provisional: boolean
  _fixture?: boolean           // true only in the hand-written development fixture
}

export interface Target {
  id: string; name: string; lat: number; lon: number; note: string
  body: 'moon' | 'mars'          // Mars: added Nov 14
  params: Record<ParamKey, Value>
  windows: Record<WindowKey, Record<ParamKey, number | null>>
  low_sun_share: Value | null  // null = not applicable (Mars)
  hillshade: string            // path under public/
  relief: string | null        // path under public/ to a ReliefGrid; null = no elevation, app shows labelled generated terrain
}

export interface DepthEvidence { dataset: string; model: string; delta1: number; tier: Tier; source: string }

export interface Site {
  id: string; name: string; lat: number; lon: number; why: string
  elev_m: number | null
  params: Record<ParamKey, Value>
  windows: Record<WindowKey, Record<ParamKey, number | null>>
  conditions: { low_sun_share: Value; bare_ground_share: Value }
  depth_evidence: DepthEvidence[]
  known_analog: boolean
  flags: string[]
  hillshade: string
  relief: string | null        // see Target.relief
}

// public/data/relief/<id>.json: row-major from the north-west corner, size × size values, null = nodata
export interface ReliefGrid { id: string; size: number; cell_m: number; elev_m: (number | null)[] }

export interface Evidence {
  cited: { source_id: string; source: string; model: string; metric: string
           rows: { dataset: string; kind: string; delta1: number; site_id: string | null }[] }
  ours:  { source_id: string; source: string; model: string; metric_note: string
           rows: { set: string; n: number; delta1: number; plane_delta1: number
                   relief_skill_median: number; share_beating_plane: number
                   relief_skill_shadow: number; relief_skill_lit: number }[]
           images: { src: string; caption: string }[] }
  not_shown: string[]
  sky_caveat: string
}

export interface AppData { config: Config; targets: Target[]; sites: Site[]; evidence: Evidence }

// engine output
export interface ParamScore { key: ParamKey; site: number | null; target: number | null
                              similarity: number | null; weight: number }
export interface SiteScore {
  siteId: string
  terrainMatch: number | null
  perParam: ParamScore[]
  completeness: number
  missing: ParamKey[]
  lowSunShare: number | null
  warning: { fired: boolean; text: string | null }
  windowSensitivity: Record<WindowKey, number | null>
}
export interface RankedSite extends SiteScore { rank: number; site: Site }
export type Stability = Record<string, number>
