// Mobile navigation: open/close with the toggle, a link, Escape or a tap outside.
(()=>{
  const toggle=document.getElementById('mobile-toggle');
  const nav=document.getElementById('nav');
  if(!toggle||!nav)return;
  function setNav(open){
    nav.classList.toggle('open',open);
    toggle.setAttribute('aria-expanded',open?'true':'false');
    toggle.setAttribute('aria-label',open?'Menü schließen':'Menü öffnen');
    toggle.textContent=open?'×':'☰';
  }
  const isOpen=()=>nav.classList.contains('open');
  toggle.addEventListener('click',()=>setNav(!isOpen()));
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setNav(false)));
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&isOpen()){setNav(false);toggle.focus()}
  });
  document.addEventListener('click',e=>{
    if(isOpen()&&!nav.contains(e.target)&&!toggle.contains(e.target))setNav(false);
  });
})();
