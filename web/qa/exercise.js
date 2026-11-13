// Browser assertions injected only by the localhost QA harness with ?exercise=1.
const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for UI');};
const assert=(c,m)=>{if(!c)throw Error(m);};const results=[];
try{
 await wait(()=>document.querySelector('#file'));
 const response=await fetch('/api/incidents/fixture/bundle');const file=new File([await response.blob()],'qa.grimreplay',{type:'application/octet-stream'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('#file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>document.querySelector('#stage canvas'));results.push('local file import renders WebGL');
 document.querySelector('#next').click();assert(document.querySelector('#tick').textContent==='Tick 1','Next tick');document.querySelector('#prev').click();assert(document.querySelector('#tick').textContent==='Tick 0','Previous tick');results.push('tick stepping');
 const slider=document.querySelector('#timeline');slider.value='60';slider.dispatchEvent(new Event('input'));assert(document.querySelector('#tick').textContent==='Tick 60','Seek60');slider.value='0';slider.dispatchEvent(new Event('input'));assert(document.querySelector('#tick').textContent==='Tick 0','Rewind');results.push('timeline forward and rewind');
 document.querySelector('[data-flag]').click();assert(document.querySelector('#tick').textContent==='Tick 50','Flag seek');results.push('flag seeking');
 document.querySelector('#camera').click();assert(document.querySelector('#camera').getAttribute('aria-pressed')==='true','Follow');document.querySelector('#reset').click();results.push('follow camera and reset');
 document.querySelector('#play').click();await new Promise(r=>setTimeout(r,400));document.querySelector('#play').click();assert(Number(document.querySelector('#timeline').value)>50,'Playback');results.push('play and pause');
 assert(!document.querySelector('#delete'),'Local replay should not be deletable');results.push('local replay has no remote delete');
 await fetch('/qa-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:true,results})});
}catch(e){await fetch('/qa-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:false,error:e.message,results})});}
