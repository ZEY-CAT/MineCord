function metadata(account) {
  try { return JSON.parse(account?.rawData || '{}'); } catch { return {}; }
}

function isVerifiedBedrockAccount(account) {
  const info = metadata(account);
  return account?.edition === 'bedrock'
    && typeof account.username === 'string'
    && /^\d{16}$/.test(String(account.xuid || ''))
    && info.verified === true
    && info.source === 'xbox-profile';
}

function isVerifiedJavaProfile(profile) {
  return profile?.source === 'minecraft-services'
    && typeof profile.username === 'string'
    && /^[A-Za-z0-9_]{1,16}$/.test(profile.username)
    && /^[a-f0-9]{32}$/i.test(String(profile.uuid || ''));
}

function linkVerifiedBedrockAccount(state, user, profile) {
  const username = typeof profile?.username === 'string' ? profile.username.trim() : '';
  const xuid = typeof profile?.xuid === 'string' ? profile.xuid : '';
  if (profile?.source !== 'xbox-profile' || username.length < 1 || username.length > 32 || /[\u0000-\u001f\u007f]/.test(username) || !/^\d{16}$/.test(xuid)) {
    const error = new Error('The Xbox profile could not be verified.');
    error.code = 'INVALID_BEDROCK_PROFILE';
    throw error;
  }

  const owner = user?.username;
  if (typeof owner !== 'string' || !owner) throw new Error('A MineCord account is required to link Minecraft.');
  const duplicate = (state.gameAccounts || []).some(account => account.edition === 'bedrock' && account.xuid === xuid && account.owner !== owner)
    || Object.values(state.users || {}).some(other => other.id !== user.id && (other.gameAccounts || []).some(account => account.edition === 'bedrock' && account.xuid === xuid));
  if (duplicate) {
    const error = new Error('That Xbox account is already linked to another MineCord account.');
    error.code = 'BEDROCK_ACCOUNT_ALREADY_LINKED';
    throw error;
  }

  state.gameAccounts = (state.gameAccounts || []).filter(account => !(account.owner === owner && account.edition === 'bedrock'));
  const account = {
    owner,
    edition: 'bedrock',
    username,
    xuid,
    linkedAt: Number(profile.linkedAt) || Date.now(),
    rawData: JSON.stringify({ source: 'xbox-profile', verified: true })
  };
  state.gameAccounts.push(account);
  return account;
}

function listMineCordGameAccounts(state, user) {
  const accounts = (state.gameAccounts || [])
    .filter(account => account.owner === user.username)
    .map(account => ({
      edition: account.edition,
      username: account.username,
      uuid: account.uuid || null,
      xuid: account.xuid || null,
      linkedAt: account.linkedAt,
      verified: account.edition === 'bedrock'
        ? isVerifiedBedrockAccount(account)
        : account.edition === 'java'
          ? isVerifiedJavaProfile({ ...metadata(account), username: account.username, uuid: account.uuid })
          : false
    }));

  const profile = user.minecraft;
  if (isVerifiedJavaProfile(profile) && !accounts.some(account => account.edition === 'java' && account.verified)) {
    accounts.push({ edition: 'java', username: profile.username, uuid: profile.uuid.toLowerCase(), xuid: null, linkedAt: profile.linkedAt, verified: true });
  }
  return accounts;
}

module.exports = { isVerifiedBedrockAccount, isVerifiedJavaProfile, linkVerifiedBedrockAccount, listMineCordGameAccounts };
