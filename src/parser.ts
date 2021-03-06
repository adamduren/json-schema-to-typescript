import { whiteBright } from 'cli-color'
import { JSONSchema4Type, JSONSchema4TypeName } from 'json-schema'
import { findKey, includes, isPlainObject, map } from 'lodash'
import { Options } from './'
import { typeOfSchema } from './typeOfSchema'
import { AST, hasStandaloneName, T_ANY, T_ANY_ADDITIONAL_PROPERTIES, TInterface, TInterfaceParam, TNamedInterface } from './types/AST'
import { JSONSchema, JSONSchemaWithDefinitions, SchemaSchema } from './types/JSONSchema'
import { error, generateName, log } from './utils'

export type Processed = Map<JSONSchema | JSONSchema4Type, AST>

export type UsedNames = Set<string>

export function parse(
  schema: JSONSchema | JSONSchema4Type,
  options: Options,
  rootSchema = schema as JSONSchema,
  keyName?: string,
  isSchema = true,
  processed: Processed = new Map<JSONSchema | JSONSchema4Type, AST>(),
  usedNames = new Set<string>(),
  namesById: { [key: string]: string } = {}
): AST {

  // If we've seen this node before, return it.
  if (processed.has(schema)) {
    return processed.get(schema)!
  }

  const definitions = getDefinitions(rootSchema)
  const keyNameFromDefinition = findKey(definitions, _ => _ === schema)

  // Cache processed ASTs before they are actually computed, then update
  // them in place using set(). This is to avoid cycles.
  // TODO: Investigate alternative approaches (lazy-computing nodes, etc.)
  let ast = {} as AST
  processed.set(schema, ast)
  const set = (_ast: AST) => Object.assign(ast, _ast)

  return isSchema
    ? parseNonLiteral(schema as SchemaSchema, options, rootSchema, keyName, keyNameFromDefinition, set, processed, usedNames, namesById)
    : parseLiteral(schema, keyName, keyNameFromDefinition, set)
}

function parseLiteral(
  schema: JSONSchema4Type,
  keyName: string | undefined,
  keyNameFromDefinition: string | undefined,
  set: (ast: AST) => AST
) {
  return set({
    keyName,
    params: schema,
    standaloneName: keyNameFromDefinition,
    type: 'LITERAL'
  })
}

function parseNonLiteral(
  schema: JSONSchema,
  options: Options,
  rootSchema: JSONSchema,
  keyName: string | undefined,
  keyNameFromDefinition: string | undefined,
  set: (ast: AST) => AST,
  processed: Processed,
  usedNames: UsedNames,
  namesById: { [key: string]: string }
) {

  log(whiteBright.bgBlue('parser'), schema, '<-' + typeOfSchema(schema), processed.has(schema) ? '(FROM CACHE)' : '')

  switch (typeOfSchema(schema)) {
    case 'ALL_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.allOf!.map(_ => parse(_, options, rootSchema, undefined, true, processed, usedNames, namesById)),
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'INTERSECTION'
      })
    case 'ANY':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'ANY'
      })
    case 'ANY_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.anyOf!.map(_ => parse(_, options, rootSchema, undefined, true, processed, usedNames, namesById)),
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'UNION'
      })
    case 'BOOLEAN':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'BOOLEAN'
      })
    case 'NAMED_ENUM':
      return set({
        comment: schema.description,
        keyName,
        params: schema.enum!.map((_, n) => ({
          ast: parse(_, options, rootSchema, undefined, false, processed, usedNames, namesById),
          keyName: schema.tsEnumNames![n]
        })),
        standaloneName: standaloneName(schema, keyName, usedNames, namesById)!,
        type: 'ENUM'
      })
    case 'NAMED_SCHEMA':
      return set(newInterface(schema as SchemaSchema, options, rootSchema, processed,  usedNames, namesById, keyName))
    case 'NULL':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'NULL'
      })
    case 'NUMBER':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'NUMBER'
      })
    case 'OBJECT':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'OBJECT'
      })
    case 'ONE_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.oneOf!.map(_ => parse(_, options, rootSchema, undefined, true, processed, usedNames, namesById)),
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'UNION'
      })
    case 'REFERENCE':
      throw error('Refs should have been resolved by the resolver!', schema)
    case 'STRING':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'STRING'
      })
    case 'TYPED_ARRAY':
      if (Array.isArray(schema.items)) {
        return set({
          comment: schema.description,
          keyName,
          params: schema.items.map(_ => parse(_, options, rootSchema, undefined, true, processed, usedNames, namesById)),
          standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
          type: 'TUPLE'
        })
      } else {
        return set({
          comment: schema.description,
          keyName,
          params: parse(schema.items!, options, rootSchema, undefined, true, processed, usedNames, namesById),
          standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
          type: 'ARRAY'
        })
      }
    case 'UNION':
      return set({
        comment: schema.description,
        keyName,
        params: (schema.type as JSONSchema4TypeName[]).map(_ => parse({ type: _ }, options, rootSchema, undefined, true, processed, usedNames, namesById)),
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'UNION'
      })
    case 'UNNAMED_ENUM':
      return set({
        comment: schema.description,
        keyName,
        params: schema.enum!.map(_ => parse(_, options, rootSchema, undefined, false, processed, usedNames, namesById)),
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'UNION'
      })
    case 'UNNAMED_SCHEMA':
      return set(newInterface(schema as SchemaSchema, options, rootSchema, processed, usedNames, namesById, keyName, keyNameFromDefinition))
    case 'UNTYPED_ARRAY':
      return set({
        comment: schema.description,
        keyName,
        params: T_ANY,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, namesById),
        type: 'ARRAY'
      })
  }
}

/**
 * Compute a schema name using a series of fallbacks
 */
function standaloneName(
  schema: JSONSchema,
  keyNameFromDefinition: string | undefined,
  usedNames: UsedNames,
  namesById: { [key: string]: string }
) {
  if (schema.id && namesById[schema.id]) {
    return namesById[schema.id]
  }

  let name = schema.title || schema.id || keyNameFromDefinition
  if (name) {
    if (schema.id) {
      namesById[schema.id] = name
    }
    return generateName(name, usedNames)
  }
}

function newInterface(
  schema: SchemaSchema,
  options: Options,
  rootSchema: JSONSchema,
  processed: Processed,
  usedNames: UsedNames,
  namesById: { [key: string]: string },
  keyName?: string,
  keyNameFromDefinition?: string
): TInterface {
  let name = standaloneName(schema, keyNameFromDefinition, usedNames, namesById)!
  return {
    comment: schema.description,
    keyName,
    params: parseSchema(schema, options, rootSchema, processed, usedNames, namesById, name),
    standaloneName: name,
    superTypes: parseSuperTypes(schema, options, processed, usedNames, namesById),
    type: 'INTERFACE'
  }
}

function parseSuperTypes(
  schema: SchemaSchema,
  options: Options,
  processed: Processed,
  usedNames: UsedNames,
  namesById: { [key: string]: string }
): TNamedInterface[] {
  // Type assertion needed because of dereferencing step
  // TODO: Type it upstream
  const superTypes = schema.extends as SchemaSchema | SchemaSchema[] | undefined
  if (!superTypes) {
    return []
  }
  if (Array.isArray(superTypes)) {
    return superTypes.map(_ => newNamedInterface(_, options, _, processed, usedNames, namesById))
  }
  return [newNamedInterface(superTypes, options, superTypes, processed, usedNames, namesById)]
}

function newNamedInterface(
  schema: SchemaSchema,
  options: Options,
  rootSchema: JSONSchema,
  processed: Processed,
  usedNames: UsedNames,
  namesById: { [key: string]: string }
): TNamedInterface {
  const namedInterface = newInterface(schema, options, rootSchema, processed, usedNames, namesById)
  if (hasStandaloneName(namedInterface)) {
    return namedInterface
  }
  // TODO: Generate name if it doesn't have one
  throw error('Supertype must have standalone name!', namedInterface)
}

/**
 * Helper to parse schema properties into params on the parent schema's type
 */
function parseSchema(
  schema: SchemaSchema,
  options: Options,
  rootSchema: JSONSchema,
  processed: Processed,
  usedNames: UsedNames,
  namesById: { [key: string]: string },
  parentSchemaName: string
): TInterfaceParam[] {

  let asts: TInterfaceParam[] = map(schema.properties, (value, key: string) => ({
    ast: parse(value, options, rootSchema, key, true, processed, usedNames, namesById),
    isPatternProperty: false,
    isRequired: includes(schema.required || [], key),
    isUnreachableDefinition: false,
    keyName: key
  }))

  if ('patternProperties' in schema) {
    asts = asts.concat(map(schema.patternProperties, (value, key: string) => {
      let ast = parse(value, options, rootSchema, key, true, processed, usedNames, namesById)
      let comment = `This interface was referenced by \`${parentSchemaName}\`'s JSON-Schema definition
via the \`patternProperty\` "${key}".`
      ast.comment = ast.comment ? `${ast.comment}\n\n${comment}` : comment
      return ({
        ast,
        isPatternProperty: true,
        isRequired: includes(schema.required || [], key),
        isUnreachableDefinition: false,
        keyName: key
      })
    }))
  }

  if (options.unreachableDefinitions) {
    asts = asts.concat(map(schema.definitions, (value, key: string) => {
      let ast = parse(value, options, rootSchema, key, true, processed, usedNames, namesById)
      let comment = `This interface was referenced by \`${parentSchemaName}\`'s JSON-Schema
via the \`definition\` "${key}".`
      ast.comment = ast.comment ? `${ast.comment}\n\n${comment}` : comment
      return {
        ast,
        isPatternProperty: false,
        isRequired: includes(schema.required || [], key),
        isUnreachableDefinition: true,
        keyName: key
      }
    }))
  }

  // handle additionalProperties
  switch (schema.additionalProperties) {
    case undefined:
    case true:
      return asts.concat({
        ast: T_ANY_ADDITIONAL_PROPERTIES,
        isPatternProperty: false,
        isRequired: true,
        isUnreachableDefinition: false,
        keyName: '[k: string]'
      })

    case false:
      return asts

    // pass "true" as the last param because in TS, properties
    // defined via index signatures are already optional
    default:
      return asts.concat({
        ast: parse(schema.additionalProperties, options, rootSchema, '[k: string]', true, processed, usedNames, namesById),
        isPatternProperty: false,
        isRequired: true,
        isUnreachableDefinition: false,
        keyName: '[k: string]'
      })
  }
}

type Definitions = { [k: string]: JSONSchema }

/**
 * TODO: Memoize
 */
function getDefinitions(
  schema: JSONSchema,
  isSchema = true,
  processed = new Set<JSONSchema>()
): Definitions {
  if (processed.has(schema)) {
    return {}
  }
  processed.add(schema)
  if (Array.isArray(schema)) {
    return schema.reduce((prev, cur) => ({
      ...prev,
      ...getDefinitions(cur, false, processed)
    }), {})
  }
  if (isPlainObject(schema)) {
    return {
      ...(isSchema && hasDefinitions(schema) ? schema.definitions : {}),
      ...Object.keys(schema).reduce<Definitions>((prev, cur) => ({
        ...prev,
        ...getDefinitions(schema[cur], false, processed)
      }), {})
    }
  }
  return {}
}

/**
 * TODO: Reduce rate of false positives
 */
function hasDefinitions(schema: JSONSchema): schema is JSONSchemaWithDefinitions {
  return 'definitions' in schema
}
