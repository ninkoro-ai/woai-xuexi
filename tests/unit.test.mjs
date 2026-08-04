// 我ai学习 · 纯逻辑单元测试（M-06 整改基线）
// 通过从 deploy/app.html 抽取真实源码函数进行断言，避免与实现漂移。
// 运行：node --test deploy/tests/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'app.html'), 'utf8');

// 按函数名抽取源码（花括号匹配），eval 为函数
function extract(name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = html.match(re);
  if (!m) throw new Error('未找到函数: ' + name);
  let i = m.index + m[0].length - 1; // 定位首个 '{'
  let depth = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(m.index, i);
}
function loadFn(name) {
  // 直接 eval：使抽取出的函数闭包捕获本模块作用域（esc/dateStr/S/TOTAL 等依赖）
  // eslint-disable-next-line no-eval
  return eval('(' + extract(name) + ')');
}

// 常量
const TOTAL = Number((html.match(/var TOTAL\s*=\s*(\d+)/) || [])[1]);
const KEY = (html.match(/var KEY\s*=\s*"([^"]+)"/) || [])[1];
const PER_KP = Number((html.match(/var PER_KP\s*=\s*(\d+)/) || [])[1]);

const esc = loadFn('esc');
const escAttr = loadFn('escAttr');
const hl = loadFn('hl');
const pad = loadFn('pad');
const dateStr = loadFn('dateStr');
const sanitizeImport = loadFn('sanitizeImport');
const planBounds = loadFn('planBounds');
const normalizeState = loadFn('normalizeState');

// 供 planBounds / normalizeState 使用的全局桩
const S = { startDay: '2026-08-02' };

test('esc 转义 & < > " ', () => {
  assert.equal(esc('<a>&"'), '&lt;a&gt;&amp;&quot;');
});

test('escAttr 额外转义 单引号/反引号/斜杠', () => {
  assert.equal(escAttr(`a'b\`c/d`), 'a&#39;b&#96;c&#47;d');
  // 同时仍转义 & < > "
  assert.equal(escAttr('<x>&"'), '&lt;x&gt;&amp;&quot;');
});

test('hl 高亮命中（大小写不敏感）', () => {
  const out = hl('Hello World', 'world');
  assert.ok(out.includes('<mark>World</mark>'));
});

test('hl 空查询直接返回转义文本', () => {
  assert.equal(hl('<b>', ''), '&lt;b&gt;');
});

test('hl 查询超长被截断（防 ReDoS）', () => {
  const longQ = 'a'.repeat(500);
  // 不应抛错；内部截断到 50
  const out = hl('a'.repeat(600), longQ);
  assert.ok(typeof out === 'string');
});

test('dateStr 返回 YYYY-MM-DD', () => {
  assert.match(dateStr(0), /^\d{4}-\d{2}-\d{2}$/);
});

test('TOTAL / PER_KP 常量合理', () => {
  assert.equal(TOTAL, 90);
  assert.equal(PER_KP, 10);
  assert.equal(KEY, 'wb_kaoyan2_');
});

test('sanitizeImport 拒绝畸形值（类型/范围校验）', () => {
  const d = {
    _type: 'kaoyan-workbench-v2', _v: 2, done: {},
    score: '999999',            // 字符串 -> 数值
    wrong: 'not-an-array',      // 应为数组 -> 兜底 []
    studyDays: 99999,           // 超出上限 -> 截断 365
    periodUsed: 99,             // 超出上限 -> 截断 2
    notes: 'x',                 // 应为对象 -> 兜底 {}
    kpDone: null
  };
  const s = sanitizeImport(d);
  assert.equal(s.score, 999999);
  assert.deepEqual(s.wrong, []);
  assert.equal(s.studyDays, 365);
  assert.equal(s.periodUsed, 2);
  assert.deepEqual(s.notes, {});
  assert.deepEqual(s.kpDone, {});
});

test('sanitizeImport 缺失字段兜底为安全默认', () => {
  const s = sanitizeImport({ _type: 'kaoyan-workbench-v2', _v: 2, done: {} });
  assert.equal(s.curSub, 'all');
  assert.equal(s.easyDay, null);
  assert.deepEqual(s.records, []);
});

test('planBounds 基于 startDay 动态推算（不再写死 2026）', () => {
  S.startDay = '2026-08-02';
  let b = planBounds();
  assert.deepEqual(b.min, { y: 2026, m: 7 });   // 8月
  assert.deepEqual(b.max, { y: 2026, m: 9 });   // 8/2 + 89天 = 10/30 -> 10月

  // 跨年场景：计划不会“伪报废”
  S.startDay = '2027-08-02';
  b = planBounds();
  assert.deepEqual(b.min, { y: 2027, m: 7 });
  assert.deepEqual(b.max, { y: 2027, m: 9 });
});

test('planBounds startDay 缺失时兜底 2026-08-02', () => {
  const saved = S.startDay;
  S.startDay = undefined;
  const b = planBounds();
  assert.deepEqual(b.min, { y: 2026, m: 7 });
  S.startDay = saved;
});

test('normalizeState 把 null/畸形字段收敛为安全默认', () => {
  const s = normalizeState({
    startDay: null, done: null, kpDone: null, score: 'x',
    records: 'bad', wrong: null, periodUsed: 99, studyDays: 'abc',
    notes: null, mastery: null
  });
  assert.equal(typeof s.startDay, 'string');
  assert.deepEqual(s.done, {});
  assert.equal(s.score, 0);
  assert.deepEqual(s.records, []);
  assert.deepEqual(s.wrong, []);
  assert.equal(s.periodUsed, 2);
  assert.equal(s.studyDays, 90);
  assert.deepEqual(s.notes, {});
});
