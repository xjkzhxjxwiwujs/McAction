# 麦一下 McAction

## 项目介绍

任何按钮都能变成麦当劳键。操作按钮、背面轻点、NFC 贴纸、汉堡回车键、终端、合并代码、编辑器状态栏，背后是同一套逻辑：按当前场景选门店、匹配在售餐、用本店能用的券试算，确认后才创建订单，并给出付款码。付款始终由你自己完成。

本项目基于麦当劳官方 MCP，由参赛者独立开发，不是麦当劳官方产品。价格、库存和券以官方实时结果为准。

## 目标用户

已经有固定吃法的人：早餐、工位自取、回家外送、得来速。也给想把点餐接到键盘、终端、CI 或编辑器上的开发者。

## 安装方法

需要 Node.js 20 或以上，以及在 [open.mcd.cn](https://open.mcd.cn) 申请的 MCP Token。

```bash
cp .env.example .env          # 填入 MCD_MCP_TOKEN
cp config/mcaction.example.json mcaction.json   # 改成自己的城市、地址关键词和常点的餐
npm install
npm start                     # http://127.0.0.1:3790
node src/cli.js ping          # 确认 MCP 通了
```

手机、NFC、Stream Deck 要从别的设备访问时，在 `.env` 里设置 `MCACTION_KEY`，服务会改为监听 `0.0.0.0`。外网访问时把穿透地址写进 `MCACTION_PUBLIC_URL`。

## 使用示例

终端（`npm link` 之后可直接用 `mcd`）：

```bash
node src/cli.js 老样子                 # 按当前时间选场景，试算后回车才下单
node src/cli.js 30元以内 牛肉           # 预算 + 想吃的
node src/cli.js -s work --at 12:40 麦辣鸡腿堡
node src/cli.js --dry 老样子            # 只试算，不下单
node src/cli.js order <订单号>          # 付款后查状态
```

超出预算时不会下单，除非加上 `-y`。

`node src/cli.js --dry 老样子` 只报价，输出类似：

```text
在家 · 麦乐送 · 麦当劳人民广场餐厅
巨无霸中套餐 ×1
应付 ¥52.40
超出预算 ¥35，不会自动下单
```

门店、餐品和价格以官方实时结果为准。本机服务已启动时，同一个按钮也可以这样试算，60 秒内再请求一次才会下单：

```bash
curl "http://127.0.0.1:3790/v1/press?format=text&scene=home&text=老样子"
```

其余入口都打到本机服务，说明写在对应目录：

| 入口 | 触发 | 说明 |
| --- | --- | --- |
| 汉堡回车键 | 按一下试算，60 秒内再按一下下单并打开付款页 | [entries/burger-enter-key](entries/burger-enter-key/README.md) |
| 合并代码就开饭 | 合并进主分支后只试算，不扣款 | [entries/git/post-merge](entries/git/post-merge)、[entries/github-action/merge-meal.yml](entries/github-action/merge-meal.yml) |
| 编辑器夜宵栏 | 21 点后且最近在保存文件时，状态栏显示券后价 | [entries/vscode-extension](entries/vscode-extension) |
| 操作按钮 / 背面轻点 / NFC / 关闹钟 / 日历空档 | 快捷指令调用同一接口 | [entries/ios-shortcuts](entries/ios-shortcuts/README.md) |

场景在 `mcaction.json` 里配置。`auto` 按时间切换：05:00–10:30 早餐，10:30–14:00 工位，21:00–05:00 夜宵，其余时间在家。

## 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/v1/press` | 第一次试算，同一按钮在 `confirmWindowSec` 内再调一次才下单 |
| POST | `/v1/plan` | 只试算，返回 `planId` |
| POST | `/v1/confirm/:planId` | 确认下单，返回付款页 |
| GET | `/v1/peek` | 只读预览，不领券，给状态栏轮询 |
| GET | `/pay/:token` | 付款二维码和付款链接，30 分钟有效 |

查询参数 `format=json`（默认）、`text`（脚本通知）、`html`（Stream Deck 直接打开）。

## 开发

```bash
npm test
```

不连 MCP，只覆盖意图解析、按时间选场景和预约时间。
