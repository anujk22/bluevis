import type { BluevisApi } from '../../preload'

declare global {
  interface Window {
    bluevis: BluevisApi
  }
}

export {}
