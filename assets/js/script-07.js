
(()=>{
  const track=document.getElementById('real-ig-track');
  if(!track)return;
  const cards=[...track.querySelectorAll('.real-ig-card')];
  const count=document.getElementById('real-ig-count');
  const prev=document.getElementById('real-ig-prev');
  const next=document.getElementById('real-ig-next');
  let index=0;
  const sync=()=>{
    const left=track.getBoundingClientRect().left;
    const distances=cards.map(c=>Math.abs(c.getBoundingClientRect().left-left));
    index=distances.indexOf(Math.min(...distances));
    count.textContent=String(index+1).padStart(2,'0')+' / '+String(cards.length).padStart(2,'0');
    prev.disabled=index===0;next.disabled=index===cards.length-1;
  };
  const go=(i)=>{
    const card=cards[Math.max(0,Math.min(cards.length-1,i))];
    if(!card)return;
    const target=card.getBoundingClientRect().left-track.getBoundingClientRect().left+track.scrollLeft;
    track.scrollTo({left:target,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  };
  prev.addEventListener('click',()=>go(index-1));
  next.addEventListener('click',()=>go(index+1));
  track.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();go(index+1)}if(e.key==='ArrowLeft'){e.preventDefault();go(index-1)}});
  let req=0;
  track.addEventListener('scroll',()=>{if(req)cancelAnimationFrame(req);req=requestAnimationFrame(sync)},{passive:true});
  window.addEventListener('resize',sync,{passive:true});
  sync();
})();
