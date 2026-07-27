/**
 * Cloudflare Worker — Fund NAV Proxy
 * Fetches pingzhongdata per fund (no Referer check, any IP works).
 * Cache: 5 min CDN. Supports ?codes=005827,002910 query param.
 *
 * Deploy to Cloudflare Workers, then build frontend with:
 *   VITE_FUNDGZ_PROXY=https://your-worker.workers.dev
 */
const CACHE_TTL = 300 // 5 minutes
const CONCURRENCY = 5

async function fetchOne(code, ts) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${ts}`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const text = await resp.text()

  // Extract fund name
  const nameMatch = text.match(/var fS_name = "(.+?)"/)
  const name = nameMatch ? nameMatch[1] : code

  // Extract NAV trend
  const trendMatch = text.match(/Data_netWorthTrend = (\[.+?\])/s)
  if (!trendMatch) return { c: code, n: name, v: null, d: '', vz: null }

  const trend = JSON.parse(trendMatch[1])
  const last = trend[trend.length - 1]
  const d = new Date(last.x + 8 * 3600 * 1000)
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const nav = last.y

  let vz = null
  if (trend.length >= 2) {
    const prev = trend[trend.length - 2]
    if (prev.y > 0) vz = Math.round((nav - prev.y) / prev.y * 10000) / 100
  }

  return { c: code, n: name, v: nav, d: date, vz }
}

async function fetchAll(codes) {
  const ts = Date.now()
  const results = []
  // Fetch in batches with concurrency limit
  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(c => fetchOne(c, ts))
    )
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value)
      else results.push({ c: 'error', n: '', v: null, d: '', vz: null, error: r.reason?.message })
    }
  }
  return results
}

export default {
  async fetch(request, env, ctx) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    const url = new URL(request.url)
    const codesParam = url.searchParams.get('codes')

    if (!codesParam) {
      return new Response(
        JSON.stringify({ error: 'add ?codes=005827,002910 to query' }),
        { status: 400, headers }
      )
    }

    const codes = codesParam.split(',').map(c => c.trim()).filter(Boolean)

    // Check cache
    const cacheKey = new Request(url.toString(), request)
    const cache = caches.default
    let response = await cache.match(cacheKey)
    if (response) return response

    try {
      const data = await fetchAll(codes)
      const body = JSON.stringify(data)

      response = new Response(body, { headers })
      response.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`)
      response.headers.set('CDN-Cache-Control', `max-age=${CACHE_TTL}`)

      ctx.waitUntil(cache.put(cacheKey, response.clone()))
      return response
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 502, headers }
      )
    }
  },
}
