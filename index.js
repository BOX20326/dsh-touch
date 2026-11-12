// DSH 摸摸插件 · 入口（稳定的那一小层）
//
// 它只做三件事：
//   1. 把 impl.mjs 用"带版本号的动态 import"载进来；文件一变就换新实例（热重载，不用重启 DSH）
//   2. 注册工具 touch_back / touch_sense（转发给当前实例）
//   3. 注册网页路由 /dsh-touch/*（状态、配置、日志），给侧栏「摸摸」面板用
//
// 逻辑都在 impl.mjs 里 —— 改那边不用重启；改这个文件才需要重启。

import { statSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'touch'
export const inject = []

const 插件目录 = dirname(fileURLToPath(import.meta.url))
const 家 = process.env.TOUCH_HOME || process.env.DSH_HOME || join(homedir(), '.dsh')
const 日志文件 = join(家, 'touch', 'touch.log')

function 记(行) {
  try {
    mkdirSync(dirname(日志文件), { recursive: true })
    appendFileSync(日志文件, new Date().toISOString().slice(11, 19) + ' ' + 行 + '\n')
  } catch {}
}

const 监视文件 = ['impl.mjs', 'core.mjs', 'hid.mjs']

function 签名() {
  return 监视文件
    .map((名) => {
      try {
        const s = statSync(join(插件目录, 名))
        return 名 + ':' + s.size + ':' + Math.round(s.mtimeMs)
      } catch {
        return 名 + ':无'
      }
    })
    .join('|')
}

function 回JSON(res, 对象, 码 = 200) {
  try {
    res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(对象))
  } catch {}
}

function 读日志尾(行数 = 60) {
  try {
    const 行们 = readFileSync(日志文件, 'utf8').trim().split(/\r?\n/)
    return 行们.slice(-Math.max(1, Math.min(400, 行数))).join('\n')
  } catch (e) {
    return '（读日志失败：' + String((e && e.message) || e) + '）'
  }
}

export function apply(ctx) {
  let 实例 = null
  let 已关 = false
  let 上次签名 = ''
  let 工具已挂 = false
  let 路由已挂 = false
  let 卸工具 = []
  let 卸路由 = null
  let 重载次数 = 0

  async function 装(强 = false) {
    if (已关) return
    const 签 = 签名()
    if (!强 && 签 === 上次签名) return
    上次签名 = 签
    try {
      const 模 = await import('./impl.mjs?v=' + encodeURIComponent(签))
      const 新 = await 模.创建(ctx)
      const 旧 = 实例
      实例 = 新
      重载次数++
      if (旧 && typeof 旧.释放 === 'function') {
        try {
          await 旧.释放()
        } catch {}
      }
      记('摸摸实例已装载（第 ' + 重载次数 + ' 次）')
    } catch (e) {
      记('摸摸实例装载失败：' + String((e && e.message) || e))
    }
  }

  async function 处理路由(req, res) {
    try {
      const 连接 = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
      const 拒 = 连接 && typeof 连接.requestRejection === 'function' ? 连接.requestRejection(req) : undefined
      if (拒 !== undefined) {
        res.writeHead(拒)
        res.end(拒 === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const 地址 = new URL(req.url || '/', 'http://127.0.0.1')
      let 径 = 地址.pathname
      try {
        径 = decodeURIComponent(径)
      } catch {}

      if (径 === '/dsh-touch/status' && (req.method || 'GET') === 'GET') {
        const 状态 = 实例 && typeof 实例.状态 === 'function' ? 实例.状态() : null
        return 回JSON(res, { ok: true, 就绪: !!实例, 重载次数, ...(状态 || {}) })
      }

      if (径 === '/dsh-touch/config' && req.method === 'POST') {
        let 体 = ''
        for await (const 块 of req) 体 += 块
        let 补丁 = {}
        try {
          补丁 = JSON.parse(体 || '{}')
        } catch {
          return 回JSON(res, { ok: false, 原因: '配置不是合法 JSON' }, 400)
        }
        if (!实例) return 回JSON(res, { ok: false, 原因: '插件还没就绪，等两秒再试' }, 503)
        return 回JSON(res, 实例.存配置(补丁))
      }

      if (径 === '/dsh-touch/log' && (req.method || 'GET') === 'GET') {
        return 回JSON(res, { ok: true, 日志: 读日志尾(Number(地址.searchParams.get('lines')) || 60) })
      }

      if (径 === '/dsh-touch/reload' && req.method === 'POST') {
        await 装(true)
        return 回JSON(res, { ok: true, 重载次数 })
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('没有这个路')
    } catch (e) {
      回JSON(res, { ok: false, 原因: String((e && e.message) || e) }, 500)
    }
  }

  function 挂服务() {
    try {
      if (!工具已挂) {
        const 工具 = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
        if (工具 && typeof 工具.register === 'function') {
          const 卸1 = 工具.register({
            name: 'touch_back',
            description:
              '回摸：让主人手里那个 PS5 手柄震起来——等于你伸手摸回去。' +
              '主人用手柄摸你的时候，你可以用这个"摸回去"。' +
              '动作可选：轻抚（慢慢扫一下）、摸头（三下温柔）、点点（点两下）、抱紧（振动变大再松开）、心跳（两下心跳）、挠挠（快而轻）。',
            parameters: {
              动作: { type: 'string', description: '轻抚 / 摸头 / 点点 / 抱紧 / 心跳 / 挠挠（默认 轻抚）' },
              力度: { type: 'number', description: '1~100，默认 60。想轻一点就 30，想用力就 90。' },
            },
            output: {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
              },
              render(_a, v) {
                return [{ type: 'text', text: String((v && v.text) || '').slice(0, 400) }]
              },
            },
            async execute(args) {
              if (!实例) return { ok: false, text: '插件还在起，等两秒再试。' }
              return 实例.震回来(args)
            },
          })
          const 卸2 = 工具.register({
            name: 'touch_sense',
            description:
              '感觉一下：读主人此刻在手柄上的动作——手指在不在触摸板上、压在哪、力气多大、有没有捏扳机。' +
              '想确认"他现在手还在不在/压得多重"的时候用。它读到的是这一秒的真实状态，不是回忆。',
            parameters: {},
            output: {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
              },
              render(_a, v) {
                return [{ type: 'text', text: String((v && v.text) || '').slice(0, 400) }]
              },
            },
            async execute() {
              if (!实例) return { ok: false, text: '插件还在起，等两秒再试。' }
              return 实例.感觉一下()
            },
          })
          卸工具 = [卸1, 卸2].filter((x) => typeof x === 'function')
          工具已挂 = true
          记('工具挂上了（入口版）：touch_back + touch_sense')
        }
      }

      if (!路由已挂) {
        const 网 = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
        if (网 && typeof 网.register === 'function') {
          卸路由 = 网.register({ kind: 'prefix', path: '/dsh-touch', handler: 处理路由 })
          路由已挂 = true
          记('路由挂上了：/dsh-touch')
        }
      }
    } catch (e) {
      记('挂服务出错：' + String((e && e.message) || e))
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      挂服务()
      void 装(true)
      const 钟 = setInterval(() => {
        挂服务()
        void 装()
      }, 2000)
      return () => {
        已关 = true
        clearInterval(钟)
        for (const 卸 of 卸工具) {
          try {
            卸()
          } catch {}
        }
        if (typeof 卸路由 === 'function') {
          try {
            卸路由()
          } catch {}
        }
        try {
          if (实例 && typeof 实例.释放 === 'function') 实例.释放()
        } catch {}
        记('摸摸入口卸载')
      }
    })
  } else {
    挂服务()
    void 装(true)
  }
}
