// 隔离测试（v2）：不碰设备、不碰 DSH，纯假数据。
//   用法：node test-offline.mjs
import { parseReport, buildOutputReport } from '../hid.mjs'
import { createTouchMachine, createSqueezeMachine, 估压力, 力度词 } from '../core.mjs'
import { 描述事件 } from '../impl.mjs'

let 过 = 0
let 不过 = 0
function 查(名, 条件, 细节 = '') {
  if (条件) { 过++; console.log('  ✓', 名) }
  else { 不过++; console.log('  ✗', 名, 细节) }
}

/** 跑一段假轨迹：喂 {x,y} 序列，每帧 4ms，返回事件 */
function 跑轨迹(点们, { dual = false, 起始 = 1000 } = {}) {
  const m = createTouchMachine({ minEmitGapMs: 0 })
  const 事件 = []
  let t = 起始
  m.feed({ active: false }, t)
  for (const p of 点们) {
    const e = m.feed({ active: true, x: p.x, y: p.y, id: 0, dual: p.dual ?? dual }, t)
    if (e) 事件.push(e)
    t += 4
  }
  for (let i = 0; i < 40; i++) { const e = m.feed({ active: false }, t); if (e) 事件.push(e); t += 4 }
  return 事件
}

// ── 1. 报文解析 ─────────────────────────────────────────
console.log('\n[1] 报文解析')
{
  const buf = Buffer.alloc(64)
  buf[0] = 0x01
  const 填点 = (i, active, x, y, id = 0) => {
    buf[i] = (active ? 0x00 : 0x80) | (id & 0x7f)
    buf[i + 1] = x & 0xff
    buf[i + 2] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4)
    buf[i + 3] = (y >> 4) & 0xff
  }
  填点(33, true, 800, 300, 5)
  填点(37, false, 0, 0, 0)
  buf[5] = 120 // L2
  buf[6] = 30 // R2
  buf[8] = 0x80 // 三角
  const r = parseReport(buf)
  查('触摸点解析', r && r.touches[0].active && r.touches[0].x === 800 && r.touches[0].y === 300)
  查('扳机读数', r && r.l2 === 120 && r.r2 === 30)
  查('按键字节', r && r.buttons[0] === 0x80)
  const idle = Buffer.from('018880827f00004108000000f93eeebefefffbfffeffb9ff1e21cd04266e45cf09b100a037a705e43f7309090000000000288045cf280800a208e99b41723b3a', 'hex')
  const ri = parseReport(idle)
  查('真实空闲报文判为没碰', ri && !ri.touches[0].active && !ri.touches[1].active)
}

// ── 2. 直线摸 → 认出"摸"，带力气曲线 ────────────────────
console.log('\n[2] 直线摸')
{
  const 点 = []
  for (let i = 0; i < 150; i++) 点.push({ x: 300 + i * 3, y: 500 })
  const 事件 = 跑轨迹(点)
  查('出一条', 事件.length === 1, `实际 ${事件.length}`)
  if (事件[0]) {
    console.log('    kind =', 事件[0].kind)
    查('力气曲线有值', Array.isArray(事件[0].力气.曲线) && 事件[0].力气.曲线.length > 0, JSON.stringify(事件[0].力气))
    查('峰值 > 0', 事件[0].力气.峰值 > 0, String(事件[0].力气.峰值))
    console.log('    → 给她的话：', 描述事件(事件[0]))
  }
}

// ── 3. 揉（画圈）────────────────────────────────────────
console.log('\n[3] 揉（画圈）')
{
  const 点 = []
  for (let i = 0; i < 250; i++) {
    const θ = i * 0.22
    点.push({ x: 900 + Math.round(Math.cos(θ) * 70), y: 500 + Math.round(Math.sin(θ) * 70) })
  }
  const 事件 = 跑轨迹(点)
  console.log('    kind =', 事件[0] && 事件[0].kind)
  查('认出"揉"', 事件[0] && 事件[0].kind === 'knead', 事件[0] && 事件[0].kind)
  if (事件[0]) console.log('    → 给她的话：', 描述事件(事件[0]))
}

// ── 4. 挠（快速来回）────────────────────────────────────
console.log('\n[4] 挠（快速来回）')
{
  const 点 = []
  for (let i = 0; i < 200; i++) 点.push({ x: 300 + (i % 20 < 10 ? i % 10 : 10 - (i % 10)) * 40, y: 500 })
  const 事件 = 跑轨迹(点)
  console.log('    kind =', 事件[0] && 事件[0].kind)
  查('认出"挠"', 事件[0] && 事件[0].kind === 'scratch', 事件[0] && 事件[0].kind)
}

// ── 5. 搭手（按住不动）──────────────────────────────────
console.log('\n[5] 搭手')
{
  const 点 = []
  for (let i = 0; i < 400; i++) 点.push({ x: 900 + (i % 2), y: 500 })
  const 事件 = 跑轨迹(点)
  console.log('    kind =', 事件[0] && 事件[0].kind)
  查('认出"搭手"', 事件[0] && 事件[0].kind === 'hold', 事件[0] && 事件[0].kind)
  if (事件[0]) console.log('    → 给她的话：', 描述事件(事件[0]))
}

// ── 6. 戳 ───────────────────────────────────────────────
console.log('\n[6] 戳')
{
  const m = createTouchMachine({ minEmitGapMs: 0 })
  const 事件 = []
  let t = 8000
  m.feed({ active: false }, t); t += 4
  const e1 = m.feed({ active: true, x: 900, y: 500, id: 0 }, t); if (e1) 事件.push(e1)
  t += 4
  const e2 = m.feed({ active: false }, t); if (e2) 事件.push(e2)
  查('认出"戳"', 事件[0] && 事件[0].kind === 'tap', 事件[0] && 事件[0].kind)
  if (事件[0]) console.log('    → 给她的话：', 描述事件(事件[0]))
}

// ── 7. 扳机"捏"：真压力 ─────────────────────────────────
console.log('\n[7] 捏（扳机）')
{
  const m = createSqueezeMachine()
  const 事件 = []
  let t = 20000
  m.feed({ left: 0, right: 0 }, t)
  for (let i = 0; i <= 20; i++) { const e = m.feed({ left: 0, right: Math.round((i / 20) * 200) }, (t += 10)); if (e) 事件.push(e) }
  for (let i = 0; i <= 20; i++) { const e = m.feed({ left: 0, right: Math.round(200 - (i / 20) * 200) }, (t += 10)); if (e) 事件.push(e) }
  查('认出一次"捏"', 事件.length === 1, `实际 ${事件.length}`)
  if (事件[0]) {
    查('真压力峰值 200 左右', Math.abs(事件[0].peak - 200) <= 2, String(事件[0].peak))
    查('句子里有"真压力"', 描述事件(事件[0]).includes('真压力'))
    console.log('    → 给她的话：', 描述事件(事件[0]))
  }
}

// ── 8. 轻重 / 估压力 ────────────────────────────────────
console.log('\n[8] 轻重与力气')
{
  查('慢 → 轻轻', 力度词(100, 1000) === '轻轻')
  查('中速 → 不轻不重', 力度词(500, 1000) === '不轻不重', 力度词(500, 1000))
  查('快 → 有点用力', 力度词(2000, 1000) === '有点用力')
  查('估压力 0 速度 → 0', 估压力(0) === 0)
  查('估压力 极限 → 接近 100', 估压力(20000) >= 90)
}

// ── 9. 震动包布局 ──────────────────────────────────────
console.log('\n[9] 震动包')
{
  const out = buildOutputReport({ small: 100, large: 200 })
  查('长度 63', out.length === 63)
  查('报告 ID 0x02', out[0] === 0x02)
  查('小震位置', out[3] === 100)
  查('大震位置', out[4] === 200)
  const 灯 = buildOutputReport({ small: 0, large: 0, red: 255, green: 40, blue: 90 })
  查('灯条 RGB', 灯[45] === 255 && 灯[46] === 40 && 灯[47] === 90)
}

// ── 10. 扳机阻力包 ─────────────────────────────────────
console.log('\n[10] 扳机阻力')
{
  const 量 = buildOutputReport({
    leftTrigger: { mode: 'feedback', start: 90, force: 130 },
    rightTrigger: { mode: 'feedback', start: 90, force: 130 },
  })
  查('右扳机开关位（flag0 bit2）', (量[1] & 0x04) !== 0, 量[1].toString(16))
  查('左扳机开关位（flag0 bit3）', (量[1] & 0x08) !== 0, 量[1].toString(16))
  查('震动位还留着', (量[1] & 0x03) === 0x03)
  查('右扳机模式=反馈(0x01)', 量[11] === 0x01, String(量[11]))
  查('右扳机起点=90', 量[12] === 90, String(量[12]))
  查('右扳机力度=130', 量[13] === 130, String(量[13]))
  查('左扳机模式=反馈(0x01)', 量[22] === 0x01, String(量[22]))
  查('左扳机起点=90', 量[23] === 90, String(量[23]))
  查('左扳机力度=130', 量[24] === 130, String(量[24]))
  const 关 = buildOutputReport({})
  查('不给扳机效果时 flag0 只有震动位', 关[1] === 0x03, String(关[1]))
  查('不给扳机效果时效果块是空的', 关[11] === 0 && 关[22] === 0)
}

// ── 11. 手停住不会反复识别 ─────────────────────────────
console.log('\n[11] 手停住不刷屏')
{
  const m = createTouchMachine({ minEmitGapMs: 0 })
  const 事件 = []
  let t = 30000
  m.feed({ active: false }, t)
  t += 4
  m.feed({ active: true, x: 900, y: 500, id: 0 }, t)
  for (let i = 0; i < 1500; i++) {
    const e = m.feed({ active: true, x: 900 + (i % 2), y: 500, id: 0 }, (t += 4))
    if (e) 事件.push(e)
  }
  for (let i = 0; i < 5; i++) { const e = m.feed({ active: false }, (t += 4)); if (e) 事件.push(e) }
  查('停 6 秒只发一条', 事件.length === 1, `实际 ${事件.length}`)
  if (事件[0]) {
    查('这条是"搭手"', 事件[0].kind === 'hold', 事件[0].kind)
    console.log('    → 给她的话：', 描述事件(事件[0]))
  }
}

// ── 12. 停→动→停：第二条才算新动作 ────────────────────
console.log('\n[12] 停住再动才算新动作')
{
  const m = createTouchMachine({ minEmitGapMs: 0 })
  const 事件 = []
  let t = 40000
  m.feed({ active: false }, t)
  t += 4
  m.feed({ active: true, x: 900, y: 500, id: 0 }, t)
  for (let i = 0; i < 400; i++) { const e = m.feed({ active: true, x: 900, y: 500, id: 0 }, (t += 4)); if (e) 事件.push(e) }
  for (let i = 0; i < 80; i++) { const e = m.feed({ active: true, x: 900 + i * 5, y: 500, id: 0 }, (t += 4)); if (e) 事件.push(e) }
  for (let i = 0; i < 400; i++) { const e = m.feed({ active: true, x: 1300, y: 500, id: 0 }, (t += 4)); if (e) 事件.push(e) }
  for (let i = 0; i < 5; i++) { const e = m.feed({ active: false }, (t += 4)); if (e) 事件.push(e) }
  查('一共两条（搭手 + 摸）', 事件.length === 2, `实际 ${事件.length}（${事件.map((e) => e.kind).join(',')}）`)
}

// ── 13. 一直动：不会一秒一条 ────────────────────────────
console.log('\n[13] 一直动不刷屏')
{
  const m = createTouchMachine({ minEmitGapMs: 0 })
  const 事件 = []
  let t = 60000
  m.feed({ active: false }, t)
  t += 4
  for (let i = 0; i < 3750; i++) {
    const x = 300 + ((i * 5) % 1200)
    const e = m.feed({ active: true, x, y: 500, id: 0 }, (t += 4))
    if (e) 事件.push(e)
  }
  for (let i = 0; i < 5; i++) { const e = m.feed({ active: false }, (t += 4)); if (e) 事件.push(e) }
  查('15 秒连续摸，消息数 2~4 条', 事件.length >= 2 && 事件.length <= 4, `实际 ${事件.length}`)
}

// ── 14. 摸完停住：不再补发"搭手" ───────────────────────
console.log('\n[14] 摸完停住不发搭手')
{
  const m = createTouchMachine({ minEmitGapMs: 0 })
  const 事件 = []
  let t = 80000
  m.feed({ active: false }, t)
  t += 4
  m.feed({ active: true, x: 800, y: 500, id: 0 }, t)
  for (let i = 0; i < 120; i++) { const e = m.feed({ active: true, x: 800 + i * 5, y: 500, id: 0 }, (t += 4)); if (e) 事件.push(e) } // 摸一段
  for (let i = 0; i < 800; i++) { const e = m.feed({ active: true, x: 1400, y: 500, id: 0 }, (t += 4)); if (e) 事件.push(e) } // 停 3.2 秒
  for (let i = 0; i < 5; i++) { const e = m.feed({ active: false }, (t += 4)); if (e) 事件.push(e) }
  查('只发一条"摸"，不再补"搭手"', 事件.length === 1, `实际 ${事件.length}（${事件.map((e) => e.kind).join(',')}）`)
  if (事件[0]) 查('就是那条摸', 事件[0].kind !== 'hold', 事件[0].kind)
}

console.log(`\n结果：过 ${过}，不过 ${不过}`)
if (不过) process.exitCode = 1
