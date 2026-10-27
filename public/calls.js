/* MineCord call experience: private/group voice and video calls, real WebRTC media, add-people flow. */
(() => {
  'use strict';

  const cameraConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
  let callParticipantLimit = (() => {
    const value = Number(window.maxCallParticipants);
    return Number.isInteger(value) && value >= 2 && value <= 25 ? value : 10;
  })();
  const callMessageTypes = new Set([
    'incoming_call', 'call_started', 'call_accepted', 'call_member_joined', 'call_declined',
    'call_member_left', 'call_ended', 'call_cancelled', 'call_state_sync', 'call_signal',
    'call_media', 'call_member_invited', 'call_invite_sent'
  ]);
  const callUi = {
    notice: null,
    noticeTimer: null,
    timer: null,
    timerCallId: '',
    startedAt: 0,
    mediaState: {},
    declinedReasons: new Map(),
    remoteStreams: new Map(),
    tiles: new Map(),
    avatarSignature: '',
    inviteMode: 'active',
    inviteSelected: new Set(),
    inviteMedia: 'audio',
    inviteBusy: false,
    inviteMessage: '',
    cameraEnabled: false,
    mediaWarning: '',
    acquiring: false,
    mediaGeneration: 0,
    deviceBusy: false
  };

  const icon = (name, cls = 'uiIcon') => `<svg class="${cls}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  const callTitleIcon = name => {
    const use = $('callTitle')?.querySelector('use');
    if (use) use.setAttribute('href', `#icon-${name}`);
  };
  const displayName = name => {
    const person = serverMemberProfiles?.[name] || memberDirectory?.[name] || userObj(name);
    return person?.displayName || person?.username || name || 'Someone';
  };
  const personAvatar = name => `<div class="avatar">${avatar(userObj(name))}</div>`;
  const isVideoCall = () => activeCall?.mediaType === 'video';
  const activeUsers = () => activeCall ? [...activeCall.participants] : [];
  const callPanelVisible = () => Boolean(activeCall || voiceRoom || callUi.notice);

  function connectionLabel(name) {
    const state = connectionStates.get(name);
    if (!state || state === 'new' || state === 'connecting') return 'Connecting…';
    if (state === 'connected' || state === 'completed') return 'Connected';
    if (state === 'failed') return 'Connection failed';
    if (state === 'disconnected') return 'Reconnecting…';
    return state;
  }

  function cameraErrorMessage(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
      return 'Allow camera access in your browser, then try the camera button again.';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return 'No camera was found. The call will continue with voice.';
    }
    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
      return 'Your camera is already in use by another application. The call will continue with voice.';
    }
    return `Camera unavailable: ${error?.message || 'permission or hardware error'}. The call will continue with voice.`;
  }

  function stopCallTimer() {
    if (callUi.timer) clearInterval(callUi.timer);
    callUi.timer = null;
    callUi.timerCallId = '';
    callUi.startedAt = 0;
    const timer = $('callTimer');
    if (timer) {
      timer.textContent = '00:00';
      timer.hidden = true;
    }
  }

  function renderCallTimer() {
    const node = $('callTimer');
    if (!node) return;
    if (!activeCall) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    const elapsed = Math.max(0, Math.floor((Date.now() - (callUi.startedAt || Date.now())) / 1000));
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    node.textContent = hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function startCallTimer() {
    if (!activeCall) return;
    if (callUi.timerCallId !== activeCall.id || !callUi.timer) {
      if (callUi.timer) clearInterval(callUi.timer);
      callUi.timerCallId = activeCall.id;
      callUi.startedAt = Date.now();
      callUi.timer = setInterval(renderCallTimer, 1000);
    }
    renderCallTimer();
  }

  function showCallNotice(message, kind = 'info', timeout = 0) {
    if (callUi.noticeTimer) clearTimeout(callUi.noticeTimer);
    callUi.noticeTimer = null;
    callUi.notice = { message, kind };
    if (timeout > 0) {
      callUi.noticeTimer = setTimeout(() => {
        callUi.noticeTimer = null;
        callUi.notice = null;
        if (!activeCall && !voiceRoom) show('callBar', false);
        else renderCallBar();
      }, timeout);
    }
    renderCallBar();
  }

  function dismissCallNotice() {
    if (callUi.noticeTimer) clearTimeout(callUi.noticeTimer);
    callUi.noticeTimer = null;
    callUi.notice = null;
    voiceFailure = '';
    if (!activeCall && !voiceRoom) show('callBar', false);
    else renderCallBar();
  }

  function sendCallMediaState() {
    if (!activeCall) return;
    const audio = Boolean(localStream?.getAudioTracks().some(track => track.readyState === 'live' && track.enabled));
    const video = Boolean(isVideoCall() && callUi.cameraEnabled && localStream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled));
    callUi.mediaState[me?.username] = { audio, video };
    send({ type: 'call_media', callId: activeCall.id, audio, video });
  }

  function ensureRemoteAudio(user, stream) {
    let audio = document.getElementById(`call-a-${user}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `call-a-${user}`;
      audio.autoplay = true;
      audio.playsInline = true;
      $('audioBin')?.appendChild(audio);
    }
    if (audio.srcObject !== stream) audio.srcObject = stream;
    audio.muted = deafened;
    audio.play().catch(error => console.warn('Could not play remote call audio:', error.message));
  }

  async function requestCallMedia(constraints, generation) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (callUi.mediaGeneration !== generation) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('The call ended while requesting microphone or camera access.');
    }
    return stream;
  }

  async function acquireCallMedia(wantsVideo) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone and camera access require a supported browser and a secure HTTPS connection.');
    }
    const generation = callUi.mediaGeneration;
    if (!localStream) localStream = new MediaStream();
    const liveAudio = localStream.getAudioTracks().filter(track => track.readyState === 'live');
    if (!liveAudio.length) {
      const audioStream = await requestCallMedia({ audio: true, video: false }, generation);
      if (!localStream || callUi.mediaGeneration !== generation) {
        audioStream.getTracks().forEach(track => track.stop());
        throw new Error('The call ended while requesting microphone access.');
      }
      audioStream.getAudioTracks().forEach(track => localStream.addTrack(track));
    }
    if (wantsVideo) {
      const liveVideo = localStream.getVideoTracks().filter(track => track.readyState === 'live');
      if (!liveVideo.length) {
        try {
          const videoStream = await requestCallMedia({ video: cameraConstraints, audio: false }, generation);
          if (!localStream || callUi.mediaGeneration !== generation) {
            videoStream.getTracks().forEach(track => track.stop());
            throw new Error('The call ended while requesting camera access.');
          }
          videoStream.getVideoTracks().forEach(track => localStream.addTrack(track));
          callUi.cameraEnabled = true;
          callUi.mediaWarning = '';
        } catch (error) {
          if (callUi.mediaGeneration !== generation) throw error;
          callUi.cameraEnabled = false;
          callUi.mediaWarning = cameraErrorMessage(error);
        }
      } else {
        callUi.cameraEnabled = true;
      }
    } else {
      callUi.cameraEnabled = false;
      localStream.getVideoTracks().forEach(track => { track.enabled = false; });
    }
    localStream.getAudioTracks().forEach(track => { track.enabled = !muted; });
    localStream.getVideoTracks().forEach(track => { track.enabled = Boolean(wantsVideo && callUi.cameraEnabled); });
    return localStream;
  }

  async function addCameraTrack() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported in this browser.');
    const generation = callUi.mediaGeneration;
    const cameraStream = await requestCallMedia({ video: cameraConstraints, audio: false }, generation);
    const track = cameraStream.getVideoTracks()[0];
    if (!track) throw new Error('No camera was found.');
    if (!activeCall || callUi.mediaGeneration !== generation) {
      track.stop();
      throw new Error('The call ended while requesting camera access.');
    }
    if (!localStream) localStream = new MediaStream();
    for (const old of [...localStream.getVideoTracks()]) {
      if (old.readyState !== 'live') localStream.removeTrack(old);
    }
    localStream.addTrack(track);
    for (const [user, pc] of callPeers) {
      pc.addTrack(track, localStream);
      await createCallOffer(user, pc).catch(error => console.warn('Could not renegotiate camera track:', error.message));
    }
    callUi.cameraEnabled = true;
    callUi.mediaWarning = '';
    renderCallBar();
  }

  async function toggleCallCamera() {
    if (!activeCall || !isVideoCall()) return;
    const button = $('cameraBtn');
    if (button) button.disabled = true;
    try {
      const liveVideo = localStream?.getVideoTracks().find(track => track.readyState === 'live');
      if (!liveVideo) {
        await addCameraTrack();
      } else {
        callUi.cameraEnabled = !callUi.cameraEnabled;
        localStream.getVideoTracks().forEach(track => { track.enabled = callUi.cameraEnabled; });
      }
      if (!activeCall) {
        stopCallCamera();
        return;
      }
      sendCallMediaState();
    } catch (error) {
      if (!activeCall) {
        callUi.mediaWarning = '';
        return;
      }
      callUi.mediaWarning = cameraErrorMessage(error);
      callUi.cameraEnabled = Boolean(localStream?.getVideoTracks().some(track => track.enabled));
    } finally {
      if (button) button.disabled = false;
      renderCallBar();
    }
  }

  function stopCallCamera() {
    if (!localStream) return;
    for (const track of [...localStream.getVideoTracks()]) {
      localStream.removeTrack(track);
      track.stop();
    }
    callUi.cameraEnabled = false;
  }

  function closeCallPeer(user) {
    const pc = callPeers.get(user);
    if (pc) {
      try { pc.ontrack = null; pc.onicecandidate = null; pc.close(); } catch {}
    }
    callPeers.delete(user);
    if (pc) {
      clearInterval(peerMonitorTimers.get(pc));
      peerMonitorTimers.delete(pc);
    }
    connectionStates.delete(user);
    relayStates.delete(user);
    speakingPeers.delete(user);
    callUi.remoteStreams.delete(user);
    delete callUi.mediaState[user];
    document.getElementById(`call-a-${user}`)?.remove();
    document.getElementById(`call-v-${user}`)?.remove();
    const tile = callUi.tiles.get(user);
    if (tile) {
      tile.tile.remove();
      callUi.tiles.delete(user);
    }
    renderCallBar();
  }

  async function createCallOffer(user, pc, options = {}) {
    if (!activeCall || !callPeers.has(user) || !pc || pc.signalingState !== 'stable') return;
    const callId = activeCall.id;
    try {
      pc._makingOffer = true;
      const offer = await pc.createOffer(options);
      await pc.setLocalDescription(offer);
      if (activeCall?.id === callId && pc.localDescription) {
        send({ type: 'call_signal', callId, to: user, data: { description: pc.localDescription } });
      }
    } finally {
      pc._makingOffer = false;
    }
  }

  async function restartCallPeer(pc, user) {
    if (!activeCall || !callPeers.has(user) || pc.signalingState !== 'stable') return;
    await createCallOffer(user, pc, { iceRestart: true });
  }

  async function makeCallPeer(user, init) {
    if (!activeCall || !me?.username || user === me.username || callPeers.has(user)) return callPeers.get(user) || null;
    const pc = new RTCPeerConnection(rtcConfig);
    pc._polite = !shouldInitiatePeer(user);
    pc._makingOffer = false;
    pc._ignoreOffer = false;
    pc._isSettingRemoteAnswerPending = false;
    callPeers.set(user, pc);
    monitorPeer(pc, user, () => restartCallPeer(pc, user));

    if (localStream) {
      for (const track of localStream.getTracks()) {
        try { pc.addTrack(track, localStream); } catch (error) { console.warn('Could not add local call track:', error.message); }
      }
    }
    pc.onicecandidate = event => {
      if (!event.candidate || !activeCall) return;
      send({ type: 'call_signal', callId: activeCall.id, to: user, data: { candidate: event.candidate } });
    };
    pc.ontrack = event => {
      let stream = callUi.remoteStreams.get(user);
      if (!stream) {
        stream = event.streams[0] || new MediaStream();
        callUi.remoteStreams.set(user, stream);
      }
      if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      ensureRemoteAudio(user, stream);
      if (event.track.kind === 'video') renderCallBar();
      event.track.onended = () => renderCallBar();
      renderCallBar();
    };
    if (init && shouldInitiatePeer(user)) {
      await createCallOffer(user, pc).catch(error => {
        console.warn('Could not offer call media:', error.message);
        setVoiceStatus(`Could not start media with ${displayName(user)}.`, 'error');
      });
    }
    return pc;
  }

  async function callSignal(message) {
    if (!activeCall || message.callId !== activeCall.id || !message.from) return;
    const pc = await makeCallPeer(message.from, false);
    if (!pc) return;
    const data = message.data || {};
    if (data.description) {
      const description = data.description;
      const readyForOffer = !pc._makingOffer && (pc.signalingState === 'stable' || pc._isSettingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;
      pc._ignoreOffer = !pc._polite && offerCollision;
      if (pc._ignoreOffer) return;
      if (offerCollision && pc._polite) {
        try { await pc.setLocalDescription({ type: 'rollback' }); } catch {}
      }
      pc._isSettingRemoteAnswerPending = description.type === 'answer';
      try {
        await setRemoteDescription(pc, description);
      } finally {
        pc._isSettingRemoteAnswerPending = false;
      }
      if (description.type === 'offer' && activeCall?.id === message.callId) {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          send({ type: 'call_signal', callId: message.callId, to: message.from, data: { description: pc.localDescription } });
        }
      }
      return;
    }
    if (data.candidate) {
      try { await addIceCandidate(pc, data.candidate); } catch (error) { console.warn('Could not add call ICE candidate:', error.message); }
      return;
    }
    if (data.renegotiate && shouldInitiatePeer(message.from)) await createCallOffer(message.from, pc);
  }

  async function startCall() {
    if (!activeCall) return;
    const wantsVideo = isVideoCall();
    callUi.acquiring = true;
    renderCallBar();
    try {
      await acquireCallMedia(wantsVideo);
    } catch (error) {
      callUi.acquiring = false;
      failCall(voiceErrorMessage(error));
      return;
    }
    callUi.acquiring = false;
    if (!activeCall) {
      if (voiceRoom) stopCallCamera();
      else stopMic();
      renderCallBar();
      return;
    }
    startCallTimer();
    for (const user of activeCall.participants) {
      if (user !== me?.username) await makeCallPeer(user, shouldInitiatePeer(user));
    }
    sendCallMediaState();
    refreshCallAudioDevices();
    renderCallBar();
  }

  function failCall(message) {
    const callId = activeCall?.id;
    if (callId) send({ type: 'call_end', callId });
    finishCall(false);
    callUi.notice = { message, kind: 'error' };
    renderCallBar();
  }

  function finishCall(notify = true) {
    callUi.mediaGeneration += 1;
    if (notify && activeCall) send({ type: 'call_end', callId: activeCall.id });
    for (const user of [...callPeers.keys()]) closeCallPeer(user);
    activeCall = null;
    callUi.cameraEnabled = false;
    callUi.mediaWarning = '';
    callUi.acquiring = false;
    callUi.mediaState = {};
    callUi.declinedReasons.clear();
    callUi.remoteStreams.clear();
    callUi.inviteBusy = false;
    callUi.inviteSelected.clear();
    callUi.tiles.clear();
    const videoGrid = $('callVideoGrid');
    if (videoGrid) videoGrid.innerHTML = '';
    const avatarGrid = $('callAvatarGrid');
    if (avatarGrid) avatarGrid.innerHTML = '';
    const localVideo = $('callLocalVideo');
    if (localVideo) localVideo.srcObject = null;
    stopCallTimer();
    muted = false;
    deafened = false;
    document.querySelectorAll('#audioBin audio').forEach(audio => { audio.muted = false; });
    if (voiceRoom) {
      stopCallCamera();
      localStream?.getAudioTracks().forEach(track => { track.enabled = true; });
    } else {
      stopMic();
    }
    show('callInviteModal', false);
    renderVoiceControls();
    renderCallBar();
    setTimeout(() => {
      if (!activeCall && typeof showNextIncomingCall === 'function') showNextIncomingCall();
    }, 120);
  }

  function clearCallUi() {
    hideIncomingCall();
    incomingQueue = [];
    finishCall(false);
  }

  function renderCallVideoGrid(users) {
    const grid = $('callVideoGrid');
    if (!grid) return;
    const wanted = new Set(users);
    for (const [user, entry] of [...callUi.tiles]) {
      if (!wanted.has(user)) {
        entry.tile.remove();
        callUi.tiles.delete(user);
      }
    }
    for (const user of users) {
      let entry = callUi.tiles.get(user);
      if (!entry) {
        const tile = document.createElement('div');
        tile.className = 'callTile';
        tile.dataset.callUser = user;
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.setAttribute('aria-label', `${displayName(user)} camera`);
        const avatarNode = document.createElement('div');
        avatarNode.className = 'callTileAvatar';
        const name = document.createElement('span');
        name.className = 'callTileName';
        const nameText = document.createElement('span');
        const status = document.createElement('span');
        status.className = 'callTileStatus';
        name.append(nameText, status);
        tile.append(video, avatarNode, name);
        grid.appendChild(tile);
        entry = { tile, video, avatar: avatarNode, name: nameText, status };
        callUi.tiles.set(user, entry);
      }
      const stream = callUi.remoteStreams.get(user) || null;
      if (entry.video.srcObject !== stream) entry.video.srcObject = stream;
      const media = callUi.mediaState[user] || {};
      const hasVideo = Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live')) && media.video !== false;
      entry.video.hidden = !hasVideo;
      entry.avatar.hidden = hasVideo;
      if (entry.avatar.dataset.user !== user) {
        entry.avatar.dataset.user = user;
        entry.avatar.innerHTML = personAvatar(user);
      }
      entry.name.textContent = displayName(user);
      const stateText = connectionLabel(user);
      const extras = [];
      if (media.video === false) extras.push('camera off');
      if (media.audio === false) extras.push('muted');
      entry.status.textContent = extras.length ? `${stateText} · ${extras.join(' · ')}` : stateText;
      entry.tile.classList.toggle('speaking', speakingPeers.has(user));
    }
  }

  function renderCallAvatarGrid(users) {
    const grid = $('callAvatarGrid');
    if (!grid) return;
    const signature = users.map(user => `${user}:${connectionStates.get(user) || ''}:${speakingPeers.has(user) ? '1' : '0'}:${callUi.mediaState[user]?.audio === false ? 'm' : ''}`).join('|');
    if (callUi.avatarSignature === signature && grid.childElementCount) return;
    callUi.avatarSignature = signature;
    if (!users.length) {
      grid.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Waiting for someone to join…</div>';
      return;
    }
    grid.innerHTML = users.map(user => {
      const state = connectionLabel(user);
      const mutedText = callUi.mediaState[user]?.audio === false ? ' · muted' : '';
      return `<div class="callAvatarCard ${speakingPeers.has(user) ? 'speaking' : ''}">${personAvatar(user)}<b>${esc(user === me?.username ? 'You' : displayName(user))}</b><small>${esc(state + mutedText)}</small></div>`;
    }).join('');
  }

  function renderCallPeople(users) {
    const node = $('callPeople');
    if (!node) return;
    node.innerHTML = users.map(user => {
      const media = callUi.mediaState[user] || {};
      const iconName = media.audio === false ? `<svg class="uiIcon" aria-hidden="true"><use href="#icon-mute"></use></svg>` : '';
      return `<span class="callUser">${esc(user === me?.username ? 'You' : displayName(user))}${iconName}</span>`;
    }).join('');
  }

  function renderCallInvitePending() {
    const node = $('callInvitePending');
    if (!node) return;
    if (!activeCall) {
      node.textContent = '';
      return;
    }
    const invited = [...(activeCall.invited || [])].filter(Boolean);
    const declined = [...(activeCall.declined || [])].filter(Boolean);
    const pieces = [];
    if (invited.length) pieces.push(`<b>Invited:</b> ${invited.map(name => esc(displayName(name))).join(', ')}`);
    if (declined.length) {
      const declinedText = declined.map(name => {
        const reason = callUi.declinedReasons.get(name);
        return `${esc(displayName(name))}${reason === 'timeout' ? ' (timed out)' : reason === 'declined' ? ' (declined)' : ''}`;
      }).join(', ');
      pieces.push(`<b>Not in call:</b> ${declinedText}`);
    }
    node.innerHTML = pieces.join(' · ');
  }

  function renderStatus(message, kind = '') {
    const node = $('voiceStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `callStatus${kind ? ` ${kind}` : ''}`;
  }

  function renderCallControls(onlyNotice) {
    const mute = $('muteBtn');
    const deafen = $('deafenBtn');
    const camera = $('cameraBtn');
    const addPeople = $('addCallPeopleBtn');
    const end = $('endCall');
    const deviceWrap = $('callAudioDeviceWrap');
    if (mute) {
      mute.hidden = onlyNotice;
      mute.classList.toggle('active', muted);
      mute.innerHTML = `${icon(muted ? 'mute' : 'mic')}<span class="callControlLabel">${muted ? 'Unmute' : 'Mute'}</span>`;
      mute.title = muted ? 'Unmute microphone' : 'Mute microphone';
      mute.setAttribute('aria-label', mute.title);
      mute.setAttribute('aria-pressed', String(muted));
    }
    if (deafen) {
      deafen.hidden = onlyNotice;
      deafen.classList.toggle('active', deafened);
      deafen.innerHTML = `${icon('deafen')}<span class="callControlLabel">${deafened ? 'Undeafen' : 'Deafen'}</span>`;
      deafen.title = deafened ? 'Undeafen' : 'Deafen';
      deafen.setAttribute('aria-label', deafen.title);
      deafen.setAttribute('aria-pressed', String(deafened));
    }
    if (camera) {
      const visible = Boolean(activeCall && isVideoCall() && !onlyNotice);
      camera.hidden = !visible;
      if (visible) {
        camera.classList.toggle('active', !callUi.cameraEnabled);
        const cameraIcon = callUi.cameraEnabled ? 'video' : 'video-off';
        camera.innerHTML = `${icon(cameraIcon)}<span class="callControlLabel">${callUi.cameraEnabled ? 'Camera off' : 'Camera on'}</span>`;
        camera.title = callUi.cameraEnabled ? 'Turn camera off' : 'Turn camera on';
        camera.setAttribute('aria-label', camera.title);
        camera.setAttribute('aria-pressed', String(!callUi.cameraEnabled));
      }
    }
    if (addPeople) {
      const visible = Boolean(activeCall && !onlyNotice);
      addPeople.hidden = !visible;
      addPeople.title = 'Add people to call';
      addPeople.setAttribute('aria-label', addPeople.title);
    }
    if (deviceWrap) deviceWrap.hidden = !activeCall || Boolean(onlyNotice);
    if (end) {
      end.classList.add('callEnd');
      end.innerHTML = `${icon('hangup')}<span class="callControlLabel">${onlyNotice ? 'Close' : activeCall ? 'End call' : 'Leave voice'}</span>`;
      end.title = onlyNotice ? 'Close call notice' : activeCall ? 'End call' : 'Leave voice';
      end.setAttribute('aria-label', end.title);
    }
  }

  function renderCallBar() {
    const visible = callPanelVisible();
    show('callBar', visible);
    if (!visible) {
      stopCallTimer();
      return;
    }
    const onlyNotice = Boolean(callUi.notice && !activeCall && !voiceRoom);
    const bar = $('callBar');
    if (bar) {
      bar.classList.toggle('video-call', Boolean(activeCall && isVideoCall()));
      bar.classList.toggle('voice-call', Boolean(activeCall && !isVideoCall()));
      bar.classList.toggle('voice-channel', Boolean(!activeCall && voiceRoom));
      bar.classList.toggle('call-failed', onlyNotice);
    }
    let title = 'Call';
    let titleIcon = 'call';
    if (activeCall) {
      titleIcon = isVideoCall() ? 'video' : activeCall.type === 'group' ? 'group-call' : 'call';
      const mediaLabel = isVideoCall() ? 'Video' : 'Voice';
      title = activeCall.type === 'group' ? `Group ${mediaLabel.toLowerCase()} call` : `${mediaLabel} call`;
    } else if (voiceRoom) {
      title = 'Voice channel';
      titleIcon = 'call';
    } else if (callUi.notice) {
      title = callUi.notice.kind === 'error' ? 'Call failed' : 'Call ended';
      titleIcon = 'hangup';
    }
    const titleText = $('callTitleText');
    if (titleText) titleText.textContent = title;
    callTitleIcon(titleIcon);

    renderCallTimer();
    const badge = $('callMediaBadge');
    if (badge) {
      if (activeCall) {
        badge.hidden = false;
        badge.textContent = `${isVideoCall() ? 'Video' : 'Voice'} · ${activeCall.participants.size}`;
      } else if (voiceRoom) {
        badge.hidden = false;
        badge.textContent = 'Voice channel';
      } else {
        badge.hidden = true;
        badge.textContent = '';
      }
    }

    const stage = $('callStage');
    const videoGrid = $('callVideoGrid');
    const avatarGrid = $('callAvatarGrid');
    const localWrap = $('callLocalWrap');
    if (stage) stage.hidden = !(activeCall || voiceRoom);
    if (stage && (activeCall || voiceRoom)) {
      if (activeCall && isVideoCall()) {
        const remote = activeUsers().filter(user => user !== me?.username);
        if (videoGrid) videoGrid.hidden = false;
        if (avatarGrid) avatarGrid.hidden = true;
        if (localWrap) localWrap.hidden = false;
        renderCallVideoGrid(remote);
        const localAvatar = $('callLocalAvatar');
        if (localAvatar) localAvatar.innerHTML = avatar(me);
        const localName = $('callLocalName');
        if (localName) localName.textContent = 'You';
        const localVideo = $('callLocalVideo');
        const localTrack = localStream?.getVideoTracks().find(track => track.readyState === 'live');
        const showLocal = Boolean(localTrack && callUi.cameraEnabled && localTrack.enabled);
        if (localVideo) {
          if (localVideo.srcObject !== localStream) localVideo.srcObject = localStream || null;
          localVideo.hidden = !showLocal;
        }
        const placeholder = $('callLocalPlaceholder');
        if (placeholder) placeholder.hidden = showLocal;
        const localStatus = $('callLocalStatus');
        if (localStatus) localStatus.textContent = showLocal ? 'Camera on' : 'Camera off';
      } else {
        const users = activeCall ? activeUsers() : [...voiceMembers];
        if (videoGrid) videoGrid.hidden = true;
        if (avatarGrid) avatarGrid.hidden = false;
        if (localWrap) localWrap.hidden = true;
        renderCallAvatarGrid(users);
      }
    }

    renderCallInvitePending();

    const users = activeCall ? activeUsers() : voiceRoom ? [...voiceMembers] : [];
    renderCallPeople(users);

    let status = '';
    let kind = '';
    if (callUi.notice) {
      status = callUi.notice.message;
      kind = callUi.notice.kind === 'error' ? 'error' : callUi.notice.kind === 'warning' ? 'warning' : '';
    } else if (voiceFailure) {
      status = voiceFailure;
      kind = 'error';
    } else if (callUi.acquiring) {
      status = isVideoCall() ? 'Connecting microphone and camera…' : 'Connecting microphone…';
      kind = 'warning';
    } else if (callUi.mediaWarning) {
      status = callUi.mediaWarning;
      kind = 'warning';
    } else if (activeCall) {
      if (activeCall.participants.size < 2) {
        status = 'Ringing… Waiting for someone to answer.';
      } else {
        const remoteStates = activeUsers().filter(user => user !== me?.username).map(user => connectionStates.get(user));
        if (remoteStates.some(state => state === 'failed')) status = 'Could not connect to one or more participants. Check network access or TURN configuration.';
        else if (remoteStates.some(state => state === 'disconnected')) status = 'Connection interrupted; attempting to reconnect.';
        else if (remoteStates.length && remoteStates.every(state => state === 'connected' || state === 'completed')) status = 'Connected.';
        else status = 'Connecting…';
        if (status === 'Connecting…') kind = 'warning';
      }
    } else if (voiceRoom) {
      status = 'Connected to the voice channel.';
      kind = 'ok';
    }
    renderStatus(status, kind);
    renderCallControls(onlyNotice);
    if (!$('callInviteModal')?.classList.contains('hidden')) renderCallInviteModal();
  }

  function renderVoiceControls() {
    renderCallControls(false);
  }

  function callInviteStatus(message) {
    callUi.inviteMessage = message || '';
    const node = $('callInviteStatus');
    if (node) node.textContent = callUi.inviteMessage;
  }

  function eligibleInviteFriends(search) {
    const query = String(search || '').trim().toLowerCase();
    return (Array.isArray(friendsList) ? friendsList : [])
      .filter(name => name && name !== me?.username && (!query || displayName(name).toLowerCase().includes(query) || name.toLowerCase().includes(query)))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }

  function callInviteCapacity() {
    if (callUi.inviteMode === 'new') return Math.max(0, callParticipantLimit - 1);
    if (!activeCall) return 0;
    const occupied = (activeCall.participants?.size || 0) + (activeCall.invited?.size || 0);
    return Math.max(0, callParticipantLimit - occupied);
  }

  function renderCallInviteModal() {
    const modal = $('callInviteModal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (callUi.inviteMode === 'active' && !activeCall) {
      show('callInviteModal', false);
      return;
    }
    const titleNode = $('callInviteTitleText');
    const context = $('callInviteContext');
    const typeChoice = $('callTypeChoice');
    const pendingNode = $('callInvitePendingList');
    const capacity = callInviteCapacity();
    if (callUi.inviteMode === 'new') {
      if (titleNode) titleNode.textContent = 'Start a group call';
      if (context) context.textContent = `Choose one or more online friends. They must accept before they join the call. Up to ${callParticipantLimit} people total.`;
      if (typeChoice) typeChoice.hidden = false;
      if (pendingNode) { pendingNode.hidden = true; pendingNode.innerHTML = ''; }
    } else {
      if (titleNode) titleNode.textContent = 'Add people to call';
      if (context) context.textContent = `Invite accepted friends to this ${isVideoCall() ? 'video' : 'voice'} call. ${activeCall.participants.size} participant${activeCall.participants.size === 1 ? '' : 's'}; room for ${capacity} more.`;
      if (typeChoice) typeChoice.hidden = true;
      if (pendingNode) {
        pendingNode.hidden = false;
        const invited = [...(activeCall.invited || [])];
        const declined = [...(activeCall.declined || [])];
        pendingNode.innerHTML = [
          ...invited.map(name => `<div>Ringing ${esc(displayName(name))}…</div>`),
          ...declined.map(name => {
            const reason = callUi.declinedReasons.get(name);
            return `<div>${esc(displayName(name))} ${reason === 'timeout' ? 'timed out' : 'declined'}.</div>`;
          })
        ].join('');
        if (!pendingNode.innerHTML) pendingNode.innerHTML = '<div>No pending invitations.</div>';
      }
    }
    if (typeChoice) {
      typeChoice.querySelectorAll('[data-call-media]').forEach(button => {
        button.classList.toggle('active', button.dataset.callMedia === callUi.inviteMedia);
        button.setAttribute('aria-pressed', String(button.dataset.callMedia === callUi.inviteMedia));
      });
    }
    const list = $('callInviteList');
    const empty = $('callInviteEmpty');
    if (list) {
      list.innerHTML = '';
      const friends = eligibleInviteFriends($('callInviteSearch')?.value);
      const atCapacity = callUi.inviteSelected.size >= capacity;
      let visible = 0;
      for (const name of friends) {
        const inCall = Boolean(activeCall?.participants?.has(name));
        const invited = Boolean(activeCall?.invited?.has(name));
        const onlineNow = Array.isArray(online) && online.includes(name);
        const presence = memberDirectory?.[name]?.presence || (onlineNow ? 'online' : 'offline');
        const inOtherCall = presence === 'in_call' && !inCall;
        const overCapacity = atCapacity && !callUi.inviteSelected.has(name);
        const disabled = inCall || invited || !onlineNow || inOtherCall || overCapacity;
        const reason = inCall ? 'In this call' : invited ? 'Invited' : inOtherCall ? 'In a call' : overCapacity ? 'Call is full' : onlineNow ? 'Online' : 'Offline';
        const row = document.createElement('div');
        row.className = `callInviteRow${disabled ? ' off' : ''}`;
        const secondary = displayName(name).toLowerCase() === name.toLowerCase() ? 'Accepted friend' : `@${name}`;
        row.innerHTML = `<label><input type="checkbox" data-user="${esc(name)}" ${callUi.inviteSelected.has(name) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${personAvatar(name)}<span class="callInviteMeta"><b>${esc(displayName(name))}</b><small>${esc(secondary)}</small></span></label><span class="callInviteState">${esc(reason)}</span>`;
        list.appendChild(row);
        visible += 1;
      }
      if (empty) empty.hidden = visible > 0;
    }
    const sendButton = $('callInviteSend');
    if (sendButton) {
      sendButton.disabled = callUi.inviteBusy || callUi.inviteSelected.size === 0 || callUi.inviteSelected.size > capacity;
      sendButton.textContent = callUi.inviteBusy
        ? callUi.inviteMode === 'new' ? 'Starting…' : 'Inviting…'
        : callUi.inviteMode === 'new' ? 'Start call' : 'Invite';
    }
    callInviteStatus(callUi.inviteMessage);
  }

  function openCallInviteModal(mode = activeCall ? 'active' : 'new') {
    if (mode === 'active' && !activeCall) {
      showAlert('Join a call before adding people.', 'No Active Call');
      return;
    }
    callUi.inviteMode = mode;
    callUi.inviteSelected.clear();
    callUi.inviteBusy = false;
    callUi.inviteMessage = '';
    callUi.inviteMedia = 'audio';
    const search = $('callInviteSearch');
    if (search) search.value = '';
    show('callInviteModal', true);
    renderCallInviteModal();
    setTimeout(() => $('callInviteSearch')?.focus(), 30);
  }

  function closeCallInviteModal() {
    show('callInviteModal', false);
    callUi.inviteSelected.clear();
    callUi.inviteBusy = false;
    callUi.inviteMessage = '';
    callInviteStatus('');
  }

  function submitCallInvite() {
    if (callUi.inviteBusy) return;
    const selected = [...callUi.inviteSelected];
    if (!selected.length) {
      callInviteStatus('Choose at least one friend first.');
      return;
    }
    if (selected.length > callInviteCapacity()) {
      callInviteStatus(`This call can include up to ${callParticipantLimit} people.`);
      return;
    }
    callUi.inviteBusy = true;
    if (callUi.inviteMode === 'new') {
      if (activeCall) {
        callUi.inviteBusy = false;
        callInviteStatus('You are already in a call.');
        return;
      }
      callInviteStatus('Starting group call…');
      send({ type: 'call_start', to: selected, callType: 'group', mediaType: callUi.inviteMedia });
    } else {
      if (!activeCall) {
        callUi.inviteBusy = false;
        callInviteStatus('This call has ended.');
        return;
      }
      callInviteStatus(`Inviting ${selected.map(displayName).join(', ')}…`);
      send({ type: 'call_invite', callId: activeCall.id, to: selected });
    }
    renderCallInviteModal();
  }

  async function refreshCallAudioDevices() {
    const wrap = $('callAudioDeviceWrap');
    const select = $('callAudioDevice');
    if (!wrap || !select) return;
    if (!activeCall || !navigator.mediaDevices?.enumerateDevices) {
      wrap.hidden = true;
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(device => device.kind === 'audioinput');
      const current = localStream?.getAudioTracks()[0]?.getSettings?.().deviceId || '';
      select.innerHTML = inputs.map((device, index) => {
        const label = device.label || `Microphone ${index + 1}`;
        return `<option value="${esc(device.deviceId)}" ${device.deviceId === current ? 'selected' : ''}>${esc(label)}</option>`;
      }).join('');
      wrap.hidden = inputs.length === 0;
    } catch (error) {
      wrap.hidden = true;
      console.warn('Could not list call audio devices:', error.message);
    }
  }

  async function switchCallAudioInput(deviceId) {
    if (!activeCall || !deviceId || callUi.deviceBusy) return;
    callUi.deviceBusy = true;
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
      const track = audioStream.getAudioTracks()[0];
      if (!track) throw new Error('No microphone was found for that device.');
      if (!activeCall) {
        track.stop();
        return;
      }
      if (!localStream) localStream = new MediaStream();
      for (const old of [...localStream.getAudioTracks()]) {
        localStream.removeTrack(old);
        old.stop();
      }
      localStream.addTrack(track);
      track.enabled = !muted;
      for (const pc of [...callPeers.values(), ...serverPeers.values()]) {
        const sender = pc.getSenders().find(item => item.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(track);
      }
      callUi.mediaWarning = '';
      sendCallMediaState();
      renderCallBar();
    } catch (error) {
      callUi.mediaWarning = activeCall ? voiceErrorMessage(error) : '';
      renderCallBar();
    } finally {
      callUi.deviceBusy = false;
      refreshCallAudioDevices();
    }
  }

  function startPrivateCall(mediaType) {
    if (activeCall) {
      showAlert('You are already in a call. End the current call before starting another.', 'Already in a Call');
      return;
    }
    if (!currentDM) {
      showAlert('Open a direct message with a friend first.', mediaType === 'video' ? 'Video Call' : 'Voice Call');
      return;
    }
    if (!Array.isArray(friendsList) || !friendsList.includes(currentDM)) {
      showAlert('You can only call accepted friends.', 'Voice Call');
      return;
    }
    if (!Array.isArray(online) || !online.includes(currentDM)) {
      showAlert(`${displayName(currentDM)} must be online to receive a call.`, 'Voice Call');
      return;
    }
    if (memberDirectory?.[currentDM]?.presence === 'in_call') {
      showAlert(`${displayName(currentDM)} is already in a call.`, 'Voice Call');
      return;
    }
    dismissCallNotice();
    send({ type: 'call_start', to: currentDM, callType: 'private', mediaType });
  }

  function handleCallInviteSent(message) {
    if (!activeCall || message.callId !== activeCall.id) return true;
    activeCall.invited ||= new Set();
    activeCall.declined ||= new Set();
    for (const target of message.targets || []) {
      activeCall.invited.add(target);
      activeCall.declined.delete(target);
      callUi.inviteSelected.delete(target);
    }
    callUi.inviteBusy = false;
    callUi.inviteMessage = (message.targets || []).length
      ? `Invitation sent to ${message.targets.map(displayName).join(', ')}.`
      : 'No new invitations were sent.';
    if (message.skipped?.length) callUi.inviteMessage += ' Some friends were unavailable or already invited.';
    renderCallBar();
    renderCallInviteModal();
    return true;
  }

  function handleCallMessage(message) {
    if (!message || !callMessageTypes.has(message.type)) return false;
    if (message.type === 'incoming_call') {
      receiveIncomingCall(message);
      return true;
    }
    if (message.type === 'call_started') {
      dismissCallNotice();
      activeCall = {
        id: message.callId,
        participants: new Set(message.participants || [me?.username].filter(Boolean)),
        invited: new Set(message.invited || []),
        declined: new Set(),
        type: message.typeName === 'group' ? 'group' : 'private',
        mediaType: message.mediaType === 'video' ? 'video' : 'audio'
      };
      callUi.mediaState = { ...(message.mediaState || {}) };
      callUi.mediaWarning = '';
      callUi.inviteBusy = false;
      closeCallInviteModal();
      startCall();
      return true;
    }
    if (message.type === 'call_accepted') {
      dismissCallNotice();
      activeCall = {
        id: message.callId,
        participants: new Set(message.participants || [me?.username].filter(Boolean)),
        invited: new Set(message.invited || []),
        declined: new Set(),
        type: message.typeName === 'group' ? 'group' : 'private',
        mediaType: message.mediaType === 'video' ? 'video' : 'audio'
      };
      callUi.mediaState = { ...(message.mediaState || {}) };
      callUi.mediaWarning = '';
      closeCallInviteModal();
      startCall();
      return true;
    }
    if (message.type === 'call_member_joined') {
      if (!activeCall || message.callId !== activeCall.id) return true;
      activeCall.participants = new Set(message.participants || activeCall.participants);
      activeCall.invited?.delete(message.user);
      activeCall.declined?.delete(message.user);
      callUi.declinedReasons.delete(message.user);
      callUi.inviteSelected.delete(message.user);
      if (message.typeName) activeCall.type = message.typeName;
      if (message.mediaType) activeCall.mediaType = message.mediaType;
      if (message.mediaState) callUi.mediaState = { ...callUi.mediaState, ...message.mediaState };
      makeCallPeer(message.user, shouldInitiatePeer(message.user)).catch(error => console.warn('Could not connect new call participant:', error.message));
      sendCallMediaState();
      renderCallBar();
      return true;
    }
    if (message.type === 'call_member_invited') {
      if (!activeCall || message.callId !== activeCall.id) return true;
      activeCall.invited ||= new Set();
      activeCall.declined ||= new Set();
      const users = Array.isArray(message.users) ? message.users : message.user ? [message.user] : [];
      for (const user of users) {
        activeCall.invited.add(user);
        activeCall.declined.delete(user);
      }
      if (message.typeName) activeCall.type = message.typeName;
      if (message.mediaType) activeCall.mediaType = message.mediaType;
      renderCallBar();
      return true;
    }
    if (message.type === 'call_invite_sent') return handleCallInviteSent(message);
    if (message.type === 'call_declined') {
      if (!activeCall || message.callId !== activeCall.id) return true;
      if (activeCall.invited?.delete(message.user)) activeCall.declined?.add(message.user);
      if (message.user) callUi.declinedReasons.set(message.user, message.reason || 'declined');
      closeCallPeer(message.user);
      renderCallBar();
      return true;
    }
    if (message.type === 'call_member_left') {
      if (!activeCall || message.callId !== activeCall.id) return true;
      activeCall.participants.delete(message.user);
      activeCall.invited?.delete(message.user);
      closeCallPeer(message.user);
      renderCallBar();
      return true;
    }
    if (message.type === 'call_ended') {
      if (!activeCall || message.callId !== activeCall.id) return true;
      const endedBy = message.by && message.by !== me?.username ? displayName(message.by) : '';
      let text = 'Call ended.';
      if (message.reason === 'denied') text = 'The call could not be started.';
      else if (message.reason === 'declined') text = endedBy ? `${endedBy} declined the call.` : 'Call declined.';
      else if (message.reason === 'timeout') text = 'The call timed out before it was answered.';
      else if (endedBy) text = `${endedBy} ended the call.`;
      else if (message.by === me?.username) text = 'The call ended on another device.';
      finishCall(false);
      showCallNotice(text, 'info', 4200);
      return true;
    }
    if (message.type === 'call_cancelled') {
      const wasIncoming = dismissIncomingCall(message.callId);
      if (activeCall?.id === message.callId) {
        finishCall(false);
        showCallNotice('Call ended.', 'info', 4200);
      } else if (wasIncoming && message.reason === 'timeout') {
        showCallNotice('The call timed out before it was answered.', 'info', 4200);
      }
      return true;
    }
    if (message.type === 'call_state_sync') {
      const wasIncoming = dismissIncomingCall(message.callId);
      if (wasIncoming && message.state === 'accepted') showAlert('You accepted this call in another tab.', 'Call');
      if (activeCall?.id === message.callId && message.state === 'ended') {
        finishCall(false);
        showCallNotice('Call ended on another device.', 'info', 4200);
      }
      return true;
    }
    if (message.type === 'call_signal') {
      callSignal(message).catch(error => console.warn('Could not process call signal:', error.message));
      return true;
    }
    if (message.type === 'call_media') {
      if (!activeCall || message.callId !== activeCall.id) return true;
      callUi.mediaState[message.user] = { audio: Boolean(message.audio), video: Boolean(message.video) };
      renderCallBar();
      return true;
    }
    return true;
  }

  function enhanceIncomingCall() {
    const baseRenderIncomingCall = renderIncomingCall;
    renderIncomingCall = function (message) {
      baseRenderIncomingCall(message);
      if (incomingCall?.callId !== message.callId) return;
      const video = message.mediaType === 'video';
      const group = message.typeName === 'group';
      const title = $('incomingTitle');
      if (title) {
        const titleText = group ? (video ? 'Incoming group video call' : 'Incoming group voice call') : (video ? 'Incoming video call' : 'Incoming voice call');
        title.innerHTML = `${icon(video ? 'video' : group ? 'group-call' : 'call')} ${titleText}`;
      }
      const text = $('incomingText');
      if (text) {
        const description = group ? (video ? 'a group video call' : 'a group voice call') : (video ? 'a video call' : 'a voice call');
        text.textContent = `${incomingLabel(message)} is calling you in ${description}.`;
      }
    };
  }

  function initCallButtons() {
    const setTopButton = (id, iconName, label) => {
      const button = $(id);
      if (!button) return;
      button.innerHTML = icon(iconName);
      button.title = label;
      button.setAttribute('aria-label', label);
    };
    const bindClick = (id, handler) => {
      const node = $(id);
      if (node) node.onclick = handler;
    };
    setTopButton('callBtn', 'call', 'Start voice call');
    setTopButton('videoCallBtn', 'video', 'Start video call');
    setTopButton('groupCallBtn', 'group-call', 'Start group call');
    setTopButton('inviteBtn', 'user-plus', 'Invite people to this server');
    const syncServerInvite = () => {
      const button = $('inviteBtn');
      if (button) button.hidden = !(currentServer && !currentDM && !currentGroupDm);
    };
    syncServerInvite();
    const baseRenderChannels = renderChannels;
    renderChannels = function () {
      const result = baseRenderChannels();
      syncServerInvite();
      return result;
    };
    const callTitle = $('callTitle');
    if (callTitle) callTitle.innerHTML = `${icon('call')}<span id="callTitleText">Call</span>`;

    bindClick('callBtn', () => startPrivateCall('audio'));
    bindClick('videoCallBtn', () => startPrivateCall('video'));
    bindClick('groupCallBtn', () => {
      if (activeCall) openCallInviteModal('active');
      else openCallInviteModal('new');
    });
    bindClick('inviteBtn', () => {
      if (!currentServer) {
        showAlert('Select a server first.', 'No Server');
        return;
      }
      if (typeof openInviteModal === 'function') openInviteModal();
      else showAlert('Server invitations are unavailable in this build.', 'Invite People');
    });

    bindClick('muteBtn', () => {
      muted = !muted;
      localStream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
      sendCallMediaState();
      renderCallBar();
    });
    bindClick('deafenBtn', () => {
      deafened = !deafened;
      document.querySelectorAll('#audioBin audio').forEach(audio => { audio.muted = deafened; });
      renderCallBar();
    });
    bindClick('cameraBtn', toggleCallCamera);
    bindClick('addCallPeopleBtn', () => openCallInviteModal('active'));
    bindClick('endCall', () => {
      if (callUi.notice && !activeCall && !voiceRoom) {
        dismissCallNotice();
        return;
      }
      if (activeCall) {
        dismissCallNotice();
        finishCall(true);
        return;
      }
      if (voiceRoom) {
        dismissCallNotice();
        leaveServerVoice();
      }
    });
    $('callAudioDevice')?.addEventListener('change', event => switchCallAudioInput(event.target.value));
    navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (activeCall) refreshCallAudioDevices(); });

    bindClick('acceptCall', async () => {
      const call = incomingCall;
      if (!call) return;
      if (activeCall) {
        showAlert('End your current call before accepting another one.', 'Call');
        return;
      }
      const button = $('acceptCall');
      const hint = $('incomingHint');
      if (button) button.disabled = true;
      callUi.mediaWarning = '';
      if (hint) hint.textContent = call.mediaType === 'video' ? 'Connecting microphone and camera…' : 'Connecting microphone…';
      try {
        await acquireCallMedia(call.mediaType === 'video');
      } catch (error) {
        if (hint) hint.textContent = voiceErrorMessage(error);
        if (button) button.disabled = false;
        return;
      }
      if (incomingCall?.callId !== call.callId) {
        if (voiceRoom) stopCallCamera();
        else stopMic();
        if (button) button.disabled = false;
        return;
      }
      dismissIncomingCall(call.callId);
      dismissCallNotice();
      activeCall = {
        id: call.callId,
        participants: new Set([...(call.participants || [call.from]), me?.username].filter(Boolean)),
        invited: new Set(),
        declined: new Set(),
        type: call.typeName === 'group' ? 'group' : 'private',
        mediaType: call.mediaType === 'video' ? 'video' : 'audio'
      };
      callUi.mediaState = {};
      send({ type: 'call_accept', callId: call.callId });
      if (button) button.disabled = false;
      await startCall();
    });
    bindClick('declineCall', () => {
      if (!incomingCall) return;
      const callId = incomingCall.callId;
      send({ type: 'call_decline', callId });
      dismissIncomingCall(callId);
    });

    $('callInviteClose')?.addEventListener('click', closeCallInviteModal);
    $('callInviteCancel')?.addEventListener('click', closeCallInviteModal);
    $('callInviteSend')?.addEventListener('click', submitCallInvite);
    $('callInviteSearch')?.addEventListener('input', renderCallInviteModal);
    $('callInviteList')?.addEventListener('change', event => {
      const input = event.target.closest('input[data-user]');
      if (!input) return;
      if (input.checked) {
        if (callUi.inviteSelected.size >= callInviteCapacity()) {
          input.checked = false;
          callUi.inviteMessage = `This call can include up to ${callParticipantLimit} people.`;
          renderCallInviteModal();
          return;
        }
        callUi.inviteSelected.add(input.dataset.user);
      } else {
        callUi.inviteSelected.delete(input.dataset.user);
      }
      callUi.inviteMessage = '';
      renderCallInviteModal();
    });
    $('callTypeChoice')?.querySelectorAll('[data-call-media]').forEach(button => {
      button.addEventListener('click', () => {
        if (callUi.inviteMode !== 'new') return;
        callUi.inviteMedia = button.dataset.callMedia === 'video' ? 'video' : 'audio';
        renderCallInviteModal();
      });
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('callInviteModal')?.classList.contains('hidden')) closeCallInviteModal();
    });
  }

  function enhanceHandle() {
    const previousHandle = handle;
    handle = function (message) {
      if (message?.type === 'ready') {
        const limit = Number(message.maxCallParticipants);
        if (Number.isInteger(limit) && limit >= 2 && limit <= 25) callParticipantLimit = limit;
      }
      if (message && handleCallMessage(message)) return;
      if (message?.type === 'error' && callUi.inviteBusy) {
        callUi.inviteBusy = false;
        callInviteStatus(message.message || 'Could not invite that friend.');
        renderCallInviteModal();
        return;
      }
      return previousHandle(message);
    };
  }

  function exposeDebugState() {
    window.minecordCallState = () => ({
      activeCall: activeCall ? {
        id: activeCall.id,
        type: activeCall.type,
        mediaType: activeCall.mediaType,
        participants: [...activeCall.participants],
        invited: [...(activeCall.invited || [])],
        declined: [...(activeCall.declined || [])],
        mediaState: { ...callUi.mediaState }
      } : null,
      incomingCall: incomingCall ? { callId: incomingCall.callId, from: incomingCall.from, mediaType: incomingCall.mediaType, type: incomingCall.typeName } : null,
      queued: incomingQueue.length,
      voiceRoom,
      muted,
      deafened,
      cameraEnabled: callUi.cameraEnabled,
      hasLocalStream: Boolean(localStream),
      peers: [...callPeers.keys()].map(user => ({ user, connectionState: callPeers.get(user)?.connectionState || 'new' }))
    });
    window.minecordEndCall = () => finishCall(true);
    window.minecordCallStats = async () => {
      const peers = [];
      for (const [user, pc] of callPeers) {
        const stats = await pc.getStats().catch(() => null);
        let inboundAudio = false;
        let inboundVideo = false;
        let outboundAudio = false;
        let outboundVideo = false;
        stats?.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') inboundAudio = true;
          if (report.type === 'inbound-rtp' && report.kind === 'video') inboundVideo = true;
          if (report.type === 'outbound-rtp' && report.kind === 'audio') outboundAudio = true;
          if (report.type === 'outbound-rtp' && report.kind === 'video') outboundVideo = true;
        });
        peers.push({ user, connectionState: pc.connectionState, inboundAudio, inboundVideo, outboundAudio, outboundVideo });
      }
      return peers;
    };
  }

  enhanceIncomingCall();
  enhanceHandle();
  window.startCall = startCall;
  window.finishCall = finishCall;
  window.clearCallUi = clearCallUi;
  window.makeCallPeer = makeCallPeer;
  window.closeCallPeer = closeCallPeer;
  window.callSignal = callSignal;
  window.renderCallBar = renderCallBar;
  window.renderVoiceControls = renderVoiceControls;
  window.updateCall = renderCallBar;
  window.showCallNotice = showCallNotice;
  initCallButtons();
  exposeDebugState();
  renderCallBar();
})();
