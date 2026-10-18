(() => {
  'use strict';

  // MineCord Edition Feature Configuration
  // Generated at build time for edition: tauri-lite
  // DO NOT EDIT MANUALLY - Run scripts/generate-edition.js instead

  window.MineCordEdition = {
    EDITION: 'tauri-lite',
    
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
      voiceCalling: false,
      voiceControls: false,
      serverVoiceChannels: false,
      privateCalls: false,
      groupCalls: false,
      voiceActivity: false,
      turnUsage: false,
      
      // Shop & cosmetics
      shop: false,
      cosmetics: false,
      inventory: false,
      cosmeticsOnboarding: false,
      demoCredits: false,
      equipCosmetics: false,
      
      // Account management
      accountMerge: false,
      accountMergeArchives: false,
      
      // Admin/owner tools
      adminUserManagement: false,
      roleManagement: false,
      roleAuditLog: false,
      appOwnerTools: false,
      
      // Eaglercraft
      eaglercraftPairing: false,
      eaglercraftActivity: false,
      
      // Minecraft linking (enabled in both)
      minecraftUsername: true,
      minecraftUuid: true,
      minecraftEdition: true,
      
      // Activity/game status
      gameActivity: true,
      activityDisplay: true,
      
      // Advanced settings
      eaglercraftExtension: false,
      voiceSettings: false,
      turnConfiguration: false,
      
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