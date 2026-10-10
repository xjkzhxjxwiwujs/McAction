import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './env.js';

const DEFAULTS = {
  budget: 0,
  autoBindCoupons: true,
  tryCoupons: 5,
  confirmWindowSec: 60,
  planTtlSec: 300,
  scenes: {},
  auto: [],
};

function configPaths() {
  return [
    process.env.MCACTION_CONFIG,
    path.join(process.cwd(), 'mcaction.json'),
    path.join(os.homedir(), '.mcaction', 'config.json'),
    path.join(ROOT, 'mcaction.json'),
    path.join(ROOT, 'config', 'mcaction.example.json'),
  ].filter(Boolean);
}

/** 优先级：MCACTION_CONFIG_JSON（CI 用）> MCACTION_CONFIG > ./mcaction.json > ~/.mcaction/config.json > 示例 */
export function loadConfig() {
  if (process.env.MCACTION_CONFIG_JSON) {
    return { ...DEFAULTS, ...JSON.parse(process.env.MCACTION_CONFIG_JSON), source: 'env' };
  }
  for (const file of configPaths()) {
    if (fs.existsSync(file)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')), source: file };
    }
  }
  return { ...DEFAULTS, source: 'defaults' };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

export function autoSceneKey(config, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const rule of config.auto) {
    if (!rule.from || !rule.to) return rule.scene;
    const from = toMinutes(rule.from);
    const to = toMinutes(rule.to);
    const hit = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (hit) return rule.scene;
  }
  return Object.keys(config.scenes)[0];
}

export function pickScene(config, name, now = new Date()) {
  const key = name && name !== 'auto' ? name : autoSceneKey(config, now);
  const scene = config.scenes[key];
  if (!scene) {
    throw new Error(`没有名为「${key}」的场景，可选：${Object.keys(config.scenes).join('、') || '（未配置）'}`);
  }
  return { key, label: scene.label || key, ...scene };
}
