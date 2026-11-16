// Video carousel (#brj-track): arrows and counter follow what can really be scrolled.
(()=>{
const track=document.getElementById("brj-track"),prev=document.getElementById("brj-prev"),next=document.getElementById("brj-next"),counter=document.getElementById("brj-count");
const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
if(track&&prev&&next&&counter){
  const panels=[...track.children];
  const bar=counter.closest(".brj-bottom");
  const two=n=>String(n).padStart(2,"0");
  let stops=[],max=0;
  // Scroll position at which each card sits at the start of the track, limited to the real scroll range.
  function measure(){
    const box=track.getBoundingClientRect();
    const pad=parseFloat(getComputedStyle(track).scrollPaddingLeft)||0;
    const view=track.clientWidth;
    max=Math.max(0,track.scrollWidth-view);
    let allVisible=true;
    stops=panels.map(el=>{
      const r=el.getBoundingClientRect();
      const left=r.left-box.left+track.scrollLeft;
      const seen=Math.min(left+r.width,view)-Math.max(left,0);
      if(seen<r.width*.9)allVisible=false;
      return Math.min(max,Math.max(0,left-pad));
    });
    return max<=2||allVisible;
  }
  function update(){
    const isStatic=measure();
    if(bar)bar.classList.toggle("is-static",isStatic);
    const x=track.scrollLeft;
    const atStart=x<=2,atEnd=x>=max-2;
    let current=0;
    if(atEnd&&!isStatic)current=panels.length-1;
    else if(!atStart){let best=Infinity;stops.forEach((s,i)=>{const d=Math.abs(s-x);if(d<best){best=d;current=i}});}
    counter.textContent=two(current+1)+" / "+two(panels.length);
    prev.disabled=isStatic||atStart;
    next.disabled=isStatic||atEnd;
  }
  // One step = the next card start in that direction that actually changes the scroll position.
  function step(dir){
    measure();
    const x=track.scrollLeft;
    let target=null;
    if(dir>0){for(const s of stops){if(s>x+2){target=s;break}}}
    else{for(const s of stops){if(s<x-2)target=s}}
    if(target===null)return;
    track.scrollTo({left:target,behavior:reduced.matches?"auto":"smooth"});
  }
  prev.addEventListener("click",()=>step(-1));
  next.addEventListener("click",()=>step(1));
  track.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();step(e.key==="ArrowRight"?1:-1)}});
  let raf=0;
  track.addEventListener("scroll",()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(update)},{passive:true});
  window.addEventListener("resize",update,{passive:true});
  window.addEventListener("load",update);
  update();
}
// Videos play only while the section is on screen. With reduced motion, or when the
// browser refuses autoplay, the visitor gets the native controls instead.
const journal=document.querySelector(".bello-real-journal");
if(journal){
  const videos=[...journal.querySelectorAll("video")];
  const manual=v=>{v.removeAttribute("autoplay");v.controls=true};
  if(reduced.matches){videos.forEach(v=>{manual(v);v.pause()})}
  else if("IntersectionObserver" in window){
    const obs=new IntersectionObserver(entries=>{for(const e of entries){for(const v of videos){
      if(v.controls)continue;
      if(e.isIntersecting){const p=v.play();if(p&&p.catch)p.catch(err=>{if(err&&err.name==="NotAllowedError")manual(v)})}
      else v.pause();
    }}},{threshold:.12});
    obs.observe(journal);
  }
}
})();
