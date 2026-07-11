# 记录页 & 明细页 — 改版 Prompt

> 将此文档发给 Claude，对基金交易账簿的「记录页」和「明细页」进行改版。

---

## 一、记录页（录入 + 流水合并）

### 1.1 合并目标

将原有的"录入"和"流水"两个独立 Tab 合并为一个「记录」Tab，Tab 总数从 5 减为 4：

```
旧：录入 | 流水 | 汇总 | 明细 | 信号  (5 Tab)
新：记录 | 汇总 | 明细 | 信号          (4 Tab)
```

底部 TabBar 和顶部导航栏同步更新，移除"录入"Tab，"流水"改名为"记录"。

### 1.2 布局方案：全屏流水 + 浮层录入（方案 B）

**主视图**：全屏交易流水卡片列表（无横向滚动）

**录入表单**：从独立页面改为底部浮层（Bottom Sheet）
- 平时隐藏，通过以下方式唤起：
  1. 右下角 **FAB 按钮**（`+`，52×52px 圆形，深蓝底白色字，`position:fixed;bottom:80px;right:16px`）
  2. 流水卡片上的 **「再买一笔」** 按钮（点击后浮层滑出，**自动填入该卡的基金代码**）
  3. 空状态的 **「录入第一笔」** 按钮
- 浮层结构：顶部拖拽手柄（36×4px）+ 标题（含已填入代码提示）+ 完整录入表单 + 保存/重置按钮
- 保存成功后：浮层关闭，新记录出现在列表顶部，Toast 提示
- 点击遮罩层关闭浮层

### 1.3 FAB CSS

```css
.fab{position:fixed;bottom:80px;right:16px;width:52px;height:52px;
  background:var(--accent);color:#fff;border:0;border-radius:50%;font-size:26px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:0 4px 16px rgba(30,58,138,.35);z-index:90}
.fab:active{transform:scale(.95)}
@media(min-width:768px){.fab{display:none}}
```

### 1.4 浮层 CSS

```css
.entry-sheet-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1500;align-items:flex-end}
.entry-sheet-overlay.open{display:flex}
.entry-sheet{background:var(--surface);border-radius:12px 12px 0 0;width:100%;max-height:88vh;overflow-y:auto;padding:20px 16px;padding-bottom:calc(20px + env(safe-area-inset-bottom,0))}
```

### 1.5 流水卡片「再买一笔」按钮

每张交易流水卡片的展开详情中，操作按钮区域追加：
```html
<button class="btn btn-xs btn-primary" onclick="event.stopPropagation();openEntrySheet('基金代码')">再买一笔</button>
```

### 1.6 筛选改为按交易类型

**旧**：全部 | 已确认 | 待回填（按状态筛选）

**新**：全部 | 买入 | 卖出 | 分红 | 再投（按交易类型筛选）

筛选逻辑：
```js
if(txFilter==='buy') data=data.filter(t=>t.type==='买入');
else if(txFilter==='sell') data=data.filter(t=>t.type==='卖出');
else if(txFilter==='dividend') data=data.filter(t=>t.type==='现金分红');
else if(txFilter==='reinvest') data=data.filter(t=>t.type==='红利再投资');
```

### 1.7 日期输入框固定格式

**问题**：`<input type="date">` 在中文系统下自动显示为「YYYY年M月D日」，宽度不可控

**解决**：改为 `type="text"` + 固定宽度 + YY/MM/DD 格式

```html
<input class="form-input date" type="text" id="fdate" placeholder="YY/MM/DD" inputmode="numeric" maxlength="8" required/>
```

```css
.form-input.date{max-width:120px;text-align:center;font-family:var(--mono);letter-spacing:.02em}
```

格式化/解析辅助函数：
```js
function fmtd(d){d=d||new Date();const y=String(d.getFullYear()).slice(-2),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'/'+m+'/'+day}
function parsed(s){if(!s||s.length<8)return'';const p=s.split('/');if(p.length!==3)return'';const y=parseInt(p[0]),m=parseInt(p[1]),d=parseInt(p[2]);const yy=y<50?2000+y:1900+y;return yy+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
```

初始化默认值：`document.getElementById('fdate').value=fmtd()`

保存时解析：`date=parsed(document.getElementById('fdate').value)`

---

## 二、明细页（交易盈亏功能）

### 2.1 卡片按钮

每张基金卡片底部有两个独立的文字链接按钮，分别展开不同内容：

```
┌──────────────────────────────────┐
│ 基金名称                    市值 │
│ ▸ 持仓详情          ▸ 交易盈亏   │  ← 右对齐，16px padding
└──────────────────────────────────┘
```

**按钮样式（方案 A — 文字链接）**：
```css
.hd-card-btn{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:500;
  color:var(--muted);cursor:pointer;background:0;border:0;padding:0;transition:color .15s}
.hd-card-btn:hover{color:var(--accent)}
.hd-card-btn .arr{font-size:8px;transition:transform .2s}
.hd-card-btn.open .arr{transform:rotate(90deg)}
```

**容器**：
```css
.hd-card-actions{display:flex;align-items:center;gap:12px;margin-top:6px;justify-content:flex-end;padding:0 16px}
```

### 2.2 「持仓详情」按钮

点击展开/收起现有的持仓数据区域（`.hd-card-detail`）：
- 持仓份额、持仓成本、成本单价、最新净值、实时估值
- 浮动盈亏、已实现盈亏、累计分红
- 底部操作：⟳ 刷新估值、调仓计算器

### 2.3 「交易盈亏」按钮

点击展开/收起独立的交易盈亏区域（`.hd-card-txpnl`）：

**数据来源**：该基金的 `txs` 数组中，筛选条件：
- `type === '买入' || type === '卖出'`
- `status === 'confirmed'`
- `nav !== null`（净值已回填）

**参考价**：
- 盘中（`isTrading() === true`）：使用 `gsz`（实时预估净值）
- 盘后：使用 `dwjz`（已确认净值）

**每笔交易展示**：
```
06-28 [买] 2.2800 → 2.4150  +5.92%
```
- 日期（MM-DD 格式，截取 `date.slice(5)`）
- 买卖标签（买=蓝色 `var(--accent)`，卖=橙色 `var(--warn)`）
- 交易价 → 参考价
- 盈亏百分比 = `(参考价 - 交易价) / 交易价 × 100%`，涨红跌绿

**CSS**：
```css
.hd-card-txpnl{display:none;padding:0 16px 14px;border-top:1px solid var(--border);font-size:13px}
.hd-card-txpnl.open{display:block;padding-top:12px}
.txpnl-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;
  border-bottom:1px dashed var(--border);font-size:12px}
.txpnl-row:last-child{border-bottom:0}
.txpnl-date{min-width:44px;color:var(--muted)}
.txpnl-tag{font-size:10px;padding:1px 6px;border-radius:999px;color:#fff;min-width:28px;text-align:center}
.txpnl-tag.buy{background:var(--accent)}.txpnl-tag.sell{background:var(--warn)}
.txpnl-price{font-family:var(--mono);font-size:11px;color:var(--muted);flex:1;text-align:center}
.txpnl-pct{font-family:var(--mono);font-size:13px;font-weight:600;min-width:52px;text-align:right}
```

### 2.4 两个区域的交互逻辑

- 两个按钮互不影响，可以独立展开/收起
- 可以同时展开（持仓详情 + 交易盈亏同时可见）
- 按钮箭头 ▸ 在展开时旋转 90° 变为 ▾
- 无已确认买卖交易的基金不显示「交易盈亏」按钮
- 点击事件使用 `event.stopPropagation()` 防止冒泡

---

## 三、涉及的导航变更

### 3.1 底部 TabBar（移动端）

```html
<!-- 4 个 Tab，移除"录入" -->
<button class="btab-item active" data-page="txlog" onclick="goPage('txlog')">记录</button>
<button class="btab-item" data-page="summary" onclick="goPage('summary')">汇总</button>
<button class="btab-item" data-page="details" onclick="goPage('details')">明细</button>
<button class="btab-item" data-page="signals" onclick="goPage('signals')">信号</button>
```

### 3.2 顶部导航（桌面端）

```html
<button class="topnav-tab" data-page="txlog">记录</button>
<button class="topnav-tab" data-page="summary">汇总</button>
<button class="topnav-tab" data-page="details">明细</button>
<button class="topnav-tab" data-page="signals">信号</button>
```

### 3.3 页面路由

```js
let curPage='txlog'; // 默认页改为 txlog
function goPage(p){
  // ... 切换逻辑 ...
  if(p==='txlog') renderTxLog();
  if(p==='summary') renderSummary();
  if(p==='details') renderDetails();
  if(p==='signals') renderSignals();
}
```

### 3.4 入口函数

```js
// 打开录入浮层，可选传入基金代码预填
function openEntrySheet(code){
  if(code){document.getElementById('fcode').value=code;lookupFund()}
  document.getElementById('es-overlay').classList.add('open');
  document.getElementById('fdate').value=fmtd();
}

// 关闭录入浮层
function closeEntrySheet(){
  document.getElementById('es-overlay').classList.remove('open');
}
```

---

## 四、验证清单

- [ ] Tab 从 5 个减为 4 个，默认页为「记录」
- [ ] 记录页全屏流水列表 + 右下角 FAB
- [ ] 点击 FAB → 底部浮层滑出，填写表单 → 保存 → 浮层关闭 → 列表更新
- [ ] 流水卡片「再买一笔」→ 浮层滑出，基金代码自动填入
- [ ] 空状态「录入第一笔」→ 浮层滑出
- [ ] 筛选胶囊按交易类型过滤（全部/买入/卖出/分红/再投）
- [ ] 日期输入框固定 120px 宽，YY/MM/DD 格式，不被系统语言撑开
- [ ] 明细页每张卡片有「持仓详情」和「交易盈亏」两个独立按钮
- [ ] 无交易记录或无已确认买卖的基金不显示「交易盈亏」按钮
- [ ] 交易盈亏参考价盘中用 gsz、盘后用 dwjz
- [ ] 按钮为文字链接风格，右对齐，有 16px 内边距
- [ ] 两个展开区域互不影响
