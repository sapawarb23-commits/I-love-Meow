/* Virtual Cat MVP: local browser save, simple pixel movement and care actions. */
(() => {
  if (typeof Meow === 'undefined' || !Meow.requireAuth()) return;
  Meow.renderNav('virtual-cat');
  const userKey = 'ilm_virtual_cat_' + (Meow.user?.id || 'guest');
  const defaults = {name:'Mochi',cat:'black',accessory:'none',hunger:80,happiness:80,energy:80,level:1,x:50,mood:'CURIOUS'};
  let state = {...defaults};
  try { state = {...defaults,...JSON.parse(localStorage.getItem(userKey) || '{}')}; } catch {}
  const $ = id => document.getElementById(id);
  let bondState = null;
  function bondTier(days) {
    if (days >= 30) return 'Forever Family';
    if (days >= 14) return 'Best Buddies';
    if (days >= 7) return 'Little Companion';
    if (days >= 3) return 'Familiar Face';
    return 'New Friend';
  }
  function renderBond() {
    if (!bondState) return;
    const days = Number(bondState.current_bond) || 0;
    $('bond-level').textContent = bondTier(days);
    $('bond-count').textContent = days + (days === 1 ? ' day together' : ' days together');
    $('bond-best').textContent = 'Best: ' + (Number(bondState.best_bond) || days) + ' days';
    $('paw-saves-count').textContent = (Number(bondState.paw_saves) || 0) + ' / 3';
    $('fish-coins-count').textContent = Number(bondState.fish_coins) || 0;
    $('bond-meter-fill').style.width = Math.min(100, Math.max(4, days / 30 * 100)) + '%';
    $('bond-greeting').textContent = bondState.greeting || 'Mochi is happy you are here! 💗';
    $('bond-recovery-actions').hidden = !bondState.pending_recovery;
    $('bond-restore-btn').disabled = Number(bondState.fish_coins) < 100;
    $('bond-restore-btn').textContent = Number(bondState.fish_coins) < 100
      ? '🐟 Need 100 Fish Coins'
      : '💗 Restore for 100 coins';
  }
  async function loadBond() {
    try {
      bondState = await Meow.api('/api/virtual-cat/bond');
      renderBond();
      speak('welcome', true);
      if (bondState.pending_recovery) { message(bondState.greeting, 'WORRIED'); speak('welcome', true); }
      else if (bondState.first_visit || bondState.protected_days) {
        speak('welcome', true);
        message(bondState.greeting, 'HAPPY');
        if (bondState.protected_days) heart();
      }
    } catch (err) {
      $('bond-greeting').textContent = 'Mochi could not check your pawprints just now. ' + err.message;
    }
  }
  $('bond-restore-btn').addEventListener('click', async () => {
    if (!bondState?.pending_recovery) return;
    if (Number(bondState.fish_coins) < 100) {
      $('bond-greeting').textContent = 'You need 100 Fish Coins to bring your pawprints back. Play a game to earn more! 🐟';
      return;
    }
    if (!window.confirm('Spend 100 Fish Coins to restore your Pawprint Bond?')) return;
    const button = $('bond-restore-btn');
    button.disabled = true;
    try {
      bondState = await Meow.api('/api/virtual-cat/bond/restore', { method: 'POST' });
      renderBond(); message(bondState.greeting, 'LOVED'); heart(); speak('welcome', true); playSound('arrive');
    } catch (err) {
      $('bond-greeting').textContent = err.message;
      button.disabled = false;
    }
  });
  $('bond-restart-btn').addEventListener('click', async () => {
    if (!window.confirm('Start a new Pawprint Bond? Mochi, your cat level, accessories and all permanent progress will stay safe.')) return;
    const button = $('bond-restart-btn');
    button.disabled = true;
    try {
      bondState = await Meow.api('/api/virtual-cat/bond/start-fresh', { method: 'POST' });
      renderBond(); message(bondState.greeting, 'CURIOUS');
    } catch (err) {
      $('bond-greeting').textContent = err.message;
      button.disabled = false;
    }
  });


  const pet = $('pixel-pet'), room = $('pixel-room');
  let soundEnabled=true,audioContext=null,noiseBuffer=null,masterGain=null;
  function getAudio(){
    if(!soundEnabled)return null;
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
    if(!audioContext){audioContext=new AC();masterGain=audioContext.createGain();masterGain.gain.value=1.9;const limiter=audioContext.createDynamicsCompressor();limiter.threshold.value=-8;limiter.knee.value=12;limiter.ratio.value=5;masterGain.connect(limiter);limiter.connect(audioContext.destination);}
    if(audioContext.state==='suspended')audioContext.resume();
    if(!noiseBuffer){noiseBuffer=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate);const d=noiseBuffer.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;}
    return audioContext;
  }
  function tone(freq,delay,duration,wave='sine',volume=.025,endFreq=freq){
    const ctx=getAudio();if(!ctx)return;const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();
    o.type=wave;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),t+duration);
    g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(volume,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g);g.connect(masterGain||ctx.destination);o.start(t);o.stop(t+duration+.03);
  }
  function purrSound(){
    const ctx=getAudio();if(!ctx)return;const t=ctx.currentTime,s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();
    s.buffer=noiseBuffer;s.loop=true;f.type='lowpass';f.frequency.value=180;g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.045,t+.12);
    for(let n=.18;n<1.35;n+=.22){g.gain.setValueAtTime(.045,t+n);g.gain.linearRampToValueAtTime(.018,t+n+.09);g.gain.linearRampToValueAtTime(.045,t+n+.18);}
    g.gain.linearRampToValueAtTime(.0001,t+1.55);s.connect(f);f.connect(g);g.connect(masterGain||ctx.destination);s.start(t);s.stop(t+1.6);tone(42,0,1.45,'sine',.018,38);
  }
  function playSound(kind){
    if(!getAudio())return;
    if(kind==='pet'){purrSound();tone(520,.04,.18,'sine',.012,680);}
    if(kind==='feed'){tone(680,0,.12,'triangle',.025,820);tone(920,.13,.18,'sine',.018,620);tone(380,.32,.12,'triangle',.012,300);}
    if(kind==='play'){tone(520,0,.12,'triangle',.025,880);tone(740,.12,.14,'sine',.02,1040);tone(980,.26,.2,'sine',.018,620);}
    if(kind==='sleep'){tone(440,0,.35,'sine',.018,330);tone(330,.28,.5,'sine',.014,220);purrSound();}
    if(kind==='walk'){tone(125,0,.045,'sine',.009,95);tone(145,.11,.045,'sine',.008,105);}
    if(kind==='arrive'){tone(620,0,.16,'sine',.02,820);tone(820,.15,.22,'sine',.018,980);}
    if(kind==='scratch'){tone(170,0,.24,'triangle',.025,110);tone(210,.22,.2,'triangle',.022,140);purrSound();}
    if(kind==='fish'){tone(760,0,.16,'sine',.025,980);tone(1040,.16,.2,'sine',.02,760);}
    if(kind==='yarn'){tone(460,0,.1,'triangle',.026,720);tone(880,.1,.16,'sine',.022,540);}
    if(kind==='water'){tone(620,0,.3,'sine',.018,500);tone(740,.2,.3,'sine',.015,620);}
  }
  const soundButton=$('sound-toggle');
  soundButton?.addEventListener('click',()=>{soundEnabled=!soundEnabled;soundButton.textContent=soundEnabled?'🔊 Sound on':'🔇 Sound off';soundButton.setAttribute('aria-pressed',String(soundEnabled));if(soundEnabled)playSound('arrive');});

  const palettes = {
    black:{outline:'#17151d',body:'#292630',shade:'#201e27',light:'#514b5b',highlight:'#777080',ear:'#e88fa5',muzzle:'#f1d9d5',eye:'#f5d66f',shine:'#fff8dc',nose:'#e98da5'},
    white:{outline:'#a99d91',body:'#fff8ed',shade:'#e8ded1',light:'#ffffff',highlight:'#fffdf8',ear:'#efa0b2',muzzle:'#f3deda',eye:'#8fbd87',shine:'#ffffff',nose:'#df879e'}
  };
  const svgNS = 'http://www.w3.org/2000/svg';
  function drawCat(){
    const p=palettes[state.cat] || palettes.black;
    const svg=$('cat-sprite');
    svg.innerHTML='';
    const pixel=(x,y,color,parent=svg)=>{
      const r=document.createElementNS(svgNS,'rect');
      r.setAttribute('x',x);r.setAttribute('y',y);
      r.setAttribute('width','1');r.setAttribute('height','1');
      r.setAttribute('fill',color);parent.appendChild(r);
    };
    const block=(x,y,w,h,color,parent=svg)=>{
      for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)pixel(xx,yy,color,parent);
    };
    const group=className=>{
      const g=document.createElementNS(svgNS,'g');g.setAttribute('class',className);svg.appendChild(g);return g;
    };

    // Curled tail sits behind the body.
    const tail=group('cat-tail');
    [[5,17],[4,18],[3,19],[3,20],[4,21],[5,21],[6,20],[6,19]].forEach(([x,y])=>pixel(x,y,p.outline,tail));
    [[5,18],[4,19],[4,20],[5,20]].forEach(([x,y])=>pixel(x,y,p.body,tail));

    // Pointed ears with soft pink inner pixels.
    block(6,3,3,5,p.outline);block(15,3,3,5,p.outline);
    block(7,4,1,3,p.ear);block(16,4,1,3,p.ear);
    pixel(6,2,p.outline);pixel(8,2,p.outline);pixel(15,2,p.outline);pixel(17,2,p.outline);
    pixel(7,3,p.outline);pixel(16,3,p.outline);

    // Round, oversized kawaii head with a crisp pixel outline.
    const headRows=[[5,8],[6,10],[7,12],[8,14],[9,16],[10,18],[11,18],[12,18],[13,18],[14,18],[15,16],[16,14],[17,10]];
    headRows.forEach(([y,w])=>block((24-w)/2,y,w,1,p.outline));
    const faceRows=[[6,6],[7,8],[8,10],[9,12],[10,14],[11,14],[12,14],[13,14],[14,14],[15,12],[16,10]];
    faceRows.forEach(([y,w])=>block((24-w)/2,y,w,1,p.body));

    // Plump little body and two visible paws.
    const bodyRows=[[14,10],[15,14],[16,16],[17,16],[18,16],[19,16],[20,14],[21,12],[22,10]];
    bodyRows.forEach(([y,w])=>block((24-w)/2,y,w,1,p.outline));
    const bodyInner=[[15,10],[16,12],[17,14],[18,14],[19,14],[20,12],[21,10]];
    bodyInner.forEach(([y,w])=>block((24-w)/2,y,w,1,p.body));
    block(7,21,4,2,p.light);block(13,21,4,2,p.light);
    block(8,22,3,1,p.highlight);block(13,22,3,1,p.highlight);

    // Face: big sparkling eyes, rosy cheeks, tiny nose and smile.
    block(7,10,3,3,p.outline);block(14,10,3,3,p.outline);
    block(8,10,2,2,p.eye);block(14,10,2,2,p.eye);
    pixel(8,10,p.shine);pixel(14,10,p.shine);
    pixel(9,12,p.shade);pixel(15,12,p.shade);
    block(5,13,2,1,p.ear);block(17,13,2,1,p.ear);
    block(10,14,4,2,p.muzzle);
    pixel(11,14,p.nose);pixel(12,14,p.nose);
    pixel(11,16,p.outline);pixel(12,16,p.outline);
    pixel(10,17,p.outline);pixel(13,17,p.outline);
    // Tiny whiskers.
    [[4,14],[5,15],[18,14],[17,15]].forEach(([x,y])=>pixel(x,y,p.highlight));
    // A little forehead shine gives the face a soft, plush look.
    block(10,7,4,1,p.light);

    // Separate little paws let the cat visibly step while walking.
    const legs=group('cat-legs');
    const leftLeg=document.createElementNS(svgNS,'g');leftLeg.setAttribute('class','cat-leg-left');legs.appendChild(leftLeg);
    const rightLeg=document.createElementNS(svgNS,'g');rightLeg.setAttribute('class','cat-leg-right');legs.appendChild(rightLeg);
    block(7,21,4,2,p.outline,leftLeg); block(8,21,2,1,p.light,leftLeg);
    block(13,21,4,2,p.outline,rightLeg); block(14,21,2,1,p.light,rightLeg);
    const lids=group('cat-eyelids');
    block(8,10,2,2,p.body,lids); block(14,10,2,2,p.body,lids);
  }
  function save(){localStorage.setItem(userKey,JSON.stringify(state));}
  function render(){
    $('cat-name').value=state.name;
    $('hunger-value').textContent=state.hunger+'%';$('happy-value').textContent=state.happiness+'%';$('energy-value').textContent=state.energy+'%';
    $('hunger-bar').style.width=state.hunger+'%';$('happy-bar').style.width=state.happiness+'%';$('energy-bar').style.width=state.energy+'%';
    $('mood-label').textContent='MOOD: '+state.mood;
    $('cat-level').textContent='Level '+state.level;
    document.querySelectorAll('.cat-choice').forEach(b=>b.classList.toggle('selected',b.dataset.cat===state.cat));
    document.querySelectorAll('.accessory-choice').forEach(b=>b.classList.toggle('selected',b.dataset.accessory===state.accessory));
    $('pixel-accessory').className='pixel-accessory '+(state.accessory==='none'?'':state.accessory);
    drawCat(); save();
  }
  function message(t,mood){$('action-message').textContent=t;if(mood){state.mood=mood;$('mood-label').textContent='MOOD: '+mood;}save();}
  function heart(){pet.classList.add('show-heart');setTimeout(()=>pet.classList.remove('show-heart'),850);}

  const speechLines = {
    welcome:['YAYYY! YOU\'RE BACK!! 💗','MY HOOMAN!! 🥺','I SAVED YOU A PURR!','BEST DAY EVER!!'],
    feed:['NOM NOM NOM! 🐟','TASTY TASTY!','MY FAVOURITE!','ONE MORE BITE? 🥺'],
    play:['CATCH ME IF YOU CAN!','WHEEEEE!!','THAT WAS SO FUN!','AGAIN AGAIN!!'],
    pet:['hehe... more pets pls','PURRRR... 💗','THAT\'S THE SPOT!','I LOVE THIS!'],
    sleep:['five more minutes... zZ','tiny nap time...','don\'t let the bugs bite 🌙'],
    room:['I FOUND A THING!','LOOK WHAT I CAN DO!','DID YOU SEE THAT?!','teehee 🐾'],
    idle:['psst... i love you 🥺','are you looking at me?','mrrp?','you smell like snacks','i am very smol','boop my nose!']
  };
  let speechTimer = null, lastSpeech = '', lastIdleSpeech = 0;
  function speak(kind='idle',force=false) {
    const bubble=$('pixel-speech');
    if(!bubble)return;
    if(!force && Math.random() > (kind==='idle' ? .34 : .58))return;
    const choices=speechLines[kind]||speechLines.idle;
    let line=choices[Math.floor(Math.random()*choices.length)];
    if(choices.length>1 && line===lastSpeech) line=choices[(choices.indexOf(line)+1+Math.floor(Math.random()*(choices.length-1)))%choices.length];
    lastSpeech=line;
    bubble.textContent=line;
    bubble.classList.remove('show');
    void bubble.offsetWidth;
    bubble.classList.add('show');
    clearTimeout(speechTimer);
    speechTimer=setTimeout(()=>bubble.classList.remove('show'),2500);
  }

  let reactionTimer;
  function react(symbol,kind=''){
    const bubble=$('cat-reaction'); if(!bubble)return;
    bubble.textContent=symbol; bubble.className='cat-reaction '+kind+' visible';
    clearTimeout(reactionTimer); reactionTimer=setTimeout(()=>bubble.classList.remove('visible'),1100);
  }
  function walkTo(pct){
    const old=parseFloat(pet.style.left)||state.x||50;
    const next=Math.max(12,Math.min(88,pct));
    pet.classList.toggle('faces-left',next<old);
    pet.classList.add('walking'); pet.classList.remove('sleeping');
    pet.style.left=next+'%'; state.x=next;
    clearTimeout(pet.walkTimer); pet.walkTimer=setTimeout(()=>pet.classList.remove('walking'),720);
    save();
  }
  $('cat-name').addEventListener('input',e=>{state.name=e.target.value.slice(0,18);save();});
  document.querySelectorAll('.cat-choice').forEach(b=>b.addEventListener('click',()=>{state.cat=b.dataset.cat;render();message(state.name+' has a new look!','CURIOUS');}));
  document.querySelectorAll('.accessory-choice').forEach(b=>b.addEventListener('click',()=>{state.accessory=b.dataset.accessory;render();message('Looking stylish, '+state.name+'!','HAPPY');heart();}));
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{
    pet.classList.remove('sleeping');
    switch(b.dataset.action){
      case 'feed':speak('feed');state.hunger=Math.min(100,state.hunger+22);state.happiness=Math.min(100,state.happiness+4);message(state.name+' is excited for dinner!','HAPPY');react('🐟','fish');playSound('feed');pet.classList.add('excited');setTimeout(()=>pet.classList.remove('excited'),850);break;
      case 'play':if(state.energy<15){message(state.name+' is too sleepy to play. Let them rest!','SLEEPY');break;}speak('play');state.happiness=Math.min(100,state.happiness+18);state.energy=Math.max(0,state.energy-14);state.hunger=Math.max(0,state.hunger-7);message(state.name+' is chasing the yarn!','PLAYFUL');react('🧶','yarn');playSound('play');pet.classList.add('excited');setTimeout(()=>pet.classList.remove('excited'),900);walkTo(25+Math.random()*50);break;
      case 'pet':speak('pet');state.happiness=Math.min(100,state.happiness+10);message(state.name+' is purring.','LOVED');heart();react('♪','purr');playSound('pet');pet.classList.add('purring');setTimeout(()=>pet.classList.remove('purring'),1600);break;
      case 'sleep':speak('sleep');state.energy=Math.min(100,state.energy+28);walkTo(84);pet.classList.add('sleeping');message(state.name+' curled up in her little bed.','SLEEPY');react('Z z z','sleep');playSound('sleep');break;
    }
    state.level=1+Math.floor((state.happiness+state.hunger+state.energy)/150);
    render();
  }));
  function moveTo(clientX){
    const rect=room.getBoundingClientRect();const pct=Math.max(12,Math.min(88,((clientX-rect.left)/rect.width)*100));
    walkTo(pct);message(state.name+' came over to say hello!','CURIOUS');playSound('arrive');
  }
  const roomInteractions={
    scratch:{x:87,emoji:'🐾',text:state.name+' sharpened those tiny claws!',mood:'PLAYFUL',sound:'scratch',happy:12,energy:-3},
    fish:{x:76,emoji:'🐠',text:state.name+' is mesmerised by the fishies!',mood:'CURIOUS',sound:'fish',happy:8,energy:-2},
    butterfly:{x:23,emoji:'🦋',text:state.name+' watched a butterfly flutter by!',mood:'EXCITED',sound:'play',happy:12,energy:-4},
    yarn:{x:61,emoji:'🧶',text:state.name+' pounced on the yarn ball!',mood:'PLAYFUL',sound:'yarn',happy:14,energy:-7},
    water:{x:17,emoji:'💧',text:state.name+' had a refreshing drink!',mood:'REFRESHED',sound:'water',happy:4,energy:3}
  };
  room.querySelectorAll('[data-interact]').forEach(object=>object.addEventListener('click',e=>{
    e.stopPropagation();const item=roomInteractions[object.dataset.interact];if(!item)return;
    walkTo(item.x);state.happiness=Math.max(0,Math.min(100,state.happiness+item.happy));state.energy=Math.max(0,Math.min(100,state.energy+item.energy));
    message(item.text,item.mood);speak('room');react(item.emoji,object.dataset.interact);playSound(item.sound);heart();render();
  }));
  room.addEventListener('click',e=>{if(e.target.closest('button'))return;moveTo(e.clientX);});
  pet.addEventListener('click',e=>{e.stopPropagation();state.happiness=Math.min(100,state.happiness+5);heart();react('♥','purr');message(state.name+' says meow!','LOVED');playSound('pet');pet.classList.add('purring');setTimeout(()=>pet.classList.remove('purring'),1600);render();});
  pet.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pet.click();}});
  pet.style.left=state.x+'%';render();
  loadBond();
  // Gentle idle wandering keeps the pet feeling alive without draining needs.
  let direction=1;
  setInterval(()=>{
    if(document.hidden || pet.classList.contains('sleeping') || pet.classList.contains('walking'))return;
    let x=parseFloat(pet.style.left)||50;
    if(x>82)direction=-1;if(x<18)direction=1;
    walkTo(x+direction*4);
    if(Date.now()-lastIdleSpeech>45000 && Math.random()<.22){speak('idle',true);lastIdleSpeech=Date.now();}
  },4200);
})();
