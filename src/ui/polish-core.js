/* TJM independent-site enhancement. Additive, local, no data/storage/network changes. */
(function () {
  'use strict';
  if (window.TJMSitePolish) return;
  var site = document.documentElement.dataset.tjmUi;
  var configs = {
    brand: { actions:'.button,.navlinks a,.case-visual,#closeLightbox', surfaces:'.project-card,.hero-card,.process-card', reveal:'.hero-grid>div,.section-head,.project-card,.process-card,.case-head,.footer-panel', dialogs:'#lightbox', dialogClose:'#closeLightbox' },
    book: { actions:'.controls button,.crossnav a,.back', surfaces:'', reveal:'', dialogs:'' },
    agent: { actions:'.rail-item,.send,.suggestions button,.prompt-examples button,.artifact-step,.review-card button,.dialog-head button,.thumb,.artifact-card', surfaces:'.review-card,.artifact-card,.thumb', reveal:'.workspace-head,.empty-chat,.chat-empty', dialogs:'' },
    film: { actions:'.category-dock button,.control-icon,.stage-play,.tool-link,.item', surfaces:'.item', reveal:'', dialogs:'' },
    annual: { actions:'.button-link,.primary,.archive-carousel-arrow,.navlinks button,.nav-action-link', surfaces:'.gateway-card', reveal:'', dialogs:'' },
    video: { actions:'#shuffle-btn,.nav-item,.close-btn,#music-toggle-btn,.like-btn', surfaces:'.item-content', reveal:'.archive-bar,.control-panel', dialogs:'#modal', dialogClose:'.close-btn' },
    celestial: { actions:'.top-tools button,.view-nav button,.mode-nav button,.scale-nav a,.drawer button,.control-deck button,.timeline button,#enterBtn,#skipBtn', surfaces:'.reference-list a', reveal:'', dialogs:'' },
    framee: { actions:'.btn,.primary-button,.demo-button,.ghost-link,.chip,.rail-add,.rail-actions button,.play-exit,.modal-actions button', surfaces:'.panel,.device-panel,.picker-item', reveal:'.landing-copy,.landing-preview', dialogs:'.modal-mask', dialogClose:'.modal-actions .btn:not(.btn-primary)' },
    autobook: { actions:'.toolbar button,.landing button,.composer-actions button,.chips button,.modal button,.panel-toggle,.book-head button', surfaces:'.style-card,.asset', reveal:'.landing>.drop,.composer>header', dialogs:'.modal', dialogClose:'.card>h3 button:not(:disabled)' }
  };
  var config = configs[site];
  if (!config) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var seen = new WeakSet(), modalSeen = new WeakSet(), press = new WeakMap(), running = new Set();
  var lastTrigger = null, scheduled = 0, revealObserver, modalUpdates=new Map(), dialogNumber=0;
  function all(selector,root) { return selector ? Array.prototype.slice.call((root||document).querySelectorAll(selector)) : []; }
  function play(node,frames,options) {
    if (reduced.matches || !node.animate || !node.isConnected) return;
    var animation=node.animate(frames,options);running.add(animation);
    animation.onfinish=animation.oncancel=function(){running.delete(animation);};
    return animation;
  }
  function enhance() {
    scheduled=0;
    all(config.actions).forEach(function(el){
      // Existing preference components and interaction canvases keep their own handlers.
      if (!el.closest('.settings-dock,.preference-dock,.capsule,.hotspot-layer,.play-layer,.stf__parent')) el.classList.add('tjm-ui-action');
    });
    all(config.surfaces).forEach(function(el){el.classList.add('tjm-ui-surface');});
    all(config.reveal).forEach(function(el,index){
      if(seen.has(el))return;seen.add(el);
      el.dataset.tjmUiDelay=String(Math.min(index%3,2)*55);
      if(revealObserver)revealObserver.observe(el);
    });
    all(config.dialogs).forEach(setupDialog);
  }
  function focusables(root) {
    return all('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',root)
      .filter(function(el){return !el.closest('[hidden],[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';});
  }
  function setupDialog(el) {
    if(modalSeen.has(el)||el.tagName==='DIALOG')return;modalSeen.add(el);
    var open=false,returnTo=null;
    el.classList.add('tjm-ui-dialog');el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
    if(!el.hasAttribute('aria-label')&&!el.hasAttribute('aria-labelledby')){
      var heading=el.querySelector('h2,h3,.modal-title');
      if(heading){if(!heading.id)heading.id='tjm-dialog-title-'+site+'-'+(++dialogNumber);el.setAttribute('aria-labelledby',heading.id);}
      else el.setAttribute('aria-label',site==='brand'?'作品图片预览':'预览');
    }
    function update(){
      var visible=el.isConnected&&!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
      if(visible===open)return;open=visible;
      if(open){
        returnTo=lastTrigger&&lastTrigger.isConnected?lastTrigger:document.activeElement;
        el.classList.add('tjm-ui-dialog-open');
        if(!el.contains(document.activeElement)){
          var first=focusables(el)[0];if(first)first.focus({preventScroll:true});
        }
      } else {
        el.classList.remove('tjm-ui-dialog-open');
        if(returnTo&&returnTo.isConnected&&returnTo.focus)returnTo.focus({preventScroll:true});
      }
    }
    var modalObserver=new MutationObserver(update);
    modalObserver.observe(el,{attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});
    modalUpdates.set(el,function(){update();if(!el.isConnected){modalObserver.disconnect();modalUpdates.delete(el);}});
    el.addEventListener('keydown',function(event){
      if(!open)return;
      if(event.key==='Tab'){
        var list=focusables(el);if(!list.length){event.preventDefault();return;}
        var first=list[0],last=list[list.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
      if(event.key==='Escape'&&config.dialogClose){
        var close=el.querySelector(config.dialogClose);if(close){event.preventDefault();event.stopPropagation();close.click();}
      }
    });
    update();
  }
  function init(){
    if(!reduced.matches&&'IntersectionObserver'in window){
      revealObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){
        if(!entry.isIntersecting)return;revealObserver.unobserve(entry.target);
        play(entry.target,[{opacity:.15,translate:'0 12px'},{opacity:1,translate:'0 0'}],{duration:520,delay:Number(entry.target.dataset.tjmUiDelay)||0,easing:'cubic-bezier(.16,1,.3,1)'});
      });},{threshold:0,rootMargin:'0px 0px -12px 0px'});
    }
    document.addEventListener('click',function(event){
      var el=event.target.closest('button,a,[role="button"],[tabindex="0"]');
      if(el&&!el.closest('.tjm-ui-dialog'))lastTrigger=el;
      var target=event.target.closest('.tjm-ui-action');
      if(!target||target.disabled||target.getAttribute('aria-disabled')==='true'||reduced.matches)return;
      var old=press.get(target);if(old)old.cancel();
      var animation=play(target,[{scale:'.97'},{scale:'1.01',offset:.65},{scale:'1'}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)'});
      if(animation)press.set(target,animation);
    },true);
    enhance();
    new MutationObserver(function(records){
      if(records.some(function(r){return r.removedNodes.length;}))modalUpdates.forEach(function(update){update();});
      // Ignore text-only progress updates and our own classes, which keeps GPU views quiet.
      if(!records.some(function(r){return Array.prototype.some.call(r.addedNodes,function(n){return n.nodeType===1;});}))return;
      if(!scheduled)scheduled=requestAnimationFrame(enhance);
    }).observe(document.body,{childList:true,subtree:true});
    reduced.addEventListener('change',function(){
      if(!reduced.matches)return;
      if(revealObserver){revealObserver.disconnect();revealObserver=null;}
      running.forEach(function(a){a.cancel();});running.clear();
    });
    document.documentElement.dataset.tjmUiVersion='20260929-independent-2';
  }
  window.TJMSitePolish={version:'20260929-independent-2',refresh:enhance};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
}());
