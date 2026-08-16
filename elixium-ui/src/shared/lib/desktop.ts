/**
 * The desktop shell's bridge, when the interface is running inside it.
 *
 * The same build serves the web UI and the Electron window, so features that
 * only make sense locally are detected rather than assumed. A native folder
 * dialog is exactly that: in the desktop app the engine and the window are the
 * same machine, so the folders it offers are the folders downloads land in.
 * Over the network they would be the viewer's folders, which the engine cannot
 * write to — so the server build simply does not offer it.
 */
export interface DesktopBridge {
  isDesktop: true;
  pickFolder: (currentPath?: string) => Promise<string | null>;
  openFolder: (target: string) => Promise<boolean>;
}

declare global {
  interface Window {
    elixium?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined =>
  typeof window !== 'undefined' && window.elixium?.isDesktop ? window.elixium : undefined;

export const isDesktopApp = (): boolean => Boolean(desktop());
