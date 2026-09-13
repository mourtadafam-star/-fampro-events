/* Administrator workflows. Server policies remain the source of authorization. */
'use strict';
let adminLoadPending=null;
let missionRows=[];
let missionEditor=null;
const workflowBusy=new Set();
const workflowStyles=document.createElement('style');
workflowStyles.textContent=`.mobile-menu-panel{max-height:100dvh;overflow-y:auto}.workflow-editor{margin-top:16px}.workflow-editor label{display:block;margin:12px 0 5px;font-weight:700}.workflow-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.workflow-actions button{min-height:44px}.workflow-message{padding:10px;background:#fff4df;border-radius:8px}.workflow-title{color:#850812}@media(prefers-reduced-motion:reduce){.mobile-menu-panel,.mobile-menu-backdrop{transition:none!important}}`;
document.head.append(workflowStyles);
workflowStyles.textContent+=`@media(max-width:759px){.head{display:grid!important;grid-template-columns:34px minmax(0,1fr) 34px!important}.head>.icon,.head:after{display:none!important}.head .admin-mobile-refresh{grid-column:3;grid-row:1}.sync{margin-left:0;text-align:center}.workflow-editor .form-grid{grid-template-columns:1fr}.workflow-content{padding-bottom:30px}}`;

async function workflowRpc(name,args){const result=await supabaseClient.rpc(name,args);if(result.error)throw result.error;return result.data;}
async function workflowRun(key,task){
 if(workflowBusy.has(key))return;
 workflowBusy.add(key);
 try{return await task();}catch(error){alert(error.message||'Impossible de terminer. Réessayez.');return false;}
 finally{workflowBusy.delete(key);}
}

loadData=function(){
 if(adminLoadPending)return adminLoadPending;
 adminLoadPending=(async()=>{
  const label=document.getElementById('connection');
  label.textContent='Synchronisation…';
  try{
   const auth=await supabaseClient.auth.getSession();
   if(auth.error)throw auth.error;
   if(!auth.data.session){location.replace('login.html');return false;}
   if(auth.data.session.user.email?.toLowerCase()!=='mourtadafam@gmail.com'){
    location.replace('client.html');return false;
   }
   const tables=['clients','reservations','paiements','materiel','demandes_reservation','mouvements_stock','admin_missions'];
   const results=await Promise.all(tables.map(table=>{
    let query=supabaseClient.from(table).select('*');
    if(table==='mouvements_stock')query=query.order('created_at',{ascending:false}).limit(100);
    return query;
   }));
   results.forEach((result,index)=>{if(result.error)throw new Error(`Chargement ${tables[index]} : ${result.error.message}`);});
   data={clients:results[0].data||[],reservations:(results[1].data||[]).sort((a,b)=>String(a.date_evenement).localeCompare(String(b.date_evenement))),payments:results[2].data||[],material:results[3].data||[],demandes_reservation:results[4].data||[],mouvements:results[5].data||[]};
   missionRows=results[6].data||[];
   render();renderClientRequests();
   const visible=document.querySelector('main > section:not(.hidden)');
   if(visible&&!missionEditor)renderView(visible.id);
   label.textContent='● Données synchronisées';
   try{if('Notification' in window)sendPhoneReminder();}catch(error){console.warn('Rappel local indisponible',error);}
   return true;
  }catch(error){console.error(error);label.textContent='⚠ Synchronisation impossible — données non actualisées';return false;}
 })().finally(()=>{adminLoadPending=null;});
 return adminLoadPending;
};

const missionKinds={missions:{kind:'route',title:'Feuilles de route',single:'Feuille de route'},missionOrders:{kind:'order',title:'Ordres de mission',single:'Ordre de mission'}};
for(const [page,config] of Object.entries(missionKinds)){
 const section=document.createElement('section');section.id=page;section.className='hidden';
 section.innerHTML=`<h1 class="title">${config.title}</h1><p class="small">Documents sauvegardés dans votre compte, disponibles sur ordinateur et téléphone.</p><div class="workflow-content"></div>`;
 document.querySelector('main').append(section);
 for(const menu of [document.querySelector('.desktop-menu'),document.querySelector('.mobile-menu-list')]){
  if(!menu)continue;
  const button=document.createElement('button');button.type='button';button.dataset.page=page;button.textContent='▤  '+config.title;
  button.onclick=()=>{show(page);closeMobileMenu();};
  const before=menu.querySelector('[data-page="reports"], [onclick*="reports"]')||menu.querySelector('.menu-logout,.danger');
  menu.insertBefore(button,before);
 }
}
function renderMissionPage(page){
 const config=missionKinds[page],container=document.querySelector(`#${page} .workflow-content`);
 if(missionEditor?.page===page)return;
 container.replaceChildren();
 const reservations=data.reservations.filter(r=>status(r)!=='Annulée');
 if(!reservations.length){container.textContent='Aucune réservation disponible pour préparer ce document.';return;}
 for(const r of reservations){
  const saved=missionRows.find(x=>x.reservation_id===r.id&&x.kind===config.kind);
  const card=document.createElement('div');card.className='card';
  card.innerHTML=`<h2 class="name">${esc(name(r))} — ${esc(r.type_evenement||'Événement')}</h2><p class="meta">${esc(r.date_evenement||'Date à définir')} · ${esc(r.lieu||'Lieu à définir')}</p><p class="small">${esc(saved?.details?.responsable||'Responsable à désigner')} · ${esc(saved?.details?.statut||'À préparer')}</p>`;
  const button=document.createElement('button');button.className='btn secondary';button.textContent=saved?'Ouvrir / Modifier':'Préparer le document';button.onclick=()=>openMissionEditor(page,r.id);card.append(button);container.append(card);
 }
}
const workflowRenderView=renderView;
renderView=function(id){if(missionKinds[id])return renderMissionPage(id);return workflowRenderView(id);};
const workflowShow=show;
show=function(id,button,direction){
 if(missionEditor&&id!==missionEditor.page){
  if(missionEditor.dirty&&!confirm('Quitter sans enregistrer les modifications du document ?'))return;
  const previous=missionEditor.page;missionEditor=null;renderMissionPage(previous);
 }
 workflowShow(id,button,direction);
 if(missionKinds[id]){document.querySelectorAll('.desktop-menu button').forEach(b=>b.classList.toggle('active-menu',b.dataset.page===id));const title=document.querySelector('.head .brand span');if(title)title.dataset.page=missionKinds[id].title;}
};
function openMissionEditor(page,id){
 const r=data.reservations.find(x=>x.id===id),config=missionKinds[page];if(!r)return;
 const stored=missionRows.find(x=>x.reservation_id===id&&x.kind===config.kind);
 let details=stored?.details||{};let legacy=false;
 if(!stored){try{const local=JSON.parse(localStorage.getItem(`fampro-mission-${id}`)||'null');if(local&&typeof local==='object'){details=local;legacy=true;}}catch{}}
 missionEditor={page,id,revision:stored?.revision||0,dirty:legacy};
 const container=document.querySelector(`#${page} .workflow-content`);
 container.innerHTML=`<div class="card workflow-editor"><h2 class="workflow-title">${config.single}</h2><p>${esc(name(r))} · ${esc(r.date_evenement||'')} · ${esc(r.lieu||'')}</p>${legacy?'<p class="workflow-message">Anciennes informations de cet appareil récupérées. Enregistrez pour les retrouver sur vos autres appareils.</p>':''}<form id="workflowMissionForm"><div class="form-grid">${[['responsable','Responsable / employé'],['equipe','Équipe'],['vehicule','Véhicule'],['depart','Heure de départ']].map(([key,label])=>`<div><label for="mission-${key}">${label}</label><input id="mission-${key}" name="${key}" type="${key==='depart'?'time':'text'}" maxlength="500" value="${esc(details[key]||'')}"></div>`).join('')}<div><label for="mission-statut">Statut</label><select id="mission-statut" name="statut">${['À préparer','En cours','Terminée'].map(s=>`<option${details.statut===s?' selected':''}>${s}</option>`).join('')}</select></div></div><p id="missionSaveState" role="status">${stored?'Document enregistré dans votre compte.':'Document non enregistré.'}</p><div class="workflow-actions"><button type="submit" class="btn">Enregistrer</button><button type="button" class="btn secondary" data-pdf>Télécharger le PDF</button><button type="button" class="btn secondary" data-back>Retour à la liste</button></div></form></div>`;
 const form=container.querySelector('form');
 form.oninput=()=>{missionEditor.dirty=true;document.getElementById('missionSaveState').textContent='Modifications non enregistrées';};
 form.onsubmit=e=>{e.preventDefault();saveMissionDocument();};
 form.querySelector('[data-pdf]').onclick=async()=>{if(await saveMissionDocument())downloadWorkflowPdf(page,r,Object.fromEntries(new FormData(form)));};
 form.querySelector('[data-back]').onclick=()=>{if(missionEditor.dirty&&!confirm('Quitter sans enregistrer ?'))return;missionEditor=null;renderMissionPage(page);};
}
async function saveMissionDocument(){
 return workflowRun('mission',async()=>{
  const editor=missionEditor,form=document.getElementById('workflowMissionForm');if(!editor||!form)return false;
  const details=Object.fromEntries(new FormData(form));
  const result=await workflowRpc('admin_save_mission',{p_reservation:editor.id,p_kind:missionKinds[editor.page].kind,p_details:details,p_revision:editor.revision});
  missionRows=missionRows.filter(x=>!(x.reservation_id===editor.id&&x.kind===result.kind));missionRows.push(result);
  editor.revision=result.revision;editor.dirty=false;
  document.getElementById('missionSaveState').textContent='Enregistré dans votre compte — ordinateur et téléphone.';
  return true;
 });
}
window.addEventListener('beforeunload',e=>{if(missionEditor?.dirty){e.preventDefault();e.returnValue='';}});

let paymentAttempt=null,reservationAttempt=null;
const originalAddPayment=addPayment;
addPayment=function(id){paymentAttempt=null;return originalAddPayment(id);};
savePaymentModal=async function(){return workflowRun('payment',async()=>{
 const amount=Number(document.getElementById('paymentAmount').value),method=document.getElementById('paymentMethod').value,id=paymentReservationId;
 if(!id||!Number.isFinite(amount)||amount<=0)throw new Error('Indiquez un montant positif.');
 const signature=JSON.stringify([id,amount,method]);
 if(paymentAttempt&&paymentAttempt.signature!==signature)throw new Error('Vérifiez d’abord le résultat du paiement précédent en actualisant les données.');
 paymentAttempt||={signature,id:crypto.randomUUID()};
 try{await workflowRpc('admin_record_payment',{p_reservation:id,p_amount:amount,p_method:method,p_id:paymentAttempt.id});}
 catch(error){if(error.code&&error.code!=='PGRST000')paymentAttempt=null;throw error;}
 paymentAttempt=null;closePaymentModal();const loaded=await loadData();
 alert(loaded?'Paiement enregistré.':'Paiement enregistré. Actualisez pour afficher le nouveau solde.');
});};
saveReservation=async function(){return workflowRun('reservation',async()=>{
 const payload={client_id:reservationClient.value,client_nom:clientName.value.trim(),telephone:clientPhone.value.trim(),adresse:clientAddress.value.trim(),type_evenement:eventType.value,date_evenement:eventDate.value,lieu:eventPlace.value.trim(),montant_total:Number(eventTotal.value),montant_paye:Number(eventPaid.value),statut:eventStatus.value,chaises:Number(eventChairs.value)||0,matelas:Number(eventMattresses.value)||0,notes:eventNotes.value.trim(),materiel_reserve:selectedReservationMaterials()};
 if(!payload.client_nom||!payload.date_evenement)throw new Error('Indiquez le client et la date.');
 if(!Number.isFinite(payload.montant_total)||!Number.isFinite(payload.montant_paye)||payload.montant_total<0||payload.montant_paye<0||payload.montant_paye>payload.montant_total)throw new Error('Vérifiez les montants de la réservation.');
 const signature=JSON.stringify(payload);
 if(reservationAttempt&&reservationAttempt.signature!==signature)throw new Error('Vérifiez d’abord si la réservation précédente a été enregistrée.');
 reservationAttempt||={signature,id:crypto.randomUUID()};
 try{await workflowRpc('admin_create_reservation',{p_data:payload,p_id:reservationAttempt.id});}
 catch(error){if(error.code&&error.code!=='PGRST000')reservationAttempt=null;throw error;}
 reservationAttempt=null;await loadData();show('reservations');alert('Réservation enregistrée.');
});};
cancelReservation=async function(id){if(!confirm('Annuler cette réservation ?'))return;return workflowRun(`reservation-${id}`,async()=>{
 await workflowRpc('admin_cancel_reservation',{p_reservation:id});await loadData();alert('Réservation annulée.');
});};
deleteReservation=async function(id){if(!confirm('Supprimer définitivement cette réservation et ses paiements ? Cette action est irréversible.'))return;return workflowRun(`reservation-${id}`,async()=>{
 // Existing foreign key cascades payments in the same database transaction.
 const result=await supabaseClient.from('reservations').delete().eq('id',id).select('id');
 if(result.error)throw result.error;if(!result.data?.length)throw new Error('Réservation introuvable ou accès refusé.');
 await loadData();show('reservations');alert('Réservation et paiements supprimés définitivement.');
});};

// Independent PDF instances: no automatic invoice stamp on other documents.
function workflowPdf(title){
 if(typeof BaseFAMproPdf!=='function')throw new Error('Le module PDF est indisponible. Réessayez avec une connexion Internet.');
 const pdf=new BaseFAMproPdf({unit:'mm',format:'a4'});
 const text=pdf.text.bind(pdf);
 pdf.text=(value,...args)=>text(Array.isArray(value)?value.map(invoicePdfText):invoicePdfText(String(value)),...args);
 let y=45;
 function header(){
  pdf.setFillColor(179,7,18);pdf.rect(0,0,210,32,'F');pdf.setTextColor(255,255,255);
  pdf.setFont('helvetica','bold');pdf.setFontSize(18);pdf.text('FAMpro Events',18,14);
  pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.text(title,18,23);
  pdf.setTextColor(35,36,40);y=45;
 }
 function space(height){if(y+height>267){pdf.addPage();header();}}
 function paragraph(value,{bold=false,size=10,indent=0}={}){
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
  const lines=pdf.splitTextToSize(invoicePdfText(String(value)),174-indent);
  for(const line of lines){space(6);pdf.text(line,18+indent,y);y+=5;}
  y+=3;
 }
 function heading(value){space(20);paragraph(value,{bold:true,size:12});}
 function signatures(labels){space(26);y+=15;labels.forEach((label,index)=>{const x=18+index*95;pdf.setDrawColor(140);pdf.line(x,y,x+75,y);pdf.setFontSize(8);pdf.text(label,x,y+5);});y+=12;}
 function finish(fileName){
  const count=pdf.getNumberOfPages();for(let p=1;p<=count;p++){
   pdf.setPage(p);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(100);
   pdf.text('Nous créons, vous célébrez.',18,285);pdf.text(`${p} / ${count}`,192,285,{align:'right'});
  }
  pdf.save(fileName);
 }
 header();return {pdf,paragraph,heading,signatures,finish,space};
}
function downloadWorkflowPdf(page,r,details){
 try{
  const config=missionKinds[page],doc=workflowPdf(config.single.toUpperCase());
  const client=data.clients.find(c=>c.id===r.client_id)||{};
  doc.paragraph(`Référence : FAM-${config.kind==='route'?'FR':'OM'}-${r.id}`);
  doc.heading('Client et événement');
  for(const [label,value] of [['Client',name(r)],['Téléphone',client.telephone||r.client_telephone||'Non renseigné'],['Événement',r.type_evenement],['Date',r.date_evenement],['Lieu',r.lieu]])doc.paragraph(`${label} : ${value||'À préciser'}`);
  doc.heading('Organisation');
  for(const [label,key] of [['Responsable','responsable'],['Équipe','equipe'],['Véhicule','vehicule'],['Départ','depart'],['Statut','statut']])doc.paragraph(`${label} : ${details[key]||'À préciser'}`);
  if(config.kind==='route'){
   doc.heading('Matériel à préparer');
   const items=invoiceMaterialItems(r);
   if(!items.length)doc.paragraph('Aucun matériel renseigné.');
   items.forEach(item=>doc.paragraph(`[  ] ${item.nom} — Quantité : ${item.quantite}`));
   doc.space(80);doc.heading('Contrôle opérationnel');
   ['Chargement vérifié','Livraison effectuée','Installation terminée','Retour du matériel confirmé'].forEach(s=>doc.paragraph('[  ] '+s));
  }else{
   doc.heading('Objet de la mission');doc.paragraph(`Préparer et assurer ${r.type_evenement||'l’événement'} de ${name(r)}.`);
   doc.heading('Consignes');
   ['Respecter les horaires et prévenir le responsable en cas de retard.','Vérifier le matériel au départ et au retour.','Signaler tout incident au responsable FAMpro.'].forEach(s=>doc.paragraph(s));
  }
  doc.signatures(config.kind==='route'?['Responsable','Client / réception']:['Direction','Employé']);
  doc.finish(`FAMpro-${config.kind==='route'?'Feuille-de-route':'Ordre-de-mission'}-${r.id}.pdf`);
 }catch(error){alert(error.message);}
}

exportAdminReportPdf=function(){
 try{
  const doc=workflowPdf('RAPPORT DES RÉSERVATIONS');
  const list=data.reservations.filter(isActiveReservation);
  doc.paragraph(`Exporté le ${new Date().toLocaleDateString('fr-FR')} — ${list.length} réservation(s)`);
  for(const r of list){
   const client=data.clients.find(c=>c.id===r.client_id)||{};
   doc.heading(name(r));
   doc.paragraph(`${r.type_evenement||'Événement'} · ${r.date_evenement||'Sans date'} · ${status(r)}`);
   doc.paragraph(`Téléphone : ${client.telephone||'Non renseigné'} — Lieu : ${r.lieu||'Non renseigné'}`);
   doc.paragraph(`Total : ${fmt(total(r))} FCFA | Payé : ${fmt(paid(r))} FCFA | Reste : ${fmt(due(r))} FCFA`);
  }
  doc.heading('Totaux');
  for(const [label,fn] of [['Montant total',total],['Déjà payé',paid],['Reste à payer',due]])doc.paragraph(`${label} : ${fmt(list.reduce((sum,r)=>sum+fn(r),0))} FCFA`,{bold:true});
  doc.finish(`FAMpro-rapport-${new Date().toISOString().slice(0,10)}.pdf`);
 }catch(error){alert(error.message);}
};
reportPdfButton.onclick=exportAdminReportPdf;
// Boot once, only after every screen and handler has been registered.
loadData();
