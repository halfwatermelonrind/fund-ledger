# 基金交易账簿 — 品牌规范

## 来源
来自用户需求文档的显式色彩/字体/布局规范。

## 色彩令牌

```css
:root {
  --bg:      oklch(96.5% 0.003 260);   /* #f3f4f6 背景灰 */
  --surface: oklch(100% 0 0);          /* #ffffff 卡片/表面白 */
  --fg:      oklch(18% 0.02 260);      /* #111827 主文字 */
  --muted:   oklch(50% 0.01 260);      /* #6b7280 辅助文字 */
  --border:  oklch(91% 0.004 260);     /* #e5e7eb 边框 */
  --accent:  oklch(32% 0.12 265);      /* #1e3a8a 深蓝主色 */
  --gain:    oklch(52% 0.22 28);       /* #dc2626 A股涨/盈利 — 红色 */
  --loss:    oklch(55% 0.19 145);      /* #16a34a A股跌/亏损 — 绿色 */
  --warn:    oklch(72% 0.16 65);       /* #f59e0b 待确认/警告 — 橙色 */
  --flat:    oklch(68% 0.006 260);     /* #9ca3af 零/持平 — 灰色 */

  --font-display: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
  --font-body:    -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
  --font-mono:    'SF Mono', 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'Menlo', 'Consolas', monospace;
}
```

## 语义扩展

| 语义令牌 | 含义 | A股惯例 |
|----------|------|---------|
| `--gain` | 上涨/盈利 | 红色 |
| `--loss` | 下跌/亏损 | 绿色 |
| `--warn` | 待确认/警告 | 橙色 |
| `--flat` | 零/持平/无数据 | 灰色 |

## 布局姿态

- 半径: 6-8px（卡片/输入框），2-4px（标签/徽章）
- 边框: hairline 1px，表格用浅灰
- 间距: 16-24px 基准网格
- 表格: 密集数据表，hairline 分隔线，无斑马条纹
- 状态标签: 内联 pill 形式，着色淡背景
- 响应式断点: 768px（PC 左右布局 ↔ 移动端堆叠）
- 移动端: 底部固定 TabBar，iOS 安全区适配
- 无阴影卡片，靠边框分隔
- 深蓝主色用于导航、主按钮、选中态
