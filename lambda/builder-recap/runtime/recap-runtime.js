(()=>{'use strict';
const CONTRACT={normalVolume:.28,replayVolume:.055,fadeMs:850,transitionMs:300,replayFadeMs:550,playTimeoutMs:3000,soundtrack:'https://d1dcueurs1xl4v.cloudfront.net/hitslab-sport-football-baseball-music-334834.mp3'};
const END_HOLD_MS={2:1000,4:2000,5:2000,6:3000,8:2000};
const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
const scenes=qa('.recap-scenes>[data-scene-type]'),audio=q('[data-role="soundtrack"]'),btn=q('[data-role="play-pause"]'),bar=q('[data-role="progress-bar"]'),progressTrack=q('[data-role="progress-track"]'),pt=q('[data-role="progress-text"]'),startGate=q('[data-role="start-gate"]'),startBtn=q('[data-role="start-recap"]');
const fxFlash=q('[data-role="fx-flash"]'),fxRing=q('[data-role="fx-ring"]'),fxReaction=q('[data-role="fx-reaction"]'),fxReactionFace=q('[data-role="fx-reaction-face"]'),fxReactionCopy=q('[data-role="fx-reaction-copy"]'),fxLossStamp=q('[data-role="fx-loss-stamp"]'),fxParticles=q('[data-role="fx-particles"]'),fxCoins=q('[data-role="fx-coins"]'),fxEmojis=q('[data-role="fx-emojis"]');
const globalPnl=q('[data-role="global-pnl"]'),globalPnlValue=q('[data-role="global-pnl-value"]'),globalPnlTime=q('[data-role="global-pnl-time"]'),globalPnlNeedle=q('[data-role="global-pnl-needle"]');
let currentGlobalPnl=0,currentGlobalPnlTime='';
let manifest={manifestVersion:'1.0',sceneRuntimeData:{}};try{manifest=JSON.parse(q('#recap-runtime-data').textContent)}catch(e){console.error('Invalid recap runtime manifest',e)}
let index=0,paused=false,timers=[],timeline=null,replayVideo=null,replayState=null,replayGeneration=0,audioFade=null,audioUnlocked=false,replayMediaPrimed=false,lastReplayStyle='',lastReplayCelebration='',lastReplayLossPayoff='';
let audioCtx=null,soundtrackSource=null,soundtrackGain=null;

audio.crossOrigin='anonymous';
audio.src=CONTRACT.soundtrack;
audio.volume=CONTRACT.normalVolume;

// Shared runner-name fitting for scene cards, replay headers and fast results.
// It runs locally in the rendered recap; no network or LLM call is involved.
const HORSE_FIT={
  2:{selector:'.s2-horse:not(.trifecta-selection)',min:14,lines:2},
  3:{selector:'.s3-horse:not(.trifecta-selection)',min:12,lines:2},
  5:{selector:'.s5-horse:not(.trifecta-selection)',min:10,lines:2},
  8:{selector:'.s8-horse:not(.trifecta-selection)',min:10,lines:2}
};
function fitHorseNames(){
  for(const scene of scenes){
    const cfg=HORSE_FIT[Number(scene.dataset.sceneType)];
    if(!cfg)continue;
    for(const el of qa(cfg.selector,scene)){
      el.style.fontSize='';
      const original=parseFloat(getComputedStyle(el).fontSize);
      if(!Number.isFinite(original)||!el.clientWidth)continue;
      // Give a card at most two lines of name; adjust text to real column width.
      const availableWidth=el.clientWidth;
      const fits=()=>{
        const style=getComputedStyle(el);
        const lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.15;
        return el.scrollWidth<=availableWidth+1&&el.scrollHeight<=lineHeight*cfg.lines+2;
      };
      if(fits())continue;
      let lo=Math.min(cfg.min,original),hi=original;
      el.style.overflowWrap='anywhere';
      for(let i=0;i<9;i++){
        const mid=(lo+hi)/2;
        el.style.fontSize=mid+'px';
        if(fits())lo=mid;else hi=mid;
      }
      el.style.fontSize=lo+'px';
    }
  }
}
window.addEventListener('resize',fitHorseNames);
if(document.fonts?.ready)document.fonts.ready.then(fitHorseNames);
requestAnimationFrame(fitHorseNames);

function initSoundtrackAudio(){
  if(soundtrackGain||!audio)return;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return;
  try{
    audioCtx=new AudioContextClass();
    soundtrackSource=audioCtx.createMediaElementSource(audio);
    soundtrackGain=audioCtx.createGain();
    soundtrackGain.gain.value=CONTRACT.normalVolume;
    soundtrackSource.connect(soundtrackGain);
    soundtrackGain.connect(audioCtx.destination);
    audio.volume=1;
  }catch(e){
    console.warn('Web Audio soundtrack unavailable',e);
    soundtrackSource=null;
    soundtrackGain=null;
    try{audioCtx?.close()}catch(_){}
    audioCtx=null;
    audio.volume=CONTRACT.normalVolume;
  }
}

function getSoundtrackLevel(){
  return soundtrackGain?soundtrackGain.gain.value:audio.volume;
}

function setSoundtrackLevel(value){
  if(soundtrackGain)soundtrackGain.gain.value=value;
  else audio.volume=value;
}

function later(fn,ms){const id=setTimeout(fn,ms);timers.push(id);return id}
function clearTimers(){timers.forEach(clearTimeout);timers=[]}
function reveal(root,name){qa(`[data-reveal="${name}"]`,root).forEach(x=>x.classList.add('is-visible'))}
function prepareScene1Close(root){const close=q('[data-reveal="close"]',root);if(!close)return [];const existing=qa('.s1-close-word',close);if(existing.length)return existing;const words=close.textContent.trim().split(/\s+/).filter(Boolean);close.innerHTML='';return words.map((word,i)=>{const span=document.createElement('span');span.className=`s1-close-word${i===words.length-1?' s1-back':''}`;span.textContent=word;close.appendChild(span);return span})}
function resetScene1Launch(root){qa('.s1-close-word',root).forEach(x=>x.classList.remove('is-on'));q('[data-role="s1-launch-shockwave"]',root)?.classList.remove('is-on');q('[data-role="s1-launch-flash"]',root)?.classList.remove('is-on');root.classList.remove('s1-launch-hit')}
function needle(root){const box=q('[data-pnl-to]',root),n=q('[data-role="pnl-needle"]',root);if(!box||!n)return;const v=Number(box.dataset.pnlTo)||0;n.style.left=`${Math.max(2,Math.min(98,50+(v/200)*48))}%`}
function setGlobalPnl(value,time='',visible=true){const v=Number(value)||0;currentGlobalPnl=v;if(time!==undefined&&time!==null&&time!=='')currentGlobalPnlTime=time;if(!globalPnl||!globalPnlValue||!globalPnlNeedle)return;globalPnlValue.textContent=v>0?`+$${Math.abs(v).toFixed(2).replace(/\.00$/,'')}`:v<0?`−$${Math.abs(v).toFixed(2).replace(/\.00$/,'')}`:'$0';globalPnlValue.classList.toggle('positive',v>0);globalPnlValue.classList.toggle('negative',v<0);if(globalPnlTime)globalPnlTime.textContent=currentGlobalPnlTime?`🕒 ${currentGlobalPnlTime.toUpperCase()}`:'';globalPnlNeedle.style.left=`${Math.max(2,Math.min(98,50+(v/200)*48))}%`;globalPnl.classList.toggle('is-visible',visible)}
function hideGlobalPnl(){globalPnl?.classList.remove('is-visible')}
function pnlBeforeScene(targetIndex){let value=0,time='';for(let i=0;i<targetIndex;i++){const root=scenes[i];if(!root)continue;const type=root.dataset.sceneType;if(type==='2'){const box=q('[data-pnl-to]',root);if(box){value=Number(box.dataset.pnlTo)||0;time=box.dataset.raceTime||time}}else if(type==='5'){qa('.s5-race',root).forEach(race=>{if(race.dataset.runningPnl!==undefined){value=Number(race.dataset.runningPnl)||0;time=race.dataset.raceTime||time}})}else if(type==='8'){qa('.s8-bet',root).forEach(bet=>{if(bet.dataset.runningPnl!==undefined){value=Number(bet.dataset.runningPnl)||0;time=bet.dataset.raceTime||time}})}}return {value,time}}
function flashFx(kind='win'){if(!fxFlash)return;fxFlash.classList.remove('win','loss','big','go');fxFlash.classList.add(kind);void fxFlash.offsetWidth;fxFlash.classList.add('go')}
function resetGlobalFx(){if(fxFlash)fxFlash.classList.remove('go','win','loss','big');[fxRing,fxReaction,fxLossStamp].forEach(el=>el?.classList.remove('go'));if(fxParticles)fxParticles.innerHTML='';if(fxCoins)fxCoins.innerHTML='';if(fxEmojis)fxEmojis.innerHTML=''}
function replayLayer(root){return q('[data-role="replay-fx"]',root)}
function clearReplayFx(root){const layer=replayLayer(root);if(layer)layer.innerHTML='';const comment=q('[data-role="replay-comment"]',root);if(comment){comment.className='s3-comment';comment.textContent=''}}
function pickDifferent(items,last){const pool=items.filter(x=>x!==last);return (pool.length?pool:items)[Math.floor(Math.random()*(pool.length?pool:items).length)]}
function replayCommentFx(comment,text){if(!comment)return;const styles=['slam','zoom','swipe','pulse','burst'],style=pickDifferent(styles,lastReplayStyle);lastReplayStyle=style;comment.textContent=text;comment.className=`s3-comment style-${style}`;void comment.offsetWidth;comment.classList.add('is-visible')}
function replayEmojiFx(root,chars=['🤞','👀','😬','🔥']){const layer=replayLayer(root);if(!layer)return;const e=document.createElement('i');e.className='s3-replay-emoji';e.textContent=chars[Math.floor(Math.random()*chars.length)];const rightSide=Math.random()>=.5,edge=4+Math.random()*16,top=24+Math.random()*50;if(rightSide){e.style.right=`${edge}%`}else{e.style.left=`${edge}%`}e.style.top=`${top}%`;e.style.setProperty('--r',`${-18+Math.random()*36}deg`);e.style.setProperty('--d',`${.62+Math.random()*.18}s`);layer.appendChild(e);e.addEventListener('animationend',()=>e.remove(),{once:true})}
function replayStreakFx(root,n=7){const layer=replayLayer(root);if(!layer)return;for(let i=0;i<n;i++){const s=document.createElement('i');s.className='s3-replay-streak';s.style.top=`${22+Math.random()*62}%`;s.style.animationDelay=`${Math.random()*.12}s`;s.style.height=`${2+Math.random()*3}px`;layer.appendChild(s);s.addEventListener('animationend',()=>s.remove(),{once:true})}}
function replayParticleFx(root,n=26){const layer=replayLayer(root);if(!layer)return;for(let i=0;i<n;i++){const p=document.createElement('i'),a=Math.random()*Math.PI*2,dist=90+Math.random()*330;p.className='s3-replay-particle';p.style.setProperty('--x',`${Math.cos(a)*dist}px`);p.style.setProperty('--y',`${Math.sin(a)*dist}px`);p.style.setProperty('--size',`${4+Math.random()*9}px`);p.style.setProperty('--d',`${.65+Math.random()*.35}s`);p.style.animationDelay=`${Math.random()*.08}s`;layer.appendChild(p);p.addEventListener('animationend',()=>p.remove(),{once:true})}}
function replayCoinExplosion(root,n=30){const layer=replayLayer(root);if(!layer)return;for(let i=0;i<n;i++){const c=document.createElement('i'),a=Math.random()*Math.PI*2,dist=150+Math.random()*430;c.className='s3-replay-coin';c.style.setProperty('--x',`${Math.cos(a)*dist}px`);c.style.setProperty('--y',`${Math.sin(a)*dist}px`);c.style.setProperty('--size',`${22+Math.random()*34}px`);c.style.setProperty('--scale',`${.7+Math.random()*.75}`);c.style.setProperty('--spin',`${(Math.random()>.5?1:-1)*(540+Math.random()*1080)}deg`);c.style.setProperty('--rot',`${(Math.random()>.5?1:-1)*(180+Math.random()*720)}deg`);c.style.setProperty('--d',`${.95+Math.random()*.45}s`);c.style.animationDelay=`${Math.random()*.1}s`;layer.appendChild(c);c.addEventListener('animationend',()=>c.remove(),{once:true})}}
function replayConfettiFx(root,n=38){const layer=replayLayer(root);if(!layer)return;const colours=['#ffd65a','#fff4b4','#8affb8','#ffffff'];for(let i=0;i<n;i++){const c=document.createElement('i');c.className='s3-replay-confetti';c.style.left=`${2+Math.random()*96}%`;c.style.setProperty('--w',`${6+Math.random()*9}px`);c.style.setProperty('--h',`${12+Math.random()*18}px`);c.style.setProperty('--c',colours[i%colours.length]);c.style.setProperty('--drift',`${-90+Math.random()*180}px`);c.style.setProperty('--rot',`${(Math.random()>.5?1:-1)*(540+Math.random()*900)}deg`);c.style.setProperty('--d',`${1.05+Math.random()*.55}s`);c.style.animationDelay=`${Math.random()*.18}s`;layer.appendChild(c);c.addEventListener('animationend',()=>c.remove(),{once:true})}}
function replayRingFx(root){const layer=replayLayer(root);if(!layer)return;const r=document.createElement('i');r.className='s3-replay-ring';layer.appendChild(r);r.addEventListener('animationend',()=>r.remove(),{once:true})}
function replayFlashFx(root){const layer=replayLayer(root);if(!layer)return;const f=document.createElement('i');f.className='s3-replay-flash';layer.appendChild(f);f.addEventListener('animationend',()=>f.remove(),{once:true})}
function replayPayoffFx(root,betType='WIN'){const layer=replayLayer(root);if(!layer)return;const type=String(betType||'').trim().toUpperCase();const words=type==='PLACE'?['PLACE BET WON!']:type==='WIN'?['WINNER!','YESSS!','BOOM!','GOT IT!','GET IN!']:['BET WON!'],el=document.createElement('div');el.className='s3-replay-payoff';el.textContent=words[Math.floor(Math.random()*words.length)];layer.appendChild(el);el.addEventListener('animationend',()=>el.remove(),{once:true})}
function replayLossPayoffFx(root){const layer=replayLayer(root);if(!layer)return;const words=['NOOOO!','DO\'H!','WTF?!','PATHETIC!','USELESS!','OH COME ON!','BRUTAL!','SHOCKER!'],word=pickDifferent(words,lastReplayLossPayoff),el=document.createElement('div');lastReplayLossPayoff=word;el.className='s3-replay-payoff loss';el.textContent=word;layer.appendChild(el);el.addEventListener('animationend',()=>el.remove(),{once:true})}
function replayLossFx(root){replayLossPayoffFx(root);replayEmojiFx(root,['😩','😭','🤦‍♂️','💸','😬','🙈']);replayEmojiFx(root,['😩','😭','🤦‍♂️','💸','😬','🙈']);replayEmojiFx(root,['😩','😭','🤦‍♂️','💸','😬','🙈']);replayEmojiFx(root,['😩','😭','🤦‍♂️','💸','😬','🙈']);replayEmojiFx(root,['😩','😭','🤦‍♂️','💸','😬','🙈'])}
function replayCelebrationFx(root,betType){const packages=['gold','emoji','confetti','money','racing'],kind=pickDifferent(packages,lastReplayCelebration);lastReplayCelebration=kind;replayFlashFx(root);replayPayoffFx(root,betType);replayCoinExplosion(root,42);if(kind==='gold'){replayRingFx(root);replayParticleFx(root,44)}else if(kind==='emoji'){replayParticleFx(root,24);replayEmojiFx(root,['🙌','🔥','🤑','🏆','🎉']);replayEmojiFx(root,['🙌','🔥','🤑','🏆','🎉'])}else if(kind==='confetti'){replayConfettiFx(root,44);replayRingFx(root)}else if(kind==='money'){replayConfettiFx(root,24);replayEmojiFx(root,['🤑','💰','🏆'])}else{replayStreakFx(root,12);replayRingFx(root);replayParticleFx(root,34);replayEmojiFx(root,['🏇','🔥','🏆'])}}
function resetSceneState(root){if(!root)return;resetScene1Launch(root);root.classList.remove('is-active','is-entering','is-exiting','play','fx-replayEnter','fx-videoFade','fx-positiveFinale','fx-negativeFinale','fx-breakEvenFinale');(root.dataset.fxPackage||'').split(/\s+/).filter(Boolean).forEach(id=>root.classList.remove(`fx-${id}`));qa('[data-reveal]',root).forEach(el=>el.classList.remove('is-visible'));qa('.s2-dot',root).forEach(el=>el.classList.remove('is-on'));qa('.s5-race',root).forEach(race=>{(race.dataset.fxPackage||'').split(/\s+/).filter(Boolean).forEach(id=>race.classList.remove(`fx-${id}`))});qa('.s8-bet',root).forEach(bet=>bet.classList.remove('is-resolved'));q('[data-role="s8-footer"]',root)?.classList.remove('is-visible');qa('[data-role="replay-exit-veil"]',root).forEach(el=>el.classList.remove('is-visible'));qa('[data-role="replay-loading"]',root).forEach(el=>el.classList.remove('is-hidden'));clearReplayFx(root);qa('[data-role="race-video"]',root).forEach(v=>{try{v.pause()}catch(e){}v.classList.remove('is-visible');v.removeAttribute('src');try{v.load()}catch(e){}})}
function jumpToScene(targetIndex){if(!scenes.length)return;const target=Math.max(0,Math.min(scenes.length-1,targetIndex));replayGeneration++;clearTimers();timeline=null;if(audioFade?.id)cancelAnimationFrame(audioFade.id);audioFade=null;if(replayVideo){try{replayVideo.pause()}catch(e){}}replayVideo=null;replayState=null;resetGlobalFx();scenes.forEach(resetSceneState);const priorPnl=pnlBeforeScene(target);currentGlobalPnl=priorPnl.value;currentGlobalPnlTime=priorPnl.time;setSoundtrackLevel(CONTRACT.normalVolume);beginScene(target)}
function restartFx(el,cls='go'){if(!el)return;el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls)}
function emojiFx(chars,n=14,mode='fall'){if(!fxEmojis)return;fxEmojis.className=`global-fx-emojis ${mode}`;fxEmojis.innerHTML='';for(let i=0;i<n;i++){const e=document.createElement('i');e.className='global-fx-emoji';e.textContent=chars[i%chars.length];e.style.animationDelay=`${Math.random()*.38}s`;e.style.setProperty('--d',`${1.25+Math.random()*1.25}s`);e.style.setProperty('--rot',`${(Math.random()>.5?1:-1)*(180+Math.random()*620)}deg`);if(mode==='fall'){e.style.left=`${2+Math.random()*94}%`;e.style.setProperty('--drift',`${-100+Math.random()*200}px`)}else{const a=Math.random()*Math.PI*2,dist=120+Math.random()*360;e.style.setProperty('--x',`${Math.cos(a)*dist}px`);e.style.setProperty('--y',`${Math.sin(a)*dist}px`)}fxEmojis.appendChild(e)}}
function coinFx(n=24){if(!fxCoins)return;fxCoins.innerHTML='';for(let i=0;i<n;i++){const c=document.createElement('i');c.className='global-fx-coin';c.style.left=`${2+Math.random()*96}%`;c.style.animationDelay=`${Math.random()*.55}s`;c.style.animationDuration=`${1.45+Math.random()*1.15}s`;c.style.setProperty('--r',`${(Math.random()>.5?1:-1)*(540+Math.random()*900)}deg`);const size=11+Math.random()*13;c.style.width=`${size}px`;c.style.height=`${size}px`;fxCoins.appendChild(c)}}
function particleFx(n=24){if(!fxParticles)return;fxParticles.innerHTML='';for(let i=0;i<n;i++){const p=document.createElement('i');p.className='global-fx-particle';const a=(Math.PI*2*i/n)+(Math.random()*.22),dist=110+Math.random()*330;p.style.setProperty('--x',`${Math.cos(a)*dist}px`);p.style.setProperty('--y',`${Math.sin(a)*dist}px`);p.style.animationDelay=`${Math.random()*.12}s`;const size=3+Math.random()*7;p.style.width=`${size}px`;p.style.height=`${size}px`;fxParticles.appendChild(p)}}
function reactionFx(face,copy=''){if(!fxReaction)return;if(fxReactionFace)fxReactionFace.textContent=face;if(fxReactionCopy)fxReactionCopy.textContent=copy;restartFx(fxReaction)}
function lossStampFx(){if(!fxLossStamp)return;const words=['OUCH','WTF!!','NOOO',"DO'H",'DAMN','BRUTAL'];fxLossStamp.textContent=words[Math.floor(Math.random()*words.length)];restartFx(fxLossStamp)}
function richFx(id){if(id==='winEmotion'){emojiFx(['🏇','🔥','🙌','🎉','👏','🥳','🤩','🏆','✨','💥'],14,'burst');const winFaces=['🥳','🤩','😎','🙌','🏆','🤑','🔥','🎉'];reactionFx(winFaces[Math.floor(Math.random()*winFaces.length)]);particleFx(20);flashFx('win');return}if(id==='lossEmotion'){emojiFx(['😩','💔','😬','🙈','😭','😫','💸','🫣','🤦‍♂️','😵‍💫'],12,'fall');const lossFaces=['😩','😭','😫','😖','😔','😬','🤦‍♂️','🫣','😵‍💫','🥴'];reactionFx(lossFaces[Math.floor(Math.random()*lossFaces.length)]);lossStampFx();flashFx('loss');return}if(id==='bigWinEmphasis'){coinFx(34);emojiFx(['💰','🤑','🪙','💵','🏆','👑','💎','🔥','🎉','🚀'],20,'fall');particleFx(34);restartFx(fxRing);flashFx('big');return}if(id==='comebackEmphasis'){emojiFx(['🔥','🙌','🚀','💪','👊','⚡','📈','🎯','💯','🏆'],18,'burst');particleFx(30);restartFx(fxRing);flashFx('big');return}}
function runFx(root){(root.dataset.fxPackage||'').split(/\s+/).filter(Boolean).forEach(id=>{root.classList.add(`fx-${id}`);richFx(id)})}
function scene8ResultFx(bet,outcomeIndex){resetGlobalFx();const n=Math.max(0,Number(outcomeIndex)||0);if(bet.classList.contains('win')){const kind=n%4;if(kind===0){reactionFx(['🥳','🏆','🔥','🙌'][n%4]);flashFx('win')}else if(kind===1){coinFx(22);flashFx('win')}else if(kind===2){emojiFx(['🎉','🏆','🙌','🔥','✨'],10,'burst');particleFx(16);flashFx('win')}else{restartFx(fxRing);particleFx(18);flashFx('win')}return}const lossIcons=['😩','😬','🤦‍♂️','🙈','💔','😖','🫣'];if(n%2===0)reactionFx(lossIcons[n%lossIcons.length]);flashFx('loss')}
function makeTimeline(tasks){timeline={tasks:tasks.map((t,i)=>({at:t.at,fn:t.fn,done:false,id:i})),elapsed:0,started:performance.now()};scheduleTimeline()}
function timelineElapsed(){return timeline?timeline.elapsed+(performance.now()-timeline.started):0}
function scheduleTimeline(){clearTimers();if(!timeline||paused)return;timeline.started=performance.now();for(const task of timeline.tasks){if(task.done)continue;const remaining=task.at-timeline.elapsed;if(remaining<=0){task.done=true;task.fn()}else later(()=>{if(paused||task.done)return;task.done=true;task.fn()},remaining)}}
function pauseTimeline(){if(!timeline)return;timeline.elapsed=timelineElapsed();clearTimers()}
function resumeTimeline(){if(!timeline)return;timeline.started=performance.now();scheduleTimeline()}
function scheduleScene12(root,type){const d=Number(root.dataset.durationMs)||0,tasks=[];if(type==='1'){const closeWords=prepareScene1Close(root);[['intro',0],['hero',1300],['stats',4200],['meetings',6200],['teaser',8800]].forEach(([n,at])=>tasks.push({at,fn:()=>reveal(root,n)}));const closeStart=11600,wordGap=220;closeWords.forEach((word,i)=>tasks.push({at:closeStart+(i*wordGap),fn:()=>word.classList.add('is-on')}));const lastWordAt=closeStart+(Math.max(0,closeWords.length-1)*wordGap);tasks.push({at:lastWordAt+420,fn:()=>{q('[data-role="s1-launch-shockwave"]',root)?.classList.add('is-on');root.classList.add('s1-launch-hit')}});tasks.push({at:lastWordAt+620,fn:()=>q('[data-role="s1-launch-flash"]',root)?.classList.add('is-on')})}else{[['race',0],['bet',.09],['tension',.22],['finish',.394],['verdict',.428],['reaction',.583],['pnl',.711]].forEach(([n,r])=>tasks.push({at:r===0?0:r*d,fn:()=>{reveal(root,n);if(n==='pnl')needle(root)}}));[.25,.278,.306,.333,.361].forEach((r,i)=>tasks.push({at:r*d,fn:()=>qa('.s2-dot',root)[i]?.classList.add('is-on')}));tasks.push({at:.461*d,fn:()=>{runFx(root);const box=q('[data-pnl-to]',root);if(box)setGlobalPnl(box.dataset.pnlTo,box.dataset.raceTime,true)}})}tasks.push({at:d+(END_HOLD_MS[type]||0),fn:next});makeTimeline(tasks)}
function beginAudioFade(target,ms=CONTRACT.fadeMs){audioFade={from:getSoundtrackLevel(),to:target,duration:ms,elapsed:0,started:performance.now(),id:null};runAudioFade()}
function runAudioFade(){if(!audioFade||paused)return;audioFade.started=performance.now();const tick=()=>{if(!audioFade||paused)return;const elapsed=audioFade.elapsed+(performance.now()-audioFade.started),r=Math.min(1,elapsed/audioFade.duration);setSoundtrackLevel(audioFade.from+(audioFade.to-audioFade.from)*r);if(r>=1){audioFade=null;return}audioFade.id=requestAnimationFrame(tick)};audioFade.id=requestAnimationFrame(tick)}
function pauseAudioFade(){if(!audioFade)return;audioFade.elapsed+=performance.now()-audioFade.started;if(audioFade.id)cancelAnimationFrame(audioFade.id);audioFade.id=null}
function resumeAudioFade(){if(audioFade)runAudioFade()}
function startReplayTimeline(root,data,comment,finish){const clip=17,leadIn=3000,baseClip=11,ratios={2:[.16,.55],3:[.12,.39,.68],4:[.10,.31,.54,.72]}[data.replayComments.length]||[],tasks=[];ratios.forEach((r,i)=>tasks.push({at:leadIn+(r*baseClip*1000),fn:()=>replayCommentFx(comment,data.replayComments[i])}));tasks.push({at:5200,fn:()=>replayEmojiFx(root,['🤞','👀','😬','🔥'])});tasks.push({at:7100,fn:()=>replayStreakFx(root,7)});tasks.push({at:8600,fn:()=>replayEmojiFx(root,['🔥','🙏','👀','😬'])});tasks.push({at:10300,fn:()=>replayParticleFx(root,22)});tasks.push({at:11600,fn:()=>replayStreakFx(root,9)});tasks.push({at:12400,fn:()=>{if(data.replayResult==='WIN')replayCelebrationFx(root,data.replayBetType);else replayLossFx(root)}});tasks.push({at:13550,fn:()=>{if(data.replayResult==='LOSS')replayLossPayoffFx(root)}});tasks.push({at:Math.max(0,(clip*1000)-CONTRACT.replayFadeMs),fn:()=>root.classList.add('fx-videoFade')});tasks.push({at:clip*1000,fn:finish});replayState={phase:'playing'};makeTimeline(tasks)}
function startReplayPlayback(state){const {data,root,comment,finish}=state;if(!replayVideo||paused){replayState={...state,phase:'ready-paused'};timeline=null;clearTimers();return}replayState={...state,phase:'starting'};makeTimeline([{at:CONTRACT.playTimeoutMs,fn:()=>{if(replayState?.phase==='starting')finish()}}]);try{const p=replayVideo.play();const started=()=>{if(replayState?.phase!=='starting'||!replayVideo)return;if(paused){replayVideo.pause();replayState={...state,phase:'ready-paused'};timeline=null;clearTimers();return}startReplayTimeline(root,data,comment,finish)};if(p?.then)p.then(started).catch(finish);else started()}catch(e){finish()}}
function replay(root){const generation=++replayGeneration;const data=manifest.sceneRuntimeData?.[root.dataset.sceneInstanceId];if(!data?.replayUrl||!Array.isArray(data.replayComments)){console.error('Missing replay payload');return makeTimeline([{at:CONTRACT.replayFadeMs,fn:next}])}const v=q('[data-role="race-video"]',root),load=q('[data-role="replay-loading"]',root),veil=q('[data-role="replay-exit-veil"]',root),comment=q('[data-role="replay-comment"]',root);replayVideo=v;replayState={phase:'metadata'};clearReplayFx(root);root.classList.add('fx-replayEnter');v.src=data.replayUrl;beginAudioFade(CONTRACT.replayVolume);let finished=false;const finish=()=>{if(finished||generation!==replayGeneration)return;finished=true;v.pause();replayState=null;timeline=null;clearTimers();clearReplayFx(root);veil?.classList.add('is-visible');if(!paused)audio.play().catch(()=>{});beginAudioFade(CONTRACT.normalVolume);makeTimeline([{at:CONTRACT.replayFadeMs,fn:next}])};makeTimeline([{at:5000,fn:finish}]);v.addEventListener('loadedmetadata',()=>{if(finished||generation!==replayGeneration)return;const start=Math.max(0,v.duration-48);v.currentTime=start;load?.classList.add('is-hidden');v.classList.add('is-visible');const state={data,root,comment,finish};if(paused){replayState={...state,phase:'ready-paused'};timeline=null;clearTimers();return}startReplayPlayback(state)},{once:true});v.addEventListener('error',finish,{once:true});v.addEventListener('ended',finish,{once:true})}
function resumeReplayIfReady(){if(!replayVideo||replayState?.phase!=='ready-paused')return false;const state={data:replayState.data,root:replayState.root,comment:replayState.comment,finish:replayState.finish};startReplayPlayback(state);return true}
function finaleFx(root){const hero=q('.s7-hero',root);if(!hero)return;if(hero.classList.contains('positive'))root.classList.add('fx-positiveFinale');else if(hero.classList.contains('negative'))root.classList.add('fx-negativeFinale');else root.classList.add('fx-breakEvenFinale')}
function scheduleCssScene(root,type){root.classList.add('play');let d=0,tasks=[];if(type==='4')d=8000;else if(type==='5'){const three=root.dataset.raceCount==='3';d=three?13300:10400;const races=qa('.s5-race',root);[2600,5500,8400].slice(0,races.length).forEach((at,i)=>tasks.push({at,fn:()=>{runFx(races[i]);const v=races[i].dataset.runningPnl;if(v!==undefined)setGlobalPnl(v,races[i].dataset.raceTime,true)}}));tasks.push({at:three?11700:8800,fn:()=>needle(root)})}else if(type==='8'){const bets=qa('.s8-bet',root),count=bets.length,marks=String(root.dataset.resultRevealMs||'').split(',').filter(Boolean).map(Number);d=Number(root.dataset.sceneDurationMs);if(!Number.isFinite(d)||d<=0||marks.length!==count||marks.some((x,i)=>!Number.isFinite(x)||x<0||(i&&x<=marks[i-1]))||marks.at(-1)>=d){console.error('Invalid Scene 8 contract timing');return makeTimeline([{at:0,fn:next}])}let winFxIndex=0,lossFxIndex=0;marks.forEach((at,i)=>{const bet=bets[i],fxIndex=bet.classList.contains('win')?winFxIndex++:lossFxIndex++;tasks.push({at,fn:()=>{bet.classList.add('is-resolved');scene8ResultFx(bet,fxIndex);const v=bet.dataset.runningPnl;if(v!==undefined)setGlobalPnl(v,bet.dataset.raceTime,true)}})});tasks.push({at:Math.min(d-900,marks.at(-1)+550),fn:()=>q('[data-role="s8-footer"]',root)?.classList.add('is-visible')})}else if(type==='6')d=9500;else if(type==='7')tasks.push({at:0,fn:()=>finaleFx(root)});if(type!=='7')tasks.push({at:d+(END_HOLD_MS[type]||0),fn:next});makeTimeline(tasks)}
function beginScene(i,cls='is-active'){index=i;const root=scenes[i];if(!root)return;root.classList.remove('is-exiting','is-entering','is-active');root.classList.add(cls);resetGlobalFx();pt.textContent=`${i+1} / ${scenes.length}`;bar.style.width=`${((i+1)/scenes.length)*100}%`;const type=root.dataset.sceneType;if(type==='1'||type==='3'||type==='6'||type==='7'){hideGlobalPnl()}else{setGlobalPnl(currentGlobalPnl,currentGlobalPnlTime,currentGlobalPnlTime!=='')}if(type==='1'||type==='2')scheduleScene12(root,type);else if(type==='3')replay(root);else scheduleCssScene(root,type)}
function startScene(i){clearTimers();timeline=null;replayState=null;replayVideo=null;scenes.forEach(s=>s.classList.remove('is-active','is-entering','is-exiting','play'));beginScene(i)}
function next(){if(index>=scenes.length-1)return;const old=scenes[index],target=index+1,incoming=scenes[target];old.classList.remove('is-active');old.classList.add('is-exiting');incoming.classList.add('is-entering');makeTimeline([{at:CONTRACT.transitionMs,fn:()=>{old.classList.remove('is-exiting','play');incoming.classList.remove('is-entering');startScene(target)}}])}

function unlockAudio(){
  if(audioUnlocked)return;
  audioUnlocked=true;
  initSoundtrackAudio();
  audioCtx?.resume().catch(()=>{});
  audio.play().catch(()=>{});
}

function primeReplayMedia(){
  if(replayMediaPrimed)return;
  replayMediaPrimed=true;
  qa('[data-role="race-video"]').forEach(v=>{
    const root=v.closest('[data-scene-instance-id]');
    const data=root?manifest.sceneRuntimeData?.[root.dataset.sceneInstanceId]:null;
    if(!data?.replayUrl)return;
    v.setAttribute('playsinline','');
    v.setAttribute('webkit-playsinline','');
    v.preload='metadata';
    v.src=data.replayUrl;
    try{v.load()}catch(e){}
  });
}

function toggle(){unlockAudio();if(!paused){pauseTimeline();pauseAudioFade();paused=true;document.body.classList.add('runtime-paused');btn.textContent='PLAY';audio.pause();replayVideo?.pause()}else{paused=false;document.body.classList.remove('runtime-paused');btn.textContent='PAUSE';audioCtx?.resume().catch(()=>{});audio.play().catch(()=>{});resumeAudioFade();if(!resumeReplayIfReady()){if(replayVideo&&replayState?.phase==='playing')replayVideo.play().catch(()=>{});resumeTimeline()}}}
function sceneFromProgressPointer(clientX){if(!progressTrack||!scenes.length)return index;const rect=progressTrack.getBoundingClientRect();if(!rect.width)return index;const ratio=Math.max(0,Math.min(.999999,(clientX-rect.left)/rect.width));return Math.floor(ratio*scenes.length)}
btn.addEventListener('click',toggle);
if(progressTrack){let scrubbing=false,pendingScene=index;const previewScene=clientX=>{pendingScene=sceneFromProgressPointer(clientX);pt.textContent=`${pendingScene+1} / ${scenes.length}`;bar.style.width=`${((pendingScene+1)/scenes.length)*100}%`};progressTrack.addEventListener('pointerdown',e=>{scrubbing=true;progressTrack.setPointerCapture?.(e.pointerId);previewScene(e.clientX)});progressTrack.addEventListener('pointermove',e=>{if(scrubbing)previewScene(e.clientX)});progressTrack.addEventListener('pointerup',e=>{if(!scrubbing)return;scrubbing=false;previewScene(e.clientX);jumpToScene(pendingScene)});progressTrack.addEventListener('pointercancel',()=>{scrubbing=false;pt.textContent=`${index+1} / ${scenes.length}`;bar.style.width=`${((index+1)/scenes.length)*100}%`})}
document.addEventListener('click',e=>{const b=e.target.closest('[data-role="share-recap"]');if(!b)return;unlockAudio();const root=b.closest('[data-scene-instance-id]'),d=manifest.sceneRuntimeData?.[root.dataset.sceneInstanceId]||{},title='My TAB Racing Day Recap',url=location.href.split('#')[0],text=d.shareCaption||'';if(navigator.share)navigator.share({title,text,url}).catch(()=>{});else navigator.clipboard?.writeText(`${text} ${url}`.trim()).catch(()=>{})});
startBtn?.addEventListener('click',()=>{
  unlockAudio();
  primeReplayMedia();
  startGate?.remove();
  if(scenes.length)startScene(0)
},{once:true});
})();