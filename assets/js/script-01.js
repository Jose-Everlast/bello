const modal=document.getElementById('modal');
const form=document.getElementById('booking-form');
const success=document.getElementById('success');
function closeModal(){
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
  form.style.display='block';
  success.style.display='none';
}
function openModal(){
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  document.getElementById('date').focus();
}
document.querySelectorAll('[data-book]').forEach(el=>el.addEventListener('click',openModal));
document.getElementById('modal-close').addEventListener('click',closeModal);
document.getElementById('success-close').addEventListener('click',closeModal);
modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
document.getElementById('date').min=new Date().toLocaleDateString('en-CA');
form.addEventListener('submit',e=>{e.preventDefault();form.style.display='none';success.style.display='block'});

const toggle=document.getElementById('mobile-toggle');
const nav=document.getElementById('nav');
toggle.addEventListener('click',()=>{
  const open=nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded',open?'true':'false');
  toggle.textContent=open?'×':'☰';
});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
  nav.classList.remove('open');
  toggle.setAttribute('aria-expanded','false');
  toggle.textContent='☰';
}));

const reveals=[...document.querySelectorAll('.reveal')];
if('IntersectionObserver' in window){
  const io=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('visible');io.unobserve(entry.target)}
    })
  },{threshold:.16});
  reveals.forEach(el=>{if(!el.classList.contains('visible'))io.observe(el)});
}else{reveals.forEach(el=>el.classList.add('visible'))}


// Scroll controls a photographic image-sequence. Individual frames are prebaked,
// so the browser only paints 2 sprites instead of continuously clipping DOM photos.
const scene=document.getElementById('photo-hero');
