// DSH 摸摸插件 · 网页半边
//
// 侧栏一个「摸摸」图标，点开是一块设置面板。
// 布局按「卡片 → 标题 + 说明 + 控件」排，颜色尽量跟着 DSH 主题走（不写死深色），
// 所以浅色皮肤、深色皮肤都看得清。
//
// 数据全部走宿主路由 /dsh-touch/*；改完立刻 POST 保存，3 秒内生效。

window.__ModuleLoader__.load({
  id: 'dsh-touch',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const 取 = async (路) => {
      const r = await fetch('/dsh-touch/' + 路, { cache: 'no-store' })
      return await r.json()
    }
    const 存 = async (补丁) => {
      const r = await fetch('/dsh-touch/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(补丁),
      })
      return await r.json()
    }

    const 灰 = (a) => 'rgba(127,127,127,' + a + ')'
    const 卡片式 = {
      background: 灰(0.07),
      border: '1px solid ' + 灰(0.16),
      borderRadius: 12,
      padding: '10px 12px',
      marginTop: 10,
    }
    const 卡片题 = { fontSize: 11.5, opacity: 0.62, letterSpacing: 0.6, marginBottom: 2 }
    const 行式 = {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '7px 0',
      borderTop: '1px solid ' + 灰(0.1),
    }
    const 行题 = { fontSize: 12.5, lineHeight: 1.5 }
    const 行注 = { fontSize: 10.5, opacity: 0.45, lineHeight: 1.45, marginTop: 1 }
    const 输入式 = {
      width: 84,
      fontSize: 12.5,
      padding: '5px 8px',
      borderRadius: 8,
      border: '1px solid ' + 灰(0.3),
      background: 灰(0.1),
      color: 'inherit',
      outline: 'none',
    }
    const 单位式 = { fontSize: 11, opacity: 0.5, width: 36, flex: 'none' }
    const 徽章 = (亮) => ({
      fontSize: 10.5,
      padding: '2px 8px',
      borderRadius: 999,
      border: '1px solid ' + 灰(0.22),
      background: 亮 ? 'rgba(86,170,255,0.22)' : 灰(0.1),
      opacity: 亮 ? 1 : 0.65,
    })

    function 图标(props) {
      const 尺 = props && props.size ? props.size : 18
      const 亮 = props && props.active
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 尺, height: 尺, 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M4.6 14.6c.7-3.9 1.5-6.3 2.6-7.3 1.3-1.2 2.5.3 3.2 2.5.4 1.2 1 1.3 1.7.6.9-.9 1.8-.6 2.3.6.4 1 .9 1.9 1.6 2.7 1 1 2.1 1.5 3.4 1.7',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 亮 ? 1 : 0.55,
        }),
        h('circle', { cx: 18.4, cy: 13.4, r: 1.5, fill: 'currentColor', opacity: 亮 ? 1 : 0.55 }),
        h('circle', { cx: 6.2, cy: 18.1, r: 1.15, fill: 'currentColor', opacity: 亮 ? 0.9 : 0.4 }),
      )
    }

    function 面板() {
      const [配置, 设配置] = useState(null)
      const [状态, 设状态] = useState(null)
      const [提示, 设提示] = useState('')
      const [日志, 设日志] = useState('')

      const 拉 = useCallback(async () => {
        try {
          const s = await 取('status')
          设状态(s)
          if (s && s.配置) 设配置(s.配置)
        } catch (e) {
          设提示('连不上宿主：' + ((e && e.message) || e))
        }
      }, [])

      useEffect(() => {
        拉()
        const t = setInterval(拉, 3000)
        return () => clearInterval(t)
      }, [拉])

      const 改 = async (补丁, 说明) => {
        try {
          const r = await 存(补丁)
          if (r && r.ok) {
            设配置(r.配置)
            设提示('已保存' + (说明 ? '：' + 说明 : ''))
          } else {
            设提示('保存失败：' + ((r && r.原因) || '?'))
          }
        } catch (e) {
          设提示('保存失败：' + ((e && e.message) || e))
        }
      }
      const 改嵌套 = async (键, 子补丁) => {
        const 旧 = 配置 && 配置[键] && typeof 配置[键] === 'object' ? 配置[键] : {}
        await 改({ [键]: { ...旧, ...子补丁 } }, 键)
      }

      if (!状态) {
        return h('div', { style: { padding: 20, fontSize: 12.5, opacity: 0.6 } }, '摸摸 · 正在连宿主…')
      }

      const c = 配置 || {}
      const 节 = c.识别节奏 && typeof c.识别节奏 === 'object' ? c.识别节奏 : {}
      const 阻 = c.扳机阻力 && typeof c.扳机阻力 === 'object' ? c.扳机阻力 : {}

      const 行 = (标题, 说明, 控件, 首行) =>
        h(
          'div',
          { style: 首行 ? { ...行式, borderTop: 'none' } : 行式 },
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: 行题 }, 标题), 说明 ? h('div', { style: 行注 }, 说明) : null),
          控件,
        )
      const 卡 = (题, 行们) => h('div', { style: 卡片式 }, h('div', { style: 卡片题 }, 题), 行们)

      const 开关 = (值, 改它) =>
        h(
          'button',
          {
            style: {
              minWidth: 56,
              fontSize: 12,
              padding: '5px 0',
              borderRadius: 8,
              border: '1px solid ' + 灰(0.3),
              background: 值 ? 'rgba(86,160,255,0.32)' : 灰(0.1),
              color: 'inherit',
              cursor: 'pointer',
            },
            onClick: 改它,
          },
          值 ? '开' : '关',
        )
      const 数 = (值, 改它, 单位, 步) =>
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' } },
          h('input', {
            type: 'number',
            step: 步 || 1,
            value: 值 === undefined || 值 === null ? 0 : 值,
            style: 输入式,
            onChange: (e) => 改它(Number(e.target.value)),
          }),
          单位 ? h('span', { style: 单位式 }, 单位) : null,
        )

      const 手 = 状态.此刻 || {}
      const 手文 = 手.在触 ? '手指在触摸板上（' + 手.力气 + '/100 的力气）' : '手指不在触摸板上'
      const 帧文 = 状态.最后帧距今 == null ? '—' : 状态.最后帧距今 + ' 毫秒前'
      const 窗文 = 状态.回震窗口剩余 ? '还剩 ' + 状态.回震窗口剩余 + ' 秒（本地静音中）' : '没有（本地正常震）'

      return h(
        'div',
        { style: { padding: '14px 16px', height: '100%', overflow: 'auto', fontSize: 13 } },

        // ── 标题 ─────────────────────────────────────────
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('div', { style: { fontSize: 16, fontWeight: 600, letterSpacing: 1 } }, '摸摸'),
          h('div', { style: 徽章(状态.手柄) }, 状态.手柄 ? '手柄已连接' : '手柄未连接'),
          状态.就绪 ? null : h('div', { style: 徽章(false) }, '宿主启动中'),
          h('div', { style: { flex: 1 } }),
          h(
            'button',
            {
              style: { fontSize: 12, padding: '4px 12px', borderRadius: 8, border: '1px solid ' + 灰(0.3), background: 灰(0.08), color: 'inherit', cursor: 'pointer' },
              onClick: 拉,
            },
            '刷新',
          ),
        ),
        提示
          ? h('div', { style: { marginTop: 6, fontSize: 11.5, color: 'rgba(60,160,110,0.95)' } }, 提示)
          : null,

        // ── 状态 ─────────────────────────────────────────
        卡('现在', [
          行('手柄', '和电脑的 HID 连没连上', h('span', { style: { fontSize: 12, opacity: 0.75 } }, 状态.手柄 ? '已连接' : '没连上'), true),
          行('最后一条帧', '手柄每秒报 250 条；超过 4 秒没帧会自动重连', h('span', { style: { fontSize: 12, opacity: 0.75 } }, 帧文)),
          行('回震窗口', '刚给她发过触感时，本地静音，让她的震动落在你手上', h('span', { style: { fontSize: 12, opacity: 0.75 } }, 窗文)),
          行('此刻', '实时读的，不用猜', h('span', { style: { fontSize: 12, opacity: 0.75 } }, 手文)),
        ]),

        // ── 总开关 ───────────────────────────────────────
        卡('总开关', [
          行('插件启用', '关掉 = 手柄完全不管，也不会给她发', 开关(!!c.启用, () => 改({ 启用: !c.启用 })), true),
          行('dryRun', '打开 = 只写日志、不投递（调数值时建议先开着）', 开关(!!c.dryRun, () => 改({ dryRun: !c.dryRun }))),
        ]),

        // ── 识别节奏 ─────────────────────────────────────
        卡('识别节奏（多久算一次"摸"）', [
          行('两条消息最小间隔', '再频繁也不会比这个快', 数(c.最小间隔毫秒, (v) => 改({ 最小间隔毫秒: v }), '毫秒', 500), true),
          行('手停多久算一段', '手指停住超过这个时间，就把刚才那段动作结掉、发一条', 数(节.停顿毫秒, (v) => 改嵌套('识别节奏', { 停顿毫秒: v }), '毫秒', 100)),
          行('一直在动，最长一段', '连续不停地摸，每这么久最多切成一段发出去', 数(节.最长段, (v) => 改嵌套('识别节奏', { 最长段: v }), '毫秒', 500)),
          行('一帧动多少算"在动"', '滤掉手指抖动的阈值；越大越不容易被抖到', 数(节.单帧动, (v) => 改嵌套('识别节奏', { 单帧动: v }), '单位', 0.5)),
        ]),

        // ── 回震窗口 ─────────────────────────────────────
        卡('回震窗口（留给她摸回来）', [
          行('发完后本地静音', '每发一条触感，本地震动暂停这么久，等她的 touch_back 震你', 数(c.回震窗口毫秒, (v) => 改({ 回震窗口毫秒: v }), '毫秒', 1000), true),
        ]),

        // ── 扳机阻力 ─────────────────────────────────────
        卡('扳机阻力（防一手按到底）', [
          行('启用', '按扳机时给物理阻力，越按越费劲', 开关(!!阻.启用, () => 改嵌套('扳机阻力', { 启用: !阻.启用 })), true),
          行('从多深处开始顶手', '0=刚按就顶，255=按到底才顶（默认 90 ≈ 35%）', 数(阻.起点, (v) => 改嵌套('扳机阻力', { 起点: v }), '0~255', 5)),
          行('阻力多大', '0=没有，255=很硬（默认 130）', 数(阻.力度, (v) => 改嵌套('扳机阻力', { 力度: v }), '0~255', 5)),
        ]),

        // ── 手感 ─────────────────────────────────────────
        卡('手感', [
          行('震动反馈', '你摸的时候手柄轻震一下（回震窗口内不震）', 开关(!!c.震动反馈, () => 改({ 震动反馈: !c.震动反馈 })), true),
          行('灯条', '每个动作一种颜色', 开关(!!c.灯条, () => 改({ 灯条: !c.灯条 }))),
          行('扳机识别"捏"', 'L2/R2 按下去 = 捏她，给她真压力', 开关(!!c.扳机, () => 改({ 扳机: !c.扳机 }))),
          行('按键动作', '△摸头 ○抱抱 ×戳 □捏脸', 开关(!!c.按键动作, () => 改({ 按键动作: !c.按键动作 }))),
          行('提示回摸', '第一次收到触感时，末尾告诉她可以用 touch_back', 开关(!!c.提示回摸, () => 改({ 提示回摸: !c.提示回摸 }))),
        ]),

        // ── 目标会话 ─────────────────────────────────────
        卡('目标会话（把这些触感投给谁）', [
          行(
            '会话 id',
            '你的 AI 伴侣的会话 id。改完失焦自动保存。',
            h('input', {
              style: { ...输入式, width: 300, maxWidth: '46vw' },
              defaultValue: c.目标会话 || '',
              onBlur: (e) => 改({ 目标会话: e.target.value.trim() }),
            }),
            true,
          ),
        ]),

        // ── 工具 ─────────────────────────────────────────
        h(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' } },
          h(
            'button',
            {
              style: { fontSize: 12, padding: '5px 12px', borderRadius: 8, border: '1px solid ' + 灰(0.3), background: 灰(0.08), color: 'inherit', cursor: 'pointer' },
              onClick: async () => {
                try {
                  const r = await 取('log?lines=60')
                  设日志((r && r.日志) || '')
                } catch (e) {
                  设日志('读日志失败：' + ((e && e.message) || e))
                }
              },
            },
            '看日志',
          ),
          h(
            'button',
            {
              style: { fontSize: 12, padding: '5px 12px', borderRadius: 8, border: '1px solid ' + 灰(0.3), background: 灰(0.08), color: 'inherit', cursor: 'pointer' },
              onClick: async () => {
                try {
                  await fetch('/dsh-touch/reload', { method: 'POST' })
                  设提示('已请求热重载（逻辑层 2 秒内换新）')
                  拉()
                } catch (e) {
                  设提示('重载失败：' + ((e && e.message) || e))
                }
              },
            },
            '重载逻辑',
          ),
          状态.重载次数 ? h('span', { style: { fontSize: 10.5, opacity: 0.5 } }, '已重载 ' + 状态.重载次数 + ' 次') : null,
        ),

        日志
          ? h(
              'pre',
              {
                style: {
                  marginTop: 10,
                  fontSize: 10.5,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  opacity: 0.7,
                  maxHeight: 260,
                  overflow: 'auto',
                  background: 灰(0.1),
                  borderRadius: 10,
                  padding: 10,
                },
              },
              日志,
            )
          : null,

        h('div', { style: { marginTop: 12, fontSize: 10.5, opacity: 0.4, lineHeight: 1.6 } }, '改完自动保存，3 秒内生效。逻辑层（impl/core/hid）改代码会自动热重载；这个面板本身换样式才需要重启。'),
      )
    }

    class 兜错 extends React.Component {
      constructor(p) {
        super(p)
        this.state = { 错: null }
      }
      static getDerivedStateFromError(e) {
        return { 错: e }
      }
      componentDidCatch(e) {
        try {
          console.error('[摸摸]', e)
        } catch {}
      }
      render() {
        if (this.state.错) {
          return h(
            'div',
            { style: { padding: 16, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#c0392b' } },
            '摸摸面板出错：' + String((this.state.错 && this.state.错.message) || this.state.错),
          )
        }
        return this.props.children
      }
    }

    function 面板兜(props) {
      return h(兜错, null, h(面板, props))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'touch', order: 21, label: () => '摸摸' }, 图标),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'touch' }, 面板兜))
      },
    }
  },
})
