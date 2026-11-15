
(()=>{
 function makeSwipeIndicators(selector){
  document.querySelectorAll(selector).forEach(view=>{
   const bar=view.nextElementSibling?.querySelector('.swipe-bars');
   if(!bar)return;
   const dots=[...bar.children];
   const cards=[...view.children];
   let raf=0;
   function update(){
    raf=0;let best=0,dist=Infinity;
    const mid=view.getBoundingClientRect().left+view.clientWidth/2;
    cards.forEach((card,i)=>{const rect=card.getBoundingClientRect();const d=Math.abs(rect.left+rect.width/2-mid);if(d<dist){dist=d;best=i}});
    dots.forEach((dot,i)=>dot.classList.toggle('is-current',i===best));
   }
   view.addEventListener('scroll',()=>{if(!raf)raf=requestAnimationFrame(update)},{passive:true});
   addEventListener('resize',update,{passive:true});
   update();
  });
 }
 makeSwipeIndicators('.sg-viewport,.sm-viewport');
})();
