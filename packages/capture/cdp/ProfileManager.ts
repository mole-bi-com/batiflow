import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class ProfileManager {
  private serviceName = 'BatiFlow';
  private accountName = 'AgentSessionKey';
  private configDir: string;
  private sessionEncPath: string;

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(
      process.env.HOME || '/Users/seungwoolee',
      'Library/Application Support/Google/Chrome/BatiFlowAgent/Config'
    );
    this.sessionEncPath = path.join(this.configDir, 'session.enc.json');
  }

  /**
   * Securely saves the session encryption key to macOS Keychain.
   * If Keychain is unavailable or fails, it falls back to a secured local dotfile.
   */
  public saveSessionSecret(secret: string): void {
    try {
      console.log('[ProfileManager] Attempting to store session key in macOS Keychain...');
      // security add-generic-password -s <service> -a <account> -w <password> -U (update if exists)
      const command = `security add-generic-password -s "${this.serviceName}" -a "${this.accountName}" -w "${secret}" -U`;
      execSync(command, { stdio: 'ignore' });
      console.log('[ProfileManager] Session key saved successfully in macOS Keychain.');
    } catch (err) {
      console.warn('[ProfileManager] macOS Keychain access failed. Storing securely locally on disk as fallback.');
      this.writeLocalSecretFallback(secret);
    }
  }

  /**
   * Securely retrieves the session encryption key from macOS Keychain or fallback.
   */
  public getSessionSecret(): string {
    try {
      console.log('[ProfileManager] Fetching session key from macOS Keychain...');
      // security find-generic-password -s <service> -a <account> -w
      const secret = execSync(`security find-generic-password -s "${this.serviceName}" -a "${this.accountName}" -w`, {
        encoding: 'utf8'
      }).trim();
      return secret;
    } catch (err) {
      console.warn('[ProfileManager] macOS Keychain lookup failed. Retrieving local disk fallback key.');
      return this.getLocalSecretFallback();
    }
  }

  /**
   * Encrypts arbitrary session data (e.g., cookies JSON) and writes to platform-specific session file.
   */
  public encryptAndSaveSession(cookiesJson: any, platform: string = 'linkedin'): void {
    const secret = this.getOrCreateSecret();
    const dataString = JSON.stringify(cookiesJson);
    
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(secret, 'batiflow-salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(dataString, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const payload = {
      iv: iv.toString('hex'),
      data: encrypted
    };

    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    const sessionPath = path.join(this.configDir, `session.${platform}.enc.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[ProfileManager] Secured session for ${platform} successfully written to ${sessionPath}`);
  }

  /**
   * Decrypts and returns the saved session cookies.
   */
  public loadAndDecryptSession(platform: string = 'linkedin'): any | null {
    const sessionPath = path.join(this.configDir, `session.${platform}.enc.json`);
    
    if (!fs.existsSync(sessionPath)) {
      // Legacy fallback for linkedin compatibility
      if (platform === 'linkedin' && fs.existsSync(this.sessionEncPath)) {
        console.log('[ProfileManager] Found legacy session file. Migrating to platform-specific session...');
        try {
          const legacyData = fs.readFileSync(this.sessionEncPath, 'utf8');
          fs.writeFileSync(sessionPath, legacyData, 'utf8');
          fs.unlinkSync(this.sessionEncPath);
        } catch (e) {
          // ignore unlink error
        }
      } else {
        return null;
      }
    }

    try {
      const payload = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      const secret = this.getSessionSecret();
      
      const iv = Buffer.from(payload.iv, 'hex');
      const key = crypto.scryptSync(secret, 'batiflow-salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      
      let decrypted = decipher.update(payload.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (err) {
      console.error(`[ProfileManager] Failed to decrypt secure session for ${platform}:`, err);
      return null;
    }
  }

  /**
   * Gets the existing secret, or generates and saves a new one.
   */
  private getOrCreateSecret(): string {
    try {
      return this.getSessionSecret();
    } catch (e) {
      const newSecret = crypto.randomBytes(32).toString('hex');
      this.saveSessionSecret(newSecret);
      return newSecret;
    }
  }

  private writeLocalSecretFallback(secret: string): void {
    const fallbackPath = path.join(this.configDir, '.agent-secret');
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(fallbackPath, secret, { encoding: 'utf8', mode: 0o600 });
  }

  private getLocalSecretFallback(): string {
    const fallbackPath = path.join(this.configDir, '.agent-secret');
    if (fs.existsSync(fallbackPath)) {
      return fs.readFileSync(fallbackPath, 'utf8').trim();
    }
    // Generate a secure one-time key
    const temporarySecret = crypto.randomBytes(32).toString('hex');
    this.writeLocalSecretFallback(temporarySecret);
    return temporarySecret;
  }
}
