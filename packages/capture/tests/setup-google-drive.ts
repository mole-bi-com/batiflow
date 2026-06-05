import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function setup() {
  const homeDir = os.homedir();
  const cloudStorageDir = path.join(homeDir, 'Library/CloudStorage');
  
  if (!fs.existsSync(cloudStorageDir)) {
    console.error('❌ CloudStorage directory not found. Please install Google Drive for Desktop first.');
    process.exit(1);
  }
  
  const files = fs.readdirSync(cloudStorageDir);
  const gdFolders = files.filter(f => f.startsWith('GoogleDrive-'));
  
  if (gdFolders.length === 0) {
    console.error('❌ Google Drive mount folder not found in Library/CloudStorage.');
    console.log('👉 Please make sure Google Drive for Desktop is installed and logged in.');
    process.exit(1);
  }
  
  const gdFolder = gdFolders[0];
  const gdPath = path.join(cloudStorageDir, gdFolder);
  
  // Find "My Drive" or "내 드라이브"
  let myDrivePath = path.join(gdPath, 'My Drive');
  if (!fs.existsSync(myDrivePath)) {
    myDrivePath = path.join(gdPath, '내 드라이브');
  }
  
  if (!fs.existsSync(myDrivePath)) {
    console.error('❌ "My Drive" or "내 드라이브" folder not found inside Google Drive mount.');
    process.exit(1);
  }
  
  const targetVaultPath = path.join(myDrivePath, 'batiflow-vault');
  console.log(`\n🎯 Target Vault Path on Google Drive: ${targetVaultPath}`);
  
  // Create folder if it doesn't exist
  if (!fs.existsSync(targetVaultPath)) {
    fs.mkdirSync(targetVaultPath, { recursive: true });
    console.log('✅ Created "batiflow-vault" folder in Google Drive.');
  }
  
  // Copy current vault contents to Google Drive if empty
  const projectRoot = path.resolve(__dirname, '../../..');
  const currentVaultPath = path.join(projectRoot, 'vault');
  
  if (fs.existsSync(currentVaultPath)) {
    const targetFiles = fs.existsSync(targetVaultPath) ? fs.readdirSync(targetVaultPath) : [];
    // We only migrate if the target directory is empty or contains only non-essential files
    const essentialFiles = targetFiles.filter(f => f !== '.DS_Store');
    
    if (essentialFiles.length === 0) {
      console.log('📦 Copying existing vault files to Google Drive...');
      copyFolderRecursiveSync(currentVaultPath, targetVaultPath);
      console.log('✅ Vault migration complete.');
    } else {
      console.log('ℹ️ Google Drive vault is already initialized or not empty. Skipping file migration.');
    }
  }
  
  // Update BatiFlow .env
  const batiflowEnvPath = path.join(projectRoot, '.env');
  if (fs.existsSync(batiflowEnvPath)) {
    let content = fs.readFileSync(batiflowEnvPath, 'utf8');
    if (content.includes('OBSIDIAN_VAULT_PATH=')) {
      content = content.replace(/OBSIDIAN_VAULT_PATH=.*/, `OBSIDIAN_VAULT_PATH=${targetVaultPath}`);
    } else {
      content += `\nOBSIDIAN_VAULT_PATH=${targetVaultPath}`;
    }
    fs.writeFileSync(batiflowEnvPath, content, 'utf8');
    console.log('✅ Updated BatiFlow .env path.');
  }
  
  // Update Hermes .env
  const hermesEnvPath = path.join(homeDir, '.hermes/.env');
  if (fs.existsSync(hermesEnvPath)) {
    let content = fs.readFileSync(hermesEnvPath, 'utf8');
    if (content.includes('OBSIDIAN_VAULT_PATH=')) {
      content = content.replace(/OBSIDIAN_VAULT_PATH=.*/, `OBSIDIAN_VAULT_PATH=${targetVaultPath}`);
    } else {
      content += `\nOBSIDIAN_VAULT_PATH=${targetVaultPath}`;
    }
    fs.writeFileSync(hermesEnvPath, content, 'utf8');
    console.log('✅ Updated Hermes .env path.');
  }
  
  console.log('\n🎉 Setup completed! Please restart the Hermes gateway or run the sync worker to verify.');
}

function copyFolderRecursiveSync(source: string, target: string) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);

    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

setup().catch(console.error);
