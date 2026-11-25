import { setVide } from './vide'
import type { VideRendererApi } from '../vide'

export function activate(vide: VideRendererApi): void {
  setVide(vide)
}

export function deactivate(): void {
  setVide(null)
}
