export interface Env {
  DB: D1Database
  MAPTILER_KEY?: string // Secret aus .dev.vars (lokal) bzw. Pages-Env (Prod); nie ins Bundle
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  })
}

export function badRequest(message: string, status = 400): Response {
  return json({ error: message }, { status })
}
