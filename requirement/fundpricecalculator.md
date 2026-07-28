# 任务：为基金账簿 PWA 实现"盘中估值"模块（三层 Fallback 架构）

## 0. 项目背景

我有一个基金交易账簿 PWA，纯前端（React/Vite 或原生 JS 均可，以现有工程为准），部署在 **GitHub Pages** 上。需要一个"盘中估值"功能：交易时段内展示每只持仓基金的实时估算净值与估算涨跌幅。

**核心约束（必须遵守）：**
- 不允许引入任何后端/代理/云函数，所有数据必须**浏览器直连公开接口**获取；
- 页面运行在 `https://*.github.io` 域名下，所有跨域接口必须确认 `Access-Control-Allow-Origin` 放开或支持 JSONP；
- 禁止使用的接口见第 4 节"已封死的方案清单"，不要重蹈覆辙。

## 1. 总体架构：三层 Fallback

对每只基金，按以下优先级取估值，上层无数据自动降级，用户无感知：

```
第1层：东财官方估值（FundValuationLast 接口，批量）
   ↓ 该基金 GSZ 为 null 或请求失败
第2层：新浪估值曲线（JSONP，取曲线末点）
   ↓ 仍无数据
第3层：自算估值（跟踪标的/重仓股实时行情加权，β 回归校准）
```

每只基金的估值结果必须附带 `source` 字段（`eastmoney / sina / self_calc`），UI 上以角标区分来源。

---

## 2. 接口规格（均已实测验证，直接照抄）

### 2.1 第1层：东财官方估值【2026-07-28 实测可用】

```
GET https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast
    ?FCODES=020501,161725        # 批量，逗号分隔，单次最多 50 只
    &FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE
```

- **跨域**：响应头 `Access-Control-Allow-Origin: *`，不校验 Referer，直接 `fetch` 即可；
- **实测响应**：

```json
{"data":[{"NAV":1.4947,"GZTIME":"2026-07-28 15:00","SHORTNAME":"广发中证港股通非银ETF发起式联接C","FCODE":"020501","PDATE":"2026-07-27","GSZZL":0.07,"GSZ":1.4957}],"errorCode":0,"success":true}
```

- 字段：`GSZ`=估算净值，`GSZZL`=估算涨跌幅(%)，`NAV`=最新确认净值，`PDATE`=净值日期，`GZTIME`=估值时间；
- **关键边界情况**：部分基金（尤其主动权益基金，如 110022）`GSZ`/`GSZZL` 返回 `null`——**这不是错误，是触发降级的信号**；
- 建议 10 秒级内存缓存，避免频繁请求。

### 2.2 第2层：新浪估值曲线（JSONP）

```
https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic?symbol={基金代码}&callback={回调名}
```

- 用动态 `<script>` 标签注入实现 JSONP，全局注册回调函数，用完清理；
- 返回该基金的盘中估值曲线（时间序列），**取最后一个点**作为当前估值值/涨跌幅；
- 此接口规格来自开源项目 hzm0321/real-time-fund 源码（`app/api/fund.js`），实现时请先实际调用一次确认响应结构再写解析逻辑。

### 2.3 第3层：自算估值（三个子接口，均已实测 CORS 放开）

**a) 基金持仓（判断跟踪标的）**

```
GET https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition
    ?FCODE={代码}&deviceid=1&plat=Android&product=EFund&version=6.2.8
```

- 返回 `Datas.fundStocks`（股票持仓数组，含 `GPDM`股票代码、`GPJC`名称、`JZBL`占净值比例%）、`Datas.ETFCODE`（目标ETF代码）、`Expansion`（持仓披露日期）；
- **已实测的两种情况**：
  - 指数/主动基金：`fundStocks` 有数据（如 161725 返回十大重仓）；
  - **ETF 联接基金（如 020501）：`fundStocks` 为空数组，但 `ETFCODE: "513750"` 有值**——此时直接跟踪目标 ETF 实时价，不要用持仓加权。

**b) 历史净值（回归校准用）**

```
GET https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList
    ?FCODE={代码}&pageIndex=1&pageSize=40&deviceid=1&plat=Android&product=EFund&version=6.2.8
```

- 返回 `Datas[]`：`FSRQ`日期、`DWJZ`单位净值、`JZZZL`日涨幅(%)。拉最近 40 条用于回归。

**c) 股票/ETF/指数实时行情（腾讯）**

```
GET https://qt.gtimg.cn/q=sh513750,sz399997,sh600519   # 批量逗号分隔
```

- **注意：响应是 GBK 编码的 JS 变量赋值文本**，必须 `fetch` → `arrayBuffer()` → `TextDecoder('gbk')` 解码；
- 每行格式 `v_sh513750="1~名称~代码~现价~昨收~今开~..."`，按 `~` 切分后：下标 3=现价，下标 4=昨收；
- 涨跌幅 = (现价/昨收 - 1) × 100；
- 代码前缀规则：沪市（6 开头股票、5 开头 ETF、000 开头指数如 000300）用 `sh`，深市（0/3 开头股票、15 开头 ETF、399 开头指数）用 `sz`。

**自算公式（按基金类型二选一）：**

1. **跟踪标的法**（指数基金 / ETF联接，优先使用）：
   ```
   估算涨幅 = β × 标的实时涨幅 + α
   估算净值 = 昨收净值 × (1 + 估算涨幅/100)
   ```
   - 标的确定顺序：`ETFCODE` 有值 → 目标 ETF；否则查映射表（见 2.4）→ 跟踪指数；
   - **β、α 校准**：取最近 30 个交易日"基金日涨幅 vs 标的历史日涨幅"做一元最小二乘回归，结果持久化到 localStorage，每周重算一次。指数历史行情可用腾讯日 K 接口 `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh513750,day,,,40,qfq`（实现前先验证响应结构）。

2. **重仓加权法**（主动基金，无跟踪标的时）：
   ```
   估算涨幅 = Σ(十大重仓 w_i × 个股涨幅_i) × (股票总仓位 ÷ 十大重仓合计权重)
   ```
   - 最后一项是**覆盖率修正**（假设未披露持仓与重仓股表现相当），股票总仓位取基金定期报告披露值，可先硬编码为配置项；
   - 必须输出 `coverage`（十大重仓合计权重），UI 上展示"估值覆盖率 xx%"。

### 2.4 跟踪指数映射表

开源项目已整理好 6159 只基金的映射：`https://raw.githubusercontent.com/hzm0321/real-time-fund/HEAD/doc/fund_tracking_targets.csv`（格式：`fund_code,related_sector`）。

**不要运行时请求 GitHub raw（内地访问不稳）**：构建时把这个 CSV 下载一份放进仓库 `data/fund_tracking_targets.csv`，前端读自己仓库的文件。

---

## 3. 工程要求

1. **批量合并（DataLoader 模式）**：页面同时持仓多只基金时，把估值请求按 50 只/批合并成一次 HTTP 调用，参考 hzm0321/real-time-fund 的 `processFundValuationLastQueue` 实现思路；
2. **交易时段感知**：仅工作日 9:15–15:00 自动刷新估值（间隔 15~30 秒），非交易时段展示最后一次估值；
3. **每日误差回测**：每晚净值公布后，用 2.3-b 拉真实净值，与当日 15:00 时的估值对比，把 `{date, code, source, predicted, actual, error, coverage}` 追加存进 IndexedDB/localStorage；
4. **置信度标签**：UI 上每只基金显示估值来源角标 + 最近 20 天平均绝对误差（MAE），MAE > 0.8% 的基金标注"估值偏差较大"；
5. **回归自修正**：第3层的 β 系数若连续 5 个交易日误差 > 0.5%，自动用最新 30 天数据重算；
6. **优雅降级**：所有接口都要 try/catch + 超时（8 秒），任一数据源挂了只降级不报错，页面永远显示最近一次有效数据；
7. 代码组织：数据访问层（三个数据源各自一个模块）与算法层（回归、加权、回测）分离，方便日后换源。

## 4. 已封死的方案清单（踩坑记录，勿用）

| 接口/方案 | 状态 | 原因 |
|---|---|---|
| `fundgz.1234567.com.cn/js/{code}.js` | ❌ 已下线 | 2026 年监管整治后全量 301 到 notfound |
| `api.fund.eastmoney.com/FundGuZhi/GetFundGZList` | ❌ 风控 | Referer 白名单（仅东财域名）+ 封境外/IDC 机房 IP，服务器代理、Cloudflare Worker、GitHub Actions 全部实测被拦 |
| `fundmobapi` 的 `FundMNFInfo` 接口 | ❌ 字段已清空 | 接口活着但 `GSZ/GSZZL` 恒为 null |
| GitHub Actions 定时快照 | ❌ 不可行 | Actions 的 Azure IP 被东财封禁 |
| Cloudflare Worker 代理 | ❌ 不可行 | Worker 境外 IP 被封 + workers.dev 内地访问不稳 |

## 5. 验收测试用例

用以下真实基金代码做联调验收（2026-07 数据）：

| 基金代码 | 类型 | 预期行为 |
|---|---|---|
| 020501 | ETF联接（港股通非银） | 第1层有官方估值；第3层兜底走"目标 ETF 513750 跟踪法" |
| 161725 | 指数LOF（招商白酒） | 第1层有官方估值；第3层兜底走"中证白酒指数 sz399997 跟踪法" |
| 110022 | 主动权益（易方达消费） | **第1层 GSZ 为 null → 自动降级第2/3层**，第3层走十大重仓加权 + 覆盖率修正 |

验收标准：
1. 交易时段打开页面，三只基金均显示估值值与涨跌幅，且来源角标正确；
2. 断网后页面显示最后一次数据不白屏；
3. 收盘后 20:00 再打开，能看到当日"估值 vs 实际净值"的误差记录已入库；
4. 在 GitHub Pages 实际部署环境下（非 localhost）全部功能正常——**这是硬指标，localhost 能跑不算数**。

## 6. 交付物

- 估值模块完整代码（数据层 + 算法层 + UI 组件），合入现有账簿工程；
- `data/fund_tracking_targets.csv` 已下载入仓库；
- 一段简短的模块说明（数据源、降级逻辑、配置项），写进项目 README。
