/**
 * Cloudflare Worker — FundGuZhi API Proxy with cache
 *
 * Deploy:
 *   1. Go to https://dash.cloudflare.com/ → Workers & Pages → Create
 *   2. Paste this file → Deploy
 *   3. Copy the worker URL (e.g. https://fund-proxy.xxx.workers.dev)
 *   4. Build frontend with: VITE_FUNDGZ_PROXY=https://fund-proxy.xxx.workers.dev
 *
 * The worker fetches from eastmoney API with correct Referer,
 * processes the data into compact JSON (~4 MB), and caches for 5 min.
 */

const CACHE_TTL = 300 // 5 minutes
const EASTMONEY_URL =
  'https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList?type=1&sort=3&orderType=desc&canbuy=0&pageIndex=1&pageSize=23672'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // CORS headers
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    // Try cache first
    const cacheUrl = new URL(request.url)
    const cacheKey = new Request(cacheUrl.toString(), request)
    const cache = caches.default
    let response = await cache.match(cacheKey)
    if (response) return response

    try {
      // Fetch from eastmoney
      const apiResp = await fetch(EASTMONEY_URL, {
        headers: {
          'Referer': 'https://fund.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; FundProxy/1.0)',
        },
      })

      if (!apiResp.ok) {
        return new Response(JSON.stringify({ error: `Upstream ${apiResp.status}` }), {
          status: 502, headers,
        })
      }

      const raw = await apiResp.json()
      if (raw.ErrCode !== 0 || !raw.Data?.list) {
        return new Response(JSON.stringify({ error: `API ErrCode=${raw.ErrCode}`, msg: raw.ErrMsg }), {
          status: 502, headers,
        })
      }

      // Process into compact format
      function clean(v) {
        if (v == null || v === '' || v === '---') return null
        const s = String(v).replace(/%$/, '')
        const n = parseFloat(s)
        return isNaN(n) ? null : n
      }

      const out = {
        gzrq: raw.Data.gzrq,
        gxrq: raw.Data.gxrq,
        funds: raw.Data.list.map((f) => ({
          c: f.bzdm,
          n: f.jjjc,
          e: clean(f.gsz),
          ez: clean(f.gszzl),
          v: f.dwjz === '---' ? null : parseFloat(f.dwjz),
          vz: clean(f.jzzzl),
          d: f.gzrq,
          t: f.gxrq,
        })),
      }

      // Also fix the — values for NAV
      for (const f of out.funds) {
        if (f.v == null || isNaN(f.v)) f.v = null
      }

      const body = JSON.stringify(out)

      response = new Response(body, { headers })
      // Set CDN cache for 5 minutes; stale-while-revalidate for 30 min
      response.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`)
      response.headers.set('CDN-Cache-Control', `max-age=${CACHE_TTL}`)

      // Store in Cloudflare cache
      ctx.waitUntil(cache.put(cacheKey, response.clone()))

      return response
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502, headers,
      })
    }
  },
}
