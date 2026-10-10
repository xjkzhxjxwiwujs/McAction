# 麦当劳一键点餐

基于 [麦当劳 MCP 平台](https://open.mcd.cn/mcp/doc) 的本地 Web 应用：选湖州/洛阳地址 → 门店 → 菜单 → 算价 → 下单。

## 准备
1. 在 [open.mcd.cn/mcp](https://open.mcd.cn/mcp) 登录并激活 MCP Token  
2. 复制 `.env.example` 为 `.env`，填入 Token：

```env
MCD_MCP_TOKEN=你的Token
MCD_MCP_URL=https://mcp.mcd.cn
PORT=3780
```

## 启动

```bash
cd mcd-order
npm install
npm start
```

浏览器打开：http://localhost:3780

## 功能

- **湖州 / 洛阳一键开点**：按关键词自动匹配菜单并试算（默认勾选「先试算不落单」）
- 地址 / 门店 / 菜单浏览与购物车下单
- 一键领券、算价、创建订单（支付需在麦当劳 App / 支付链接完成）

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | MCP 连通性 |
| GET | `/api/addresses` | 配送地址（湖州/洛阳优先） |
| GET | `/api/delivery-stores` | 外送门店 |
| POST | `/api/meals` | 菜单 |
| POST | `/api/calculate-price` | 算价 |
| POST | `/api/create-order` | 下单 |
| POST | `/api/one-click-order` | 一键试算/下单 |

