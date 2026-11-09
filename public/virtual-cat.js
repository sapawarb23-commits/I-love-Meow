/* Virtual Cat MVP: local browser save, simple pixel movement and care actions. */
(() => {
  if (typeof Meow === 'undefined' || !Meow.requireAuth()) return;
  Meow.renderNav('virtual-cat');
  const userKey = 'ilm_virtual_cat_' + (Meow.user?.id || 'guest');
  const defaults = {name:'Mochi',cat:'black',accessory:'none',hunger:80,happiness:80,energy:80,level:1,x:50,mood:'CURIOUS'};
  let state = {...defaults};
  try { state = {...defaults,...JSON.parse(localStorage.getItem(userKey) || '{}')}; } catch {}
  const $ = id => document.getElementById(id);
  const pet = $('pixel-pet'), room = $('pixel-room');
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
