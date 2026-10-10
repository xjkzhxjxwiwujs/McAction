import './env.js';
import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import { buildPlan, placeOrder, describePlan, toPublic } from './engine.js';
import { loadConfig } from './config.js';
import { callMcpTool, closeMcpClient } from './mcp.js';
import { cacheWrap } from './cache.js';

const KEY = process.env.MCACTION_KEY || '';
const PORT = Number(process.env.MCACTION_PORT || 3790);
const HOST = process.env.MCACTION_HOST || (KEY ? '0.0.0.0' : '127.0.0.1');

const plans = new Map(); // planId -> plan
const lastPress = new Map(); // 按钮标识 -> planId，用于「再按一次确认」
const payments = new Map(); // 支付页 token -> { orderId, payUrl, say }

function remember(map, key, value, ttlSec) {
  map.set(key, value);
  setTimeout(() => map.delete(key), ttlSec * 1000).unref();
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const page = (title, body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,"PingFang SC",sans-serif;max-width:420px;margin:40px auto;padding:0 20px;text-align:center;color:#27251f}
pre{white-space:pre-wrap;text-align:left;background:#fff8e1;padding:16px;border-radius:12px;font:inherit;line-height:1.7}
button,a.btn{display:inline-block;background:#ffbc0d;color:#27251f;border:0;border-radius:999px;padding:14px 32px;font-size:17px;font-weight:700;text-decoration:none}
.muted{color:#888;font-size:13px}</style></head><body><h2>${esc(title)}</h2>${body}</body></html>`;

const publicBase = (req) => process.env.MCACTION_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

function readInput(req) {
  const src = { ...req.query, ...(req.body || {}) };
  return {
    text: src.text,
    scene: src.scene,
    budget: src.budget,
    at: src.at,
    inMinutes: src.inMinutes ?? src.in,
    city: src.city,
    keyword: src.keyword,
    mode: src.mode,
  };
}

/** format=json（默认，快捷指令 / 插件）| text（AHK、Hammerspoon 通知）| html（Stream Deck、浏览器） */
function reply(req, res, data) {
  const format = req.query.format;
  if (format === 'text') {
    return res.type('text/plain; charset=utf-8').send(data.say + (data.payPage ? `\nPAY ${data.payPage}` : ''));
  }
  if (format === 'html') {
    if (data.payPage) return res.redirect(303, data.payPage);
    const keyQs = req.query.key ? `&key=${encodeURIComponent(req.query.key)}` : '';
    const form =
      data.stage === 'planned'
        ? `<form method="post" action="/v1/confirm/${data.planId}?format=html${keyQs}"><button>确认下单</button></form>`
        : '';
    return res.type('html').send(page('麦一下', `<pre>${esc(data.say)}</pre>${form}`));
  }
  res.json({ ok: true, ...data });
}

async function confirm(req, plan, force) {
  if (plan.overBudget && !force) return { stage: 'blocked', planId: plan.id, say: describePlan(plan) };
  plans.delete(plan.id);
  const pay = await placeOrder(plan);
  const say = `已下单：${plan.store.name}，应付 ¥${plan.total}，请打开链接付款`;
  const token = crypto.randomUUID();
  remember(payments, token, { ...pay, say }, 30 * 60);
  return { stage: 'ordered', say, orderId: pay.orderId, payUrl: pay.payUrl, payPage: `${publicBase(req)}/pay/${token}` };
}

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => res.json({ ok: true, auth: Boolean(KEY) }));

app.get('/pay/:token', async (req, res) => {
  const p = payments.get(req.params.token);
  if (!p) return res.status(404).type('html').send(page('链接已失效', '<p>支付页 30 分钟后失效，请到麦当劳 App 订单页支付。</p>'));
  const body = p.payUrl
    ? `<p>${esc(p.say)}</p><img src="${await QRCode.toDataURL(p.payUrl, { width: 280, margin: 2 })}" alt="支付二维码">
       <p><a class="btn" href="${esc(p.payUrl)}">在这台手机上付款</a></p>`
    : `<p>${esc(p.say)}</p><p>没拿到支付链接，请到麦当劳 App 订单页支付。</p>`;
  res.type('html').send(page('麦一下 · 付款', `${body}<p class="muted">订单号 ${esc(p.orderId)}</p>`));
});

app.use('/v1', (req, res, next) => {
  if (!KEY || (req.get('x-mcaction-key') || req.query.key) === KEY) return next();
  res.status(401).json({ ok: false, message: 'MCACTION_KEY 不正确' });
});

/** 只试算，返回 planId；之后用 /v1/confirm/:planId 下单（闹钟、日历、编辑器插件用） */
app.post('/v1/plan', async (req, res) => {
  const config = loadConfig();
  const plan = await buildPlan(readInput(req), { config });
  remember(plans, plan.id, plan, config.planTtlSec);
  reply(req, res, {
    stage: plan.overBudget ? 'blocked' : 'planned',
    planId: plan.id,
    say: describePlan(plan),
    plan: toPublic(plan),
  });
});

app.post('/v1/confirm/:id', async (req, res) => {
  const plan = plans.get(req.params.id);
  if (!plan) return res.status(404).json({ ok: false, message: '方案已过期或已下单，请重新试算' });
  reply(req, res, await confirm(req, plan, req.query.force === '1'));
});

/** 万能按钮：第一次按试算，confirmWindowSec 内同一按钮再按一次就下单 */
app.all('/v1/press', async (req, res) => {
  const config = loadConfig();
  const input = readInput(req);
  const button = `${input.scene || 'auto'}|${input.text || ''}`;

  const pending = plans.get(lastPress.get(button));
  if (pending && Date.now() - pending.createdAt < config.confirmWindowSec * 1000) {
    lastPress.delete(button);
    return reply(req, res, await confirm(req, pending, false));
  }

  const plan = await buildPlan(input, { config });
  remember(plans, plan.id, plan, config.planTtlSec);
  if (!plan.overBudget) lastPress.set(button, plan.id);
  reply(req, res, {
    stage: plan.overBudget ? 'blocked' : 'planned',
    planId: plan.id,
    say: plan.overBudget ? describePlan(plan) : `${describePlan(plan)}\n${config.confirmWindowSec} 秒内再按一次确认下单`,
    plan: toPublic(plan),
  });
});

/** 只读预览，10 分钟缓存，不领券（编辑器状态栏轮询用） */
app.get('/v1/peek', async (req, res) => {
  const input = readInput(req);
  const data = await cacheWrap(`peek:${input.scene || 'auto'}|${input.text || ''}`, 10 * 60_000, async () => {
    const plan = await buildPlan(input, { peek: true });
    return { say: describePlan(plan), total: plan.total, store: plan.store.name, sceneLabel: plan.sceneLabel };
  });
  res.json({ ok: true, ...data });
});

app.get('/v1/orders/:orderId', async (req, res) => {
  const r = await callMcpTool('query-order', { orderId: req.params.orderId });
  res.json({ ok: true, order: r?.data ?? r });
});

app.use((err, req, res, _next) => {
  console.error('[mcaction]', err.message);
  if (req.query.format === 'text') return res.status(502).type('text/plain; charset=utf-8').send(`出错：${err.message}`);
  if (req.query.format === 'html') return res.status(502).type('html').send(page('出错了', `<pre>${esc(err.message)}</pre>`));
  res.status(502).json({ ok: false, message: err.message });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`麦一下已启动：http://${HOST}:${PORT}`);
  if (!KEY) console.log('未设置 MCACTION_KEY，只允许本机访问；手机 / NFC 触发前请设置后重启。');
});

async function shutdown() {
  await closeMcpClient();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
