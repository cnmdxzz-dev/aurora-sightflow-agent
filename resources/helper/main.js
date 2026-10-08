/**
 * Helper 进程 — 高危操作隔离执行器（Windows + macOS 共用）
 *
 * 以 ELECTRON_RUN_AS_NODE=1 模式运行，纯 Node.js 进程。
 * 通过本地 HTTP 接收主进程指令，调用 robotjs 执行系统级输入操作。
 *
 * 启动方式：
 * - Windows: cmd.exe /c start "" /B <helper.exe> <this-script> --port=PORT --token=TOKEN --ppid=PPID
 * - macOS:   spawn detached <Electron> <this-script> --port=PORT --token=TOKEN --ppid=PPID
 */

'use strict'

const http = require('http')
const path = require('path')

// ── 解析命令行参数 ──────────────────────────────────────────────
const args = {}
process.argv.slice(2).forEach((arg) => {
  const m = arg.match(/^--([\w][\w-]*)=(.*)$/)
  if (m) args[m[1]] = m[2]
})

const PORT = parseInt(args.port, 10)
const TOKEN = args.token || ''
const PPID = parseInt(args.ppid, 10)
const HELPER_DIR = args['helper-dir'] || ''

if (!PORT || !TOKEN) {
  process.stderr.write('[Helper] Missing --port or --token\n')
  process.exit(1)
}

// ── 加载 robotjs ────────────────────────────────────────────────
let rawRobot
try {
  // 方式 1：标准 require（dev 模式下有效）
  const candidates = [
    '@hurdlegroup/robotjs', // 本项目使用的 fork
    'robotjs' // 原版
  ]

  if (HELPER_DIR) {
    for (const pkg of candidates) {
      try {
        rawRobot = require(path.join(HELPER_DIR, 'node_modules', pkg))
        process.stdout.write(`[Helper] Loaded ${pkg} from ${HELPER_DIR}\n`)
        break
      } catch {
        /* try next */
      }
    }
  }
  if (!rawRobot) {
    for (const pkg of candidates) {
      try {
        rawRobot = require(pkg)
        process.stdout.write(`[Helper] Loaded ${pkg} (global)\n`)
        break
      } catch {
        /* try next */
      }
    }
  }

  // 方式 2：直接加载 .node 文件（打包后 node-gyp-build 在 asar 内无法加载）
  if (!rawRobot && HELPER_DIR) {
    const os = require('os')
    const platform = process.platform
    const arch = os.arch()
    // prebuild 目录命名格式：darwin-x64+arm64, win32-x64
    const prebuildDirs = [
      `${platform}-${arch}`,
      `${platform}-x64+arm64` // universal binary
    ]
    const pkgName = '@hurdlegroup/robotjs'
    for (const dir of prebuildDirs) {
      const nodePath = path.join(
        HELPER_DIR,
        'node_modules',
        pkgName,
        'prebuilds',
        dir,
        '@hurdlegroup+robotjs.node'
      )
      try {
        const fs = require('fs')
        if (fs.existsSync(nodePath)) {
          rawRobot = require(nodePath)
          process.stdout.write(`[Helper] Loaded .node directly: ${nodePath}\n`)
          break
        }
      } catch {
        /* try next */
      }
    }
  }

  if (!rawRobot) throw new Error('No robotjs package found')

  rawRobot.setMouseDelay(0)
  rawRobot.setKeyboardDelay(0)
} catch (err) {
  process.stderr.write(`[Helper] Failed to load robotjs: ${err.message}\n`)
  process.exit(1)
}

// ── 加载共享算法模块 ─────────────────────────────────────────────
const { generateBezierPath, generateScrollSequence } = require('./mouse-trajectory')
const { typeStringWithDelay } = require('./typewriter')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getPositiveNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

const clickOnce = async (button, pressDuration) => {
  rawRobot.mouseToggle('down', button)
  await sleep(pressDuration)
  rawRobot.mouseToggle('up', button)
}

// ── Action 处理器 ───────────────────────────────────────────────
// 原子操作（同步）
const atomicActions = {
  moveMouse: (args) => rawRobot.moveMouse(args[0], args[1]),
  mouseClick: (args) => rawRobot.mouseClick(args[0], args[1] || false),
  keyTap: (args) => rawRobot.keyTap(args[0], args[1]),
  keyToggle: (args) => rawRobot.keyToggle(args[0], args[1]),
  typeString: (args) => rawRobot.typeString(args[0]),
  scrollMouse: (args) => rawRobot.scrollMouse(args[0], args[1]),
  mouseToggle: (args) => rawRobot.mouseToggle(args[0], args[1]),
  getMousePos: () => rawRobot.getMousePos(),
  ping: () => 'pong'
}

// 复合操作（async，内部循环执行）
const compoundActions = {
  // 整段文本在 Helper 内部逐字输入，Biz 到 Helper 始终只有一次 HTTP。
  typeStringTypewriter: async (args, context = {}) => {
    const [text, opts = {}] = args
    return typeStringWithDelay({
      text,
      minDelayMs: opts.minDelayMs,
      maxDelayMs: opts.maxDelayMs,
      isCancelled: context.isCancelled,
      typeString: (character) => rawRobot.typeString(character),
      keyTap: (key, modifiers) => rawRobot.keyTap(key, modifiers),
      sleep
    })
  },

  // 仿人化鼠标移动：贝塞尔曲线 + 逐步 moveMouse
  humanMoveTo: async (args) => {
    const [targetX, targetY, opts] = args
    const startPos = rawRobot.getMousePos()
    const { points, finalX, finalY } = generateBezierPath(
      startPos.x,
      startPos.y,
      targetX,
      targetY,
      opts
    )
    for (const pt of points) {
      rawRobot.moveMouse(pt.x, pt.y)
      await sleep(pt.delay)
    }
    // 确保停在精确位置
    rawRobot.moveMouse(finalX, finalY)
  },

  // 仿人化点击：按下 → 随机按压时间 → 抬起
  humanClick: async (args) => {
    const button = args[0] || 'left'
    const pressDuration = 120 + Math.random() * 100 // 120-220ms
    await clickOnce(button, Math.round(pressDuration))
    const afterDelay = 50 + Math.random() * 100 // 50-150ms
    await sleep(Math.round(afterDelay))
  },

  // 双击必须在 Helper 进程内闭环完成，避免两次点击之间跨进程通信抖动。
  doubleClick: async (args) => {
    const button = args[0] || 'left'
    const opts = args[1] || {}
    const clickDelay = getPositiveNumber(opts.clickDelay, 80)
    const pressDuration = getPositiveNumber(opts.pressDuration, 60)
    await clickOnce(button, pressDuration)
    await sleep(clickDelay)
    await clickOnce(button, pressDuration)
    return { clicks: 2, button, clickDelay, pressDuration }
  },

  // 仿人化滚动：分步滚动 + 不规律延迟 + 偶尔微移
  humanScroll: async (args) => {
    const [distance, opts] = args
    const currentPos = rawRobot.getMousePos()
    const sequence = generateScrollSequence(distance, opts)
    for (const step of sequence) {
      rawRobot.scrollMouse(0, step.scrollY)
      // 偶尔微小鼠标移动
      if (step.microMove) {
        const microX = currentPos.x + (Math.random() - 0.5) * 2
        const microY = currentPos.y + (Math.random() - 0.5) * 2
        rawRobot.moveMouse(Math.round(microX), Math.round(microY))
      }
      await sleep(step.delay)
    }
  }
}

// ── HTTP Server ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end('Method Not Allowed')
    return
  }

  let clientDisconnected = false
  req.on('aborted', () => {
    clientDisconnected = true
  })
  res.on('close', () => {
    if (!res.writableEnded) clientDisconnected = true
  })

  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', async () => {
    try {
      const data = JSON.parse(body)

      // Token 验证
      if (data.token !== TOKEN) {
        res.writeHead(403)
        res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
        return
      }

      const { action, args: actionArgs } = data
      let result

      if (atomicActions[action]) {
        result = atomicActions[action](actionArgs || [])
      } else if (compoundActions[action]) {
        result = await compoundActions[action](actionArgs || [], {
          isCancelled: () => clientDisconnected
        })
      } else {
        throw new Error(`Unknown action: ${action}`)
      }

      if (!clientDisconnected) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result: result ?? null }))
      }
    } catch (err) {
      if (!clientDisconnected) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[Helper] Listening on 127.0.0.1:${PORT}\n`)
})

// ── 主进程存活检测 ──────────────────────────────────────────────
if (PPID) {
  setInterval(() => {
    try {
      // process.kill(pid, 0) 不发送信号，仅检测进程是否存在
      process.kill(PPID, 0)
    } catch {
      process.stdout.write(`[Helper] Parent process ${PPID} exited, shutting down\n`)
      server.close()
      process.exit(0)
    }
  }, 3000)
}
