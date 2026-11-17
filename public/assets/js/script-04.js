
(()=>{
  const section=document.querySelector('#bello-walk');
  if(!section)return;
  const svg=section.querySelector('.bm-plan');
  const route=section.querySelector('#bm-active-route');
  const glow=section.querySelector('#bm-glow-route');
  const walker=section.querySelector('#bm-moving-dot');
  const finish=section.querySelector('#bm-end-point');
  const north=section.querySelector('.bm-north');
  const items=[...section.querySelectorAll('.bm-rs')];
  const dots=[...section.querySelectorAll('.bm-dots i')];
  const badges=[...section.querySelectorAll('.bm-badge')];
  const labels=[...section.querySelectorAll('.bm-lbl')];
  if(!svg||!route||!walker||!items.length)return;
  const length=route.getTotalLength();
  route.style.strokeDasharray=String(length);
  if(glow)glow.style.strokeDasharray=String(length);
  let last=-1,raf=0,lastStep=-1;
  const stages=[
    ['01','Start am Kornmarkt','Einmal Richtung Süden – der Aperitivo ruft.'],
    ['02','Über die Groner Straße','Nur noch wenige Meter durch die Altstadt.'],
    ['03','In die Kurze Straße','Jetzt dem warmen Licht folgen.'],
    ['04','Ciao, Bello!','Angekommen. Der erste Drink wartet.']
  ];
  // Where each step starts along the route (0…1): the real turning points, written into the SVG by the map generator.
  const marks=(route.getAttribute('data-steps')||'0 .375 .647 1').split(/\s+/).map(Number);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  // Reduced motion: the route is shown finished and the section is one screen high (see CSS), so do not promise a scroll animation.
  if(reduced){const hint=section.querySelector('[data-text="walk.scrollhint"]');if(hint)hint.remove();section.classList.add('bm-reduced')}
  // Wording comes from data/content.json once assets/js/content.js has loaded it (keys walk.step1.title … walk.step4.text); stages[] is the fallback.
  const stepText=(st,part,i)=>{const t=window.BELLO_TEXTS,v=t&&t['walk.step'+(st+1)+'.'+part];return typeof v==='string'&&v.trim()?v:stages[st][i]};
  function fillTexts(){
    items.forEach((li,st)=>{
      const title=li.querySelector('.bm-rs-title'),text=li.querySelector('.bm-rs-text');
      const a=stepText(st,'title',1),b=stepText(st,'text',2);
      if(title&&title.textContent!==a)title.textContent=a;
      if(text&&text.textContent!==b)text.textContent=b;
    });
  }
  function setStep(st){
    lastStep=st;
    items.forEach((li,i)=>{
      if(i===st)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');
      li.classList.toggle('is-past',i<st);
    });
    dots.forEach((d,i)=>d.classList.toggle('is-on',i===st));
    badges.forEach((b,i)=>{b.classList.toggle('is-current',i===st);b.classList.toggle('is-past',i<st)});
  }
  const stepAt=p=>{let st=0;for(let i=1;i<marks.length;i++)if(p>=marks[i]-(i===marks.length-1?.03:.02))st=i;return st};
  const scrollRange=()=>{const sticky=section.querySelector('.bm-sticky');return Math.max(1,section.offsetHeight-sticky.offsetHeight)};

  // Fit the map to its box: show the core around the route at least, and more of the town where the box is wider or taller.
  const nums=s=>(s||'').split(/\s+/).map(Number);
  const extent=nums(svg.getAttribute('data-extent'));
  const cores=[nums(svg.getAttribute('data-core')),nums(svg.getAttribute('data-core-s'))];
  let lastBox='';
  function fit(){
    const w=svg.clientWidth,h=svg.clientHeight;
    if(!w||!h)return;
    const key=w+'x'+h;
    if(key===lastBox)return;
    lastBox=key;
    const a=w/h;
    const span=c=>a>c[2]/c[3]?[c[3]*a,c[3]]:[c[2],c[2]/a];
    let core=cores[0],[vw,vh]=span(core);
    if(w/vw<.62&&cores[1].length===4){core=cores[1];[vw,vh]=span(core)}
    let x=core[0]+core[2]/2-vw/2,y=core[1]+core[3]/2-vh/2;
    if(vw<=extent[2])x=clamp(x,extent[0],extent[0]+extent[2]-vw);
    if(vh<=extent[3])y=clamp(y,extent[1],extent[1]+extent[3]-vh);
    svg.setAttribute('viewBox',[x,y,vw,vh].map(n=>n.toFixed(1)).join(' '));
    if(north)north.setAttribute('transform',`translate(${(x+vw-34).toFixed(1)} ${(y+48).toFixed(1)})`);
    // On a small map, street names and step markers are drawn larger so they stay readable.
    const f=clamp(.8/(w/vw),1,1.35);
    for(const g of badges){
      const c=g.querySelector('circle'),t=g.querySelector('text'),l=g.querySelector('path');
      if(c)c.setAttribute('r',(12*f).toFixed(1));
      if(t){t.setAttribute('font-size',(12*f).toFixed(1));t.setAttribute('y',(4.3*f).toFixed(1))}
      if(l){if(!l.dataset.d)l.dataset.d=l.getAttribute('d');const end=nums(l.dataset.d.replace(/[MH]/g,' ').trim())[2];l.setAttribute('d',`M${(13*f).toFixed(1)} 0H${Math.max(13*f,end).toFixed(1)}`)}
    }
    // A street name that would be cut at the edge is left out.
    for(const t of labels){
      if(!t.dataset.fs)t.dataset.fs=t.getAttribute('font-size');
      t.setAttribute('font-size',(t.dataset.fs*f).toFixed(1));
      const b=nums(t.getAttribute('data-box')),cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2;
      const b2=[cx-(cx-b[0])*f,cy-(cy-b[1])*f,cx+(b[2]-cx)*f,cy+(b[3]-cy)*f];
      t.style.display=(b2[0]>=x+4&&b2[1]>=y+4&&b2[2]<=x+vw-4&&b2[3]<=y+vh-4)?'':'none';
    }
  }

  function render(){
    raf=0;
    fit();
    const travel=clamp(-section.getBoundingClientRect().top/scrollRange(),0,1);
    const p=reduced?1:travel;
    if(Math.abs(p-last)<.0002)return;
    last=p;
    route.style.strokeDashoffset=String(length*(1-p));
    if(glow)glow.style.strokeDashoffset=String(length*(1-p));
    const point=route.getPointAtLength(clamp(length*p,0,length));
    walker.setAttribute('transform',`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
    walker.style.opacity=(p>=.98)?'0':'1';
    if(finish)finish.style.opacity=p>.84?String(clamp((p-.84)/.14,.15,1)):'.15';
    if(!reduced){const st=stepAt(p);if(st!==lastStep)setStep(st)}
  }
  function queue(){if(!raf)raf=requestAnimationFrame(render)}

  // A click on a step scrolls until the route has reached that step.
  items.forEach((li,i)=>{
    const button=li.querySelector('button');
    if(!button)return;
    button.addEventListener('click',()=>{
      if(reduced){setStep(i);return}
      const f=i===0?0:i===items.length-1?1:Math.min(1,marks[i]+.01);
      const top=window.scrollY+section.getBoundingClientRect().top+f*scrollRange();
      window.scrollTo({top:Math.round(top),behavior:'smooth'});
    });
  });

  // When the steps do not fit (large text sizes from content, short screens), drop the other steps' sentences first,
  // then show only the current step with dots for the others.
  const routeBox=section.querySelector('.bm-route'),list=section.querySelector('.bm-route-steps'),frame=section.querySelector('.bm-map-frame');
  function tighten(){
    if(reduced||!routeBox)return;
    const tooBig=()=>routeBox.scrollHeight>routeBox.clientHeight+1||(frame&&frame.clientHeight<150);
    section.classList.remove('bm-tight','bm-tighter');
    if(!tooBig())return;
    section.classList.add('bm-tight');
    if(tooBig())section.classList.add('bm-tighter');
  }
  if(window.ResizeObserver&&list){const ro=new ResizeObserver(()=>requestAnimationFrame(()=>{tighten();lastBox='';queue()}));ro.observe(list);ro.observe(section.querySelector('.bm-sticky'))}

  fillTexts();
  document.addEventListener('bello:texts',fillTexts);
  window.addEventListener('scroll',queue,{passive:true});
  window.addEventListener('resize',()=>{lastBox='';last=-1;queue()},{passive:true});
  document.addEventListener('visibilitychange',queue);
  if(reduced)setStep(items.length-1);
  render();
})();
