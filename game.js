(() => {
  const $=id=>document.getElementById(id), canvas=$('gameCanvas'), ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height, angle=$('angle'), power=$('power'), STEP=1/180, G=400000;
  const stars=Array.from({length:145},(_,i)=>({x:(i*83+19)%W,y:(i*57+43)%H,r:.5+(i%3)*.45,p:i*.51}));
  const template=[
    {x:380,y:450,r:65,d:1.25,c:['#dda65a','#7e542e','#23150c']},
    {x:150,y:300,r:27,d:.82,c:['#899fbd','#3b4c69','#101624']},
    {x:610,y:310,r:29,d:.84,c:['#b68fc7','#60456f','#21172a']},
    {x:245,y:600,r:25,d:.72,c:['#78a7c9','#345972','#10212e']},
    {x:535,y:625,r:31,d:.94,c:['#a5b47d','#53653d','#192315']}
  ];
  let planets=[],playerTargets=[],enemyTargets=[],projectile=null,contrail=[],particles=[],preview=[];
  let launchSmoke=[];
  let turn='player',locked=false,paused=false,last=0,acc=0,flight=0,elapsed=0,enemyTimer=null,shake=0,flash=0;
  let shieldActive=false,shieldAttempted=false,shieldUses=0,shieldRotation=0,threat=false;
  let mathResult=0,mathDeadline=0,mathTimer=null,audioCtx=null,musicOn=false,musicTimer=null,musicStep=0;

  const playerBase=()=>({cx:155,cy:H+58,r:205,a:-Math.PI/2+.42});
  const enemyBase=()=>({cx:W-155,cy:-52,r:205,a:Math.PI/2-.42});
  const surface=b=>({x:b.cx+Math.cos(b.a)*b.r,y:b.cy+Math.sin(b.a)*b.r});
  const coverage=()=>shieldUses===1?1:shieldUses===2?.55:shieldUses>=3?.1:0;
  const nextCoverage=()=>shieldUses===0?1:shieldUses===1?.55:.1;

  function makeTargets(base,enemy){
    const aa=enemy?[Math.PI/2-.65,Math.PI/2-.30,Math.PI/2+.08,Math.PI/2+.44]:[-Math.PI/2-.44,-Math.PI/2-.08,-Math.PI/2+.30,-Math.PI/2+.65];
    return aa.map((a,i)=>({x:base.cx+Math.cos(a)*(base.r-7),y:base.cy+Math.sin(a)*(base.r-7),r:14,alive:true,phase:i*1.2}));
  }
  function gravity(x,y){
    let ax=0,ay=0;
    for(const p of planets){const dx=p.x-x,dy=p.y-y,d2=Math.max(1,dx*dx+dy*dy),d=Math.sqrt(d2),m=Math.pow(p.r/34,2.3)*p.d,a=G*m/(d2+p.r*p.r*.22);ax+=a*dx/d;ay+=a*dy/d}
    return{ax,ay};
  }
  function integrate(b,dt){
    b.age+=dt; const g=gravity(b.x,b.y),s=Math.max(1,Math.hypot(b.vx,b.vy)),p=Math.min(1,b.age/3.2),smooth=p*p*(3-2*p),desired=b.maxSpeed*(.2+.8*smooth),boost=Math.max(0,desired-s)*2;
    b.vx+=(g.ax+b.vx/s*boost)*dt;b.vy+=(g.ay+b.vy/s*boost)*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
  }
  function playerVelocity(){const a=+angle.value*Math.PI/180,maxSpeed=+power.value*3.25;return{vx:Math.cos(a)*maxSpeed*.2,vy:Math.sin(a)*maxSpeed*.2,maxSpeed}}
  function outside(b){return b.x<-170||b.x>W+170||b.y<-170||b.y>H+170}
  function planetCollision(b){return planets.some(p=>Math.hypot(b.x-p.x,b.y-p.y)<p.r+5)}
  function targetCollision(b,list){return list.find(t=>t.alive&&Math.hypot(b.x-t.x,b.y-t.y)<t.r+8)||null}
  function shieldCollision(b){
    if(!shieldActive)return false; const base=playerBase(),radius=base.r+35;
    if(Math.abs(Math.hypot(b.x-base.cx,b.y-base.cy)-radius)>11)return false;
    const segments=48,count=Math.max(1,Math.round(segments*coverage())),v=((Math.atan2(b.y-base.cy,b.x-base.cx)-shieldRotation)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
    return Math.floor(v/(Math.PI*2)*segments)<count;
  }
  function collision(b){
    if(planetCollision(b))return{type:'planet'};
    if(b.owner==='enemy'&&shieldCollision(b))return{type:'shield'};
    const t=b.owner==='player'?targetCollision(b,enemyTargets):targetCollision(b,playerTargets);
    if(t)return{type:b.owner==='player'?'enemyTarget':'playerTarget',target:t};
    if(outside(b))return{type:'lost'}; return null;
  }
  function enemyVelocity(){
    const start=surface(enemyBase()),targets=playerTargets.filter(t=>t.alive),target=targets[Math.floor(Math.random()*targets.length)]||surface(playerBase());
    let best={score:Infinity,a:60,p:85};
    for(let deg=5;deg<=175;deg+=8)for(let pow=60;pow<=118;pow+=9){
      const maxSpeed=pow*3.25,b={x:start.x,y:start.y,vx:Math.cos(deg*Math.PI/180)*maxSpeed*.2,vy:Math.sin(deg*Math.PI/180)*maxSpeed*.2,maxSpeed,age:0};let score=Infinity;
      for(let i=0;i<700;i++){integrate(b,STEP*3);score=Math.min(score,Math.hypot(b.x-target.x,b.y-target.y));if(outside(b)||planetCollision(b))break}
      if(score<best.score)best={score,a:deg,p:pow};
    }
    const a=(best.a+(Math.random()-.5)*5)*Math.PI/180,maxSpeed=best.p*3.25;return{vx:Math.cos(a)*maxSpeed*.2,vy:Math.sin(a)*maxSpeed*.2,maxSpeed};
  }
  function reset(){
    clearTimeout(enemyTimer); planets=template.map((p,i)=>({...p,phase:i*1.4}));playerTargets=makeTargets(playerBase(),false);enemyTargets=makeTargets(enemyBase(),true);
    projectile=null;contrail=[];particles=[];preview=[];turn='player';locked=false;paused=false;elapsed=0;threat=false;shieldActive=false;shieldAttempted=false;shieldUses=0;angle.value=-54;power.value=82;
    updateControls();showBanner('JOUW BEURT');$('status').textContent='Richt, bepaal de kracht en vuur af.';syncHud();
  }
  function updateControls(){const a=+angle.value;$('angleOut').textContent=(a<0?'−':'')+Math.abs(a)+'°';$('powerOut').textContent=power.value+'%';calculatePreview()}
  function calculatePreview(){
    preview=[];if(turn!=='player'||projectile)return;const start=surface(playerBase()),b={x:start.x,y:start.y,...playerVelocity(),age:0,owner:'player'};let dist=0,px=b.x,py=b.y;
    for(let i=0;i<1700;i++){integrate(b,STEP*2.4);dist+=Math.hypot(b.x-px,b.y-py);px=b.x;py=b.y;if(i%9===0)preview.push({x:b.x,y:b.y});if(dist>330||collision(b))break}
  }
  function launch(owner){
    const base=owner==='player'?playerBase():enemyBase(),v=owner==='player'?playerVelocity():enemyVelocity(),start=surface(base);projectile={x:start.x,y:start.y,...v,age:0,owner,launchAge:0,engineTime:1.35};contrail=[];launchSmoke=[];flight=0;acc=0;locked=true;shake=7;flash=.18;
    if(owner==='enemy'){threat=true;shieldAttempted=false;$('status').textContent='Vijandelijk projectiel onderweg. Shield is beschikbaar.'}
    burst(start.x,start.y,28,owner==='enemy'?'120,205,255':'255,185,60');
    for(let i=0;i<26;i++) launchSmoke.push({x:start.x+(Math.random()-.5)*10,y:start.y+(Math.random()-.5)*10,vx:(Math.random()-.5)*30,vy:(Math.random()-.5)*30,age:Math.random()*.15,life:.9+Math.random()*1.2,size:5+Math.random()*9});
    effect(owner==='enemy'?130:190,.42);syncHud();
  }
  function firePlayer(){if(turn==='player'&&!locked&&!paused)launch('player')}
  function beginEnemyTurn(){turn='enemy';locked=true;threat=false;shieldActive=false;shieldAttempted=false;syncHud();showBanner('VIJAND VUURT');$('status').textContent='De vijand bereidt een schot voor.';enemyTimer=setTimeout(()=>launch('enemy'),600)}
  function resolve(r){
    const owner=projectile.owner,x=projectile.x,y=projectile.y;projectile=null;locked=false;threat=false;
    if(r.type==='enemyTarget'){r.target.alive=false;explosion(x,y);$('status').textContent='Vijandelijk doel vernietigd.'}
    else if(r.type==='playerTarget'){r.target.alive=false;explosion(x,y);$('status').textContent='Een van jouw doelen is vernietigd.'}
    else if(r.type==='shield'){shieldActive=false;explosion(x,y);showBanner('SCHILD BLOKKEERT');$('status').textContent='Het schild heeft het projectiel onderschept.'}
    else if(r.type==='planet'){explosion(x,y);$('status').textContent='Het projectiel raakte een planeet.'}
    else $('status').textContent='Het projectiel verdween in de ruimte.';
    syncHud();
    if(enemyTargets.every(t=>!t.alive)){showBanner('OVERWINNING');setTimeout(reset,2300);return}
    if(playerTargets.every(t=>!t.alive)){showBanner('VERLOREN');setTimeout(reset,2300);return}
    if(owner==='player')beginEnemyTurn();else{turn='player';locked=false;shieldActive=false;shieldAttempted=false;calculatePreview();showBanner('JOUW BEURT');syncHud()}
  }
  function openShield(){
    if(!threat||shieldAttempted||paused||projectile?.owner!=='enemy')return;paused=true;shieldAttempted=true;const a=1+Math.floor(Math.random()*10),b=1+Math.floor(Math.random()*10);mathResult=a*b;
    $('question').textContent=`${a} × ${b} = ?`;$('answer').value='';$('feedback').textContent='';$('mathLayer').hidden=false;mathDeadline=performance.now()+8000;updateCountdown();mathTimer=setInterval(updateCountdown,100);syncHud();setTimeout(()=>$('answer').focus(),20);
  }
  function updateCountdown(){const left=Math.max(0,mathDeadline-performance.now());$('countdown').textContent=Math.ceil(left/1000);if(left<=0)finishMath(false)}
  function submitMath(){if($('answer').value===''){$('feedback').textContent='Vul eerst een antwoord in.';return}if(+$('answer').value===mathResult)finishMath(true);else{$('feedback').textContent='Onjuist. Probeer opnieuw.';$('answer').select()}}
  function finishMath(ok){
    if($('mathLayer').hidden)return;clearInterval(mathTimer);$('mathLayer').hidden=true;paused=false;
    if(ok){shieldUses++;shieldActive=true;showBanner(`SCHILD ${Math.round(coverage()*100)}%`);$('status').textContent=`Schild geactiveerd met ${Math.round(coverage()*100)}% dekking.`;effect(520,.18)}else $('status').textContent='De tijd is voorbij. Het projectiel vliegt verder.';syncHud();
  }
  function syncHud(){
    $('turnText').textContent=turn==='player'?'JOUW BEURT':'VIJAND VUURT';$('playerCount').textContent=playerTargets.filter(t=>t.alive).length;$('enemyCount').textContent=enemyTargets.filter(t=>t.alive).length;
    $('shieldText').textContent=shieldActive?`SCHILD ${Math.round(coverage()*100)}%`:`VOLGEND SCHILD ${Math.round(nextCoverage()*100)}%`;$('fire').disabled=turn!=='player'||locked||paused;
    const ready=threat&&!shieldAttempted&&!paused&&projectile?.owner==='enemy';$('shield').disabled=!ready;$('shield').classList.toggle('ready',ready);
  }
  function showBanner(text){const e=$('banner');e.textContent=text;e.classList.remove('show');void e.offsetWidth;e.classList.add('show')}
  function burst(x,y,n,rgb){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=30+Math.random()*150;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,age:0,life:.5+Math.random()*.7,size:2+Math.random()*4,rgb})}}
  function explosion(x,y){burst(x,y,75,'255,135,35');burst(x,y,35,'255,238,150');shake=18;flash=1;effect(75,.5)}
  function emitContrail(){
    if(!projectile)return;
    const s=Math.max(1,Math.hypot(projectile.vx,projectile.vy)),nx=projectile.vx/s,ny=projectile.vy/s,px=-ny,py=nx;
    const ignition=projectile.launchAge<projectile.engineTime;
    const count=ignition?8:3;
    for(let i=0;i<count;i++){
      const spread=(Math.random()-.5)*(ignition?8:4);
      contrail.push({
        x:projectile.x-nx*(ignition?18+Math.random()*18:8+Math.random()*8)+px*spread,
        y:projectile.y-ny*(ignition?18+Math.random()*18:8+Math.random()*8)+py*spread,
        vx:-nx*(ignition?32+Math.random()*42:8+Math.random()*11)+px*(Math.random()-.5)*(ignition?28:13),
        vy:-ny*(ignition?32+Math.random()*42:8+Math.random()*11)+py*(Math.random()-.5)*(ignition?28:13),
        age:0,life:ignition?.7+Math.random()*.8:1.15+Math.random()*.8,
        size:ignition?4+Math.random()*6:2.5+Math.random()*2.5,
        owner:projectile.owner,hot:ignition
      });
    }
    if(ignition&&Math.random()<.75){
      launchSmoke.push({x:projectile.x-nx*24+px*(Math.random()-.5)*10,y:projectile.y-ny*24+py*(Math.random()-.5)*10,vx:-nx*(12+Math.random()*20)+px*(Math.random()-.5)*18,vy:-ny*(12+Math.random()*20)+py*(Math.random()-.5)*18,age:0,life:1.2+Math.random()*1.4,size:6+Math.random()*10});
    }
    if(contrail.length>340)contrail.splice(0,contrail.length-340);
  }
  function update(dt){
    if(paused)return;elapsed+=dt;const rem=Math.max(0,160-Math.floor(elapsed));$('clockText').textContent=String(Math.floor(rem/60)).padStart(2,'0')+':'+String(rem%60).padStart(2,'0');
    if(projectile){projectile.launchAge+=dt;acc+=Math.min(dt,.05);while(acc>=STEP&&projectile){integrate(projectile,STEP);flight+=STEP;acc-=STEP;const r=collision(projectile);if(r){resolve(r);break}if(flight>19){resolve({type:'lost'});break}}if(projectile)emitContrail()}
    for(const p of contrail){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.988;p.vy*=.988;p.size+=dt*8}contrail=contrail.filter(p=>p.age<p.life);
    for(const p of particles){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.982;p.vy*=.982}particles=particles.filter(p=>p.age<p.life);
    for(const p of launchSmoke){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97;p.size+=dt*12}launchSmoke=launchSmoke.filter(p=>p.age<p.life);
    shieldRotation+=dt*.65;
  }
  function drawBackground(time){ctx.fillStyle='#020309';ctx.fillRect(0,0,W,H);for(const s of stars){ctx.fillStyle=`rgba(255,255,255,${.25+Math.sin(time*.002+s.p)*.18})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill()}}
  function drawPlanet(p,time){const y=p.y+Math.sin(time*.001+p.phase)*2,g=ctx.createRadialGradient(p.x-p.r*.35,y-p.r*.38,3,p.x,y,p.r);g.addColorStop(0,p.c[0]);g.addColorStop(.56,p.c[1]);g.addColorStop(1,p.c[2]);ctx.save();ctx.shadowColor=p.c[0];ctx.shadowBlur=9;ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,y,p.r,0,Math.PI*2);ctx.fill();ctx.restore()}
  function drawHome(b,enemy){const c=enemy?['#93607f','#432b48','#110b15']:['#71859e','#32465c','#09111b'],g=ctx.createRadialGradient(b.cx-b.r*.32,b.cy-b.r*.38,15,b.cx,b.cy,b.r);g.addColorStop(0,c[0]);g.addColorStop(.54,c[1]);g.addColorStop(1,c[2]);ctx.save();ctx.shadowColor=enemy?'rgba(220,120,190,.35)':'rgba(100,190,255,.3)';ctx.shadowBlur=20;ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.cx,b.cy,b.r,0,Math.PI*2);ctx.fill();ctx.restore()}
  function drawTargets(list,enemy,time){for(const t of list){if(!t.alive)continue;const pulse=1+Math.sin(time*.006+t.phase)*.1;ctx.save();ctx.strokeStyle=enemy?'#ff9b42':'#75dbff';ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=10;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(t.x,t.y,t.r*pulse,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(t.x-18,t.y);ctx.lineTo(t.x+18,t.y);ctx.moveTo(t.x,t.y-18);ctx.lineTo(t.x,t.y+18);ctx.stroke();ctx.restore()}}
  function drawLaunch(b,enemy,time){const p=surface(b),r=9+Math.sin(time*.007)*2;ctx.save();ctx.strokeStyle=enemy?'#79d5ff':'#ffc35d';ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=12;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.restore()}
  function drawPreview(){if(turn!=='player'||projectile)return;for(let i=0;i<preview.length;i+=2){ctx.fillStyle='rgba(255,204,82,.62)';ctx.beginPath();ctx.arc(preview[i].x,preview[i].y,1.8,0,Math.PI*2);ctx.fill()}}
  function drawLaunchSmoke(){
    ctx.save();
    for(const p of launchSmoke){
      const life=p.age/p.life,a=Math.pow(1-life,1.5),r=p.size*(1+life*1.8);
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
      g.addColorStop(0,`rgba(210,205,190,${a*.32})`);g.addColorStop(.55,`rgba(105,105,110,${a*.22})`);g.addColorStop(1,'rgba(45,45,52,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  function drawContrail(){ctx.save();ctx.globalCompositeOperation='screen';for(const p of contrail){const life=p.age/p.life,a=Math.pow(1-life,1.7),rgb=p.hot?(p.owner==='enemy'?'175,235,255':'255,150,45'):(p.owner==='enemy'?'150,215,255':'255,226,175'),r=p.size*(1+life*2.8),g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);g.addColorStop(0,`rgba(255,255,255,${a*(p.hot?.75:.24)})`);g.addColorStop(.28,`rgba(${rgb},${a*(p.hot?.52:.13)})`);g.addColorStop(1,`rgba(${rgb},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(p.x,p.y,r*(p.hot?1.9:1.4),r,.15,0,Math.PI*2);ctx.fill()}ctx.restore()}
  function drawProjectile(){
    if(!projectile)return;
    const a=Math.atan2(projectile.vy,projectile.vx),enemy=projectile.owner==='enemy',ignition=projectile.launchAge<projectile.engineTime;
    ctx.save();ctx.translate(projectile.x,projectile.y);ctx.rotate(a);
    if(ignition){
      const flame=24+Math.random()*18;
      const fg=ctx.createLinearGradient(-flame,0,-5,0);fg.addColorStop(0,'rgba(255,80,15,0)');fg.addColorStop(.45,enemy?'rgba(110,220,255,.85)':'rgba(255,110,20,.9)');fg.addColorStop(1,'rgba(255,255,225,1)');
      ctx.fillStyle=fg;ctx.beginPath();ctx.moveTo(-7,-5);ctx.lineTo(-flame,0);ctx.lineTo(-7,5);ctx.closePath();ctx.fill();
    }
    ctx.shadowColor=enemy?'#79dfff':'#ffd06b';ctx.shadowBlur=10;
    ctx.fillStyle=enemy?'#c8e9f4':'#e8e1d2';ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(4,-6);ctx.lineTo(-9,-5);ctx.lineTo(-12,0);ctx.lineTo(-9,5);ctx.lineTo(4,6);ctx.closePath();ctx.fill();
    ctx.fillStyle=enemy?'#4185a1':'#b54525';ctx.beginPath();ctx.moveTo(5,-6);ctx.lineTo(13,0);ctx.lineTo(5,6);ctx.closePath();ctx.fill();
    ctx.fillStyle=enemy?'#224b60':'#5e281b';ctx.fillRect(-8,-7,5,14);
    ctx.restore();
  }
  function drawShield(){if(!shieldActive)return;const b=playerBase(),radius=b.r+35,segments=48,count=Math.max(1,Math.round(segments*coverage()));ctx.save();ctx.lineCap='round';ctx.strokeStyle='rgba(115,230,255,.9)';ctx.shadowColor='#6ce5ff';ctx.shadowBlur=13;ctx.lineWidth=7;for(let i=0;i<count;i++){const a1=shieldRotation+i*Math.PI*2/segments+.025,a2=shieldRotation+(i+1)*Math.PI*2/segments-.025;ctx.beginPath();ctx.arc(b.cx,b.cy,radius,a1,a2);ctx.stroke()}ctx.restore()}
  function drawParticles(){ctx.save();ctx.globalCompositeOperation='screen';for(const p of particles){const a=1-p.age/p.life;ctx.fillStyle=`rgba(${p.rgb},${a})`;ctx.beginPath();ctx.arc(p.x,p.y,p.size*a,0,Math.PI*2);ctx.fill()}ctx.restore()}
  function draw(time){ctx.save();if(shake>.1){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=.86}drawBackground(time);drawPreview();drawLaunchSmoke();drawContrail();planets.forEach(p=>drawPlanet(p,time));drawHome(playerBase(),false);drawHome(enemyBase(),true);drawTargets(playerTargets,false,time);drawTargets(enemyTargets,true,time);drawLaunch(playerBase(),false,time);drawLaunch(enemyBase(),true,time);drawShield();drawProjectile();drawParticles();if(flash>.01){ctx.fillStyle=`rgba(255,245,210,${Math.min(.55,flash*.45)})`;ctx.fillRect(0,0,W,H);flash*=.84}ctx.restore()}
  function frame(time){const dt=Math.min((time-last)/1000||0,.04);last=time;update(dt);draw(time);syncHud();requestAnimationFrame(frame)}
  function nudge(input,d){input.value=Math.max(+input.min,Math.min(+input.max,+input.value+d));updateControls()}
  function ensureAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume()}
  function effect(freq,dur){if(!musicOn)return;ensureAudio();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.setValueAtTime(freq,audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(45,freq*.55),audioCtx.currentTime+dur);g.gain.setValueAtTime(.05,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+dur);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur)}
  function startMusic(){ensureAudio();const notes=[110,146.83,164.81,220,164.81,146.83,123.47,146.83];clearInterval(musicTimer);musicTimer=setInterval(()=>{if(!musicOn)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='triangle';o.frequency.value=notes[musicStep++%notes.length];g.gain.setValueAtTime(.018,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.75);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.76)},620)}
  function toggleMusic(){musicOn=!musicOn;$('music').textContent=musicOn?'MUZIEK UIT':'MUZIEK AAN';if(musicOn)startMusic();else clearInterval(musicTimer)}

  angle.addEventListener('input',updateControls);power.addEventListener('input',updateControls);
  $('angleDown').onclick=()=>nudge(angle,-2);$('angleUp').onclick=()=>nudge(angle,2);$('powerDown').onclick=()=>nudge(power,-1);$('powerUp').onclick=()=>nudge(power,1);
  $('fire').onclick=firePlayer;$('shield').onclick=openShield;$('restart').onclick=reset;$('music').onclick=toggleMusic;$('submitAnswer').onclick=submitMath;$('answer').addEventListener('keydown',e=>{if(e.key==='Enter')submitMath()});
  reset();requestAnimationFrame(frame);
})();
