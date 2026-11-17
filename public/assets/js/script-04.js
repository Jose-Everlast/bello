
(()=>{
  const section=document.querySelector('#bello-walk');
  const route=document.querySelector('#bm-active-route');
  const glow=document.querySelector('#bm-glow-route');
  const walker=document.querySelector('#bm-moving-dot');
  const finish=document.querySelector('#bm-end-point');
  const title=document.querySelector('#bm-step-title');
  const subtitle=document.querySelector('#bm-step-sub');
  const index=document.querySelector('#bm-step-index');
  const fill=document.querySelector('#bm-progress-fill');
  if(!section||!route||!walker)return;
  const length=route.getTotalLength();
  route.style.strokeDasharray=String(length);
  glow.style.strokeDasharray=String(length);
  let last=-1,raf=0,lastStep=-1;
  const stages=[
    ['01','Start am Kornmarkt','Einmal Richtung Süden – der Aperitivo ruft.'],
    ['02','Über die Groner Straße','Nur noch wenige Meter durch die Altstadt.'],
    ['03','In die Kurze Straße','Jetzt dem warmen Licht folgen.'],
    ['04','Ciao, Bello!','Angekommen. Der erste Drink wartet.']
  ];
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  // Reduced motion: the route is shown finished and the section is one screen high (see CSS), so do not promise a scroll animation.
  if(reduced){const hint=section.querySelector('[data-text="walk.scrollhint"]');if(hint)hint.remove()}
  // Wording comes from data/content.json once assets/js/content.js has loaded it (keys walk.step1.title … walk.step4.text); stages[] is the fallback.
  const stepText=(st,part,i)=>{const t=window.BELLO_TEXTS,v=t&&t['walk.step'+(st+1)+'.'+part];return typeof v==='string'&&v.trim()?v:stages[st][i]};
  function setStepText(st){index.textContent=stages[st][0];title.textContent=stepText(st,'title',1);subtitle.textContent=stepText(st,'text',2)}
  document.addEventListener('bello:texts',()=>{if(lastStep>=0)setStepText(lastStep)});
  function render(){
    raf=0;
    const sticky=section.querySelector('.bm-sticky');
    const scrollRange=Math.max(1,section.offsetHeight-sticky.offsetHeight);
    const travel=clamp(-section.getBoundingClientRect().top/scrollRange,0,1);
    const p=reduced?1:travel;
    if(Math.abs(p-last)<.0002)return;
    last=p;
    route.style.strokeDashoffset=String(length*(1-p));
    glow.style.strokeDashoffset=String(length*(1-p));
    const point=route.getPointAtLength(Math.max(0,Math.min(length,length*p)));
    walker.setAttribute('transform',`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
    walker.style.opacity=(p>=.98)?'0':'1';
    fill.style.transform=`scaleX(${p})`;
    finish.style.opacity=p>.84?String(clamp((p-.84)/.14,.15,1)):'.15';
    const st=p<.28?0:p<.51?1:p<.86?2:3;
    if(st!==lastStep){
      lastStep=st;setStepText(st);
    }
  }
  function queue(){if(!raf)raf=requestAnimationFrame(render)}
  window.addEventListener('scroll',queue,{passive:true});
  window.addEventListener('resize',queue,{passive:true});
  document.addEventListener('visibilitychange',queue);
  render();
})();
