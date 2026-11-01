import type { CostumeItem, PortraitItem, PoseItem, SlotKey } from './types'

/** Items hosted AI chats will usually refuse (adult-oriented series). Shared by the extension and the mobile app. */
export function isAdult(tab: SlotKey, it: PortraitItem | CostumeItem | PoseItem | null): boolean {
  if (!it) return false
  if (tab === 'pose') return /sexy|intertwined/i.test((it as PoseItem).体系)
  if (tab === 'costume') return /sexy|lingerie/i.test((it as CostumeItem).分类)
  return false
}

export const ADULT_NOTICE =
  'Gemini, ChatGPT and most hosted AI chats do not allow adult (18+) content. Items marked 18+ (Sexy, Lingerie, Intertwined) will usually be refused with an error. Pick Standard items for reliable results.'
