// Menu tabs: Snacks, Cocktails, Getränke.
// Works on whatever tabs are inside .brm-tabs at the time of the event,
// because assets/js/content.js re-renders them from data/content.json.
(()=>{
  const list=document.querySelector('.brm-tabs');
  if(!list)return;
  const allTabs=()=>[...list.querySelectorAll('[role="tab"]')];

  // On phones the bar is position:sticky under the header. It is "stuck" when it sits at its sticky offset.
  function stuckOffset(){
    const cs=getComputedStyle(list);
    if(cs.position!=='sticky')return null;
    const top=parseFloat(cs.top);
    if(!isFinite(top))return null;
    return list.getBoundingClientRect().top<=top+1?top:null;
  }

  function select(tab,focus){
    const offset=stuckOffset();
    let shown=null;
    for(const t of allTabs()){
      const on=t===tab;
      t.setAttribute('aria-selected',on?'true':'false');
      t.tabIndex=on?0:-1;
      const panel=document.getElementById(t.getAttribute('aria-controls'));
      if(panel){panel.hidden=!on;if(on)shown=panel;}
    }
    if(focus)tab.focus({preventScroll:true});
    // While the bar is stuck, bring the top of the new panel directly below header and tab bar.
    if(offset!==null&&shown){
      const y=window.scrollY+shown.getBoundingClientRect().top-offset-list.offsetHeight;
      window.scrollTo({top:Math.max(0,Math.round(y)),behavior:'instant'});
    }
  }
  list.addEventListener('click',e=>{
    const t=e.target.closest('[role="tab"]');
    if(t&&list.contains(t)&&t.getAttribute('aria-selected')!=='true')select(t,false);
  });
  list.addEventListener('keydown',e=>{
    const tabs=allTabs();
    const i=tabs.indexOf(document.activeElement);if(i<0)return;
    const next=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;
    if(next===null)return;
    e.preventDefault();select(tabs[(next+tabs.length)%tabs.length],true);
  });
})();
