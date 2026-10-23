import { describe, expect, it } from 'vitest'
import { listingMetaFeature } from '../../../src/main/features/listingMeta'
import { EtsyApiError } from '../../../src/main/etsyApi'
import { LISTING_META_TOOL_SUMMARY } from '../../../src/shared/features/listingMeta'
import {
  ALL_SCOPES,
  OWN_SHOP,
  callTool,
  featureCtx,
  mcpDeps,
  runAction,
  signedIn,
  signedOut
} from '../../helpers/features'

// ------------------------------------------------- Etsy answers (OAS shapes)

const LISTING = 1234
const TAX = 2
const SHOP_PATH = `/v3/application/shops/${OWN_SHOP}/listings/${LISTING}`

/** TaxonomyNodeProperties */
const CATEGORY_PROPS = {
  count: 2,
  results: [
    {
      property_id: 200,
      name: 'Primary color',
      display_name: 'Primary color',
      scales: [],
      is_required: true,
      supports_attributes: true,
      supports_variations: true,
      is_multivalued: false,
      max_values_allowed: null,
      possible_values: [
        { value_id: 1, name: 'Black', scale_id: null, equal_to: [] },
        { value_id: 2, name: 'Teal &amp; Orange', scale_id: null, equal_to: [] }
      ],
      selected_values: []
    },
    {
      property_id: 47626759834,
      name: 'paper_size',
      display_name: 'Paper size',
      scales: [{ scale_id: 5, display_name: 'Inches', description: 'Sizes in inches' }],
      is_required: false,
      supports_attributes: true,
      supports_variations: false,
      is_multivalued: true,
      max_values_allowed: 3,
      possible_values: [
        { value_id: 10, name: 'Letter', scale_id: 5, equal_to: [11] },
        { value_id: 12, name: 'A4', scale_id: 5, equal_to: [] }
      ],
      selected_values: [{ value_id: 10, name: 'Letter', scale_id: 5, equal_to: [] }]
    }
  ]
}

/** ListingPropertyValues */
const LISTING_PROPS = {
  count: 1,
  results: [{ property_id: 200, property_name: 'Primary color', scale_id: null, scale_name: null, value_ids: [1], values: ['Black'] }]
}

/** ListingPersonalization */
const PERSONALIZATION = {
  personalization_questions: [
    {
      question_id: 31,
      question_text: 'Your name &amp; date',
      instructions: 'As it should appear',
      question_type: 'text_input',
      required: false,
      max_allowed_characters: 40,
      max_allowed_files: null,
      add_on_price: { amount: 250, divisor: 100, currency_code: 'USD' },
      options: null
    },
    {
      question_id: 32,
      question_text: 'Colour',
      instructions: null,
      question_type: 'dropdown',
      required: true,
      max_allowed_characters: null,
      max_allowed_files: null,
      add_on_price: null,
      options: [
        { option_id: 7, label: 'Teal' },
        { option_id: 8, label: 'Orange' }
      ]
    }
  ]
}

/** ListingTranslation */
const TRANSLATION = {
  listing_id: LISTING,
  language: 'de',
  title: 'Budgetplaner &amp; Tabelle',
  description: 'Ein Planer',
  tags: ['budget', 'planer']
}

const form = (body: string | null): Record<string, string> => Object.fromEntries(new URLSearchParams(body ?? ''))

const A = '/v3/application'

/** Every endpoint of the feature, answering like Etsy. */
function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${A}/seller-taxonomy/nodes/{id}/properties`]: { body: CATEGORY_PROPS },
    [`GET ${A}/listings/{id}`]: { body: { listing_id: LISTING, taxonomy_id: TAX } },
    [`GET ${A}/shops/{s}/listings/{l}/properties`]: { body: LISTING_PROPS },
    [`GET ${A}/listings/{l}/properties/{p}`]: { status: 501, body: { error: 'Not implemented' } },
    [`PUT ${A}/shops/{s}/listings/{l}/properties/{p}`]: (url: URL, init?: RequestInit) => {
      const f = form(String(init?.body))
      return {
        body: {
          property_id: Number(url.pathname.split('/').pop()),
          property_name: 'Primary color',
          scale_id: f.scale_id ? Number(f.scale_id) : null,
          scale_name: null,
          value_ids: f.value_ids ? f.value_ids.split(',').map(Number) : [],
          values: f.values.split(',')
        }
      }
    },
    [`DELETE ${A}/shops/{s}/listings/{l}/properties/{p}`]: { status: 200 },
    [`GET ${A}/listings/{l}/personalization`]: { body: PERSONALIZATION },
    [`POST ${A}/shops/{s}/listings/{l}/personalization`]: { status: 201, body: PERSONALIZATION },
    [`DELETE ${A}/shops/{s}/listings/{l}/personalization`]: { status: 200 },
    [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: { body: TRANSLATION },
    [`POST ${A}/shops/{s}/listings/{l}/translations/{lang}`]: (url: URL, init?: RequestInit) => ({
      body: { listing_id: LISTING, language: url.pathname.split('/').pop(), ...splitTags(form(String(init?.body))) }
    }),
    [`PUT ${A}/shops/{s}/listings/{l}/translations/{lang}`]: (url: URL, init?: RequestInit) => ({
      body: { listing_id: LISTING, language: url.pathname.split('/').pop(), ...splitTags(form(String(init?.body))) }
    }),
    [`DELETE ${A}/listings/{l}`]: { status: 200 },
    ...over
  } as Parameters<typeof featureCtx>[0]
}

const splitTags = (f: Record<string, string>) => ({ ...f, tags: f.tags ? f.tags.split(',') : [] })
const notFound = { status: 404, body: { error: 'Not found' } }
const run = (action: string, args: Record<string, unknown>, ctx: ReturnType<typeof featureCtx>['ctx']) =>
  runAction(listingMetaFeature, action, args, ctx)

// ================================================================== actions

describe('listingMeta actions: attributes', () => {
  it('categoryAttributes: getPropertiesByTaxonomyId with supports_attributes, API key only, mapped + decoded', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const defs = (await run('categoryAttributes', { taxonomyId: TAX }, ctx)) as any[]
    const c = fetch.calls[0]
    expect(c.method).toBe('GET')
    expect(c.url.pathname).toBe(`${A}/seller-taxonomy/nodes/${TAX}/properties`)
    expect(Object.fromEntries(c.url.searchParams)).toEqual({ supports_attributes: 'true' })
    expect(c.headers.authorization).toBeUndefined()
    expect(c.headers['x-api-key']).toBe('keystring:secret')
    expect(defs[0]).toEqual({
      id: 200,
      name: 'Primary color',
      displayName: 'Primary color',
      scales: [],
      isRequired: true,
      supportsAttributes: true,
      supportsVariations: true,
      isMultivalued: false,
      maxValuesAllowed: null,
      possibleValues: [
        { id: 1, name: 'Black', scaleId: null, equalTo: [] },
        { id: 2, name: 'Teal & Orange', scaleId: null, equalTo: [] }
      ],
      selectedValues: []
    })
    expect(defs[1]).toMatchObject({
      displayName: 'Paper size',
      scales: [{ id: 5, name: 'Inches', description: 'Sizes in inches' }],
      isMultivalued: true,
      maxValuesAllowed: 3,
      possibleValues: [{ id: 10, name: 'Letter', scaleId: 5, equalTo: [11] }, { id: 12, name: 'A4', scaleId: 5, equalTo: [] }],
      selectedValues: [{ id: 10, name: 'Letter' }]
    })
  })

  it('categoryAttributes: a bad id is refused before any request', async () => {
    const { ctx, fetch } = featureCtx(routes())
    await expect(run('categoryAttributes', { taxonomyId: 'x' }, ctx)).rejects.toThrow('Некоректний taxonomyId.')
    expect(fetch.calls).toHaveLength(0)
  })

  it('attributes: the listing category (getListing), its properties and the category definitions', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const r = await run('attributes', { listingId: LISTING }, ctx)
    expect(fetch.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `GET ${A}/listings/${LISTING}`,
      `GET ${SHOP_PATH}/properties`,
      `GET ${A}/seller-taxonomy/nodes/${TAX}/properties`
    ])
    expect(fetch.calls.every((c) => c.headers.authorization === undefined)).toBe(true)
    expect(fetch.calls[0].url.search).toBe('')
    expect(r).toMatchObject({
      listingId: LISTING,
      taxonomyId: TAX,
      categoryPath: 'Paper & Party Supplies › Paper › Calendars & Planners',
      properties: [{ propertyId: 200, name: 'Primary color', scaleId: null, scaleName: null, valueIds: [1], values: ['Black'] }],
      note: null
    })
    expect((r as any).definitions).toHaveLength(2)
  })

  it('attributes: Etsy doesn\'t show the listing (404) → no category, a note to pick one; a given taxonomyId skips getListing', async () => {
    const { ctx, fetch } = featureCtx(routes({ [`GET ${A}/listings/{id}`]: notFound }))
    const r = (await run('attributes', { listingId: LISTING }, ctx)) as any
    expect(r).toMatchObject({ taxonomyId: null, categoryPath: null, definitions: null })
    expect(r.note).toContain('виберіть категорію вручну')
    expect(r.properties).toHaveLength(1)
    expect(fetch.calls.some((c) => c.url.pathname.includes('seller-taxonomy'))).toBe(false)

    const again = featureCtx(routes())
    const r2 = (await run('attributes', { listingId: LISTING, taxonomyId: 1 }, again.ctx)) as any
    expect(r2).toMatchObject({ taxonomyId: 1, categoryPath: 'Paper & Party Supplies' })
    expect(again.fetch.calls.map((c) => c.url.pathname)).toEqual([`${SHOP_PATH}/properties`, `${A}/seller-taxonomy/nodes/1/properties`])
  })

  it('attributes: a failing taxonomy list leaves only the path unknown; other getListing errors fail', async () => {
    const { ctx } = featureCtx(routes(), { taxonomy: async () => Promise.reject(new Error('down')) })
    expect(await run('attributes', { listingId: LISTING }, ctx)).toMatchObject({ taxonomyId: TAX, categoryPath: null })
    const bad = featureCtx(routes({ [`GET ${A}/listings/{id}`]: { status: 500 } }))
    await expect(run('attributes', { listingId: LISTING }, bad.ctx)).rejects.toBeInstanceOf(EtsyApiError)
  })

  it('attributes: signed out → the sign-in error, nothing requested', async () => {
    const { ctx, fetch } = featureCtx(routes(), { status: signedOut })
    await expect(run('attributes', { listingId: LISTING }, ctx)).rejects.toThrow('Увійдіть в Etsy')
    expect(fetch.calls).toHaveLength(0)
  })

  it('attribute: picked from getListingProperties (getListingProperty only answers 501 — never asked, no retries); not set → null', async () => {
    const { ctx, fetch } = featureCtx(routes())
    expect(await run('attribute', { listingId: LISTING, propertyId: 200 }, ctx)).toMatchObject({ propertyId: 200, values: ['Black'] })
    expect(await run('attribute', { listingId: LISTING, propertyId: 999 }, ctx)).toBeNull()
    expect(fetch.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `GET ${SHOP_PATH}/properties`,
      `GET ${SHOP_PATH}/properties`
    ])
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
  })

  it('saveAttribute: PUT updateListingProperty, form value_ids/values (+ scale_id), OAuth', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const r = await run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [2], values: ['Teal'], scaleId: null }, ctx)
    const c = fetch.calls[0]
    expect(c.method).toBe('PUT')
    expect(c.url.pathname).toBe(`${SHOP_PATH}/properties/200`)
    expect(c.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(c.headers.authorization).toBe('Bearer tok')
    expect(form(c.body)).toEqual({ value_ids: '2', values: 'Teal' })
    expect(r).toMatchObject({ propertyId: 200, valueIds: [2], values: ['Teal'] })

    await run('saveAttribute', { listingId: LISTING, propertyId: 47626759834, valueIds: [10, 12], values: [' Letter ', 'A4'], scaleId: 5 }, ctx)
    expect(form(fetch.calls[1].body)).toEqual({ value_ids: '10,12', values: 'Letter,A4', scale_id: '5' })
  })

  it('saveAttribute: bad values are refused before any request', async () => {
    const { ctx, fetch } = featureCtx(routes())
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [], values: [] }, ctx)).rejects.toThrow(
      'хоча б одне значення'
    )
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [1], values: ['Red (dark)'] }, ctx)).rejects.toThrow('дужки')
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [1], values: ['a,b'] }, ctx)).rejects.toThrow('кому')
    // both halves are required and pair up one by one: a free value (no id) or mismatched lists never reach Etsy
    const paired = 'і ідентифікатора, і назви'
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, values: ['Hand made'] }, ctx)).rejects.toThrow(paired)
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [1] }, ctx)).rejects.toThrow(paired)
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [1, 2], values: ['Red'] }, ctx)).rejects.toThrow(paired)
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, values: 'Black' }, ctx)).rejects.toThrow('Некоректне поле values.')
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [0], values: ['x'] }, ctx)).rejects.toThrow(
      'ідентифікатор значення'
    )
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 0, values: ['x'] }, ctx)).rejects.toThrow('Некоректний propertyId.')
    expect(fetch.calls).toHaveLength(0)
  })

  it('saveAttribute: a sign-in without listings_w names the permission; an Etsy 400 is the client error', async () => {
    const { ctx, fetch } = featureCtx(routes(), { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [1], values: ['Black'] }, ctx)).rejects.toThrow('редагування лістингів')
    expect(fetch.calls).toHaveLength(0)
    const bad = featureCtx(routes({ [`PUT ${A}/shops/{s}/listings/{l}/properties/{p}`]: { status: 400, body: { error: 'Invalid value' } } }))
    await expect(run('saveAttribute', { listingId: LISTING, propertyId: 200, valueIds: [1], values: ['Black'] }, bad.ctx)).rejects.toMatchObject({
      kind: 'bad_request',
      detail: 'Invalid value'
    })
  })

  it('removeAttribute: DELETE deleteListingProperty with OAuth', async () => {
    const { ctx, fetch } = featureCtx(routes())
    expect(await run('removeAttribute', { listingId: LISTING, propertyId: 200 }, ctx)).toBe(true)
    expect(fetch.calls[0]).toMatchObject({ method: 'DELETE', body: null })
    expect(fetch.calls[0].url.pathname).toBe(`${SHOP_PATH}/properties/200`)
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
    const gone = featureCtx(routes({ [`DELETE ${A}/shops/{s}/listings/{l}/properties/{p}`]: notFound }))
    await expect(run('removeAttribute', { listingId: LISTING, propertyId: 200 }, gone.ctx)).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('categories: the seller taxonomy paths', async () => {
    const { ctx } = featureCtx(routes())
    expect(await run('categories', {}, ctx)).toHaveLength(2)
  })
})

describe('listingMeta actions: personalization', () => {
  it('personalization: GET getListingPersonalization (API key only), Money add-on → a number, entities decoded', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const qs = await run('personalization', { listingId: LISTING }, ctx)
    expect(fetch.calls[0].url.pathname).toBe(`${A}/listings/${LISTING}/personalization`)
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
    expect(qs).toEqual([
      {
        id: 31,
        text: 'Your name & date',
        instructions: 'As it should appear',
        type: 'text_input',
        required: false,
        maxChars: 40,
        maxFiles: null,
        options: [],
        addOnPrice: 2.5,
        addOnCurrency: 'USD'
      },
      {
        id: 32,
        text: 'Colour',
        instructions: null,
        type: 'dropdown',
        required: true,
        maxChars: null,
        maxFiles: null,
        options: [{ id: 7, label: 'Teal' }, { id: 8, label: 'Orange' }],
        addOnPrice: null,
        addOnCurrency: null
      }
    ])
  })

  it('personalization: none → []; signed out → sign-in error', async () => {
    const { ctx } = featureCtx(routes({ [`GET ${A}/listings/{l}/personalization`]: { body: { personalization_questions: [] } } }))
    expect(await run('personalization', { listingId: LISTING }, ctx)).toEqual([])
    const out = featureCtx(routes(), { status: signedOut })
    await expect(run('personalization', { listingId: LISTING }, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
  })

  it('personalization: a question_type outside the OAS enum is kept as unsupportedType (never silently a text question)', async () => {
    const odd = { ...PERSONALIZATION.personalization_questions[0], question_type: 'checkbox' }
    const { ctx } = featureCtx(routes({ [`GET ${A}/listings/{l}/personalization`]: { body: { personalization_questions: [odd] } } }))
    const [q] = (await run('personalization', { listingId: LISTING }, ctx)) as Array<Record<string, unknown>>
    expect(q).toMatchObject({ id: 31, unsupportedType: 'checkbox' })
    const known = featureCtx(routes())
    const qs = (await run('personalization', { listingId: LISTING }, known.ctx)) as Array<Record<string, unknown>>
    expect(qs.every((x) => !('unsupportedType' in x))).toBe(true)
  })

  it('savePersonalization: POST JSON with supports_multiple_personalization_questions, only the fields each type uses', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const questions = [
      { id: 31, text: ' Name ', instructions: 'Max 20', type: 'text_input', required: false, maxChars: 20, maxFiles: null, options: [], addOnPrice: 1.5 },
      { id: null, text: 'Colour', instructions: '  ', type: 'dropdown', required: true, maxChars: null, maxFiles: null, options: [{ id: 7, label: 'Teal' }, { id: null, label: ' Orange ' }], addOnPrice: null },
      { id: null, text: 'Photos', instructions: null, type: 'labeled_upload', required: true, maxChars: null, maxFiles: 2, options: [{ label: 'Front' }, { label: 'Back' }], addOnPrice: null },
      { text: 'Logo', type: 'unlabeled_upload', required: false, maxFiles: 1 }
    ]
    const r = await run('savePersonalization', { listingId: LISTING, questions }, ctx)
    const c = fetch.calls[0]
    expect(c.method).toBe('POST')
    expect(c.url.pathname).toBe(`${SHOP_PATH}/personalization`)
    expect(Object.fromEntries(c.url.searchParams)).toEqual({ supports_multiple_personalization_questions: 'true' })
    expect(c.headers['content-type']).toBe('application/json')
    expect(c.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(c.body!)).toEqual({
      personalization_questions: [
        { question_id: 31, question_text: 'Name', instructions: 'Max 20', question_type: 'text_input', required: false, max_allowed_characters: 20, add_on_price: 1.5 },
        { question_text: 'Colour', question_type: 'dropdown', required: true, options: [{ option_id: 7, label: 'Teal' }, { label: 'Orange' }] },
        { question_text: 'Photos', question_type: 'labeled_upload', required: true, max_allowed_files: 2, options: [{ label: 'Front' }, { label: 'Back' }] },
        { question_text: 'Logo', question_type: 'unlabeled_upload', required: false, max_allowed_files: 1 }
      ]
    })
    expect(r).toHaveLength(2)
  })

  it('savePersonalization: rule violations and malformed questions never reach Etsy', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const q = (over: Record<string, unknown>) => ({ text: 'Name', type: 'text_input', required: false, options: [], ...over })
    const bad: Array<[unknown, string]> = [
      [[], 'хоча б одне питання'],
      [Array.from({ length: 6 }, () => q({})), 'не більше 5'],
      [[q({ text: 'x'.repeat(46) })], 'довший за 45'],
      [[q({ type: 'dropdown' })], 'хоча б один варіант'],
      [[q({ type: 'dropdown', options: [{ label: 'x'.repeat(21) }] })], 'довший за 20'],
      [[q({ type: 'labeled_upload', maxFiles: 3, options: [{ label: 'A' }] })], 'дорівнювати максимуму файлів'],
      [[q({ required: true, addOnPrice: 2 })], 'доплата можлива лише'],
      [[q({ maxFiles: 2 })], 'максимум файлів'],
      [[q({ type: 'dropdown', instructions: 'Hi', options: [{ label: 'A' }] })], 'інструкцій'],
      [[q({ type: 'checkbox' })], 'невідомий тип'],
      [[q({ unsupportedType: 'checkbox' })], 'невідомий тип'],
      [[q({ id: -1 })], 'некоректний ідентифікатор'],
      ['nope', 'Питання мають бути списком.']
    ]
    for (const [questions, msg] of bad) {
      await expect(run('savePersonalization', { listingId: LISTING, questions }, ctx)).rejects.toThrow(msg)
    }
    expect(fetch.calls).toHaveLength(0)
  })

  it('savePersonalization: a 500 is not retried (POST) and fails; no listings_w → the permission text', async () => {
    const { ctx, fetch } = featureCtx(routes({ [`POST ${A}/shops/{s}/listings/{l}/personalization`]: { status: 500 } }))
    const questions = [{ text: 'Name', type: 'text_input', required: true }]
    await expect(run('savePersonalization', { listingId: LISTING, questions }, ctx)).rejects.toMatchObject({ kind: 'server' })
    expect(fetch.calls).toHaveLength(1)
    const ro = featureCtx(routes(), { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(run('savePersonalization', { listingId: LISTING, questions }, ro.ctx)).rejects.toThrow('редагування лістингів')
  })

  it('removePersonalization: DELETE deleteListingPersonalization with OAuth', async () => {
    const { ctx, fetch } = featureCtx(routes())
    expect(await run('removePersonalization', { listingId: LISTING }, ctx)).toBe(true)
    expect(fetch.calls[0].method).toBe('DELETE')
    expect(fetch.calls[0].url.pathname).toBe(`${SHOP_PATH}/personalization`)
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
  })
})

describe('listingMeta actions: translations', () => {
  it('translation: GET getListingTranslation (API key only) decoded; 404 → null; an unknown language is refused', async () => {
    const { ctx, fetch } = featureCtx(routes())
    expect(await run('translation', { listingId: LISTING, language: 'de' }, ctx)).toEqual({
      listingId: LISTING,
      language: 'de',
      title: 'Budgetplaner & Tabelle',
      description: 'Ein Planer',
      tags: ['budget', 'planer']
    })
    expect(fetch.calls[0].url.pathname).toBe(`${SHOP_PATH}/translations/de`)
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
    const none = featureCtx(routes({ [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: notFound }))
    expect(await run('translation', { listingId: LISTING, language: 'fr' }, none.ctx)).toBeNull()
    await expect(run('translation', { listingId: LISTING, language: 'xx' }, ctx)).rejects.toThrow('Невідома мова перекладу.')
    expect(fetch.calls).toHaveLength(1)
  })

  it('saveTranslation: exists → PUT updateListingTranslation, else POST createListingTranslation; form title/description/tags', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const args = { listingId: LISTING, language: 'de', title: ' Planer ', description: 'Text', tags: ['budget', 'planer'] }
    expect(await run('saveTranslation', { ...args, exists: true }, ctx)).toMatchObject({ title: 'Planer', tags: ['budget', 'planer'] })
    expect(fetch.calls[0].method).toBe('PUT')
    expect(fetch.calls[0].url.pathname).toBe(`${SHOP_PATH}/translations/de`)
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
    expect(form(fetch.calls[0].body)).toEqual({ title: 'Planer', description: 'Text', tags: 'budget,planer' })
    await run('saveTranslation', { ...args, exists: false, tags: [] }, ctx)
    expect(fetch.calls[1].method).toBe('POST')
    expect(form(fetch.calls[1].body)).toEqual({ title: 'Planer', description: 'Text' })
  })

  it('saveTranslation: exists unknown → reads first (404 → create, found → update)', async () => {
    const create = featureCtx(routes({ [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: notFound }))
    await run('saveTranslation', { listingId: LISTING, language: 'fr', title: 'Planificateur', description: 'Texte', tags: [] }, create.ctx)
    expect(create.fetch.calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    const update = featureCtx(routes())
    await run('saveTranslation', { listingId: LISTING, language: 'de', title: 'Planer', description: 'Text', tags: [] }, update.ctx)
    expect(update.fetch.calls.map((c) => c.method)).toEqual(['GET', 'PUT'])
  })

  it('saveTranslation: problems are refused before any request; no listings_w → permission', async () => {
    const { ctx, fetch } = featureCtx(routes())
    const base = { listingId: LISTING, language: 'de', title: 'T', description: 'D', tags: [], exists: true }
    await expect(run('saveTranslation', { ...base, title: ' ' }, ctx)).rejects.toThrow('Назва не може бути порожньою.')
    await expect(run('saveTranslation', { ...base, description: '' }, ctx)).rejects.toThrow('Опис не може бути порожнім.')
    await expect(run('saveTranslation', { ...base, tags: Array.from({ length: 14 }, (_, i) => `t${i}`) }, ctx)).rejects.toThrow('не більше 13')
    await expect(run('saveTranslation', { ...base, tags: ['x'.repeat(21)] }, ctx)).rejects.toThrow('довший за 20')
    await expect(run('saveTranslation', { ...base, tags: 'a,b' }, ctx)).rejects.toThrow('Некоректне поле tags.')
    await expect(run('saveTranslation', { ...base, title: 5 }, ctx)).rejects.toThrow('Поле title має бути текстом.')
    expect(fetch.calls).toHaveLength(0)
    const ro = featureCtx(routes(), { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(run('saveTranslation', base, ro.ctx)).rejects.toThrow('редагування лістингів')
  })
})

describe('listingMeta actions: deleteListing', () => {
  it('DELETE /listings/{id} with OAuth', async () => {
    const { ctx, fetch } = featureCtx(routes())
    expect(await run('deleteListing', { listingId: LISTING }, ctx)).toBe(true)
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0].method).toBe('DELETE')
    expect(fetch.calls[0].url.pathname).toBe(`${A}/listings/${LISTING}`)
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
  })

  it('needs listings_d; Etsy 409 (state not deletable) fails; signed out fails', async () => {
    const noD = featureCtx(routes(), { status: signedIn({ scopes: ALL_SCOPES.filter((s) => s !== 'listings_d') }) })
    await expect(run('deleteListing', { listingId: LISTING }, noD.ctx)).rejects.toThrow('видалення лістингів')
    expect(noD.fetch.calls).toHaveLength(0)
    const conflict = featureCtx(routes({ [`DELETE ${A}/listings/{l}`]: { status: 409, body: { error: 'Cannot delete' } } }))
    await expect(run('deleteListing', { listingId: LISTING }, conflict.ctx)).rejects.toBeInstanceOf(EtsyApiError)
    const out = featureCtx(routes(), { status: signedOut })
    await expect(run('deleteListing', { listingId: LISTING }, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
    await expect(run('deleteListing', { listingId: -3 }, featureCtx(routes()).ctx)).rejects.toThrow('Некоректний listingId.')
  })
})

// ====================================================================== MCP

const tool = (deps: ReturnType<typeof mcpDeps>['deps'], name: string, args: Record<string, unknown> = {}) =>
  callTool(listingMetaFeature, deps, name, args)

describe('listingMeta MCP tools', () => {
  it('the tools match LISTING_META_TOOL_SUMMARY (names, order, write flags); writes are annotated destructive', () => {
    const tools = listingMetaFeature.mcpTools!(mcpDeps(routes()).deps)
    expect(tools.map((t) => t.name)).toEqual(LISTING_META_TOOL_SUMMARY.map((t) => t.name))
    for (const t of tools) {
      const write = !!LISTING_META_TOOL_SUMMARY.find((s) => s.name === t.name)!.write
      expect(t.readOnly === false).toBe(write)
      expect(!!t.destructive).toBe(write)
      if (write) expect(t.description).toContain("Changes the user's live store")
      expect(t.inputSchema.additionalProperties).toBe(false)
    }
  })

  it('get_category_attributes: public read (API key only); no client → not available', async () => {
    const { deps, fetch } = mcpDeps(routes())
    const r = await tool(deps, 'get_category_attributes', { category_id: TAX })
    expect(r.isError).toBe(false)
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
    expect(fetch.calls[0].url.searchParams.get('supports_attributes')).toBe('true')
    expect(r.json.attributes[0]).toEqual({
      attribute_id: 200,
      name: 'Primary color',
      required: true,
      multiple_values: false,
      max_values: null,
      also_for_variations: true,
      scales: [],
      allowed_values: [
        { value_id: 1, name: 'Black', scale_id: null },
        { value_id: 2, name: 'Teal & Orange', scale_id: null }
      ],
      always_selected: []
    })
    const signedOutStillWorks = await tool(mcpDeps(routes(), { status: signedOut }).deps, 'get_category_attributes', { category_id: TAX })
    expect(signedOutStillWorks.isError).toBe(false)
    const none = await tool(mcpDeps(routes(), { client: null }).deps, 'get_category_attributes', { category_id: TAX })
    expect(none.isError).toBe(true)
    expect(none.text).toContain('Not available')
    expect((await tool(deps, 'get_category_attributes', {})).text).toContain('Missing required argument "category_id"')
  })

  it('get_my_product_attributes: set attributes, category, missing required; one attribute with attribute_id', async () => {
    const { deps } = mcpDeps(routes({ [`GET ${A}/shops/{s}/listings/{l}/properties`]: { body: { count: 0, results: [] } } }))
    const r = await tool(deps, 'get_my_product_attributes', { product_id: LISTING })
    expect(r.json).toEqual({
      product_id: LISTING,
      category_id: TAX,
      category: 'Paper & Party Supplies › Paper › Calendars & Planners',
      attributes: [],
      missing_required_attributes: [{ attribute_id: 200, name: 'Primary color' }],
      note: null
    })
    const one = await tool(mcpDeps(routes()).deps, 'get_my_product_attributes', { product_id: LISTING, attribute_id: 200 })
    expect(one.json).toEqual({
      product_id: LISTING,
      attribute: { attribute_id: 200, name: 'Primary color', scale_id: null, scale: null, value_ids: [1], values: ['Black'] }
    })
    const draft = await tool(mcpDeps(routes({ [`GET ${A}/listings/{id}`]: notFound })).deps, 'get_my_product_attributes', { product_id: LISTING })
    expect(draft.json).toMatchObject({ category_id: null, missing_required_attributes: null })
    expect(draft.json.note).toContain('could not be read')
  })

  it('own-store reads: signed out → the neutral sign-in note, nothing requested', async () => {
    for (const [name, args] of [
      ['get_my_product_attributes', { product_id: LISTING }],
      ['get_my_product_personalization', { product_id: LISTING }],
      ['get_my_product_translation', { product_id: LISTING, language: 'de' }]
    ] as const) {
      const { deps, fetch } = mcpDeps(routes(), { status: signedOut })
      const r = await tool(deps, name, args)
      expect(r.isError).toBe(true)
      expect(r.text).toContain('has not connected their own store')
      expect(fetch.calls).toHaveLength(0)
    }
  })

  it('every write: changes switched off / signed out / a missing permission → refused before any request', async () => {
    const writes: Array<[string, Record<string, unknown>, string]> = [
      ['set_my_product_attribute', { product_id: LISTING, attribute_id: 200, value_ids: [1], values: ['Black'] }, 'listings_w'],
      ['remove_my_product_attribute', { product_id: LISTING, attribute_id: 200 }, 'listings_w'],
      ['set_my_product_personalization', { product_id: LISTING, questions: [{ text: 'Name', type: 'text_input', required: true }] }, 'listings_w'],
      ['remove_my_product_personalization', { product_id: LISTING }, 'listings_w'],
      ['set_my_product_translation', { product_id: LISTING, language: 'de', title: 'T', description: 'D' }, 'listings_w'],
      ['delete_my_product', { product_id: LISTING }, 'listings_d']
    ]
    for (const [name, args, scope] of writes) {
      const off = mcpDeps(routes(), { writes: false })
      expect((await tool(off.deps, name, args)).text).toContain('Changes to the store are switched off')
      const out = mcpDeps(routes(), { status: signedOut })
      expect((await tool(out.deps, name, args)).text).toContain('has not connected their own store')
      const lacking = mcpDeps(routes(), { status: signedIn({ scopes: ALL_SCOPES.filter((s) => s !== scope) }) })
      const r = await tool(lacking.deps, name, args)
      expect(r.isError).toBe(true)
      expect(r.text).toContain(`lacks a permission this needs (${scope})`)
      expect([...off.fetch.calls, ...out.fetch.calls, ...lacking.fetch.calls]).toHaveLength(0)
    }
  })

  it('set_my_product_attribute: both halves given → one PUT with OAuth', async () => {
    const { deps, fetch } = mcpDeps(routes())
    const r = await tool(deps, 'set_my_product_attribute', { product_id: LISTING, attribute_id: 200, value_ids: [2], values: ['Teal'] })
    expect(r.json).toEqual({
      product_id: LISTING,
      attribute: { attribute_id: 200, name: 'Primary color', scale_id: null, scale: null, value_ids: [2], values: ['Teal'] }
    })
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0].method).toBe('PUT')
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
    expect(form(fetch.calls[0].body)).toEqual({ value_ids: '2', values: 'Teal' })
  })

  it('set_my_product_attribute: a missing half is filled from the category\'s allowed values', async () => {
    const ids = mcpDeps(routes())
    await tool(ids.deps, 'set_my_product_attribute', { product_id: LISTING, attribute_id: 47626759834, value_ids: [10, 12], scale_id: 5 })
    expect(ids.fetch.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `GET ${A}/listings/${LISTING}`,
      `GET ${A}/seller-taxonomy/nodes/${TAX}/properties`,
      `PUT ${SHOP_PATH}/properties/47626759834`
    ])
    expect(form(ids.fetch.calls[2].body)).toEqual({ value_ids: '10,12', values: 'Letter,A4', scale_id: '5' })

    const names = mcpDeps(routes())
    await tool(names.deps, 'set_my_product_attribute', { product_id: LISTING, attribute_id: 200, values: ['teal & orange'] })
    expect(form(names.fetch.calls[2].body)).toEqual({ value_ids: '2', values: 'Teal & Orange' })
  })

  it('set_my_product_attribute: a half that can\'t be filled is refused — never an empty value_ids/values', async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>, string]> = [
      // a name not among the allowed values (one unknown among known ones too)
      [{}, { attribute_id: 200, values: ['Mint'] }, 'Not among the allowed values of "Primary color": "Mint"'],
      [{}, { attribute_id: 200, values: ['Black', 'Blu'] }, ': "Blu". Use get_category_attributes.'],
      // an id not allowed (for this scale)
      [{}, { attribute_id: 200, value_ids: [99] }, 'Not among the allowed values of "Primary color": 99.'],
      [{}, { attribute_id: 47626759834, value_ids: [10], scale_id: 6 }, 'has no allowed values for this scale'],
      // the category can't be read (a draft: the public read answers 404)
      [{ [`GET ${A}/listings/{id}`]: notFound }, { attribute_id: 200, values: ['Black'] }, 'could not be read (it may be a draft)'],
      [{ [`GET ${A}/listings/{id}`]: notFound }, { attribute_id: 200, value_ids: [1] }, 'give both value_ids and values'],
      // not an attribute of the category; one without allowed values
      [{}, { attribute_id: 777, values: ['Black'] }, 'Attribute 777 is not an attribute of this product\'s category'],
      [
        { [`GET ${A}/seller-taxonomy/nodes/{id}/properties`]: { body: { count: 1, results: [{ ...CATEGORY_PROPS.results[0], possible_values: [] }] } } },
        { attribute_id: 200, values: ['Hand made'] },
        'has no allowed values to choose from'
      ]
    ]
    for (const [over, args, msg] of cases) {
      const { deps, fetch } = mcpDeps(routes(over))
      const r = await tool(deps, 'set_my_product_attribute', { product_id: LISTING, ...args })
      expect(r.isError, msg).toBe(true)
      expect(r.text).toContain(msg)
      expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(false)
    }
  })

  it('set_my_product_attribute: bad input → an error result, nothing written', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, 'Give value_ids and/or values.'],
      [{ value_ids: ['1'] }, 'must be a list of positive integers'],
      [{ values: [1] }, 'must be a list of strings'],
      [{ values: ['Red (dark)'] }, 'contains parentheses or a comma'],
      [{ values: ['a,b'] }, 'contains parentheses or a comma'],
      [{ values: [' '] }, 'is empty'],
      // both halves given but not one name per id
      [{ value_ids: [1, 2], values: ['Black'] }, 'value_ids and values must pair up']
    ]
    for (const [extra, msg] of cases) {
      const { deps, fetch } = mcpDeps(routes())
      const r = await tool(deps, 'set_my_product_attribute', { product_id: LISTING, attribute_id: 200, ...extra })
      expect(r.isError).toBe(true)
      expect(r.text).toContain(msg)
      expect(fetch.calls).toHaveLength(0)
    }
  })

  it('set_my_product_attribute: an Etsy 400 → a neutral error', async () => {
    const { deps } = mcpDeps(
      routes({ [`PUT ${A}/shops/{s}/listings/{l}/properties/{p}`]: { status: 400, body: { error: 'Etsy: see https://www.etsy.com/help' } } })
    )
    const r = await tool(deps, 'set_my_product_attribute', { product_id: LISTING, attribute_id: 200, value_ids: [1], values: ['Black'] })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('rejected the request as invalid (HTTP 400)')
    expect(r.text).not.toMatch(/etsy|https?:\/\//i)
  })

  it('remove_my_product_attribute: DELETE with OAuth', async () => {
    const { deps, fetch } = mcpDeps(routes())
    const r = await tool(deps, 'remove_my_product_attribute', { product_id: LISTING, attribute_id: 200 })
    expect(r.json).toEqual({ product_id: LISTING, attribute_id: 200, removed: true })
    expect(fetch.calls[0].method).toBe('DELETE')
    expect(fetch.calls[0].url.pathname).toBe(`${SHOP_PATH}/properties/200`)
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
  })

  it('get_my_product_personalization: the questions', async () => {
    const { deps } = mcpDeps(routes())
    const r = await tool(deps, 'get_my_product_personalization', { product_id: LISTING })
    expect(r.json.questions[0]).toEqual({
      question_id: 31,
      text: 'Your name & date',
      type: 'text_input',
      required: false,
      instructions: 'As it should appear',
      max_characters: 40,
      max_files: null,
      options: [],
      add_on_price: 2.5,
      currency: 'USD'
    })
    expect(r.json.questions[1].options).toEqual([{ option_id: 7, label: 'Teal' }, { option_id: 8, label: 'Orange' }])
    const odd = { ...PERSONALIZATION.personalization_questions[1], question_type: 'checkbox' }
    const o = await tool(mcpDeps(routes({ [`GET ${A}/listings/{l}/personalization`]: { body: { personalization_questions: [odd] } } })).deps, 'get_my_product_personalization', { product_id: LISTING })
    expect(o.json.questions[0].type).toBe('checkbox')
  })

  it('set_my_product_personalization: the tool\'s questions → the OAS JSON body', async () => {
    const { deps, fetch } = mcpDeps(routes())
    const r = await tool(deps, 'set_my_product_personalization', {
      product_id: LISTING,
      questions: [
        { question_id: 31, text: 'Name', type: 'text_input', required: false, max_characters: 30, add_on_price: 2 },
        { text: 'Colour', type: 'dropdown', required: true, options: [{ option_id: 7, label: 'Teal' }, { label: 'Orange' }] }
      ]
    })
    expect(r.isError).toBe(false)
    expect(r.json.questions).toHaveLength(2)
    const c = fetch.calls[0]
    expect(c.method).toBe('POST')
    expect(c.url.searchParams.get('supports_multiple_personalization_questions')).toBe('true')
    expect(JSON.parse(c.body!)).toEqual({
      personalization_questions: [
        { question_id: 31, question_text: 'Name', question_type: 'text_input', required: false, max_allowed_characters: 30, add_on_price: 2 },
        { question_text: 'Colour', question_type: 'dropdown', required: true, options: [{ option_id: 7, label: 'Teal' }, { label: 'Orange' }] }
      ]
    })
  })

  it('set_my_product_personalization: malformed questions and rule violations → error results, nothing sent', async () => {
    const cases: Array<[unknown, string]> = [
      [[{ text: 'A', type: 'text_input', required: true, colour: 'red' }], 'unknown field "colour"'],
      [[{ text: 'A', type: 'radio', required: true }], 'questions[0].type must be one of'],
      [[{ text: 'A', type: 'text_input' }], 'questions[0].required must be a boolean'],
      [[{ text: 'A', type: 'text_input', required: true, max_characters: 0 }], 'max_characters must be a positive integer'],
      [[{ text: 'A', type: 'dropdown', required: true, options: [{ label: 3 }] }], 'options[0].label must be a string'],
      [[{ text: 'A', type: 'dropdown', required: true }], 'хоча б один варіант'],
      [['A'], 'questions[0] must be an object']
    ]
    for (const [questions, msg] of cases) {
      const { deps, fetch } = mcpDeps(routes())
      const r = await tool(deps, 'set_my_product_personalization', { product_id: LISTING, questions })
      expect(r.isError).toBe(true)
      expect(r.text).toContain(msg)
      expect(fetch.calls).toHaveLength(0)
    }
  })

  it('remove_my_product_personalization: DELETE with OAuth', async () => {
    const { deps, fetch } = mcpDeps(routes())
    expect((await tool(deps, 'remove_my_product_personalization', { product_id: LISTING })).json).toEqual({ product_id: LISTING, removed: true })
    expect(fetch.calls[0].method).toBe('DELETE')
    expect(fetch.calls[0].url.pathname).toBe(`${SHOP_PATH}/personalization`)
  })

  it('get_my_product_translation: found / not yet; an unknown language is refused by the schema', async () => {
    const { deps } = mcpDeps(routes())
    expect((await tool(deps, 'get_my_product_translation', { product_id: LISTING, language: 'de' })).json).toEqual({
      product_id: LISTING,
      language: 'de',
      exists: true,
      title: 'Budgetplaner & Tabelle',
      description: 'Ein Planer',
      tags: ['budget', 'planer']
    })
    const none = mcpDeps(routes({ [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: notFound }))
    expect((await tool(none.deps, 'get_my_product_translation', { product_id: LISTING, language: 'ja' })).json).toMatchObject({
      exists: false,
      title: null,
      tags: []
    })
    const bad = await tool(deps, 'get_my_product_translation', { product_id: LISTING, language: 'uk' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('must be one of')
  })

  it('set_my_product_translation: creates (POST) when missing, updates (PUT) when present', async () => {
    const create = mcpDeps(routes({ [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: notFound }))
    const r = await tool(create.deps, 'set_my_product_translation', {
      product_id: LISTING,
      language: 'fr',
      title: 'Planificateur',
      description: 'Texte',
      tags: ['budget']
    })
    expect(r.json).toMatchObject({ result: 'created', language: 'fr', exists: true, title: 'Planificateur', tags: ['budget'] })
    expect(create.fetch.calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    expect(form(create.fetch.calls[1].body)).toEqual({ title: 'Planificateur', description: 'Texte', tags: 'budget' })
    expect(create.fetch.calls[1].headers.authorization).toBe('Bearer tok')

    const update = mcpDeps(routes())
    const u = await tool(update.deps, 'set_my_product_translation', { product_id: LISTING, language: 'de', title: 'Planer', description: 'Text' })
    expect(u.json.result).toBe('updated')
    expect(update.fetch.calls.map((c) => c.method)).toEqual(['GET', 'PUT'])
    expect(form(update.fetch.calls[1].body)).toEqual({ title: 'Planer', description: 'Text' })

    const bad = mcpDeps(routes())
    const b = await tool(bad.deps, 'set_my_product_translation', { product_id: LISTING, language: 'de', title: 'T', description: 'D', tags: ['a!'] })
    expect(b.isError).toBe(true)
    expect(bad.fetch.calls).toHaveLength(0)
  })

  it('set_my_product_translation: tags: [] can\'t clear existing tags → refused (not a fake "updated"); fine when there are none', async () => {
    const clear = mcpDeps(routes())
    const c = await tool(clear.deps, 'set_my_product_translation', { product_id: LISTING, language: 'de', title: 'T', description: 'D', tags: [] })
    expect(c.isError).toBe(true)
    expect(c.text).toContain('can be replaced but not cleared')
    expect(clear.fetch.calls.map((x) => x.method)).toEqual(['GET'])

    const none = mcpDeps(
      routes({ [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: { body: { ...TRANSLATION, tags: [] } } })
    )
    const n = await tool(none.deps, 'set_my_product_translation', { product_id: LISTING, language: 'de', title: 'T', description: 'D', tags: [] })
    expect(n.json).toMatchObject({ result: 'updated', tags: [] })
    expect(form(none.fetch.calls[1].body)).toEqual({ title: 'T', description: 'D' })
  })

  it('delete_my_product: DELETE with OAuth; a 409 → a neutral error', async () => {
    const { deps, fetch } = mcpDeps(routes())
    expect((await tool(deps, 'delete_my_product', { product_id: LISTING })).json).toEqual({ product_id: LISTING, deleted: true })
    expect(fetch.calls[0].method).toBe('DELETE')
    expect(fetch.calls[0].url.pathname).toBe(`${A}/listings/${LISTING}`)
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
    const conflict = mcpDeps(routes({ [`DELETE ${A}/listings/{l}`]: { status: 409, body: { error: 'Etsy cannot delete' } } }))
    const r = await tool(conflict.deps, 'delete_my_product', { product_id: LISTING })
    expect(r.isError).toBe(true)
    expect(r.text).not.toMatch(/etsy/i)
  })

  it('neutrality sweep: no marketplace name and no links in any tool definition or output', async () => {
    const leaky = routes({
      [`GET ${A}/seller-taxonomy/nodes/{id}/properties`]: {
        body: {
          count: 1,
          results: [
            {
              ...CATEGORY_PROPS.results[0],
              display_name: 'Etsy colour',
              scales: [{ scale_id: 5, display_name: 'Etsy scale', description: 'see https://www.etsy.com/x' }],
              possible_values: [{ value_id: 1, name: 'Etsy black', scale_id: null, equal_to: [] }],
              selected_values: [{ value_id: 1, name: 'etsy.me/abc', scale_id: null, equal_to: [] }]
            }
          ]
        }
      },
      [`GET ${A}/shops/{s}/listings/{l}/properties`]: {
        body: { count: 1, results: [{ property_id: 9, property_name: 'Etsy prop', scale_name: 'Etsy', value_ids: [1], values: ['https://i.etsystatic.com/a.jpg'] }] }
      },
      [`GET ${A}/listings/{l}/personalization`]: {
        body: {
          personalization_questions: [
            { ...PERSONALIZATION.personalization_questions[1], question_text: 'Etsy?', options: [{ option_id: 1, label: 'www.etsy.com/shop/x' }] },
            { ...PERSONALIZATION.personalization_questions[0], instructions: 'Read https://help.etsy.com first' }
          ]
        }
      },
      [`POST ${A}/shops/{s}/listings/{l}/personalization`]: { status: 201, body: { personalization_questions: [{ question_text: 'ETSY', question_type: 'text_input', required: true }] } },
      [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: {
        body: { listing_id: LISTING, language: 'de', title: 'Etsy Planer', description: 'Mehr auf https://www.etsy.com/de/listing/1', tags: ['etsy'] }
      },
      [`PUT ${A}/shops/{s}/listings/{l}/translations/{lang}`]: {
        body: { listing_id: LISTING, language: 'de', title: 'Etsy', description: 'http://etsy.com', tags: ['Etsy'] }
      }
    })
    const { deps } = mcpDeps(leaky)
    const texts: string[] = [JSON.stringify(listingMetaFeature.mcpTools!(deps).map(({ run: _r, ...t }) => t))]
    const calls: Array<[string, Record<string, unknown>]> = [
      ['get_category_attributes', { category_id: TAX }],
      ['get_my_product_attributes', { product_id: LISTING }],
      ['get_my_product_attributes', { product_id: LISTING, attribute_id: 9 }],
      ['set_my_product_attribute', { product_id: LISTING, attribute_id: 9, value_ids: [1], values: ['x'] }],
      ['remove_my_product_attribute', { product_id: LISTING, attribute_id: 9 }],
      ['get_my_product_personalization', { product_id: LISTING }],
      ['set_my_product_personalization', { product_id: LISTING, questions: [{ text: 'A', type: 'text_input', required: true }] }],
      ['remove_my_product_personalization', { product_id: LISTING }],
      ['get_my_product_translation', { product_id: LISTING, language: 'de' }],
      ['set_my_product_translation', { product_id: LISTING, language: 'de', title: 'T', description: 'D' }],
      ['delete_my_product', { product_id: LISTING }],
      ['delete_my_product', { product_id: 77 }]
    ]
    for (const [name, args] of calls) texts.push((await tool(deps, name, args)).text)
    const failing = mcpDeps(
      routes({
        [`GET ${A}/listings/{l}/personalization`]: { status: 404, body: { error: 'Etsy listing https://www.etsy.com/listing/1 not found' } },
        [`DELETE ${A}/listings/{l}`]: { status: 500, body: { error: 'Etsy down' } }
      })
    )
    texts.push((await tool(failing.deps, 'get_my_product_personalization', { product_id: LISTING })).text)
    texts.push((await tool(failing.deps, 'delete_my_product', { product_id: LISTING })).text)
    for (const t of texts) {
      expect(t).not.toMatch(/etsy/i)
      expect(t).not.toMatch(/https?:\/\//)
    }
    expect(texts.join(' ')).toContain('marketplace')
  })
})
