export const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Screaming Chicken</title></head>
<body><h1>Screaming Chicken</h1><p>Taste picks from Qloo, phrased by SI. Every claim shows its proof.</p>
<form id="f"><input id="q" placeholder="Something you love" required><button>Go</button></form>
<pre id="out"></pre>
<script>
document.getElementById('f').onsubmit = async (e) => { e.preventDefault();
  const r = await fetch('/api/recommend', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({query: document.getElementById('q').value})});
  document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2); };
</script></body></html>`;
