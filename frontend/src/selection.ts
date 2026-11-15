import type { RankedSite } from './types'

/**
 * The one selected entry shared by the site list, details, data drawer and Earth terrain view.
 * The chosen site while it is in the current ranking, otherwise the top-ranked entry, otherwise
 * nothing (an empty ranking), so no pane can keep showing a site that is no longer listed.
 */
export function selectedEntry(ranked: RankedSite[], siteId: string | null): RankedSite | null {
  return ranked.find(r => r.site.id === siteId) ?? ranked[0] ?? null
}
