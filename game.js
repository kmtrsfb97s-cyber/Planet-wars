(() => {
  const $=id=>document.getElementById(id), canvas=$('gameCanvas'), ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height, angle=$('angle'), power=$('power'), STEP=1/180, G=400000;
  const stars=Array.from({length:145},(_,i)=>({x:(i*83+19)%W,y:(i*57+43)%H,r:.5+(i%3)*.45,p:i*.51}));
  const planetPalettes=[
    ['#dda65a','#7e542e','#23150c'],
    ['#899fbd','#3b4c69','#101624'],
    ['#b68fc7','#60456f','#21172a'],
    ['#78a7c9','#345972','#10212e'],
    ['#a5b47d','#53653d','#192315'],
    ['#cf8063','#74402f','#25140f']
  ];
  let planets=[],playerTargets=[],enemyTargets=[],projectile=null,contrail=[],particles=[],preview=[];
  let launchSmoke=[],mushroomClouds=[],craters=[];
  let turn='player',locked=false,paused=false,last=0,acc=0,flight=0,elapsed=0,enemyTimer=null,shake=0,flash=0;
  let shieldActive=false,shieldAttempted=false,shieldUses=0,shieldRotation=0,threat=false;
  let mathResult=0,mathDeadline=0,mathTimer=null,audioCtx=null,musicOn=false,musicTimer=null,musicStep=0;

  const playerBase=()=>({cx:155,cy:H+58,r:205,a:-Math.PI/2+.42});
  const enemyBase=()=>({cx:W-155,cy:-52,r:205,a:Math.PI/2-.42});
  const surface=b=>({x:b.cx+Math.cos(b.a)*b.r,y:b.cy+Math.sin(b.a)*b.r});
  const coverage=()=>shieldUses===1?1:shieldUses===2?.55:shieldUses>=3?.1:0;
  const nextCoverage=()=>shieldUses===0?1:shieldUses===1?.55:.1;


  function generatePlanets(){
    const result=[];
    const count=4+Math.floor(Math.random()*3);
    const launchPoints=[surface(playerBase()),surface(enemyBase())];
    const safeFromHomes=(x,y,r)=>{
      for(const base of [playerBase(),enemyBase()]){
        if(Math.hypot(x-base.cx,y-base.cy)<base.r+r+72)return false;
      }
      for(const p of launchPoints){
        if(Math.hypot(x-p.x,y-p.y)<r+105)return false;
      }
      return true;
    };

    let attempts=0;
    while(result.length<count&&attempts<1200){
      attempts++;
      const central=result.length===0;
      const r=central?52+Math.random()*17:22+Math.random()*22;
      const x=central?W*.5+(Math.random()-.5)*105:85+r+Math.random()*(W-170-r*2);
      const y=central?H*.49+(Math.random()-.5)*145:205+r+Math.random()*(H-410-r*2);
      if(!safeFromHomes(x,y,r))continue;
      if(result.some(p=>Math.hypot(x-p.x,y-p.y)<r+p.r+48))continue;
      const palette=planetPalettes[Math.floor(Math.random()*planetPalettes.length)];
      result.push({x,y,r,d:.72+Math.random()*.62,c:[...palette],phase:Math.random()*Math.PI*2});
    }
    return result;
  }

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
  function homeCollision(b){
    if(b.age<.32)return null;
    const homes=[{base:playerBase(),side:'player'},{base:enemyBase(),side:'enemy'}];
    for(const h of homes){
      if(Math.hypot(b.x-h.base.cx,b.y-h.base.cy)<h.base.r+3)return{type:'home',side:h.side,base:h.base};
    }
    return null;
  }
  function collision(b){
    if(b.owner==='enemy'&&shieldCollision(b))return{type:'shield'};
    const t=b.owner==='player'?targetCollision(b,enemyTargets):targetCollision(b,playerTargets);
    if(t)return{type:b.owner==='player'?'enemyTarget':'playerTarget',target:t};
    const home=homeCollision(b);if(home)return home;
    if(planetCollision(b))return{type:'planet'};
    if(outside(b))return{type:'lost'}; return null;
  }
  function enemyVelocity(){
    const base=enemyBase(),start=surface(base),targets=playerTargets.filter(t=>t.alive),target=targets[Math.floor(Math.random()*targets.length)]||surface(playerBase());
    const outward={x:Math.cos(base.a),y:Math.sin(base.a)};
    let best={score:Infinity,a:base.a*180/Math.PI,p:85};

    // Alleen richtingen die eerst van de eigen thuisplaneet af bewegen.
    for(let deg=-4;deg<=138;deg+=6)for(let pow=60;pow<=118;pow+=7){
      const rad=deg*Math.PI/180;
      const directionDot=Math.cos(rad)*outward.x+Math.sin(rad)*outward.y;
      if(directionDot<.24)continue;
      const maxSpeed=pow*3.25,b={x:start.x+outward.x*8,y:start.y+outward.y*8,vx:Math.cos(rad)*maxSpeed*.2,vy:Math.sin(rad)*maxSpeed*.2,maxSpeed,age:0};let score=Infinity;
      for(let i=0;i<760;i++){
        integrate(b,STEP*3);
        score=Math.min(score,Math.hypot(b.x-target.x,b.y-target.y));
        if(outside(b)||planetCollision(b)||homeCollision(b))break;
      }
      if(score<best.score)best={score,a:deg,p:pow};
    }
    const jitter=(Math.random()-.5)*3;
    const a=(best.a+jitter)*Math.PI/180,maxSpeed=best.p*3.25;
    return{vx:Math.cos(a)*maxSpeed*.2,vy:Math.sin(a)*maxSpeed*.2,maxSpeed};
  }
  function reset(){
    clearTimeout(enemyTimer); planets=generatePlanets();playerTargets=makeTargets(playerBase(),false);enemyTargets=makeTargets(enemyBase(),true);
    projectile=null;contrail=[];particles=[];preview=[];launchSmoke=[];mushroomClouds=[];craters=[];turn='player';locked=false;paused=false;elapsed=0;threat=false;shieldActive=false;shieldAttempted=false;shieldUses=0;angle.value=-54;power.value=82;
    updateControls();showBanner('JOUW BEURT');$('status').textContent='Richt, bepaal de kracht en vuur af.';syncHud();
  }
  function updateControls(){const a=+angle.value;$('angleOut').textContent=(a<0?'−':'')+Math.abs(a)+'°';$('powerOut').textContent=power.value+'%';calculatePreview()}
  function calculatePreview(){
    preview=[];if(turn!=='player'||projectile)return;const start=surface(playerBase()),b={x:start.x,y:start.y,...playerVelocity(),age:0,owner:'player'};let dist=0,px=b.x,py=b.y;
    for(let i=0;i<1700;i++){integrate(b,STEP*2.4);dist+=Math.hypot(b.x-px,b.y-py);px=b.x;py=b.y;if(i%9===0)preview.push({x:b.x,y:b.y});if(dist>330||collision(b))break}
  }
  function launch(owner){
    const base=owner==='player'?playerBase():enemyBase(),v=owner==='player'?playerVelocity():enemyVelocity(),surfaceStart=surface(base),outward={x:Math.cos(base.a),y:Math.sin(base.a)},start={x:surfaceStart.x+outward.x*7,y:surfaceStart.y+outward.y*7};projectile={x:start.x,y:start.y,...v,age:0,owner,launchAge:0,launchDelay:.85,engineTime:2.1};contrail=[];launchSmoke=[];flight=0;acc=0;locked=true;shake=7;flash=.18;
    if(owner==='enemy'){threat=true;shieldAttempted=false;$('status').textContent='Vijandelijk projectiel onderweg. Shield is beschikbaar.'}
    burst(start.x,start.y,28,owner==='enemy'?'120,205,255':'255,185,60');
    for(let i=0;i<26;i++) launchSmoke.push({x:start.x+(Math.random()-.5)*10,y:start.y+(Math.random()-.5)*10,vx:(Math.random()-.5)*30,vy:(Math.random()-.5)*30,age:Math.random()*.15,life:.9+Math.random()*1.2,size:5+Math.random()*9});
    effect(owner==='enemy'?130:190,.42);syncHud();
  }
  function firePlayer(){if(turn==='player'&&!locked&&!paused)launch('player')}
  function beginEnemyTurn(){turn='enemy';locked=true;threat=false;shieldActive=false;shieldAttempted=false;syncHud();showBanner('VIJAND VUURT');$('status').textContent='De vijand bereidt een schot voor.';enemyTimer=setTimeout(()=>launch('enemy'),600)}
  function resolve(r){
    const owner=projectile.owner,x=projectile.x,y=projectile.y;projectile=null;locked=false;threat=false;
    if(r.type==='enemyTarget'){r.target.alive=false;nuclearExplosion(x,y);$('status').textContent='Vijandelijk doel vernietigd.'}
    else if(r.type==='playerTarget'){r.target.alive=false;nuclearExplosion(x,y);$('status').textContent='Een van jouw doelen is vernietigd.'}
    else if(r.type==='home'){
      const base=r.side==='player'?playerBase():enemyBase();
      addCrater(base,r.side,x,y);nuclearExplosion(x,y,.88);
      $('status').textContent=r.side==='player'?'De raket miste het doel en sloeg in op jouw thuisplaneet.':'De raket miste het doel en sloeg in op de vijandelijke thuisplaneet.';
    }
    else if(r.type==='shield'){shieldActive=false;energyImpact(x,y);showBanner('SCHILD BLOKKEERT');$('status').textContent='Het schild heeft het projectiel onderschept.'}
    else if(r.type==='planet'){nuclearExplosion(x,y,.62);$('status').textContent='Het projectiel raakte een planeet.'}
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
  function burst(x,y,n,rgb){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=25+Math.random()*115;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,age:0,life:.35+Math.random()*.65,size:1+Math.random()*2.6,rgb})}}
  function nuclearExplosion(x,y,scale=1){
    mushroomClouds.push({x,y,age:0,life:3.8,scale,seed:Math.random()*1000});
    burst(x,y,34,'255,208,110');burst(x,y,22,'255,105,25');shake=22*scale;flash=1.2*scale;effect(58,.8);
  }
  function energyImpact(x,y){burst(x,y,46,'120,225,255');shake=11;flash=.5;effect(190,.35)}
  function addCrater(base,side,x,y){
    const angle=Math.atan2(y-base.cy,x-base.cx),size=19+Math.random()*8;
    craters.push({side,angle,size,seed:Math.random()*1000});
  }
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
    if(projectile){
      projectile.launchAge+=dt;
      if(projectile.launchAge<projectile.launchDelay){
        shake=Math.max(shake,3+Math.random()*3);
        flash=Math.max(flash,.06+Math.random()*.06);
        emitContrail();
      }else{
        acc+=Math.min(dt,.05);
        while(acc>=STEP&&projectile){integrate(projectile,STEP);flight+=STEP;acc-=STEP;const r=collision(projectile);if(r){resolve(r);break}if(flight>19){resolve({type:'lost'});break}}
        if(projectile)emitContrail();
      }
    }
    for(const p of contrail){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.988;p.vy*=.988;p.size+=dt*8}contrail=contrail.filter(p=>p.age<p.life);
    for(const p of particles){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.982;p.vy*=.982}particles=particles.filter(p=>p.age<p.life);
    for(const p of launchSmoke){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97;p.size+=dt*12}launchSmoke=launchSmoke.filter(p=>p.age<p.life);
    for(const m of mushroomClouds)m.age+=dt;mushroomClouds=mushroomClouds.filter(m=>m.age<m.life);
    shieldRotation+=dt*.65;
  }
  function drawBackground(time){ctx.fillStyle='#020309';ctx.fillRect(0,0,W,H);for(const s of stars){ctx.fillStyle=`rgba(255,255,255,${.25+Math.sin(time*.002+s.p)*.18})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill()}}
  function drawPlanet(p,time){const y=p.y+Math.sin(time*.001+p.phase)*2,g=ctx.createRadialGradient(p.x-p.r*.35,y-p.r*.38,3,p.x,y,p.r);g.addColorStop(0,p.c[0]);g.addColorStop(.56,p.c[1]);g.addColorStop(1,p.c[2]);ctx.save();ctx.shadowColor=p.c[0];ctx.shadowBlur=9;ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,y,p.r,0,Math.PI*2);ctx.fill();ctx.restore()}
  function drawHome(b,enemy){const c=enemy?['#93607f','#432b48','#110b15']:['#71859e','#32465c','#09111b'],g=ctx.createRadialGradient(b.cx-b.r*.32,b.cy-b.r*.38,15,b.cx,b.cy,b.r);g.addColorStop(0,c[0]);g.addColorStop(.54,c[1]);g.addColorStop(1,c[2]);ctx.save();ctx.shadowColor=enemy?'rgba(220,120,190,.35)':'rgba(100,190,255,.3)';ctx.shadowBlur=20;ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.cx,b.cy,b.r,0,Math.PI*2);ctx.fill();ctx.restore()}
  function drawCraters(base,side){
    ctx.save();ctx.beginPath();ctx.arc(base.cx,base.cy,base.r,0,Math.PI*2);ctx.clip();
    for(const c of craters){
      if(c.side!==side)continue;
      const x=base.cx+Math.cos(c.angle)*(base.r-5),y=base.cy+Math.sin(c.angle)*(base.r-5);
      ctx.save();ctx.translate(x,y);ctx.rotate(c.angle+Math.PI/2);
      const g=ctx.createRadialGradient(-c.size*.18,-c.size*.22,1,0,0,c.size);
      g.addColorStop(0,'rgba(0,0,0,.96)');g.addColorStop(.48,'rgba(20,13,12,.94)');g.addColorStop(.72,'rgba(74,47,36,.78)');g.addColorStop(1,'rgba(7,5,5,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,c.size,c.size*.52,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(185,130,88,.38)';ctx.lineWidth=2;ctx.beginPath();
      for(let i=0;i<=18;i++){const a=i/18*Math.PI*2,r=c.size*(.78+.12*Math.sin(i*4.7+c.seed));const px=Math.cos(a)*r,py=Math.sin(a)*r*.52;i?ctx.lineTo(px,py):ctx.moveTo(px,py)}ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  function drawMushroomClouds(){
    ctx.save();ctx.globalCompositeOperation='screen';
    for(const m of mushroomClouds){
      const t=m.age/m.life,s=m.scale;
      const grow=Math.min(1,m.age/.85),fade=t<.72?1:(1-t)/.28;
      const rise=(18+115*Math.pow(t,.72))*s;
      const stemH=(22+78*grow)*s,stemW=(7+13*grow)*s;
      const baseY=m.y-rise*.18;
      const stem=ctx.createLinearGradient(m.x-stemW,baseY,m.x+stemW,baseY);
      stem.addColorStop(0,`rgba(120,53,22,${0})`);stem.addColorStop(.35,`rgba(255,120,36,${.6*fade})`);stem.addColorStop(.58,`rgba(255,237,166,${.85*fade})`);stem.addColorStop(1,`rgba(88,38,20,0)`);
      ctx.fillStyle=stem;ctx.beginPath();ctx.ellipse(m.x,baseY-stemH*.35,stemW,stemH*.72,0,0,Math.PI*2);ctx.fill();
      const capY=m.y-rise,capW=(18+58*grow+18*t)*s,capH=(12+30*grow)*s;
      const lobes=9;
      for(let i=0;i<lobes;i++){
        const a=(i/(lobes-1)-.5)*Math.PI*.94;
        const lx=m.x+Math.sin(a)*capW*.68,ly=capY+Math.cos(a)*capH*.18-Math.abs(Math.sin(a))*capH*.12;
        const rr=(14+18*grow)*(1-.22*Math.abs(Math.sin(a)))*s;
        const g=ctx.createRadialGradient(lx-rr*.2,ly-rr*.25,1,lx,ly,rr);
        g.addColorStop(0,`rgba(255,250,205,${.95*fade})`);g.addColorStop(.24,`rgba(255,184,65,${.9*fade})`);g.addColorStop(.63,`rgba(201,72,23,${.72*fade})`);g.addColorStop(1,'rgba(58,25,20,0)');
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(lx,ly,rr,0,Math.PI*2);ctx.fill();
      }
      ctx.strokeStyle=`rgba(255,198,93,${.42*fade})`;ctx.lineWidth=3*s;ctx.beginPath();ctx.ellipse(m.x,capY+capH*.22,capW*.82,capH*.36,0,0,Math.PI*2);ctx.stroke();
      if(m.age<.5){ctx.fillStyle=`rgba(255,255,235,${(1-m.age/.5)*.75})`;ctx.beginPath();ctx.arc(m.x,m.y,34*s*(1+m.age*2),0,Math.PI*2);ctx.fill()}
    }
    ctx.restore();
  }
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
    const a=Math.atan2(projectile.vy,projectile.vx),enemy=projectile.owner==='enemy';
    const ignition=projectile.launchAge<projectile.engineTime,onPad=projectile.launchAge<projectile.launchDelay;
    const scale=onPad?.82:.66,jitter=onPad?(Math.random()-.5)*1.1:0;
    ctx.save();ctx.translate(projectile.x+jitter,projectile.y+jitter);ctx.rotate(a);ctx.scale(scale,scale);
    if(ignition){
      const flame=(onPad?34:24)+Math.random()*(onPad?17:11),g=ctx.createLinearGradient(-flame,0,-13,0);
      g.addColorStop(0,'rgba(255,75,12,0)');g.addColorStop(.42,enemy?'rgba(92,205,255,.5)':'rgba(255,91,18,.62)');g.addColorStop(.78,'rgba(255,198,80,.94)');g.addColorStop(1,'rgba(255,255,235,1)');
      ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(-14,-3.2);ctx.lineTo(-flame,0);ctx.lineTo(-14,3.2);ctx.closePath();ctx.fill();
    }
    ctx.shadowColor=enemy?'rgba(105,205,235,.45)':'rgba(255,185,80,.35)';ctx.shadowBlur=5;
    const body=ctx.createLinearGradient(0,-6,0,6);body.addColorStop(0,'#d7d9d5');body.addColorStop(.48,'#777d7c');body.addColorStop(1,'#272d2f');
    ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(23,0);ctx.quadraticCurveTo(18,-4.8,10,-5.3);ctx.lineTo(-16,-5.3);ctx.lineTo(-19,-3.2);ctx.lineTo(-19,3.2);ctx.lineTo(-16,5.3);ctx.lineTo(10,5.3);ctx.quadraticCurveTo(18,4.8,23,0);ctx.fill();
    ctx.fillStyle=enemy?'#314f56':'#565a50';ctx.fillRect(-12,-5.4,4.3,10.8);
    ctx.fillStyle='#22282a';ctx.beginPath();ctx.moveTo(-15,-4.5);ctx.lineTo(-23,-9);ctx.lineTo(-18,-1);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(-15,4.5);ctx.lineTo(-23,9);ctx.lineTo(-18,1);ctx.closePath();ctx.fill();
    ctx.fillStyle=enemy?'#496a73':'#6b4032';ctx.fillRect(7,-5.4,2.4,10.8);
    ctx.strokeStyle='rgba(235,240,235,.35)';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-6,-4.3);ctx.lineTo(7,-4.3);ctx.stroke();
    ctx.restore();
  }
  function drawShield(){if(!shieldActive)return;const b=playerBase(),radius=b.r+35,segments=48,count=Math.max(1,Math.round(segments*coverage()));ctx.save();ctx.lineCap='round';ctx.strokeStyle='rgba(115,230,255,.9)';ctx.shadowColor='#6ce5ff';ctx.shadowBlur=13;ctx.lineWidth=7;for(let i=0;i<count;i++){const a1=shieldRotation+i*Math.PI*2/segments+.025,a2=shieldRotation+(i+1)*Math.PI*2/segments-.025;ctx.beginPath();ctx.arc(b.cx,b.cy,radius,a1,a2);ctx.stroke()}ctx.restore()}
  function drawParticles(){ctx.save();ctx.globalCompositeOperation='screen';for(const p of particles){const a=1-p.age/p.life;ctx.fillStyle=`rgba(${p.rgb},${a})`;ctx.beginPath();ctx.arc(p.x,p.y,p.size*a,0,Math.PI*2);ctx.fill()}ctx.restore()}
  function draw(time){ctx.save();if(shake>.1){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=.86}drawBackground(time);drawPreview();drawLaunchSmoke();drawContrail();planets.forEach(p=>drawPlanet(p,time));drawHome(playerBase(),false);drawCraters(playerBase(),'player');drawHome(enemyBase(),true);drawCraters(enemyBase(),'enemy');drawTargets(playerTargets,false,time);drawTargets(enemyTargets,true,time);drawLaunch(playerBase(),false,time);drawLaunch(enemyBase(),true,time);drawShield();drawProjectile();drawParticles();drawMushroomClouds();if(flash>.01){ctx.fillStyle=`rgba(255,245,210,${Math.min(.55,flash*.45)})`;ctx.fillRect(0,0,W,H);flash*=.84}ctx.restore()}
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
