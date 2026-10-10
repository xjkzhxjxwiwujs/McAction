import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from '../src/intent.js';
import { autoSceneKey, pickScene } from '../src/config.js';
import { resolveReservation } from '../src/engine.js';

const config = {
  scenes: { breakfast: { mode: 'pickup' }, work: { mode: 'pickup' }, night: { mode: 'delivery' }, home: { mode: 'delivery' } },
  auto: [
    { from: '05:00', to: '10:30', scene: 'breakfast' },
    { from: '10:30', to: '14:00', scene: 'work' },
    { from: '21:00', to: '05:00', scene: 'night' },
    { scene: 'home' },
  ],
};
const at = (h, m = 0) => new Date(2026, 9, 24, h, m);

test('预算 + 关键词', () => {
  assert.deepEqual(parseIntent('30元以内 牛肉'), { keywords: ['牛肉'], usual: false, budget: 30 });
});

test('老样子不产生关键词', () => {
  assert.deepEqual(parseIntent('老样子'), { keywords: [], usual: true });
});

test('场景词与取餐方式', () => {
  const intent = parseIntent('早餐 自取 猪柳蛋麦满分和咖啡');
  assert.equal(intent.scene, 'breakfast');
  assert.equal(intent.mode, 'pickup');
  assert.deepEqual(intent.keywords, ['猪柳蛋麦满分', '咖啡']);
});

test('按时间自动选场景，跨午夜区间也能命中', () => {
  assert.equal(autoSceneKey(config, at(7)), 'breakfast');
  assert.equal(autoSceneKey(config, at(12)), 'work');
  assert.equal(autoSceneKey(config, at(23)), 'night');
  assert.equal(autoSceneKey(config, at(2)), 'night');
  assert.equal(autoSceneKey(config, at(17)), 'home');
});

test('未知场景给出可选列表', () => {
  assert.throws(() => pickScene(config, 'gym'), /breakfast、work、night、home/);
});

test('预约时间', () => {
  assert.equal(resolveReservation({ inMinutes: 25 }, at(7, 50)), '2026-10-24 08:15');
  assert.equal(resolveReservation({ at: '12:40' }, at(11)), '2026-10-24 12:40');
  assert.equal(resolveReservation({ at: '07:00' }, at(11)), '2026-10-25 07:00');
  assert.equal(resolveReservation({}, at(11)), undefined);
});
