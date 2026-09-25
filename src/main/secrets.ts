import { app, safeStorage } from 'electron'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The Gemini API key, encrypted with the macOS keychain. Never written to settings.json.
const file = () => join(app.getPath('userData'), 'gemini.key')

export function geminiKey(): string | null {
  try {
    return safeStorage.decryptString(readFileSync(file()))
  } catch {
    return null
  }
}

export function setGeminiKey(key: string | null) {
  if (key) writeFileSync(file(), safeStorage.encryptString(key))
  else rmSync(file(), { force: true })
}
