/**
 * Cloudflare Worker — FundGuZhi API Proxy
 *
 * Deploy to Cloudflare Workers (free tier: 100k req/day):
 *   1. Create a Cloudflare account at https://dash.cloudflare.com/
 *   2. Workers & Pages → Create Worker
 *   3. Paste this file content → Deploy
 *   4. Copy the worker URL (e.g. https://fund-proxy.your-subdomain.workers.dev)
 *   5. Set VITE_FUNDGZ_PROXY in your build environment
 */

export default {
  async fetch(request) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const url = new URL(request.url)
    const targetUrl = 'https://api.fund.eastmoney.com' + url.pathname + url.search

    const response = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://fund.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0',
      },
    })

    const body = await response.text()

    return new Response(body, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=120',  // 2 min CDN cache
      },
    })
  },
}
