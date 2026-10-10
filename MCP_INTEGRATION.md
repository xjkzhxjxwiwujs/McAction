# MCP 集成说明

## 使用的 Server

麦当劳中国官方 MCP：`https://mcp.mcd.cn`，传输方式为 Streamable HTTP。请求头 `Authorization: Bearer ${MCD_MCP_TOKEN}`。脱敏配置见仓库根目录的 `mcp-config.example.json`。Token 只放在 `.env` 或 `~/.mcaction/.env`，仓库内没有真实凭证。

调用封装在 `src/mcp.js`：长连接复用，会话失效时重连一次；工具返回 `success: false` 时按业务错误抛出，不把失败当成空结果。

## 使用的 Tool

| Tool | 用途 |
| --- | --- |
| `now-time-info` | `mcd ping` 检查连通 |
| `delivery-query-addresses` | 外送场景读取账号里已有的配送地址 |
| `delivery-query-stores` | 按地址查可配送门店 |
| `query-nearby-stores` | 到店自取（beType=1）和得来速（beType=5）查门店 |
| `query-meals` | 拉该店在售菜单 |
| `query-meal-detail` | 菜单项没有名称时补名称，便于关键词匹配 |
| `auto-bind-coupons` | 试算前领取当前可领的券；只读预览（`/v1/peek`、`mcd --dry`）不调用 |
| `query-store-coupons` | 查这家店、这种取餐方式真正能用的券 |
| `calculate-price` | 先算不用券的价格，再把候选券逐个挂到商品上试算，取应付最低的一组 |
| `create-order` | 仅在用户确认后创建订单，读取返回的支付链接 |
| `query-order` | `mcd order <订单号>` 查询支付后的状态 |

价格字段单位是分，展示时除以 100。到店和得来速的 `takeWayCode` 取自 `calculate-price` 返回的 `takeWayList`。预约取餐把 `at` 或 `inMinutes` 换成 `yyyy-MM-dd HH:mm` 后传给 `reservationDate`。

## 调用流程

1. 入口只负责把场景名、想吃的、预算、预约时间交给 `src/engine.js`。
2. `pickScene` 按 `mcaction.json` 或当前时间选出场景，得到取餐方式、城市或地址关键词、默认餐品。
3. 外送：`delivery-query-addresses` → `delivery-query-stores`。到店或得来速：`query-nearby-stores`。优先选营业中的店。
4. `query-meals`，必要时 `query-meal-detail`，把「巨无霸」「牛肉」这类词匹配到在售商品。匹配不到就停止，不下单。
5. 非只读时 `auto-bind-coupons`，再 `query-store-coupons`。`calculate-price` 在原价和若干券组合里取最低应付。超过预算则标记 `overBudget`，确认接口拒绝下单。
6. 用户第二次按下按钮、在终端回车，或在快捷指令 / 编辑器里点「下单」之后，才调用 `create-order`。
7. 从下单结果取出支付链接，生成付款页二维码。没有链接时提示去麦当劳 App 订单页支付。

## 业务价值

点餐被收成一次按键：场景决定去哪家、吃什么、自取还是外送，券按这家店的真实可用券试算，而不是只展示卡包里的券。所有入口共用这一次试算，最后一步支付留给用户，脚本和 CI 都不能自动扣款。
