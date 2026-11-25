export function UniverseIcon({ className }: { className?: string } = {}) {
  return (
    <svg className={className} width="1.25rem" height="1.25rem" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="10" ry="3.2" stroke="currentColor" strokeWidth="1.5" transform="rotate(-25 12 12)" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function RefreshIcon({ className }: { className?: string } = {}) {
  return (
    <svg className={className} width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ButtonIcon({ d }: { d: string }) {
  return (
    <svg width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export const TRASH_ICON = 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3'
export const EXPORT_ICON = 'M12 3v12M7 10l5 5 5-5M5 21h14'
export const LAUNCH_ICON = 'M7 4l13 8-13 8z'
