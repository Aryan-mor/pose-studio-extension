export interface PoseItem {
  id: string
  体系: string
  姿势编号: string
  分类: string
  姿势名称: string
  角度: string
  缩略图: string
  原图: string
}

export interface CostumeItem {
  id: string
  分类: string
  服装名称: string
  关键词: string
  缩略图: string
  原图: string
}

export interface PortraitItem {
  id: string
  分区: string
  发长: string
  标题: string
  缩略图: string
  原图: string
  /** Saved in this browser (created with "Create portrait"); 缩略图 is a data URL. */
  local?: boolean
}

export type SlotKey = 'portrait' | 'costume' | 'pose'

export interface UploadedImage {
  name: string
  url: string
  file: File
}

export interface RecipeState {
  portrait: PortraitItem | null
  costume: CostumeItem | null
  pose: PoseItem | null
  uploads?: Partial<Record<SlotKey, { name: string; url: string }>>
}

export type SavedKind = 'generated' | 'portrait'

export interface SavedMeta {
  id: string
  kind: SavedKind
  createdAt: number
  name: string
  prompt: string
  site: string
  /** Small JPEG data URL for lists. */
  thumb: string
}

export type BgRequest =
  | { type: 'fetchImage'; urls: string[] }
  | { type: 'saveImage'; kind: SavedKind; dataUrl: string; thumb: string; name: string; prompt: string; site: string }
  | { type: 'listImages'; kind?: SavedKind }
  | { type: 'getImage'; id: string }
  | { type: 'deleteImage'; id: string }

export type BgResponse =
  | { ok: true; dataUrl?: string; id?: string; items?: SavedMeta[] }
  | { ok: false; error: string }
