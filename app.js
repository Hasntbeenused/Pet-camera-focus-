(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const video = $('pipVideo'), canvas = $('pipCanvas');
  const defaults = {soundId:'chime', pattern:'single', interval:3, volume:0.2, loop:false};
  const key = 'dog-attention-pip:v1';
  let settings; try {settings = {...defaults,...JSON.parse(localStorage.getItem(key)||'{}')};} catch {settings = {...defaults};}
  const clamp = (v,a,b) => Math.min(b,Math.max(a,Number.isFinite(+v)?+v:a));
  settings.interval=clamp(settings.interval,0.5,30); settings.volume=clamp(settings.volume,0,1);
  let ctx, gain, destination, source, active=false, looping=false, version=0, internalPlay=false;
  let stream, videoAvailable=false, recordedBuffer, savedBlob, pendingBlob;
  let recorder, micStream, recTimer, recordingBusy=false, preparingRecording=false;
  let restoring, decodedBlob, selectedId=settings.soundId;
  let idleFrameCallback=null, idlePauseTimer=null;
  const sounds = [
    {id:'chime',icon:'🔔',name:'Soft chime',duration:0.9},
    {id:'squeak',icon:'🦆',name:'Squeaky toy',duration:0.38},
    {id:'clicker',icon:'👆',name:'Clicker',duration:0.16},
    {id:'kissy',icon:'💋',name:'Kissy noise',duration:0.3},
    {id:'chirp',icon:'🐦',name:'Bird chirp',duration:0.5},
    {id:'trill',icon:'🎵',name:'Gentle trill',duration:0.65},
    {id:'whistle',icon:'📣',name:'Whistle',duration:0.5}
  ];
  function note(message=''){ $('notice').textContent=message; }
  function persist(){ try {localStorage.setItem(key,JSON.stringify(settings));} catch {note('Settings cannot be saved in this browser session.');} }
  function eligible(){return recordedBuffer?[...sounds,{id:'recorded',icon:'🎙️',name:'My recorded sound'}]:sounds;}
  function refreshSounds(){
    $('soundGrid').replaceChildren(...eligible().map(sound=>{
      const button=document.createElement('button');
      button.className='sound';button.dataset.sound=sound.id;
      button.title=sound.name;button.setAttribute('aria-label',sound.name);
      button.setAttribute('aria-pressed',String(sound.id===selectedId));
      button.disabled=recordingBusy;
      const symbol=document.createElement('span');symbol.textContent=sound.icon;
      symbol.setAttribute('aria-hidden','true');button.append(symbol);
      button.onclick=run(async()=>{selectedId=sound.id;await play(false,true);});
      return button;
    }));
  }
  function update(){
    for(const button of $('soundGrid').children) button.setAttribute('aria-pressed',String(button.dataset.sound===selectedId));
    $('pipBtn').textContent=document.pictureInPictureElement?'▣ Floating player open':'▣ Open floating player';
    if('mediaSession' in navigator){
      navigator.mediaSession.playbackState=active?'playing':'paused';
      if('MediaMetadata' in window) navigator.mediaSession.metadata=new MediaMetadata({title:eligible().find(s=>s.id===selectedId)?.name || 'Look here!',artist:'Look here! • Photo sounds'});
    }
    draw();
  }
  // One output path: the video carries the audio. Use the speaker directly only
  // when canvas/video streams are unavailable; otherwise it would sound doubled.
  async function ensureAudio(){
    if(!ctx){
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(!AudioContext) throw Error('Audio playback is not supported by this browser.');
      ctx=new AudioContext(); gain=ctx.createGain(); gain.gain.value=settings.volume;
      try{
        destination=ctx.createMediaStreamDestination();
        stream=canvas.captureStream(5);
        stream=new MediaStream([...stream.getVideoTracks(),...destination.stream.getAudioTracks()]);
        video.srcObject=stream; video.muted=false; videoAvailable=true;
        gain.connect(destination);
      }catch {gain.connect(ctx.destination);videoAvailable=false;}
      setupMediaSession();
    }
    if(ctx.state!=='running') await ctx.resume();
    if(restoring) await restoring;
    if(savedBlob && decodedBlob!==savedBlob){
      try{
        recordedBuffer=await ctx.decodeAudioData(await savedBlob.arrayBuffer()); decodedBlob=savedBlob;
        refreshSounds();

      }catch{note('Your saved recording could not be read. Please record it again.');savedBlob=null;}
    }
  }
  async function ensureVideo(){
    cancelIdlePause();
    if(!videoAvailable) return;
    internalPlay=true;
    try{ await video.play(); } finally {internalPlay=false;}
  }
  function cancelIdlePause(){
    clearTimeout(idlePauseTimer);idlePauseTimer=null;
    if(idleFrameCallback!==null){video.cancelVideoFrameCallback?.(idleFrameCallback);idleFrameCallback=null;}
  }
  function pauseOnIdleFrame(){
    cancelIdlePause();
    if(video.paused||!videoAvailable){draw();return;}
    const ticket=version;
    const finish=()=>{
      cancelIdlePause();
      if(ticket===version&&!active)video.pause();
    };
    // Keep audio stopped, but let the idle card reach the video compositor
    // before freezing the video. Two frames avoid retaining a queued old frame.
    if(video.requestVideoFrameCallback){
      idleFrameCallback=video.requestVideoFrameCallback(()=>{
        if(ticket!==version||active)return;
        idleFrameCallback=video.requestVideoFrameCallback(finish);
        draw();
      });
    }
    draw();
    idlePauseTimer=setTimeout(finish,500);
  }
  function stop(){
    cancelIdlePause();
    version++; active=false; looping=false;
    if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();source=null;}
    update();pauseOnIdleFrame();
  }
  function makeSound(id){
    if(id==='recorded' && recordedBuffer) return recordedBuffer;
    const sound=sounds.find(s=>s.id===id)||sounds[0], rate=ctx.sampleRate;
    const buffer=ctx.createBuffer(1,Math.ceil(sound.duration*rate),rate), data=buffer.getChannelData(0);
    let phase=0;
    for(let i=0;i<data.length;i++){
      const t=i/rate, u=t/sound.duration, envelope=Math.min(1,t/0.012)*Math.min(1,(sound.duration-t)/0.055);
      let v=0;
      switch(sound.id){
        case 'chime':v=(Math.sin(2*Math.PI*660*t)+0.35*Math.sin(2*Math.PI*990*t))*Math.exp(-4*t)*0.4;break;
        case 'squeak':phase+=2*Math.PI*(950+1100*Math.sin(Math.PI*u))/rate;v=(Math.sin(phase)+0.2*Math.sin(3*phase))*0.48;break;
        case 'whistle':phase+=2*Math.PI*(1000+1100*u)/rate;v=Math.sin(phase)*0.5;break;
        case 'chirp':phase+=2*Math.PI*(1400+1100*Math.sin(u*Math.PI*4))/rate;v=Math.sin(phase)*Math.pow(Math.sin(Math.PI*u*2),2)*0.45;break;
        case 'trill':v=Math.sin(2*Math.PI*1050*t)*(0.6+0.4*Math.sin(2*Math.PI*12*t))*0.4;break;
        case 'kissy':v=(Math.random()*2-1)*Math.exp(-10*u)*0.7;break;
        case 'clicker':{const d=t<0.075?t:t-0.075;v=(Math.random()*2-1)*Math.exp(-d*180)*0.55;break;}
      }
      data[i]=v*envelope;
    }
    return buffer;
  }
  function makePattern(preview){
    const pattern=preview?'single':$('patternSel').value;
    const id=selectedId;
    const input=makeSound(id), count=pattern==='double'?2:pattern==='burst'?5:1;
    const gap=0.12, duration=input.duration*count+gap*(count-1);
    const output=ctx.createBuffer(input.numberOfChannels,Math.ceil(duration*ctx.sampleRate),ctx.sampleRate);
    for(let ch=0;ch<input.numberOfChannels;ch++){
      const dest=output.getChannelData(ch), src=input.getChannelData(ch);
      // decodeAudioData resamples to this context's rate, preserving recorded pitch.
      for(let n=0;n<count;n++) dest.set(src,Math.round(n*(input.duration+gap)*ctx.sampleRate));
    }
    return output;
  }
  async function play(repeat=settings.loop, preview=false){
    if(recordingBusy) {note('Finish recording before playing a sound.');return;}
    stop(); const ticket=version;
    await ensureAudio(); if(ticket!==version)return;
    const clip=makePattern(preview);
    let buffer=clip;
    if(repeat){
      buffer=ctx.createBuffer(clip.numberOfChannels,clip.length+Math.round(settings.interval*ctx.sampleRate),ctx.sampleRate);
      for(let ch=0;ch<clip.numberOfChannels;ch++) buffer.getChannelData(ch).set(clip.getChannelData(ch));
    }
    await ensureVideo(); if(ticket!==version) {if(!active)video.pause();return;}
    source=ctx.createBufferSource(); source.buffer=buffer;source.loop=repeat;source.connect(gain);
    active=true;looping=repeat;
    source.onended=()=>{if(ticket===version){source.disconnect();source=null;active=false;looping=false;update();pauseOnIdleFrame();}};
    source.start();settings.soundId=selectedId;persist();note();update();
  }
  async function next(){
    const list=eligible(), i=list.findIndex(s=>s.id===selectedId);
    selectedId=list[(i+1)%list.length].id;
    await play(settings.loop);
  }
  const run=fn=> (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{stop();note(e.message||'That did not work. Please try again.');});
  function setupMediaSession(){
    if(!('mediaSession' in navigator))return;
    for(const [action,handler] of Object.entries({play:run(()=>play(settings.loop)),pause:stop,stop,nexttrack:run(next)})){
      try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
    }
  }
  video.addEventListener('play',()=>{if(!internalPlay&&!active)run(()=>play(settings.loop))();});
  video.addEventListener('pause',()=>{if(active)stop();});
  video.addEventListener('leavepictureinpicture',()=>{stop();update();});
  video.addEventListener('enterpictureinpicture',update);
  async function float(){
    await ensureAudio();
    if(!videoAvailable)throw Error('Floating video is unavailable. Try Fullscreen fallback in Advanced.');
    await ensureVideo();
    try{
      if(document.pictureInPictureEnabled&&video.requestPictureInPicture){await video.requestPictureInPicture();}
      else if(video.webkitSupportsPresentationMode?.('picture-in-picture')){video.webkitSetPresentationMode('picture-in-picture');}
      else throw Error('Floating video is unavailable. Try Fullscreen fallback in Advanced.');
    }catch(e){if(!active)video.pause();throw e;}
    if(settings.loop) await play(true);
    else if(!active)pauseOnIdleFrame();
    update();note();
  }
  async function fullscreen(){
    await ensureAudio();await ensureVideo();
    video.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:10;background:#0b0f18';
    try{
      if(video.requestFullscreen)await video.requestFullscreen();
      else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
      else throw Error('Fullscreen video is unavailable in this browser.');
      if(!active) await play(settings.loop);
      note('Press Home, then open your camera.');
    }finally{video.style.cssText='position:fixed;left:-9999px;top:-9999px;width:1px;height:1px';}
  }
  // Existing database/key retained so earlier recordings survive this update.
  async function dbOperation(mode,fn){
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dog-attention-pip-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('recordings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return new Promise((resolve,reject)=>{const tx=db.transaction('recordings',mode);const req=fn(tx.objectStore('recordings'));let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('Recording could not be saved.'));};});
  }
  function showRecording(){
    ['recSaveBtn','recDiscardBtn'].forEach(id=>$(id).disabled=false);
  }
  function recordUI(busy){
    recordingBusy=busy;$('recStartBtn').disabled=busy;$('recStopBtn').disabled=!busy;
    $('pipBtn').disabled=busy;$('fsBtn').disabled=busy;
    for(const button of $('soundGrid').children) button.disabled=busy;
    if(busy) ['recSaveBtn','recDiscardBtn'].forEach(id=>$(id).disabled=true);
  }
  function releaseMic(){clearTimeout(recTimer);micStream?.getTracks().forEach(t=>t.stop());micStream=null;}
  async function startRecording(){
    if(recordingBusy)return;
    stop();recordUI(true);preparingRecording=true;note('Allow microphone access to record.');
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Recording needs a browser with microphone support and an HTTPS connection.');
      micStream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!preparingRecording){releaseMic();recordUI(false);return;}
      preparingRecording=false;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(m=>MediaRecorder.isTypeSupported(m));
      const current=new MediaRecorder(micStream,mime?{mimeType:mime}:undefined);recorder=current;
      const chunks=[];
      current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      current.onerror=()=>{releaseMic();recordUI(false);note('Recording failed. Please try again.');};
      current.onstop=()=>{
        releaseMic();recordUI(false);
        const blob=new Blob(chunks,{type:current.mimeType});
        if(!blob.size){note('No sound was recorded. Please try again.');return;}
        pendingBlob=blob;showRecording();$('recPill').textContent='Ready to save';note();
      };
      current.start();recTimer=setTimeout(()=>{if(current.state==='recording')current.stop();},10000);
      $('recPill').textContent='Recording…';note();
    }catch(e){releaseMic();recordUI(false);preparingRecording=false;note(e.name==='NotAllowedError'?'Microphone permission was denied. Allow it in your browser settings and try again.':e.message);}
  }
  function stopRecording(){
    preparingRecording=false;
    if(recorder?.state==='recording')recorder.stop();
    else{releaseMic();recordUI(false);$('recPill').textContent='';note();}
  }
  async function saveRecording(){
    if(!pendingBlob)return;
    await ensureAudio();
    const blob=pendingBlob, decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
    await dbOperation('readwrite',s=>s.put(blob,'custom'));
    stop();savedBlob=blob;decodedBlob=blob;recordedBuffer=decoded;refreshSounds();
    selectedId='recorded';$('recPill').textContent='Saved';
    await play(false,true);$('recordingMenu').open=false;
  }
  async function deleteRecording(){
    await dbOperation('readwrite',s=>s.delete('custom'));
    stop();pendingBlob=savedBlob=decodedBlob=recordedBuffer=null;
    ['recSaveBtn','recDiscardBtn'].forEach(id=>$(id).disabled=true);
    if(selectedId==='recorded')selectedId='chime';
    if(settings.soundId==='recorded')settings.soundId='chime';
    refreshSounds();persist();update();$('recPill').textContent='';note();
  }
  function draw(){
    const g=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const sound=eligible().find(s=>s.id===selectedId);
    // The instruction remains in every frame, including the final frame a
    // browser might retain when its own Pause control freezes the stream.
    g.fillStyle='#e3efe7';g.fillRect(0,0,w,h);g.textAlign='center';
    g.font='76px system-ui';g.fillText(sound?.icon||'🔔',w/2,112);
    g.fillStyle='#142c20';g.font='bold 42px system-ui';
    g.fillText('Press ▶ to play',w/2,190);
    g.font='26px system-ui';g.fillText(sound?.name||'Look here!',w/2,239);
    g.fillStyle='#465e50';g.font='22px system-ui';
    g.fillText(active?(looping?'Repeating':'Playing'):'Tap player to show controls',w/2,302);
    if(videoAvailable)stream.getVideoTracks()[0]?.requestFrame?.();
  }
  if(!sounds.some(sound=>sound.id===selectedId)&&selectedId!=='recorded')selectedId='chime';
  settings.loop=settings.loop===true;
  refreshSounds();$('intervalInp').value=settings.interval;$('volRange').value=settings.volume;
  $('loopInp').checked=settings.loop;
  $('patternSel').value=['single','double','burst'].includes(settings.pattern)?settings.pattern:'single';
  $('patternSel').addEventListener('change',()=>{const wasLooping=looping;settings.pattern=$('patternSel').value;persist();if(wasLooping)run(()=>play(true))();});
  $('loopInp').addEventListener('change',()=>{
    settings.loop=$('loopInp').checked;persist();
    if(active&&document.pictureInPictureElement)run(()=>play(settings.loop))();
    else if(looping)stop();
  });
  $('intervalInp').addEventListener('change',()=>{settings.interval=clamp($('intervalInp').value||3,0.5,30);$('intervalInp').value=settings.interval;persist();if(looping)run(()=>play(true))();});
  $('volRange').addEventListener('input',()=>{settings.volume=clamp($('volRange').value,0,1);if(gain)gain.gain.setTargetAtTime(settings.volume,ctx.currentTime,0.01);persist();});
  $('pipBtn').onclick=run(float);$('fsBtn').onclick=run(fullscreen);
  $('recStartBtn').onclick=startRecording;$('recStopBtn').onclick=stopRecording;
  $('recSaveBtn').onclick=run(saveRecording);$('recDiscardBtn').onclick=run(deleteRecording);
  $('recordingMenu').addEventListener('toggle',()=>{if(!$('recordingMenu').open&&recordingBusy)stopRecording();});
  window.addEventListener('pagehide',()=>{stop();if(recordingBusy)stopRecording();});
  restoring=dbOperation('readonly',s=>s.get('custom')).then(blob=>{
    if(!blob){if(selectedId==='recorded'){selectedId='chime';refreshSounds();update();}return;}
    savedBlob=pendingBlob=blob;showRecording();$('recPill').textContent='Saved';
    // Decode without requesting microphone permission or resuming an AudioContext.
    const AC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(AC)return blob.arrayBuffer().then(arr=>new AC(1,1,48000).decodeAudioData(arr)).then(buffer=>{
      recordedBuffer=buffer;refreshSounds();update();
    });
  }).catch(()=>{});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>note('Offline setup is unavailable. The site still works while connected.'));
  draw();update();
})();
