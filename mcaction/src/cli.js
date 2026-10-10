#!/usr/bin/env node
import './env.js';
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import QRCode from 'qrcode';
import { buildPlan, placeOrder, describePlan, toPublic } from './engine.js';
import { loadConfig, autoSceneKey } from './config.js';
import { callMcpTool, closeMcpClient } from './mcp.js';

const HELP = `麦一下 McAction

  mcd 老样子                    按当前时间自动选场景
  mcd 30元以内 牛肉              预算 + 想吃的
  mcd -s work 麦辣鸡腿堡         指定场景
  mcd --at 12:40 老样子          预约 12:40 取餐
  mcd --dry --json 老样子        只试算并输出 JSON（git hook / CI 用）
  mcd order <订单号>             查订单状态
  mcd scenes                    查看场景配置
  mcd ping                      检查 MCP 连接

选项：-s/--scene  -b/--budget  --at HH:mm  --in 分钟  --dry  --json  -y/--yes`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scene: { type: 'string', short: 's' },
    budget: { type: 'string', short: 'b' },
    at: { type: 'string' },
    in: { type: 'string' },
    dry: { type: 'boolean' },
    json: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
    help: { type: 'boolean', short: 'h' },
  },
});

async function main() {
  const [cmd, arg] = positionals;
  if (values.help) return console.log(HELP);

  if (cmd === 'ping') {
    const t = await callMcpTool('now-time-info');
    return console.log('MCP 连接正常', t?.data?.formatted ?? '');
  }

  if (cmd === 'scenes') {
    const config = loadConfig();
    console.log(`配置来源：${config.source}\n当前自动场景：${autoSceneKey(config)}\n`);
    for (const [key, s] of Object.entries(config.scenes)) {
      console.log(`${key.padEnd(10)} ${s.label || ''} · ${s.mode} · ${(s.items || []).join('、')}`);
    }
    return;
  }

  if (cmd === 'order') {
    if (!arg) throw new Error('用法：mcd order <订单号>');
    const r = await callMcpTool('query-order', { orderId: arg });
    return console.log(JSON.stringify(r?.data ?? r, null, 2));
  }

  const plan = await buildPlan(
    { text: positionals.join(' '), scene: values.scene, budget: values.budget, at: values.at, inMinutes: values.in },
    { peek: values.dry },
  );

  if (values.json) return console.log(JSON.stringify(toPublic(plan), null, 2));
  console.log(`\n${describePlan(plan)}\n`);
  if (values.dry) return;

  if (plan.overBudget && !values.yes) {
    process.exitCode = 2;
    return console.log('超出预算，已停止。确定要点就加 -y。');
  }

  if (!values.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('按回车下单（汉堡回车键同样有效），输入任意字符取消：');
    rl.close();
    if (answer.trim()) return console.log('已取消，没有下单。');
  }

  const pay = await placeOrder(plan);
  console.log(`\n订单已创建：${pay.orderId || '（未返回订单号）'}`);
  if (!pay.payUrl) return console.log('没拿到支付链接，请到麦当劳 App「订单」页完成支付。');
  console.log('用手机扫码支付：\n');
  console.log(await QRCode.toString(pay.payUrl, { type: 'terminal', small: true }));
  console.log(pay.payUrl);
  console.log(`\n付完可以运行：mcd order ${pay.orderId}`);
}

main()
  .catch((err) => {
    console.error(`出错：${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeMcpClient());
