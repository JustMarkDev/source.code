/**
 * The stability promise, as a check. Within v1 we only add. This compares the
 * committed OpenAPI document with the one the code produces and lists every
 * change a client written against the old one could trip over. An empty list
 * means the change is additive.
 *
 * Breaking:
 *  - an operation, a response status or a response member is gone
 *  - a response member's type changed
 *  - a request member, parameter or enum value a client may send is gone
 *  - a request member or parameter became required, or a new one is required
 */
type Json = Record<string, any>

export function findBreaking(before: Json, after: Json): Array<string> {
  const out: Array<string> = []
  const resolve = (doc: Json, schema: Json | undefined): Json | undefined => {
    let s = schema
    for (let i = 0; s && typeof s.$ref === 'string' && i < 10; i++) {
      const name = s.$ref.replace('#/components/schemas/', '')
      s = doc.components?.schemas?.[name]
    }
    return s
  }

  const typeOf = (s: Json | undefined) =>
    s ? JSON.stringify(s.type ?? s.const ?? (s.anyOf ? 'anyOf' : s.$ref ? 'ref' : '?')) : 'none'

  const response = (path: string, a: Json | undefined, b: Json | undefined, depth = 0) => {
    const x = resolve(before, a)
    const y = resolve(after, b)
    if (!x || depth > 6) return
    if (!y) return void out.push(`${path}: response member removed`)
    if (x.properties) {
      for (const [k, v] of Object.entries<Json>(x.properties)) {
        const w = y.properties?.[k]
        if (!w) out.push(`${path}.${k}: response member removed`)
        else {
          const tv = typeOf(resolve(before, v))
          const tw = typeOf(resolve(after, w))
          if (tv !== tw && tv !== '"object"' && tw !== '"object"')
            out.push(`${path}.${k}: type changed from ${tv} to ${tw}`)
          for (const e of v.enum ?? [])
            if (w.enum && !w.enum.includes(e)) out.push(`${path}.${k}: enum value ${e} removed`)
          if (v.anyOf && w.anyOf) {
            const afterTypes = new Set((w.anyOf as Array<Json>).map(typeOf))
            for (const variant of v.anyOf as Array<Json>)
              if (!afterTypes.has(typeOf(variant))) out.push(`${path}.${k}: response variant ${typeOf(variant)} removed`)
          }
          response(`${path}.${k}`, v, w, depth + 1)
        }
      }
    }
    if (x.items) response(`${path}[]`, x.items, y.items, depth + 1)
  }

  const request = (path: string, a: Json | undefined, b: Json | undefined, depth = 0) => {
    const x = resolve(before, a)
    const y = resolve(after, b)
    if (!x || depth > 6) {
      // A schema that did not exist before: anything required is new.
      if (!x && y?.required?.length) out.push(`${path}: new required ${y.required.join(', ')}`)
      return
    }
    if (!y) return void out.push(`${path}: request schema removed`)
    for (const k of Object.keys(x.properties ?? {}))
      if (!y.properties?.[k]) out.push(`${path}.${k}: request member removed`)
    const was = new Set<string>(x.required ?? [])
    for (const k of y.required ?? [])
      if (!was.has(k)) out.push(`${path}.${k}: became required`)
    for (const [k, v] of Object.entries<Json>(x.properties ?? {})) {
      const w = y.properties?.[k]
      if (!w) continue
      const tv = typeOf(resolve(before, v))
      const tw = typeOf(resolve(after, w))
      if (tv !== tw) out.push(`${path}.${k}: request type changed from ${tv} to ${tw}`)
      for (const e of v.enum ?? [])
        if (!(w.enum ?? []).includes(e) && w.enum) out.push(`${path}.${k}: enum value ${e} removed`)
      request(`${path}.${k}`, v, w, depth + 1)
    }
  }

  for (const [path, item] of Object.entries<Json>(before.paths ?? {})) {
    for (const [method, op] of Object.entries<Json>(item)) {
      const where = `${method.toUpperCase()} ${path}`
      const next = after.paths?.[path]?.[method]
      if (!next) {
        out.push(`${where}: operation removed`)
        continue
      }
      if (op.operationId !== next.operationId)
        out.push(`${where}: operationId changed from ${op.operationId} to ${next.operationId}`)
      for (const status of Object.keys(op.responses ?? {})) {
        const a = op.responses[status]?.content
        const b = next.responses?.[status]?.content
        if (!next.responses?.[status]) out.push(`${where}: response ${status} removed`)
        else if (a)
          for (const type of Object.keys(a))
            response(`${where} ${status}`, a[type]?.schema, b?.[type]?.schema)
      }
      const oldParams = new Map<string, Json>((op.parameters ?? []).map((p: Json) => [`${p.in}:${p.name}`, p]))
      const newParams = new Map<string, Json>((next.parameters ?? []).map((p: Json) => [`${p.in}:${p.name}`, p]))
      for (const [k, p] of oldParams) {
        const q = newParams.get(k)
        if (!q) out.push(`${where}: parameter ${k} removed`)
        else {
          if (!p.required && q.required) out.push(`${where}: parameter ${k} became required`)
          for (const e of p.schema?.enum ?? [])
            if (q.schema?.enum && !q.schema.enum.includes(e))
              out.push(`${where}: parameter ${k} enum value ${e} removed`)
        }
      }
      for (const [k, q] of newParams)
        if (!oldParams.has(k) && q.required) out.push(`${where}: new required parameter ${k}`)
      request(
        `${where} body`,
        op.requestBody?.content?.['application/json']?.schema,
        next.requestBody?.content?.['application/json']?.schema,
      )
      if (!op.requestBody && next.requestBody?.required)
        out.push(`${where}: new required request body`)
      else if (op.requestBody && !op.requestBody.required && next.requestBody?.required)
        out.push(`${where}: request body became required`)
    }
  }
  return out
}
