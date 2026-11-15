
(function(){
  const band=document.querySelector('.bello-intermezzo');
  if(!band||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  let waiting=false;
  function update(){
    waiting=false;
    const r=band.getBoundingClientRect();
    if(r.bottom<0||r.top>innerHeight)return;
    const progress=Math.min(1,Math.max(0,(innerHeight-r.top)/(innerHeight+r.height)));
    band.style.setProperty('--bi-offset', (-10-23*progress).toFixed(2)+'%');
  }
  function queue(){if(!waiting){waiting=true;requestAnimationFrame(update)}}
  addEventListener('scroll',queue,{passive:true});addEventListener('resize',queue,{passive:true});update();
})();
