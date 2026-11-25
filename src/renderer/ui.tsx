/* eslint-disable @typescript-eslint/no-explicit-any */
// Thin wrappers over vIDE's shared components (vide.ui.components), resolved
// at render time because `vide` only exists after activate().
import type { ReactNode } from 'react'
import { getVide } from './vide'

const c = () => getVide().ui.components

// Anything portalled to document.body leaves the app's `.vapp-universe` tree,
// so its content is re-wrapped in the scope class (display: contents keeps
// layout untouched).
export function Scope({ children }: { children?: ReactNode }) {
  return <div className={getVide().ui.scopeClass} style={{ display: 'contents' }}>{children}</div>
}

export function Modal({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  const M = c().Modal
  return <M onClose={onClose}><Scope>{children}</Scope></M>
}

export function Switch(props: Record<string, any>) {
  const S = c().Switch
  return <S {...props} />
}

export function Select(props: Record<string, any>) {
  const S = c().Select
  return <S {...props} />
}

export function FeatureBlock(props: Record<string, any>) {
  const F = c().FeatureBlock
  return <F {...props} />
}

export function SettingRow(props: Record<string, any>) {
  const R = c().SettingRow
  return <R {...props} />
}

export function PreviewFrame(props: Record<string, any>) {
  const P = c().PreviewFrame
  return <P {...props} />
}

export function clampToViewport(x: number, y: number, width: number, height: number, margin?: number) {
  return c().clampToViewport(x, y, width, height, margin)
}

export function useCoverNativeViews(active?: boolean): void {
  c().useCoverNativeViews(active)
}
