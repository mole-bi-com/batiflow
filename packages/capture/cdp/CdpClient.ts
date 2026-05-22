/// <reference path="../../../types.d.ts" />
import CDP from 'chrome-remote-interface';

export class CdpClient {
  private client: any | null = null;
  private targetId: string;

  constructor(targetId: string) {
    this.targetId = targetId;
  }

  /**
   * Connects to the specific Chrome target tab via raw CDP.
   */
  public async connect(port: number = 9222): Promise<void> {
    try {
      this.client = await CDP({ target: this.targetId, port });
      
      // Enable necessary protocol domains
      const { Page, Runtime, DOM, Network } = this.client;
      await Promise.all([
        Page.enable(),
        Runtime.enable(),
        DOM.enable(),
        Network.enable()
      ]);
      
      console.log(`[CdpClient] Connected to target tab: ${this.targetId}`);
    } catch (err) {
      console.error('[CdpClient] Connection failed:', err);
      throw err;
    }
  }

  /**
   * Disconnects the CDP client session.
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /**
   * Navigates to a target URL and waits for the page load event.
   */
  public async navigate(url: string, timeoutMs: number = 30000): Promise<void> {
    if (!this.client) throw new Error('CDP client not connected.');

    const { Page } = this.client;
    
    return new Promise<void>(async (resolve, reject) => {
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Navigation timed out for URL: ${url}`));
        }
      }, timeoutMs);

      // Setup one-shot event listener for loadEventFired
      const onLoad = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      };

      Page.loadEventFired(onLoad);

      try {
        await Page.navigate({ url });
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      }
    });
  }

  /**
   * Evaluates a Javascript expression in the context of the page and returns the serialized result.
   */
  public async evaluate<T>(expression: string): Promise<T> {
    if (!this.client) throw new Error('CDP client not connected.');

    const { Runtime } = this.client;
    const response = await Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    if (response.exceptionDetails) {
      throw new Error(`Javascript Evaluation Exception: ${response.exceptionDetails.exception.description}`);
    }

    return response.result.value as T;
  }

  /**
   * Clicks an element matching the selector by evaluating a click in-page.
   * If simulated real mouse is required, we can expand this to use CDP's Input domain.
   */
  public async click(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (element) {
          element.click();
          return true;
        }
        return false;
      })()
    `);
  }

  /**
   * Expose the raw client for custom domain commands if needed.
   */
  public getRawClient(): any {
    return this.client;
  }
}
