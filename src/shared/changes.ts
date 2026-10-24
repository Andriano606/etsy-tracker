import type { ChangedField, TrackedFields } from './types'

/** Ukrainian label of each change group, in display order. */
export const FIELD_LABEL: Record<ChangedField, string> = {
  price: 'ціна',
  title: 'назва',
  description: 'опис',
  images: 'фото',
  videos: 'відео',
  tags: 'теги',
  materials: 'матеріали',
  styles: 'стиль',
  whoMade: 'хто зробив',
  whenMade: 'коли зроблено',
  taxonomyId: 'категорія',
  shopSectionId: 'розділ магазину',
  listingType: 'тип товару',
  processing: 'час на підготовку',
  isPersonalizable: 'персоналізація',
  isCustomizable: 'індивідуальні замовлення',
  hasVariations: 'варіанти',
  personalization: 'питання персоналізації',
  dimensions: 'вага/розміри'
}

const KEY_TO_FIELD: Record<keyof TrackedFields, ChangedField> = {
  title: 'title',
  priceAmount: 'price',
  priceDivisor: 'price',
  currency: 'price',
  description: 'description',
  tags: 'tags',
  materials: 'materials',
  styles: 'styles',
  images: 'images',
  videos: 'videos',
  whoMade: 'whoMade',
  whenMade: 'whenMade',
  taxonomyId: 'taxonomyId',
  shopSectionId: 'shopSectionId',
  listingType: 'listingType',
  processingMin: 'processing',
  processingMax: 'processing',
  isPersonalizable: 'isPersonalizable',
  isCustomizable: 'isCustomizable',
  hasVariations: 'hasVariations',
  personalization: 'personalization',
  dimensions: 'dimensions'
}

/** The change groups present in a 'changed' row, in FIELD_LABEL order. */
export function changedFields(newValue: TrackedFields | null | undefined): ChangedField[] {
  if (!newValue) return []
  const set = new Set<ChangedField>()
  for (const k of Object.keys(newValue) as Array<keyof TrackedFields>) {
    const f = KEY_TO_FIELD[k]
    if (f) set.add(f)
  }
  return (Object.keys(FIELD_LABEL) as ChangedField[]).filter((f) => set.has(f))
}

/** "ціна, опис, фото" */
export function changedLabel(newValue: TrackedFields | null | undefined): string {
  return changedFields(newValue)
    .map((f) => FIELD_LABEL[f])
    .join(', ')
}

/** Etsy enum values → Ukrainian, for the details section. */
export const WHO_MADE_LABEL: Record<string, string> = {
  i_did: 'сам продавець',
  someone_else: 'інша людина чи компанія',
  collective: 'команда продавця'
}

export function whenMadeLabel(v: string | null | undefined): string | null {
  if (!v) return null
  if (v === 'made_to_order') return 'на замовлення'
  if (v.startsWith('before_')) return `до ${v.slice(7)}`
  return v.replace('_', '–')
}

export const LISTING_TYPE_LABEL: Record<string, string> = {
  physical: 'фізичний',
  download: 'цифровий (завантаження)',
  both: 'фізичний + цифровий'
}
