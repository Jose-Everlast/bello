
(()=>{for(const prefix of ["brj","brm"]){
const track=document.getElementById(prefix+"-track"),prev=document.getElementById(prefix+"-prev"),next=document.getElementById(prefix+"-next"),counter=document.getElementById(prefix+"-count");if(!track||!prev||!next||!counter)continue;
const panels=[...track.children];let current=0;function update(){const b=track.getBoundingClientRect();let distances=panels.map(el=>Math.abs(el.getBoundingClientRect().left-b.left));current=distances.indexOf(Math.min(...distances));counter.textContent=String(current+1).padStart(2,"0")+" / "+String(panels.length).padStart(2,"0");prev.disabled=current===0;next.disabled=current===panels.length-1;}
function go(i){const p=panels[Math.max(0,Math.min(i,panels.length-1))];if(!p)return;const rect=track.getBoundingClientRect();track.scrollTo({left:track.scrollLeft+p.getBoundingClientRect().left-rect.left,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});}
prev.addEventListener("click",()=>go(current-1));next.addEventListener("click",()=>go(current+1));track.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();go(current+(e.key==="ArrowRight"?1:-1));}});
let raf=0;track.addEventListener("scroll",()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(update);},{passive:true});window.addEventListener("resize",update,{passive:true});update();
}}
const journal=document.querySelector(".bello-real-journal");if("IntersectionObserver" in window&&journal){const obs=new IntersectionObserver(entries=>{for(const e of entries){for(const v of e.target.querySelectorAll("video")){if(e.isIntersecting){const p=v.play();if(p?.catch)p.catch(()=>{});}else v.pause();}}},{threshold:.12});obs.observe(journal);}
})();
