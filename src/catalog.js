import { callMcpTool } from './mcp.js';
import { cacheGet, cacheSet } from './cache.js';

const detailCache = new Map();

function storeKey(base) {
  return `${base.storeCode}:${base.beCode || ''}:${base.beType || ''}`;
}

function flattenCatalog(result) {
  const categories = (result?.data ?? result)?.categories || [];
  const list = [];
  for (const cat of categories) {
    const categoryName = (cat.name || cat.categoryName || '').replace(/\n/g, ' ');
    for (const meal of cat.meals || cat.products || cat.productList || []) {
      const code = meal.code || meal.productCode;
      if (!code) continue;
      list.push({
        productCode: String(code),
        name: meal.name || meal.productName || '',
        categoryName,
        tags: meal.tags || [],
      });
    }
  }
  return list;
}

export async function getMealCatalog(base) {
  const key = `meals:${storeKey(base)}`;
  const cached = cacheGet(key);
  if (cached) return cached.map((m) => ({ ...m }));
  const meals = flattenCatalog(await callMcpTool('query-meals', base));
  cacheSet(key, meals, 5 * 60_000);
  return meals.map((m) => ({ ...m }));
}

async function getMealDetail(base, code) {
  const key = `${storeKey(base)}:${code}`;
  if (detailCache.has(key)) return detailCache.get(key);
  const result = await callMcpTool('query-meal-detail', { ...base, code: String(code) });
  const detail = result?.data ?? result;
  detailCache.set(key, detail);
  return detail;
}

async function mapPool(items, concurrency, worker) {
  let idx = 0;
  const results = new Array(items.length);
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function ensureNames(base, pool) {
  await mapPool(
    pool.filter((m) => !m.name),
    4,
    async (meal) => {
      try {
        meal.name = (await getMealDetail(base, meal.productCode))?.name || meal.categoryName;
      } catch {
        meal.name = meal.categoryName || meal.productCode;
      }
    },
  );
}

const MERCH = /单肩包|周边|玩偶|盲盒|杯套|钥匙扣|贴纸|礼盒|卡套/;

function scoreMeal(meal, kw, allowCategoryOnly) {
  const name = meal.name || '';
  if (MERCH.test(name)) return -1;
  const nameHit = name.includes(kw);
  if (!nameHit && !allowCategoryOnly) return 0;
  let score = 0;
  if (nameHit) score += 100 + Math.max(0, 40 - name.length);
  if (name.startsWith(kw)) score += 40;
  if (nameHit && /套餐$/.test(name)) score += 30;
  if ((meal.categoryName || '').includes(kw)) score += nameHit ? 15 : 8;
  if (meal.tags.some((t) => String(t).includes(kw))) score += 5;
  return score;
}

/** 关键词 → 门店在售商品；名称命中优先，分类命中兜底 */
export async function matchMealsByKeywords(base, meals, keywords) {
  const used = new Set();
  const matched = [];

  for (const kw of keywords) {
    const available = meals.filter((m) => !used.has(m.productCode));
    const preferred = available.filter(
      (m) =>
        (m.categoryName || '').includes(kw) ||
        (m.name || '').includes(kw) ||
        m.tags.some((t) => String(t).includes(kw)),
    );
    const order = preferred.length
      ? [...preferred, ...available.filter((m) => !preferred.includes(m))]
      : available;

    let found = null;
    for (let i = 0; i < order.length && !found; i += 12) {
      const pool = order.slice(i, i + 12);
      await ensureNames(base, pool);
      found = pool
        .map((meal) => ({ meal, score: scoreMeal(meal, kw, false) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.meal;
      if (preferred.length && i + 12 >= Math.min(preferred.length, 36)) break;
    }

    if (!found && preferred.length) {
      const pool = preferred.slice(0, 8);
      await ensureNames(base, pool);
      found = pool
        .map((meal) => ({ meal, score: scoreMeal(meal, kw, true) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.meal;
    }

    if (!found) throw new Error(`这家店的菜单里没找到「${kw}」`);
    used.add(found.productCode);
    matched.push(found);
  }
  return matched;
}
