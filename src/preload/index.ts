import { contextBridge, ipcRenderer } from 'electron'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const api = {
  chat: {
    send: invoke('chat:send'),
    stop: invoke('chat:stop'),
    reset: invoke('chat:reset'),
    turns: invoke('chat:turns'),
    context: invoke('chat:context')
  },
  actions: { approve: invoke('action:approve'), dismiss: invoke('action:dismiss') },
  tasks: { list: invoke('tasks:list'), start: invoke('tasks:start'), stop: invoke('tasks:stop') },
  projects: { list: invoke('projects:list'), activate: invoke('project:activate'), reveal: invoke('project:reveal') },
  memory: { atlas: invoke('memory:atlas'), read: invoke('memory:read'), open: invoke('memory:open'), undo: invoke('memory:undo'), revert: invoke('memory:revert'), search: invoke('memory:search') },
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  providers: { health: invoke('providers:health') },
  voice: { start: invoke('voice:start'), stop: invoke('voice:stop'), health: invoke('voice:health'), stt: invoke('voice:stt'), tts: invoke('voice:tts') },
  window: { setMode: invoke('window:mode'), getMode: invoke('window:get-mode'), hide: invoke('window:hide') },
  relays: { list: invoke('relays:list'), start: invoke('relays:start'), stop: invoke('relays:stop') },
  usage: { get: invoke('usage:get'), refreshClaude: invoke('usage:refresh-claude') },
  importer: {
    state: invoke('import:state'),
    proposals: invoke('import:proposals'),
    chatgpt: invoke('import:chatgpt'),
    text: invoke('import:text'),
    accept: invoke('import:accept'),
    reject: invoke('import:reject'),
    stop: invoke('import:stop')
  },
  screen: { capture: invoke('screen:capture'), discard: invoke('screen:discard') },
  on(channel: string, cb: (...args: unknown[]) => void) {
    const listener = (_e: unknown, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('bluevis', api)

export type BluevisApi = typeof api
