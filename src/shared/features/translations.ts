// The languages of Etsy listing translations — one list for every place that
// reads or writes them (getListingTranslation / create / updateListingTranslation:
// feature "compete" for any listing, feature "listingMeta" for the own ones).
//
// The codes are Etsy's language tags as the OAS `ListingTranslations` object
// (a listing's `translations` association) keys them, English split by region
// (en-GB, en-IN, en-US). The repo has no copy of the OAS to re-check them;
// this is the list feature "compete" documented. listingMeta used to have its
// own list (de, en, es, …, ru from the examples of the `language` parameter)
// with a bare "en", which is not one of these keys.

export const TRANSLATION_LANGUAGES = [
  { code: 'de', label: 'Німецька' },
  { code: 'en-GB', label: 'Англійська (Велика Британія)' },
  { code: 'en-IN', label: 'Англійська (Індія)' },
  { code: 'en-US', label: 'Англійська (США)' },
  { code: 'es', label: 'Іспанська' },
  { code: 'fr', label: 'Французька' },
  { code: 'it', label: 'Італійська' },
  { code: 'ja', label: 'Японська' },
  { code: 'nl', label: 'Нідерландська' },
  { code: 'pl', label: 'Польська' },
  { code: 'pt', label: 'Португальська' },
  { code: 'ru', label: 'Російська' },
  { code: 'sv', label: 'Шведська' }
] as const

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number]['code']

export const TRANSLATION_CODES: readonly TranslationLanguage[] = TRANSLATION_LANGUAGES.map((l) => l.code)

export const isTranslationLanguage = (v: unknown): v is TranslationLanguage => TRANSLATION_CODES.includes(v as TranslationLanguage)
