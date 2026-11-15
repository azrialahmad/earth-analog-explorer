import type { WhyKind } from '../explain/card'

/**
 * A site's supplied `why` text. For a scan candidate it is the scan's record of how the site was
 * picked: its numbers come from that run (another target or weights, the scan's own reading), so it
 * is labelled as history and never read as an explanation of the current score (issue #62).
 */
export default function WhyText({ why, kind, targetName, className }: { why: string; kind: WhyKind; targetName: string; className?: string }) {
  if (kind === 'description') return <p className={className}>{why}</p>
  return (
    <div className={`why-history${className ? ` ${className}` : ''}`}>
      <p className="label">Scan selection history</p>
      <p>{why}</p>
      <p className="note">
        Recorded when the scan picked this site. Any score in it is from that scan run, for the target named there,
        and is not the current Terrain Match for {targetName}, which comes from the live ranking.
      </p>
    </div>
  )
}
