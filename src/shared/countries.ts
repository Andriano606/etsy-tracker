// Buyer country for Etsy's buyer-facing prices (ListingBuyerPrice): an
// ISO 3166-1 alpha-2 code. Validated against the full code list so a typo can
// never reach Etsy (a 400 there would switch BuyerPrice off for the session).

/** Default: the app's users are in Ukraine (VAT 20 % on Etsy's UA prices). */
export const DEFAULT_BUYER_COUNTRY = 'UA'

/** Every officially assigned ISO 3166-1 alpha-2 code (249). */
export const ISO_COUNTRIES: ReadonlySet<string> = new Set(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV ' +
    'BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ' +
    'ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE ' +
    'IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY ' +
    'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU ' +
    'NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM ' +
    'SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE ' +
    'VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' ')
)

/** The short list offered in Settings (anything else can be typed). */
export const COMMON_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'UA', name: 'Україна' },
  { code: 'US', name: 'США' },
  { code: 'GB', name: 'Велика Британія' },
  { code: 'DE', name: 'Німеччина' },
  { code: 'PL', name: 'Польща' },
  { code: 'FR', name: 'Франція' },
  { code: 'IT', name: 'Італія' },
  { code: 'ES', name: 'Іспанія' },
  { code: 'NL', name: 'Нідерланди' },
  { code: 'CA', name: 'Канада' },
  { code: 'AU', name: 'Австралія' },
  { code: 'IE', name: 'Ірландія' },
  { code: 'CZ', name: 'Чехія' },
  { code: 'SE', name: 'Швеція' }
]

/**
 * Trim + uppercase + validate. "UK" (common, but not ISO) means GB. Returns
 * null for anything that isn't an assigned ISO 3166-1 alpha-2 code.
 */
export function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let c = raw.trim().toUpperCase()
  if (c === 'UK') c = 'GB'
  return /^[A-Z]{2}$/.test(c) && ISO_COUNTRIES.has(c) ? c : null
}

/** "Україна (UA)" for the common ones, else the localized name when Intl knows it, else the code. */
export function countryLabel(code: string): string {
  const common = COMMON_COUNTRIES.find((c) => c.code === code)
  if (common) return `${common.name} (${code})`
  try {
    const name = new Intl.DisplayNames(['uk'], { type: 'region' }).of(code)
    if (name && name !== code) return `${name} (${code})`
  } catch {
    // no ICU data
  }
  return code
}
