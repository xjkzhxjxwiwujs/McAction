import crypto from 'node:crypto';
import { callMcpTool } from './mcp.js';
import { cacheWrap } from './cache.js';
import { getMealCatalog, matchMealsByKeywords } from './catalog.js';
import { loadConfig, pickScene } from './config.js';
import { parseIntent } from './intent.js';

export const MODES = {
  delivery: { beType: 2, orderType: 2, label: '麦乐送' },
  pickup: { beType: 1, orderType: 1, label: '到店自取' },
  dt: { beType: 5, orderType: 1, label: '得来速' },
};

const yuan = (fen) => (Number(fen || 0) / 100).toFixed(2);
const pad = (n) => String(n).padStart(2, '0');
const formatReservation = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** at="12:40"（已过则顺延到明天）或 inMinutes=25 → "yyyy-MM-dd HH:mm" */
export function resolveReservation({ at, inMinutes } = {}, now = new Date()) {
  if (inMinutes) return formatReservation(new Date(now.getTime() + Number(inMinutes) * 60_000));
  if (!at) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at).trim());
  if (!m) throw new Error(`预约时间格式应为 HH:mm，收到「${at}」`);
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return formatReservation(d);
}

const pickOpen = (list) => {
  const stores = Array.isArray(list) ? list : [];
  return stores.find((s) => s.businessStatus !== false) || stores[0];
};

async function findStore(where, mode) {
  if (mode === 'delivery') {
    const addresses = await cacheWrap('addresses', 120_000, async () => {
      const r = await callMcpTool('delivery-query-addresses');
      return r?.data?.addresses || [];
    });
    const address =
      (where.addressKeyword && addresses.find((a) => (a.fullAddress || '').includes(where.addressKeyword))) ||
      addresses[0];
    if (!address) throw new Error('账号里还没有配送地址，请先在麦当劳 App 添加');

    const stores = await cacheWrap(`stores:delivery:${address.addressId}`, 120_000, async () => {
      const r = await callMcpTool('delivery-query-stores', { addressId: address.addressId, beType: 2 });
      return r?.data || [];
    });
    const store = pickOpen(stores);
    if (!store?.storeCode) throw new Error('这个地址附近暂无可配送门店');
    return {
      store,
      address: { id: address.addressId, text: address.fullAddress },
      base: { storeCode: store.storeCode, beCode: store.beCode, beType: 2, orderType: 2 },
    };
  }

  const { beType } = MODES[mode];
  const args =
    where.city && where.keyword
      ? { beType, searchType: 2, city: where.city, keyword: where.keyword }
      : { beType, searchType: 1 };
  const stores = await cacheWrap(`stores:${beType}:${args.city || 'fav'}:${args.keyword || ''}`, 120_000, async () => {
    const r = await callMcpTool('query-nearby-stores', args);
    return r?.data || [];
  });
  const store = pickOpen(stores);
  if (!store?.storeCode) throw new Error(`「${args.city || '收藏'} ${args.keyword || ''}」附近没有可${MODES[mode].label}的门店`);
  const base = { storeCode: store.storeCode, beType, orderType: 1 };
  if (beType === 5) base.beCode = store.beCode;
  return { store, address: null, base };
}

function extractCoupons(result) {
  const data = result?.data ?? result;
  const list = Array.isArray(data) ? data : data?.coupons || data?.couponList || data?.availableCoupons || [];
  return list.filter((c) => c.couponId || c.couponCode);
}

const withCoupon = (items, index, coupon) =>
  items.map((it, i) =>
    i !== index
      ? it
      : {
          ...it,
          ...(coupon.couponId ? { couponId: String(coupon.couponId) } : {}),
          ...(coupon.couponCode ? { couponCode: String(coupon.couponCode) } : {}),
        },
  );

/** 不用券的原价打底，再把候选券挂到每个商品上逐一试算，取应付最低的一组 */
async function bestPrice(base, items, { tryCoupons, autoBind }) {
  const calc = async (list) => {
    const r = await callMcpTool('calculate-price', { ...base, items: list });
    return r?.data ?? r;
  };
  const baseline = await calc(items);
  let best = { items, price: baseline, coupon: null };
  if (!tryCoupons) return { ...best, baseline };

  if (autoBind) await callMcpTool('auto-bind-coupons').catch(() => null);
  const coupons = extractCoupons(await callMcpTool('query-store-coupons', base).catch(() => null)).slice(0, tryCoupons);

  const candidates = coupons.flatMap((coupon) =>
    items.slice(0, 2).map((_, index) => ({ coupon, items: withCoupon(items, index, coupon) })),
  );
  const results = await Promise.allSettled(candidates.map(async (c) => ({ ...c, price: await calc(c.items) })));
  for (const r of results) {
    if (r.status === 'fulfilled' && Number(r.value.price?.price) < Number(best.price?.price)) best = r.value;
  }
  return { ...best, baseline };
}

const pickTakeWayCode = (price) => {
  const list = price?.takeWayList || [];
  const preferred = list.find((t) => /自取|堂食|到店|Take/i.test(`${t.name || ''}${t.code || ''}`)) || list[0];
  return preferred?.code ? String(preferred.code) : null;
};

export function describePlan(p) {
  return [
    `${p.sceneLabel} · ${p.modeLabel} · ${p.store.name}`,
    p.reservationDate ? `预约 ${p.reservationDate.slice(11)} 取餐` : null,
    p.lines.map((l) => `${l.name} ×${l.quantity}`).join('、'),
    `应付 ¥${p.total}` + (p.coupon ? `（用「${p.coupon}」省 ¥${p.saved}）` : ''),
    p.overBudget ? `超出预算 ¥${p.budget}，不会自动下单` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * input: { text, scene, budget, at, inMinutes, city, keyword, mode, now }
 * peek=true 时不领券（状态栏、CI 这类只读场景）
 */
export async function buildPlan(input = {}, { config = loadConfig(), peek = false } = {}) {
  const intent = parseIntent(input.text);
  const scene = pickScene(config, input.scene && input.scene !== 'auto' ? input.scene : intent.scene, input.now);
  const mode = input.mode || intent.mode || scene.mode || 'pickup';
  if (!MODES[mode]) throw new Error(`不支持的取餐方式「${mode}」，可选 delivery / pickup / dt`);

  const keywords = intent.keywords.length ? intent.keywords : scene.items || [];
  if (!keywords.length) throw new Error(`场景「${scene.label}」没配置 items，也没说想吃什么`);

  const where = input.city && input.keyword ? { ...scene, city: input.city, keyword: input.keyword } : scene;
  const budget = Number(input.budget ?? intent.budget ?? scene.budget ?? config.budget) || 0;
  const reservationDate = resolveReservation(
    { at: input.at ?? scene.at, inMinutes: input.inMinutes ?? scene.inMinutes },
    input.now,
  );

  const { store, address, base } = await findStore(where, mode);
  if (reservationDate) base.reservationDate = reservationDate;

  const meals = await matchMealsByKeywords(base, await getMealCatalog(base), keywords);
  const items = meals.map((m) => ({ productCode: m.productCode, quantity: 1 }));
  const priced = await bestPrice(base, items, {
    tryCoupons: config.tryCoupons,
    autoBind: config.autoBindCoupons && !peek,
  });

  const total = Number(priced.price?.price ?? 0);
  const plan = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    scene: scene.key,
    sceneLabel: scene.label,
    mode,
    modeLabel: MODES[mode].label,
    store: { name: store.storeName || store.name || store.storeCode, code: store.storeCode },
    address,
    base,
    items: priced.items,
    lines: meals.map((m) => ({ name: m.name || m.productCode, quantity: 1 })),
    coupon: priced.coupon ? priced.coupon.title || priced.coupon.name || priced.coupon.couponName || '优惠券' : null,
    total: yuan(total),
    deliveryFee: priced.price?.deliveryPrice != null ? yuan(priced.price.deliveryPrice) : null,
    saved: yuan(Number(priced.baseline?.price ?? total) - total),
    takeWayCode: MODES[mode].orderType === 1 ? pickTakeWayCode(priced.price) : null,
    reservationDate: reservationDate || null,
    budget,
    overBudget: budget > 0 && total > budget * 100,
  };
  plan.summary = describePlan(plan);
  return plan;
}

export function toPublic(plan) {
  const { base, items, address, ...rest } = plan;
  return { ...rest, address: address?.text ?? null };
}

function extractPayment(order) {
  const root = order?.data && typeof order.data === 'object' ? order.data : order;
  return {
    orderId: root?.orderId || root?.orderDetail?.orderId || null,
    payUrl: root?.payH5Url || root?.payUrl || root?.paymentUrl || root?.orderDetail?.payH5Url || null,
  };
}

/** 只创建订单、拿支付链接；付款永远由用户自己完成 */
export async function placeOrder(plan) {
  const payload = { ...plan.base, items: plan.items };
  if (plan.base.orderType === 2) payload.addressId = plan.address.id;
  if (plan.base.orderType === 1) {
    if (!plan.takeWayCode) throw new Error('门店没返回取餐方式（takeWayCode），无法到店下单');
    payload.takeWayCode = plan.takeWayCode;
  }
  const r = await callMcpTool('create-order', payload);
  return extractPayment(r?.data ?? r);
}
