import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const stylesheet = fileURLToPath(new URL('./preview.css', import.meta.url))

function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error(`Header preview no longer matches the app: ${before}`)
  }
  return source.replace(before, after)
}

/** Dev-only presentation changes. Never writes to the app's source files. */
export function transformHeaderModule(source, id) {
  const path = id.split('?')[0]
  if (path.endsWith('/src/components/TopBar.tsx')) {
    let next = replaceOnce(source,
      '      <nav className="targets glass" aria-label="Target">',
      '      <div className="header-center">\n        <div id="header-view-controls" className="header-view-controls" role="group" aria-label="Terrain view controls" />\n\n        <nav className="targets glass" aria-label="Target">',
    )
    next = replaceOnce(next,
      '      </nav>\n\n      <div className="tools">',
      '        </nav>\n      </div>\n\n      <div className="tools">',
    )
    for (const [panel, label] of [['weights', 'Weights'], ['data', 'Data'], ['evidence', 'Evidence'], ['ask', 'Ask AI']]) {
      const panelId = panel === 'data' ? 'data-drawer' : `${panel}-panel`
      next = replaceOnce(next, `aria-controls="${panelId}"`, `aria-controls="${panelId}" title="${label}"`)
    }
    return replaceOnce(next, 'onClick={onPlayDemo}', 'onClick={onPlayDemo} title="Play demo"')
  }
  if (path.endsWith('/src/components/TerrainViews.tsx')) {
    let next = `import { createPortal } from 'react-dom'\n${source}`
    next = replaceOnce(next,
      '  const [ctrl, setCtrl] = useState<SplitRenderer | null>(null)',
      `  // The preview moves the actual React controls, preserving renderer state and handlers.
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setControlsHost(document.getElementById('header-view-controls')) }, [])
  const [ctrl, setCtrl] = useState<SplitRenderer | null>(null)`,
    )
    next = replaceOnce(next, '      <div className="views-tools">', '      {controlsHost && createPortal(<div className="views-tools">')
    next = replaceOnce(next,
      '      </div>\n\n      <div className={`views ${layout}`}',
      '      </div>, controlsHost)}\n\n      <div className={`views ${layout}`}',
    )
    // Keep the toggle name and width stable; aria-pressed continues to expose state.
    return replaceOnce(next, "{rotating ? 'Stop rotating' : 'Rotate'}", 'Rotate')
  }
  return null
}

export function headerPreviewPlugin() {
  return {
    name: 'local-header-layout-preview',
    enforce: 'pre',
    apply: 'serve',
    transform: transformHeaderModule,
    transformIndexHtml() {
      return [{ tag: 'style', attrs: { 'data-local-header-preview': '' }, children: readFileSync(stylesheet, 'utf8'), injectTo: 'head' }]
    },
  }
}
