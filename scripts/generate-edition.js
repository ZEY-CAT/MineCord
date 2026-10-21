/**
 * Generate edition.js configuration file
 * Usage: node scripts/generate-edition.js [electron|tauri-lite]
 */
const fs = require('fs');
const path = require('path');

const edition = process.argv[2] || 'tauri-lite';

if (!['electron', 'tauri-lite'].includes(edition)) {
  console.error('Invalid edition. Use: electron or tauri-lite');
  process.exit(1);
}

const template = `(() => {
  'use strict';

  // MineCord Edition Feature Configuration
  // Generated at build time for edition: ${edition}
  // DO NOT EDIT MANUALLY - Run scripts/generate-edition.js instead

  window.MineCordEdition = {
    EDITION: '${edition}',
    
    features: {
      // Core features (always enabled)
      accounts: true,
      profiles: true,
      authentication: true,
      friends: true,
      dms: true,
      servers: true,
      channels: true,
      textChat: true,
      minecraftLinking: true,
      
      // Full edition only features
      voiceCalling: ${edition === 'electron'},
      voiceControls: ${edition === 'electron'},
      serverVoiceChannels: ${edition === 'electron'},
      privateCalls: ${edition === 'electron'},
      groupCalls: ${edition === 'electron'},
      voiceActivity: ${edition === 'electron'},
      turnUsage: ${edition === 'electron'},
      
      // Shop & cosmetics
      shop: ${edition === 'electron'},
      cosmetics: ${edition === 'electron'},
      inventory: ${edition === 'electron'},
      cosmeticsOnboarding: ${edition === 'electron'},
      demoCredits: ${edition === 'electron'},
      equipCosmetics: ${edition === 'electron'},
      
      // Account management
      accountMerge: ${edition === 'electron'},
      accountMergeArchives: ${edition === 'electron'},
      
      // Admin/owner tools
      adminUserManagement: ${edition === 'electron'},
      roleManagement: ${edition === 'electron'},
      roleAuditLog: ${edition === 'electron'},
      appOwnerTools: ${edition === 'electron'},
      
      // Eaglercraft
      eaglercraftPairing: ${edition === 'electron'},
      eaglercraftActivity: ${edition === 'electron'},
      
      // Minecraft linking (enabled in both)
      minecraftUsername: true,
      minecraftUuid: true,
      minecraftEdition: true,
      
      // Game worlds
      gameWorlds: true,
      
      // Activity/game status
      gameActivity: true,
      activityDisplay: true,
      
      // Advanced settings
      eaglercraftExtension: ${edition === 'electron'},
      voiceSettings: ${edition === 'electron'},
      turnConfiguration: ${edition === 'electron'},
      
      // Notifications
      desktopNotifications: true,
      pushNotifications: true,
      
      // Mobile-specific
      microphonePermission: true,
    },
    
    isEnabled(feature) {
      return this.features[feature] === true;
    },
    
    isLite() {
      return this.EDITION === 'tauri-lite';
    },
    
    isFull() {
      return this.EDITION === 'electron';
    },
    
    getDisabledFeatures() {
      return Object.entries(this.features)
        .filter(([, enabled]) => !enabled)
        .map(([feature]) => feature);
    },
    
    getEnabledFeatures() {
      return Object.entries(this.features)
        .filter(([, enabled]) => enabled)
        .map(([feature]) => feature);
    }
  };
})();`;

const outputPath = path.join(__dirname, '..', 'public', 'edition.js');
fs.writeFileSync(outputPath, template);
console.log(`Generated edition.js for ${edition} edition`);