// The MCP tools of feature "listingMeta" — neutral (see mcpTools.ts): "store",
// "product", "category", "attribute"; never the marketplace's name or links.

import {
  type CategoryProperty,
  type ListingProperty,
  type ListingTranslation,
  MAX_QUESTIONS,
  PERSONALIZATION_TYPES,
  type PersonalizationQuestion,
  type PropertyInput,
  TRANSLATION_LANGUAGES,
  isPersonalizationType
} from '../../../shared/features/listingMeta'
import { MAX_TAGS, TAG_MAX, TITLE_MAX } from '../../../shared/myShop'
import { type JsonSchema, type McpTool, ToolInputError, textResult } from '../../mcpProtocol'
import { neutralText } from '../../neutral'
import { mcpFail, mcpOwnShop, mcpWritable } from '../common'
import type { FeatureMcpDeps } from '../types'
import {
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

const WRITE_NOTE = "Changes the user's live store — only when the user asked for this change."
const PRODUCT_ID: JsonSchema = { type: 'integer', minimum: 1, description: 'A product of the user’s own store.' }
const ATTRIBUTE_ID: JsonSchema = { type: 'integer', minimum: 1, description: 'From get_category_attributes.' }
const LANGUAGE: JsonSchema = {
  type: 'string',
  enum: TRANSLATION_LANGUAGES.map((l) => l.code),
  description: 'Language code of the translation.'
}

const n = (s: string | null): string | null => neutralText(s)

function attributeOut(p: ListingProperty) {
  return {
    attribute_id: p.propertyId,
    name: n(p.name),
    scale_id: p.scaleId,
    scale: n(p.scaleName),
    value_ids: p.valueIds,
    values: p.values.map((v) => neutralText(v))
  }
}

function definitionOut(d: CategoryProperty) {
  const value = (v: CategoryProperty['possibleValues'][number]) => ({ value_id: v.id, name: neutralText(v.name), scale_id: v.scaleId })
  return {
    attribute_id: d.id,
    name: neutralText(d.displayName),
    required: d.isRequired,
    multiple_values: d.isMultivalued,
    max_values: d.maxValuesAllowed,
    also_for_variations: d.supportsVariations,
    scales: d.scales.map((s) => ({ scale_id: s.id, name: neutralText(s.name), description: n(s.description) })),
    allowed_values: d.possibleValues.map(value),
    always_selected: d.selectedValues.map(value)
  }
}

function questionOut(q: PersonalizationQuestion) {
  return {
    question_id: q.id,
    text: neutralText(q.text),
    type: q.unsupportedType ?? q.type,
    required: q.required,
    instructions: n(q.instructions),
    max_characters: q.maxChars,
    max_files: q.maxFiles,
    options: q.options.map((o) => ({ option_id: o.id, label: neutralText(o.label) })),
    add_on_price: q.addOnPrice,
    currency: q.addOnCurrency
  }
}

function translationOut(productId: number, language: string, t: ListingTranslation | null) {
  return {
    product_id: productId,
    language,
    exists: t != null,
    title: n(t?.title ?? null),
    description: n(t?.description ?? null),
    tags: (t?.tags ?? []).map((x) => neutralText(x))
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

/** Attribute value names: non-empty, no parentheses (refused by the store) or commas (they would split the value). */
function valueNames(v: unknown): string[] {
  const names = strings(v, 'values').map((x) => x.trim())
  const bad = names.find((x) => !x || /[(),]/.test(x))
  if (bad != null) throw new ToolInputError(`values: "${neutralText(bad)}" is empty or contains parentheses or a comma.`)
  return names
}

/**
 * The other half of a value set from the attribute's allowed values (ids →
 * names, names → ids + the allowed spelling, case-insensitive): every value
 * is stored with both. Anything not among the allowed values is refused.
 */
export function completeValues(def: CategoryProperty, p: PropertyInput): PropertyInput {
  const allowed = def.possibleValues.filter((v) => v.id != null && (p.scaleId == null || v.scaleId == null || v.scaleId === p.scaleId))
  const name = neutralText(def.displayName)
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
  if (unknown.length) fail(unknown.map((s) => `"${neutralText(s)}"`))
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
      title: 'Attributes of a category',
      description:
        'The attributes a product category supports (for describing a product): attribute_id, name, whether it is required, whether several values are allowed (and how many), measurement scales, the allowed values with their value_id, and the values always selected. Use find_categories for category_id.',
      inputSchema: {
        type: 'object',
        properties: { category_id: { type: 'integer', minimum: 1 } },
        required: ['category_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          if (!deps.client) throw new ToolInputError('Not available: the app is not connected to the store service.')
          const defs = await categoryProperties(deps.client, a.category_id as number)
          return textResult({ category_id: a.category_id, attributes: defs.map(definitionOut) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_product_attributes',
      title: 'Attributes of my product',
      description:
        "The attributes set on a product of the user's own store (attribute_id, name, scale, value_ids, values), its category_id, and the category's required attributes still missing. With attribute_id: only that attribute (null when not set).",
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
            category: n(r.categoryPath),
            attributes: r.properties.map(attributeOut),
            missing_required_attributes:
              r.definitions
                ?.filter((d) => d.isRequired && !r.properties.some((p) => p.propertyId === d.id))
                .map((d) => ({ attribute_id: d.id, name: neutralText(d.displayName) })) ?? null,
            note: r.taxonomyId == null ? 'The category of this product could not be read (it may be a draft).' : null
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'set_my_product_attribute',
      title: 'Set an attribute of my product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Sets (replaces) one attribute of a product of the user's own store. Every value is stored with both its value_id and its name, so values must be among the attribute's allowed values (get_category_attributes): give value_ids and/or values (one name per value_id, same order); a missing half is filled from the allowed values, and anything not allowed is refused. scale_id when the attribute has scales.`,
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
                'The category of this product could not be read (it may be a draft) — give both value_ids and values (one name per value_id, same order) from get_category_attributes.'
              )
            }
            const def = (await categoryProperties(client(), tax)).find((d) => d.id === attributeId)
            if (!def) throw new ToolInputError(`Attribute ${attributeId} is not an attribute of this product's category (${tax}) — see get_category_attributes.`)
            input = completeValues(def, input)
          }
          const p = await saveProperty(client(), shopId, productId, attributeId, input)
          return textResult({ product_id: productId, attribute: attributeOut(p) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'remove_my_product_attribute',
      title: 'Remove an attribute of my product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Removes one attribute (all its values) from a product of the user's own store.`,
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
      title: 'Personalization of my product',
      description:
        "The personalization questions buyers answer when ordering a product of the user's own store: text, type (text_input | dropdown | unlabeled_upload | labeled_upload), required, instructions, max characters/files, options, add-on price. An empty list = no personalization.",
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
      title: 'Set the personalization of my product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Replaces ALL personalization questions of a product of the user's own store with the given 1–${MAX_QUESTIONS} questions (keep question_id/option_id from get_my_product_personalization to edit existing ones; questions left out are deleted). Text 1–45 chars; instructions not for "dropdown"; max_characters for "text_input"; max_files for uploads; options for "dropdown" (≤ 20 chars) and "labeled_upload" (≤ 45 chars, as many as max_files); add_on_price only for optional "text_input".`,
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
      title: 'Remove the personalization of my product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Deletes every personalization question of a product of the user's own store (buyers are no longer asked anything).`,
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
      title: 'Translation of my product',
      description:
        "The title, description and tags of a product of the user's own store in another language. exists=false = no translation in that language yet.",
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
      title: 'Set the translation of my product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Creates the translation of a product of the user's own store in a language, or replaces the existing one: title (≤ ${TITLE_MAX} chars), description, tags (≤ ${MAX_TAGS}, each ≤ ${TAG_MAX} chars; omitted = left as is — existing tags can be replaced but not cleared).`,
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
          return mcpFail(e)
        }
      }
    },
    {
      name: 'delete_my_product',
      title: 'Delete my product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} PERMANENTLY deletes a product of the user's own store (it can't be restored). Only when the user explicitly asked to delete this product — confirm the product with them first.`,
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
