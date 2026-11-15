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
const steps=[...document.querySelectorAll('#hero-scroll [data-step]')];
const cue=document.getElementById('scroll-cue');
const info=[['01 / GLAS','Der Anfang.'],['02 / EIS','Klar. Kalt. Kristall.'],['03 / NEGRONI','Bitter. Stark. Italienisch.'],['04 / ORANGE','Der letzte Schliff.']];
const sources=window.__BELLO_CANONICAL_ASSETS__;
const assets={};
const sourceW=709,sourceH=411;
const load=k=>new Promise((resolve,reject)=>{let im=new Image();im.decoding='async';im.onload=()=>{assets[k]=im;resolve()};im.onerror=reject;im.src=sources[k]});
let ready=false, target=0, displayed=0, raf=0, lastTime=0, stage=-1, sizeW=0,sizeH=0,pxratio=1;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,t)=>{const x=clamp((t-a)/(b-a));return x*x*(3-2*x)};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function scrollProgress(){if(reduced.matches)return 1;const top=section.getBoundingClientRect().top;const span=Math.max(1,section.offsetHeight-sticky.clientHeight);return clamp(-top/span)}
function fit(){const r=canvas.getBoundingClientRect();const ratio=Math.min(devicePixelRatio||1,r.width<700?1.4:1.7);const w=Math.max(1,Math.round(r.width*ratio)),h=Math.max(1,Math.round(r.height*ratio));if(w!==sizeW||h!==sizeH){sizeW=w;sizeH=h;pxratio=ratio;canvas.width=w;canvas.height=h;return true}return false}
function updateUi(p){
  progressEl.style.transform=`scaleX(${p.toFixed(5)})`;
  percentEl.textContent=String(Math.round(p*100)).padStart(2,'0')+' / 100';
  const next=p<.16?0:p<.40?1:p<.82?2:3;
  if(next!==stage){stage=next;titleEl.textContent=info[stage][0];subtitleEl.textContent=info[stage][1];steps.forEach((el,i)=>el.classList.toggle('active',i===stage))}
  if(cue)cue.style.opacity=String(clamp((.12-p)/.12));
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
  img('base');
  const glass=smooth(.025,.16,p);
  img('glass',glass);
  // Ice fragments are isolated from the fixed photo. Neither the glass nor the cubes translate.
  const i1=smooth(.16,.255,p),i2=smooth(.235,.345,p),i3=smooth(.315,.405,p);
  img('cube1',i1);img('cube2',i2);img('cube3',i3);
  // Single fluid layer with one continuously rising waterline; no cross-fades between photos.
  const fill=smooth(.405,.83,p);
  if(fill>.0001){
    // Clipping is performed in immutable source-photo coordinates.
    // Bottom of inner glass y=347, top of fluid at y=204.
    const surface=347-140*fill;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(273,surface+2);ctx.bezierCurveTo(312,surface-1.6,389,surface-1.6,435,surface+2);ctx.lineTo(435,365);ctx.lineTo(273,365);ctx.closePath();
    ctx.clip();
    img('liquid');
    ctx.restore();
    // A restrained specular meniscus follows only the rising surface.
    if(fill>.03&&fill<.99){
      const radius=66+2*fill;
      const g=ctx.createLinearGradient(291,surface,419,surface);
      g.addColorStop(0,'rgba(255,129,49,0)');g.addColorStop(.2,'rgba(255,152,71,.28)');g.addColorStop(.55,'rgba(255,209,146,.42)');g.addColorStop(.85,'rgba(255,129,49,.27)');g.addColorStop(1,'rgba(255,129,49,0)');
      ctx.strokeStyle=g;ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(282,surface+1.7);ctx.bezierCurveTo(317,surface-1.7,389,surface-1.7,425,surface+1.7);ctx.stroke();
    }
  }
  img('orange',smooth(.835,.967,p));
  // At completion, use exactly the user's original photo, not a reconstructed approximation.
  // The canonical assets already occupy the exact same pixel coordinates.
  if(p>=.997)img('original');
}
function tick(ts){raf=0;const dt=lastTime?Math.min(50,ts-lastTime):16;lastTime=ts;
 const move=1-Math.exp(-dt/55);displayed+= (target-displayed)*move;
 if(Math.abs(target-displayed)<.00025)displayed=target;
 draw(displayed);updateUi(displayed);
 if(displayed!==target)raf=requestAnimationFrame(tick);
}
function schedule(){if(!ready)return;target=scrollProgress();if(!raf)raf=requestAnimationFrame(tick)}
function boot(){ready=true;fit();displayed=target=scrollProgress();draw(displayed);updateUi(displayed);addEventListener('scroll',schedule,{passive:true});addEventListener('resize',()=>{fit();schedule()},{passive:true});document.addEventListener('visibilitychange',()=>{lastTime=0;schedule()});}
Promise.all(Object.keys(sources).map(load)).then(boot).catch(err=>{console.error('BELLO hero could not load:',err)});
})();
