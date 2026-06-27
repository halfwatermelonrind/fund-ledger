# 基金交易账簿 - 产品需求文档（PRD）

> 本文档用于指导 Claude Code 在 OpenDesign 导出的 UI 框架基础上，补全业务逻辑、数据层、计算逻辑及工程化配置，最终交付可运行的静态 SPA。

---

## 1. 项目定位

- **产品形态**：纯前端静态网页，PWA 支持，可添加到 iPhone 主屏幕。
- **数据存储**：浏览器 localStorage，无后端，无登录。
- **部署方式**：构建后部署到 Cloudflare Pages / Vercel / GitHub Pages 等免费静态托管，或私有服务器 Nginx / Docker。
- **隐私原则**：所有持仓与交易数据仅存于用户设备，服务端永不接触明文。

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | React 18 + TypeScript | 函数组件 + Hooks |
| 构建工具 | Vite | 快速构建，输出静态 SPA |
| 样式 | Tailwind CSS | 原子化样式，响应式断点 |
| 状态管理 | Zustand | 轻量，支持 localStorage 持久化 |
| 数据获取 | 原生 fetch + JSONP / Script 注入 | 无跨域问题，前端直接调用 |
| PWA | Vite PWA 插件 或手动 SW | 支持离线、添加到主屏幕 |

---

## 3. 数据模型

### 3.1 交易流水（Transaction）

```typescript
type TransactionType = 'buy' | 'sell' | 'dividend_cash' | 'dividend_reinvest';

interface Transaction {
  id: string;                 // UUID
  fundCode: string;             // 6 位基金代码
  fundName: string;             // 基金名称
  type: TransactionType;        // 交易类型
  tradeDate: string;            // 交易申请日 YYYY-MM-DD
  nav?: number;                // 单位净值，可选（未知价格交易时留空）
  amount?: number;              // 买入金额（元），buy / dividend_cash 时必填
  shares?: number;              // 卖出份额（份），sell 时必填
  confirmedShares?: number;     // 确认份额，nav 回填后计算
  channel: string;             // 代销渠道
  feeRate: number;             // 交易费率，如 0.0015 表示 0.15%
  navSource: 'manual' | 'auto' | 'pending'; // 净值来源
  createdAt: number;
  updatedAt: number;
}
```

### 3.2 持仓汇总（Position）

```typescript
interface Position {
  fundCode: string;
  fundName: string;

  // 当前持仓
  totalShares: number;          // 当前持仓份额
  totalCost: number;             // 剩余持仓成本（移动加权平均）
  avgCostNav: number;            // 成本单价

  // 累计统计
  totalInvested: number;         // 历史累计买入本金（含手续费后的实际投入）
  totalSoldCash: number;         // 历史累计卖出到账金额
  totalCashDividend: number;     // 累计现金分红收入

  // 市值与盈亏（基于已确认净值）
  latestNav: number;             // 最新已确认单位净值
  latestNavDate: string;         // 最新净值日期
  marketValue: number;          // 持仓市值 = totalShares * latestNav

  // 实时估值（仅展示，不参与盈亏计算）
  estimateNav?: number;         // 盘中估算净值
  estimateChange?: number;       // 估算涨跌幅 %
  estimateTime?: string;       // 估值时间

  // 盈亏分解（必须分别展示）
  unrealizedProfit: number;     // 浮动盈亏 = marketValue - totalCost
  realizedProfit: number;       // 已实现盈亏
  dividendProfit: number;        // 累计分红
  totalProfit: number;          // 总盈亏 = 浮动 + 已实现 + 分红
  totalProfitRate: number;      // 总盈亏率 = totalProfit / totalInvested

  isCleared: boolean;           // 是否已清仓（totalShares === 0）
}
```

---

## 4. 核心计算逻辑（必须精确实现）

### 4.1 移动加权平均成本法

**买入时：**
```
confirmedShares = amount * (1 - feeRate) / nav
totalShares    += confirmedShares
totalCost      += amount * (1 - feeRate)
totalInvested  += amount * (1 - feeRate)
avgCostNav      = totalShares > 0 ? totalCost / totalShares : 0
```

**卖出时：**
```
sellRatio      = sellShares / totalShares
sellCost       = totalCost * sellRatio
realizedProfit += sellShares * nav * (1 - feeRate) - sellCost
totalShares    -= sellShares
totalCost      -= sellCost
totalSoldCash  += sellShares * nav * (1 - feeRate)
if (totalShares > 0) avgCostNav = totalCost / totalShares
```

**现金分红时：**
```
dividendAmount     = totalShares * amountPerShare
totalCashDividend += dividendAmount
// 不影响 totalShares 和 totalCost
```

**红利再投资时：**
```
dividendAmount = totalShares * amountPerShare
newShares      = dividendAmount / reinvestNav
totalShares   += newShares
totalCost     += dividendAmount
totalInvested += dividendAmount
avgCostNav     = totalCost / totalShares
```

### 4.2 盈亏计算（每日净值更新时）

```
marketValue      = totalShares * latestNav
unrealizedProfit = marketValue - totalCost
realizedProfit   = totalSoldCash - (totalInvested - totalCost)
dividendProfit   = totalCashDividend
totalProfit      = unrealizedProfit + realizedProfit + dividendProfit
totalProfitRate  = totalInvested > 0 ? totalProfit / totalInvested : 0
```

### 4.3 未知净值处理（T 日交易，T+N 确认）

- 录入时 `nav` 为可选字段，未填写时 `navSource = 'pending'`，`confirmedShares` 为空。
- 列表中展示橙色「待回填」标签。
- `batchFillNav()`：扫描所有 `navSource === 'pending'` 的记录，按 `fundCode` 分组，调用 `fetchHistoryNav()` 获取历史净值数组，按 `tradeDate` 匹配回填。
- 回填后重新计算 `confirmedShares` 并触发持仓聚合。

---

## 5. 页面功能

### 5.1 页面一：交易录入（/transactions）

#### 录入表单
- **交易类型 Tab**：买入 / 卖出 / 现金分红 / 红利再投资，切换时动态改变字段。
- **基金代码**：文本输入，失焦后调用 `fetchLatestNav(fundCode)` 获取基金名称并回显。
- **交易日期**：日期选择器，默认当天。
- **单位净值**：数字输入，**非必填**，placeholder「未知可留空，后续自动回填」。
  - 已填：实时计算预计确认份额 / 到账金额。
  - 未填：保存后标记橙色「待回填」标签。
- **购买金额**（买入态）：必填。
- **卖出份额**（卖出态）：必填，实时校验不能超过当前可用持仓。
- **分红金额**（现金分红态）：每份分红 × 当前持仓份额自动计算，可手动修正。
- **代销渠道**：下拉选择（支付宝 / 天天基金 / 银行 / 券商 / 其他）。
- **交易费率**：数字输入（%），默认 0.15%。
- **操作按钮**：「保存录入」「重置」。
- **实时预览**：表单底部根据已填净值实时显示预计确认份额或预计到账金额。

#### 交易流水列表
- 按日期倒序展示所有交易。
- **状态列**：已确认（绿点）/ 待回填（橙色标签）/ 已清仓（灰色）。
- **操作**：编辑（回填后可修改）、删除（二次确认弹窗）。
- **批量回填**：顶部「一键回填净值」按钮，回填后 Toast 提示成功 / 失败条数。

### 5.2 页面二：持仓展示（/positions）

#### 持仓汇总卡片（全账户）
- 总市值 | 总成本 | 总浮动盈亏 | 总已实现盈亏 | 累计分红 | 总盈亏 | 总盈亏率
- **颜色规则（A 股惯例）**：金额 / 比例 > 0 显示**红色**，< 0 显示**绿色**，= 0 显示灰色。

#### 持仓明细
- **表头**：基金代码 | 名称 | 持仓份额 | 持仓市值 | 持仓成本 | 成本单价 | 最新净值 | 实时估值 | 预估涨跌 | 浮动盈亏 | 已实现盈亏 | 累计分红 | 总盈亏 | 总盈亏率 | 操作
- **实时估值列**：显示 `estimateNav`，非交易时段显示 `--` 灰色。
- **预估涨跌列**：显示 `estimateChange` + `%`，**涨红跌绿**。
- **所有盈亏列颜色**：统一 **涨红跌绿**。
- **排序**：默认按总盈亏绝对值倒序，支持点击表头切换排序字段和顺序。
- **行交互**：
  - 点击行展开：该基金历史交易流水时间轴 + 分红记录。
  - 🔄 刷新：每行末尾刷新按钮，手动触发单基金实时估值更新。
  - 手动改净值：弹出输入框修改 `latestNav`。
- **已清仓区**：份额为 0 的基金折叠在底部「已清仓」区域，展示最终总盈亏。

#### 实时估值刷新机制
- **页面顶部**：「刷新全部估值」按钮，遍历所有持仓基金并发请求（控制并发数 ≤ 5）。
- **单基金行尾**：🔄 按钮，仅刷新当前基金。
- **刷新后更新**：`latestNav`（用 `dwjz`）、`estimateNav`（用 `gsz`）、`estimateChange`（用 `gszzl`）、`estimateTime`（用 `gztime`），并重算浮动盈亏。
- **刷新频率限制**：同一基金 30 秒内重复点击提示「请勿频繁刷新」。
- **离线状态**：无网络时刷新按钮置灰，提示当前离线。
- **估值时间**：`estimateTime` 小字显示于估值下方，如「估算于 14:46」。

---

## 6. 数据源封装（前端直接调用）

在 `src/services/fundData.ts` 中实现以下函数：

### 6.1 获取最新净值 + 实时估值

```typescript
function fetchLatestNav(fundCode: string): Promise<{
  name: string;
  nav: number;        // dwjz 已确认净值
  date: string;       // jzrq 净值日期
  estimate?: number;  // gsz 实时估算净值
  change?: number;    // gszzl 估算涨跌幅 %
  time?: string;      // gztime 估值时间
}>
```

- **URL**：`http://fundgz.1234567.com.cn/js/{fundCode}.js?rt=${Date.now()}`
- **方式**：动态插入 `<script>` 标签，解析全局 `jsonpgz()` 回调。JSONP 格式，**无跨域限制**。
- **返回示例**：
  ```javascript
  jsonpgz({
    "fundcode": "000001",
    "name": "华夏成长混合",
    "jzrq": "2026-06-17",
    "dwjz": "1.4070",
    "gsz": "1.4461",
    "gszzl": "2.78",
    "gztime": "2026-06-18 14:46"
  });
  ```
- **注意**：QDII、货币基金等可能无 `gsz` 数据，需优雅降级显示 `--`。

### 6.2 获取历史净值（用于回填未知净值）

```typescript
function fetchHistoryNav(fundCode: string): Promise<Array<{
  date: string;       // YYYY-MM-DD
  nav: number;
  dividend?: number;  // unitMoney 分红金额
}>>
```

- **URL**：`http://fund.eastmoney.com/pingzhongdata/{fundCode}.js?v=${Date.now()}`
- **方式**：动态插入 `<script>` 标签，加载后读取全局变量 `Data_netWorthTrend`。
- **数据量**：从基金成立日至最新交易日的全部历史净值（如华夏成长混合约 5944 条，2001-12-18 至 2026-06-17）。
- **数据结构**：
  ```javascript
  Data_netWorthTrend = [
    {"x": 1008604800000, "y": 1.0, "equityReturn": 0, "unitMoney": ""},
    // ...
    {"x": 1750032000000, "y": 1.407, "equityReturn": 0.0278, "unitMoney": ""}
  ]
  ```
- **解析规则**：`x` 为毫秒时间戳，`y` 为单位净值，`unitMoney` 为分红金额（如有）。

### 6.3 基金名称联想

```typescript
function searchFundName(keyword: string): Promise<Array<{code: string, name: string}>>
```

- **URL**：`http://fund.eastmoney.com/js/fundcode_search.js`
- **方式**：获取全量基金列表（JSON 数组），前端内存过滤匹配。

---

## 7. 响应式实现

### 7.1 PC 端（≥768px）
- 顶部水平导航栏，Tab 切换「交易录入」/「持仓展示」。
- 交易页：左 5 右 7 分栏（左侧表单，右侧流水列表）。
- 持仓页：汇总卡片横向排列，下方标准 HTML table，表头固定，列宽自适应。

### 7.2 移动端（<<768px）
- 底部固定 TabBar，图标 + 文字，安全区适配 `pb-[env(safe-area-inset-bottom)]`。
- 交易页：表单和列表上下堆叠，列表可折叠。
- 持仓页：汇总卡片横向滚动，持仓明细改为卡片式，每卡展示：
  - 首行：基金名称 + 总盈亏率（大字号，**涨红跌绿**）
  - 次行：份额 | 市值 | 成本单价
  - 展开后：浮动盈亏、已实现盈亏、累计分红、最新净值、实时估值、预估涨跌
- 触控优化：按钮最小 44px，输入框 font-size ≥ 16px 防止 iOS 缩放。

---

## 8. 部署与隐私

### 8.1 部署方式
- 纯静态 SPA，`npm run build` 输出 `dist/` 文件夹。
- 部署到 Cloudflare Pages / Vercel / GitHub Pages / 腾讯云 COS 等免费静态托管。
- 可选：提供 `Dockerfile`（多阶段构建，Nginx 托管），用于私有服务器部署。

### 8.2 数据存储
- 所有交易数据存储在浏览器 **localStorage**，无需后端，无需登录。
- 支持 **PWA**：配置 `manifest.json` 和 Service Worker，支持 iPhone Safari「添加到主屏幕」后全屏离线使用。
- 提供 **「导出 JSON」** 和 **「导入 JSON」** 功能：
  - 导出：将 localStorage 中的全部数据打包为 JSON 文件下载，可保存到微信文件传输助手。
  - 导入：读取 JSON 文件，覆盖或合并到当前数据。

### 8.3 安全与隐私
- 服务端仅提供静态网页文件，永不接触用户交易数据。
- 提供「一键清除所有本地数据」功能，二次确认后删除 localStorage 全部内容。
- 敏感操作（清空数据、删除全部交易）需二次确认弹窗。

---

## 9. 代码结构

```
src/
  components/          # 通用组件
    FormInput.tsx
    FormSelect.tsx
    DatePicker.tsx
    Modal.tsx
    Toast.tsx
    NavBar.tsx
    TabBar.tsx
    ConfirmDialog.tsx
  pages/               # 页面级组件
    TransactionsPage.tsx    # 交易录入
    PositionsPage.tsx       # 持仓展示
  stores/              # Zustand 状态管理
    useFundStore.ts
  services/            # 数据源封装
    fundData.ts
  utils/               # 工具函数
    calculator.ts        # 持仓聚合、盈亏计算
    crypto.ts            # 可选：数据加密导出
    format.ts            # 金额、百分比格式化
  types/               # TypeScript 类型定义
    index.ts
  hooks/               # 自定义 Hooks
    useMediaQuery.ts
    useLocalStorage.ts
  App.tsx
  main.tsx
public/
  manifest.json
  sw.js                # Service Worker（或 vite-plugin-pwa 自动生成）
```

---

## 10. 交付标准

1. `npm run dev` 可在本地预览，`npm run build` 输出可部署的静态文件。
2. TypeScript 严格模式通过，无控制台报错。
3. iPhone Safari 实测：
   - 无样式错乱
   - 输入框不触发页面缩放
   - JSONP 数据获取正常
   - PWA「添加到主屏幕」后全屏运行正常
4. 支持「未知净值录入 → 待回填 → 一键回填 → 盈亏计算」完整闭环。
5. 实时估值刷新正常，颜色统一为 **涨红跌绿**（A 股惯例）。
6. 导出 / 导入 JSON 功能正常，数据可跨设备迁移。
7. 离线状态下可正常查看已录入数据，刷新估值按钮置灰提示。

---

## 11. 补充说明

- **计算精度**：所有金额计算使用整数分（乘以 100 取整）或 `decimal.js` 处理，避免 JavaScript 浮点误差。
- **容错处理**：数据源接口偶尔 403 或超时，需加 `try-catch` 和缓存机制（localStorage 缓存净值数据 1 天）。
- **分红补录**：如果用户未录入分红，持仓盈亏会有偏差，建议在交易流水列表旁增加「补录分红」快捷入口。
- **已清仓基金**：持仓份额为 0 时，该基金进入「已清仓」折叠区，保留历史总盈亏记录，不再参与当前市值计算。
