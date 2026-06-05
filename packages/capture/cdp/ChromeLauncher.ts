import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface LauncherOptions {
  headless?: boolean;
  port?: number;
  userDataDir?: string;
  chromePath?: string;
}

export class ChromeLauncher {
  private chromeProcess: ChildProcess | null = null;
  private port: number;
  private userDataDir: string;
  private chromePath: string;
  private headless: boolean;

  constructor(options: LauncherOptions = {}) {
    this.port = options.port || 9222;
    this.headless = options.headless !== false; // Default is true (headless=new)
    
    // Resolve agent user-data-dir
    this.userDataDir = options.userDataDir || path.join(
      os.homedir(),
      'Library/Application Support/Google/Chrome/BatiFlowAgent'
    );

    // Resolve chrome binary path on macOS
    this.chromePath = options.chromePath || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  /**
   * Spawns Google Chrome and waits until the CDP endpoint becomes active.
   */
  public async launch(): Promise<string> {
    // 1. Ensure user-data-dir directory exists
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    // 2. Validate Chrome exists
    if (!fs.existsSync(this.chromePath)) {
      throw new Error(`Google Chrome binary not found at ${this.chromePath}. Please install Chrome or verify the path.`);
    }

    // 3. Compile Chrome launch arguments
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-features=Translate',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--safebrowsing-disable-auto-update',
      '--password-store=basic', // Avoid popup prompts for keychain access in headless mode
      '--use-mock-keychain',
    ];

    if (this.headless) {
      args.push('--headless=new');
    }

    console.log(`[ChromeLauncher] Spawning Chrome from "${this.chromePath}"...`);
    console.log(`[ChromeLauncher] Port: ${this.port}, Headless: ${this.headless}`);
    console.log(`[ChromeLauncher] Profile: ${this.userDataDir}`);

    this.chromeProcess = spawn(this.chromePath, args, {
      detached: true,
      stdio: 'ignore'
    });

    // Make sure process doesn't hold our Node execution loop open
    this.chromeProcess.unref();

    // 4. Wait for Chrome to start listening on debugging port
    const cdpUrl = `http://127.0.0.1:${this.port}/json/version`;
    const maxRetries = 30;
    const retryIntervalMs = 500;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const metadata = await this.fetchJson<{ webSocketDebuggerUrl: string }>(cdpUrl);
        if (metadata.webSocketDebuggerUrl) {
          console.log(`[ChromeLauncher] Connected successfully! WebSocket URL: ${metadata.webSocketDebuggerUrl}`);
          return metadata.webSocketDebuggerUrl;
        }
      } catch (err) {
        // Suppress and wait
      }
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }

    // If we reach here, Chrome took too long
    this.kill();
    throw new Error(`Chrome launcher timed out waiting for debugging interface to become active on port ${this.port}`);
  }

  /**
   * Kills the Chrome process if active.
   */
  public kill(): void {
    if (this.chromeProcess) {
      console.log('[ChromeLauncher] Terminating Chrome process...');
      try {
        this.chromeProcess.kill('SIGINT');
      } catch (e) {
        // Already dead
      }
      this.chromeProcess = null;
    }
  }

  /**
   * Simple helper to retrieve JSON metadata over HTTP.
   */
  private fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(rawData));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', (e) => reject(e));
    });
  }
}
