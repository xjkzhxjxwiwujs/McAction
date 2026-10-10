const SCENE_WORDS = [
  [/早餐|早饭|早上/, 'breakfast'],
  [/夜宵|宵夜/, 'night'],
  [/开车|车上|车里|得来速/, 'car'],
  [/公司|工位|上班/, 'work'],
  [/在家|回家|到家/, 'home'],
];
const MODE_WORDS = [
  [/麦乐送|外送|送到/, 'delivery'],
  [/自取|到店/, 'pickup'],
];
const USUAL = /老样子|照旧|老规矩|还是那样/;
const BUDGET = /(\d+(?:\.\d+)?)\s*(?:元|块)钱?(?:以内|以下|之内|内)?/;
const FILLER = /帮我|给我|我要|我想|想吃|来一份|来一个|来个|来份|点个|点一份|一份|一个|麦一下|吧|呢|啊|的/g;

/** "30元以内 牛肉" / "老样子" / "早餐 自取 猪柳蛋" → 结构化意图 */
export function parseIntent(text = '') {
  let rest = String(text || '').trim();
  const intent = { keywords: [], usual: false };

  const budget = BUDGET.exec(rest);
  if (budget) {
    intent.budget = Number(budget[1]);
    rest = rest.replace(budget[0], ' ');
  }
  if (USUAL.test(rest)) {
    intent.usual = true;
    rest = rest.replace(USUAL, ' ');
  }
  for (const [re, scene] of SCENE_WORDS) {
    if (!re.test(rest)) continue;
    intent.scene ??= scene;
    rest = rest.replace(re, ' ');
  }
  for (const [re, mode] of MODE_WORDS) {
    if (!re.test(rest)) continue;
    intent.mode ??= mode;
    rest = rest.replace(re, ' ');
  }

  intent.keywords = rest
    .replace(FILLER, ' ')
    .split(/[\s,，、+＋和]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return intent;
}
