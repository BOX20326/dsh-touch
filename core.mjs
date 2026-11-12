// DSH 摸摸插件 · 中间那层（v4）：把触摸点连成"动作"，翻成一件事。
//
// v4 改的是节奏：
//   · 一次"连续接触"里，不会因为手停住就被反复识别
//   · 手停下来 → 把刚才那段动作收掉、发一条；再停一会儿还没动 → 发一条"搭手"，之后安静
//   · 想再发，得抬手重按、或者停住之后再动起来
//   · 一直在动的话，每 6 秒最多切一段（长摸也不会一条接一条刷屏）
//
// 手势：摸 / 抚摸 / 揉 / 挠 / 戳 / 双手 / 搭手；轻重用速度估。
// 纯逻辑，不碰设备、不写文件、不碰 DSH，可以单独喂假数据测。

export const DEFAULTS = {
  minMove: 30,        // 一段动作至少移动这么多才算"摸"
  tapMs: 260,         // 短于这个就算"戳"
  holdMs: 1100,       // 停住这么久还没动 = 搭手
  停顿毫秒: 1200,     // 手停下来这么久，才把当前这段动作收掉发出去
  最长段: 10000,      // 一直在动也每 10 秒切一段
  单帧动: 2.5,        // 一帧移动超过这个数才算"在动"（滤掉手指抖动）
  minEmitGapMs: 6000, // 两条消息之间最少隔 6 秒
}

const 区名 = [
  { 到: 0.34, 名: '上面' },
  { 到: 0.66, 名: '中间' },
  { 到: 1.01, 名: '下面' },
]

export function 方向词(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy) * 1.5) return dx >= 0 ? '从左往右' : '从右往左'
  if (Math.abs(dy) >= Math.abs(dx) * 1.5) return dy >= 0 ? '从上往下' : '从下往上'
  return '斜着'
}

export function 快慢词(dist, ms) {
  if (!ms) return '很轻'
  const 速度 = dist / (ms / 1000)
  if (速度 < 260) return '慢慢的'
  if (速度 < 900) return '不快不慢'
  return '有点急'
}

/** 轻重：触摸板没有压力，用速度当代理 */
export function 力度词(dist, ms) {
  if (!ms) return '轻轻'
  const 速度 = dist / (ms / 1000)
  if (速度 < 260) return '轻轻'
  if (速度 < 900) return '不轻不重'
  return '有点用力'
}

/** 把速度估成 0~100 的"力气"（估的，不是真压力；真压力只有扳机有） */
export function 估压力(速度) {
  const p = 100 * (1 - Math.exp(-Math.max(0, 速度) / 800))
  return Math.max(0, Math.min(100, Math.round(p)))
}

function 认手势(c, cfg = DEFAULTS) {
  const ms = Math.max(1, c.endAt - c.startAt)
  const dist = c.dist
  const 直 = Math.hypot(c.lastX - c.startX, c.lastY - c.startY)
  const 直度 = dist > 1 ? 直 / dist : 1
  const 速度 = dist / (ms / 1000)
  const 转向 = c.rx + c.ry

  if (c.dualMs >= 180) return 'dual'
  if (ms >= cfg.holdMs && c.maxR < 60) return 'hold'
  if (dist < cfg.minMove) return ms < cfg.tapMs ? 'tap' : 'hold'
  if (c.rx >= 2 && c.ry >= 2) return 'knead'
  if (转向 >= 5 && 速度 > 650) return 'scratch'
  if (ms >= 1200 && 速度 < 420 && 转向 <= 2) return 'stroke'
  return 'pet'
}

/** 把一段动作的统计翻成事件 */
function 造事件(段, cfg, 现在) {
  const ms = Math.max(1, 段.止 - 段.起)
  const 直 = Math.hypot(段.上X - 段.起X, 段.上Y - 段.起Y)
  const 分类 = 认手势(
    {
      startAt: 段.起, endAt: 段.止,
      startX: 段.起X, startY: 段.起Y,
      lastX: 段.上X, lastY: 段.上Y,
      dist: 段.动距, rx: 段.rx, ry: 段.ry,
      maxR: 段.最大半径 || Math.max(直, 段.动距),
      dualMs: 段.双指时,
    },
    cfg,
  )
  const 力气们 = 段.力气们.slice()
  const 峰值 = 力气们.length ? Math.max(...力气们) : 0
  let 曲线 = []
  if (力气们.length) {
    const 上限 = 5
    if (力气们.length <= 上限) 曲线 = 力气们
    else for (let i = 0; i < 上限; i++) 曲线.push(力气们[Math.round((i / (上限 - 1)) * (力气们.length - 1))])
  }
  return {
    kind: 分类,
    ms,
    dist: 段.动距,
    dir: 方向词(段.上X - 段.起X, 段.上Y - 段.起Y),
    pace: 快慢词(段.动距, ms),
    vehemence: 力度词(段.动距, ms),
    region: 区名.find((r) => ((段.起Y + 段.上Y) / 2 / 1080) < r.到)?.名 || '上面',
    力气: { 峰值, 曲线, 平均: 力气们.length ? Math.round(力气们.reduce((a, b) => a + b, 0) / 力气们.length) : 0 },
    at: 现在,
    count: 1,
  }
}

export function createTouchMachine(options = {}) {
  const cfg = { ...DEFAULTS, ...options }
  let 接触 = null
  let pending = null
  let pendingCount = 0
  let lastEmitAt = -Infinity

  function 合并(a, b) {
    if (!a) return b
    a.count = (a.count || 1) + (b.count || 1)
    a.at = b.at
    if (a.kind === b.kind) {
      a.ms += b.ms
      a.dist += b.dist
    }
    return a
  }

  function 发(ev, now) {
    if (!ev) return
    pending = 合并(pending, ev)
    pendingCount++
  }

  function 放(now) {
    if (!pending) return null
    if (now - lastEmitAt < cfg.minEmitGapMs) return null
    const ev = pending
    pending = null
    ev.count = pendingCount || 1
    pendingCount = 0
    lastEmitAt = now
    return ev
  }

  function 开段(now, x, y) {
    return {
      起: now, 止: now, 起X: x, 起Y: y, 上X: x, 上Y: y,
      动距: 0, rx: 0, ry: 0, sx: 0, sy: 0, ax: 0, ay: 0,
      最大半径: 0, 双指时: 0,
      力气们: [], 窗口起: now, 窗动距: 0,
    }
  }

  function 收段(接触本, now) {
    const 段 = 接触本.段
    if (!段) return null
    接触本.段 = null
    if (段.窗动距 > 0) 段.力气们.push(估压力(段.窗动距 / (Math.max(1, now - 段.窗口起) / 1000)))
    段.止 = now
    return 造事件(段, cfg, now)
  }

  function 新接触(sample, now) {
    return {
      起: now, 止: now,
      起X: sample.x, 起Y: sample.y, 上X: sample.x, 上Y: sample.y,
      最大半径: 0, 双指时: 0, 点数: 1,
      停: now, 搭手已发: false, 发过动作: false, 段: null,
      上次帧: now,
    }
  }

  function 结束接触(now) {
    const c = 接触
    接触 = null
    if (!c) return
    const 总时长 = Math.max(0, now - c.起)
    if (c.段) {
      if (c.段.动距 >= cfg.minMove) { 发(收段(c, now), now); c.发过动作 = true }
      else c.段 = null
    }
    if (!c.搭手已发 && !c.发过动作 && 总时长 < cfg.tapMs) {
      发({ kind: 'tap', ms: 总时长, at: now, count: 1 }, now)
      return
    }
    if (!c.搭手已发 && !c.发过动作 && 总时长 >= cfg.holdMs && c.最大半径 < 60) {
      发({ kind: 'hold', ms: 总时长, at: now, count: 1 }, now)
      c.搭手已发 = true
    }
  }

  return {
    feed(sample, now = Date.now()) {
      const active = !!sample && sample.active
      if (!active) {
        if (接触) 结束接触(now)
        return 放(now)
      }

      if (!接触) 接触 = 新接触(sample, now)
      const c = 接触
      const dt = Math.max(1, now - c.上次帧)
      const 移 = Math.hypot(sample.x - c.上X, sample.y - c.上Y)
      c.上次帧 = now
      c.止 = now
      c.点数++
      c.上X = sample.x
      c.上Y = sample.y
      const 半径 = Math.hypot(sample.x - c.起X, sample.y - c.起Y)
      if (半径 > c.最大半径) c.最大半径 = 半径
      if (sample.dual) c.双指时 += dt

      const 在动 = 移 > cfg.单帧动
      if (在动) {
        c.停 = now
        if (!c.段) c.段 = 开段(now, sample.x, sample.y)
        const 段 = c.段
        const dx = sample.x - 段.上X
        const dy = sample.y - 段.上Y
        段.动距 += 移
        段.窗动距 += 移
        段.止 = now
        段.上X = sample.x
        段.上Y = sample.y
        段.最大半径 = Math.max(段.最大半径, Math.hypot(sample.x - 段.起X, sample.y - 段.起Y))
        if (sample.dual) 段.双指时 += dt
        if (dx !== 0) {
          const 向 = dx > 0 ? 1 : -1
          if (段.sx === 0) 段.sx = 向
          if (向 === 段.sx) 段.ax += dx
          else {
            段.ax += dx
            if (Math.abs(段.ax) >= 14) { 段.rx++; 段.sx = -段.sx; 段.ax = 0 }
          }
        }
        if (dy !== 0) {
          const 向 = dy > 0 ? 1 : -1
          if (段.sy === 0) 段.sy = 向
          if (向 === 段.sy) 段.ay += dy
          else {
            段.ay += dy
            if (Math.abs(段.ay) >= 14) { 段.ry++; 段.sy = -段.sy; 段.ay = 0 }
          }
        }
        if (now - 段.窗口起 >= 100) {
          段.力气们.push(估压力(段.窗动距 / (Math.max(1, now - 段.窗口起) / 1000)))
          段.窗动距 = 0
          段.窗口起 = now
        }
        if (now - 段.起 >= cfg.最长段) {
          发(收段(c, now), now)
          c.发过动作 = true
        }
      } else {
        if (c.段 && now - c.停 >= cfg.停顿毫秒) {
          if (c.段.动距 >= cfg.minMove) { 发(收段(c, now), now); c.发过动作 = true }
          else c.段 = null
        }
        // 只有"放上去就没动过"的手，才发一条"搭手"；摸过之后再停住不再补发
        if (!c.段 && !c.搭手已发 && !c.发过动作 && now - c.停 >= cfg.holdMs) {
          发({ kind: 'hold', ms: now - c.停, at: now, count: 1 }, now)
          c.搭手已发 = true
        }
      }
      return 放(now)
    },
    flush(now = Date.now()) {
      return 放(now)
    },
    get state() {
      return { 接触中: !!接触, pending: !!pending, lastEmitAt }
    },
  }
}

// ═══════════════════════════════════════════════════════
// 扳机：L2 / R2 当"捏"
// ═══════════════════════════════════════════════════════

export const 捏默认 = {
  onAt: 35,
  offAt: 20,
  minMs: 120,
}

export function 捏力度词(peak) {
  if (peak < 110) return '轻轻'
  if (peak < 190) return '用力'
  return '很用力'
}

export function createSqueezeMachine(options = {}) {
  const cfg = { ...捏默认, ...options }
  let cur = null
  return {
    feed({ left = 0, right = 0 } = {}, now = Date.now()) {
      const 最大 = Math.max(left, right)
      if (!cur) {
        if (最大 >= cfg.onAt) cur = { startAt: now, peak: 最大, left: left >= right ? 最大 : 0, right: right > left ? 最大 : 0 }
        return null
      }
      cur.peak = Math.max(cur.peak, 最大)
      cur.left = Math.max(cur.left, left)
      cur.right = Math.max(cur.right, right)
      if (最大 <= cfg.offAt) {
        const 段 = cur
        cur = null
        const ms = Math.max(0, now - 段.startAt)
        if (ms < cfg.minMs) return null
        const 双侧 = 段.left >= cfg.onAt && 段.right >= cfg.onAt
        return {
          kind: 'squeeze',
          ms,
          peak: 段.peak,
          side: 双侧 ? '两只手' : 段.left >= 段.right ? '左手' : '右手',
          vehemence: 捏力度词(段.peak),
          at: now,
          count: 1,
        }
      }
      return null
    },
    get state() {
      return { squeezing: !!cur, peak: cur ? cur.peak : 0 }
    },
  }
}
