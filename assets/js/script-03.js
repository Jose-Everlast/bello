window.__BELLO_CANONICAL_ASSETS__={"base":"assets/images/embedded-01.webp","glass":"assets/images/embedded-02.webp","ice":"assets/images/embedded-03.webp","liquid":"assets/images/embedded-04.webp","orange":"assets/images/embedded-05.webp","original":"assets/images/embedded-06.webp","cube1":"assets/images/embedded-07.webp","cube2":"assets/images/embedded-08.webp","cube3":"assets/images/embedded-09.webp"};

(()=>{
'use strict';
const section=document.getElementById('hero-scroll');
const sticky=section.querySelector('.hero-sticky');
const canvas=document.getElementById('bello-canvas');
const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
const progressEl=document.getElementById('mix-progress');
const percentEl=document.getElementById('mix-percent');
const titleEl=document.getElementById('stage-title');
const subtitleEl=document.getElementById('stage-subtitle');
const labelEl=titleEl.parentElement;
const scene=canvas.parentElement;
const steps=[...document.querySelectorAll('#hero-scroll [data-step]')];
const cue=document.getElementById('scroll-cue');
const info=[['01 / GLAS','Der Anfang.'],['02 / EIS','Klar. Kalt. Kristall.'],['03 / NEGRONI','Bitter. Stark. Italienisch.'],['04 / ORANGE','Der letzte Schliff.']];
const sources=window.__BELLO_CANONICAL_ASSETS__;
const assets={};
const sourceW=709,sourceH=411;
const load=k=>new Promise((resolve,reject)=>{let im=new Image();im.decoding='async';im.onload=()=>{assets[k]=im;resolve()};im.onerror=reject;im.src=sources[k]});
let ready=false, target=0, displayed=0, raf=0, lastTime=0, stage=-1, sizeW=0,sizeH=0,pxratio=1;
// Time-based secondary motion, fed by scroll speed: pour stream strength and surface tilt (spring).
let stream=0, tilt=0, tiltV=0, clock=0, swapTimer=0, cheers=-1;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const span=(a,b,t)=>clamp((t-a)/(b-a));
const smooth=(a,b,t)=>{const x=span(a,b,t);return x*x*(3-2*x)};
const easeOut=t=>1-Math.pow(1-t,3);
// Remaining height of a falling object: accelerates, lands at t=.72, then one damped rebound.
const drop=t=>{if(t<.72){const u=t/.72;return 1-u*u}const u=(t-.72)/.28;return .07*Math.sin(u*Math.PI)*(1-u)};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
// Draw order (back to front) stays as in the photo; arrival order is bottom cube first.
const cubes=[
  {name:'cube1',cx:316,cy:191,from:.305,to:.405,height:96,spin:-.5},
  {name:'cube2',cx:372,cy:257,from:.225,to:.335,height:78,spin:.38},
  {name:'cube3',cx:323,cy:292,from:.16,to:.265,height:70,spin:-.3}
];
const HORIZON=306, POUR_X=388, POUR_FROM=.405, POUR_TO=.83;
function scrollProgress(){if(reduced.matches)return 1;const top=section.getBoundingClientRect().top;const range=Math.max(1,section.offsetHeight-sticky.clientHeight);return clamp(-top/range)}
function fit(){const r=canvas.getBoundingClientRect();const ratio=Math.min(devicePixelRatio||1,r.width<700?1.4:1.7);const w=Math.max(1,Math.round(r.width*ratio)),h=Math.max(1,Math.round(r.height*ratio));if(w!==sizeW||h!==sizeH){sizeW=w;sizeH=h;pxratio=ratio;canvas.width=w;canvas.height=h;return true}return false}
function setStageText(){titleEl.textContent=info[stage][0];subtitleEl.textContent=info[stage][1];labelEl.classList.remove('swap')}
function updateUi(p){
  progressEl.style.transform=`scaleX(${p.toFixed(5)})`;
  percentEl.textContent=String(Math.round(p*100)).padStart(2,'0')+' / 100';
  const next=p<.16?0:p<.40?1:p<.82?2:3;
  if(next!==stage){
    const first=stage===-1;stage=next;
    steps.forEach((el,i)=>el.classList.toggle('active',i===stage));
    clearTimeout(swapTimer);
    if(first||reduced.matches)setStageText();
    else{labelEl.classList.add('swap');swapTimer=setTimeout(setStageText,170)}
  }
  if(cue)cue.style.opacity=String(clamp((.12-p)/.12));
  // The toast arrives once the drink is finished; CSS reads --cheers (0..1).
  const c=smooth(.955,.99,p);
  if(c!==cheers){cheers=c;scene.style.setProperty('--cheers',c.toFixed(3))}
}
function draw(p){
  if(!ready)return;
  fit();
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,sizeW,sizeH);
  // Cover transform is calculated ONCE and shared by every component for every scroll position.
  const scale=Math.max(sizeW/sourceW,sizeH/sourceH),x=(sizeW-sourceW*scale)/2,y=(sizeH-sourceH*scale)/2;
  ctx.setTransform(scale,0,0,scale,x,y);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const img=(name,alpha=1)=>{if(alpha<=0)return;ctx.globalAlpha=alpha;ctx.drawImage(assets[name],0,0,sourceW,sourceH);ctx.globalAlpha=1};
  // Same layer, shifted by dy and rotated around its own centre (cx,cy).
  const sprite=(name,alpha,dy,rot,cx,cy)=>{
    if(alpha<=0)return;
    if(!dy&&!rot)return img(name,alpha);
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(cx,cy+dy);ctx.rotate(rot);ctx.translate(-cx,-cy);
    ctx.drawImage(assets[name],0,0,sourceW,sourceH);ctx.restore();
  };
  // TRIAL: Bello backdrop instead of the dark bar photo. Signal-red wall, deep-red counter.
  const vx0=-x/scale-2, vy0=-y/scale-2, vw=sizeW/scale+4, vh=sizeH/scale+4;
  const wall=ctx.createRadialGradient(356,215,20,356,215,430);
  wall.addColorStop(0,'#f2412f');wall.addColorStop(.45,'#e0261c');wall.addColorStop(1,'#b81a13');
  ctx.fillStyle=wall;ctx.fillRect(vx0,vy0,vw,vh);
  const counter=ctx.createLinearGradient(0,HORIZON,0,sourceH+20);
  counter.addColorStop(0,'#6b100c');counter.addColorStop(.25,'#4d0b08');counter.addColorStop(1,'#2b0605');
  ctx.fillStyle=counter;ctx.fillRect(vx0,HORIZON,vw,vy0+vh-HORIZON);
  ctx.fillStyle='rgba(255,170,140,.28)';ctx.fillRect(vx0,HORIZON,vw,.8);
  const glassIn=smooth(.03,.15,p);
  if(glassIn>0){
    // Contact shadow so the glass stands on the counter.
    const sh=ctx.createRadialGradient(356,357,4,356,357,104);
    sh.addColorStop(0,`rgba(0,0,0,${(.5*glassIn).toFixed(3)})`);sh.addColorStop(1,'rgba(0,0,0,0)');
    ctx.save();ctx.translate(356,357);ctx.scale(1,.1);ctx.translate(-356,-357);ctx.fillStyle=sh;ctx.fillRect(240,250,232,214);ctx.restore();
  }
  // Glass and ice were cut from a dark photo: 'screen' drops the dark and keeps the highlights.
  ctx.globalCompositeOperation='screen';
  // The glass is set down rather than faded in place.
  sprite('glass',glassIn,-7*(1-easeOut(span(.03,.15,p))),0,356,276);
  // Ice drops in from above the rim, bottom cube first, each with a short settle.
  for(const c of cubes){
    const t=span(c.from,c.to,p);if(t<=0)continue;
    const h=drop(t);
    sprite(c.name,smooth(0,.42,t),-c.height*h,c.spin*Math.max(0,h),c.cx,c.cy);
  }
  ctx.globalCompositeOperation='source-over';
  // One fluid layer with one waterline. It rises fast at first and eases out as the glass fills.
  const pt=span(POUR_FROM,POUR_TO,p);
  const fill=1-Math.pow(1-pt,1.7);
  // Bottom of inner glass y=347, top of fluid at y=207. Clipping is done in source-photo coordinates.
  const surface=347-140*fill;
  const calm=smooth(0,.08,fill)*(1-smooth(.9,1,fill));
  const lean=tilt*calm, ripple=Math.sin(clock*.011)*1.1*stream*calm;
  const yL=surface+lean, yR=surface-lean;
  if(fill>.0001){
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(273,yL+2);ctx.bezierCurveTo(312,yL-1.6+ripple,389,yR-1.6-ripple,435,yR+2);ctx.lineTo(435,365);ctx.lineTo(273,365);ctx.closePath();
    ctx.clip();
    img('liquid');
    ctx.restore();
    // A restrained specular meniscus follows only the moving surface.
    if(fill>.03&&fill<.99){
      const g=ctx.createLinearGradient(291,surface,419,surface);
      g.addColorStop(0,'rgba(255,129,49,0)');g.addColorStop(.2,'rgba(255,152,71,.28)');g.addColorStop(.55,'rgba(255,209,146,.42)');g.addColorStop(.85,'rgba(255,129,49,.27)');g.addColorStop(1,'rgba(255,129,49,0)');
      ctx.strokeStyle=g;ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(282,yL+1.7);ctx.bezierCurveTo(317,yL-1.7+ripple,389,yR-1.7-ripple,425,yR+1.7);ctx.stroke();
    }
  }
  // The pour: a thin stream that only runs while the visitor is actually scrolling forward.
  // Gated by scroll position too, so a fast fling never leaves a stream over the finished drink.
  const flow=stream*smooth(POUR_FROM-.005,POUR_FROM+.015,p)*(1-smooth(POUR_TO-.03,POUR_TO+.005,p));
  if(flow>.004){
    const hit=surface+(yR-yL)*((POUR_X-273)/162)+1;
    const sway=Math.sin(clock*.006)*.7;
    const w=1.1+2.5*flow;
    ctx.save();ctx.lineCap='round';ctx.globalAlpha=Math.min(1,flow*1.7);
    const body=ctx.createLinearGradient(0,-10,0,hit);
    body.addColorStop(0,'rgba(104,14,9,.7)');body.addColorStop(.6,'rgba(116,16,10,.9)');body.addColorStop(1,'rgba(134,22,12,.95)');
    // Falling liquid speeds up, so the stream narrows towards the surface.
    const end=POUR_X+sway*.4;
    ctx.fillStyle=body;
    ctx.beginPath();ctx.moveTo(POUR_X-w/2,-10);ctx.quadraticCurveTo(POUR_X+sway-w*.4,hit*.5,end-w*.28,hit);
    ctx.lineTo(end+w*.28,hit);ctx.quadraticCurveTo(POUR_X+sway+w*.4,hit*.5,POUR_X+w/2,-10);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(255,206,150,.62)';ctx.lineWidth=Math.max(.5,w*.28);
    ctx.beginPath();ctx.moveTo(POUR_X-w*.2,-10);ctx.quadraticCurveTo(POUR_X+sway-w*.2,hit*.5,POUR_X+sway*.4-w*.2,hit-2);ctx.stroke();
    ctx.fillStyle=`rgba(255,196,140,${(.34*flow).toFixed(3)})`;
    ctx.beginPath();ctx.ellipse(POUR_X+sway*.4,hit+.6,4.5+3.5*flow,1.3,0,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  // The orange is placed, not faded: a short descent with a slight turn.
  const ot=span(.835,.965,p);
  if(ot>0){const rest=1-easeOut(ot);sprite('orange',smooth(0,.4,ot),-34*rest,-.22*rest,380,172)}
}
function tick(ts){raf=0;const dt=lastTime?Math.min(50,ts-lastTime):16;lastTime=ts;clock+=dt;
 const before=displayed;
 displayed+=(target-displayed)*(1-Math.exp(-dt/90));
 if(Math.abs(target-displayed)<.00025)displayed=target;
 const s=dt/1000, speed=(displayed-before)/s;
 const pouring=displayed>POUR_FROM&&displayed<POUR_TO-.005;
 const want=pouring?clamp(speed/.1):0;
 stream+=(want-stream)*(1-Math.exp(-dt/(want>stream?110:240)));
 if(want===0&&stream<.004)stream=0;
 const aim=pouring?clamp(speed*9,-4,4):0;
 tiltV+=(-90*(tilt-aim)-7*tiltV)*s;tilt+=tiltV*s;
 if(aim===0&&Math.abs(tilt)<.02&&Math.abs(tiltV)<.05){tilt=0;tiltV=0}
 draw(displayed);updateUi(displayed);
 if(displayed!==target||stream!==0||tilt!==0||tiltV!==0)raf=requestAnimationFrame(tick);else lastTime=0;
}
function schedule(){if(!ready)return;target=scrollProgress();if(!raf)raf=requestAnimationFrame(tick)}
// Remove the dark photo fringe from a cut-out layer: dark pixels become transparent.
function keyed(name,lo,hi){
  try{
    const c=document.createElement('canvas');c.width=sourceW;c.height=sourceH;
    const k=c.getContext('2d');k.drawImage(assets[name],0,0,sourceW,sourceH);
    const d=k.getImageData(0,0,sourceW,sourceH),a=d.data;
    for(let i=0;i<a.length;i+=4){const lum=(.2126*a[i]+.7152*a[i+1]+.0722*a[i+2])/255;a[i+3]=Math.round(a[i+3]*smooth(lo,hi,lum))}
    k.putImageData(d,0,0);assets[name]=c;
  }catch(e){/* file:// blocks pixel access; the unkeyed layer still works */}
}
function boot(){keyed('orange',.05,.2);keyed('liquid',.015,.1);ready=true;fit();displayed=target=scrollProgress();draw(displayed);updateUi(displayed);addEventListener('scroll',schedule,{passive:true});addEventListener('resize',()=>{fit();schedule()},{passive:true});document.addEventListener('visibilitychange',()=>{lastTime=0;schedule()});}
Promise.all(Object.keys(sources).map(load)).then(boot).catch(err=>{console.error('BELLO hero could not load:',err)});
})();
