# 基金交易信号页 — 实现 Prompt

> 将此文档发给 Claude，实现一个基于 R1-R8 v2.0 规则的交易信号页面。

---

## 1. 功能概述

在现有的基金交易账簿应用中，新增一个「交易信号」页面，自动扫描所有持仓，对照 R1-R8 规则引擎，生成操作信号和观察提醒。

### 页面入口
- **移动端**：底部 TabBar 第 5 个 Tab，图标为折线图/信号波（`<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`），标签「信号」
- **桌面端**：顶部导航栏第 3 个 Tab，标签「交易信号」
- 切换到该页时自动执行 `computeSignals()` 并渲染

### 数据来源
- 持仓数据：从现有的 `computeHoldings()` 获取（份额、成本、已实现盈亏、累计分红、交易记录、建仓日期）
- 净值数据：从现有的 `NAV_DATA[code]` 获取（`dwjz` 已确认净值、`gsz` 实时估值、`gszzl` 涨跌幅）
- 交易记录：每只基金的 `txs` 数组，用于计算建仓日期、最近加仓价等

---

## 2. UI 设计

### 2.1 移动端（h5.html）

**二级 Tab**：顶部两个过滤胶囊
```
[⚡ 操作信号（N）] [👁 观察提醒（M）]
```
- 点击切换显示，N/M 为动态计数

**信号卡片列表**：每张卡片结构如下

```
┌──┬──────────────────────────────┐
│  │ [R5]          华夏成长·000001│  ← 规则标签 + 基金名·代码
│  │                              │
│  │ 收益率 -24.7%，触发分步清仓  │  ← 信号标题（14px bold）
│  │ 第三档                       │
│  │                          ▾   │  ← 展开箭头
├──┴──────────────────────────────┤  ← 点击展开
│  规则    收益率 < -20% → 清仓   │
│  当前    -24.70%                │
│  建议    清仓                   │
│  风险    若不执行，继续下跌...   │
└────────────────────────────────┘
```

关键 CSS：
- 卡片左侧 4px 色条 `.sig-bar`：
  - `reduce`（减仓/清仓）→ `background: var(--loss)` 绿色
  - `add`（加仓）→ `background: var(--accent)` 深蓝
  - `watch`（观察）→ `background: var(--warn)` 橙色
- 标签 pill `.sig-tag`：同色系
- 卡片圆角 8px，阴影 `0 1px 2px rgba(0,0,0,.05)`
- 展开箭头 `.sig-arrow` 默认向下，卡片 `.open` 时旋转 180°
- 所有卡片默认高度一致（详情折叠），点击展开

### 2.2 桌面端（pc.html）

表格式布局：优先级 | 规则 | 基金 | 信号内容 | 操作

- 规则列使用彩色 pill 标签（reduce=绿，add=蓝，watch=橙）
- 优先级列使用 emoji 标记（🔴 最高 / 🟠 高 / 🟡 中 / 🔵 缓冲期 / 🟢 接近）

---

## 3. 规则引擎（R1-R8 v2.0）

### 3.1 引擎入口

```js
function computeSignals() {
  const holdings = computeHoldings();  // 获取所有持仓
  const now = new Date();
  const signals = [];

  holdings.forEach(holding => {
    // 跳过零持仓且未标记清仓的基金
    if (holding.shares <= 0 && !holding.cleared) return;

    const navData = NAV_DATA[holding.code] || {};
    const nav = navData.dwjz || 0;         // 已确认净值
    const marketValue = holding.shares * nav;
    const cost = holding.cost;
    if (cost <= 0) return;

    const totalPnL = marketValue - cost + holding.realizedPnL + holding.totalDividends;
    const rate = (totalPnL / cost) * 100;    // 当前收益率 %

    // 基金类型 → 动态阈值
    const fundType = classifyFund(holding.code); // 'wide' | 'sector' | 'active'
    const threshold = fundType === 'sector' ? -5 : -3;

    // 建仓天数
    const buildDate = getEarliestTransactionDate(holding);
    const buildDays = Math.floor((now - new Date(buildDate)) / 86400000);

    // R_max（历史最高收益率）
    const rMax = getRMax(holding, rate);

    // --- 逐条评估 ---
    evaluateR5(signals, holding, rate);
    evaluateR1(signals, holding, rate, threshold, buildDays);
    evaluateR4(signals, holding, rate, rMax);
    evaluateR8(signals, holding, rate, buildDays);
    evaluateR3(signals, holding, rate, rMax);
  });

  // 按优先级排序
  signals.sort((a, b) => priorityRank(a.prio) - priorityRank(b.prio));
  return signals;
}
```

### 3.2 基金类型分类

```js
function classifyFund(code) {
  // 宽基指数：沪深300、中证500 等 → 'wide'，阈值 -3%
  // 行业 ETF → 'sector'，阈值 -5%
  // 主动管理基金 → 'active'，阈值 -3%
  // QDII/跨境 → 'sector'，阈值 -5%
  if (['000961', '011363'].includes(code)) return 'wide';
  if (['161725'].includes(code)) return 'sector';
  return 'active';
}
```

### 3.3 R5：分步清仓线（最高优先级）

```
触发条件：收益率分三档
  第一档：收益率 < -10% → 减仓 50%（剩余 50%）
  第二档：收益率 < -15% → 再减仓 50%（剩余 25%）
  第三档：收益率 < -20% → 清仓剩余 25%（剩余 0%）

波动率自适应（可选）：
  高波动基金（年化 > 30%）→ -15%/-20%/-25%
  低波动基金（年化 < 15%）→ -8%/-12%/-15%

优先级：最高（覆盖 R1 和 R4）

信号对象：
{
  type: 'action',
  dir: 'reduce',
  rule: 'R5',
  prio: '最高',
  fund: holding,
  title: `收益率 ${rate}%，触发分步清仓第X档`,
  detail: [
    { l: '规则', v: `收益率 < ${tierThreshold}% → ${action}` },
    { l: '当前收益率', v: `${rate}%`, c: rate > 0 ? 'pnl-up' : 'pnl-down' },
    { l: '建议操作', v: action },
    { l: '风险', v: '若不执行，继续下跌将触发下一档' }
  ],
  bar: 'reduce'
}

注意：R5 第三档触发时，该基金不再评估其他规则（return）
```

### 3.4 R1：动态缓冲防线（高优先级）

```
触发条件（必须同时满足）：
  1. 建仓满 20 个交易日（缓冲期）
  2. 当前收益率 < 动态阈值
  3. 收益率 >= -10%（未触发 R5）

动态阈值：
  宽基/主动基：-3%
  行业 ETF/QDII：-5%

操作：减仓 30%

缓冲期内 → 观察提醒
缓冲期后 → 操作信号

信号对象（触发时）：
{ type:'action', dir:'reduce', rule:'R1', prio:'高', bar:'reduce' }

信号对象（缓冲期内）：
{ type:'watch', rule:'R1', prio:'缓冲期', bar:'watch' }
```

### 3.5 R4：利润保护线（高优先级）

```
触发条件：
  1. R_max > 10%（历史最高收益率曾超过 10%）
  2. 当前收益率 < R_max × 50%（利润回撤超过一半）

R_max 计算：
  - 初始值 = 建仓时的收益率（通常为 0）
  - 每次计算时 if (当前收益率 > R_max) R_max = 当前收益率
  - R_max 只增不减（存储在 holding._rmax 或独立字段）

操作：减仓 30%

信号对象：
{ type:'action', dir:'reduce', rule:'R4', prio:'高', bar:'reduce' }
```

### 3.6 R8：时间止损（高优先级）

```
触发条件：
  持仓满 6 个月 + 收益率持续 < -3% → 减仓 50%
  持仓满 12 个月 + 收益率持续 < -3% → 清仓

信号对象：
{ type:'action', dir:'reduce', rule:'R8', prio:'高', bar:'reduce' }
```

### 3.7 R3：浮盈加仓控制（中优先级）

```
触发条件：
  当前收益率 > 0%（整体浮盈）
  且 R_max < 15%（薄利润垫）

操作：允许加仓 ≤ 计划总仓位的 10%

信号对象：
{ type:'watch', dir:'add', rule:'R3', prio:'中', bar:'add',
  title: `薄利润垫（R_max ${rMax}%），可小额加仓` }
```

### 3.8 优先级排序

```js
const PRIORITY_ORDER = { '最高': 0, '高': 1, '中': 2, '接近': 3, '缓冲期': 4 };
```

---

## 4. 渲染逻辑

```js
function renderSignals() {
  const allSignals = computeSignals();
  const actionSignals = allSignals.filter(s => s.type === 'action');
  const watchSignals = allSignals.filter(s => s.type === 'watch');

  // 更新二级 Tab 计数
  document.getElementById('sig-cnt-action').textContent = `（${actionSignals.length}）`;
  document.getElementById('sig-cnt-watch').textContent = `（${watchSignals.length}）`;

  // 根据当前筛选展示
  const data = currentFilter === 'action' ? actionSignals : watchSignals;

  // 渲染卡片列表
  listEl.innerHTML = data.map(s => `
    <div class="sig-card" onclick="toggleExpand(this)">
      <div class="sig-card-main">
        <div class="sig-bar ${s.bar}"></div>
        <div class="sig-body">
          <div class="sig-head">
            <span class="sig-tag ${s.dir || 'watch'}">${s.type === 'action' ? s.rule : s.prio}</span>
            <span class="sig-fund">${s.fund.name} · ${s.fund.code}</span>
          </div>
          <div class="sig-title">${s.title}</div>
        </div>
        <span class="sig-arrow">▾</span>
      </div>
      <div class="sig-detail">
        ${s.detail.map(d => `
          <div class="sig-row">
            <span class="lbl">${d.l}</span>
            <span class="val ${d.c || ''}">${d.v}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('') || '<div class="empty">暂无信号</div>';
}
```

---

## 5. 信号颜色规范

| 信号方向 | 左侧色条 | 标签背景 | 含义 |
|---------|---------|---------|------|
| `reduce` | `var(--loss)` #16a34a 绿色 | 同 | 减仓/清仓/止盈（防守） |
| `add` | `var(--accent)` #1e3a8a 深蓝 | 同 | 加仓（进攻） |
| `watch` | `var(--warn)` #f59e0b 橙色 | 同 | 观察提醒（无需立即操作） |

---

## 6. 需要新增的 CSS 类

```css
.sig-list{display:flex;flex-direction:column;gap:8px}
.sig-card{background:var(--surface);border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.05);overflow:hidden;cursor:pointer}
.sig-card-main{padding:14px 16px;display:flex;align-items:flex-start;gap:10px}
.sig-bar{width:4px;align-self:stretch;border-radius:2px;flex-shrink:0}
.sig-bar.reduce{background:var(--loss)}
.sig-bar.add{background:var(--accent)}
.sig-bar.watch{background:var(--warn)}
.sig-body{flex:1;min-width:0}
.sig-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;gap:8px}
.sig-tag{padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;white-space:nowrap;color:#fff}
.sig-tag.reduce{background:var(--loss)}
.sig-tag.add{background:var(--accent)}
.sig-tag.watch{background:var(--warn)}
.sig-fund{font-size:11px;color:var(--muted);white-space:nowrap}
.sig-title{font-size:14px;font-weight:600;line-height:1.3;margin-bottom:2px}
.sig-detail{display:none;padding:0 16px 14px 16px;border-top:1px solid var(--border);font-size:13px}
.sig-detail.open{display:block;padding-top:10px}
.sig-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px}
.sig-row .lbl{color:var(--muted)}
.sig-row .val{font-family:var(--mono);font-weight:500}
.sig-arrow{color:var(--muted);font-size:12px;transition:transform .2s;flex-shrink:0;margin-top:2px}
.sig-card.open .sig-arrow{transform:rotate(180deg)}
```

---

## 7. 需要新增的 Tab 入口

移动端底部 TabBar（第 5 个）：
```html
<button class="btab-item" data-page="signals" onclick="goPage('signals')">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
  </svg>信号
</button>
```

桌面端顶部导航（第 3 个）：
```html
<button class="tn-tab" data-page="si" onclick="go('si')">交易信号</button>
```

导航切换时触发渲染：
```js
if (page === 'signals') renderSignals();
```

---

## 8. 数据需求

### 必须可从现有数据推导
- 每只基金的建仓日期 → 从 `txs` 中取最早交易日期
- R_max 历史最高收益率 → 存储在 `holding._rmax`，每次计算时更新
- 最近加仓日期/价格 → 从 `txs` 中取最近一次买入记录

### 建议新增的字段（如数据库可用）
- `fund_type`：基金类型（宽基/行业/主动/QDII）
- `r_max`：历史最高收益率（持久化存储）
- `build_date`：建仓日期
- `last_add_date` / `last_add_price`：最近加仓日期和价格

### 不做持久化时的降级方案
- 基金类型通过代码映射硬编码判断
- R_max 每次页面加载时从当前收益率开始计算（损失历史峰值精度）
- 建仓日期从交易记录中动态计算

---

## 9. 验证清单

实现后逐项检查：

- [ ] 切换到信号页时，自动生成信号列表
- [ ] 操作信号和观察提醒分两个 Tab 展示，计数正确
- [ ] 减仓/清仓信号左侧色条为绿色，加仓信号为深蓝
- [ ] 点击卡片展开/折叠规则详情
- [ ] R5 优先级最高，第三档触发后该基金不再评估其他规则
- [ ] R1 有缓冲期概念：建仓 < 20 天为观察，≥ 20 天为操作
- [ ] R4 使用 R_max（历史最高收益率）而非当前收益率判断
- [ ] R8 基于建仓天数判断，不依赖价格触发
- [ ] 桌面端表格中规则标签颜色与移动端一致
- [ ] 空状态显示「暂无操作信号」/「暂无观察提醒」
- [ ] 信号引擎每次渲染时重新计算（数据变更后自动更新）

---

## 10. 参考

- 规则完整文档：`fund_rules_R1R8_v2_0.md`（第五节规则详解）
- 品牌令牌：`brand-spec.md`
- 现有移动端实现：`h5.html`（signal-options.html 有 3 套布局方案预览）
- 现有桌面端实现：`pc.html`
