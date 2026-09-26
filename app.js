(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const video = $('pipVideo'), canvas = $('pipCanvas');
  const defaults = {soundId:'chime', pattern:'single', interval:3, volume:0.2};
  const key = 'dog-attention-pip:v1';
  let settings; try {settings = {...defaults,...JSON.parse(localStorage.getItem(key)||'{}')};} catch {settings = {...defaults};}
  const clamp = (v,a,b) => Math.min(b,Math.max(a,Number.isFinite(+v)?+v:a));
  settings.interval=clamp(settings.interval,0.5,30); settings.volume=clamp(settings.volume,0,1);
  let ctx, gain, destination, source, active=false, looping=false, version=0, internalPlay=false;
  let stream, videoAvailable=false, recordedBuffer, savedBlob, pendingBlob, previewUrl;
  let recorder, micStream, recTimer, recordingBusy=false, preparingRecording=false;
  let restoring, decodedBlob, wantedSound=settings.soundId;
  const sounds = [
    {id:'chime',name:'Soft chime',duration:0.9},
    {id:'squeak',name:'Squeaky toy',duration:0.38},
    {id:'clicker',name:'Clicker',duration:0.16},
    {id:'kissy',name:'Kissy noise',duration:0.3},
    {id:'chirp',name:'Bird chirp',duration:0.5},
    {id:'trill',name:'Gentle trill',duration:0.65},
    {id:'whistle',name:'Whistle',duration:0.5}
  ];
  function note(message=''){ $('notice').textContent=message; }
  function persist(){ try {localStorage.setItem(key,JSON.stringify(settings));} catch {note('Settings cannot be saved in this browser session.');} }
  function eligible(){return recordedBuffer?[...sounds,{id:'recorded',name:'My recorded sound'}]:sounds;}
  function refreshSounds(){
    const selected=$('soundSel').value || wantedSound;
    $('soundSel').replaceChildren(...eligible().map(s=>new Option(s.name,s.id)));
    $('soundSel').value=eligible().some(s=>s.id===selected)?selected:'chime';
  }
  function update(){
    $('ctxPill').textContent=active?'Audio: playing':'Audio: ready';
    $('ctxPill').className='pill'+(active?' good':'');
    $('loopPill').textContent=looping?'Loop: running':'Loop: stopped';
    $('toggleLoopBtn').textContent=looping?'⏸ Pause loop':'⟳ Start loop';
    $('pipPill').textContent=document.pictureInPictureElement?'PiP: open':'PiP: closed';
    if('mediaSession' in navigator){
      navigator.mediaSession.playbackState=active?'playing':'paused';
      if('MediaMetadata' in window) navigator.mediaSession.metadata=new MediaMetadata({title:eligible().find(s=>s.id===$('soundSel').value)?.name || 'Look here!',artist:'Look here! • Photo sounds'});
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
        if(wantedSound==='recorded') $('soundSel').value='recorded';
      }catch{note('Your saved recording could not be read. Please record it again.');savedBlob=null;}
    }
  }
  async function ensureVideo(){
    if(!videoAvailable) return;
    internalPlay=true;
    try{ await video.play(); } finally {internalPlay=false;}
  }
  function stop(){
    version++; active=false; looping=false;
    if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();source=null;}
    video.pause(); $('recPreviewAudio').pause(); update();
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
  function makePattern(){
    const pattern=$('patternSel').value;
    const id=pattern==='random'?eligible()[Math.floor(Math.random()*eligible().length)].id:$('soundSel').value;
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
  async function play(repeat=false){
    if(recordingBusy) {note('Finish recording before playing a sound.');return;}
    stop(); const ticket=version;
    await ensureAudio(); if(ticket!==version)return;
    const clip=makePattern();
    let buffer=clip;
    if(repeat){
      buffer=ctx.createBuffer(clip.numberOfChannels,clip.length+Math.round(settings.interval*ctx.sampleRate),ctx.sampleRate);
      for(let ch=0;ch<clip.numberOfChannels;ch++) buffer.getChannelData(ch).set(clip.getChannelData(ch));
    }
    await ensureVideo(); if(ticket!==version) {if(!active)video.pause();return;}
    source=ctx.createBufferSource(); source.buffer=buffer;source.loop=repeat;source.connect(gain);
    active=true;looping=repeat;
    source.onended=()=>{if(ticket===version){source.disconnect();source=null;active=false;looping=false;video.pause();update();}};
    source.start();note();update();
  }
  async function next(){
    const list=eligible(), i=list.findIndex(s=>s.id===$('soundSel').value);
    $('soundSel').value=list[(i+1)%list.length].id;
    wantedSound=settings.soundId=$('soundSel').value;persist();await play(looping);
  }
  const run=fn=> (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{stop();note(e.message||'That did not work. Please try again.');});
  function setupMediaSession(){
    if(!('mediaSession' in navigator))return;
    for(const [action,handler] of Object.entries({play:run(()=>play(false)),pause:stop,stop,nexttrack:run(next)})){
      try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
    }
  }
  video.addEventListener('play',()=>{if(!internalPlay&&!active)run(()=>play(false))();});
  video.addEventListener('pause',()=>{if(active)stop();});
  video.addEventListener('leavepictureinpicture',()=>{stop();update();});
  video.addEventListener('enterpictureinpicture',update);
  async function float(){
    await ensureAudio();
    if(!videoAvailable)throw Error('Floating video is unavailable here. You can still use Play and Loop on this page.');
    await ensureVideo();
    try{
      if(document.pictureInPictureEnabled&&video.requestPictureInPicture){await video.requestPictureInPicture();}
      else if(video.webkitSupportsPresentationMode?.('picture-in-picture')){video.webkitSetPresentationMode('picture-in-picture');}
      else throw Error('This browser does not offer floating video. Try Fullscreen video in Help, then press Home, or use the on-page controls.');
    }catch(e){if(!active)video.pause();throw e;}
    if(!active)video.pause();update();
    note('Open your camera app. Tap the floating video to show Play and Next. Available controls depend on your phone.');
  }
  async function fullscreen(){
    await ensureAudio();await ensureVideo();
    video.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:10;background:#0b0f18';
    try{
      if(video.requestFullscreen)await video.requestFullscreen();
      else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
      else throw Error('Fullscreen video is unavailable in this browser.');
      if(!active) await play(true);
      note('Press Home to try system picture-in-picture, then open your camera.');
    }finally{video.style.cssText='position:fixed;left:-9999px;top:-9999px;width:1px;height:1px';}
  }
  // Existing database/key retained so earlier recordings survive this update.
  async function dbOperation(mode,fn){
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dog-attention-pip-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('recordings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return new Promise((resolve,reject)=>{const tx=db.transaction('recordings',mode);const req=fn(tx.objectStore('recordings'));let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('Recording could not be saved.'));};});
  }
  function showPreview(blob){
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=URL.createObjectURL(blob);$('recPreviewAudio').src=previewUrl;$('recPreviewAudio').style.display='';
    $('recPreviewAudio').volume=settings.volume;
    ['recPreviewBtn','recSaveBtn','recDiscardBtn'].forEach(id=>$(id).disabled=false);
  }
  function recordUI(busy){
    recordingBusy=busy;$('recStartBtn').disabled=busy;$('recStopBtn').disabled=!busy;
    ['onceBtn','nextBtn','toggleLoopBtn','pipLoopBtn'].forEach(id=>$(id).disabled=busy);
    if(busy) ['recPreviewBtn','recSaveBtn','recDiscardBtn'].forEach(id=>$(id).disabled=true);
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
        pendingBlob=blob;showPreview(blob);$('recPill').textContent='Recording: preview ready';note('Preview your recording, then choose Save & use.');
      };
      current.start();recTimer=setTimeout(()=>{if(current.state==='recording')current.stop();},10000);
      $('recPill').textContent='Recording: now (max 10 s)';note('Recording… say a name or make a familiar sound.');
    }catch(e){releaseMic();recordUI(false);preparingRecording=false;note(e.name==='NotAllowedError'?'Microphone permission was denied. Allow it in your browser settings and try again.':e.message);}
  }
  function stopRecording(){
    preparingRecording=false;
    if(recorder?.state==='recording')recorder.stop();
    else{releaseMic();recordUI(false);note('Recording cancelled.');}
  }
  async function saveRecording(){
    if(!pendingBlob)return;
    await ensureAudio();
    const blob=pendingBlob, decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
    await dbOperation('readwrite',s=>s.put(blob,'custom'));
    stop();savedBlob=blob;decodedBlob=blob;recordedBuffer=decoded;refreshSounds();
    wantedSound=settings.soundId=$('soundSel').value='recorded';persist();update();
    $('recPill').textContent='Recording: saved';note('Saved on this device. Your recording is ready to play.');
  }
  async function deleteRecording(){
    await dbOperation('readwrite',s=>s.delete('custom'));
    stop();pendingBlob=savedBlob=decodedBlob=recordedBuffer=null;
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;
    $('recPreviewAudio').removeAttribute('src');$('recPreviewAudio').style.display='none';
    ['recPreviewBtn','recSaveBtn','recDiscardBtn'].forEach(id=>$(id).disabled=true);
    if(settings.soundId==='recorded')wantedSound=settings.soundId='chime';
    refreshSounds();persist();$('recPill').textContent='Recording: none';note('Recording deleted from this device.');
  }
  function draw(){
    const g=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    g.fillStyle='#0b0f18';g.fillRect(0,0,w,h);g.textAlign='center';
    g.font='64px system-ui';g.fillText('🐶   🐱   👶',w/2,130);
    g.fillStyle=active?'#7bd389':'#f2f4f8';g.font='bold 36px system-ui';g.fillText(active?(looping?'Sound · pause · repeat':'Look here!'):'Ready for your photo',w/2,218);
    g.fillStyle='#aab2c5';g.font='22px system-ui';
    g.fillText(eligible().find(s=>s.id===$('soundSel').value)?.name||'Choose a sound',w/2,275);
    if(videoAvailable)stream.getVideoTracks()[0]?.requestFrame?.();
  }
  refreshSounds();$('intervalInp').value=settings.interval;$('volRange').value=settings.volume;
  $('patternSel').value=['single','double','burst','random'].includes(settings.pattern)?settings.pattern:'single';
  $('soundSel').addEventListener('change',()=>{stop();wantedSound=settings.soundId=$('soundSel').value;persist();update();});
  $('patternSel').addEventListener('change',()=>{const wasLooping=looping;settings.pattern=$('patternSel').value;persist();if(wasLooping)run(()=>play(true))();});
  $('intervalInp').addEventListener('change',()=>{settings.interval=clamp($('intervalInp').value||3,0.5,30);$('intervalInp').value=settings.interval;persist();if(looping)run(()=>play(true))();});
  $('volRange').addEventListener('input',()=>{settings.volume=clamp($('volRange').value,0,1);if(gain)gain.gain.setTargetAtTime(settings.volume,ctx.currentTime,0.01);$('recPreviewAudio').volume=settings.volume;persist();});
  $('onceBtn').onclick=run(()=>play());$('nextBtn').onclick=run(next);$('stopBtn').onclick=()=>{stop();if(recordingBusy)stopRecording();note();};
  $('toggleLoopBtn').onclick=run(()=>looping?stop():play(true));$('pipBtn').onclick=run(float);
  $('pipLoopBtn').onclick=run(async()=>{await float();await play(true);});$('fsBtn').onclick=run(fullscreen);
  $('recStartBtn').onclick=startRecording;$('recStopBtn').onclick=stopRecording;
  $('recPreviewBtn').onclick=run(async()=>{stop();$('recPreviewAudio').currentTime=0;await $('recPreviewAudio').play();});
  $('recPreviewAudio').addEventListener('play',()=>{if(active){stop();$('recPreviewAudio').play().catch(()=>{});}});
  $('recSaveBtn').onclick=run(saveRecording);$('recDiscardBtn').onclick=run(deleteRecording);
  window.addEventListener('keydown',e=>{
    if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,button,a,[contenteditable]'))return;
    const actions={' ':()=>play(),n:next,l:()=>looping?stop():play(true),s:stop,p:float,f:fullscreen};
    const action=actions[e.key.toLowerCase()];if(action){e.preventDefault();run(action)();}
  });
  window.addEventListener('pagehide',()=>{stop();if(recordingBusy)stopRecording();});
  restoring=dbOperation('readonly',s=>s.get('custom')).then(blob=>{
    if(!blob)return;savedBlob=pendingBlob=blob;showPreview(blob);$('recPill').textContent='Recording: saved';
    // Decode without requesting microphone permission or resuming an AudioContext.
    const AC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(AC)return blob.arrayBuffer().then(arr=>new AC(1,1,48000).decodeAudioData(arr)).then(buffer=>{
      recordedBuffer=buffer;refreshSounds();if(wantedSound==='recorded')$('soundSel').value='recorded';update();
    });
  }).catch(()=>{});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>note('Offline setup is unavailable. The site still works while connected.'));
  draw();update();
})();
