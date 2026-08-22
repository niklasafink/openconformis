const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)],esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
window.setTimeout(()=>{const script=document.createElement('script');script.src='i18n.js?v=20260821-18';document.body.appendChild(script)},0);
const state={screen:'1',lastWorkflowScreen:'1',framework:null,file:null,active:'a1',confirmed:{},scope:{},adminFw:'dora',adminReq:'a1',systemPrompt:'Bewerte ausschließlich anhand des regulatorischen Wortlauts, des freigegebenen Unternehmenskontexts und belegbarer Textstellen aus der Policy. Kennzeichne fehlende oder nicht eindeutige Abdeckung konservativ. Erfinde keine Belege und formuliere keine Verbesserungsvorschläge.'};REQUIREMENTS.forEach(r=>{const d=SCOPE_DEFAULTS[r.id]||{};state.scope[r.id]={on:d.applicable!==false,bp:d.bp||'',reason:d.reason||''}});const titles={'1':'Rahmenwerk wählen','2':'Policy bereitstellen','3':'Prüfungsumfang','run':'Analyse läuft','4':'Ergebnis',chat:'Chat',admin:'Administration'};
function go(s){const next=String(s);if(next==='chat'&&state.screen!=='chat')state.lastWorkflowScreen=state.screen;state.screen=next;document.body.classList.toggle('result-mode',state.screen==='4');document.body.classList.toggle('chat-mode',state.screen==='chat');$$('.screen').forEach(x=>x.classList.toggle('active',x.dataset.screen===state.screen));$$('.flow-step').forEach(x=>{const n=+x.dataset.go,c=+state.screen;x.classList.toggle('active',n===c);x.classList.toggle('done',n<c)});const chatLauncher=$('#chat-launcher');if(chatLauncher){chatLauncher.dataset.go=state.screen==='chat'?state.lastWorkflowScreen:'chat';chatLauncher.classList.toggle('active',state.screen==='chat');const label=$('.chat-label',chatLauncher);if(label)label.textContent=state.screen==='chat'?'Zur Analyse':'Chat'}$('#crumb-title').textContent=titles[state.screen];if(state.screen==='3')renderScope();if(state.screen==='4')renderResult();if(state.screen==='admin')renderAdmin();if(state.screen==='chat')window.setTimeout(()=>$('#chat-question')?.focus(),0)}$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
function renderFrameworks(q=''){
  const query=q.toLowerCase();
  const visible=FRAMEWORKS.filter(f=>(f.name+' '+f.long+' '+f.category).toLowerCase().includes(query));
  const card=f=>`<button class="framework-card ${state.framework===f.id?'selected':''} ${f.premium?'locked':''}" data-fw="${f.id}" ${f.premium?'disabled aria-label="Gesperrtes Rahmenwerk"':''}>${f.premium?`<span class="framework-lock-meta"><em>${f.region}</em><svg class="framework-lock" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="12" height="10" x="6" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>`:''}<span class="framework-card-main"><b>${esc(f.name)}</b>${f.premium?'':`<em>${f.region}</em>`}</span>${f.premium?'':`<span class="framework-card-meta">${f.requirementCount} Anforderungen</span>`}</button>`;
  const featured=visible.filter(f=>!f.premium);
  const premium=visible.filter(f=>f.premium).sort((a,b)=>a.category.localeCompare(b.category,'de')||a.name.localeCompare(b.name,'de'));
  $('#framework-grid').innerHTML=`${featured.length?`<section class="framework-category framework-featured"><h2>Enthalten</h2><div class="framework-category-grid">${featured.map(card).join('')}</div></section>`:''}${premium.length?`<section class="framework-category framework-premium"><h2>Weitere Rahmenwerke in Pro</h2><div class="framework-category-grid">${premium.map(card).join('')}</div></section>`:''}`;
  $$('[data-fw]').forEach(button=>button.onclick=()=>{
    state.framework=button.dataset.fw;
    const framework=FRAMEWORKS.find(item=>item.id===state.framework);
    renderFrameworks($('#fw-search').value);
    $('#to-policy').disabled=false;
    $('#fw-selection').textContent=`${framework.name} · ${framework.requirementCount} Anforderungen ausgewählt`;
  });
}
$('#fw-search').oninput=e=>renderFrameworks(e.target.value);$('#to-policy').onclick=()=>go(2);renderFrameworks();
$$('.page-heading p,.result-top p,.admin-heading p,.sidebar .brand,.sidebar .workspace,.sidebar .profile').forEach(element=>element.remove());
$('.result-top > div:first-child').remove();
$('.selected-framework b').textContent='DORA';
const findingDetailRoot=$('#finding-detail');
const syncFindingDetail=()=>{
  const requirement=REQUIREMENTS.find(item=>item.id===state.active);
  const requirementSection=findingDetailRoot.querySelector('.detail-block');
  const heading=requirementSection?.querySelector('h3');
  const sectionTitle=section=>{const title=section?.querySelector('h3');return title?[...title.childNodes].filter(node=>!node.classList?.contains('section-toggle')).map(node=>node.textContent).join('').trim():''};
  if(!requirement||!requirementSection)return;
  if(heading&&sectionTitle(requirementSection)!==requirement.cite){const textNode=[...heading.childNodes].find(node=>node.nodeType===Node.TEXT_NODE);if(textNode)textNode.nodeValue=requirement.cite;else heading.prepend(document.createTextNode(requirement.cite))}
  const statusControl=findingDetailRoot.querySelector('#status-control');
  if(statusControl)statusControl.dataset.status=statusControl.value;
  const generatedSubSection=[...findingDetailRoot.querySelectorAll('.detail-block')].find(section=>!section.classList.contains('subrequirements-detail')&&sectionTitle(section).startsWith('Subanforderungen'));
  generatedSubSection?.remove();
  let subSections=[...findingDetailRoot.querySelectorAll('.subrequirements-detail')];
  if(!requirement.subs.length){
    subSections.forEach(section=>section.remove());
    subSections=[];
  }else{
    const sectionsMatch=subSections.length===requirement.subs.length&&subSections.every((section,index)=>section.dataset.sub===requirement.subs[index].id);
    if(!sectionsMatch){
      subSections.forEach(section=>section.remove());
      subSections=requirement.subs.map(sub=>{
        const section=document.createElement('section');
        section.className='detail-block subrequirements-detail';
        section.dataset.sub=sub.id;
        section.innerHTML=`<h3>${esc(sub.cite)}</h3><p>${esc(sub.legal)}</p>`;
        return section;
      });
    }
  }
  let anchor=requirementSection;
  subSections.forEach(section=>{if(anchor.nextElementSibling!==section)anchor.after(section);anchor=section});
  const contextSection=[...findingDetailRoot.querySelectorAll('.detail-block')].find(section=>!section.classList.contains('subrequirements-detail')&&['Unternehmenskontext','Company context'].includes(sectionTitle(section)));
  if(contextSection){contextSection.classList.add('company-context-detail');if(anchor.nextElementSibling!==contextSection)anchor.after(contextSection)}
  let sourceCard=findingDetailRoot.querySelector('.assessment-source-card');
  if(!sourceCard){sourceCard=document.createElement('div');sourceCard.className='assessment-source-card';requirementSection.before(sourceCard)}
  [requirementSection,...subSections,contextSection].filter(Boolean).forEach(section=>{if(section.parentElement!==sourceCard)sourceCard.append(section)});
  const rationaleSection=[...findingDetailRoot.querySelectorAll('.detail-block')].find(section=>['Begründung der Bewertung','Assessment rationale','Begründung der Nicht-Einschlägigkeit','Reason for non-applicability'].includes(sectionTitle(section)));
  rationaleSection?.classList.add('assessment-rationale-card');
  const evidenceSection=[...findingDetailRoot.querySelectorAll('.detail-block')].find(section=>['Belegstellen','Evidence'].some(label=>sectionTitle(section).startsWith(label)));
  evidenceSection?.classList.add('assessment-evidence-card');
  $$('.detail-block',findingDetailRoot).forEach(section=>{
    const title=section.querySelector('h3');
    if(!title)return;
    let toggle=title.querySelector('.section-toggle');
    if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.className='section-toggle';toggle.textContent='⌄';title.append(toggle)}
    const updateLabel=()=>toggle.setAttribute('aria-label',state.lang==='en'?(section.classList.contains('collapsed')?'Expand section':'Collapse section'):(section.classList.contains('collapsed')?'Abschnitt ausklappen':'Abschnitt einklappen'));
    toggle.setAttribute('aria-expanded',String(!section.classList.contains('collapsed')));
    updateLabel();
    title.onclick=event=>{event.preventDefault();section.classList.toggle('collapsed');toggle.setAttribute('aria-expanded',String(!section.classList.contains('collapsed')));updateLabel()};
  });
};
new MutationObserver(syncFindingDetail).observe(findingDetailRoot,{childList:true,subtree:true});
const metricsRoot=$('#metrics');
const renderStatusTabs=()=>{
  const counts={erfuellt:0,teilweise:0,nicht:0,na:0};
  REQUIREMENTS.forEach(requirement=>counts[eff(requirement)]++);
  const selected=$('#status-filter').value;
  const labels=state.lang==='en'?{all:'All',erfuellt:'Met',teilweise:'Partial',nicht:'Not met',na:'Not applicable'}:{all:'Alle',erfuellt:'Erfüllt',teilweise:'Teilweise',nicht:'Nicht erfüllt',na:'Nicht einschlägig'};
  const tabs=[['all',REQUIREMENTS.length],['erfuellt',counts.erfuellt],['teilweise',counts.teilweise],['nicht',counts.nicht],['na',counts.na]];
  metricsRoot.innerHTML=`<div class="status-tabs">${tabs.map(([status,count])=>`<button class="status-tab ${selected===status?'active':''}" data-status-tab="${status}">${status!=='all'?`<i class="status-tab-dot ${status}"></i>`:''}<span>${labels[status]}</span><b>${count}</b></button>`).join('')}</div>`;
  $$('[data-status-tab]',metricsRoot).forEach(button=>button.onclick=()=>{$('#status-filter').value=button.dataset.statusTab;renderFindingList();renderStatusTabs()});
};
new MutationObserver(()=>{if(!metricsRoot.querySelector('.status-tabs'))renderStatusTabs()}).observe(metricsRoot,{childList:true});
const scopeTableRoot=$('.requirement-table');
const syncScopeTable=()=>{
  const head=scopeTableRoot.querySelector('.scope-head');
  const headHtml=state.lang==='en'?'<span></span><span>Regulatory requirement</span><span>Sub-requirements</span><span>Best practices</span><span></span>':'<span></span><span>Regulatorische Anforderung</span><span>Subanforderungen</span><span>Best Practices</span><span></span>';
  if(head&&head.innerHTML!==headHtml)head.innerHTML=headHtml;
  $$('.scope-row',scopeTableRoot).forEach(row=>{
    const id=row.querySelector('[data-toggle]')?.dataset.toggle;
    const requirement=REQUIREMENTS.find(item=>item.id===id);
    if(!requirement)return;
    row.querySelector('.scope-content')?.remove();
    const requirementCell=row.querySelector('.scope-reg, .scope-requirement');
    const subCell=row.querySelector('.scope-subs');
    let contextCell=row.querySelector('.context-button, .best-practice-cell');
    if(contextCell?.matches('button')){const cell=document.createElement('div');cell.className='best-practice-cell';contextCell.replaceWith(cell);contextCell=cell}
    let editButton=row.querySelector('.scope-edit-button');
    if(!editButton){editButton=document.createElement('button');editButton.type='button';editButton.className='scope-edit-button';editButton.dataset.scopeEdit=id;row.append(editButton)}
    const editLabel=state.lang==='en'?'Edit':'Bearbeiten';
    if(editButton.textContent!==editLabel)editButton.textContent=editLabel;
    editButton.onclick=()=>openScopeEditor(id);
    const requirementHtml=`<b>${esc(requirement.cite)}</b><p>${esc(requirement.legal)}</p>`;
    const subHtml=requirement.subs.length?requirement.subs.map(sub=>`<span>${esc(sub.cite)}</span>`).join(''):`<span class="cell-empty">${state.lang==='en'?'None':'Keine'}</span>`;
    const context=state.scope[id].bp;
    const contextHtml=context?`<span>${esc(context)}</span>`:'<span class="cell-empty">—</span>';
    if(requirementCell.innerHTML!==requirementHtml)requirementCell.innerHTML=requirementHtml;
    if(subCell.innerHTML!==subHtml)subCell.innerHTML=subHtml;
    if(contextCell.innerHTML!==contextHtml)contextCell.innerHTML=contextHtml;
    row.classList.add('compact-scope-row');
    requirementCell.className='scope-requirement';
  });
};
new MutationObserver(syncScopeTable).observe(scopeTableRoot,{childList:true,subtree:true});
const scopeHeadingContent=$('[data-screen="3"] .row-heading > div:first-child');
const scopeSearchBox=$('#scope-search').closest('.search');
scopeHeadingContent.classList.add('scope-heading-content');
scopeSearchBox.classList.add('topbar-search','scope-topbar-search');
scopeSearchBox.hidden=true;
$('.top-actions').insertBefore(scopeSearchBox,$('.lang'));
const scopeHeadingActions=document.createElement('div');
scopeHeadingActions.className='scope-heading-actions';
scopeHeadingActions.append($('[data-screen="3"] .summary-card'),$('#run-analysis'));
$('[data-screen="3"] .row-heading').append(scopeHeadingActions);
document.body.insertAdjacentHTML('beforeend',`<dialog id="scope-edit-dialog" class="scope-edit-dialog" tabindex="-1"><form method="dialog"><header><div class="scope-dialog-title"><h2>Anforderung bearbeiten</h2><span id="scope-edit-header-cite"></span></div><button type="submit" value="cancel" aria-label="Schließen">×</button></header><div class="scope-editor-body"><section class="scope-editor-section scope-primary-section"><div class="scope-section-heading"><h3>Anforderung</h3><label class="editor-check scope-applicability"><input id="scope-edit-applicable" type="checkbox"><span></span><b>Einschlägig</b></label></div><div class="scope-editor-grid"><label class="editor-field"><span>Regulatorische ID</span><input id="scope-edit-cite"></label><label class="editor-field"><span>Titel</span><input id="scope-edit-title"></label></div><label class="editor-field"><span>Regulatorischer Wortlaut</span><textarea id="scope-edit-legal" rows="5"></textarea></label></section><section class="scope-editor-section scope-assessment-section"><h3>Bewertungskontext</h3><label class="editor-field"><span>Best Practice</span><textarea id="scope-edit-bp" rows="4"></textarea></label></section><section class="scope-editor-section scope-subs-section"><div class="scope-section-heading"><h3 class="scope-subsection-title">Subanforderungen</h3><span id="scope-edit-sub-count"></span></div><div id="scope-edit-subs" class="scope-edit-subs"></div></section></div><footer><button class="secondary" value="cancel">Abbrechen</button><button class="primary" value="save">Speichern</button></footer></form></dialog>`);
let scopeEditorId=null;
const openScopeEditor=id=>{
  scopeEditorId=id;
  const requirement=REQUIREMENTS.find(item=>item.id===id),scope=state.scope[id];
  $('#scope-edit-cite').value=requirement.cite;
  $('#scope-edit-title').value=requirement.title;
  $('#scope-edit-legal').value=requirement.legal;
  $('#scope-edit-applicable').checked=scope.on;
  $('#scope-edit-bp').value=scope.bp;
  $('#scope-edit-header-cite').textContent=requirement.cite;
  $('#scope-edit-sub-count').textContent=state.lang==='en'?`${requirement.subs.length} linked`:`${requirement.subs.length} verknüpft`;
  const labels=state.lang==='en'?{cite:'Regulatory ID',title:'Title',legal:'Requirement',empty:'No sub-requirements'}:{cite:'Regulatorische ID',title:'Titel',legal:'Anforderung',empty:'Keine Subanforderungen'};
  $('#scope-edit-subs').innerHTML=requirement.subs.length?requirement.subs.map((sub,index)=>`<section class="scope-edit-sub" data-sub-index="${index}"><label class="editor-field"><span>${labels.cite}</span><input data-sub-field="cite" value="${esc(sub.cite)}"></label><label class="editor-field"><span>${labels.title}</span><input data-sub-field="title" value="${esc(sub.title)}"></label><label class="editor-field"><span>${labels.legal}</span><textarea data-sub-field="legal" rows="4">${esc(sub.legal)}</textarea></label></section>`).join(''):`<div class="scope-edit-empty">${labels.empty}</div>`;
  const dialog=$('#scope-edit-dialog');dialog.showModal();requestAnimationFrame(()=>dialog.focus());
};
$('#scope-edit-dialog').onclose=()=>{
  if($('#scope-edit-dialog').returnValue!=='save'||!scopeEditorId)return;
  const requirement=REQUIREMENTS.find(item=>item.id===scopeEditorId);
  requirement.cite=$('#scope-edit-cite').value.trim();
  requirement.title=$('#scope-edit-title').value.trim();
  requirement.legal=$('#scope-edit-legal').value.trim();
  state.scope[scopeEditorId].on=$('#scope-edit-applicable').checked;
  state.scope[scopeEditorId].bp=$('#scope-edit-bp').value.trim();
  $$('.scope-edit-sub').forEach(section=>{const sub=requirement.subs[Number(section.dataset.subIndex)];$$('[data-sub-field]',section).forEach(field=>sub[field.dataset.subField]=field.value.trim())});
  renderScope($('#scope-search').value);
  toast(state.lang==='en'?'Requirement updated':'Anforderung aktualisiert');
};

const uploadArea=$('#upload');
['dragenter','dragover'].forEach(type=>uploadArea.addEventListener(type,event=>{event.preventDefault();uploadArea.classList.add('dragging')}));
['dragleave','drop'].forEach(type=>uploadArea.addEventListener(type,event=>{event.preventDefault();uploadArea.classList.remove('dragging')}));
uploadArea.addEventListener('drop',event=>{const file=event.dataTransfer.files[0];if(file)setFile(file.name)});

$('#include-all').insertAdjacentHTML('beforebegin','<button class="secondary" id="edit-system-prompt">System-Prompt</button>');
document.body.insertAdjacentHTML('beforeend',`<dialog id="prompt-dialog"><form method="dialog"><div class="dialog-head"><span><small>Analysekonfiguration</small><b>System-Prompt bearbeiten</b></span><button value="cancel">×</button></div><div class="dialog-body"><label>Anweisung für alle Anforderungen</label><textarea id="system-prompt-text" rows="9"></textarea><div class="prompt-meta"><span>Gilt für diese Analyse</span><span id="prompt-chars"></span></div></div><div class="dialog-foot"><button class="secondary" value="cancel">Abbrechen</button><button class="primary" value="save">Speichern</button></div></form></dialog>`);
$('#edit-system-prompt').onclick=()=>{$('#system-prompt-text').value=state.systemPrompt;$('#prompt-chars').textContent=state.systemPrompt.length+' Zeichen';$('#prompt-dialog').showModal()};$('#system-prompt-text').oninput=e=>$('#prompt-chars').textContent=e.target.value.length+' Zeichen';$('#prompt-dialog').onclose=()=>{if($('#prompt-dialog').returnValue==='save'){state.systemPrompt=$('#system-prompt-text').value.trim();$('#edit-system-prompt').classList.add('configured');toast('System-Prompt gespeichert')}};
function submitChat(question){if(!question.trim())return;const workspace=$('#chat-workspace'),messages=$('#chat-messages');workspace.classList.add('has-messages');messages.insertAdjacentHTML('beforeend',`<article class="chat-message user"><div><span>Sie</span><p>${esc(question)}</p></div></article><article class="chat-message assistant pending"><div class="chat-answer-mark" aria-hidden="true"></div><div><span>Assistent</span><p>Antwort wird ermittelt …</p></div></article>`);$('#chat-question').value='';messages.scrollTop=messages.scrollHeight;setTimeout(()=>{const pending=$('.chat-message.pending',messages);if(!pending)return;pending.classList.remove('pending');pending.innerHTML='<div class="chat-answer-mark" aria-hidden="true"></div><div><span>Assistent</span><p>Die Policy deckt rollenbasierte Zugriffe, Least Privilege und Mehr-Faktor-Authentisierung ab. Physische Zugriffsregelungen fehlen; Art. 9 Abs. 4 lit. c DORA ist daher nur teilweise erfüllt.</p><div class="chat-citations"><button type="button">Art. 9 Abs. 4 lit. c DORA</button><button type="button">2 Belegstellen</button></div></div>';messages.scrollTop=messages.scrollHeight},500)}
$('#chat-form').onsubmit=event=>{event.preventDefault();submitChat($('#chat-question').value)};
$('#chat-question').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('#chat-form').requestSubmit()}};
const chatFrameworkPicker=$('#chat-framework-picker'),chatFrameworkTrigger=$('#chat-framework-trigger'),chatFrameworkMenu=$('#chat-framework-menu'),chatFrameworkValue=$('#chat-framework-value'),chatFrameworkLabel=$('#chat-framework-label');
$('[data-chat-framework=""]',chatFrameworkMenu).setAttribute('aria-selected','true');
const closeChatFrameworkMenu=()=>{chatFrameworkPicker.classList.remove('open');chatFrameworkTrigger.setAttribute('aria-expanded','false')};
chatFrameworkTrigger.onclick=()=>{const open=!chatFrameworkPicker.classList.contains('open');chatFrameworkPicker.classList.toggle('open',open);chatFrameworkTrigger.setAttribute('aria-expanded',String(open));if(open)$('[data-chat-framework=""]',chatFrameworkMenu).focus()};
$$('[data-chat-framework]',chatFrameworkMenu).forEach(option=>option.onclick=()=>{chatFrameworkValue.value=option.dataset.chatFramework;chatFrameworkLabel.textContent=option.textContent;$$('[data-chat-framework]',chatFrameworkMenu).forEach(item=>item.setAttribute('aria-selected',String(item===option)));closeChatFrameworkMenu();chatFrameworkTrigger.focus()});
document.addEventListener('click',event=>{if(!chatFrameworkPicker.contains(event.target))closeChatFrameworkMenu()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&chatFrameworkPicker.classList.contains('open')){closeChatFrameworkMenu();chatFrameworkTrigger.focus()}});
$$('.chat-quick-actions button').forEach(button=>button.onclick=()=>submitChat(button.textContent));
function setFile(n){state.file=n;$('#file-name').textContent=n;$('.document-toolbar b').textContent=n;$('#file-card').classList.remove('hidden');$('#upload').classList.add('hidden');$('#sample').classList.add('hidden');$('.choice-divider').classList.add('hidden');$('#to-scope').disabled=false;$('#side-doc').textContent=n}$('#sample').onclick=()=>{setFile('Beispiel-IKT-Sicherheitsrichtlinie.docx');go(3)};$('#upload').onclick=()=>$('#upload input').click();$('#upload input').onchange=e=>e.target.files[0]&&setFile(e.target.files[0].name);$('#remove-file').onclick=()=>{state.file=null;$('#file-card').classList.add('hidden');$('#upload').classList.remove('hidden');$('#sample').classList.remove('hidden');$('.choice-divider').classList.remove('hidden');$('#to-scope').disabled=true};$('#to-scope').onclick=()=>go(3);
function renderScope(q=''){const list=REQUIREMENTS.filter(r=>(r.cite+' '+r.title+' '+r.legal).toLowerCase().includes(q.toLowerCase()));$('.scope-head').innerHTML='<span></span><span>Regulatorische ID</span><span>Inhalt der Anforderung</span><span>Subanforderungen</span><span>Best Practice</span>';$('#scope-list').innerHTML=list.map(r=>{const s=state.scope[r.id],subs=r.subs.length?r.subs.map(x=>`<span>${esc(x.cite)}</span>`).join(''):'<span class="cell-empty">Keine</span>';return `<div class="scope-row ${s.on?'':'off'}"><label class="scope-check"><input type="checkbox" data-toggle="${r.id}" ${s.on?'checked':''}><span></span></label><div class="scope-reg"><b>${esc(r.cite)}</b><small>DORA</small></div><div class="scope-content"><b>${esc(r.title)}</b><p>${esc(r.legal)}</p></div><div class="scope-subs">${subs}</div><button class="context-button ${s.bp?'has-context':''}" data-context="${r.id}"><b>${s.bp?'Hinterlegt':'Hinzufügen'}</b><small>${s.bp?esc(s.bp.slice(0,44))+(s.bp.length>44?'…':''):'Unternehmenskontext'}</small></button></div>`}).join('');$$('[data-toggle]').forEach(b=>b.onchange=()=>{state.scope[b.dataset.toggle].on=b.checked;renderScope($('#scope-search').value)});$$('[data-context]').forEach(b=>b.onclick=()=>openContext(b.dataset.context));const n=REQUIREMENTS.filter(r=>state.scope[r.id].on).length;$('#scope-count').textContent=`${n}/${REQUIREMENTS.length}`;$('#side-scope').textContent=`${n} Anforderungen`;$('#analysis-count').textContent=`0 von ${n} Anforderungen`}$('#scope-search').oninput=e=>renderScope(e.target.value);$('#include-all').onclick=()=>{REQUIREMENTS.forEach(r=>state.scope[r.id].on=true);renderScope($('#scope-search').value)};
let contextId;function openContext(id){contextId=id;const r=REQUIREMENTS.find(x=>x.id===id),s=state.scope[id];$('#dialog-cite').textContent=r.cite+' · '+r.title;$('#context-text').value=s.bp;$('#na-reason').value=s.reason;$('.reason-label').style.display=s.on?'none':'block';$('#na-reason').style.display=s.on?'none':'block';$('#context-dialog').showModal()}$('#context-dialog').onclose=()=>{if($('#context-dialog').returnValue!=='save')return;state.scope[contextId].bp=$('#context-text').value.trim();state.scope[contextId].reason=$('#na-reason').value.trim();renderScope($('#scope-search').value)};
$('#run-analysis').onclick=()=>{go('run');const list=REQUIREMENTS.filter(r=>state.scope[r.id].on);let i=0;const tick=()=>{i++;const p=Math.round(i/list.length*100);$('#progress-bar').style.width=p+'%';$('#progress-label').textContent=p+' %';$('#analysis-count').textContent=`${i} von ${list.length} Anforderungen`;$('#analysis-status').textContent=i<list.length?`${list[i].cite} wird gegen das Dokument geprüft …`:'Ergebnis wird aufbereitet …';i<list.length?setTimeout(tick,280):setTimeout(()=>go(4),450)};setTimeout(tick,250)};
const sl={erfuellt:'Erfüllt',teilweise:'Teilweise erfüllt',nicht:'Nicht erfüllt',na:'Nicht einschlägig'},eff=r=>state.scope[r.id].on?r.status:'na',badge=s=>`<span class="status ${s}"><i></i>${sl[s]}</span>`;
function renderResult(){const ct={erfuellt:0,teilweise:0,nicht:0,na:0};REQUIREMENTS.forEach(r=>ct[eff(r)]++);const n=REQUIREMENTS.filter(r=>state.scope[r.id].on).length,c=Object.values(state.confirmed).filter(Boolean).length;$('#confirmed-count').textContent=`${c} von ${n} bestätigt`;$('#side-result').textContent=`${c} von ${n} bestätigt`;$('#metrics').innerHTML=`<div class="result-summary"><span><b>${n}</b> geprüft</span><span><i class="dot ok"></i><b>${ct.erfuellt}</b> erfüllt</span><span><i class="dot part"></i><b>${ct.teilweise}</b> teilweise</span><span><i class="dot bad"></i><b>${ct.nicht}</b> nicht erfüllt</span><span><i class="dot neutral"></i><b>${ct.na}</b> nicht einschlägig</span></div>`;renderFindingList();renderDetail()}
function renderFindingList(){const q=$('#finding-search').value.toLowerCase(),f=$('#status-filter').value,items=REQUIREMENTS.filter(r=>(f==='all'||eff(r)===f)&&(r.cite+' '+r.title).toLowerCase().includes(q));$('#findings-list').innerHTML='<div class="finding-list-head"><span>Reg-ID / Anforderung</span><span>Status</span></div>'+items.map(r=>`<button class="finding-item ${r.id===state.active?'active':''}" data-find="${r.id}"><span class="finding-name"><b>${esc(r.cite)}</b><small>${esc(r.title)}</small></span><span class="finding-state">${badge(eff(r))}${state.confirmed[r.id]?'<em>✓</em>':''}</span></button>`).join('');$$('[data-find]').forEach(b=>b.onclick=()=>{state.active=b.dataset.find;renderFindingList();renderDetail()})}
function markPolicy(ev){const by={};ev.forEach((e,i)=>(by[e.b]||(by[e.b]=[])).push({n:i+1,s:e.s}));return POLICY.map(b=>{let t=esc(b.t);(by[b.id]||[]).forEach(x=>{const raw=esc(x.s);t=t.replace(raw,`<mark data-e="${x.n}"><i>${x.n}</i>${raw}</mark>`)});return b.k==='li'?`<p>• ${t}</p>`:`<${b.k}>${t}</${b.k}>`}).join('')}
function renderDetail(){const r=REQUIREMENTS.find(x=>x.id===state.active),st=eff(r),ev=st==='na'?[]:r.ev,reason=st==='na'?(state.scope[r.id].reason||'Keine Begründung hinterlegt.'):(r.reason||'').replace(/\[\[(\d+)\]\]/g,'<span class="reference" data-ref="$1">$1</span>');$('#finding-detail').innerHTML=`<header class="detail-header"><div><span class="detail-cite">${esc(r.cite)}</span><h2>${esc(r.title)}</h2></div><select class="status-control" id="status-control" ${st==='na'?'disabled':''}><option value="erfuellt" ${st==='erfuellt'?'selected':''}>Erfüllt</option><option value="teilweise" ${st==='teilweise'?'selected':''}>Teilweise erfüllt</option><option value="nicht" ${st==='nicht'?'selected':''}>Nicht erfüllt</option><option value="na" ${st==='na'?'selected':''}>Nicht einschlägig</option></select></header><section class="detail-block"><h3>Regulatorische Anforderung</h3><p class="legal-copy">${esc(r.legal)}</p></section>${state.scope[r.id].bp?`<section class="detail-block"><h3>Unternehmenskontext</h3><p>${esc(state.scope[r.id].bp)}</p></section>`:''}<section class="detail-block"><h3>${st==='na'?'Begründung der Nicht-Einschlägigkeit':'Begründung der Bewertung'}</h3><div class="reason">${reason}</div></section>${st!=='na'?`<section class="detail-block"><h3>Belegstellen <span>${ev.length}</span></h3>${ev.length?ev.map((e,i)=>`<button class="evidence-line" data-ref="${i+1}"><span class="reference">${i+1}</span><span><p>„${esc(e.s)}“</p><small>${esc(e.loc)}</small></span><b>→</b></button>`).join(''):'<p class="empty-evidence">Keine passende Textstelle im Dokument gefunden.</p>'}</section>${r.subs.length?`<section class="detail-block"><h3>Subanforderungen <span>${r.subs.length}</span></h3>${r.subs.map(s=>`<div class="sub-line"><span><b>${esc(s.cite)}</b><small>${esc(s.title)}</small></span>${badge(s.status)}</div>`).join('')}</section>`:''}<footer class="confirmation"><span>${state.confirmed[r.id]?'Bestätigt von Niklas Fink':'Menschliche Validierung ausstehend'}</span><button class="primary ${state.confirmed[r.id]?'confirmed-button':''}" id="confirm">${state.confirmed[r.id]?'✓ Bestätigt':'Bewertung bestätigen'}</button></footer>`:''}`;$('#document').innerHTML=markPolicy(ev);$('#evidence-count').textContent=`${ev.length} Belegstelle${ev.length===1?'':'n'}`;bindEvidence();if($('#status-control'))$('#status-control').onchange=e=>{r.status=e.target.value;renderResult();toast('Status aktualisiert')};if($('#confirm'))$('#confirm').onclick=()=>{state.confirmed[r.id]=!state.confirmed[r.id];renderResult();toast(state.confirmed[r.id]?'Bewertung bestätigt':'Bestätigung aufgehoben')}}
function bindEvidence(){$$('[data-ref]').forEach(x=>{x.onmouseenter=()=>hot(x.dataset.ref,true);x.onmouseleave=()=>hot(x.dataset.ref,false);x.onclick=()=>$('#document [data-e="'+x.dataset.ref+'"]').scrollIntoView({behavior:'smooth',block:'center'})})}function hot(n,on){$$(`[data-ref="${n}"],[data-e="${n}"]`).forEach(x=>x.classList.toggle('hot',on))}function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),1400)}$('#finding-search').oninput=renderFindingList;$('#status-filter').onchange=renderFindingList;
function renderAdmin(){const fw=FRAMEWORKS.find(f=>f.id===state.adminFw);$('#admin-fws').innerHTML=FRAMEWORKS.map(f=>`<button class="admin-fw ${f.id===state.adminFw?'active':''}" data-afw="${f.id}"><span>${esc(f.name)}</span><b>${f.seeded?REQUIREMENTS.length:0}</b></button>`).join('');$$('[data-afw]').forEach(b=>b.onclick=()=>{state.adminFw=b.dataset.afw;renderAdmin()});$('#admin-title').textContent=fw.name+' Anforderungen';if(!fw.seeded){$('#admin-reqs').innerHTML='';$('#admin-editor').innerHTML='<div class="admin-empty"><b>Noch keine Anforderungen hinterlegt</b><p>Für dieses Rahmenwerk sind noch keine Inhalte erfasst.</p></div>';return}const cur=REQUIREMENTS.find(r=>r.id===state.adminReq)||REQUIREMENTS[0];$('#admin-reqs').innerHTML=REQUIREMENTS.map(r=>`<button class="admin-req ${r.id===cur.id?'active':''}" data-areq="${r.id}"><b>${esc(r.cite)}</b><span>${esc(r.title)}</span><small>${r.subs.length} Sub</small></button>`).join('');$$('[data-areq]').forEach(b=>b.onclick=()=>{state.adminReq=b.dataset.areq;renderAdmin()});$('#admin-editor').innerHTML=`<div class="editor-head"><span>Anforderung bearbeiten</span><button>•••</button></div><label>Zitat</label><input value="${esc(cur.cite)}"><label>Titel</label><input value="${esc(cur.title)}"><label>Rechtstext</label><textarea rows="6">${esc(cur.legal)}</textarea><label>Geprüfte Aspekte</label><div class="admin-chips">${cur.aspects.map(a=>`<span>${esc(a)}</span>`).join('')}<button>+ Aspekt</button></div><div class="sub-admin-head"><label>Subanforderungen (${cur.subs.length})</label><button>+ Hinzufügen</button></div>${cur.subs.map(s=>`<div class="admin-sub">${badge(s.status)}<span><b>${esc(s.cite)}</b><small>${esc(s.title)}</small></span><button>•••</button></div>`).join('')}<div class="editor-actions"><button class="secondary">Verwerfen</button><button class="primary" onclick="toast('Änderungen gespeichert')">Speichern</button></div>`}
