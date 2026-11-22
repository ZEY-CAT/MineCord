// --- Modal-based UI replacements for broken prompt/alert/confirm ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `mc-toast mc-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

function modalConfirm(message, title = 'Confirm') {
  return MCModal.confirm(message, title);
}

function modalPrompt(message, title = 'MineCord', defaultValue = '') {
  return MCModal.prompt(message, title, defaultValue);
}

function modalAlert(message, title = 'MineCord') {
  return MCModal.alert(message, title);
}

function modalForm(fields, options = {}) {
  return MCModal.form(fields, options);
}

function showError(message) {
  showToast(message, 'error');
  console.error(message);
}

function showSuccess(message) {
  showToast(message, 'success');
}

// Toast styles
const toastStyle = document.createElement('style');
toastStyle.textContent = `
  .mc-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    border-radius: 8px;
    background: var(--side, #1e1f22);
    border: 1px solid var(--line, #202225);
    color: var(--text, #f2f4f7);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 10001;
    transform: translateX(120%);
    transition: transform 0.3s ease;
    max-width: 360px;
    font-size: 14px;
  }
  .mc-toast.show { transform: translateX(0); }
  .mc-toast-error { border-color: var(--red, #da373c); }
  .mc-toast-success { border-color: var(--green, #23a559); }
  .mc-toast-warning { border-color: var(--yellow, #faa61a); }
  .mc-toast-info { border-color: var(--blue, #5865f2); }
`;
document.head.appendChild(toastStyle);

// --- Fixed UI handlers ---
$('#newServer').onclick = async () => {
  const result = await modalForm([
    { name: 'name', label: 'Server Name', type: 'text', placeholder: 'My Minecraft Server', required: true, maxlength: 32 },
    { name: 'icon', label: 'Icon (emoji)', type: 'text', placeholder: '⛏️', maxlength: 2 }
  ], { title: 'Create Server', submitText: 'Create', description: 'Create a new server for you and your friends.' });
  if (result && result.name) send({ type: 'create_server', name: result.name.trim(), icon: result.icon || '⛏️' });
};

$('#newDM').onclick = async () => {
  const username = await modalPrompt('Enter the MineCord username to start a DM:', 'New Direct Message');
  if (username) openDM(username.trim());
};

$('#addFriend').onclick = async () => {
  const username = await modalPrompt('Enter the MineCord username to add as a friend:', 'Add Friend');
  if (!username) return;
  const trimmed = username.trim();
  if (trimmed === me.username) return showError('You cannot add yourself as a friend.');
  send({ type: 'friend_request', to: trimmed });
};

$('#inviteBtn').onclick = () => {
  if (currentServer) send({ type: 'invite_create', serverId: currentServer.id });
};

$('#profileBtn').onclick = () => { renderUser(); show('settingsModal') };

$('#showGameActivity').onchange = async () => {
  try {
    const response = await fetch('/api/activity/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: $('#showGameActivity').checked }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save activity preference.');
    me.showGameActivity = result.enabled;
    if (!result.enabled) delete activities[me.username];
    renderActivities();
    showSuccess('Activity preference saved');
  } catch (error) {
    $('#showGameActivity').checked = !$('#showGameActivity').checked;
    showError(error.message);
  }
};

$('#pairEaglercraft').onclick = async () => { try { const response=await fetch('/api/activity/pairing',{method:'POST'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Could not create pairing code.');$('#pairingCode').textContent=`One-time code (expires in 5 minutes): ${result.code}`}catch(error){$('#pairingCode').textContent=error.message}};
$('#revokeEaglercraft').onclick=async()=>{try{const response=await fetch('/api/activity/pairing/revoke',{method:'POST'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Could not unpair.');$('#pairingCode').textContent='Activity extension unpaired.'}catch(error){$('#pairingCode').textContent=error.message}};
$('#saveProfile').onclick=()=>{let n=$('#settingsDisplayName').value.trim();if(!n)return showError('Display name cannot be empty.');send({type:'profile',displayName:n});let mc=$('#mcName').value.trim();if(mc)send({type:'minecraft_link',minecraftUsername:mc,minecraftUuid:$('mcUuid').value.trim(),edition:$('mcEdition').value});show('settingsModal',false)};
$('#signOut').onclick=async()=>{await fetch('/api/auth/logout',{method:'POST'});location.href='/'};

async function createChannel(){
  if(!currentServer) return;
  const result = await modalForm([
    { name: 'name', label: 'Channel Name', type: 'text', placeholder: 'general', required: true, maxlength: 24 },
    { name: 'type', label: 'Channel Type', type: 'select', options: [
      { value: 'text', label: '# Text Channel' },
      { value: 'voice', label: '🔊 Voice Channel' }
    ], required: true }
  ], { title: 'Create Channel', submitText: 'Create', description: 'Add a new channel to ' + currentServer.name });
  if (result && result.name) send({ type: 'create_channel', serverId: currentServer.id, name: result.name.trim(), channelType: result.type });
}

const pendingIceCandidates=new WeakMap();
async function setRemoteDescription(pc,description){await pc.setRemoteDescription(description);const candidates=pendingIceCandidates.get(pc)||[];pendingIceCandidates.delete(pc);for(const candidate of candidates){try{await pc.addIceCandidate(candidate)}catch(error){console.warn('Could not add queued voice ICE candidate:',error.message)}}}
async function addIceCandidate(pc,candidate){if(!pc.remoteDescription){const candidates=pendingIceCandidates.get(pc)||[];candidates.push(candidate);pendingIceCandidates.set(pc,candidates);return}await pc.addIceCandidate(candidate)}
async function mic(){if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access requires a supported browser and a secure HTTPS connection.');if(!localStream){localStream=await navigator.mediaDevices.getUserMedia({audio:true});localStream.getAudioTracks().forEach(track=>track.enabled=!muted)}return localStream}
function voiceErrorMessage(error){if(error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError')return 'Allow microphone access in your browser, then rejoin voice.';if(error?.name==='NotFoundError'||error?.name==='DevicesNotFoundError')return 'No microphone was found. Connect a microphone and try again.';if(error?.name==='NotReadableError'||error?.name==='TrackStartError')return 'The microphone is busy or unavailable to MineCord.';return `Could not start voice: ${error?.message||'unknown error'}`}
function setVoiceStatus(message,kind=''){if(kind==='error')voiceFailure=message;else if(voiceFailure&&kind!=='error')voiceFailure='';const node=$('#voiceStatus');node.textContent=message;node.className=`callStatus ${kind}`.trim()}
async function joinServerVoice(){const room=scope();if(!room||ws?.readyState!==1){show('callBar');setVoiceStatus('Reconnect to MineCord before joining voice.','error');return}try{if(voiceRoom&&voiceRoom!==room)leaveServerVoice();const rejoining=voiceRoom===room;if(rejoining)for(const peer of serverPeers.keys())closePeer(peer);await mic();voiceFailure='';voiceRoom=room;voiceMembers=new Set([me.username]);send({type:'voice_join',room});renderCallBar()}catch(error){show('callBar');setVoiceStatus(voiceErrorMessage(error),'error')}}
function leaveServerVoice(notify=true){const room=voiceRoom;if(room&&notify)send({type:'voice_leave',room});voiceRoom=null;voiceMembers.clear();for(const user of serverPeers.keys())closePeer(user);if(!activeCall)stopMic();renderCallBar()}
async function restartPeer(pc,user,sendDescription){if(!shouldInitiatePeer(user)||pc.signalingState!=='stable')return;await pc.setLocalDescription(await pc.createOffer({iceRestart:true}));sendDescription(pc.localDescription)}
function monitorPeer(pc,user,restart){connectionStates.set(user,'connecting');let lastRestartAt=0;const updateState=()=>{connectionStates.set(user,pc.connectionState||pc.iceConnectionState||'connecting');if(pc.connectionState==='failed'){setVoiceStatus(`Could not connect to ${user}. Check network access or configure TURN.`,'error');if(restart&&Date.now()-lastRestartAt>10000){lastRestartAt=Date.now();restart().catch(error=>{console.warn('Could not restart voice ICE:',error.message);setVoiceStatus(`Could not restart the connection to ${user}. Leave and rejoin voice.`,'error')})}else if(pc.connectionState==='disconnected')setVoiceStatus(`Connection to ${user} was interrupted; attempting to reconnect.`,'warning');renderCallBar()};pc.onconnectionstatechange=updateState;pc.oniceconnectionstatechange=updateState;const timer=setInterval(async()=>{if(pc.connectionState==='closed'){clearInterval(timer);peerMonitorTimers.delete(pc);return}try{const stats=await pc.getStats();let selectedPair=null,speaking=false;stats.forEach(report=>{if(report.type==='candidate-pair'&&report.state==='succeeded'&&(report.selected||report.nominated))selectedPair=report;if(report.type==='inbound-rtp'&&report.kind==='audio'&&typeof report.audioLevel==='number'&&report.audioLevel>0.025)speaking=true});if(selectedPair){const local=stats.get(selectedPair.localCandidateId),remote=stats.get(selectedPair.remoteCandidateId);relayStates.set(user,local?.candidateType==='relay'||remote?.candidateType==='relay'?'TURN relay selected':'Direct candidate pair')}if(speaking)speakingPeers.add(user);else speakingPeers.delete(user);renderCallBar()}catch(error){console.warn('Could not inspect voice connection statistics:',error.message)}},1200);peerMonitorTimers.set(pc,timer);updateState()}
async function makeServerPeer(u,init,room){if(serverPeers.has(u))return;let pc=new RTCPeerConnection(rtcConfig);serverPeers.set(u,pc);monitorPeer(pc,u,()=>restartPeer(pc,u,description=>send({type:'voice_signal',to:u,room,data:{description}})));localStream?.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>e.candidate&&send({type:'voice_signal',to:u,room,data:{candidate:e.candidate}});pc.ontrack=e=>{let a=document.getElementById('server-a-'+u);if(!a){a=document.createElement('audio');a.id='server-a-'+u;a.autoplay=true;$('#audioBin').appendChild(a)}a.srcObject=e.streams[0];
a.muted=deafened;
a.playsInline=true;
a.autoplay=true;
a.play().catch(err=>{
  console.warn('Voice audio playback blocked:',err);
  setVoiceStatus('Your browser blocked incoming audio. Interact with this page and rejoin voice.','warning');
});};if(init){await pc.setLocalDescription(await pc.createOffer());send({type:'voice_signal',to:u,room,data:{description:pc.localDescription}})}}async function voiceSignal(m){if(m.room!==voiceRoom)return;await makeServerPeer(m.from,false,m.room);let pc=serverPeers.get(m.from),d=m.data;if(d.description){await setRemoteDescription(pc,d.description);if(d.description.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());send({type:'voice_signal',to:m.from,room:m.room,data:{description:pc.localDescription}})}}else if(d.candidate)try{await addIceCandidate(pc,d.candidate)}catch(error){console.warn('Could not add voice ICE candidate:',error.message)}}function closePeer(u){const pc=serverPeers.get(u);pc?.close();serverPeers.delete(u);clearInterval(peerMonitorTimers.get(pc));peerMonitorTimers.delete(pc);connectionStates.delete(u);relayStates.delete(u);speakingPeers.delete(u);$('#server-a-'+u)?.remove();renderCallBar()}
/* private calls */
async function startCall(){try{await mic()}catch(error){const message=voiceErrorMessage(error);if(activeCall)send({type:'call_end',callId:activeCall.id});for(const user of callPeers.keys())closeCallPeer(user);activeCall=null;if(!voiceRoom)stopMic();show('callBar');setVoiceStatus(message,'error');return}if(activeCall){
  for(let u of activeCall.participants){
    if(u!==me.username) await makeCallPeer(u,false);
  }
}renderCallBar()}function shouldInitiatePeer(u){
  return String(me?.username || '') < String(u || '');
}

async function makeCallPeer(u, init){
  if(!activeCall || u===me.username || callPeers.has(u)) return;

  const pc = new RTCPeerConnection(rtcConfig);

  callPeers.set(u,pc);
  const callId=activeCall.id;
  monitorPeer(pc,u,()=>restartPeer(pc,u,description=>{
    if(activeCall?.id===callId)send({type:'call_signal',callId,to:u,data:{description}});
  }));

  if(localStream){
    localStream.getTracks().forEach(track=>{
      pc.addTrack(track,localStream);
    });
  }

  pc.onicecandidate = e=>{
    if(e.candidate){
      send({
        type:'call_signal',
        callId:activeCall.id,
        to:u,
        data:{candidate:e.candidate}
      });
    }
  };

  pc.ontrack = e=>{
    let a=document.getElementById('call-a-'+u);

    if(!a){
      a=document.createElement('audio');
      a.id='call-a-'+u;
      a.autoplay=true;
      a.playsInline=true;
      a.controls=false;
      $('#audioBin').appendChild(a);
    }

    a.srcObject=e.streams[0];
    a.muted=deafened;

    // Explicitly start playback.
    a.play().catch(err=>{
      console.warn('Remote audio playback blocked:',err);
      setVoiceStatus('Your browser blocked incoming audio. Interact with this page and rejoin the call.','warning');
    });
  };

  // Only ONE side creates the offer.
  if(shouldInitiatePeer(u)){
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);

    send({
      type:'call_signal',
      callId:activeCall.id,
      to:u,
      data:{description:pc.localDescription}
    });
  }
}

async function callSignal(m){
  if(!activeCall || activeCall.id!==m.callId) return;

  await makeCallPeer(m.from,false);

  const pc=callPeers.get(m.from);
  if(!pc) return;

  const d=m.data;

  if(d.description){
    await setRemoteDescription(pc,d.description);

    if(d.description.type==='offer'){
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);

      send({
        type:'call_signal',
        callId:m.callId,
        to:m.from,
        data:{description:pc.localDescription}
      });
    }
  }
  else if(d.candidate){
    try{
      await addIceCandidate(pc,d.candidate);
    }catch(error){
      console.warn('Could not add call ICE candidate:',error.message);
    }
  }
}function closeCallPeer(u){const pc=callPeers.get(u);pc?.close();callPeers.delete(u);clearInterval(peerMonitorTimers.get(pc));peerMonitorTimers.delete(pc);connectionStates.delete(u);relayStates.delete(u);speakingPeers.delete(u);$('#call-a-'+u)?.remove();renderCallBar()}
function renderCallBar(){const visible=Boolean(activeCall||voiceRoom);show('callBar',visible);if(!visible)return;$('#callTitle').textContent=voiceRoom&&!activeCall?'Voice channel':'Voice call';$('#endCall').setAttribute('aria-label',voiceRoom&&!activeCall?'Leave voice channel':'End call');$('#endCall').title=voiceRoom&&!activeCall?'Leave voice channel':'End call';const users=activeCall?[...activeCall.participants].filter(name=>name!==me.username):[...voiceMembers].filter(name=>name!==me.username);$('#callPeople').innerHTML=users.map(name=>{const status=connectionStates.get(name)||'connecting',speaking=speakingPeers.has(name)?' \u00B7 speaking':'',route=relayStates.get(name)?` \u00B7 ${relayStates.get(name)}`:'';return`<span class="callUser" title="${esc(status+speaking+route)}">${esc(name)} \u00B7 ${esc(status)}${speaking}</span>`}).join('')||'<span class="muted">Waiting for participants\u2026</span>';if(voiceFailure){setVoiceStatus(voiceFailure,'error');return}const warning=rtcWarnings.join(' ');if(warning)setVoiceStatus(warning,'warning');else if(!connectionStates.size)setVoiceStatus('Connecting to voice\u2026');else if([...connectionStates.values()].every(status=>status==='connected'))setVoiceStatus('Connected.')}
function updateCall(){renderCallBar()}
function stopMic(){if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}}
function renderVoiceControls(){$('#muteBtn').innerHTML=`<svg class="uiIcon" aria-hidden="true"><use href="#icon-${muted?'mute':'mic'}"></use></svg><span>${muted?'Unmute':'Mute'}</span>`;$('#deafenBtn').innerHTML=`<svg class="uiIcon" aria-hidden="true"><use href="#icon-deafen"></use></svg><span>${deafened?'Undeafen':'Deafen'}</span>`;$('#muteBtn').setAttribute('aria-pressed',String(muted));$('#deafenBtn').setAttribute('aria-pressed',String(deafened))}
function finishCall(notify=true){if(notify&&activeCall)send({type:'call_end',callId:activeCall.id});for(const user of callPeers.keys())closeCallPeer(user);activeCall=null;muted=false;deafened=false;localStream?.getAudioTracks().forEach(track=>track.enabled=true);document.querySelectorAll('#audioBin audio').forEach(audio=>audio.muted=false);renderVoiceControls();if(!voiceRoom)stopMic();renderCallBar()}
$('#callBtn').onclick=()=>{if(!currentDM)return showError('Open a DM first to start a call.');send({type:'call_start',to:currentDM,callType:'private'})};

$('#groupCallBtn').onclick=async()=>{
  if(!currentDM)return showError('Open a DM first to start a group call.');
  const targets = await modalPrompt('Usernames to call (comma separated):', 'Group Call', currentDM);
  if(targets){
    const users = targets.split(',').map(n=>n.trim()).filter(Boolean);
    if(users.length) send({type:'call_start',to:users,callType:'group'});
  }
};
$('#acceptCall').onclick=async()=>{if(!incomingCall)return;try{await mic()}catch(error){show('callBar');setVoiceStatus(voiceErrorMessage(error),'error');return}const call=incomingCall;incomingCall=null;show('incoming',false);activeCall={id:call.callId,participants:new Set(call.participants),type:call.typeName};send({type:'call_accept',callId:call.callId});await startCall()};
$('#declineCall').onclick=()=>{if(incomingCall){send({type:'call_decline',callId:incomingCall.callId});incomingCall=null;show('incoming',false)}};
$('#endCall').onclick=()=>activeCall?finishCall(true):leaveServerVoice();
$('#muteBtn').onclick=()=>{muted=!muted;localStream?.getAudioTracks().forEach(track=>track.enabled=!muted);renderVoiceControls()};
$('#deafenBtn').onclick=()=>{deafened=!deafened;document.querySelectorAll('#audioBin audio').forEach(audio=>audio.muted=deafened);renderVoiceControls()};
$('#voiceUsageButton').onclick=async()=>{const node=$('#voiceUsageStatus');node.textContent='Checking\u2026';try{const response=await fetch('/api/rtc-usage'),result=await response.json();if(!response.ok)throw new Error(result.error||'TURN usage could not be retrieved.');node.textContent=`TURN usage: ${result.usageInGB.toFixed(3)} GB`}catch(error){node.textContent=error.message}};
(async()=>{const query=new URLSearchParams(location.search),error=query.get('auth_error');if(error)$('#loginError').textContent=error;if(query.has('oauth'))history.replaceState({},'','/');try{const response=await fetch('/api/auth/me'),result=await response.json();if(response.ok){me=result.user;show('login',false);connect()}else show('login',true)}catch(error){$('#loginError').textContent='Cannot reach MineCord. Check the server connection.';show('login',true)}fetch('/api/config').then(response=>response.json()).then(config=>{document.querySelectorAll('.oauthButton')[0].hidden=!config.google;document.querySelectorAll('.oauthButton')[1].hidden=!config.microsoft;document.querySelectorAll('.oauthButton')[2].hidden=!config.github}).catch(()=>{});setInterval(renderActivities,60000)})();
</script>
<script src="/modals.js"></script>
<script src="/features.js"></script>
<script src="/desktop-updater.js"></script>
</body></html>