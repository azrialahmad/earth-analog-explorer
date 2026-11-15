import { readFileSync } from 'node:fs'
import { transformHeaderModule } from '../header-layout/preview-plugin.mjs'
import { replaceOnce } from '../replace-once.mjs'

/** Image/design preview only. Uses the app's real ranking and controls, without source edits. */
export function transformStudioModule(source, id) {
  source = source.replace(/\r\n/g, '\n')
  let next = transformHeaderModule(source, id) ?? source
  const path = id.split('?')[0]
  if (path.endsWith('/src/components/TopBar.tsx')) {
    for (const panel of ['weights', 'data', 'evidence', 'ask']) {
      const button = new RegExp(`        <button[^\\n]*aria-expanded=\\{panel === '${panel}'\\}[^\\n]*>[\\s\\S]*?        </button>\\n`)
      if (!button.test(next)) throw new Error(`Could not find ${panel} toolbar button`)
      next = next.replace(button, '')
    }
    return replaceOnce(next, '<span className="tool-label">Play demo</span>', '<span className="tool-label">Demo</span>')
  }
  if (path.endsWith('/src/App.tsx')) {
    const weights = next.match(/        <WeightsPanel\n[\s\S]*?\n        \/>/)?.[0]
    const ask = next.match(/        \{askRun && <AskPanel\n[\s\S]*?\n        \/>}/)?.[0]
    if (!weights || !ask) throw new Error('Could not find the existing weights and assistant panels')
    next = next.replace(weights, '').replace(ask, '')
    const alwaysOpenAsk = ask.replace('{askRun && ', '').replace(/}$/, '').replace("open={panel === 'ask'}", 'open={true}')
    next = replaceOnce(next, 'className="pane pane-view"', 'className="pane pane-view studio-center"')
    next = replaceOnce(next, '          <TerrainViews\n', '          <div className="studio-visual">\n          <TerrainViews\n')
    next = replaceOnce(next,
      '            mainWindowKm={data.config.main_window_km}\n          />\n          {demo && (',
      `            mainWindowKm={data.config.main_window_km}\n          />\n          </div>\n${weights.replace("open={panel === 'weights'}", 'open={true}')}\n${alwaysOpenAsk}\n          {demo && (`,
    )
    return next
  }
  if (path.endsWith('/src/components/TerrainViews.tsx')) {
    const footnote = next.match(/      <p className="views-foot">[\s\S]*?      <\/p>/)?.[0]
    if (!footnote) throw new Error('Could not find the terrain display caveat')
    next = replaceOnce(next, footnote, '')
    // Keep the app's responsive auto-layout and expose the renderer's existing row/column choice.
    return replaceOnce(next,
      '        </div>\n      </div>\n\n\n',
      `        </div>\n        <div className="studio-view-toolbar" role="group" aria-label="Terrain view arrangement">\n          <details className="studio-view-info">\n            <summary>View info</summary>\n${footnote}\n          </details>\n          <button type="button" aria-pressed={layout === 'row'} onClick={() => setLayout('row')}>Side by side</button>\n          <button type="button" aria-pressed={layout === 'column'} onClick={() => setLayout('column')}>Stacked</button>\n        </div>\n      </div>\n\n`,
    )
  }
  if (path.endsWith('/src/chat/transport.ts')) {
    // Keep the live assistant UI but make the preview categorically offline.
    return replaceOnce(next, /export async function post\([\s\S]*?\n}\n/, `export async function post(_url: string, _request: AskRequest, _signal: AbortSignal): Promise<unknown> {\n  throw new AskError('Layout preview only — no AI request was sent.')\n}\n`, 'assistant transport')
  }
  if (path.endsWith('/src/chat/AskPanel.tsx')) {
    // Preview the requested continuous transcript without changing the production
    // request/session guards. Context changes still cancel stale requests.
    next = replaceOnce(next,
      /  useLayoutEffect\(\(\) => \{\n    const \{ targetChanged, interrupted \} = session.update\(live\)[\s\S]*?\n  }, \[live, session\]\)/,
      `  useLayoutEffect(() => {
    const { interrupted } = session.update(live)
    if (interrupted) {
      setLines(ls => [...ls, { kind: 'note', text: 'Pending question interrupted because the analysis changed. Conversation kept; your next message uses the current target and weights.' }])
      setBusy(false)
    }
  }, [live, session])`,
      'conversation lifecycle',
    )
    next = replaceOnce(next,
      "{ kind: 'note' as const, text: 'Analysis changed. This question uses the weights below; earlier turns keep their original context.' }",
      "{ kind: 'note' as const, text: `Analysis changed. This question uses ${captured.run.target.name} and the weights below; earlier messages keep their original context.`, snapshot: captured }",
      'context boundary note',
    )
    const context = next.match(/      <section className="ask-context-next"[\s\S]*?      <\/section>/)?.[0]
    if (!context) throw new Error('Could not find the next-message context')
    next = replaceOnce(next, context, '', 'next-message context')
    next = replaceOnce(next,
      '<div><span className="label">About {run.target.name}</span><h2>Ask AI</h2></div>',
      `<div className="studio-assistant-heading"><h2>Analysis assistant</h2></div>\n${context}`,
      'assistant heading',
    )
    next = replaceOnce(next,
      '<p className="ask-scope">Answers use the analysis data sent with your question, across the whole ranking—not the selected card. It cannot change a score; it can request new weights for the engine.</p>',
      '<p id="studio-chat-scope" className="ask-scope">New messages use the current target and weights; earlier messages keep their original context. Scores come from the ranking engine.</p>',
      'chat scope description',
    )
    next = replaceOnce(next, /const EXAMPLES = \[[\s\S]*?\n\]/, '', 'EXAMPLES anchor')
    next = replaceOnce(next, /      \{lines.length === 0 && <div className="ask-examples">[\s\S]*?<\/div>\}\n/, '', 'chat example buttons')
    next = replaceOnce(next, '<ol ref={listRef} className="ask-lines" aria-label="Conversation" tabIndex={lines.length ? 0 : -1} aria-live="polite" aria-relevant="additions">', '<ol ref={listRef} className="ask-lines" aria-label="Conversation" tabIndex={lines.length ? 0 : -1} aria-live="polite" aria-relevant="additions">\n        {lines.length === 0 && <li className="studio-chat-empty">What would you like to explore?</li>}', 'chat transcript list')
    return replaceOnce(next, /      <form className="ask-form"[\s\S]*?      <\/form>/,
      `      <form className="ask-form" aria-label="Analysis message" onSubmit={e => { e.preventDefault(); void ask(text) }}>
        <label htmlFor="ask-input" className="label">Message</label>
        <div className="studio-composer">
          <textarea id="ask-input" name="message" rows={1} value={text} aria-label="Message" aria-describedby="studio-chat-scope" onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            placeholder="Ask about the analysis…" />
          <button type="submit" className="btn primary studio-send" aria-label="Send message" title="Send message" disabled={busy || !text.trim()}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
          </button>
        </div>
      </form>`,
    )
  }
  return next === source ? null : next
}

export function studioPreviewPlugin() {
  return {
    name: 'studio-layout-image-mockup',
    enforce: 'pre',
    apply: 'serve',
    transform: transformStudioModule,
    transformIndexHtml() {
      const css = ['../header-layout/preview.css', './preview.css'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
      return [{ tag: 'style', attrs: { 'data-studio-layout-mockup': '' }, children: css, injectTo: 'head' }]
    },
  }
}
