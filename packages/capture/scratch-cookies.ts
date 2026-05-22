import { ProfileManager } from './cdp/ProfileManager';

async function main() {
  const profileManager = new ProfileManager();
  const threadsSession = profileManager.loadAndDecryptSession('threads');
  if (!threadsSession) {
    console.error('No threads session found on disk!');
    return;
  }
  
  console.log(`Threads session contains ${threadsSession.length} cookies:`);
  threadsSession.forEach((c: any) => {
    console.log(`- Domain: ${c.domain}, Name: ${c.name}, Path: ${c.path}, Secure: ${c.secure}`);
  });
}

main().catch(console.error);
