import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const obsidianConfigPath = path.join(
  os.homedir(),
  'Library/Application Support/obsidian/obsidian.json'
);

function registerVault() {
  console.log('🔍 Locating Obsidian configuration...');
  if (!fs.existsSync(obsidianConfigPath)) {
    console.error('❌ obsidian.json not found. Make sure Obsidian is installed and has been launched at least once.');
    process.exit(1);
  }

  try {
    const rawData = fs.readFileSync(obsidianConfigPath, 'utf8');
    const config = JSON.parse(rawData);
    
    if (!config.vaults) {
      config.vaults = {};
    }

    const targetPath = '/Users/seungwoolee/Desktop/project/batiflow/vault';
    
    // Check if the vault is already registered
    let existingKey = '';
    for (const [key, vault] of Object.entries(config.vaults)) {
      if ((vault as any).path === targetPath) {
        existingKey = key;
        break;
      }
    }

    if (existingKey) {
      console.log(`✨ BatiFlow Vault is already registered under key: ${existingKey}`);
      // Mark it open
      config.vaults[existingKey].open = true;
    } else {
      // Generate a random 16-character hex key
      const newKey = Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 10);
      console.log(`➕ Registering BatiFlow Vault under a new key: ${newKey}`);
      config.vaults[newKey] = {
        path: targetPath,
        ts: Date.now(),
        open: true
      };
    }

    // De-register 'open' status from other vaults to prevent overlap
    for (const [key, vault] of Object.entries(config.vaults)) {
      if ((vault as any).path !== targetPath) {
        delete (vault as any).open;
      }
    }

    fs.writeFileSync(obsidianConfigPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('✅ obsidian.json updated successfully!');

    // Kill Obsidian if it's currently running so it picks up the configuration on reload
    console.log('🔄 Restarting Obsidian with the registered vault...');
    try {
      execSync('pkill -i obsidian', { stdio: 'ignore' });
      // Small pause to let process exit
      execSync('sleep 1');
    } catch (e) {
      // Obsidian might not have been running, which is fine
    }

    // Launch Obsidian pointing directly to the specific note file
    const noteUrl = "obsidian://open?path=/Users/seungwoolee/Desktop/project/batiflow/vault/Inbox/SungJae%20Shim%20-%20%EC%9D%B4%EC%84%B1%EC%9B%90%20reposted%20this%20SungJae%20Shim%20%E2%80%A2%20Fo.md";
    execSync(`open "${noteUrl}"`);
    console.log('🎉 Obsidian successfully opened with your BatiFlow note!');

  } catch (err: any) {
    console.error(`❌ Error updating Obsidian config: ${err.message}`);
  }
}

registerVault();
