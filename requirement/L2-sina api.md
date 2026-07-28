# 第2层：新浪基金盘中估值接口 — 获取逻辑（已实测验证 2026-07-28）

## 接口说明

```
GET https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic?symbol={基金代码}&callback={回调名}
```

- 只能 **JSONP** 调用：返回的是 JS 回调包裹，开头带一行 `/*...*/` 防采集注释，用 `<script>` 标签加载时天然兼容；
- 不校验 Referer，无跨域问题（script 标签不受 CORS 限制）；
- 覆盖价值：东财 FundValuationLast 返回 null 的主动基金（110022、021876 等）在此有完整估值曲线，是三层架构第2层的补盲来源。

## 响应结构

`result.data` 下真正有用的两个部分：

| 字段 | 含义 | 示例 |
|---|---|---|
| `networth` 数组 | 分钟级盘中预估曲线（约 231 个点，09:30~16:00），**取最后一个元素即最新估值** | 见下方实测样本 |
| `worth` / `worth_date` / `worth_rate` | 最新确认净值 / 净值日期 / 确认涨跌幅 | `2.9590 / 20260728 / 0.0175` |

曲线每个点的字段：`min_time`（时间）、`pre_nav`（预估净值）、`nav_pct`（预估涨跌幅）、`pre_nav2` / `nav2_pct`（备选模型估值，可与主模型互相校验）、`pre_date`（估值所属交易日）。

**单位注意：`nav_pct` 是百分数（`1.6282` = +1.63%）；`worth_rate` 是小数（`0.0175` = +1.75%），别混。**

## 完整实现代码

```js
/**
 * 新浪基金盘中估值（三层架构第2层）
 * 接口: FdFundService.getEstimateNetworthPic (JSONP, 不校验Referer)
 * 实测覆盖: 东财 FundValuationLast 返回 null 的主动基金(110022/021876等)在此有完整曲线
 */

const _sinaCache = new Map();      // code -> { data, ts }
const _sinaInflight = new Map();   // code -> Promise  (防并发重复加载)
const SINA_CACHE_MS = 15 * 1000;   // 15秒缓存
const SINA_TIMEOUT_MS = 8000;

function jsonpLoad(url, callbackName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('sina jsonp timeout'));
    }, SINA_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
      script.remove();
    };

    window[callbackName] = (json) => { cleanup(); resolve(json); };

    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => { cleanup(); reject(new Error('sina jsonp load failed')); };
    document.head.appendChild(script);
  });
}

/**
 * 获取单只基金的新浪盘中估值
 * @returns {Promise<{
 *   code: string,
 *   estimateNav: number,      // 预估净值(曲线末点)
 *   estimatePct: number,      // 预估涨跌幅，单位%(如 1.63 表示 +1.63%)
 *   estimateNav2: number|null,// 备选模型预估净值(可与主模型互相校验)
 *   estimatePct2: number|null,
 *   estimateDate: string,     // 估值所属交易日 'YYYY-MM-DD'
 *   estimateTime: string,     // 末点时间 'HH:MM:SS'
 *   confirmedNav: number|null,// 最新确认净值
 *   confirmedDate: string|null,
 *   source: 'sina'
 * }>}
 * @throws 当该基金无新浪估值数据时(响应正常但 networth 为空)
 */
async function fetchSinaEstimate(code) {
  // 1. 缓存命中直接返回
  const hit = _sinaCache.get(code);
  if (hit && Date.now() - hit.ts < SINA_CACHE_MS) return hit.data;

  // 2. 并发去重
  if (_sinaInflight.has(code)) return _sinaInflight.get(code);

  const p = (async () => {
    const cb = `__sinaEst_${code}_${Date.now()}`;
    const url = `https://stock.finance.sina.com.cn/fundInfo/api/openapi.php` +
                `/FdFundService.getEstimateNetworthPic?symbol=${code}&callback=${cb}`;

    const json = await jsonpLoad(url, cb);
    const data = json?.result?.data;
    const curve = Array.isArray(data?.networth) ? data.networth : [];

    // 无估值数据(主动基金中的极少数/无效代码): 触发降级到第3层
    if (curve.length === 0) {
      throw new Error(`sina no estimate for ${code}`);
    }

    // 取曲线末点 = 最新估值
    const last = curve[curve.length - 1];
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

    const result = {
      code,
      estimateNav: num(last.pre_nav),
      estimatePct: num(last.nav_pct),        // 已是百分数, 直接使用
      estimateNav2: num(last.pre_nav2),
      estimatePct2: num(last.nav2_pct),
      estimateDate: last.pre_date || null,
      estimateTime: last.min_time || null,
      confirmedNav: num(data.worth),
      confirmedDate: data.worth_date || null, // 'YYYYMMDD' 格式
      source: 'sina',
    };

    if (result.estimateNav === null || result.estimatePct === null) {
      throw new Error(`sina estimate fields null for ${code}`);
    }

    _sinaCache.set(code, { data: result, ts: Date.now() });
    return result;
  })().finally(() => _sinaInflight.delete(code));

  _sinaInflight.set(code, p);
  return p;
}

// ============ 接入三层降级链的调用示例 ============
async function getFundEstimate(code) {
  // 第1层: 东财官方估值(批量接口,略)
  const em = await fetchEastmoneyEstimate(code).catch(() => null);
  if (em && em.estimateNav !== null) return em;

  // 第2层: 新浪估值曲线末点
  const sina = await fetchSinaEstimate(code).catch(() => null);
  if (sina) return sina;

  // 第3层: 自算(跟踪标的法/重仓加权法,略)
  return fetchSelfCalcEstimate(code);
}
```

## 实测样本（2026-07-28，供单元测试断言用）

| 基金 | networth 点数 | 末点 pre_nav / nav_pct | 当日实际净值 | 偏差 |
|---|---|---|---|---|
| 021876 | 231 | 1.8750 / -0.24% | 1.8701（-0.51%） | 0.27pp |
| 110022 | 231 | 2.9553 / +1.63% | 2.9590（+1.75%） | 0.13pp |
| 999999（无效代码） | 0 | —（应抛错降级） | — | — |

## 三个实现提醒

1. 响应 `status.code` 即使为 0，无效代码的 `networth` 也是空的，**必须以 `networth.length > 0` 作为有数据的判断标准**，不能只看 HTTP 成功；
2. 非交易时段接口照常返回（给的是最近一个交易日的完整曲线），用 `estimateDate` 与今天日期比对来标注"已收盘"；
3. 末点时间会到 16:00 左右（覆盖 15:00 收盘后的尾盘修正），取末点即可，不用自己截 15:00。
