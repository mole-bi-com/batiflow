/// <reference path="../../../types.d.ts" />
import CDP from 'chrome-remote-interface';
import { CdpClient } from './CdpClient';

export class TabPool {
  private port: number;

  constructor(port: number = 9222) {
    this.port = port;
  }

  /**
   * Spawns a new clean tab target and connects a CdpClient to it.
   */
  public async acquireTab(): Promise<CdpClient> {
    try {
      console.log('[TabPool] Acquiring clean target tab...');
      const target = await CDP.New({ port: this.port });
      console.log(`[TabPool] Created tab ID: ${target.id}`);
      
      const client = new CdpClient(target.id);
      await client.connect(this.port);
      return client;
    } catch (err) {
      console.error('[TabPool] Failed to acquire target tab:', err);
      throw err;
    }
  }

  /**
   * Closes the target tab mapped to the CdpClient session.
   */
  public async releaseTab(client: CdpClient): Promise<void> {
    const rawClient = client.getRawClient();
    if (!rawClient) return;

    const targetId = rawClient.target;
    console.log(`[TabPool] Releasing and closing tab ID: ${targetId}`);

    try {
      // 1. Disconnect the websocket session
      await client.disconnect();

      // 2. Close the browser tab target via CDP HTTP endpoint
      await CDP.Close({ id: targetId, port: this.port });
      console.log(`[TabPool] Tab closed successfully: ${targetId}`);
    } catch (err) {
      console.error(`[TabPool] Error releasing tab ${targetId}:`, err);
    }
  }

  /**
   * Cleans up all blank/unused tabs except the default background pages.
   */
  public async cleanUnusedTabs(): Promise<void> {
    try {
      const targets = await CDP.List({ port: this.port });
      const pageTargets = targets.filter((t: any) => t.type === 'page');
      
      // Keep at least one tab open, close any extra page tabs
      if (pageTargets.length > 1) {
        for (let i = 1; i < pageTargets.length; i++) {
          await CDP.Close({ id: pageTargets[i].id, port: this.port });
        }
      }
    } catch (err) {
      console.warn('[TabPool] Failed to clean unused tabs:', err);
    }
  }
}
