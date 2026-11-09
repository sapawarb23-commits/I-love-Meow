/* Virtual Cat MVP: local browser save, simple pixel movement and care actions. */
(() => {
  if (!window.Meow || !Meow.requireAuth()) return;
  Meow.renderNav('virtual-cat');
  const userKey = 'ilm_virtual_cat_' + (Meow.user?.id || 'guest');
  const defaults = {name:'Mochi',cat:'black',accessory:'none',hunger:80,happiness:80,energy:80,level:1,x:50,mood:'CURIOUS'};
  let state = {...defaults};
  try { state = {...defaults,...JSON.parse(localStorage.getItem(userKey) || '{}')}; } catch {}
  const $ = id => document.getElementById(id);
  const pet = $('pixel-pet'), room = $('pixel-room');
  const palettes = {
    black:{body:'#25232b',shade:'#15141b',light:'#48434e',eye:'#f4d36c',nose:'#d98b9a'},
    white:{body:'#f5eee1',shade:'#d6cbbb',light:'#fffaf0',eye:'#8cbd83',nose:'#d98b9a'}
  };
  const pixels = [
    '0000003300000000','0000333333000000','0003333333300000','0033333333330000',
    '0033333333330000','0333333333333000','0333333333333000','0333333333333000',
    '0333333333333000','0333311331333000','0333311331333000','0033333333330000',
    '0003333333300000','0000333333000000','0000330033000000','0003300003300000'
  ];
  function drawCat(){
    const p=palettes[state.cat] || palettes.black;
    const svg=$('cat-sprite'); svg.innerHTML='';
    pixels.forEach((row,y)=>[...row].forEach((v,x)=>{
      if(v==='0') return;
      const fill=v==='1'?p.shade:v==='3'?p.body:v==='2'?p.light:v==='e'?p.eye:p.nose;
      const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
      r.setAttribute('x',x);r.setAttribute('y',y);r.setAttribute('width','1');r.setAttribute('height','1');r.setAttribute('fill',fill);svg.appendChild(r);
    }));
    [[5,9],[10,9]].forEach(([x,y])=>{const r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('x',x);r.setAttribute('y',y);r.setAttribute('width','1');r.setAttribute('height','1');r.setAttribute('fill',p.eye);svg.appendChild(r);});
    const nose=document.createElementNS('http://www.w3.org/2000/svg','rect');nose.setAttribute('x','7');nose.setAttribute('y','11');nose.setAttribute('width','2');nose.setAttribute('height','1');nose.setAttribute('fill',p.nose);svg.appendChild(nose);
  }
  function save(){localStorage.setItem(userKey,JSON.stringify(state));}
  function render(){
    $('cat-name').value=state.name;
    $('hunger-value').textContent=state.hunger+'%';$('happiness-value').textContent=state.happiness+'%';$('energy-value').textContent=state.energy+'%';
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
  $('cat-name').addEventListener('input',e=>{state.name=e.target.value.slice(0,18);save();});
  document.querySelectorAll('.cat-choice').forEach(b=>b.addEventListener('click',()=>{state.cat=b.dataset.cat;render();message(state.name+' has a new look!','CURIOUS');}));
  document.querySelectorAll('.accessory-choice').forEach(b=>b.addEventListener('click',()=>{state.accessory=b.dataset.accessory;render();message('Looking stylish, '+state.name+'!','HAPPY');heart();}));
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{
    pet.classList.remove('sleeping');
    switch(b.dataset.action){
      case 'feed':state.hunger=Math.min(100,state.hunger+22);state.happiness=Math.min(100,state.happiness+4);message(state.name+' enjoyed a tasty snack!','HAPPY');break;
      case 'play':if(state.energy<15){message(state.name+' is too sleepy to play. Let them rest!','SLEEPY');break;}state.happiness=Math.min(100,state.happiness+18);state.energy=Math.max(0,state.energy-14);state.hunger=Math.max(0,state.hunger-7);message(state.name+' chased the yarn!','PLAYFUL');pet.style.left=(25+Math.random()*50)+'%';break;
      case 'pet':state.happiness=Math.min(100,state.happiness+10);message(state.name+' is purring.','LOVED');heart();break;
      case 'sleep':state.energy=Math.min(100,state.energy+28);pet.classList.add('sleeping');message(state.name+' is having a cozy nap.','SLEEPY');break;
    }
    state.level=1+Math.floor((state.happiness+state.hunger+state.energy)/150);
    render();
  }));
  function moveTo(clientX){
    const rect=room.getBoundingClientRect();const pct=Math.max(12,Math.min(88,((clientX-rect.left)/rect.width)*100));
    state.x=pct;pet.style.left=pct+'%';pet.classList.remove('sleeping');message(state.name+' came over to say hello!','CURIOUS');save();
  }
  room.addEventListener('click',e=>{if(e.target.closest('button'))return;moveTo(e.clientX);});
  pet.addEventListener('click',e=>{e.stopPropagation();state.happiness=Math.min(100,state.happiness+5);heart();message(state.name+' says meow!','LOVED');render();});
  pet.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pet.click();}});
  pet.style.left=state.x+'%';render();
  // Gentle idle wandering keeps the pet feeling alive without draining needs.
  let direction=1;
  setInterval(()=>{if(document.hidden||pet.classList.contains('sleeping'))return;let x=parseFloat(pet.style.left)||50;if(x>84)direction=-1;if(x<16)direction=1;pet.style.left=(x+direction*1.2)+'%';},1800);
})();
