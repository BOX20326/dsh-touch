// DSH 摸摸插件 · 手柄那半边：DualSense（PS5 手柄）HID 解析
//
// 纯函数：不碰设备、不写文件、不碰 DSH。可以单独在 node 里测。
//
// 依据：Linux 内核 drivers/hid/hid-playstation.c
//   struct dualsense_input_report（不含报告 ID，共 63 字节）
//   USB 输入报告 0x01 共 64 字节：buf[0] = 0x01，buf[1] 起才是结构体
//   触摸点：[33..36]、[37..40]；contact 最高位 = 1 表示"没碰"（无效）
//   X = (byte2 & 0x0F) << 8 | byte1；Y = byte3 << 4 | (byte2 >> 4)
//   范围：X 0..1919，Y 0..1079

export const DS_VENDOR = 0x054c
export const DS_PRODUCT = 0x0ce6
export const DS_PRODUCT_EDGE = 0x0df2
export const INPUT_REPORT_SIZE = 64
export const TOUCHPAD_WIDTH = 1920
export const TOUCHPAD_HEIGHT = 1080

/** 是不是索尼 DualSense（含 Edge） */
export function isDualSense(dev) {
  return !!dev && dev.vendorId === DS_VENDOR &&
    (dev.productId === DS_PRODUCT || dev.productId === DS_PRODUCT_EDGE)
}

/** 从 node-hid 的 devices() 列表里挑出"手柄本体"那个接口（usagePage 1 / usage 5） */
export function pickGamepad(devices) {
  if (!Array.isArray(devices)) return null
  return devices.find((d) => isDualSense(d) && d.usagePage === 1 && d.usage === 5) || null
}

/** 解析一个触摸点；i 是那 4 个字节在缓冲里的起点 */
export function parseTouchPoint(buf, i) {
  const contact = buf[i]
  const xLo = buf[i + 1]
  const mix = buf[i + 2]
  const yHi = buf[i + 3]
  return {
    active: (contact & 0x80) === 0, // 最高位 1 = 没碰
    id: contact & 0x7f,             // 触点编号（跟手用）
    x: ((mix & 0x0f) << 8) | xLo,   // 0..1919
    y: (yHi << 4) | (mix >> 4),     // 0..1079
  }
}

/** 解析一份输入报告；不是双感主报告就返回 null */
export function parseReport(buf) {
  if (!buf || buf.length < 41 || buf[0] !== 0x01) return null
  return {
    lx: buf[1], ly: buf[2], rx: buf[3], ry: buf[4],
    l2: buf[5], r2: buf[6],
    sequence: buf[7],
    buttons: [buf[8], buf[9], buf[10], buf[11]],
    touchpadClick: (buf[10] & 0x02) !== 0,
    touches: [parseTouchPoint(buf, 33), parseTouchPoint(buf, 37)],
  }
}

function clampByte(v) {
  const n = Math.round(Number(v) || 0)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

/**
 * 把一段扳机效果写进输出报告。
 * 位置依据微软 GameInput 的 DualSense 示例（DualSenseHelper.h）：
 *   flag0 的 bit2 = 右扳机、bit3 = 左扳机；效果块在 11（右）/ 22（左），每块 11 字节
 *   mode 0x01 = 反馈阻力（start 位置 0~255，force 力度 0~255）
 *   mode 0x02 = 武器阻力（start~end 区间给 strength 阻力，过了就松开）
 *   mode 0x06 = 扳机震动（frequency / resistance / start）
 */
function 写扳机效果(out, 位置, 效果) {
  if (!效果) return
  const mode = String(效果.mode || 'feedback')
  if (mode === 'off') {
    out[位置] = 0x00
    return
  }
  if (mode === 'weapon') {
    out[位置] = 0x02
    out[位置 + 1] = clampByte(效果.start)
    out[位置 + 2] = clampByte(效果.end)
    out[位置 + 3] = clampByte(效果.strength)
    return
  }
  if (mode === 'vibration') {
    out[位置] = 0x06
    out[位置 + 1] = clampByte(效果.frequency)
    out[位置 + 2] = clampByte(效果.resistance)
    out[位置 + 3] = clampByte(效果.start)
    return
  }
  out[位置] = 0x01
  out[位置 + 1] = clampByte(效果.start)
  out[位置 + 2] = clampByte(效果.force)
}

/**
 * 造 USB 输出报告（63 字节，报告 ID 0x02）：
 *   小震 / 大震（0..255）、可选灯条颜色、可选左/右扳机效果
 */
export function buildOutputReport({
  small = 0,
  large = 0,
  red = null,
  green = 0,
  blue = 0,
  leftTrigger = null,
  rightTrigger = null,
} = {}) {
  const out = new Uint8Array(63)
  out[0] = 0x02
  // valid_flag0：compatible vibration(bit0) + haptics select(bit1)
  out[1] = 0x03
  out[3] = clampByte(small) // motor_right
  out[4] = clampByte(large) // motor_left
  if (red !== null) {
    out[2] |= 0x04  // valid_flag1：lightbar control enable
    out[39] |= 0x02 // valid_flag2：lightbar setup control enable
    out[42] = 0x02  // lightbar_setup：LIGHT_OUT
    out[45] = clampByte(red)
    out[46] = clampByte(green)
    out[47] = clampByte(blue)
  }
  if (rightTrigger) {
    out[1] |= 0x04 // valid_flag0：右扳机效果
    写扳机效果(out, 11, rightTrigger)
  }
  if (leftTrigger) {
    out[1] |= 0x08 // valid_flag0：左扳机效果
    写扳机效果(out, 22, leftTrigger)
  }
  return out
}
