import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, systemPreferences, Tray } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '../core/types'
import { Brain, label } from './brain'
import { Importer } from './importer'
import { RelayManager } from './relay'
import { discoverProjects } from './projects'
import { onRateLimits, providerHealth } from './providers'
import { UsageService } from './usage'
import { getSettings, updateSettings } from './settings'
import { adoptLoginShellPath, run } from './shell'
import { TaskManager } from './tasks'
import { Vault } from './vault'
import { VoiceService } from './voice'

type Mode = 'compact' | 'expanded'

// Isolated profile (settings + vault) for tests and experiments; never touches the real vault.
if (process.env.BLUEVIS_PROFILE_DIR) app.setPath('userData', process.env.BLUEVIS_PROFILE_DIR)

let win: BrowserWindow | null = null
let mode: Mode = 'expanded'
let tray: Tray | null = null
// Events can fire during quit, after the window is gone; drop them instead of throwing.
const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
}

function boundsFor(m: Mode) {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  if (m === 'compact') {
    const size = 184
    return { width: size, height: size, x: workArea.x + workArea.width - size - 20, y: workArea.y + workArea.height - size - 20 }
  }
  const width = Math.min(1280, workArea.width - 80)
  const height = Math.min(820, workArea.height - 60)
  return { width, height, x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + (workArea.height - height) / 2) }
}

function setMode(m: Mode, focus = true) {
  if (!win) return
  mode = m
  send('window:mode', m)
  win.setAlwaysOnTop(m === 'compact', 'floating')
  win.setWindowButtonVisibility(m === 'expanded')
  win.setBounds(boundsFor(m), true)
  win.setResizable(m === 'expanded')
  if (!win.isVisible()) win.show()
  if (focus && m === 'expanded') win.focus()
}

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor('expanded'),
    minWidth: 160,
    minHeight: 160,
    // Native traffic lights sit inside the glass header; the rest of the chrome is ours.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 32, y: 34 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, backgroundThrottling: false }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Capture the main display without Bluevis in the shot. Returns the file path and a preview data URL. */
async function captureScreen(): Promise<{ path: string; preview: string } | { error: string }> {
  const path = join(app.getPath('temp'), `bluevis-screen-${Date.now()}.jpg`)
  const wasVisible = win?.isVisible()
  win?.setOpacity(0)
  await new Promise((r) => setTimeout(r, 120))
  const r = await run('screencapture', ['-x', '-m', '-t', 'jpg', path])
  win?.setOpacity(1)
  if (wasVisible === false) win?.hide()
  if (r.code !== 0 || !existsSync(path)) {
    return { error: 'Screen capture failed. Allow Bluevis under System Settings → Privacy & Security → Screen Recording.' }
  }
  const preview = `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`
  return { path, preview }
}

/** Menu bar presence: always there, so Bluevis can be found, summoned and quit. */
function createTray(openVault: () => void) {
  const icon = nativeImage.createFromPath(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Bluevis')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Bluevis', accelerator: 'Alt+Space', click: () => setMode('expanded') },
      { label: 'Talk', accelerator: 'Alt+Shift+Space', click: () => (setMode('expanded'), send('hotkey:talk')) },
      { label: 'Shrink to orb', click: () => setMode('compact', false) },
      { label: 'Hide', click: () => win?.hide() },
      { type: 'separator' },
      { label: 'Open vault', click: openVault },
      { label: 'Launch at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, enabled: app.isPackaged, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
      { type: 'separator' },
      { label: 'Quit Bluevis', accelerator: 'Cmd+Q', click: () => app.quit() }
    ])
  )
}

app.whenReady().then(async () => {
  await adoptLoginShellPath()
  const settings = getSettings()
  const vault = new Vault(settings.vaultPath)
  await vault.ensure()

  const voice = new VoiceService((h) => {
    send('voice:health', h)
    if (h.state === 'ready') void vault.refreshEmbeddings()
  }, () => getSettings().voice.ttsVoice)
  vault.embedder = (texts, query) => voice.embed(texts, query)
  let brain: Brain
  const tasks = new TaskManager(
    (t) => send('task', t),
    (t) => brain.onTaskFinished(t)
  )
  brain = new Brain(vault, tasks, {
    turn: (t) => send('turn', t),
    reset: () => send('reset'),
    busy: (b) => send('busy', b),
    speak: (id, text) => getSettings().voice.speak && send('speak', id, text),
    speakChunk: (id, text) => getSettings().voice.speak && send('speak-chunk', id, text),
    stopSpeech: () => send('speech:stop'),
    context: (c) => send('context', { ...c, brainLabel: label(c.brain) }),
    settings: (s) => send('settings', s)
  })

  const importer = new Importer(
    vault,
    (s) => send('import:state', s),
    (p) => send('import:proposals', p)
  )
  ipcMain.handle('import:state', () => importer.state)
  ipcMain.handle('import:proposals', () => importer.list())
  ipcMain.handle('import:chatgpt', async (_e, path?: string) => {
    if (path) return void importer.importChatGPT(path)
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose your ChatGPT export',
      message: 'Select the .zip from ChatGPT (Settings → Data controls → Export) or its conversations.json',
      properties: ['openFile'],
      filters: [{ name: 'ChatGPT export', extensions: ['zip', 'json'] }]
    })
    if (!r.canceled && r.filePaths[0]) void importer.importChatGPT(r.filePaths[0])
    return !r.canceled
  })
  ipcMain.handle('import:text', (_e, text: string) => importer.importText(text))
  ipcMain.handle('import:accept', (_e, key: string, edited?: { title?: string; text?: string }) => importer.accept(key, edited))
  ipcMain.handle('import:reject', (_e, key: string) => importer.reject(key))
  ipcMain.handle('import:stop', () => importer.stop())

  const relays = new RelayManager(
    vault,
    (r) => send('relay', r),
    (r) => brain.onRelayFinished(r)
  )
  brain.relays = relays
  ipcMain.handle('relays:list', () => relays.list())
  ipcMain.handle('relays:start', (_e, url: string, note?: string) => relays.start(url, note))
  ipcMain.handle('relays:stop', (_e, id: string) => relays.stop(id))

  const usage = new UsageService((u) => send('usage', u))
  onRateLimits((raw) => usage.recordClaude(raw))
  ipcMain.handle('usage:get', () => usage.get())
  ipcMain.handle('usage:refresh-claude', async () => {
    await usage.refreshClaude(join(app.getPath('userData'), 'workspace'))
    return usage.get()
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))

  ipcMain.handle('chat:send', (_e, text: string, opts: { via: 'voice' | 'text'; screenshot?: string }) => brain.handle(text, opts))
  ipcMain.handle('chat:stop', () => brain.stop())
  ipcMain.handle('chat:reset', () => brain.reset())
  ipcMain.handle('chat:turns', () => brain.turns)
  ipcMain.handle('chat:context', () => ({ ...brain.context(), brainLabel: label(brain.context().brain) }))
  ipcMain.handle('action:approve', (_e, id: string, project?: string, prompt?: string) => brain.approveAction(id, project, prompt))
  ipcMain.handle('action:dismiss', (_e, id: string) => brain.dismissAction(id))
  ipcMain.handle('memory:undo', (_e, id: string) => brain.undoMemory(id))
  ipcMain.handle('tasks:list', () => tasks.list())
  ipcMain.handle('tasks:start', (_e, t: { agent: 'codex' | 'claude'; project: string; prompt: string }) =>
    brain.delegate({ kind: 'delegate', agent: t.agent, project: t.project, prompt: t.prompt, state: 'proposed' }, undefined, true)
  )
  ipcMain.handle('tasks:stop', (_e, id: string) => tasks.stop(id))
  ipcMain.handle('projects:list', (_e, force?: boolean) => discoverProjects(getSettings().projectRoots, force, vault.projectLinks()))
  ipcMain.handle('project:activate', (_e, name?: string) => brain.setActiveProject(name))
  ipcMain.handle('project:reveal', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('memory:atlas', () => vault.atlas())
  ipcMain.handle('memory:revert', (_e, hash: string) => vault.undo(hash))
  ipcMain.handle('memory:search', (_e, q: string, strict?: boolean) => vault.search(q, { allowPrivate: true, limit: strict ? 4 : 8, strict }))
  ipcMain.handle('memory:read', (_e, rel: string) => vault.read(rel))
  ipcMain.handle('memory:open', async (_e, rel?: string) => {
    const target = rel ? join(vault.root, rel) : vault.root
    const obsidian = existsSync('/Applications/Obsidian.app')
    if (obsidian) return shell.openExternal(`obsidian://open?path=${encodeURIComponent(target)}`)
    return rel ? shell.openPath(target) : shell.openPath(vault.root)
  })
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const s = updateSettings(patch)
    send('context', { ...brain.context(), brainLabel: label(s.brain) })
    return s
  })
  ipcMain.handle('providers:health', () => providerHealth(getSettings().localBaseUrl))
  ipcMain.handle('voice:start', async () => {
    await systemPreferences.askForMediaAccess('microphone').catch(() => false)
    void voice.start()
    return voice.health
  })
  ipcMain.handle('voice:stop', () => voice.stop())
  ipcMain.handle('voice:health', () => voice.health)
  ipcMain.handle('voice:stt', (_e, wav: ArrayBuffer) => voice.transcribe(wav))
  ipcMain.handle('voice:tts', (_e, text: string, override?: string) => voice.speak(text, override ?? getSettings().voice.ttsVoice, getSettings().voice.speed))
  ipcMain.handle('window:mode', (_e, m: Mode) => setMode(m))
  ipcMain.handle('window:get-mode', () => mode)
  ipcMain.handle('window:hide', () => win?.hide())
  ipcMain.handle('app:quit', () => app.quit())
  ipcMain.handle('screen:capture', () => captureScreen())
  ipcMain.handle('screen:discard', (_e, path: string) => {
    if (path.startsWith(app.getPath('temp'))) rmSync(path, { force: true })
  })

  createWindow()
  createTray(() => void shell.openPath(vault.root))

  // ⌥Space summons or tucks away Bluevis. ⌥⇧Space talks. ⌥⇧L looks at the screen, then asks.
  globalShortcut.register('Alt+Space', () => {
    if (!win) return
    if (!win.isVisible()) setMode('expanded')
    else if (mode === 'compact') setMode('expanded')
    else if (win.isFocused()) setMode('compact', false)
    else win.focus()
  })
  globalShortcut.register('Alt+Shift+Space', () => {
    if (!win?.isVisible()) win?.showInactive()
    send('hotkey:talk')
  })
  globalShortcut.register('Alt+Shift+L', async () => {
    const shot = await captureScreen()
    setMode('expanded')
    send('screen:attached', shot)
  })

  if (getSettings().voice.enabled) void voice.start()
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    voice.stop()
    tasks.stopAll()
    importer.stop()
  })
})

app.on('window-all-closed', () => app.quit())
// Clicking the Dock icon brings Bluevis back if it was hidden.
app.on('activate', () => setMode('expanded'))
