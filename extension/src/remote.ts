import type { CostumeItem, PortraitItem, PoseItem, SlotKey } from './types'

const POSE_HOST = 'https://ai-pose-gallery.pages.dev'
const COSTUME_HOST = 'https://ai-costume-gallery.pages.dev'
const PORTRAIT_HOST = 'https://ai-portrait-gallery.pages.dev'

/**
 * Full-size image URLs on the original galleries, best first. The paths differ per gallery
 * (checked against the live sites), and all of them allow cross-origin reads.
 */
export function remoteUrls(slot: SlotKey, item: PortraitItem | CostumeItem | PoseItem): string[] {
  const id = item.id
  if (slot === 'portrait') return [`${PORTRAIT_HOST}/img/full/${id}.png`]
  if (slot === 'costume') return [`${COSTUME_HOST}/png/${id}.png`, `${COSTUME_HOST}/img/${id}.webp`]
  return [`${POSE_HOST}/${(item as PoseItem).原图.replace(/^\/+/, '')}`]
}
