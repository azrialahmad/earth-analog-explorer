import { useState } from 'react'
import { asset } from '../ui'
import './Hillshade.css'

/** A hillshade image with its data source, or a plain note when the image does not exist yet. */
export default function Hillshade({ path, title, source }: { path: string; title: string; source: string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  const ok = path !== '' && failed !== path
  return (
    <figure className="hill">
      {ok
        ? <img src={asset(path)} alt={`Hillshade of ${title}`} loading="lazy" onError={() => setFailed(path)} />
        : <div className="hill-empty">No hillshade image yet</div>}
      <figcaption><b>{title}</b> · {source ?? <span className="missing-text">source missing</span>}</figcaption>
    </figure>
  )
}
