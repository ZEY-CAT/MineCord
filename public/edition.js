(() => {
  'use strict';

  // MineCord Edition Feature Configuration
  // Generated at build time for edition: electron
  // DO NOT EDIT MANUALLY - Run scripts/generate-edition.js instead

  window.MineCordEdition = {
    EDITION: 'electron',
    
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
      voiceCalling: true,
      voiceControls: true,
      serverVoiceChannels: true,
      privateCalls: true,
      groupCalls: true,
      voiceActivity: true,
      turnUsage: true,
      
      // Shop & cosmetics
      shop: true,
      cosmetics: true,
      inventory: true,
      cosmeticsOnboarding: true,
      demoCredits: true,
      equipCosmetics: true,
      
      // Account management
      accountMerge: true,
      accountMergeArchives: true,
      
      // Admin/owner tools
      adminUserManagement: true,
      roleManagement: true,
      roleAuditLog: true,
      appOwnerTools: true,
      
      // Eaglercraft
      eaglercraftPairing: true,
      eaglercraftActivity: true,
      
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
      eaglercraftExtension: true,
      voiceSettings: true,
      turnConfiguration: true,
      
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
})();