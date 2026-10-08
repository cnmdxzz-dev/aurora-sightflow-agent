/**
 * Windows Helper — 进程隔离的 RobotJS HTTP 服务
 *
 * 运行方式：ELECTRON_RUN_AS_NODE=1 <randomName>.exe src/helper-win/main.js --port=... --token=... --ppid=... --helper-dir=...
 *
 * 功能：
 *   - 在 127.0.0.1:port 上启动 HTTP Server
 *   - 接收 JSON POST 请求，分发 RobotJS 操作
 *   - Token 鉴权
 *   - 定期检查 ppid 存活状态（看门狗）
 */
const http = require('http')
const path = require('path')

// ── 解析启动参数 ──────────────────────────────────────────
function getArg(prefix) {
  const arg = process.argv.find(a => a.startsWith(prefix))
  if (!arg) return ''
  // 去掉可能的外层引号
  return arg.slice(prefix.length).replace(/^"|"$/g, '')
}

const port = parseInt(getArg('--port='), 10) || 58582
const token = getArg('--token=')
const ppid = parseInt(getArg('--ppid='), 10) || 0
const helperDir = getArg('--helper-dir=')

console.log(`[WinHelper] Starting...`)
console.log(`[WinHelper]   port=${port}`)
console.log(`[WinHelper]   ppid=${ppid}`)
console.log(`[WinHelper]   helperDir=${helperDir}`)
console.log(`[WinHelper]   argv=${JSON.stringify(process.argv)}`)
console.log(`[WinHelper]   cwd=${process.cwd()}`)
console.log(`[WinHelper]   ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE}`)

// ── 加载 RobotJS ──────────────────────────────────────────
let rawRobot
try {
  if (helperDir) {
    // 尝试从 helperDir/node_modules 加载
    const robotPath = path.join(helperDir, 'node_modules', '@hurdlegroup', 'robotjs')
    console.log(`[WinHelper] Loading robotjs from: ${robotPath}`)
    rawRobot = require(robotPath)
  } else {
    // 直接 require（依赖 Node.js 模块搜索路径）
    console.log('[WinHelper] Loading robotjs from default module path')
    rawRobot = require('@hurdlegroup/robotjs')
  }
  console.log('[WinHelper] RobotJS loaded successfully')
} catch (err) {
  console.error('[WinHelper] ❌ Failed to load RobotJS:', err.message)
  console.error('[WinHelper]   stack:', err.stack)
  // 不退出——让 HTTP Server 启动，这样主进程能收到有意义的错误响应
}

// ── 看门狗：定期检查主进程是否存活 ──────────────────────────
if (ppid > 0) {
  setInterval(() => {
    try {
      process.kill(ppid, 0)
    } catch (e) {
      console.log('[WinHelper] Parent process died, exiting...')
      process.exit(0)
    }
  }, 2000)
}

// ── HTTP Server ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
    return
  }

  // Token 鉴权
  const reqToken = req.headers['authorization'] || req.headers['x-helper-token']
  if (token && reqToken !== `Bearer ${token}` && reqToken !== token) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, error: 'Unauthorized' }))
    return
  }

  let body = ''
  req.on('data', chunk => {
    body += chunk
  })

  req.on('end', () => {
    try {
      if (!rawRobot) {
        throw new Error('RobotJS is not loaded — Helper started but native module failed to load')
      }

      const data = JSON.parse(body)
      const { action, args } = data

      let result
      if (action === 'moveMouse') {
        rawRobot.moveMouse(args[0], args[1])
      } else if (action === 'mouseClick') {
        rawRobot.mouseClick(args[0], args[1])
      } else if (action === 'keyTap') {
        rawRobot.keyTap(args[0], args[1])
      } else if (action === 'keyToggle') {
        rawRobot.keyToggle(args[0], args[1])
      } else if (action === 'typeString') {
        rawRobot.typeString(args[0])
      } else if (action === 'scrollMouse') {
        rawRobot.scrollMouse(args[0], args[1])
      } else if (action === 'mouseToggle') {
        rawRobot.mouseToggle(args[0], args[1])
      } else if (action === 'getMousePos') {
        result = rawRobot.getMousePos()
      } else if (action === 'ping') {
        result = 'pong'
      } else {
        throw new Error(`Unknown action: ${action}`)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, result }))
    } catch (err) {
      console.error(`[WinHelper] Action error: ${err.message}`)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: err.message }))
    }
  })
})

server.on('error', (err) => {
  console.error('[WinHelper] ❌ Server error:', err.message)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[WinHelper] ✅ HTTP Server listening on http://127.0.0.1:${port}`)
})
