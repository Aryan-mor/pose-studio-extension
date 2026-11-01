export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root { position: fixed; inset: 0; z-index: 2147483647; display: none; flex-direction: column;
  font: 14px/1.4 -apple-system, "Segoe UI", Inter, system-ui, sans-serif;
  --bg:#fff; --fg:#18181b; --muted:#71717a; --line:#e4e4e7; --card:#f4f4f5; --accent:#7c3aed; --accent-fg:#fff;
  background: var(--bg); color: var(--fg); }
.root.dark { --bg:#0f0f12; --fg:#f4f4f5; --muted:#a1a1aa; --line:#27272a; --card:#18181b; --accent:#8b5cf6; }
.root.open { display: flex; }
header { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--line); }
header h1 { font-size:16px; margin:0; font-weight:650; }
header .pill { font-size:12px; color:var(--muted); border:1px solid var(--line); border-radius:99px; padding:2px 10px; }
header .sp { flex:1; }
header .credit { font-size:12px; color:var(--muted); text-decoration:none; }
header .credit:hover { color:var(--accent); }
button { font: inherit; color: inherit; cursor: pointer; }
.icon-btn { background:none; border:1px solid var(--line); border-radius:8px; width:32px; height:32px; font-size:18px; line-height:1; }
.icon-btn:hover { background: var(--card); }
.slots { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:10px; padding:12px 16px; border-bottom:1px solid var(--line); }
.slot { display:flex; gap:10px; align-items:center; padding:8px; border:2px solid var(--line); border-radius:12px; background:var(--card); cursor:pointer; min-width:0; }
.slot.active { border-color: var(--accent); }
.slot .thumb { width:56px; height:72px; border-radius:8px; background:var(--line) center/cover no-repeat; flex:none; display:grid; place-items:center; color:var(--muted); font-size:22px; }
.slot .meta { min-width:0; flex:1; }
.slot .label { font-weight:600; }
.slot .name { color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.slot .acts { display:flex; gap:6px; margin-top:6px; }
.slot .acts button { font-size:12px; padding:2px 8px; border:1px solid var(--line); background:var(--bg); border-radius:6px; }
.slot .acts button:hover { border-color: var(--accent); }
.filters { display:flex; flex-wrap:wrap; gap:8px; padding:10px 16px; }
.filters input, .filters select, textarea, .bar select { font:inherit; color:inherit; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:6px 10px; }
.filters input { flex:1; min-width:160px; }
.count { color:var(--muted); align-self:center; font-size:12px; }
.grid-wrap { flex:1; overflow:auto; padding:0 16px 12px; }
.grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:10px; }
.card { position:relative; border:2px solid transparent; border-radius:10px; background:var(--card); padding:0; overflow:hidden; text-align:left; }
.card:hover { border-color: var(--line); }
.card.sel { border-color: var(--accent); }
.card img { display:block; width:100%; aspect-ratio:3/4; object-fit:cover; background:var(--line); }
.card .cap { display:block; padding:5px 7px; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.card.sel::after { content:"✓"; position:absolute; top:6px; right:6px; width:22px; height:22px; border-radius:50%; background:var(--accent); color:var(--accent-fg); display:grid; place-items:center; font-size:13px; }
.empty { color:var(--muted); padding:40px; text-align:center; }
.bar { border-top:1px solid var(--line); padding:10px 16px; display:grid; grid-template-columns: 1fr auto; gap:10px; background:var(--bg); }
.bar textarea { width:100%; height:92px; resize:vertical; font-size:12.5px; }
.bar .side { display:flex; flex-direction:column; gap:8px; min-width:230px; justify-content:space-between; }
.bar label.chk { display:flex; gap:6px; align-items:center; font-size:12.5px; color:var(--muted); }
.primary { background:var(--accent); color:var(--accent-fg); border:0; border-radius:10px; padding:10px 16px; font-weight:650; }
.primary:disabled { opacity:.5; cursor:not-allowed; }
.btn { font-size:12px; padding:5px 10px; border:1px solid var(--line); background:var(--card); border-radius:8px; }
.btn:hover { border-color: var(--accent); }
.card .x, .cardacts button { position:absolute; top:6px; right:6px; width:22px; height:22px; border-radius:50%; background:#000a; color:#fff; border:0; display:grid; place-items:center; font-size:12px; cursor:pointer; padding:0; }
.cardacts { position:absolute; top:0; right:0; left:0; pointer-events:none; }
.cardacts button { pointer-events:auto; right:34px; }
.cardacts button + button { right:6px; }
.busyscreen { display:none; position:absolute; inset:0; z-index:5; background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(4px); align-items:center; justify-content:center; }
.root.is-busy .busyscreen { display:flex; }
.busybox { display:flex; flex-direction:column; align-items:center; gap:16px; max-width:80vw; text-align:center; font-size:15px; }
.spinner { width:44px; height:44px; border-radius:50%; border:4px solid var(--line); border-top-color:var(--accent); animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.lightbox { display:none; position:absolute; inset:0; z-index:6; background:#000d; align-items:center; justify-content:center; cursor:zoom-out; }
.lightbox.show { display:flex; }
.lightbox img { max-width:94vw; max-height:94vh; border-radius:8px; }
.modalwrap { display:none; position:absolute; inset:0; z-index:7; background:#000a; align-items:center; justify-content:center; padding:16px; }
.modalwrap.show { display:flex; }
.modal { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:16px; padding:20px; width:min(560px, 100%); max-height:90vh; overflow:auto; box-shadow:0 20px 60px #0008; }
.modal h2 { margin:0 0 4px; font-size:17px; }
.modal .hint { margin:0 0 14px; color:var(--muted); font-size:13px; }
.photos { display:grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap:10px; margin-bottom:14px; }
.photo { position:relative; aspect-ratio:3/4; border-radius:10px; background:var(--card) center/cover no-repeat; border:1px solid var(--line); padding:0; }
.photo button { position:absolute; top:4px; right:4px; width:22px; height:22px; border-radius:50%; background:#000b; color:#fff; border:0; font-size:12px; padding:0; }
.photo.add { border:2px dashed var(--line); font-size:30px; color:var(--muted); }
.photo.add:hover { border-color:var(--accent); color:var(--accent); }
.modalbar { display:flex; align-items:center; gap:10px; }
.modalbar .sp { flex:1; }
.link { background:none; border:0; color:var(--accent); font-size:12px; padding:0; text-align:left; }
.toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:2147483647; display:none;
  background:#18181b; color:#fff; padding:10px 16px; border-radius:10px; font:14px system-ui,sans-serif; box-shadow:0 6px 24px #0006; max-width:80vw; }
.toast.show { display:block; }
.toast.err { background:#b91c1c; }
@media (max-width: 720px) {
  .slots { grid-template-columns: 1fr; }
  .slot .thumb { width:40px; height:50px; }
  .bar { grid-template-columns: 1fr; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
}
`
