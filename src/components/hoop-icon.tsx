// A small rim and net, drawn like the big hoop, sized to sit inline with text.
function netPath(w: number, h: number, cols = 6, rows = 4) {
  const pt = (r: number, c: number) => {
    const t = r / rows
    const ww = w * (0.96 - 0.4 * t)
    return [(w - ww) / 2 + (ww * c) / cols, h * t]
  }
  const segs: string[] = []
  for (const dir of [1, -1]) {
    for (let i = -cols; i <= cols * 2; i++) {
      let d = ''
      for (let r = 0; r <= rows; r++) {
        const c = i + (dir * r) / 2
        if (c < 0 || c > cols) {
          if (d) break
          continue
        }
        const [x, y] = pt(r, c)
        d += `${d ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`
      }
      if (d.includes('L')) segs.push(d)
    }
  }
  return segs.join('')
}

const NET = netPath(36, 30)

export function HoopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 42" fill="none" aria-hidden className={className}>
      <g transform="translate(2 9)">
        <path d={NET} strokeWidth={1.6} strokeLinecap="round" className="stroke-zinc-400 dark:stroke-zinc-500" />
      </g>
      <rect x={16.5} y={2} width={7} height={4} rx={1} className="fill-blue-600" />
      <ellipse cx={20} cy={9} rx={18} ry={3.6} strokeWidth={3.2} className="stroke-blue-600" />
    </svg>
  )
}
