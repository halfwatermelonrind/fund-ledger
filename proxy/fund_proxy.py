"""
Fund NAV Proxy — 腾讯云轻量服务器版
从 pingzhongdata 批量拉取确认净值 + 历史走势（无需 Referer，任何 IP 可用）
每 5 分钟刷新，通过 HTTP 提供 JSON。

启动：python3 fund_proxy.py --port 8088
"""
import json, re, time, threading, urllib.request, os
from http.server import HTTPServer, BaseHTTPRequestHandler

PINGZHONG_URL = 'https://fund.eastmoney.com/pingzhongdata/{code}.js?v={ts}'
FETCH_TIMEOUT = 15
CACHE_TTL = 300  # 5 分钟
CONCURRENCY = 5  # 并发数

# 要跟踪的基金代码（前端传参或配置）
DEFAULT_CODES = []

_cache = None
_cache_time = 0
_lock = threading.Lock()

def fetch_one(code, ts):
    """拉取单只基金的历史净值，返回最新两笔"""
    url = PINGZHONG_URL.format(code=code, ts=ts)
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0',
    })
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        text = resp.read().decode('utf-8')

    # 提取基金名称
    name_m = re.search(r'var fS_name = "(.+?)"', text)
    name = name_m.group(1) if name_m else code

    # 提取净值走势
    trend_m = re.search(r'Data_netWorthTrend = (\[.+?\]);', text, re.S)
    if not trend_m:
        return {'c': code, 'n': name, 'v': None, 'd': '', 'vz': None, 'history': []}

    trend = json.loads(trend_m.group(1))
    history = []
    for pt in trend:
        d = time.strftime('%Y-%m-%d', time.gmtime(pt['x'] / 1000 + 8 * 3600))
        history.append({'d': d, 'v': pt['y']})

    last = history[-1] if history else None
    prev = history[-2] if len(history) >= 2 else None

    nav = last['v'] if last else None
    date = last['d'] if last else ''
    vz = None
    if prev and prev['v'] > 0 and nav:
        vz = round((nav - prev['v']) / prev['v'] * 100, 2)

    return {
        'c': code, 'n': name,
        'v': nav, 'd': date, 'vz': vz,
        'history': history[-90:],  # 最近 90 个交易日
    }

def fetch_all(codes):
    """并发拉取所有基金的净值"""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    ts = int(time.time() * 1000)
    results = {}
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(fetch_one, c, ts): c for c in codes}
        for f in as_completed(futures):
            code = futures[f]
            try:
                results[code] = f.result()
            except Exception as e:
                print(f'  {code} FAIL: {e}')
                results[code] = {'c': code, 'n': code, 'v': None, 'd': '', 'vz': None, 'error': str(e)}
    return [results[c] for c in codes if c in results]

def refresh_cache(codes):
    global _cache, _cache_time
    while True:
        try:
            t0 = time.time()
            # 如果没有指定 codes，先获取全量基金列表
            actual_codes = codes if codes else DEFAULT_CODES
            data = fetch_all(actual_codes)
            age = round(time.time() - t0, 1)
            with _lock:
                _cache = data
                _cache_time = time.time()
            print(f'[{time.strftime("%H:%M:%S")}] OK  {len(data)} funds in {age}s')
        except Exception as e:
            print(f'[{time.strftime("%H:%M:%S")}] ERR {e}')
        time.sleep(CACHE_TTL)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        codes_param = params.get('codes', [None])[0]

        # 如果有 codes 参数，立即拉取；否则返回缓存
        if codes_param:
            codes = [c.strip() for c in codes_param.split(',') if c.strip()]
            try:
                data = fetch_all(codes)
                body = json.dumps(data, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            return

        # 返回缓存
        with _lock:
            data = _cache
            age = time.time() - _cache_time if _cache else 0

        if not data:
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b'{"error":"no data, add ?codes=005827,002910 to fetch"}')
            return

        body = json.dumps({
            'updated': _cache_time,
            'age': int(time.time() - _cache_time),
            'funds': data,
        }, ensure_ascii=False).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', f'public, max-age={CACHE_TTL}')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f'[{time.strftime("%H:%M:%S")}] {args[0]}')

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=8088)
    p.add_argument('--host', default='0.0.0.0')
    p.add_argument('--codes', default='', help='Comma-separated fund codes to track')
    args = p.parse_args()

    codes = [c.strip() for c in args.codes.split(',') if c.strip()]

    # 首次拉取
    if codes:
        print(f'Loading {len(codes)} funds...')
        try:
            data = fetch_all(codes)
            _cache = data
            _cache_time = time.time()
            print(f'OK  {len(data)} funds loaded')
        except Exception as e:
            print(f'Initial fetch failed: {e}')

    # 后台刷新
    t = threading.Thread(target=refresh_cache, args=(codes,), daemon=True)
    t.start()

    server = HTTPServer((args.host, args.port), Handler)
    print(f'Listening on http://{args.host}:{args.port}')
    print(f'Try: curl http://{args.host}:{args.port}/?codes=005827,002910')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down...')
        server.shutdown()
