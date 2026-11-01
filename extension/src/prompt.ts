import type { RecipeState } from './types'

export const STYLE_PRESETS: Record<string, { label: string; prompt: string }> = {
  none: {
    label: 'No preset (follow references)',
    prompt: '',
  },
  realistic: {
    label: 'Realistic portrait photo',
    prompt: 'Realistic commercial-photography quality, 85mm portrait lens, soft natural lighting, true skin texture and fabric detail, 8k resolution.',
  },
  fashion: {
    label: 'Japanese/Korean magazine editorial',
    prompt: 'Japanese/Korean fashion magazine editorial style, clean minimal studio background, refined color grading, emphasizing the person and the tailoring of the outfit.',
  },
  film: {
    label: 'Vintage film photo',
    prompt: '35mm Fujifilm photographic look, light film grain, soft vintage warm tones, natural street lighting with a cinematic feel.',
  },
  semi_real: {
    label: '2.5D game character art',
    prompt: '2.5D semi-realistic high-detail game character art, beautiful painterly lighting, delicate features and rich fabric and metal textures.',
  },
  anime: {
    label: 'Japanese anime illustration',
    prompt: 'Refined Japanese anime illustration style, delicate cel shading and painterly light transitions, anime character art quality, clear clean colors.',
  },
  cel_anime: {
    label: 'Makoto Shinkai-style anime film',
    prompt: 'Anime-film visual quality, clear saturated lighting, delicate volumetric light and hair highlights, clean and beautiful anime colors.',
  },
  manga: {
    label: 'Japanese black-and-white manga',
    prompt: 'Japanese black-and-white manga manuscript style, crisp precise G-pen linework, fine screentone shading and tonal contrast.',
  },
  render3d: {
    label: '3D next-gen character render',
    prompt: 'Unreal Engine 5 / Octane Render next-gen 3D character render, detailed subsurface-scattering skin, cinematic lighting.',
  },
  chibi_box: {
    label: '3D designer-toy figure',
    prompt: 'High-quality painted PVC figure finish, soft studio softbox lighting, refined material highlights and macro depth of field.',
  },
  cyberpunk: {
    label: 'Cyberpunk neon',
    prompt: 'Cyberpunk sci-fi look, rainy night with warm and cool neon rim lighting, futuristic material reflections and cinematic atmosphere.',
  },
  concept_sheet: {
    label: 'Character sheet (plain white background)',
    prompt: 'Standard character-sheet full-body illustration, clean plain white background, even diffuse lighting, clearly showing the full outfit structure and accessory details.',
  },
}


// 按实际传入模型的图片顺序动态生成「图1 / 图2 / 图3...」明确指代，支持附加上传图片
export function buildRecipePrompt(recipe: RecipeState, stylePreset = 'realistic'): string {
  const styleInfo = STYLE_PRESETS[stylePreset] ?? STYLE_PRESETS.realistic
  const clauses: string[] = []
  let idx = 1

  const up = recipe.uploads || {}
  if (!recipe.portrait && up.portrait) {
    clauses.push(
      `• [Image ${idx} (portrait reference)]: keep the face shape, features and temperament of the person in image ${idx}.`
    )
    idx++
  }
  if (recipe.portrait) {
    clauses.push(
      `• [Image ${idx} (portrait reference)]: keep the face shape, features and temperament of the person in image ${idx}; hairstyle: "${recipe.portrait.标题}".`
    )
    idx++
  }
  if (!recipe.costume && up.costume) {
    clauses.push(
      `• [Image ${idx} (costume reference)]: dress the character in the complete outfit shown in image ${idx}, reproducing the fabric and cut.`
    )
    idx++
  }
  if (recipe.costume) {
    clauses.push(
      `• [Image ${idx} (costume reference)]: dress the character in the complete outfit from image ${idx} ("${recipe.costume.服装名称}"; ${recipe.costume.关键词}), reproducing the fabric and cut.`
    )
    idx++
  }
  if (!recipe.pose && up.pose) {
    clauses.push(
      `• [Image ${idx} (pose reference)]: follow the body posture and camera perspective of image ${idx}; use the pose only and ignore everything else in it.`
    )
    idx++
  }
  if (recipe.pose) {
    clauses.push(
      `• [Image ${idx} (pose reference)]: follow the body posture and camera perspective of image ${idx} ("${recipe.pose.姿势名称}", ${recipe.pose.角度}); use the skeleton/pose only and ignore the mannequin material.`
    )
    idx++
  }

  if (clauses.length === 0) {
    return 'Select a portrait, costume or pose first, or upload your own image.'
  }

  const lines = [
    `Combine the ${clauses.length} provided reference images into one complete image of a character:`,
    ...clauses,
  ]
  if (styleInfo.prompt) {
    lines.push(`• [Style]: ${styleInfo.prompt} Balanced proportions, natural hands and facial features, consistent lighting.`)
  }
  return lines.join('\n')
}

/** Sent together with the user's photo by "Create portrait". */
export const PORTRAIT_PROMPT = `Use the uploaded photo as the primary identity reference. Create an ultra-photorealistic 4×2 portrait reference sheet of the exact same person from 8 different camera angles. Preserve 100% of the original facial identity, facial structure, skin tone, hairstyle, beard, and distinctive features. No face alterations, beautification, or artificial retouching
Use realistic skin pores, natural imperfections, individual hair strands, authentic skin texture, and natural facial asymmetry. Professional DSLR photography, 85mm portrait lens, soft studio lighting, realistic shadows, neutral light-gray background, plain black crew-neck T-shirt.
Every panel must look like a genuine photograph of the same person taken during a real studio session. Maintain perfect identity consistency across all angles.
Avoid: AI-generated appearance, plastic skin, beauty filters, excessive smoothing, artificial sharpness, CGI, facial distortion, and inconsistent facial features.`

/** Same prompt, adjusted when several photos of the person are supplied. */
export function buildPortraitPrompt(photoCount: number): string {
  if (photoCount <= 1) return PORTRAIT_PROMPT
  return PORTRAIT_PROMPT.replace(
    'Use the uploaded photo as the primary identity reference.',
    `Use all ${photoCount} uploaded photos together as the primary identity reference. They show the same person from different angles and in different pictures, so combine them to get the most accurate likeness.`
  )
}
