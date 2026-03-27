import type { ReactNode } from 'react'

type PillProps = {
  children: ReactNode
  className?: string
}

export function Pill({ children, className = '' }: PillProps) {
  return (
    <div className={`pill ${className}`.trim()}>
      <span className="pill-text">{children}</span>
    </div>
  )
}
