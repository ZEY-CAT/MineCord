require('dotenv').config();
const express=require('express'),http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const oauthStateCookie=require('./oauth-state');
const PORT=Number(process.env.PORT||3000),APP_URL=process.env.APP_URL||process.env.RENDER_EXTERNAL_URL||`http://localhost:${PORT}`,DATA=path.join(__dirname,'data.json');
if(APP_URL.startsWith('https://')){const publicOrigin=APP_URL.replace(/\/+$/,'');process.env.GOOGLE_CALLBACK_URL=`${publicOrigin}/auth/google/callback`;process.env.GITHUB_CALLBACK_URL=`${publicOrigin}/auth/github/callback`}
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server,verifyClient:({origin,req},done)=>{if(origin&&origin!==new URL(APP_URL).origin)return done(false,403,'Invalid origin');const user=authUser(req);if(!user)return done(false,401,'Sign in required.');const ban=bans.activeBan(data,user);if(ban)return done(false,403,bans.banMessage(ban));done(true)}});
app.set('trust proxy', 1);
const blank={users:{},servers:[],messages:{},friends:{},invites:{},oauthStates:{},gameActivities:{},dmRead:{},gameServers:[],gameAccounts:[],eaglercraftLinks:[],bans:[],banAudit:[]};
const database=require('./database');
const {createMeteredTurnService}=require('./metered-turn');
const meteredTurn=createMeteredTurnService({database});
const accountLinks=require('./account-links');
const accountMerge=require('./account-merge');
const games=require('./games');
const { updaterRoutes } = require('./updater-routes');
const shopModule=require('./shop');
const bans=require('./bans');
const multiplayer=require('./games-multiplayer');
const roles=require('./roles');
const turnConfig=require('./turn-config');
const {requestTimingMiddleware, withDbTiming, withDbTimingAsync, withWsTiming, withWsTimingAsync, updateConnectionGauges, updateCacheGauges, metrics} = require('./metrics');
const {
  userCache, serverCache, channelCache, messageCache, friendCache, activityCache,
  keys, invalidateUserCaches, invalidateServerCaches, invalidateChannelCaches,
  invalidateMessageCaches, invalidateDMCaches, getAllCacheStats
} = require('./cache');
let data=database.loadState(DATA,blank); for(const k in blank) if(data[k]===undefined)data[k]=blank[k];
console.log('[STARTUP] Loaded friends:', Object.keys(data.friends||{}).length, 'entries');
if(data.friends) console.log('[STARTUP] Friends:', JSON.stringify(data.friends, null, 2));
bans.ensureBans(data);
data.roleAudit ||= [];
data.accountMergeAudit ||= [];
function save(){for(const user of Object.values(data.users))if(!user.role)user.role=user.onboardingCompletedAt?roles.ROLES.MEMBER:roles.ROLES.NEW_MEMBER;database.writeState(data);userCache.clear();serverCache.clear();channelCache.clear();messageCache.clear();friendCache.clear();activityCache.clear()} function id(p){return p+'-'+Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex')} function clean(x,n=100){return String(x??'').trim().slice(0,n)} function reservedUsername(value){const name=String(value||'').toLowerCase();return name==='__proto__'||name==='constructor'||name==='prototype'} function cleanAvatar(value){const avatar=clean(value,500);if(!avatar)return '';try{const url=new URL(avatar);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}} function pair(a,b){return [a,b].sort().join('::')}
let APP_OWNER_USER_ID=String(process.env.APP_OWNER_USER_ID||'').trim();
const APP_OWNER_USERNAME=String(process.env.APP_OWNER_USERNAME||'ZEY-CAT').trim();
function resolveOwnerAccount(){
 const byId=APP_OWNER_USER_ID?Object.values(data.users).find(user=>user.id===APP_OWNER_USER_ID):null;
 if(byId)return byId;
 if(!APP_OWNER_USERNAME)return null;
 const matches=Object.values(data.users).filter(user=>String(user.username||'').toLowerCase()===APP_OWNER_USERNAME.toLowerCase());
 if(matches.length===1)return matches[0];
 if(matches.length>1)console.warn(`APP_OWNER_USERNAME matches ${matches.length} accounts; refusing to guess. Set APP_OWNER_USER_ID explicitly.`);
 return null;
}
function initializeRoles(){
 let changed=false;
 for(const user of Object.values(data.users)){
  const role=roles.normalizeRole(user.role, roles.ROLES.MEMBER);
  if(user.role!==role){user.role=role;changed=true}
 }
 const owner=resolveOwnerAccount();
 if(owner){APP_OWNER_USER_ID=owner.id;if(owner.role!==roles.ROLES.APP_OWNER){owner.role=roles.ROLES.APP_OWNER;changed=true}}
 else if(APP_OWNER_USER_ID)console.warn('APP_OWNER_USER_ID does not match an existing MINECORD account.');
 else if(APP_OWNER_USERNAME)console.warn(`APP_OWNER_USERNAME "${APP_OWNER_USERNAME}" does not match an existing MINECORD account.`);
 if(changed)save();
}
initializeRoles();
function isAcceptedFriend(a,b){const friendship=data.friends[pair(a,b)];return friendship?.status==='accepted'}
function canAccessDM(username,peer){return username!==peer&&Boolean(data.users[peer])&&(isAcceptedFriend(username,peer)||Boolean(data.messages[`dm:${pair(username,peer)}`]?.length))}
function channelForUser(username,scope,type){const separator=scope.indexOf(':');if(separator<1)return null;const server=data.servers.find(item=>item.id===scope.slice(0,separator));if(!server||!server.members?.includes(username))return null;const channel=server.channels?.find(item=>item.id===scope.slice(separator+1));return channel&&(!type||channel.type===type)?{server,channel}:null}
function validRtcSignal(signal){
 if(!signal||typeof signal!=='object'||Array.isArray(signal))return false;
 if(signal.description&&signal.candidate===undefined){
  const description=signal.description;
  return description&&['offer','answer'].includes(description.type)&&typeof description.sdp==='string'&&description.sdp.length<=100000;
 }
 if(signal.candidate&&signal.description===undefined){
  const candidate=signal.candidate;
  return candidate&&typeof candidate==='object'&&typeof candidate.candidate==='string'&&candidate.candidate.length<=4096
   &&(candidate.sdpMid===null||candidate.sdpMid===undefined||typeof candidate.sdpMid==='string')
   &&(candidate.sdpMLineIndex===null||candidate.sdpMLineIndex===undefined||Number.isInteger(candidate.sdpMLineIndex));
 }
 return false;
}
function toServerMembers(serverId,message){const members=new Set(data.servers.find(item=>item.id===serverId)?.members||[]);for(const [client,username] of clients)if(members.has(username))send(client,message)}
function pub(u){return {id:u.id,username:u.username,displayName:u.displayName,avatar:u.avatar||'',minecraft:u.minecraft||null,activity:u.showGameActivity===false?null:activityPresenceFor(u.username),showGameActivity:u.showGameActivity!==false,oauth:u.oauth?{provider:u.oauth.provider}:null,role:u.id===APP_OWNER_USER_ID?roles.ROLES.APP_OWNER:u.role||roles.ROLES.MEMBER,roleLabel:roles.ROLE_LABELS[u.id===APP_OWNER_USER_ID?roles.ROLES.APP_OWNER:u.role]||roles.ROLE_LABELS.member,onboardingCompletedAt:u.onboardingCompletedAt||null,createdAt:u.createdAt}}
function send(ws,o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))} function toUser(name,o){for(const [ws,u] of clients)if(u===name)send(ws,o)} function disconnectUser(name,reason='Account unavailable.'){for(const [ws,u] of clients)if(u===name)try{ws.close(1008,reason)}catch{}}
function onlineFor(username){return [...new Set(clients.values())].filter(subject=>subject===username||isAcceptedFriend(username,subject))}
function broadcastPresence(){for(const [client,username] of clients){const online=onlineFor(username);send(client,{type:'presence',online,members:Object.fromEntries(online.map(name=>[name,pub(data.users[name])]))})}}
const BUILT_PUBLIC=path.join(__dirname,'../dist/web');
const PUBLIC=fs.existsSync(path.join(BUILT_PUBLIC,'index.html'))?BUILT_PUBLIC:path.join(__dirname,'../public');
app.use(express.json({limit:'256kb'}));
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), geolocation=(), microphone=(self)');
  if(APP_URL.startsWith('https://'))res.setHeader('Strict-Transport-Security','max-age=31536000');
  next();
});

// Landing page at root. Auth results from older links are sent to the app screen.
app.get('/',(req,res)=>{
  const authQueryKeys=['oauth','auth_error','account_link','account_link_error','minecraft_link','minecraft_link_error','bedrock_link','bedrock_link_error'];
  if(authQueryKeys.some(key=>Object.prototype.hasOwnProperty.call(req.query,key))){
    const queryIndex=req.originalUrl.indexOf('?');
    return res.redirect('/app'+(queryIndex>=0?req.originalUrl.slice(queryIndex):''));
  }
  const landingPath=path.join(PUBLIC,'landing.html');
  if(fs.existsSync(landingPath)){
    res.sendFile(landingPath);
  }else{
    res.redirect('/app');
  }
});

// Web app at /app
app.get('/app',(req,res)=>{
  const appPath=path.join(PUBLIC,'index.html');
  if(fs.existsSync(appPath)){
    res.sendFile(appPath);
  }else{
    res.status(404).send('Web app not found');
  }
});

// Branded download page. Only lists artifacts that actually exist in the latest release.
app.get('/download',(req,res)=>{
  const downloadPath=path.join(PUBLIC,'download.html');
  if(fs.existsSync(downloadPath))return res.sendFile(downloadPath);
  res.redirect('/app');
});

let downloadCache={at:0,data:null};
async function fallbackDownloads(){
  const packageVersion=require('../package.json').version;
  let tag=`v${packageVersion}`;
  try{
    const latest=await fetch('https://github.com/ZEY-CAT/MineCord/releases/latest',{method:'HEAD',redirect:'follow',headers:{'User-Agent':'MineCord-Downloads'}});
    const match=String(latest.url||'').match(/\/tag\/([^/?#]+)/);
    if(match)tag=match[1];
  }catch{}
  const version=tag.replace(/^v/,'');
  const base=`https://github.com/ZEY-CAT/MineCord/releases/download/${encodeURIComponent(tag)}`;
  const names=[
    'MineCord-Android.apk',
    'MineCord-macOS-Intel.dmg',
    'MineCord-macOS-AppleSilicon.dmg',
    'MineCord-Web.zip',
    `MINECORD_${version}_x64-setup.exe`,
    `MINECORD.Setup.${version}.exe`,
    `MineCord-Tauri-Lite-v${version}-Windows-x64.zip`,
    `MINECORD_${version}_amd64.AppImage`,
    `MINECORD_${version}_amd64.deb`,
    `MINECORD-${version}-1.x86_64.rpm`
  ];
  const assets=[];
  await Promise.all(names.map(async name=>{
    const url=`${base}/${encodeURIComponent(name)}`;
    try{
      const response=await fetch(url,{method:'HEAD',redirect:'follow',headers:{'User-Agent':'MineCord-Downloads'}});
      if(!response.ok)return;
      assets.push({name,url,size:Number(response.headers.get('content-length'))||0,contentType:response.headers.get('content-type')||'',downloads:0});
    }catch{}
  }));
  assets.sort((a,b)=>a.name.localeCompare(b.name));
  return {release:{tag,name:`MINECORD ${tag}`,url:`https://github.com/ZEY-CAT/MineCord/releases/tag/${encodeURIComponent(tag)}`,publishedAt:null},assets};
}
app.get('/api/downloads',async(req,res)=>{
  if(downloadCache.data&&Date.now()-downloadCache.at<10*60*1000)return res.json(downloadCache.data);
  const fallback={release:null,assets:[]};
  try{
    const headers={'Accept':'application/vnd.github+json','User-Agent':'MineCord-Downloads'};
    if(process.env.GITHUB_TOKEN)headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
    const response=await fetch('https://api.github.com/repos/ZEY-CAT/MineCord/releases?per_page=10',{headers});
    if(!response.ok)throw new Error(`GitHub releases request failed (${response.status}).`);
    const releases=await response.json();
    const release=(Array.isArray(releases)?releases:[]).find(item=>!item.draft&&!item.prerelease)||(Array.isArray(releases)?releases[0]:null);
    const data=release?{
      release:{tag:release.tag_name,name:release.name,url:release.html_url,publishedAt:release.published_at},
      assets:(release.assets||[]).filter(asset=>asset.state==='uploaded'&&Number(asset.size)>0).map(asset=>({name:asset.name,url:asset.browser_download_url,size:Number(asset.size),contentType:asset.content_type,downloads:asset.download_count}))
    }:fallback;
    if(!data.assets.length&&!data.release)throw new Error('No release assets returned.');
    downloadCache={at:Date.now(),data};
    res.set('Cache-Control','public, max-age=600');
    res.json(data);
  }catch(error){
    const data=await fallbackDownloads();
    downloadCache={at:Date.now(),data};
    res.set('Cache-Control','public, max-age=300');
    res.json(data);
  }
});

app.use(express.static(PUBLIC));
function cookieToken(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mc_session='));if(!raw)return '';try{return decodeURIComponent(raw.slice(11))}catch{return ''}}
function authUser(req){const token=cookieToken(req);if(!token)return null;const session=database.findSession(crypto.createHash('sha256').update(token).digest('hex'));return session?Object.values(data.users).find(u=>u.id===session.user_id)||null:null}
function requireAuth(req,res,next){req.minecordUser=authUser(req);if(!req.minecordUser)return res.status(401).json({error:'Please sign in again.'});const ban=bans.activeBan(data,req.minecordUser);if(ban)return res.status(403).json({error:bans.banMessage(ban),code:'account_banned',ban:bans.publicBan(ban)});next()}
function setSession(res,user){const token=crypto.randomBytes(32).toString('base64url'),expires=Date.now()+30*24*60*60*1000;database.createSession(crypto.createHash('sha256').update(token).digest('hex'),user.id,expires);res.cookie('mc_session',token,{httpOnly:true,sameSite:'lax',secure:APP_URL.startsWith('https://'),path:'/',maxAge:expires-Date.now()})}
function localUser(username,password){const salt=crypto.randomBytes(16).toString('hex'),hash=crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex');return {salt,hash}}
function validPassword(password,user){if(!user.passwordHash||!user.passwordSalt)return false;const actual=crypto.scryptSync(password,user.passwordSalt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024}),expected=Buffer.from(user.passwordHash,'hex');return expected.length===actual.length&&crypto.timingSafeEqual(actual,expected)}
function validLocalCredential(password,credential){
 if(!credential?.passwordHash||!credential?.passwordSalt)return false;
 const actual=crypto.scryptSync(password,credential.passwordSalt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 const expected=Buffer.from(credential.passwordHash,'hex');
 return expected.length===actual.length&&crypto.timingSafeEqual(actual,expected)
}
function hasValidPassword(password,user){return [user,...(user.passwordCredentials||[])].some(credential=>validLocalCredential(password,credential))}
function originAllowed(req){return !req.headers.origin||req.headers.origin===new URL(APP_URL).origin}
const loginAttempts=new Map();
const LOGIN_WINDOW_MS=15*60*1000,LOGIN_MAX_FAILURES=10;
function loginAttemptKey(req,username){return `${req.ip||req.socket?.remoteAddress||'unknown'}|${String(username||'').toLowerCase()}`}
function loginRateLimited(key){const entry=loginAttempts.get(key);if(!entry)return false;if(entry.resetAt<=Date.now()){loginAttempts.delete(key);return false}return entry.count>=LOGIN_MAX_FAILURES}
function recordLoginFailure(key){const now=Date.now(),entry=loginAttempts.get(key);if(!entry||entry.resetAt<=now)loginAttempts.set(key,{count:1,resetAt:now+LOGIN_WINDOW_MS});else entry.count++}
function clearLoginFailures(key){loginAttempts.delete(key)}
setInterval(()=>{const now=Date.now();for(const [key,entry] of loginAttempts)if(entry.resetAt<=now)loginAttempts.delete(key)},60*1000).unref();
accountLinks.accountLinkRoutes(app,{data,save,authUser,requireAuth,setSession,appUrl:APP_URL,ownerUserId:APP_OWNER_USER_ID,createId:id,originAllowed,database,activeBan:user=>bans.activeBan(data,user),banMessage:bans.banMessage,bindBrowserToOAuthState:oauthStateCookie.bindBrowserToOAuthState,hasBrowserOAuthState:oauthStateCookie.hasBrowserOAuthState,clearBrowserOAuthState:oauthStateCookie.clearBrowserOAuthState});
accountMerge.ensureMergeState(data);
shopModule.initializeShop(data);
const oauthContext={data,save,authUser,requireAuth,setSession,appUrl:APP_URL,ownerUserId:APP_OWNER_USER_ID,createId:id,originAllowed,database,bindBrowserToOAuthState:oauthStateCookie.bindBrowserToOAuthState,hasBrowserOAuthState:oauthStateCookie.hasBrowserOAuthState,clearBrowserOAuthState:oauthStateCookie.clearBrowserOAuthState,validPassword:hasValidPassword,buildAuthorizationUrl:accountLinks.buildAuthorizationUrl,fetchIdentity:accountLinks.fetchIdentity,invalidateConnections:(userIds,usernames=[])=>{for(const [socket,username] of clients)if(usernames.includes(username)||userIds.includes(data.users[username]?.id))socket.close(1008,'Account merged. Sign in again.')}};
accountMerge.mergeRoutes(app,oauthContext);
games.gamesRoutes(app,{data,save,requireAuth,id,originAllowed,database});
updaterRoutes(app,{data,save,requireAuth,originAllowed,APP_OWNER_USER_ID});
shopModule.shopRoutes(app,{data,save,requireAuth,originAllowed,createId:id,canUseShop:user=>user.id===APP_OWNER_USER_ID||user.role!==roles.ROLES.NEW_MEMBER,hasUnlimitedCredits:user=>user.id===APP_OWNER_USER_ID||user.role===roles.ROLES.APP_OWNER});
bans.banRoutes(app,{data,save,requireAuth,originAllowed,ownerUserId:APP_OWNER_USER_ID,createId:id,database,disconnectUser});
app.post('/api/onboarding/complete',requireAuth,(req,res)=>{
 if(!originAllowed(req))return res.status(403).json({error:'Request origin is not allowed.'});
 if(!roles.can(req.minecordUser,'complete_onboarding',APP_OWNER_USER_ID))return res.status(409).json({error:'Onboarding is already complete.'});
 if(req.body?.acceptedGuidelines!==true)return res.status(400).json({error:'Confirm the community guidelines to finish onboarding.'});
 const displayName=clean(req.body?.displayName,32);
 if(!displayName)return res.status(400).json({error:'Choose a display name to finish onboarding.'});
 req.minecordUser.displayName=displayName;
 const previousRole=req.minecordUser.role||roles.ROLES.NEW_MEMBER;
 req.minecordUser.onboardingCompletedAt=Date.now();
 req.minecordUser.role=roles.ROLES.MEMBER;
 data.roleAudit.push({id:id('role'),accountId:req.minecordUser.id,actorId:req.minecordUser.id,previousRole,newRole:roles.ROLES.MEMBER,createdAt:Date.now()});
 save();
 res.json({user:pub(req.minecordUser)});
});
app.get('/api/config',(_q,r)=>r.json({google:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),microsoft:!!(process.env.MICROSOFT_CLIENT_ID&&process.env.MICROSOFT_CLIENT_SECRET),github:!!(process.env.GITHUB_CLIENT_ID&&process.env.GITHUB_CLIENT_SECRET),localAuth:true,appUrl:APP_URL,apiBaseUrl:APP_URL,websocketUrl:APP_URL.replace(/^https:/,'wss:').replace(/^http:/,'ws:')}));

// Metrics endpoint (admin only)
app.get('/api/metrics', requireAuth, (q, r) => {
  const user = q.minecordUser;
  if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner' && user.role !== 'administrator') {
    return r.status(403).json({error: 'Admin access required'});
  }
  updateCacheGauges(getAllCacheStats());
  updateConnectionGauges(server.listening ? 1 : 0, clients.size, rooms.size, calls.size);
  r.json(metrics.getSummary());
});

// Cache stats endpoint (admin only)
app.get('/api/cache/stats', requireAuth, (q, r) => {
  const user = q.minecordUser;
  if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner' && user.role !== 'administrator') {
    return r.status(403).json({error: 'Admin access required'});
  }
  r.json(getAllCacheStats());
});

// Cache clear endpoint (app owner only)
app.post('/api/cache/clear', requireAuth, (q, r) => {
  const user = q.minecordUser;
  if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner') {
    return r.status(403).json({error: 'App owner access required'});
  }
  userCache.clear();
  serverCache.clear();
  channelCache.clear();
  messageCache.clear();
  friendCache.clear();
  activityCache.clear();
  r.json({ok: true});
});

app.post('/api/auth/register',(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});const username=clean(q.body?.username,24),password=typeof q.body?.password==='string'?q.body.password:'';if(!/^[A-Za-z0-9_]{3,24}$/.test(username))return r.status(400).json({error:'Username must be 3–24 letters, numbers, or underscores.'});if(reservedUsername(username))return r.status(400).json({error:'That username is reserved.'});if(password.length<12||password.length>200)return r.status(400).json({error:'Password must be 12–200 characters.'});if(Object.keys(data.users).some(x=>x.toLowerCase()===username.toLowerCase())||Object.prototype.hasOwnProperty.call(data.mergedUsernames||{},username.toLowerCase()))return r.status(409).json({error:'That username is already taken.'});const credentials=localUser(username,password),user={id:id('usr'),username,displayName:username,avatar:'',minecraft:null,role:roles.ROLES.NEW_MEMBER,onboardingCompletedAt:null,createdAt:Date.now(),passwordSalt:credentials.salt,passwordHash:credentials.hash};data.users[username]=user;save();setSession(r,user);r.status(201).json({user:pub(user)})});
app.post('/api/auth/login',(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});const suppliedUsername=clean(q.body?.username,24),username=Object.prototype.hasOwnProperty.call(data.mergedUsernames||{},suppliedUsername.toLowerCase())?data.mergedUsernames[suppliedUsername.toLowerCase()]:suppliedUsername,password=typeof q.body?.password==='string'?q.body.password:'',attemptKey=loginAttemptKey(q,suppliedUsername);if(loginRateLimited(attemptKey))return r.status(429).json({error:'Too many sign-in attempts. Wait a few minutes and try again.'});const user=Object.values(data.users).find(x=>x.username.toLowerCase()===username.toLowerCase());if(!user||!hasValidPassword(password,user)){recordLoginFailure(attemptKey);return r.status(401).json({error:'Invalid username or password. OAuth-only accounts must use their provider button.'})}const ban=bans.activeBan(data,user);if(ban)return r.status(403).json({error:bans.banMessage(ban),code:'account_banned',ban:bans.publicBan(ban)});clearLoginFailures(attemptKey);setSession(r,user);r.json({user:pub(user)})});
app.get('/api/auth/me',requireAuth,(q,r)=>r.json({user:pub(q.minecordUser)}));
app.post('/api/auth/logout',(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});const token=cookieToken(q);if(token)database.deleteSession(crypto.createHash('sha256').update(token).digest('hex'));r.clearCookie('mc_session',{httpOnly:true,sameSite:'lax',secure:APP_URL.startsWith('https://'),path:'/'});r.json({ok:true})});
app.delete('/api/minecraft/link',requireAuth,(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});q.minecordUser.minecraft=null;save();r.json({ok:true,user:pub(q.minecordUser)})});
app.get('/api/rtc-config',requireAuth,async(q,r)=>{r.set('Cache-Control','no-store');try{return r.json(await meteredTurn.configForUser(q.minecordUser.id))}catch(error){console.error('TURN configuration request failed:',error.message);return r.status(503).json({error:'Voice relay configuration is temporarily unavailable.'})}});
app.get('/api/rtc-usage',requireAuth,async(q,r)=>{r.set('Cache-Control','no-store');try{return r.json(await meteredTurn.usageForUser(q.minecordUser.id))}catch(error){if(error.message==='Metered TURN usage monitoring is not configured.')return r.status(503).json({error:'TURN usage monitoring is not configured on this server.'});if(error.message==='No Metered TURN credential exists for this account yet.')return r.status(404).json({error:'Join voice once to provision a TURN credential before checking usage.'});console.error('TURN usage request failed:',error.message);return r.status(502).json({error:'TURN usage could not be retrieved right now.'})}});

// Invite HTTP routes
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const inviteCreateAttempts = new Map();
function inviteCreateRateLimited(username) {
  const now = Date.now();
  const entry = inviteCreateAttempts.get(username);
  if (!entry || entry.resetAt <= now) {
    inviteCreateAttempts.set(username, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return false;
  }
  if (entry.count >= 20) return true;
  entry.count += 1;
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inviteCreateAttempts) if (entry.resetAt <= now) inviteCreateAttempts.delete(key);
}, 60 * 1000).unref();

function inviteIsUsable(inv) {
  if (!inv || !Number.isFinite(Number(inv.expires)) || Number(inv.expires) < Date.now()) return false;
  if (Number(inv.maxUses) > 0 && Number(inv.uses || 0) >= Number(inv.maxUses)) return false;
  return true;
}
function inviteUrl(code) {
  return APP_URL.replace(/\/+$/, '') + '/invite/' + encodeURIComponent(code);
}
function publicInvite(code, inv) {
  return {
    code,
    serverId: inv.serverId,
    target: inv.target || null,
    createdBy: inv.createdBy,
    createdAt: inv.createdAt || null,
    expires: inv.expires,
    uses: Number(inv.uses || 0),
    maxUses: inv.maxUses == null ? null : Number(inv.maxUses),
    url: inviteUrl(code)
  };
}
function notifyServerMembers(server, payload) {
  for (const member of server.members || []) toUser(member, payload);
}

app.get('/invite/:code', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const code = clean(req.params.code, 80);
  const inv = data.invites[code];
  if (!inviteIsUsable(inv)) return res.status(410).sendFile(path.join(PUBLIC, 'invite-expired.html'));
  const server = data.servers.find(s => s.id === inv.serverId);
  if (!server) return res.status(410).sendFile(path.join(PUBLIC, 'invite-expired.html'));
  const token = cookieToken(req);
  const session = token ? database.findSession(crypto.createHash('sha256').update(token).digest('hex')) : null;
  const user = session ? Object.values(data.users).find(u => u.id === session.user_id) : null;
  if (user) {
    if (server.members?.includes(user.username)) return res.redirect('/app?server=' + encodeURIComponent(server.id));
    return res.sendFile(path.join(PUBLIC, 'invite-accept.html'));
  }
  return res.sendFile(path.join(PUBLIC, 'invite-preview.html'));
});

app.get('/api/invite/preview', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const code = clean(req.query?.code, 80);
  const inv = data.invites[code];
  if (!inviteIsUsable(inv)) return res.status(404).json({ error: 'This invitation has expired, been revoked, or already been used.' });
  const server = data.servers.find(s => s.id === inv.serverId);
  if (!server) return res.status(404).json({ error: 'The server for this invitation no longer exists.' });
  const inviter = data.users[inv.createdBy];
  const viewer = authUser(req);
  res.json({
    server: {
      id: server.id,
      name: server.name,
      icon: server.icon || '',
      memberCount: server.members?.length || 0,
      description: typeof server.description === 'string' ? server.description.slice(0, 300) : ''
    },
    inviter: inviter ? { username: inviter.username, displayName: inviter.displayName || inviter.username, avatar: inviter.avatar || '' } : null,
    expiresAt: inv.expires,
    targeted: Boolean(inv.target),
    targetMismatch: Boolean(inv.target && viewer && inv.target !== viewer.username),
    alreadyMember: Boolean(viewer && server.members?.includes(viewer.username))
  });
});

app.post('/api/invite/create', requireAuth, (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  if (inviteCreateRateLimited(req.minecordUser.username)) return res.status(429).json({ error: 'Too many invitations created. Wait a few minutes and try again.' });
  const serverId = clean(req.body?.serverId);
  const server = data.servers.find(s => s.id === serverId);
  if (!server || !server.members?.includes(req.minecordUser.username)) return res.status(403).json({ error: 'You must be a member of this server to create an invitation.' });
  const code = crypto.randomBytes(18).toString('base64url');
  data.invites[code] = { serverId: server.id, createdBy: req.minecordUser.username, expires: Date.now() + INVITE_TTL_MS, createdAt: Date.now(), uses: 0, maxUses: null };
  save();
  res.json({ ok: true, code, url: inviteUrl(code), expiresAt: data.invites[code].expires });
});

app.get('/api/invite/list', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const serverId = clean(req.query?.serverId);
  const server = data.servers.find(s => s.id === serverId);
  if (!server || !server.members?.includes(req.minecordUser.username)) return res.status(403).json({ error: 'You must be a member of this server to view invitations.' });
  const canSeeAll = server.owner === req.minecordUser.username || req.minecordUser.id === APP_OWNER_USER_ID;
  const invites = Object.entries(data.invites)
    .filter(([, inv]) => inv.serverId === server.id && inviteIsUsable(inv) && (canSeeAll || inv.createdBy === req.minecordUser.username))
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .map(([code, inv]) => publicInvite(code, inv));
  res.json({ invites });
});

app.post('/api/invite/accept', requireAuth, (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  const code = clean(req.body?.code, 80);
  const inv = data.invites[code];
  if (!inviteIsUsable(inv)) return res.status(404).json({ error: 'This invitation has expired, been revoked, or already been used.' });
  const server = data.servers.find(s => s.id === inv.serverId);
  if (!server) return res.status(404).json({ error: 'The server for this invitation no longer exists.' });
  if (inv.target && inv.target !== req.minecordUser.username) return res.status(403).json({ error: 'This invitation was sent to a different MINECORD account.' });
  if (server.members?.includes(req.minecordUser.username)) return res.json({ ok: true, alreadyMember: true, server: { id: server.id, name: server.name } });
  server.members ??= [];
  server.members.push(req.minecordUser.username);
  inv.uses = Number(inv.uses || 0) + 1;
  if (Number(inv.maxUses) > 0 && inv.uses >= Number(inv.maxUses)) delete data.invites[code];
  save();
  notifyServerMembers(server, { type: 'server_member_joined', serverId: server.id, username: req.minecordUser.username });
  res.json({ ok: true, server: { id: server.id, name: server.name } });
});

app.post('/api/invite/decline', requireAuth, (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  const code = clean(req.body?.code, 80);
  const inv = data.invites[code];
  if (!inv) return res.json({ ok: true });
  if (inv.target && inv.target !== req.minecordUser.username && inv.createdBy !== req.minecordUser.username && req.minecordUser.id !== APP_OWNER_USER_ID) {
    return res.status(403).json({ error: 'You cannot decline this invitation.' });
  }
  const createdBy = inv.createdBy;
  delete data.invites[code];
  save();
  if (createdBy && createdBy !== req.minecordUser.username) toUser(createdBy, { type: 'friend_invite_declined', code, by: req.minecordUser.username });
  res.json({ ok: true });
});

app.post('/api/invite/revoke', requireAuth, (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  const code = clean(req.body?.code, 80);
  const inv = data.invites[code];
  if (!inv) return res.json({ ok: true, alreadyRevoked: true });
  const server = data.servers.find(s => s.id === inv.serverId);
  const canRevoke = inv.createdBy === req.minecordUser.username || req.minecordUser.id === APP_OWNER_USER_ID || (server && server.owner === req.minecordUser.username);
  if (!canRevoke) return res.status(403).json({ error: 'Only the person who created this invitation, the server owner, or the app owner can revoke it.' });
  delete data.invites[code];
  save();
  res.json({ ok: true });
});

app.post('/api/invite/friend', requireAuth, (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  if (inviteCreateRateLimited(req.minecordUser.username)) return res.status(429).json({ error: 'Too many invitations created. Wait a few minutes and try again.' });
  const targetRaw = clean(req.body?.target, 32);
  const target = Object.keys(data.users).find(name => name.toLowerCase() === targetRaw.toLowerCase());
  const serverId = clean(req.body?.serverId);
  if (!targetRaw || !serverId) return res.status(400).json({ error: 'Choose a friend and a server.' });
  if (!target) return res.status(404).json({ error: 'That MINECORD user does not exist.' });
  if (target === req.minecordUser.username) return res.status(400).json({ error: 'You cannot invite yourself.' });
  if (!isAcceptedFriend(req.minecordUser.username, target)) return res.status(403).json({ error: 'You can only invite accepted friends.' });
  const server = data.servers.find(s => s.id === serverId);
  if (!server || !server.members?.includes(req.minecordUser.username)) return res.status(403).json({ error: 'You must be a member of this server to invite people.' });
  if (server.members.includes(target)) return res.status(400).json({ error: target + ' is already a member of this server.' });
  const duplicate = Object.values(data.invites).find(inv => inviteIsUsable(inv) && inv.serverId === server.id && inv.target === target && inv.createdBy === req.minecordUser.username);
  if (duplicate) return res.status(409).json({ error: 'You already have a pending invitation for ' + target + '.' });
  const code = crypto.randomBytes(18).toString('base64url');
  data.invites[code] = { serverId: server.id, createdBy: req.minecordUser.username, target, expires: Date.now() + INVITE_TTL_MS, createdAt: Date.now(), uses: 0, maxUses: 1 };
  save();
  toUser(target, { type: 'friend_invite', code, serverId: server.id, serverName: server.name, from: req.minecordUser.username, url: inviteUrl(code) });
  res.json({ ok: true, code, url: inviteUrl(code), serverId: server.id, target, expiresAt: data.invites[code].expires });
});

function activityFor(username){const entries=data.gameActivities[username]||{};let latest=null;for(const [game,item] of Object.entries(entries)){const timeout=game==='eaglercraft'?90000:35000;if(Date.now()-item.lastSeenAt>timeout){delete entries[game];continue}if(!latest||item.lastSeenAt>latest.lastSeenAt)latest={game,active:true,startedAt:item.startedAt,lastSeenAt:item.lastSeenAt,playerName:item.playerName||null,serverName:item.serverName||null}}if(!Object.keys(entries).length)delete data.gameActivities[username];if(latest)return latest;const user=data.users[username];return user&&user.showGameActivity!==false&&database.hasActivityConnector(user.id)?{game:'eaglercraft',active:false,startedAt:null,lastSeenAt:null}:null}
function activityPresenceFor(username){return activityFor(username)}
function canViewActivity(viewer,subject){return viewer===subject||Object.values(data.friends).some(f=>f.status==='accepted'&&((f.a===viewer&&f.b===subject)||(f.b===viewer&&f.a===subject)))}
function dmPeersFor(username){const peers=new Set();for(const friendship of Object.values(data.friends))if(friendship.status==='accepted'&&(friendship.a===username||friendship.b===username))peers.add(friendship.a===username?friendship.b:friendship.a);for(const scope of Object.keys(data.messages))if(scope.startsWith('dm:')){const pairNames=scope.slice(3).split('::');if(pairNames.length===2&&pairNames.includes(username)){const peer=pairNames[0]===username?pairNames[1]:pairNames[0];if(data.users[peer])peers.add(peer)}}return [...peers].sort((a,b)=>a.localeCompare(b))}
function dmUnreadCount(username,peer){const conversation=`dm:${pair(username,peer)}`,messages=data.messages[conversation]||[],cursor=data.dmRead?.[username]?.[conversation];let start=0;if(cursor){const index=messages.findIndex(message=>message.id===cursor);if(index>=0)start=index+1}return messages.slice(start).filter(message=>message.from!==username).length}
function dmUnreadSummary(username){return Object.fromEntries(dmPeersFor(username).map(peer=>[peer,dmUnreadCount(username,peer)]).filter(([,count])=>count>0))}
function decorateMessages(messages){return messages.map(message=>({...message,role:data.users[message.from]?.role||roles.ROLES.MEMBER}))}
function sendReady(ws,username){const dmPeers=dmPeersFor(username),friends=Object.values(data.friends).filter(friend=>friend.status==='accepted'&&(friend.a===username||friend.b===username)).map(friend=>friend.a===username?friend.b:friend.a).filter(name=>data.users[name]).sort((a,b)=>a.localeCompare(b)),visibleUsers=[...new Set([...clients.values(),...friends])].filter(name=>name===username||isAcceptedFriend(username,name));send(ws,{type:'ready',me:pub(data.users[username]),servers:data.servers.filter(server=>server.members?.includes(username)),online:onlineFor(username),members:Object.fromEntries(visibleUsers.map(name=>[name,pub(data.users[name])])),friends,activities:Object.fromEntries([...new Set(clients.values())].filter(name=>canViewActivity(username,name)).map(name=>[name,activityFor(name)]).filter(([,activity])=>activity)),pendingInvites:Object.entries(data.invites).filter(([,inv])=>inviteIsUsable(inv)&&inv.target===username).map(([code,inv])=>{const s=data.servers.find(x=>x.id===inv.serverId);return{code,serverId:inv.serverId,serverName:s?.name||'Server',from:inv.createdBy,expires:inv.expires}}),dmPeers,dmUnread:dmUnreadSummary(username),pendingFriendRequests:Object.values(data.friends).filter(friend=>friend.status==='pending'&&friend.b===username).map(friend=>friend.a),dmLastMessages:Object.fromEntries(dmPeers.map(peer=>{const messages=data.messages[`dm:${pair(username,peer)}`]||[];return[peer,messages[messages.length-1]||null]}))})}
function broadcastActivity(username){const activity=activityPresenceFor(username);for(const [client,viewer] of clients)if(canViewActivity(viewer,username))send(client,{type:'activity_update',username,activity})}
function updateActivity(username,game,active,details={}){if(!data.gameActivities[username])data.gameActivities[username]={};if(!active){delete data.gameActivities[username][game];if(!Object.keys(data.gameActivities[username]).length)delete data.gameActivities[username]}else{const previous=data.gameActivities[username][game],now=Date.now();data.gameActivities[username][game]={startedAt:previous?.startedAt||now,lastSeenAt:now,source:game,playerName:details.playerName||null,serverName:details.serverName||null}}save();broadcastActivity(username)}
const GAME_NAMES={java:'Minecraft Java',bedrock:'Minecraft Bedrock',eaglercraft:'Eaglercraft'};
app.post('/api/activity/pairing',requireAuth,(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});const code=crypto.randomBytes(24).toString('base64url');database.createActivityPairing(crypto.createHash('sha256').update(code).digest('hex'),q.minecordUser.id,Date.now()+5*60*1000);r.json({code,expiresIn:300})});
app.post('/api/integrations/eaglercraft/claim',(q,r)=>{const code=typeof q.body?.code==='string'?q.body.code:'';if(code.length<20||code.length>100)return r.status(400).json({error:'Invalid or expired pairing code.'});const token=crypto.randomBytes(32).toString('base64url'),userId=database.claimActivityPairing(crypto.createHash('sha256').update(code).digest('hex'),crypto.createHash('sha256').update(token).digest('hex'));if(!userId)return r.status(400).json({error:'Invalid or expired pairing code.'});r.json({token})});
app.post('/api/integrations/eaglercraft/presence',(q,r)=>{const auth=String(q.get('X-Minecord-Activity-Token')||q.get('Authorization')||''),token=auth.startsWith('Bearer ')?auth.slice(7):auth,match=database.findActivityConnector(crypto.createHash('sha256').update(token).digest('hex'));if(!match)return r.status(401).json({error:'Activity connector is not paired.'});const user=Object.values(data.users).find(u=>u.id===match.user_id);if(!user)return r.status(401).json({error:'Activity account no longer exists.'});if(bans.activeBan(data,user))return r.status(403).json({error:'Activity account is banned.'});if(typeof q.body?.active!=='boolean')return r.status(400).json({error:'Activity state must be boolean.'});if(user.showGameActivity===false){updateActivity(user.username,'eaglercraft',false);return r.json({ok:true,disabled:true})}updateActivity(user.username,'eaglercraft',q.body.active);r.json({ok:true})});
app.post('/api/integrations/eaglercraft/unpair',(q,r)=>{const auth=String(q.get('X-Minecord-Activity-Token')||''),userId=database.revokeActivityToken(crypto.createHash('sha256').update(auth).digest('hex'));if(!userId)return r.status(401).json({error:'Activity connector is not paired.'});const user=Object.values(data.users).find(u=>u.id===userId);if(user)updateActivity(user.username,'eaglercraft',false);r.json({ok:true})});
app.post('/api/activity/pairing/revoke',requireAuth,(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});database.revokeActivityConnector(q.minecordUser.id);updateActivity(q.minecordUser.username,'eaglercraft',false);r.json({ok:true})});
setInterval(()=>{for(const username of Object.keys(data.gameActivities)){const before=Object.keys(data.gameActivities[username]).length;const activity=activityFor(username);if(Object.keys(data.gameActivities[username]||{}).length!==before){save();broadcastActivity(username)}else if(!activity&&data.gameActivities[username]){delete data.gameActivities[username];save();broadcastActivity(username)}}},10000).unref();
app.post('/api/activity/presence',requireAuth,(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});const game=q.body?.game,active=q.body?.active;if(!['java','bedrock'].includes(game)||typeof active!=='boolean')return r.status(400).json({error:'Unsupported activity update.'});if(q.minecordUser.showGameActivity===false){updateActivity(q.minecordUser.username,game,false);return r.json({ok:true,disabled:true})}updateActivity(q.minecordUser.username,game,active);r.json({ok:true})});
app.post('/api/activity/settings',requireAuth,(q,r)=>{if(!originAllowed(q))return r.status(403).json({error:'Request origin is not allowed.'});if(typeof q.body?.enabled!=='boolean')return r.status(400).json({error:'Activity setting must be boolean.'});q.minecordUser.showGameActivity=q.body.enabled;if(!q.body.enabled){delete data.gameActivities[q.minecordUser.username];database.revokeActivityConnector(q.minecordUser.id)}save();broadcastActivity(q.minecordUser.username);r.json({enabled:q.body.enabled})});
function oauthStart(provider, req, res) {
  const google = provider === 'google', github = provider === 'github', prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`], secret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !secret) return res.status(503).send(`${provider} sign-in is not configured on this MINECORD server.`);
  const state = crypto.randomBytes(24).toString('hex'), createdAt = Date.now();
  const returnTo = req.query.returnTo ? accountLinks.safeAppReturnTo(req.query.returnTo) : '/app?oauth=success';
  database.createOAuthState(state, { provider, returnTo, createdAt }, createdAt + 10 * 60 * 1000);
  oauthStateCookie.bindBrowserToOAuthState(res, provider, state, APP_URL);
  const redirect = encodeURIComponent(process.env[`${prefix}_CALLBACK_URL`] || `${APP_URL}/auth/${provider}/callback`);
  let url;
  if (google) {
    url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${redirect}&response_type=code&scope=${encodeURIComponent('openid email profile')}&state=${state}&access_type=offline&prompt=select_account`;
  } else if (github) {
    url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${decodeURIComponent(redirect)}&scope=read:user user:email&state=${state}`;
  } else {
    url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${redirect}&response_type=code&scope=${encodeURIComponent('openid email profile User.Read')}&state=${state}`;
  }
  res.redirect(url);
}
for (const provider of ['google', 'microsoft', 'github']) {
  app.get(`/auth/${provider}`, (req, res) => oauthStart(provider, req, res));
}
function saveOAuthState(key,value){database.createOAuthState(key,value,value.createdAt+10*60*1000)}
function microsoftCallbackUrl(){return process.env.MICROSOFT_CALLBACK_URL||`${APP_URL}/auth/microsoft/callback`}
app.get('/auth/minecraft/link',requireAuth,(q,r)=>{const clientId=process.env.MICROSOFT_CLIENT_ID,clientSecret=process.env.MICROSOFT_CLIENT_SECRET;if(!clientId||!clientSecret)return r.status(503).send('Microsoft sign-in is not configured on this MINECORD server.');const state=crypto.randomBytes(24).toString('hex'),returnTo=accountLinks.safeAppReturnTo(q.query.returnTo);saveOAuthState(state,{provider:'microsoft',purpose:'minecraft-link',userId:q.minecordUser.id,returnTo,createdAt:Date.now()});oauthStateCookie.bindBrowserToOAuthState(r,'microsoft',state,APP_URL);const authorize=new URL('https://login.live.com/oauth20_authorize.srf');authorize.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:microsoftCallbackUrl(),scope:'XboxLive.signin offline_access',state}).toString();r.redirect(authorize.toString())});

// Bedrock (Xbox) account linking - mirrors Java linking but retrieves Xbox profile
app.get('/auth/bedrock/link',requireAuth,(q,r)=>{const clientId=process.env.MICROSOFT_CLIENT_ID,clientSecret=process.env.MICROSOFT_CLIENT_SECRET;if(!clientId||!clientSecret)return r.status(503).send('Microsoft sign-in is not configured on this MINECORD server.');const state=crypto.randomBytes(24).toString('hex'),returnTo=accountLinks.safeAppReturnTo(q.query.returnTo);saveOAuthState(state,{provider:'microsoft',purpose:'bedrock-link',userId:q.minecordUser.id,returnTo,createdAt:Date.now()});oauthStateCookie.bindBrowserToOAuthState(r,'microsoft',state,APP_URL);const authorize=new URL('https://login.live.com/oauth20_authorize.srf');authorize.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:microsoftCallbackUrl(),scope:'XboxLive.signin offline_access',state}).toString();r.redirect(authorize.toString())});
async function microsoftJson(url,options){const response=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});let result;try{result=await response.json()}catch{throw new Error('The identity service returned an invalid response.')}if(!response.ok){if(response.status===404&&url.endsWith('/minecraft/profile'))throw new Error('No Minecraft Java profile found.');throw new Error('The identity service rejected the authorization.')}return result}
async function finishMinecraftLink(code){const token=await microsoftJson('https://login.live.com/oauth20_token.srf',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.MICROSOFT_CLIENT_ID,client_secret:process.env.MICROSOFT_CLIENT_SECRET,code,redirect_uri:microsoftCallbackUrl(),grant_type:'authorization_code',scope:'XboxLive.signin offline_access'})});if(typeof token.access_token!=='string')throw new Error('Microsoft did not return an access token.');
 const xbox=await microsoftJson('https://user.auth.xboxlive.com/user/authenticate',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({Properties:{AuthMethod:'RPS',SiteName:'user.auth.xboxlive.com',RpsTicket:`d=${token.access_token}`},RelyingParty:'http://auth.xboxlive.com',TokenType:'JWT'})});if(typeof xbox.Token!=='string')throw new Error('Xbox authentication failed.');
 const xsts=await microsoftJson('https://xsts.auth.xboxlive.com/xsts/authorize',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({Properties:{SandboxId:'RETAIL',UserTokens:[xbox.Token]},RelyingParty:'rp://api.minecraftservices.com/',TokenType:'JWT'})});const userHash=xsts.DisplayClaims?.xui?.[0]?.uhs;if(typeof xsts.Token!=='string'||typeof userHash!=='string')throw new Error('Xbox security authorization failed.');
 const minecraft=await microsoftJson('https://api.minecraftservices.com/authentication/login_with_xbox',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({identityToken:`XBL3.0 x=${userHash};${xsts.Token}`})});if(typeof minecraft.access_token!=='string')throw new Error('Minecraft Services did not authorize this account.');
 const profile=await microsoftJson('https://api.minecraftservices.com/minecraft/profile',{headers:{Authorization:`Bearer ${minecraft.access_token}`,Accept:'application/json'}});if(typeof profile.id!=='string'||!/^[a-f0-9]{32}$/i.test(profile.id)||typeof profile.name!=='string'||!/^[A-Za-z0-9_]{1,16}$/.test(profile.name))throw new Error('Minecraft Services returned an invalid profile.');
 return {username:profile.name,uuid:profile.id.toLowerCase(),edition:'Java',linkedAt:Date.now(),source:'minecraft-services'}}
async function finishBedrockLink(code){const token=await microsoftJson('https://login.live.com/oauth20_token.srf',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.MICROSOFT_CLIENT_ID,client_secret:process.env.MICROSOFT_CLIENT_SECRET,code,redirect_uri:microsoftCallbackUrl(),grant_type:'authorization_code',scope:'XboxLive.signin offline_access'})});if(typeof token.access_token!=='string')throw new Error('Microsoft did not return an access token.');
  const xbox=await microsoftJson('https://user.auth.xboxlive.com/user/authenticate',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({Properties:{AuthMethod:'RPS',SiteName:'user.auth.xboxlive.com',RpsTicket:'d=' + token.access_token},RelyingParty:'http://auth.xboxlive.com',TokenType:'JWT'})});if(typeof xbox.Token!=='string')throw new Error('Xbox authentication failed.');
  const xsts=await microsoftJson('https://xsts.auth.xboxlive.com/xsts/authorize',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({Properties:{SandboxId:'RETAIL',UserTokens:[xbox.Token]},RelyingParty:'http://xboxlive.com',TokenType:'JWT'})});const xuid=xsts.DisplayClaims?.xui?.[0]?.xid;if(typeof xsts.Token!=='string'||typeof xuid!=='string'||!/^\d{16}$/.test(xuid))throw new Error('Xbox security authorization failed or XUID not found.');
  const profile=await microsoftJson('https://profile.xboxlive.com/users/me/profile/settings',{headers:{Authorization:'Bearer ' + xsts.Token,Accept:'application/json'}});let gamertag=null;if(profile?.profileSettings){const g=profile.profileSettings.find(s=>s.id==='Gamertag');if(g)gamertag=g.value}if(!gamertag||typeof gamertag!=='string')throw new Error('Could not retrieve Xbox gamertag.');
  return {username:gamertag,xuid:xuid,edition:'Bedrock',linkedAt:Date.now(),source:'xbox-profile'}}

app.get('/auth/microsoft/callback',async(q,r)=>{
  const stateKey=typeof q.query.state==='string'?q.query.state:'';
  const pendingState=database.getOAuthState(stateKey);
  const fallbackError=message=>r.redirect(`/app?auth_error=${encodeURIComponent(message)}`);
  if(!stateKey||!pendingState||pendingState.provider!=='microsoft'){
    return r.status(400).send('Microsoft sign-in state is invalid or expired. Please try again.');
  }
  if(!oauthStateCookie.hasBrowserOAuthState(q,'microsoft',stateKey)){
    oauthStateCookie.clearBrowserOAuthState(r,'microsoft',APP_URL);
    return r.status(400).send('Microsoft sign-in state is invalid or expired. Please restart sign-in.');
  }
  const state=database.consumeOAuthState(stateKey,'microsoft');
  if(!state)return r.status(400).send('Microsoft sign-in state is invalid or expired. Please try again.');
  oauthStateCookie.clearBrowserOAuthState(r,'microsoft',APP_URL);
  if(state.purpose==='account-link'||state.purpose?.startsWith('merge-'))return r.status(400).send('OAuth state is invalid or expired. Please retry sign-in.');
  const linkPurpose=state.purpose==='minecraft-link'?'minecraft':state.purpose==='bedrock-link'?'bedrock':null;
  const returnTo=accountLinks.safeAppReturnTo(state.returnTo||'/app');
  const redirectResult=(key,value)=>{
    const target=new URL(returnTo,APP_URL);
    for(const name of ['minecraft_link','minecraft_link_error','bedrock_link','bedrock_link_error','auth_error'])target.searchParams.delete(name);
    target.searchParams.set(key,value);
    return r.redirect(`${target.pathname}${target.search}${target.hash}`);
  };
  if(q.query.error)return linkPurpose?redirectResult(`${linkPurpose}_link_error`,q.query.error==='access_denied'?'cancelled':'authorization_failed'):redirectResult('auth_error','Microsoft sign-in was not completed.');
  if(typeof q.query.code!=='string'||!q.query.code)return linkPurpose?redirectResult(`${linkPurpose}_link_error`,'missing_code'):redirectResult('auth_error','Microsoft did not return an authorization code.');
  if(state.purpose==='minecraft-link'){
    const authenticated=authUser(q);
    if(!authenticated||authenticated.id!==state.userId)return r.status(401).send('Sign in to the same MINECORD account before linking Minecraft.');
    try{
      const profile=await finishMinecraftLink(q.query.code);
      const duplicate=Object.values(data.users).some(user=>user.id!==authenticated.id&&user.minecraft?.uuid===profile.uuid);
      if(duplicate)return redirectResult('minecraft_link_error','already_linked');
      authenticated.minecraft=profile;save();
      return redirectResult('minecraft_link','success');
    }catch(error){
      const reason=error.message==='No Minecraft Java profile found.'?'no_profile':error.message==='The identity service rejected the authorization.'?'authorization_failed':error.message.includes('invalid response')?'service_error':'link_failed';
      return redirectResult('minecraft_link_error',reason);
    }
  }
  if(state.purpose==='bedrock-link'){
    const authenticated=authUser(q);
    if(!authenticated||authenticated.id!==state.userId)return r.status(401).send('Sign in to the same MINECORD account before linking Bedrock.');
    try{
      const profile=await finishBedrockLink(q.query.code);
      const duplicate=Object.values(data.users).some(user=>user.id!==authenticated.id&&user.gameAccounts?.some(ga=>ga.edition==='bedrock'&&ga.xuid===profile.xuid));
      if(duplicate)return redirectResult('bedrock_link_error','already_linked');
      authenticated.gameAccounts=authenticated.gameAccounts||[];
      authenticated.gameAccounts=authenticated.gameAccounts.filter(ga=>ga.edition!=='bedrock');
      authenticated.gameAccounts.push({edition:'bedrock',username:profile.username,xuid:profile.xuid,linkedAt:profile.linkedAt,rawData:JSON.stringify({source:profile.source,verified:true})});
      save();
      return redirectResult('bedrock_link','success');
    }catch(error){
      const reason=error.message.includes('XUID not found')?'no_xuid':error.message.includes('gamertag')?'no_gamertag':error.message.includes('invalid response')?'service_error':'link_failed';
      return redirectResult('bedrock_link_error',reason);
    }
  }
  return redirectResult('auth_error','Microsoft sign-in could not be completed.');
});

app.use('/auth/:provider/callback',(_q,r)=>r.status(400).send('OAuth state is invalid or expired. Please restart sign-in.'));
const clients=new Map(),rooms=new Map(),calls=new Map();
wss.on('connection',(ws,req)=>{const authenticated=authUser(req);if(!authenticated){ws.close(1008,'Sign in required.');return}const ban=bans.activeBan(data,authenticated);if(ban){ws.close(1008,bans.banMessage(ban));return}const username=authenticated.username;clients.set(ws,username);sendReady(ws,username);broadcastPresence();ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(!m||typeof m!=='object'||Array.isArray(m))return;if(m.type==='hello'){return sendReady(ws,username)}if(!username)return;const me=data.users[username];
  const wsTimer = process.hrtime.bigint();
if(m.type==='profile'){const avatar=m.avatar===undefined?(me.avatar||''):cleanAvatar(m.avatar);if(avatar===null)return send(ws,{type:'error',message:'Avatar must be a valid HTTPS image URL without embedded credentials.'});me.displayName=clean(m.displayName,32)||username;me.avatar=avatar;save();const profile=pub(me);send(ws,{type:'profile',me:profile});for(const [client,viewer] of clients)if(viewer!==username&&isAcceptedFriend(viewer,username))send(client,{type:'friend_profile',user:profile});return}
if(m.type==='create_server'){const s={id:id('srv'),name:clean(m.name,32)||'New Server',icon:'',owner:username,members:[username],channels:[{id:'general',name:'general',type:'text'},{id:'voice',name:'Voice',type:'voice'}]};data.servers.push(s);save();return send(ws,{type:'server_created',server:s})}
if(m.type==='join_server'){const s=data.servers.find(x=>x.id===m.serverId);if(!s||!s.members?.includes(username))return send(ws,{type:'error',message:'Join this server with a valid invitation.'});return send(ws,{type:'server_joined',server:s})}
if(m.type==='create_channel'){const s=data.servers.find(x=>x.id===m.serverId);if(!s||!s.members.includes(username))return;const name=clean(m.name,24).toLowerCase().replace(/[^a-z0-9-_ ]/g,'')||'channel';if(s.channels.some(c=>c.name.toLowerCase()===name))return send(ws,{type:'error',message:`A channel named "${name}" already exists.`});const ch={id:id('ch'),name,type:m.channelType==='voice'?'voice':'text'};s.channels.push(ch);save();return toServerMembers(s.id,{type:'channel_created',serverId:s.id,channel:ch})}
if(m.type==='history'){const scope=clean(m.scope,120);if(!channelForUser(username,scope))return send(ws,{type:'error',message:'You do not have access to that channel.'});return send(ws,{type:'history',scope,messages:decorateMessages(data.messages[scope]||[])})}
if(m.type==='message'){const scope=clean(m.scope,120),text=clean(m.text,2000);if(!scope||!text)return;if(!channelForUser(username,scope,'text'))return send(ws,{type:'error',message:'You do not have permission to post in that channel.'});const item={id:id('msg'),from:username,text,at:Date.now(),role:me.role||roles.ROLES.MEMBER};data.messages[scope]??=[];data.messages[scope].push(item);save();const serverId=scope.slice(0,scope.indexOf(':'));return toServerMembers(serverId,{type:'message',scope,item})}
if(m.type==='dm_history'){const other=clean(m.username,32);if(!canAccessDM(username,other))return send(ws,{type:'error',message:'Direct messages are available to accepted friends and existing conversation participants.'});const s='dm:'+pair(username,other);return send(ws,{type:'dm_history',username:other,messages:decorateMessages(data.messages[s]||[])})}
if(m.type==='dm_read'){const other=clean(m.username,32);if(!canAccessDM(username,other))return;const conversation='dm:'+pair(username,other),messages=data.messages[conversation]||[],cursor=messages[messages.length-1]?.id;if(cursor){data.dmRead[username]??={};data.dmRead[username][conversation]=cursor;save()}toUser(username,{type:'dm_unread',username:other,count:0});return}
if(m.type==='dm'){const to=clean(m.to,32),text=clean(m.text,2000);if(!data.users[to]||to===username||!text)return;if(!isAcceptedFriend(username,to))return send(ws,{type:'error',message:'You can message accepted friends only.'});const s='dm:'+pair(username,to),item={id:id('dm'),from:username,to,text,at:Date.now(),role:me.role||roles.ROLES.MEMBER};data.messages[s]??=[];data.messages[s].push(item);save();send(ws,{type:'dm',message:item});toUser(to,{type:'dm',message:item,unread:dmUnreadCount(to,username)});return}
if(m.type==='friend_request'){const toRaw=clean(m.to,32);if(toRaw===username)return send(ws,{type:'error',message:'You cannot add yourself as a friend.'});const toLower=toRaw.toLowerCase();const toActual=Object.keys(data.users).find(u=>u.toLowerCase()===toLower);if(!toActual)return send(ws,{type:'error',message:'User not found. Check the username and try again.'});const to=toActual;const k=pair(username,to);if(data.friends[k])return send(ws,{type:'error',message:data.friends[k].status==='pending'?'Friend request already sent.':data.friends[k].status==='accepted'?'Already friends.':'Friend request already exists.'});data.friends[k]={a:username,b:to,status:'pending',by:username};save();toUser(to,{type:'friend_request',from:username});return send(ws,{type:'friend_status',user:to,status:'pending'})}
if(m.type==='friend_accept'){const other=clean(m.with,32),k=pair(username,other),friendship=data.friends[k];if(friendship?.status==='pending'&&friendship.by!==username){friendship.status='accepted';save();toUser(other,{type:'friend_status',user:username,status:'accepted'});send(ws,{type:'friend_status',user:other,status:'accepted'});broadcastActivity(username);broadcastActivity(other);broadcastPresence()}return}
if(m.type==='friend_reject'){const other=clean(m.with,32),k=pair(username,other),friendship=data.friends[k];if(friendship?.status==='pending'&&friendship.b===username){delete data.friends[k];save();toUser(friendship.a,{type:'friend_status',user:username,status:'rejected'});send(ws,{type:'friend_status',user:friendship.a,status:'rejected'})}return}
if(m.type==='friend_remove'){const other=clean(m.with,32),k=pair(username,other),friendship=data.friends[k];if(friendship?.status==='accepted'&&(friendship.a===username||friendship.b===username)){delete data.friends[k];save();toUser(other,{type:'friend_status',user:username,status:'removed'});send(ws,{type:'friend_status',user:other,status:'removed'});broadcastPresence()}return}
if(m.type==='friend_invite'){const targetRaw=clean(m.to,32),target=Object.keys(data.users).find(name=>name.toLowerCase()===targetRaw.toLowerCase()),serverId=clean(m.serverId);if(!targetRaw||!serverId)return send(ws,{type:'error',message:'Target and server required.'});if(!target)return send(ws,{type:'error',message:'User not found.'});if(target===username)return send(ws,{type:'error',message:'You cannot invite yourself.'});const k=pair(username,target),friendship=data.friends[k];if(!friendship||friendship.status!=='accepted')return send(ws,{type:'error',message:'You can only invite accepted friends.'});const s=data.servers.find(x=>x.id===serverId);if(!s||!s.members.includes(username))return send(ws,{type:'error',message:'You are not a member of this server.'});if(s.members.includes(target))return send(ws,{type:'error',message:'User is already a member of this server.'});const existing=Object.entries(data.invites).find(([,inv])=>inviteIsUsable(inv)&&inv.serverId===s.id&&inv.target===target&&inv.createdBy===username);if(existing)return send(ws,{type:'friend_invite_sent',code:existing[0],serverId:s.id,target,existing:true});const code=crypto.randomBytes(18).toString('base64url');data.invites[code]={serverId:s.id,createdBy:username,target,expires:Date.now()+INVITE_TTL_MS,createdAt:Date.now(),uses:0,maxUses:1};save();toUser(target,{type:'friend_invite',code,serverId:s.id,serverName:s.name,from:username,url:inviteUrl(code)});return send(ws,{type:'friend_invite_sent',code,serverId:s.id,target,url:inviteUrl(code)})}
if(m.type==='friend_invite_accept'){const code=clean(m.code,80);const inv=data.invites[code];if(!inviteIsUsable(inv))return send(ws,{type:'error',message:'Invite expired or invalid.'});if(inv.target&&inv.target!==username)return send(ws,{type:'error',message:'This invitation was sent to a different account.'});const s=data.servers.find(x=>x.id===inv.serverId);if(!s)return send(ws,{type:'error',message:'The server for this invitation no longer exists.'});if(!s.members.includes(username))s.members.push(username);inv.uses=Number(inv.uses||0)+1;if(Number(inv.maxUses)>0&&inv.uses>=Number(inv.maxUses))delete data.invites[code];save();notifyServerMembers(s,{type:'server_member_joined',serverId:s.id,username});return send(ws,{type:'server_joined',server:s})}
if(m.type==='friend_invite_decline'){const code=clean(m.code,80);const inv=data.invites[code];if(!inv)return send(ws,{type:'friend_invite_declined',code});if(inv.target&&inv.target!==username&&inv.createdBy!==username)return send(ws,{type:'error',message:'You cannot decline this invitation.'});const createdBy=inv.createdBy;delete data.invites[code];save();if(createdBy!==username)toUser(createdBy,{type:'friend_invite_declined',code,by:username});return send(ws,{type:'friend_invite_declined',code})}
if(m.type==='invite_create'){const s=data.servers.find(x=>x.id===clean(m.serverId));if(!s||!s.members.includes(username))return send(ws,{type:'error',message:'You must be a member of this server to create an invitation.'});const code=crypto.randomBytes(18).toString('base64url');data.invites[code]={serverId:s.id,createdBy:username,expires:Date.now()+INVITE_TTL_MS,createdAt:Date.now(),uses:0,maxUses:null};save();return send(ws,{type:'invite',code,serverId:s.id,url:inviteUrl(code)})}
if(m.type==='invite_join'){const code=clean(m.code,80),inv=data.invites[code];if(!inviteIsUsable(inv))return send(ws,{type:'error',message:'Invite expired or invalid.'});if(inv.target&&inv.target!==username)return send(ws,{type:'error',message:'This invitation was sent to a different account.'});const s=data.servers.find(x=>x.id===inv.serverId);if(!s)return send(ws,{type:'error',message:'The server for this invitation no longer exists.'});if(!s.members.includes(username))s.members.push(username);inv.uses=Number(inv.uses||0)+1;if(Number(inv.maxUses)>0&&inv.uses>=Number(inv.maxUses))delete data.invites[code];save();notifyServerMembers(s,{type:'server_member_joined',serverId:s.id,username});return send(ws,{type:'server_joined',server:s})}
if(m.type==='voice_join'){const room=clean(m.room,120);if(!channelForUser(username,room,'voice'))return send(ws,{type:'error',message:'You do not have access to that voice channel.'});if(!rooms.has(room))rooms.set(room,new Set());const set=rooms.get(room);if(set.has(username)){for(const [c,u] of clients)if(u!==username&&set.has(u))send(c,{type:'voice_peer_rejoined',room,peer:username});return send(ws,{type:'voice_members',room,members:[...set]})}set.add(username);for(const [c,u] of clients)if(u!==username&&set.has(u))send(c,{type:'voice_peer_joined',room,peer:username});return send(ws,{type:'voice_members',room,members:[...set]})}
if(m.type==='voice_leave'){const room=clean(m.room,120),set=rooms.get(room);if(set?.delete(username)){for(const [c,u] of clients)if(set.has(u))send(c,{type:'voice_peer_left',room,peer:username});if(!set.size)rooms.delete(room)}return}
if(m.type==='voice_signal'){const room=clean(m.room,120),targetName=clean(m.to,32),set=rooms.get(room);if(!set?.has(username)||!set.has(targetName)||targetName===username||!channelForUser(username,room,'voice')||!channelForUser(targetName,room,'voice'))return send(ws,{type:'error',message:'Join the same voice channel before sending voice data.'});if(!validRtcSignal(m.data))return send(ws,{type:'error',message:'Invalid voice signaling data.'});const target=[...clients.entries()].find(([,u])=>u===targetName)?.[0];if(target)send(target,{type:'voice_signal',from:username,room,data:m.data});return}
/* private calls */
if(m.type==='call_start'){const onlineUsers=new Set(clients.values()),targets=[...new Set([...(Array.isArray(m.to)?m.to:[m.to])].map(x=>clean(x,32)).filter(x=>x!==username&&data.users[x]&&onlineUsers.has(x)&&isAcceptedFriend(username,x)))];if(!targets.length)return send(ws,{type:'error',message:'Call recipients must be online accepted friends.'});const call={id:id('call'),type:m.callType==='group'?'group':'private',participants:new Set([username]),ringing:new Set(targets)};calls.set(call.id,call);for(const t of targets)toUser(t,{type:'incoming_call',callId:call.id,from:username,typeName:call.type,participants:[username]});return send(ws,{type:'call_started',callId:call.id,participants:[username],typeName:call.type})}
if(m.type==='call_accept'){const c=calls.get(clean(m.callId,100));if(!c||!c.ringing.has(username))return send(ws,{type:'error',message:'This call is no longer awaiting your response.'});c.ringing.delete(username);c.participants.add(username);for(const u of c.participants)if(u!==username)toUser(u,{type:'call_member_joined',callId:c.id,user:username,participants:[...c.participants]});return send(ws,{type:'call_accepted',callId:c.id,participants:[...c.participants]})}
if(m.type==='call_decline'){const c=calls.get(clean(m.callId,100));if(!c||!c.ringing.delete(username))return;for(const u of c.participants)toUser(u,{type:'call_declined',callId:c.id,user:username});if(c.participants.size<2&&!c.ringing.size){for(const u of c.participants)toUser(u,{type:'call_ended',callId:c.id,by:username});calls.delete(c.id)}return}
if(m.type==='call_end'){const c=calls.get(clean(m.callId,100));if(!c||!c.participants.has(username))return;for(const u of c.participants)if(u!==username)toUser(u,{type:'call_ended',callId:c.id,by:username});calls.delete(c.id);return}
if(m.type==='call_signal'){const c=calls.get(clean(m.callId,100)),targetName=clean(m.to,32);if(!c||!c.participants.has(username)||!c.participants.has(targetName)||username===targetName)return send(ws,{type:'error',message:'Join the call before sending voice data.'});if(!validRtcSignal(m.data))return send(ws,{type:'error',message:'Invalid call signaling data.'});toUser(targetName,{type:'call_signal',callId:c.id,from:username,data:m.data});return}
/* multiplayer games */
if(m.type==='game_invite'){multiplayer.handleGameInvite(m,{data,users:data.users,clients,isAcceptedFriend,clean,toUser},username,send,toUser);return}
if(m.type==='game_accept'){multiplayer.handleGameAccept(m,{data,users:data.users,clients,clean,toUser},username,send,toUser);return}
if(m.type==='game_decline'){multiplayer.handleGameDecline(m,{data,users:data.users,clients,clean,toUser},username,send,toUser);return}
if(m.type==='game_action'){multiplayer.handleGameAction(m,{data,users:data.users,clients,clean,toUser},username,send,toUser);return}
if(m.type==='game_leave'){multiplayer.handleGameLeave(m,{data,users:data.users,clients,clean,toUser},username,send,toUser);return}
if(m.type==='friend_invite'){multiplayer.handleFriendInvite(m,{data,users:data.users,clients,isAcceptedFriend,clean,toUser},username,send,toUser);return}
if(m.type==='friend_invite_accept'){multiplayer.handleFriendInviteAccept(m,{data,users:data.users,clients,clean,toUser},username,send,toUser);return}
if(m.type==='friend_invite_decline'){multiplayer.handleFriendInviteDecline(m,{data,users:data.users,clients,clean,toUser},username,send,toUser);return}
  metrics.recordWsEvent(m.type, Number(process.hrtime.bigint() - wsTimer) / 1e6, true);
});ws.on('close',()=>{if(!username)return;clients.delete(ws);if([...clients.values()].includes(username)){broadcastPresence();return}for(const [room,set] of rooms){if(set.delete(username))for(const [c,u] of clients)if(set.has(u))send(c,{type:'voice_peer_left',room,peer:username});if(!set.size)rooms.delete(room)}for(const [cid,c] of calls){const wasParticipant=c.participants.delete(username),wasRinging=c.ringing.delete(username);if(wasParticipant)for(const u of c.participants)toUser(u,{type:'call_member_left',callId:cid,user:username});if(wasRinging)for(const u of c.participants)toUser(u,{type:'call_declined',callId:cid,user:username});if(wasParticipant&&c.participants.size<2){for(const u of c.participants)toUser(u,{type:'call_ended',callId:cid,by:username});calls.delete(cid)}else if(!c.participants.size||c.participants.size<2&&!c.ringing.size)calls.delete(cid)}broadcastPresence()})});
app.use((req,r)=>{
  if(req.path.startsWith('/app')){
    r.sendFile(path.join(PUBLIC,'index.html'));
  }else{
    r.sendFile(path.join(PUBLIC,'landing.html'));
  }
});server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`MINECORD running on port ${listeningPort}`);
  if ((process.env.HOST || '0.0.0.0') === '0.0.0.0') console.log(`On this PC: http://localhost:${listeningPort}`);
});
