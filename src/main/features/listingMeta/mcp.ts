// The MCP tools of feature "listingMeta": attributes (category properties),
// personalization questions and translations of the user's own Etsy listings,
// and deleting a listing. Every tool calls the Etsy API live; "store" = the
// user's Etsy shop, "product" = an Etsy listing, "category" = an Etsy seller
// taxonomy node. Etsy's texts are passed through as they are.

import {
  type CategoryProperty,
  type ListingProperty,
  type ListingTranslation,
  MAX_QUESTIONS,
  PERSONALIZATION_TYPES,
  type PersonalizationQuestion,
  type PropertyInput,
  isPersonalizationType
} from '../../../shared/features/listingMeta'
import { TRANSLATION_CODES } from '../../../shared/features/translations'
import { MAX_TAGS, TAG_MAX, TITLE_MAX } from '../../../shared/myShop'
import { type JsonSchema, type McpTool, type McpToolResult, ToolInputError, textResult } from '../../mcpProtocol'
import { TRANSLATION_NOT_FOUND } from '../compete/mcp'
import { mcpFail, mcpOwnShop, mcpWritable } from '../common'
import type { FeatureMcpDeps } from '../types'
import {
  MetaError,
  categoryProperties,
  checkTranslation,
  deleteListing,
  listingProperty,
  listingTaxonomyId,
  loadAttributes,
  loadPersonalization,
  loadTranslation,
  removePersonalization,
  removeProperty,
  savePersonalization,
  saveProperty,
  saveTranslation
} from './api'

const WRITE_NOTE =
  "Changes the user's live Etsy shop — only when the user asked for this change. Needs the app's \"allow changes\" switch."
const SIGNED_IN = "requires the user's Etsy sign-in in the app"
const PRODUCT_ID: JsonSchema = { type: 'integer', minimum: 1, description: "Etsy listing id of a listing in the user's own shop (list_my_products)." }
const ATTRIBUTE_ID: JsonSchema = { type: 'integer', minimum: 1, description: 'Etsy property id (attribute_id from get_category_attributes).' }
const LANGUAGE: JsonSchema = {
  type: 'string',
  enum: [...TRANSLATION_CODES],
  description: 'Language code of the Etsy listing translation (English is split by region: en-GB, en-IN, en-US).'
}

/** An attribute/translation rule violation in English (the app shows the Ukrainian text). */
const fail = (e: unknown): McpToolResult => (e instanceof MetaError ? mcpFail(new ToolInputError(e.en)) : mcpFail(e))

function attributeOut(p: ListingProperty) {
  return {
    attribute_id: p.propertyId,
    name: p.name,
    scale_id: p.scaleId,
    scale: p.scaleName,
    value_ids: p.valueIds,
    values: p.values
  }
}

function definitionOut(d: CategoryProperty) {
  const value = (v: CategoryProperty['possibleValues'][number]) => ({ value_id: v.id, name: v.name, scale_id: v.scaleId })
  return {
    attribute_id: d.id,
    name: d.displayName,
    required: d.isRequired,
    multiple_values: d.isMultivalued,
    max_values: d.maxValuesAllowed,
    also_for_variations: d.supportsVariations,
    scales: d.scales.map((s) => ({ scale_id: s.id, name: s.name, description: s.description })),
    allowed_values: d.possibleValues.map(value),
    always_selected: d.selectedValues.map(value)
  }
}

function questionOut(q: PersonalizationQuestion) {
  return {
    question_id: q.id,
    text: q.text,
    type: q.unsupportedType ?? q.type,
    required: q.required,
    instructions: q.instructions,
    max_characters: q.maxChars,
    max_files: q.maxFiles,
    options: q.options.map((o) => ({ option_id: o.id, label: o.label })),
    add_on_price: q.addOnPrice,
    currency: q.addOnCurrency
  }
}

function translationOut(productId: number, language: string, t: ListingTranslation | null) {
  return {
    product_id: productId,
    language,
    exists: t != null,
    title: t?.title ?? null,
    description: t?.description ?? null,
    tags: t?.tags ?? [],
    ...(t ? {} : { note: TRANSLATION_NOT_FOUND })
  }
}

// ------------------------------------------------------------------ inputs

function ints(v: unknown, name: string): number[] {
  if (v == null) return []
  if (!Array.isArray(v) || !v.every((x) => Number.isSafeInteger(x) && x > 0)) {
    throw new ToolInputError(`Argument "${name}" must be a list of positive integers.`)
  }
  return v
}

function strings(v: unknown, name: string): string[] {
  if (v == null) return []
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new ToolInputError(`Argument "${name}" must be a list of strings.`)
  return v
}

/** Attribute value names: non-empty, no parentheses (refused by Etsy) or commas (they would split the value). */
function valueNames(v: unknown): string[] {
  const names = strings(v, 'values').map((x) => x.trim())
  const bad = names.find((x) => !x || /[(),]/.test(x))
  if (bad != null) throw new ToolInputError(`values: "${bad}" is empty or contains parentheses or a comma.`)
  return names
}

/**
 * The other half of a value set from the attribute's allowed values (ids →
 * names, names → ids + the allowed spelling, case-insensitive): every value
 * is stored with both. Anything not among the allowed values is refused.
 */
export function completeValues(def: CategoryProperty, p: PropertyInput): PropertyInput {
  const allowed = def.possibleValues.filter((v) => v.id != null && (p.scaleId == null || v.scaleId == null || v.scaleId === p.scaleId))
  const name = def.displayName
  if (!allowed.length) {
    throw new ToolInputError(`Attribute "${name}" has no allowed values${p.scaleId == null ? '' : ' for this scale'} to choose from, so it can't be set.`)
  }
  const fail = (what: string[]): never => {
    throw new ToolInputError(
      `Not among the allowed values of "${name}"${p.scaleId == null ? '' : ' for this scale'}: ${what.join(', ')}. Use get_category_attributes.`
    )
  }
  if (p.valueIds.length) {
    const unknown = p.valueIds.filter((id) => !allowed.some((v) => v.id === id))
    if (unknown.length) fail(unknown.map(String))
    return { ...p, values: p.valueIds.map((id) => allowed.find((v) => v.id === id)!.name) }
  }
  const hit = (s: string) => allowed.find((v) => v.name.toLowerCase() === s.toLowerCase())
  const unknown = p.values.filter((s) => !hit(s))
  if (unknown.length) fail(unknown.map((s) => `"${s}"`))
  const hits = p.values.map((s) => hit(s)!)
  return { ...p, valueIds: hits.map((v) => v.id!), values: hits.map((v) => v.name) }
}

const QUESTION_KEYS = ['question_id', 'text', 'type', 'required', 'instructions', 'max_characters', 'max_files', 'options', 'add_on_price']

const QUESTION_ITEM: JsonSchema = {
  type: 'object',
  properties: {
    question_id: { type: 'integer', minimum: 1, description: 'Keep it to edit an existing question; omit for a new one.' },
    text: { type: 'string', minLength: 1, maxLength: 45 },
    type: { type: 'string', enum: PERSONALIZATION_TYPES.map((t) => t.value) },
    required: { type: 'boolean' },
    instructions: { type: 'string', description: 'Not allowed for "dropdown".' },
    max_characters: { type: 'integer', minimum: 1, description: '"text_input" only.' },
    max_files: { type: 'integer', minimum: 1, description: 'Upload questions only; for "labeled_upload" = the number of options.' },
    options: {
      type: 'array',
      description: '"dropdown": the choices (≤ 20 chars each); "labeled_upload": one label per file (≤ 45 chars).',
      items: {
        type: 'object',
        properties: { option_id: { type: 'integer', minimum: 1 }, label: { type: 'string' } },
        required: ['label'],
        additionalProperties: false
      }
    },
    add_on_price: { type: 'number', description: 'Extra charge in the store currency; optional "text_input" questions only.' }
  },
  required: ['text', 'type', 'required'],
  additionalProperties: false
}

/** The tool's question objects → the shared shape (keys and types checked; the rules come later). */
export function questionsArg(v: unknown): PersonalizationQuestion[] {
  if (!Array.isArray(v)) throw new ToolInputError('Argument "questions" must be a list.')
  return v.map((raw, i) => {
    const at = `questions[${i}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolInputError(`${at} must be an object.`)
    const q = raw as Record<string, unknown>
    const unknown = Object.keys(q).find((k) => !QUESTION_KEYS.includes(k))
    if (unknown) throw new ToolInputError(`${at}: unknown field "${unknown}".`)
    if (typeof q.text !== 'string') throw new ToolInputError(`${at}.text must be a string.`)
    if (!isPersonalizationType(q.type)) throw new ToolInputError(`${at}.type must be one of: ${QUESTION_ITEM.properties!.type.enum!.join(', ')}.`)
    if (typeof q.required !== 'boolean') throw new ToolInputError(`${at}.required must be a boolean.`)
    const optInt = (k: string): number | null => {
      if (q[k] == null) return null
      if (!Number.isSafeInteger(q[k]) || (q[k] as number) <= 0) throw new ToolInputError(`${at}.${k} must be a positive integer.`)
      return q[k] as number
    }
    if (q.instructions != null && typeof q.instructions !== 'string') throw new ToolInputError(`${at}.instructions must be a string.`)
    if (q.add_on_price != null && typeof q.add_on_price !== 'number') throw new ToolInputError(`${at}.add_on_price must be a number.`)
    const options = q.options ?? []
    if (!Array.isArray(options)) throw new ToolInputError(`${at}.options must be a list.`)
    return {
      id: optInt('question_id'),
      text: q.text,
      instructions: (q.instructions as string | undefined) ?? null,
      type: q.type,
      required: q.required,
      maxChars: optInt('max_characters'),
      maxFiles: optInt('max_files'),
      options: options.map((o, j) => {
        const op = (o ?? {}) as Record<string, unknown>
        if (typeof op.label !== 'string') throw new ToolInputError(`${at}.options[${j}].label must be a string.`)
        const id = op.option_id
        if (id != null && (!Number.isSafeInteger(id) || (id as number) <= 0)) {
          throw new ToolInputError(`${at}.options[${j}].option_id must be a positive integer.`)
        }
        return { id: (id as number | undefined) ?? null, label: op.label }
      }),
      addOnPrice: (q.add_on_price as number | undefined) ?? null,
      addOnCurrency: null
    }
  })
}

// -------------------------------------------------------------------- tools

export function listingMetaTools(deps: FeatureMcpDeps): McpTool[] {
  const client = () => deps.client!
  return [
    {
      name: 'get_category_attributes',
      title: 'Attributes of an Etsy category',
      openWorld: true,
      description:
        'Live Etsy API (getPropertiesByTaxonomyId; API key only, works without the sign-in): the attributes (listing properties) an Etsy seller category supports as listing attributes — attribute_id, name, required, multiple_values + max_values, also_for_variations, measurement scales, allowed_values (value_id, name, scale_id) and the always_selected values.',
      inputSchema: {
        type: 'object',
        properties: { category_id: { type: 'integer', minimum: 1, description: 'Etsy seller taxonomy id (find_categories).' } },
        required: ['category_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          if (!deps.client) throw new ToolInputError('Not available: the app has no Etsy API client (no Etsy API key configured).')
          const defs = await categoryProperties(deps.client, a.category_id as number)
          return textResult({ category_id: a.category_id, attributes: defs.map(definitionOut) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_product_attributes',
      title: 'Attributes of my Etsy listing',
      openWorld: true,
      description: `Live Etsy API (API key; ${SIGNED_IN}): the attributes set on a listing of the user's own Etsy shop (attribute_id, name, scale_id, scale, value_ids, values), its category_id + category path, and the category's required attributes still missing. Etsy's public listing read doesn't show drafts/inactive listings: then category_id and missing_required_attributes are null (see note). With attribute_id: only that attribute (null = not set).`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, attribute_id: ATTRIBUTE_ID },
        required: ['product_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const shopId = mcpOwnShop(deps)
          const productId = a.product_id as number
          if (a.attribute_id != null) {
            const p = await listingProperty(client(), shopId, productId, a.attribute_id as number)
            return textResult({ product_id: productId, attribute: p && attributeOut(p) })
          }
          const r = await loadAttributes(client(), deps.taxonomy, shopId, productId, null)
          return textResult({
            product_id: productId,
            category_id: r.taxonomyId,
            category: r.categoryPath,
            attributes: r.properties.map(attributeOut),
            missing_required_attributes:
              r.definitions
                ?.filter((d) => d.isRequired && !r.properties.some((p) => p.propertyId === d.id))
                .map((d) => ({ attribute_id: d.id, name: d.displayName })) ?? null,
            note: r.taxonomyId == null ? "Etsy's public listing read didn't show this listing's category (it may be a draft or inactive)." : null
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'set_my_product_attribute',
      title: 'Set an attribute of my Etsy listing',
      openWorld: true,
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Sets (replaces) one attribute of a listing in the user's own Etsy shop (Etsy updateListingProperty, OAuth scope listings_w). Etsy stores every value with both its value_id and its name: give value_ids and/or values (one name per value_id, same order). Both given = sent as is; only one = the other half is looked up in the listing's category (2 extra reads; refused when not among the allowed values of get_category_attributes, or when the category can't be read — a draft/inactive listing: then give both). No parentheses or commas in names. scale_id when the attribute has scales. Returns the attribute as Etsy saved it.`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: PRODUCT_ID,
          attribute_id: ATTRIBUTE_ID,
          value_ids: { type: 'array', items: { type: 'integer', minimum: 1 } },
          values: { type: 'array', items: { type: 'string' } },
          scale_id: { type: 'integer', minimum: 1 }
        },
        required: ['product_id', 'attribute_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const shopId = mcpWritable(deps, ['listings_w'])
          const productId = a.product_id as number
          const attributeId = a.attribute_id as number
          let input: PropertyInput = {
            valueIds: ints(a.value_ids, 'value_ids'),
            values: valueNames(a.values),
            scaleId: (a.scale_id as number | undefined) ?? null
          }
          if (!input.valueIds.length && !input.values.length) throw new ToolInputError('Give value_ids and/or values.')
          if (input.valueIds.length && input.values.length && input.valueIds.length !== input.values.length) {
            throw new ToolInputError('value_ids and values must pair up: one name per value_id, in the same order (or give only one of them).')
          }
          if (!input.valueIds.length || !input.values.length) {
            const tax = await listingTaxonomyId(client(), productId)
            if (tax == null) {
              throw new ToolInputError(
                'The category of this listing could not be read from Etsy (it may be a draft or inactive) — give both value_ids and values (one name per value_id, same order) from get_category_attributes.'
              )
            }
            const def = (await categoryProperties(client(), tax)).find((d) => d.id === attributeId)
            if (!def) throw new ToolInputError(`Attribute ${attributeId} is not an attribute of this listing's category (${tax}) — see get_category_attributes.`)
            input = completeValues(def, input)
          }
          const p = await saveProperty(client(), shopId, productId, attributeId, input)
          return textResult({ product_id: productId, attribute: attributeOut(p) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'remove_my_product_attribute',
      title: 'Remove an attribute of my Etsy listing',
      openWorld: true,
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Removes one attribute (all its values) from a listing in the user's own Etsy shop (Etsy deleteListingProperty, OAuth scope listings_w).`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, attribute_id: ATTRIBUTE_ID },
        required: ['product_id', 'attribute_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const shopId = mcpWritable(deps, ['listings_w'])
          await removeProperty(client(), shopId, a.product_id as number, a.attribute_id as number)
          return textResult({ product_id: a.product_id, attribute_id: a.attribute_id, removed: true })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_product_personalization',
      title: 'Personalization of my Etsy listing',
      openWorld: true,
      description: `Live Etsy API (getListingPersonalization; API key; ${SIGNED_IN}): the personalization questions buyers answer when ordering a listing of the user's own Etsy shop — question_id, text, type (text_input | dropdown | unlabeled_upload | labeled_upload; another Etsy type is shown as is), required, instructions, max_characters, max_files, options (option_id, label), add_on_price + currency. An empty list = no personalization.`,
      inputSchema: { type: 'object', properties: { product_id: PRODUCT_ID }, required: ['product_id'], additionalProperties: false },
      run: async (a) => {
        try {
          mcpOwnShop(deps)
          const qs = await loadPersonalization(client(), a.product_id as number)
          return textResult({ product_id: a.product_id, questions: qs.map(questionOut) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'set_my_product_personalization',
      title: 'Set the personalization of my Etsy listing',
      openWorld: true,
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Replaces ALL personalization questions of a listing in the user's own Etsy shop with the given 1–${MAX_QUESTIONS} questions (Etsy updateListingPersonalization, OAuth scope listings_w). Keep question_id/option_id from get_my_product_personalization to edit existing ones; questions left out are deleted. Text 1–45 chars; instructions not for "dropdown"; max_characters for "text_input"; max_files for uploads; options for "dropdown" (≤ 20 chars) and "labeled_upload" (≤ 45 chars, as many as max_files); add_on_price (shop currency) only for optional "text_input". Rule violations are reported (in Ukrainian) before anything is sent. Returns the questions as Etsy saved them.`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, questions: { type: 'array', items: QUESTION_ITEM } },
        required: ['product_id', 'questions'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const shopId = mcpWritable(deps, ['listings_w'])
          const qs = await savePersonalization(client(), shopId, a.product_id as number, questionsArg(a.questions))
          return textResult({ product_id: a.product_id, questions: qs.map(questionOut) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'remove_my_product_personalization',
      title: 'Remove the personalization of my Etsy listing',
      openWorld: true,
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Deletes every personalization question of a listing in the user's own Etsy shop (Etsy deleteListingPersonalization, OAuth scope listings_w); buyers are no longer asked anything.`,
      inputSchema: { type: 'object', properties: { product_id: PRODUCT_ID }, required: ['product_id'], additionalProperties: false },
      run: async (a) => {
        try {
          const shopId = mcpWritable(deps, ['listings_w'])
          await removePersonalization(client(), shopId, a.product_id as number)
          return textResult({ product_id: a.product_id, removed: true })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_product_translation',
      title: 'Translation of my Etsy listing',
      openWorld: true,
      description: `Live Etsy API (getListingTranslation; API key; ${SIGNED_IN}): the title, description and tags of a listing of the user's own Etsy shop in one of the given languages. exists=false (+ note) = Etsy found nothing: either there is no translation in that language yet, or the listing is not (or no longer) in the user's shop — Etsy's 404 doesn't say which.`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, language: LANGUAGE },
        required: ['product_id', 'language'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const shopId = mcpOwnShop(deps)
          const t = await loadTranslation(client(), shopId, a.product_id as number, a.language as string)
          return textResult(translationOut(a.product_id as number, a.language as string, t))
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'set_my_product_translation',
      title: 'Set the translation of my Etsy listing',
      openWorld: true,
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Creates (Etsy createListingTranslation) or replaces (updateListingTranslation) the translation of a listing in the user's own Etsy shop in a language — it reads the current translation first to choose (OAuth scope listings_w). title (≤ ${TITLE_MAX} chars), description, tags (≤ ${MAX_TAGS}, each ≤ ${TAG_MAX} chars; omitted = not sent, existing tags stay — they can be replaced but not cleared). Returns the translation and result: created | updated.`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: PRODUCT_ID,
          language: LANGUAGE,
          title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
          description: { type: 'string', minLength: 1 },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['product_id', 'language', 'title', 'description'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const shopId = mcpWritable(deps, ['listings_w'])
          const productId = a.product_id as number
          const language = a.language as string
          const input = checkTranslation({ title: a.title as string, description: a.description as string, tags: strings(a.tags, 'tags') })
          const current = await loadTranslation(client(), shopId, productId, language)
          if (Array.isArray(a.tags) && !a.tags.length && current?.tags.length) {
            throw new ToolInputError('The tags of an existing translation can be replaced but not cleared — omit tags to keep them, or give the new tags.')
          }
          const existed = current != null
          const t = await saveTranslation(client(), shopId, productId, language, input, existed)
          return textResult({ ...translationOut(productId, language, t), result: existed ? 'updated' : 'created' })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'delete_my_product',
      title: 'Delete my Etsy listing',
      openWorld: true,
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} PERMANENTLY deletes a listing of the user's own Etsy shop (Etsy deleteListing, OAuth scope listings_d) — it can't be restored. Only when the user explicitly asked to delete this listing — confirm it with them first.`,
      inputSchema: { type: 'object', properties: { product_id: PRODUCT_ID }, required: ['product_id'], additionalProperties: false },
      run: async (a) => {
        try {
          mcpWritable(deps, ['listings_d'])
          await deleteListing(client(), a.product_id as number)
          return textResult({ product_id: a.product_id, deleted: true })
        } catch (e) {
          return mcpFail(e)
        }
      }
    }
  ]
}
