// DSH 摸摸插件 · 宿主半边（v2）
//
// 干什么：
//   · 把接入的触摸板（现在：PS5 手柄 DualSense）上的触感转成话，投进她的会话
//   · 让她能用工具（touch_back）**用手柄震动摸回来** —— 双向的
//
// v2 多了：
//   · 手势：摸 / 抚摸 / 揉 / 挠 / 戳 / 双手 / 搭手，还分轻重（轻轻 / 不轻不重 / 有点用力）
//   · 扳机当"捏"（L2/R2），捏的时候手柄跟着你的力气震
//   · 按键动作：△摸头 ○抱抱 ×戳 □捏脸
//   · 灯条：每个动作一种颜色，摸的时候亮，停一会儿变回暗蓝
//   · 工具 touch_back：她用手柄震回来（轻抚 / 摸头 / 点点 / 抱紧 / 心跳 / 挠挠）
//
// 安全纪律（写死）：
//   · 默认关闭（config 里 启用:false）；dryRun 只写日志不投递
//   · 不碰 .dsh\sessions\、不碰 workspace.json、不写她的档案
//   · 所有异常内部吃掉，绝不让 DSH 崩

import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 真正的入口是 index.js：它用带版本号的动态 import 把这一份载进来，
// 文件一改就换一个新实例（热重载），所以这里连 core/hid 也带版本号 import。
const 版本 = new URL(import.meta.url).searchParams.get('v') || '0'
const { pickGamepad, parseReport, buildOutputReport } = await import('./hid.mjs?v=' + encodeURIComponent(版本))
const { createTouchMachine, createSqueezeMachine, 估压力 } = await import('./core.mjs?v=' + encodeURIComponent(版本))

// 热重载：入口在 index.js，它负责工具、网页路由和"文件一变就换实例"。

const 插件目录 = fileURLToPath(new URL('./', import.meta.url))
const 配置文件 = process.env.TOUCH_CONFIG || join(插件目录, 'config.json')
const 家 = process.env.TOUCH_HOME || process.env.DSH_HOME || join(homedir(), '.dsh')
const 日志文件 = join(家, 'touch', 'touch.log')

const 默认配置 = {
  启用: false,
  dryRun: true,
  目标会话: '',
  震动反馈: true,
  灯条: true,
  扳机: true,
  按键动作: true,
  提示回摸: true,
  最小间隔毫秒: 6000,
  // 回震窗口：每给她发完一条触感，本地静音这么久，让她的震动落在手指上
  回震窗口毫秒: 10000,
  // 扳机阻力：按到 起点（0~255，越小越早开始）之后开始给阻力，力度 0~255
  扳机阻力: { 启用: true, 起点: 90, 力度: 130 },
}

const 闲灯 = [70, 110, 190]

function 位置词(x, y) {
  const 竖 = y / 1080 < 0.34 ? '上面' : y / 1080 < 0.66 ? '中间' : '下面'
  const 横 = x / 1920 < 0.34 ? '偏左' : x / 1920 < 0.66 ? '正中' : '偏右'
  return 竖 + '·' + 横
}

function 记(行) {
  try {
    mkdirSync(dirname(日志文件), { recursive: true })
    appendFileSync(日志文件, new Date().toISOString().slice(11, 19) + ' ' + 行 + '\n')
  } catch {}
}

function 读配置() {
  try {
    const 来 = JSON.parse(readFileSync(配置文件, 'utf8'))
    return { ...默认配置, ...(来 && typeof 来 === 'object' ? 来 : {}) }
  } catch (e) {
    return { ...默认配置, _错: String((e && e.message) || e) }
  }
}

const 灯色 = {
  pet: [255, 110, 170],
  stroke: [255, 110, 170],
  hold: [180, 130, 255],
  knead: [190, 110, 255],
  scratch: [255, 90, 60],
  tap: [255, 255, 255],
  dual: [110, 200, 255],
  squeeze: [255, 150, 40],
  button: [0, 210, 160],
}

const 按键表 = [
  { 位: 0x80, 文案: '他伸手摸了摸你的头。' },
  { 位: 0x40, 文案: '他把你抱住了。' },
  { 位: 0x20, 文案: '他轻轻戳了戳你。' },
  { 位: 0x10, 文案: '他捏了捏你的脸。' },
]

const 秒 = (ms) => (Math.max(0, ms) / 1000).toFixed(1)

/** 把事件翻成一句话（导出是为了离线测试） */
export function 描述事件(ev) {
  if (!ev) return ''
  const 连 = ev.count > 1 ? `（连着 ${ev.count} 下）` : ''
  const 曲线 = (ev.力气 && ev.力气.曲线) || []
  const 力气文 = 曲线.length ? '力气 ' + 曲线.join('→') + '，' : ''
  const 秒数 = 秒(ev.ms)
  switch (ev.kind) {
    case 'tap':
      return `（触感·戳）他戳了你一下。${连}`
    case 'hold':
      return `（触感·搭手）他把手放在你身上，没动，停了一会儿。${连}`
    case 'dual':
      return `（触感·双手）他两只手一起摸你：${力气文}${秒数} 秒。${连}`
    case 'knead':
      return `（触感·揉）他一圈一圈揉你：${力气文}${秒数} 秒。${连}`
    case 'scratch':
      return `（触感·挠）他挠了挠你：${力气文}${秒数} 秒。${连}`
    case 'stroke':
      return `（触感·摸）他慢慢摸你：${力气文}${ev.dir}，${秒数} 秒。${连}`
    case 'squeeze': {
      const 真压力 = Math.round(((ev.peak || 0) / 255) * 100)
      return `（触感·捏）他捏住你：真压力 ${真压力}/100（扳机 ${Math.round(ev.peak || 0)}/255），压了 ${秒数} 秒，松开了。${连}`
    }
    case 'button':
      return `（手柄）${ev.text}${连}`
    default:
      return `（触感·摸）他摸了摸你：${力气文}${ev.dir}，${秒数} 秒。${连}`
  }
}

function 造节奏(动作, 力度) {
  const 强 = Math.max(10, Math.min(120, Number(力度) || 60))
  const 例 = (等, small, large) => ({ 等, small: Math.round(small || 0), large: Math.round(large || 0) })
  switch (动作) {
    case '轻抚': {
      const 帧 = []
      for (let i = 0; i < 26; i++) {
        const 强i = 强 * (0.45 + 0.55 * Math.sin((i / 25) * Math.PI))
        帧.push(例(i === 0 ? 0 : 90, 强i, 0))
      }
      return 帧
    }
    case '摸头':
      return [例(0, 强 * 0.7, 0), 例(180, 0, 0), 例(120, 强 * 0.7, 0), 例(180, 0, 0), 例(120, 强 * 0.7, 0), 例(180, 0, 0)]
    case '点点':
      return [例(0, 强, 0), 例(90, 0, 0), 例(80, 强, 0), 例(90, 0, 0)]
    case '抱紧': {
      const 帧 = []
      for (let i = 0; i < 9; i++) 帧.push(例(i === 0 ? 0 : 60, 0, 强 * 1.4 * (i / 8)))
      帧.push(例(300, 0, 强 * 1.4))
      帧.push(例(400, 0, 0))
      return 帧
    }
    case '心跳':
      return [例(0, 0, 强 * 1.5), 例(140, 0, 0), 例(150, 0, 强 * 1.1), 例(120, 0, 0), 例(560, 0, 强 * 1.5), 例(140, 0, 0), 例(150, 0, 强 * 1.1), 例(120, 0, 0)]
    case '挠挠': {
      const 帧 = []
      for (let i = 0; i < 8; i++) { 帧.push(例(i === 0 ? 0 : 70, 强 * 0.9, 0)); 帧.push(例(70, 0, 0)) }
      return 帧
    }
    default:
      return [例(0, 强, 0), 例(160, 0, 0)]
  }
}

export function 创建(ctx) {
  let 设备 = null
  let 机器 = null
  let 捏机 = null
  let 配置 = 读配置()
  let 已关 = false
  let 上一帧按键 = [0, 0, 0, 0]
  let 震动 = { small: 0, large: 0 }
  let 灯 = 闲灯.slice()
  let 灯定时 = null
  let 节奏定时 = []
  let 已提示回摸 = false
  let 上次震动写 = 0
  let 最后帧 = 0
  let 上次重连 = 0
  // 此刻的手：给她"感觉一下"用的实时状态
  const 活 = { at: 0, active: false, x: 0, y: 0, lx: 0, ly: 0, 速度: 0, 力气: 0, 左扳机: 0, 右扳机: 0, 在捏: false }

  function 造扳机效果() {
    const 阻 = 配置.扳机阻力
    if (!阻 || !阻.启用) return null
    return {
      mode: String(阻.模式 || 'feedback'),
      start: Math.max(0, Math.min(255, Number(阻.起点 ?? 90))),
      force: Math.max(0, Math.min(255, Number(阻.力度 ?? 130))),
    }
  }
  let 扳机效果 = 造扳机效果()

  function 造机器() {
    const 节 = 配置.识别节奏 && typeof 配置.识别节奏 === 'object' ? 配置.识别节奏 : {}
    const 选项 = { minEmitGapMs: Number(配置.最小间隔毫秒) || 6000 }
    if (Number.isFinite(Number(节.停顿毫秒))) 选项.停顿毫秒 = Number(节.停顿毫秒)
    if (Number.isFinite(Number(节.最长段))) 选项.最长段 = Number(节.最长段)
    if (Number.isFinite(Number(节.单帧动))) 选项.单帧动 = Number(节.单帧动)
    if (Number.isFinite(Number(节.最小移动))) 选项.minMove = Number(节.最小移动)
    return createTouchMachine(选项)
  }
  function 节奏签名() {
    return JSON.stringify([配置.最小间隔毫秒, 配置.识别节奏 || null])
  }
  let 上次节奏签名 = 节奏签名()

  function 写输出() {
    if (!设备) return
    try {
      设备.write(
        Array.from(
          buildOutputReport({
            small: 震动.small,
            large: 震动.large,
            red: 灯[0],
            green: 灯[1],
            blue: 灯[2],
            leftTrigger: 扳机效果,
            rightTrigger: 扳机效果,
          }),
        ),
      )
    } catch {}
  }

  function 设灯(rgb, 保留毫秒 = 900) {
    if (!配置.灯条) return
    灯 = rgb.slice()
    写输出()
    if (灯定时) clearTimeout(灯定时)
    灯定时 = setTimeout(() => {
      灯 = 闲灯.slice()
      写输出()
      灯定时 = null
    }, 保留毫秒)
  }

  function 轻震(强度) {
    if (!配置.震动反馈) return
    // 她的震动优先：正在播她的节奏、或者刚给她发完消息留了窗口期 → 不震，别盖掉
    if (节奏中 || Date.now() < 回震窗口到) return
    震动 = { small: Math.max(0, Math.min(160, Math.round(强度))), large: 0 }
    写输出()
    setTimeout(() => {
      if (节奏中 || Date.now() < 回震窗口到) return
      震动 = { small: 0, large: 0 }
      写输出()
    }, 140)
  }

  function 清节奏() {
    for (const t of 节奏定时) clearTimeout(t)
    节奏定时 = []
  }
  let 节奏中 = false
  // 给她留的"回震窗口"：刚摸完那几秒里，本地不震，让她的震动落在你手指上
  let 回震窗口到 = 0

  function 播节奏(帧们) {
    清节奏()
    节奏中 = true
    let 累计 = 0
    for (const f of 帧们) {
      累计 += f.等 || 0
      const 该 = f
      节奏定时.push(
        setTimeout(() => {
          震动 = { small: 该.small || 0, large: 该.large || 0 }
          写输出()
        }, 累计),
      )
    }
    节奏定时.push(
      setTimeout(() => {
        震动 = { small: 0, large: 0 }
        写输出()
        节奏中 = false
      }, 累计 + 260),
    )
  }
  // ── 投递 ──────────────────────────────────────────────
  async function 投递(句) {
    记((配置.dryRun ? '[dry-run] ' : '[发] ') + 句)
    if (配置.dryRun) return
    const 目标 = String(配置.目标会话 || '').trim()
    if (!目标) { 记('没配目标会话，这条没投'); return }
    try {
      const 代理 = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
      const agent = 代理 && typeof 代理.get === 'function' ? 代理.get(目标) : null
      if (!agent || typeof agent.followup !== 'function') {
        记('她没醒着（会话没开？），这条没投：' + 句)
        return
      }
      let 文 = 句
      if (配置.提示回摸 && !已提示回摸) {
        文 += '（想摸回去可以用 touch_back 工具让手柄震回来；想知道他此刻压得多重，可以用 touch_sense。）'
        已提示回摸 = true
      }
      await agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: 文 }],
        source: { kind: 'plugin:touch' },
      })
      记('投出去了：' + 句)
      回震窗口到 = Date.now() + Math.max(2000, Number(配置.回震窗口毫秒) || 10000)
      记('留回震窗口 ' + Math.round((回震窗口到 - Date.now()) / 1000) + ' 秒（本地不震，等她的震动）')
    } catch (e) {
      记('投递失败：' + String((e && e.message) || e))
    }
  }

  function 处理事件(ev) {
    if (!ev) return
    try {
      if (ev.灯 === undefined) 设灯(灯色[ev.kind] || 闲灯)
      if (配置.震动反馈) {
        const 峰值 = (ev.力气 && ev.力气.峰值) || 0
        const 强度 = ev.kind === 'squeeze' ? Math.min(150, (ev.peak || 60) * 0.7) : Math.max(25, Math.min(140, 峰值 * 1.2))
        轻震(强度)
      }
      void 投递(描述事件(ev))
    } catch (e) {
      记('处理事件出错：' + String((e && e.message) || e))
    }
  }

  // ── 输入 ──────────────────────────────────────────────
  function 收到帧(buf) {
    try {
      const r = parseReport(buf)
      if (!r) return
      最后帧 = Date.now()
      处理报告(r, Date.now())
    } catch (e) {
      记('解析出错：' + String((e && e.message) || e))
    }
  }

  function 处理报告(r, now) {
    const t1 = r.touches[0]
    const t2 = r.touches[1]
    const 点 = t1.active ? t1 : t2
    const 双指 = t1.active && t2.active

    // 0) 记下此刻的手（给她 touch_sense 用）
    const dt = Math.max(1, now - (活.at || now))
    if (点.active && 活.active) {
      const 走 = Math.hypot(点.x - 活.x, 点.y - 活.y)
      活.速度 = Math.round((走 / dt) * 1000)
      活.力气 = 估压力(活.速度)
    } else if (!点.active) {
      活.速度 = 0
      活.力气 = 0
    }
    活.at = now
    活.active = 点.active
    活.x = 点.x
    活.y = 点.y
    活.左扳机 = r.l2
    活.右扳机 = r.r2
    活.在捏 = r.l2 > 40 || r.r2 > 40

    // 1) 触摸板
    if (机器) {
      const ev = 机器.feed({ active: 点.active, x: 点.x, y: 点.y, id: 点.id, dual: 双指 }, now)
      if (ev) 处理事件(ev)
      if (!点.active) {
        const e2 = 机器.flush(now)
        if (e2) 处理事件(e2)
      }
    }

    // 2) 扳机（捏）
    if (配置.扳机 && 捏机) {
      const ev2 = 捏机.feed({ left: r.l2, right: r.r2 }, now)
      if (ev2) 处理事件(ev2)
      // 捏着的时候，手柄跟着他的力气震（让他觉得"捏到了"）
      // —— 但她的节奏/回震窗口里不抢，让她的震动落在他手上
      const 窗内 = 节奏中 || Date.now() < 回震窗口到
      const 最大 = Math.max(r.l2, r.r2)
      if (!窗内 && 最大 > 40 && now - 上次震动写 > 90) {
        上次震动写 = now
        震动 = { small: Math.round(最大 * 0.45), large: 0 }
        写输出()
      } else if (!窗内 && 最大 <= 30 && (震动.small || 震动.large)) {
        震动 = { small: 0, large: 0 }
        写输出()
      }
    }

    // 3) 按键（上升沿）
    if (配置.按键动作) {
      const 现 = r.buttons[0]
      for (const 键 of 按键表) {
        if ((现 & 键.位) && !(上一帧按键[0] & 键.位)) 处理事件({ kind: 'button', text: 键.文案, ms: 0, count: 1 })
      }
      上一帧按键 = r.buttons.slice()
    }
  }

  /** 开机自检：拿假报文把整条链路走一遍（dry-run，不投递），确认帧处理不会炸 */
  function 自检() {
    if (!设备 || !机器) return
    const 原dry = 配置.dryRun
    配置.dryRun = true
    try {
      const 帧 = Buffer.alloc(64)
      帧[0] = 0x01
      帧[37] = 0x80 // 第二根手指一开始就是"没碰"（contact 最高位=1）
      const 填 = (x, y) => {
        帧[33] = 0
        帧[34] = x & 0xff
        帧[35] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4)
        帧[36] = (y >> 4) & 0xff
      }
      let t = Date.now()
      for (let i = 0; i < 60; i++) { 填(800 + i * 6, 500); 处理报告(parseReport(帧), (t += 4)) }
      for (let i = 0; i < 6; i++) { 帧[33] = 0x80; 处理报告(parseReport(帧), (t += 4)) }
      记('[自检] 帧处理通过')
    } catch (e) {
      记('[自检] 失败：' + String((e && e.message) || e))
    } finally {
      配置.dryRun = 原dry
      // 自检喂过的假数据，别让它影响真实输入
      机器 = 造机器()
      捏机 = createSqueezeMachine()
      上一帧按键 = [0, 0, 0, 0]
      震动 = { small: 0, large: 0 }
      写输出()
    }
  }

  // ── 开关 ──────────────────────────────────────────────
  function 开手柄(说 = true) {
    if (设备) return
    let HID
    try {
      HID = createRequire(import.meta.url)('node-hid')
    } catch (e) {
      记('node-hid 装不上，开不了手柄：' + String((e && e.message) || e))
      return
    }
    try {
      const pad = pickGamepad(HID.devices())
      if (!pad) {
        if (说) 记('没找到手柄（插上了吗？）')
        return
      }
      设备 = new HID.HID(pad.path)
      机器 = 造机器()
      捏机 = createSqueezeMachine()
      设备.on('data', 收到帧)
      设备.on('error', (e) => {
        记('HID 错误：' + String((e && e.message) || e))
        松手()
      })
      灯 = 闲灯.slice()
      震动 = { small: 0, large: 0 }
      扳机效果 = 造扳机效果()
      最后帧 = Date.now()
      写输出()
      记('手柄打开了：' + pad.product + (扳机效果 ? '（扳机阻力已开）' : ''))
      自检()
    } catch (e) {
      记('打开手柄失败：' + String((e && e.message) || e))
      松手()
    }
  }

  function 松手() {
    try {
      if (设备) {
        // 先把扳机阻力清掉，不然插件关掉/拔线后阻力还留在手柄上
        震动 = { small: 0, large: 0 }
        扳机效果 = { mode: 'off' }
        写输出()
      }
    } catch {}
    try { if (设备) 设备.close() } catch {}
    设备 = null
    机器 = null
    捏机 = null
    清节奏()
    震动 = { small: 0, large: 0 }
    扳机效果 = null
    最后帧 = 0
  }

  function 巡检() {
    try {
      if (已关) return
      配置 = 读配置()

      // 识别节奏参数变了 → 重建状态机（改配置不用重启）
      const 新签名 = 节奏签名()
      if (新签名 !== 上次节奏签名) {
        上次节奏签名 = 新签名
        if (设备) {
          机器 = 造机器()
          记('识别节奏改了：' + 新签名)
        }
      }

      // 扳机阻力参数变了 → 重新写一次（改配置不用重启）
      const 新扳机 = 造扳机效果()
      if (JSON.stringify(新扳机) !== JSON.stringify(扳机效果)) {
        扳机效果 = 新扳机
        if (设备) 写输出()
      }

      // 热插拔：手柄一直 250 帧/秒，4 秒没帧 = 它被拔了/断了
      if (设备 && 最后帧 && Date.now() - 最后帧 > 4000) {
        记('手柄 4 秒没帧，当它断了，等它接回来')
        松手()
      }

      if (配置.启用) {
        if (!设备 && Date.now() - 上次重连 > 3000) {
          上次重连 = Date.now()
          开手柄(false)
          if (设备) 记('手柄接上了')
        }
      } else if (设备) {
        松手()
        记('配置关掉了，手柄松开')
      }
    } catch (e) {
      记('巡检出错：' + String((e && e.message) || e))
    }
  }

  // ── 对外接口：给入口（工具、网页设置面板）调用 ──────────
  function 震回来(args) {
    const 动作 = String((args && args.动作) || '轻抚')
    const 力度 = Number((args && args.力度) || 60)
    if (!设备) {
      记('touch_back：手柄没开着')
      return { ok: false, text: '手柄现在没开着（插件没启用，或者手柄没插）。等主人插好再说。' }
    }
    播节奏(造节奏(动作, 力度))
    设灯([255, 150, 200], 1500)
    记('touch_back：' + 动作 + '（力度 ' + 力度 + '）')
    return { ok: true, text: '手柄已经震了：' + 动作 + '（力度 ' + Math.round(Math.max(10, Math.min(120, 力度))) + '）。他现在手上有感觉。' }
  }

  function 感觉一下() {
    if (!设备) return { ok: false, text: '手柄现在没开着（插件没启用，或者手柄没插）。' }
    const 静 = Date.now() - (活.at || 0)
    const 线 = []
    if (活.active && 静 < 400) {
      线.push('他的手指正按在触摸板' + 位置词(活.x, 活.y) + '，移动速度 ' + 活.速度)
      线.push('估计力气 ' + 活.力气 + '/100')
    } else {
      线.push('他的手指不在触摸板上（最近一次动作在 ' + Math.max(1, Math.round(静 / 1000)) + ' 秒前）')
    }
    if (活.在捏) 线.push('他正捏着扳机：左 ' + 活.左扳机 + '/255，右 ' + 活.右扳机 + '/255（这是真压力）')
    return { ok: true, text: '（此刻）' + 线.join('；') + '。' }
  }

  function 当前配置() {
    return JSON.parse(JSON.stringify(配置))
  }

  function 存配置(补丁) {
    try {
      const 新 = { ...当前配置(), ...(补丁 && typeof 补丁 === 'object' ? 补丁 : {}) }
      writeFileSync(配置文件, JSON.stringify(新, null, 2) + String.fromCharCode(10), 'utf8')
      配置 = 读配置()
      记('配置已存：' + JSON.stringify(补丁))
      return { ok: true, 配置: 当前配置() }
    } catch (e) {
      return { ok: false, 原因: String((e && e.message) || e) }
    }
  }

  function 状态() {
    return {
      版本,
      手柄: !!设备,
      最后帧距今: 最后帧 ? Date.now() - 最后帧 : null,
      回震窗口剩余: Math.max(0, Math.round((回震窗口到 - Date.now()) / 1000)),
      此刻: { 在触: 活.active, x: 活.x, y: 活.y, 力气: 活.力气, 在捏: 活.在捏, 左扳机: 活.左扳机, 右扳机: 活.右扳机 },
      配置: 当前配置(),
    }
  }

  const 巡检定时 = setInterval(巡检, 3 * 1000)
  巡检()
  记('摸摸插件实现加载 v5（启用=' + !!配置.启用 + '，dryRun=' + !!配置.dryRun + '）')

  return {
    释放() {
      已关 = true
      clearInterval(巡检定时)
      if (灯定时) clearTimeout(灯定时)
      清节奏()
      松手()
      记('摸摸插件实现卸载，手柄松开')
    },
    震回来,
    感觉一下,
    状态,
    当前配置,
    存配置,
  }
}
