export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screaming Chicken Weekend</title>
<style>
body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;background:#0d0b1f;color:#f3eefc}
h1{font-size:1.8rem;margin:.2em 0;color:#ff4fa3;text-shadow:2px 2px #3ad1ff}
input,button{font:inherit;padding:8px;border-radius:6px;border:1px solid #555;margin:3px 0}
button{background:#ff4fa3;color:#fff;border:0;cursor:pointer}
.row{display:flex;gap:6px;flex-wrap:wrap}.row input{flex:1;min-width:160px}
.days{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px}
.day{background:#1b1740;border-radius:10px;padding:10px}.day h2{margin:0 0 6px;color:#3ad1ff;font-size:1.1rem}
.item{border-top:1px solid #333;padding:6px 0}.tag{font-size:.75rem;background:#333;border-radius:4px;padding:1px 5px;margin-right:4px}
.why{font-size:.85rem;color:#c9c1e8}.rcpt{font-size:.78rem;color:#9ad}.rcpt a{color:#9ad}
footer{margin-top:24px;font-size:.78rem;color:#9a93b8;border-top:1px solid #333;padding-top:8px}footer a{color:#9ad}
#hold{display:none;background:#402;padding:10px;border-radius:8px}#summary{font-style:italic;margin-top:10px}
</style></head><body>
<h1>Screaming Chicken's Weekend Main Event</h1>
<p>Name a few things you love. We'll book your Friday through Sunday: watch, eat, hear, visit, with receipts on every pick. Taste by Qloo.</p>
<form id="f"><div class="row"><input class="seed" placeholder="A movie you love" required><input class="seed" placeholder="An artist you love"><input class="seed" placeholder="A place you love"></div>
<div class="row"><input id="city" placeholder="City or ZIP" required><button>Plan my weekend</button></div></form>
<div id="hold">Catching our breath, try again in a minute. <button id="retry" type="button">Retry</button></div>
<div id="picks"></div><div id="msg"></div><div id="summary"></div><div class="days" id="days"></div>
<script>
const $=s=>document.querySelector(s), picks={};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=u=>/^https:\\/\\//.test(u)?u:'#';
let run=0;
async function call(path,body){let r,b;try{r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});b=await r.json();}catch{b={message:'Network hiccup. Try again.'};r={status:0}}return{r,b}}
async function go(){
  const me=++run;
  $('#hold').style.display='none';$('#msg').textContent='Lacing up...';$('#days').innerHTML='';$('#summary').textContent='';
  const seeds=[...document.querySelectorAll('.seed')].map(i=>i.value.trim()).filter(Boolean);
  const body={seeds,city:$('#city').value,picks};
  // Step 1: fast plan (events + city venues). Step 2: personalized Qloo picks fill in.
  const pp=call('/api/picks',body);const f=await call('/api/plan?stage=fast',body);if(me!==run)return;
  if(f.r.status===429){$('#msg').textContent='';$('#hold').style.display='block';return}
  if(f.r.ok&&f.b.days){render(f.b);$('#msg').textContent='Tuning to your taste...'}
  const {r,b}=await pp;if(me!==run)return;
  $('#msg').textContent='';
  if(r.status===429){if(!f.b.days)$('#hold').style.display='block';else $('#msg').textContent='Taste picks are catching their breath. Try again in a minute.';return}
  if(!r.ok){$('#msg').textContent=b.message||b.error||'Something went sideways.';return}
  if(b.needsPick){$('#picks').innerHTML=b.needsPick.map(n=>'<p>Which <b>'+esc(n.seed)+'</b>? '+n.options.map(o=>'<button type="button" data-s="'+esc(n.seed)+'" data-id="'+esc(o.entity_id)+'">'+esc(o.name)+(o.year?' ('+esc(o.year)+')':'')+' · '+esc(o.type)+'</button>').join(' ')+'</p>').join('');
    document.querySelectorAll('#picks button').forEach(x=>x.onclick=()=>{picks[x.dataset.s]=x.dataset.id;$('#picks').innerHTML='';go()});return}
  render(b);
  if(b.degraded)$('#msg').textContent=b.degraded==='fast'?'Taste engine is slow right now; showing city favorites.':'Taste engine is slow right now, so here are city favorites. Hit Plan my weekend again in a minute to tune it.';
}
function render(b){
  $('#summary').textContent=b.summary+(b.events==='ok'||b.events==='mock'?'':' (Live events are taking a breather; taste picks still stand.)');
  const names={fri:'Friday',sat:'Saturday',sun:'Sunday'};
  $('#days').innerHTML=Object.entries(b.days).map(([d,items])=>'<div class="day"><h2>'+names[d]+' '+esc(b.weekend[d])+'</h2>'+items.map(i=>
    '<div class="item"><span class="tag">'+esc(i.kind==='event'?'event':i.slot+' · '+i.type)+'</span>'+(i.label?'<span class="tag">'+esc(i.label)+'</span>':'')+'<b>'+esc(i.name)+'</b>'+
    '<div class="why">'+esc(i.reason)+'</div>'+
    (i.source?'<div class="rcpt">Source: <a href="'+esc(safe(i.source.url))+'" target="_blank" rel="noopener">'+esc(i.source.name)+'</a> · '+esc(i.date)+'</div>':'')+(i.showtimes&&i.showtimes.length>1?'<div class="rcpt">Showtimes: '+i.showtimes.map(t=>'<a href="'+esc(safe(t.url))+'" target="_blank" rel="noopener">'+esc(t.date+(t.time?' '+t.time.slice(0,5):''))+'</a>').join(' · ')+'</div>':'')+
    (i.notes||[]).map(v=>'<div class="rcpt">Venue note: '+esc(v.text)+' · <a href="'+esc(safe(v.source.url))+'" target="_blank" rel="noopener">'+esc(v.source.name)+'</a> · '+esc(v.date)+'</div>').join('')+
    '</div>').join('')+'</div>').join('');
}
$('#f').onsubmit=e=>{e.preventDefault();go()};$('#retry').onclick=go;
</script>
<footer>
<p><b>Privacy:</b> we only use the things you type and your city or ZIP to build this plan. We don't ask for your name, email or exact location, we don't set tracking cookies, and we don't sell anything. Your words are cleaned of emails, phone numbers and handles before they reach Qloo, Ticketmaster or OpenStreetMap. Event results are cached for a few minutes only.</p>
<p>Taste by <a href="https://www.qloo.com/" target="_blank" rel="noopener">Qloo</a>. Event data by <a href="https://www.ticketmaster.com/" target="_blank" rel="noopener">Ticketmaster</a>; tickets are sold on each event's own Ticketmaster page. Venue notes: map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>.</p>
</footer></body></html>`;
