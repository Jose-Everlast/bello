// Editable content: menu, specials and a few texts come from data/content.json.
// With ?vorschau=<token> the unpublished draft is loaded from /api/vorschau instead.
// The static markup in index.html is the fallback: if loading fails, nothing is touched.
// All values are plain text and are written with textContent only.
(()=>{
  const PUBLISHED_URL='data/content.json';
  const PREVIEW_URL='/api/vorschau';
  const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const DAY=/^\d{4}-\d{2}-\d{2}$/;
  const UPLOAD=/^assets\/uploads\/[A-Za-z0-9._-]+$/;
  const WEEKDAYS=['So','Mo','Di','Mi','Do','Fr','Sa'];

  const token=new URLSearchParams(location.search).get('vorschau');
  const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const isText=v=>typeof v==='string';
  const optText=v=>v===undefined||isText(v);

  function el(tag,text,attrs){
    const node=document.createElement(tag);
    if(text!==undefined&&text!==null)node.textContent=text;
    if(attrs)for(const k in attrs)node.setAttribute(k,attrs[k]);
    return node;
  }

  // Throws when the content does not have the agreed shape.
  function check(content){
    if(!isObject(content))throw new Error('content is not an object');
    if(content.version!==1)throw new Error('unknown content version');
    if(!Array.isArray(content.menu)||!content.menu.length)throw new Error('menu missing');
    const seen={tab:new Set(),section:new Set(),item:new Set()};
    const id=(kind,v)=>{
      if(!isText(v)||!ID.test(v))throw new Error('bad '+kind+' id');
      if(seen[kind].has(v))throw new Error('duplicate '+kind+' id '+v);
      seen[kind].add(v);
    };
    for(const tab of content.menu){
      if(!isObject(tab)||!isText(tab.label)||!tab.label.trim()||!Array.isArray(tab.sections))throw new Error('bad tab');
      id('tab',tab.id);
      for(const sec of tab.sections){
        if(!isObject(sec)||!isText(sec.title)||!optText(sec.subtitle)||!Array.isArray(sec.items))throw new Error('bad section');
        id('section',sec.id);
        for(const item of sec.items){
          if(!isObject(item)||!isText(item.name)||!item.name.trim()||!optText(item.price)||!optText(item.text)||!optText(item.note))throw new Error('bad item');
          id('item',item.id);
        }
      }
    }
    if(content.texts!==undefined&&!isObject(content.texts))throw new Error('bad texts');
    if(content.specials!==undefined&&!Array.isArray(content.specials))throw new Error('bad specials');
    return content;
  }

  async function getJson(url){
    const res=await fetch(url,{cache:'no-cache'});
    if(!res.ok){
      const err=new Error('HTTP '+res.status+' for '+url.split('?')[0]);
      err.status=res.status;
      throw err;
    }
    return res.json();
  }

  async function load(){
    if(token){
      try{
        const data=await getJson(PREVIEW_URL+'?token='+encodeURIComponent(token));
        return {content:check(data&&data.content),images:isObject(data.images)?data.images:{},preview:true};
      }catch(err){
        console.warn('Bello: Vorschau nicht verfügbar, zeige veröffentlichten Stand.',err);
        // 404 = the draft is gone (published, discarded or expired); anything else is a technical problem.
        showBanner(err&&err.status===404
          ?'Diese Vorschau gibt es nicht mehr (veröffentlicht, verworfen oder abgelaufen) · du siehst die Live-Seite · neue Änderungen brauchen etwa eine Minute'
          :'Vorschau nicht verfügbar · du siehst die veröffentlichte Seite',true);
      }
    }
    return {content:check(await getJson(PUBLISHED_URL)),images:{},preview:false};
  }

  /* ---------- Texts ---------- */
  function applyTexts(texts){
    if(!texts)return;
    for(const node of document.querySelectorAll('[data-text]')){
      const value=texts[node.getAttribute('data-text')];
      if(isText(value)&&value.trim()&&node.textContent!==value)node.textContent=value;
    }
    // Several texts in one line: data-text-list="key1 key2", joined with " · ", plus data-text-end.
    for(const node of document.querySelectorAll('[data-text-list]')){
      const parts=node.getAttribute('data-text-list').split(/\s+/).filter(Boolean).map(key=>texts[key]);
      if(!parts.length||!parts.every(v=>isText(v)&&v.trim()))continue;
      const value=parts.join(' · ')+(node.getAttribute('data-text-end')||'');
      if(node.textContent!==value)node.textContent=value;
    }
  }

  /* ---------- Menu ---------- */
  function buildPanel(tab,active){
    const panel=el('div',null,{class:'brm-panel',role:'tabpanel',id:'brm-panel-'+tab.id,'aria-labelledby':'brm-tab-'+tab.id});
    panel.hidden=!active;
    for(const sec of tab.sections){
      const page=el('article',null,{class:'brm-page'});
      const folio=el('div',null,{class:'brm-folio'});
      folio.append(el('span','LA CARTA'),el('span',tab.label));
      const title=el('div',null,{class:'brm-page-title'});
      title.append(el('h3',sec.title));
      if(sec.subtitle)title.append(el('p',sec.subtitle));
      const ul=el('ul');
      for(const item of sec.items){
        const li=el('li');
        const b=el('b',item.name);
        if(item.price)b.append(el('em',item.price));
        li.append(b);
        if(item.text)li.append(el('span',item.text));
        if(item.note)li.append(el('i',item.note));
        ul.append(li);
      }
      const foot=el('div',null,{class:'brm-foot'});
      foot.append(el('span','Preise in Euro inkl. MwSt.'),el('span','bello.'));
      page.append(folio,title,ul,foot);
      panel.append(page);
    }
    return panel;
  }

  function renderMenu(menu){
    const root=document.getElementById('menu');
    const list=root&&root.querySelector('.brm-tabs');
    if(!list)return;
    // Hidden items are dropped; a section or tab with nothing left to show is dropped too.
    const tabs=menu.map(tab=>({id:tab.id,label:tab.label,sections:tab.sections
      .map(sec=>({title:sec.title,subtitle:sec.subtitle,items:sec.items.filter(item=>item.hidden!==true)}))
      .filter(sec=>sec.items.length)})).filter(tab=>tab.sections.length);
    if(!tabs.length)throw new Error('menu has nothing to show');

    // Keep the tab the visitor is on; otherwise Cocktails, otherwise the first one.
    const current=list.querySelector('[role="tab"][aria-selected="true"]');
    const currentId=current?current.id.replace(/^brm-tab-/,''):'';
    const hadFocus=list.contains(document.activeElement);
    const has=id=>tabs.some(tab=>tab.id===id);
    const activeId=has(currentId)?currentId:has('cocktails')?'cocktails':tabs[0].id;

    const buttons=[],panels=[];
    for(const tab of tabs){
      const on=tab.id===activeId;
      const button=el('button',tab.label,{type:'button',role:'tab',id:'brm-tab-'+tab.id,'aria-controls':'brm-panel-'+tab.id,'aria-selected':on?'true':'false'});
      if(!on)button.tabIndex=-1;
      buttons.push(button);
      panels.push(buildPanel(tab,on));
    }
    // Nothing to do when the page already shows exactly this menu (the usual case on first load).
    const sig=nodes=>nodes.map(n=>n.id+'|'+(n.getAttribute('role')==='tab'?n.textContent:n.innerHTML.replace(/>\s+</g,'><'))).join('\n');
    const oldPanels=[...root.querySelectorAll('.brm-panel')];
    if(sig([...list.children])===sig(buttons)&&sig(oldPanels)===sig(panels))return;
    for(const old of oldPanels)old.remove();
    list.replaceChildren(...buttons);
    list.after(...panels);
    if(hadFocus){
      const active=document.getElementById('brm-tab-'+activeId);
      if(active)active.focus({preventScroll:true});
    }
  }

  /* ---------- Specials ---------- */
  function todayInBerlin(){
    const parts={};
    for(const p of new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()))parts[p.type]=p.value;
    return parts.year+'-'+parts.month+'-'+parts.day;
  }
  // "2026-11-23" -> "Mo, 23.11." (calendar date, independent of the visitor's time zone)
  function shortDate(day){
    const [y,m,d]=day.split('-').map(Number);
    return WEEKDAYS[new Date(Date.UTC(y,m-1,d)).getUTCDay()]+', '+String(d).padStart(2,'0')+'.'+String(m).padStart(2,'0')+'.';
  }
  function imageSrc(path,images,preview){
    if(!isText(path)||!UPLOAD.test(path))return '';
    if(preview){
      const draft=images[path];
      if(isText(draft)&&draft.startsWith(PREVIEW_URL+'?'))return draft;
    }
    return path;
  }

  function renderSpecials(specials,images,preview){
    const band=document.getElementById('specials');
    const row=document.getElementById('bsp-row');
    if(!band||!row)return;
    const today=todayInBerlin();
    const cards=[];
    for(const sp of Array.isArray(specials)?specials:[]){
      if(!isObject(sp)||!isText(sp.title)||!sp.title.trim())continue;
      const from=isText(sp.from)&&DAY.test(sp.from)?sp.from:'';
      const until=isText(sp.until)&&DAY.test(sp.until)?sp.until:'';
      if(until&&today>until)continue;
      const upcoming=!!from&&today<from;
      if(upcoming&&!preview)continue;

      const card=el('article',null,{class:'bsp-card'});
      const src=imageSrc(sp.image,images,preview);
      if(src){
        const media=el('div',null,{class:'bsp-media'});
        media.append(el('img',null,{src,alt:isText(sp.imageAlt)?sp.imageAlt:'',loading:'lazy',decoding:'async',width:'800',height:'600'}));
        card.append(media);
        card.classList.add('has-image');
      }
      const body=el('div',null,{class:'bsp-body'});
      const labels=el('div',null,{class:'bsp-labels'});
      labels.append(el('span',until?'Special · bis '+shortDate(until):'Special',{class:'bsp-label'}));
      if(upcoming)labels.append(el('span','ab '+shortDate(from)+' · noch nicht sichtbar',{class:'bsp-label bsp-label-soon'}));
      body.append(labels,el('h3',sp.title));
      if(isText(sp.text)&&sp.text.trim())body.append(el('p',sp.text));
      card.append(body);
      cards.push(card);
    }
    row.replaceChildren(...cards);
    row.classList.toggle('is-single',cards.length===1);
    if(cards.length>1){
      // Several cards scroll sideways; make the row reachable by keyboard.
      row.tabIndex=0;row.setAttribute('role','region');row.setAttribute('aria-label','Aktuelle Specials');
    }else{
      row.removeAttribute('tabindex');row.removeAttribute('role');row.removeAttribute('aria-label');
    }
    band.hidden=cards.length===0;
  }

  /* ---------- Preview banner ---------- */
  function showBanner(text,failed){
    let banner=document.getElementById('bello-preview-banner');
    if(!banner){
      banner=el('div',null,{id:'bello-preview-banner',class:'bello-preview-banner',role:'status'});
      document.body.append(banner);
      document.body.classList.add('is-preview');
    }
    banner.textContent=text;
    banner.classList.toggle('is-failed',!!failed);
  }

  load().then(({content,images,preview})=>{
    if(preview)showBanner('Vorschau · noch nicht veröffentlicht',false);
    // Each part on its own: a menu that cannot be shown must not keep texts and specials from updating.
    const parts=[
      ['Karte',()=>renderMenu(content.menu)],
      ['Texte',()=>applyTexts(content.texts)],
      ['Specials',()=>renderSpecials(content.specials,images,preview)],
    ];
    for(const [name,run] of parts){
      try{run();}catch(err){console.warn('Bello: '+name+' konnte nicht übernommen werden, dieser Teil zeigt den festen Stand.',err);}
    }
  }).catch(err=>{
    console.warn('Bello: Inhalte konnten nicht geladen werden, die Seite zeigt den festen Stand.',err);
  });
})();
