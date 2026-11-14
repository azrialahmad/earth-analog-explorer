const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Turns the model's [id] citations into display names, without saying a name twice
 * ("[mauna_kea] Mauna Kea", "Bromo [bromo]", "[bromo] - Bromo" all become the name once),
 * and drops markdown bold markers the panel does not render. Unknown ids are left as written.
 */
export function renderAnswer(text: string, names: Record<string, string>): string {
  let out = text.replace(/\*\*(.+?)\*\*/g, '$1')
  for (const [id, name] of Object.entries(names)) {
    const tag = `\\(?\\[${esc(id)}\\]\\)?`
    // "Bromo / Tengger, Indonesia" may be written as "Bromo / Tengger" or just "Bromo"
    const head = name.split(',')[0].trim()
    const short = [...new Set([head, head.split('/')[0].trim()])].map(esc).join('|')
    const place = `(?:${short})(?:,\\s*[A-Z][\\w'’ -]*?(?=[\\s.,;:)\\]]|$))?`
    // name written before the tag: keep the name, drop the tag
    out = out.replace(new RegExp(`(${place})\\s*${tag}`, 'g'), '$1')
    // tag followed by the name (optionally after a dash, colon or bracket): one full name
    out = out.replace(new RegExp(`${tag}\\s*(?:[-–—:]\\s*|\\(\\s*)?${place}\\)?`, 'g'), name)
    // a bare tag
    out = out.replace(new RegExp(tag, 'g'), name)
  }
  return out
}
