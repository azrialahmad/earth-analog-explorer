/** Replace exactly one source anchor, failing closed when the app structure drifts. */
export function replaceOnce(source, before, after, label = String(before)) {
  let count
  let replacement = before
  if (typeof before === 'string') {
    count = source.split(before).length - 1
  } else {
    const flags = before.flags.includes('g') ? before.flags : `${before.flags}g`
    count = [...source.matchAll(new RegExp(before.source, flags))].length
    replacement = new RegExp(before.source, before.flags.replace('g', ''))
  }
  if (count !== 1) throw new Error(`Mockup no longer matches the app (expected one ${label}, found ${count})`)
  return source.replace(replacement, after)
}
