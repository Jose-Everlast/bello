
(function(){
  const action=document.querySelector('.nav-reserve');
  const nav=document.querySelector('#nav');
  const burger=document.querySelector('#mobile-toggle');
  if(action && nav && burger){action.addEventListener('click',()=>{nav.classList.remove('open');burger.setAttribute('aria-expanded','false');burger.textContent='☰'})}
})();
