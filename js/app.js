/* ============================================================================
 * app.js —— 应用主逻辑：状态 / 三视图 / 播放 / 交互 / 指标
 * ========================================================================== */

const LS_KEY = "b2-sim-v1";
let S = JSON.parse(JSON.stringify(DEFAULT_STATE));
S.t = 0.35;                 // 当前时段内的进度 0..1
let playing = false, lastTs = 0;

/* ── 存取 ─────────────────────────────────────────────────────────── */
function saveStore() {
  if (S.readonly) return;
  const p = {}; PARAMS.forEach(x => p[x.key] = x.value);
  localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, params: p, floors: FLOORS }));
}
function loadStore() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (!j) return false;
    if (j.params) PARAMS.forEach(x => { if (j.params[x.key] != null) x.value = j.params[x.key]; });
    if (j.floors) Object.keys(FLOORS).forEach(f => { if (j.floors[f]) FLOORS[f] = j.floors[f]; });
    return true;
  } catch (e) { return false; }
}
function resetStore() { localStorage.removeItem(LS_KEY); location.reload(); }

function getParam(k) { const p = PARAMS.find(x => x.key === k); return p ? p.value : 0; }
function applyBinds() {
  PARAMS.forEach(p => {
    if (!p.bind) return;
    const [kind, field] = p.bind.split(".");
    if (ROBOT_KIND[kind]) ROBOT_KIND[kind][field] = p.value;
  });
}

/* ── 小工具 ───────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function slot(id) { return SLOTS.find(s => s.id === id) || SLOTS[0]; }
function toast(msg, ms) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms || 2200);
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function fmtClock() {
  const s = slot(S.slot);
  const [h1, m1] = s.start.split(":").map(Number), [h2, m2] = s.end.split(":").map(Number);
  const a = h1 * 60 + m1, b = h2 * 60 + m2, cur = a + (b - a) * S.t;
  const hh = Math.floor(cur / 60) % 24, mm = Math.floor(cur % 60);
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

/* ── 指标（PRD §4.5） ─────────────────────────────────────────────── */
function sevWeight(sev) {
  return sev === "high" ? getParam("wHigh") : sev === "mid" ? getParam("wMid") : getParam("wLow");
}
function conflictIndex(sid, variant, floorId) {
  let sum = 0;
  (floorId ? [floorId] : ["1F", "2F"]).forEach(f => {
    (FLOORS[f].conflicts[variant] || []).forEach(c => { if (c.slots.indexOf(sid) >= 0) sum += sevWeight(c.sev); });
  });
  return sum / slot(sid).dur;
}
function conflictsOf(floorId, variant, sid) {
  return (FLOORS[floorId].conflicts[variant] || []).filter(c => c.slots.indexOf(sid) >= 0);
}
function robotsOf(floorId, variant, sid) {
  return (FLOORS[floorId].robots[variant] || []).filter(r => r.slots.indexOf(sid) >= 0);
}
function delta(a, b) {
  if (a == null || b == null || a === 0) return null;
  return (b - a) / a;
}
function sign(x, invert) {
  if (x == null) return "—";
  const good = invert ? x < 0 : x > 0;
  return `<span class="delta ${good ? "down" : "up"}">${x > 0 ? "+" : ""}${(x * 100).toFixed(0)}%</span>`;
}

/* ══════════════════════════════════════════════════════════════════════
   顶栏
   ══════════════════════════════════════════════════════════════════════ */
function renderTop() {
  const fl = ["1F", "2F"].map(f => `<button class="sg ${S.floor === f ? "on" : ""}" data-act="floor" data-v="${f}">${f}</button>`).join("");
  const pills = SLOTS.map(s => `<button class="pill ${S.slot === s.id ? "on" : ""}" data-act="slot" data-v="${s.id}"
    title="${s.name} ${s.en} · ${s.start}–${s.end}"><b>${s.id}</b><span>${s.name}</span></button>`).join("");
  const vs = [["A", "现状 A"], ["B", "提案 B"]].map(([v, t]) =>
    `<button class="sg ${S.variant === v ? "on" : ""}" data-act="variant" data-v="${v}">${t}</button>`).join("");
  const vw = [["browse", "浏览"], ["timeline", "时间线"], ["compare", "对比"]].map(([v, t]) =>
    `<button class="sg ${S.view === v ? "on" : ""}" data-act="view" data-v="${v}">${t}</button>`).join("");

  const menu = S.more ? `<div class="menu">
      <button data-act="proj">${S.proj ? "✓ " : ""}投影模式（字号 +15%）</button>
      <button data-act="left">${S.leftOpen ? "✓ " : ""}显示左栏</button>
      <button data-act="right">${S.rightOpen ? "✓ " : ""}显示右栏</button>
      <hr>
      <button data-act="export">导出 JSON（含全部编辑）</button>
      <button data-act="import">导入 JSON</button>
      <button data-act="reset" style="color:#D64545">恢复默认数据</button>
      <hr>
      <button data-act="intro">新手引导（3 步）</button>
      <button data-act="help">使用说明 / 数据来源</button>
    </div>` : "";

  $("top").innerHTML = `
  <div class="brand"><span class="dot"></span>2 号楼人机共生模拟器 <em>Building 2 · Human–Robot Simulator</em></div>
  <div class="segs">
    <div class="seg"><span class="lb">楼层</span>${fl}</div>
    <div class="pills">${pills}</div>
    <div class="seg"><span class="lb">方案</span>${vs}</div>
    <div class="seg"><span class="lb">视图</span>${vw}</div>
  </div>
  <div class="acts">
    <span class="badge-sim" title="V1 为离线情景模拟器：所有位置与人数均为模拟值，不接真实机器人数据">模拟值</span>
    <button class="btn ${S.edit ? "on" : ""}" data-act="edit">编辑</button>
    <button class="btn ${S.drawer ? "on" : ""}" data-act="drawer">参数</button>
    <div class="morewrap"><button class="btn ${S.more ? "on" : ""}" data-act="more">⋯</button>${menu}</div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   左栏
   ══════════════════════════════════════════════════════════════════════ */
function renderLeft() {
  const kinds = Object.keys(ROBOT_KIND).map(k => {
    const K = ROBOT_KIND[k];
    return `<button class="sw ${S.kinds[k] ? "on" : ""}" data-act="kind" data-v="${k}">
      <span class="gly" style="color:${K.col}">${K.glyph}</span>
      <span class="nm">${K.name} <em>${K.en} · ${K.fid}</em></span>
      <span class="tg ${S.kinds[k] ? "tg-on" : ""}"></span></button>`;
  }).join("");

  const LAY = [["flow", "人流热度与方向"], ["research", "研究层 · 路线（示意）/ 候停点"], ["conflicts", "冲突点"],
               ["doors", "门（待确认）"], ["docks", "候停 / 停靠点"], ["zones", "分区标注"], ["proposal", "提案元素（B）"]];
  const lays = LAY.map(([k, t]) => `<button class="sw ${S.layers[k] ? "on" : ""}" data-act="layer" data-v="${k}">
      <span class="nm">${t}</span><span class="tg ${S.layers[k] ? "tg-on" : ""}"></span></button>`).join("");

  const rules = RULES.map(r => `<li><b>${r[0]}</b><span>${esc(r[1])}</span></li>`).join("");

  $("left").innerHTML = `
  <div class="sec-h">机器人四类开关 <em>Robot layers · 保真度已标注</em></div>${kinds}
  <div class="sec-h" style="margin-top:6px">底图 <em>Base map · 可随时切换</em></div>
  <button class="sw ${S.basemap === "simple" ? "on" : ""}" data-act="basemap" data-v="simple">
    <span class="nm">简化示意 · 墙/柱/门窗</span><span class="tg ${S.basemap === "simple" ? "tg-on" : ""}"></span></button>
  <button class="sw ${S.basemap === "cad" ? "on" : ""}" data-act="basemap" data-v="cad">
    <span class="nm">CAD 原图 · 含尺寸线</span><span class="tg ${S.basemap === "cad" ? "tg-on" : ""}"></span></button>
  <div class="sec-h" style="margin-top:6px">图层开关 <em>Map layers</em></div>${lays}
  <div class="sec-h" style="margin-top:6px">通行规则速查 <em>Hard rules · PRD §7.1</em></div>
  <ul class="rules">${rules}</ul>
  <div class="note">底图来自「Y1 to Y3 Floor Plan 20260821」Building 2 CAD。
    CAD 门位可辨、净宽不可辨 → 全部门标「待确认」，通行判定待实测门表。</div>
  <div class="note" style="color:#1D5C7A">简化底图来自 3D 模型 1.2m 水平剖面，已配准到 CAD 坐标系，
    只保留墙 / 柱 / 门窗；<b>室内隔墙较 CAD 有所合并，属示意</b>。精确位置判定请切「CAD 原图」。</div>
  <div class="note" style="color:#8A5A12">机器人路线已按「尽量避开墙体」重算，但仍是<b>示意</b>：
    PRD §10.1 的走廊中心线路网尚未建立，不能当作真实可通行路径引用。</div>
  ${S.edit ? `<div class="note" style="color:#1D5C7A;background:#EAF2F6;border-color:#C9DEE9">
    编辑模式已开启：可直接拖动机器人 / 冲突点 / 候停点；点对象后在右栏改属性。</div>` : ""}`;
}

/* ══════════════════════════════════════════════════════════════════════
   地图
   ══════════════════════════════════════════════════════════════════════ */
function mapOverlays(floorId, variant) {
  const lg = [
    ["人流热度", `<i style="border-top-color:${C.flow};opacity:.55"></i>`],
    ["配送 ▣", `<i style="border-top-color:${C.entrance}"></i>`],
    ["清洁 ◇", `<i style="border-top-color:${C.clean};border-top-style:dotted"></i>`],
    ["安保 ▲", `<i style="border-top-color:${C.sec};border-top-style:dashed"></i>`],
    ["导览 ●", `<i style="border-top-color:${C.guide};border-top-style:dashdot"></i>`],
    ["冲突 高", `<u style="background:${C.high}"></u>`],
    ["中", `<u style="background:${C.mid}"></u>`],
    ["低", `<u style="border:2px solid ${C.low}"></u>`],
    ["待确认", `<u style="background:repeating-linear-gradient(45deg,${C.tbc} 0 2px,#fff 2px 4px)"></u>`],
    ["提案 PROPOSED", `<i style="border-top-color:${C.sec};border-top-style:dashed"></i>`],
    ["⚠ 机器人路线＝示意", `<u style="background:#FDF3E3;border:1px solid #F0DCB8"></u>`]
  ].map(x => `<span class="lg">${x[1]}${x[0]}</span>`).join("");

  const sl = slot(S.slot);
  const chips = [`<span class="chip"><b>${S.floor}</b> ${esc(FLOORS[S.floor].name)}</span>`,
                 `<span class="chip"><b>${sl.id}</b> ${sl.name} · ${sl.start}–${sl.end}</span>`,
                 `<span class="chip"><b>${S.variant}</b> ${S.variant === "A" ? "现状基线" : "提案"}</span>`,
                 `<span class="chip"><b>底图</b> ${S.basemap === "simple" ? "简化示意" : "CAD 原图"}</span>`].join("");

  const z = Math.round(S.zoom * 100);
  return `<div class="maptag">${chips}</div>
  <div class="zoombar">
    <button data-act="zoom" data-v="out" title="缩小">−</button>
    <span title="当前缩放">${z}%</span>
    <button data-act="zoom" data-v="in" title="放大（放大后可滚动查看）">＋</button>
    <button data-act="zoom" data-v="fit" title="恢复适应窗口">适应</button>
  </div>
  <div class="tbc">? CAD 门位可辨、净宽不可辨 → 全部门标「待确认」；比例 / 指北待校准
    <br>⚠ 机器人路线为<b>示意</b>，尚未接入走廊中心线路网，不代表真实可通行路径</div>
  <div class="legend">${lg}</div>
  <div class="scale"><span>比例 待校准</span><div class="compass"><b>N</b></div></div>
  ${S.edit ? editBar() : ""}`;
}

function renderMap() {
  const host = $("mapbox");
  host.style.width = (S.zoom * 100) + "%";
  host.style.height = (S.zoom * 100) + "%";
  const sl = slot(S.slot);
  host.innerHTML = planSVG(S.floor, S.variant, {
    layers: S.layers, kinds: S.kinds, slot: S.slot, heatK: sl.k, edit: S.edit, detail: true
  });
  const ovl = $("ovl"); if (ovl) ovl.innerHTML = mapOverlays(S.floor, S.variant);
  const svg = host.querySelector("svg");
  applyFocus(svg);
  positionRobots(svg, S.floor, S.variant, S.slot, S.t);
}

function positionRobots(svg, floorId, variant, sid, t) {
  if (!svg) return;
  const sl = slot(sid);
  robotsOf(floorId, variant, sid).forEach(rob => {
    const body = svg.querySelector(`.rbody[data-id="${rob.id}"]`);
    if (!body) return;
    const path = svg.querySelector(`#rp-${floorId}-${variant}-${rob.id}`);
    let x = 120, y = 120, deg = 0;
    if (path && path.getTotalLength) {
      const L = path.getTotalLength();
      if (L > 0) {
        const laps = Math.max(1, Math.round(sl.dur / ROBOT_KIND[rob.kind].task));
        const p = ((t * laps) % 1 + 1) % 1;
        const a = path.getPointAtLength(p * L);
        const b = path.getPointAtLength(Math.min(L, p * L + 3));
        deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        x = a.x; y = a.y;
      }
    }
    if (rob.off) { x += rob.off.x; y += rob.off.y; }
    body.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    const rot = body.querySelector(".rot");
    if (rot) rot.setAttribute("transform", `rotate(${deg.toFixed(1)})`);
  });
}

function applyFocus(svg) {
  if (!svg) return;
  svg.querySelectorAll(".obj").forEach(e => e.classList.remove("dim"));
  svg.querySelectorAll(".route").forEach(e => { e.classList.remove("dim"); e.setAttribute("stroke-width", "4"); });
  if (!S.sel) return;
  const sel = S.sel;
  if (sel.type !== "robot" && sel.type !== "conflict") return;
  svg.querySelectorAll(".obj").forEach(e => {
    let keep = false;
    if (sel.type === "robot") keep = (e.dataset.obj === "robot" && e.dataset.id === sel.id);
    if (sel.type === "conflict") keep = (e.dataset.obj === "conflict" && e.dataset.n === sel.n);
    if (sel.type === "door") keep = (e.dataset.obj === "door" && e.dataset.id === sel.id);
    if (sel.type === "dock") keep = (e.dataset.obj === "dock" && String(e.dataset.i) === String(sel.i));
    if (!keep) e.classList.add("dim");
  });
  if (sel.type === "robot") {
    svg.querySelectorAll(".route").forEach(e => {
      if (e.dataset.id === sel.id) e.setAttribute("stroke-width", "7");
      else e.classList.add("dim");
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   右栏
   ══════════════════════════════════════════════════════════════════════ */
function renderRight() {
  const sl = slot(S.slot), F = FLOORS[S.floor];
  let html = "";

  if (S.sel && S.sel.type === "robot") html += cardRobot(S.sel.id);
  else if (S.sel && S.sel.type === "conflict") html += cardConflict(S.sel.n);
  else if (S.sel && S.sel.type === "door") html += cardDoor(S.sel.id);
  else if (S.sel && S.sel.type === "dock") html += cardDock(S.sel.i);
  else if (S.sel && S.sel.type === "pov") html += cardPov(S.sel.id);
  else {
    html += cardSlot(sl);
    html += cardConflictList();
  }
  html += cardPovPanel();
  if (S.sel) html += `<button class="btn" style="width:100%" data-act="clear">清除选择</button>`;
  $("right").innerHTML = html;
}

function cardSlot(sl) {
  const cfs = conflictsOf(S.floor, S.variant, S.slot);
  const hi = cfs.filter(c => c.sev === "high");
  const idx = conflictIndex(S.slot, S.variant);
  const hot = hi.length ? hi.map(c => c.where).join("、") : "无高风险点";
  return `<div class="card">
    <div class="ch">当前时段 <span class="tag">${sl.id} · ${sl.start}–${sl.end}</span></div>
    <div class="kv"><span class="k">时段</span><span class="v"><b>${sl.name}</b> ${sl.en} · ${sl.dur} min</span></div>
    <div class="kv"><span class="k">人流特征</span><span class="v">${esc(sl.flow)}</span></div>
    <div class="kv"><span class="k">机器人主线</span><span class="v">${esc(sl.robot)}</span></div>
    <div class="kv"><span class="k">高风险点</span><span class="v">${hi.length} 处 · ${esc(hot)}</span></div>
    <div class="kv"><span class="k">冲突指数</span><span class="v">${idx.toFixed(2)} <span style="color:#8A9AA5">双层合计 · 模拟</span></span></div>
  </div>`;
}

function cardConflictList() {
  const cfs = conflictsOf(S.floor, S.variant, S.slot);
  const rows = cfs.length ? cfs.map(c => {
    const S2 = SEV[c.sev];
    return `<button class="crow" data-act="pick-conflict" data-v="${c.n}">
      <span class="no" style="background:${S2.col}">${c.n}</span>
      <span class="tp">${c.type} · ${esc(c.where)}</span>
      <span class="sv sev-${c.sev}">${S2.name}</span></button>`;
  }).join("") : `<div class="txt" style="padding:6px 0">本时段本层无冲突点。</div>`;
  return `<div class="card">
    <div class="ch">冲突清单 <span class="tag">${cfs.length} 处 · ${S.floor} · ${S.variant}</span></div>
    ${rows}
    ${S.variant === "A" && S.floor === "2F" ? `<div class="warn" style="margin-top:8px">
      现状 A：楼内只有主楼梯与两部人用电梯，没有机器人专用竖向通道 → 机器人活动范围 = 1F。
      这不是显示异常，是结论。</div>` : ""}
  </div>`;
}

function cardRobot(id) {
  const rob = (FLOORS[S.floor].robots[S.variant] || []).find(r => r.id === id);
  if (!rob) return "";
  const K = ROBOT_KIND[rob.kind];
  const states = ["待机", "任务中", "巡游中", "避让", "充电", "故障"];
  const st = states.map(s => `<span class="chip2 ${rob.state === s ? "on" : ""}" ${S.edit ? `data-act="set-state" data-v="${s}"` : ""}>${s}</span>`).join("");
  return `<div class="card">
    <div class="ch"><span style="color:${K.col}">${K.glyph}</span> ${rob.id} · ${K.name}
      <span class="tag">${K.fid}</span></div>
    <div class="kv"><span class="k">类型</span><span class="v">${K.name} ${K.en} · 保真度 ${K.fid}</span></div>
    <div class="kv"><span class="k">状态</span><span class="v">${esc(rob.state)}</span></div>
    <div class="kv"><span class="k">速度 / 尺寸</span><span class="v">${K.speed} m/s · 宽 ${K.width} m <span style="color:#8A9AA5">假设</span></span></div>
    <div class="kv"><span class="k">任务时长</span><span class="v">${K.task} min · 单程（假设）</span></div>
    <div class="kv"><span class="k">任务链</span><span class="v">${(rob.chain || []).join(" → ")}</span></div>
    <div class="kv"><span class="k">在场时段</span><span class="v">${rob.slots.join(" ")}</span></div>
    <div class="kv"><span class="k">路线</span><span class="v">示意路径 · <span style="color:#8A5A12">未接入走廊路网</span></span></div>
    ${S.edit ? `<div class="state">${st}</div>${robotForm(rob)}` : `<div class="state">${st}</div>`}
  </div>`;
}

function cardConflict(n) {
  const cf = (FLOORS[S.floor].conflicts[S.variant] || []).find(c => c.n === n);
  if (!cf) return "";
  const T = CONFLICT_TYPE[cf.type], S2 = SEV[cf.sev];
  const fix = (cf.fix || T.fix).map(f => `<div class="act">→ <b>${esc(f)}</b></div>`).join("");
  return `<div class="card hl">
    <div class="ch">${cf.n} ${T.name}
      <span class="sv sev-${cf.sev}" style="font-size:11px">${S2.name}严重度</span></div>
    <div class="kv"><span class="k">位置</span><span class="v">${esc(cf.where)} · (${cf.x}, ${cf.y})</span></div>
    <div class="kv"><span class="k">持续</span><span class="v">${cf.dur} s（阈值 ${getParam("conflictDur")} s）</span></div>
    <div class="kv"><span class="k">判定</span><span class="v">${esc(T.rule)}</span></div>
    <div class="kv"><span class="k">涉及</span><span class="v">${cf.slots.join(" ")}</span></div>
    <div class="warn" style="margin-top:8px"><b>原因</b>　${esc(cf.why)}</div>
    <div class="txt" style="margin-top:8px;font-weight:600">建议动作（可执行）</div>
    ${fix}
    ${S.edit ? conflictForm(cf) : ""}
  </div>`;
}

function cardDoor(id) {
  const dr = FLOORS[S.floor].doors.find(d => d.id === id);
  if (!dr) return "";
  const rows = doorTable(dr).map(r => `<div class="kv"><span class="k" style="color:${r.ok ? "#2E7D5B" : C.high}">
    ${r.glyph} ${r.name}</span><span class="v">${r.ok ? "可通行 · " : "不可通行 · "}${esc(r.why)}</span></div>`).join("");
  return `<div class="card doorcard">
    <div class="ch">门 ${dr.id} <span class="tag">${esc(dr.type)}</span></div>
    <div class="kv"><span class="k">连接</span><span class="v">${esc(dr.between)}</span></div>
    <div class="kv"><span class="k">净宽</span><span class="v">${dr.w ? dr.w + " m" : "—"} <span style="color:#8A9AA5">${esc(dr.conf)}</span></span></div>
    <div class="kv"><span class="k">常闭</span><span class="v">${dr.closed ? "是" : "否"}</span></div>
    ${rows}
    <div class="no">? 门位 / 净宽未实测 → 通行判定仅供参考。
      判定式：净宽 − 2×${getParam("clearance")}m &lt; 机器人宽度 → 不可通行（PRD §7.1 S2）</div>
    ${S.edit ? doorForm(dr) : ""}
  </div>`;
}

function cardDock(i) {
  const dk = FLOORS[S.floor].docks[i];
  if (!dk) return "";
  const chk = checkDock(S.floor, dk.x, dk.y, i);
  return `<div class="card">
    <div class="ch">候停 / 停靠点 <span class="tag">${esc(dk.name || "W" + (i + 1))}</span></div>
    <div class="kv"><span class="k">坐标</span><span class="v">${dk.x}, ${dk.y}</span></div>
    <div class="${chk.ok ? "ok" : "err"}">${chk.msg}</div>
    ${S.edit ? dockForm(dk, i) : ""}
  </div>`;
}

function cardPov(id) {
  const p = POVS.find(x => x.id === id);
  if (!p) return "";
  return `<div class="card">
    <div class="ch">POV 视点 <span class="tag">${p.id} · 固定视点</span></div>
    <div class="pov">${povSVG(p, 272)}
      <div class="cap">${p.id} ${esc(p.name)} · 预渲染示意，非现场照片</div></div>
    <div class="kv"><span class="k">看什么</span><span class="v">${esc(p.see)}</span></div>
    <div class="kv"><span class="k">所在层</span><span class="v">${p.floor}</span></div>
  </div>`;
}

function cardPovPanel() {
  const p = S.sel && S.sel.type === "pov" ? POVS.find(x => x.id === S.sel.id) : nearestPov(S.floor, null);
  if (!p) return "";
  if (S.sel && S.sel.type === "pov") return "";
  return `<div class="card">
    <div class="ch">POV 视角 <span class="tag">最近视点 ${p.id}</span></div>
    <div class="pov">${povSVG(p, 272)}
      <div class="cap">${p.id} ${esc(p.name)} · 预渲染示意，非现场照片</div></div>
    <div class="txt" style="margin-top:7px;font-size:11px;color:#8A9AA5">点地图空白处 → 弹出最近视点静帧</div>
  </div>`;
}

function nearestPov(floorId, xy) {
  const list = POVS.filter(p => p.floor === floorId);
  if (!list.length) return null;
  if (!xy) return list[0];
  let best = list[0], bd = Infinity;
  list.forEach(p => { const d = (p.x - xy.x) ** 2 + (p.y - xy.y) ** 2; if (d < bd) { bd = d; best = p; } });
  return best;
}

/* ══════════════════════════════════════════════════════════════════════
   时间轴带
   ══════════════════════════════════════════════════════════════════════ */
function renderStrip() {
  const th = SLOTS.map(s => `<div class="th ${s.id === S.slot ? "on" : ""}" data-act="slot" data-v="${s.id}">
      <b>${s.id}</b><em>${s.name}</em><em>${s.start}</em></div>`).join("");
  const lanes = Object.keys(ROBOT_KIND).map(k => {
    const K = ROBOT_KIND[k];
    const cells = SLOTS.map(s => {
      const F = FLOORS[S.floor];
      const n = (F.robots[S.variant] || []).filter(r => r.kind === k && r.slots.indexOf(s.id) >= 0).length;
      const on = n > 0;
      const bg = on ? `background:${rgba(K.col, (0.16 + 0.55 * s.k).toFixed(2))}` : "background:#F4F7F8";
      return `<div class="cell ${s.id === S.slot ? "cur" : ""}" style="${bg}">
        <span class="cn" style="color:${on && s.k > 0.62 ? "#fff" : "#33454F"}">${on ? n : "·"}</span></div>`;
    }).join("");
    return `<div class="lane"><div class="lname" style="color:${K.col}">${K.glyph} ${K.name}</div>
      <div class="lcells">${cells}</div></div>`;
  }).join("");

  const rates = [0.5, 1, 2, 4].map(r => `<b class="${S.rate === r ? "on" : ""}" data-act="rate" data-v="${r}">${r}×</b>`).join("");

  $("strip").innerHTML = `
  <div class="strip-top">
    <div class="ctl">
      <button class="pbtn" data-act="step" data-v="-1" title="上一时段">◀◀</button>
      <button class="pbtn play" data-act="play">${playing ? "暂停" : "播放"}</button>
      <button class="pbtn" data-act="step" data-v="1" title="下一时段">▶▶</button>
      <button class="pbtn" data-act="tzero">⟲</button>
    </div>
    <div class="rate">${rates}</div>
    <div class="clock" id="clock">${fmtClock()}</div>
    <span class="hint">每个数字均为模拟值 · 键盘 1/2 切层、空格播放、← → 步进</span>
  </div>
  <div class="thead"><div class="lname">时段 / 机器人</div><div class="lcells">${th}</div></div>
  ${lanes}
  <div class="playhead" id="ph"></div>`;
  updatePlayhead();
}

function dayProgress() {
  let acc = 0;
  for (const s of SLOTS) { if (s.id === S.slot) return (acc + S.t * s.dur) / TOTAL_MIN; acc += s.dur; }
  return 0;
}
const TOTAL_MIN = SLOTS.reduce((a, s) => a + s.dur, 0);

function updatePlayhead() {
  const strip = $("strip"), ph = $("ph"), cells = strip && strip.querySelector(".lcells");
  if (!ph || !cells) return;
  const sr = strip.getBoundingClientRect(), cr = cells.getBoundingClientRect();
  ph.style.left = (cr.left - sr.left + dayProgress() * cr.width).toFixed(1) + "px";
  const ck = $("clock"); if (ck) ck.textContent = fmtClock();
}

/* ══════════════════════════════════════════════════════════════════════
   时间轴视图
   ══════════════════════════════════════════════════════════════════════ */
function renderTimeline() {
  const heads = `<div class="tlth" style="background:transparent"></div>` + SLOTS.map(s =>
    `<button class="tlth ${s.id === S.slot ? "on" : ""}" data-act="slot" data-v="${s.id}">
      <b>${s.id} ${s.name}</b><em>${s.start}–${s.end} · ${s.dur}min</em></button>`).join("");

  const rows = Object.keys(ROBOT_KIND).map(k => {
    const K = ROBOT_KIND[k];
    const cells = SLOTS.map(s => {
      const rs = (FLOORS[S.floor].robots[S.variant] || []).filter(r => r.kind === k && r.slots.indexOf(s.id) >= 0);
      const n = rs.length;
      const bg = n ? `${K.col}${Math.round((0.16 + 0.5 * s.k) * 255).toString(16).padStart(2, "0")}` : "#F6F8F9";
      return `<button class="tlcell ${s.id === S.slot ? "on" : ""}" style="background:${bg}"
        data-act="slot" data-v="${s.id}">
        <span class="st">${n ? n + " 台在场" : "空闲"}</span>
        <span class="du">${n ? (rs[0].chain || []).slice(0, 2).join(" → ") : "—"}</span>
        <span class="mini">${Array.from({ length: 8 }).map((_, i) =>
          `<i style="height:${Math.max(2, s.k * 22 * (i < n ? 1 : 0.25))}px;background:${K.col};opacity:${n ? 0.8 : 0.25}"></i>`).join("")}</span>
      </button>`;
    }).join("");
    return `<div class="tlrow" style="color:${K.col}">${K.glyph} ${K.name} <em style="font-style:normal;font-size:11px;color:#8A9AA5">${K.en}</em></div>${cells}`;
  }).join("");

  const flow = SLOTS.map(s => `<div class="flowbar">人流 ${(s.k * 100).toFixed(0)} · 密度 ${s.peak[S.variant]} 人/m²</div>`).join("");

  const sl = slot(S.slot);
  const side = `<div class="card">
      <div class="ch">时段详情 <span class="tag">${sl.id}</span></div>
      <div class="kv"><span class="k">时段</span><span class="v"><b>${sl.name}</b> · ${sl.start}–${sl.end} · ${sl.dur} min</span></div>
      <div class="kv"><span class="k">人流特征</span><span class="v">${esc(sl.flow)}</span></div>
      <div class="kv"><span class="k">机器人主线</span><span class="v">${esc(sl.robot)}</span></div>
      <div class="kv"><span class="k">冲突指数</span><span class="v">${conflictIndex(S.slot, S.variant).toFixed(2)}</span></div>
      <div class="kv"><span class="k">峰值密度</span><span class="v" style="color:${sl.peak[S.variant] > 1.5 ? C.high : "#33454F"}">${sl.peak[S.variant]} 人/m²</span></div>
    </div>
    <div class="card"><div class="ch">怎么用这张表</div>
      <div class="txt">横着看 = 某一类机器人在一天里什么时候忙；竖着看 = 某个时段有几类机器人在场。
      点任意格子跳到该时段。</div></div>`;

  $("body").innerHTML = `<div class="tl">
    <div class="tl-main">
      <div class="tl-h">时间轴视图 · ${S.floor} · ${S.variant === "A" ? "现状 A" : "提案 B"}</div>
      <div class="tl-sub">8 时段 × 4 类机器人 · 格子可点 · 数值为模拟值</div>
      <div class="tlg">${heads}${rows}
        <div class="flowrow"><div class="tlrow">人流强度</div>${flow}</div>
      </div>
    </div><div class="tlside">${side}</div></div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   对比视图
   ══════════════════════════════════════════════════════════════════════ */
function renderCompare() {
  const sl = slot(S.slot);
  const iA = conflictIndex(S.slot, "A"), iB = conflictIndex(S.slot, "B");
  const tA = sl.travel.A, tB = sl.travel.B;
  const pA = sl.peak.A, pB = sl.peak.B;

  const maps = ["A", "B"].map(v => `<div class="cmp-map ${S.variant === v ? "on" : ""}">
      <div class="cmp-t">${v === "A" ? "现状 A · 机器人只能到 1F" : "提案 B · 中庭垂直梯 + 廊桥"}
        <span class="bd">${S.floor} · ${sl.id} ${sl.name}</span></div>
      <div class="cmp-mapbox" data-v="${v}"></div></div>`).join("");

  const bars = OD_PAIRS.map((od, i) => {
    const a = tA[i], b = tB[i], max = 70;
    const pa = a == null ? 0 : a / max * 100, pb = b == null ? 0 : b / max * 100;
    return `<div class="brow"><span class="nm">${od.name}</span>
      <span class="tr"><i style="width:${pa}%;background:${C.low}"></i></span>
      <span class="vl">${a == null ? "不可达" : a + "s"}</span>
      <span class="tr"><i style="width:${pb}%;background:${C.brand}"></i></span>
      <span class="vl">${b == null ? "不可达" : b + "s"}</span></div>`;
  }).join("");

  const dI = delta(iA, iB), dP = delta(pA, pB);
  const concl = `B 让 2F 变得可达（大厅→2F ${tA[2] == null ? "不可达" : tA[2] + "s"} → ${tB[2]}s），
    双层合计冲突指数 ${iA.toFixed(2)} → ${iB.toFixed(2)}（${dI < 0 ? "降" : "升"} ${Math.abs(dI * 100).toFixed(0)}%）；
    但 1 处高风险从餐厅门口转移到廊桥口——收益是可达性，代价是新增了一处廊桥人机冲突。`;

  $("body").innerHTML = `<div class="cmp">
    <div class="cmp-h"><h2>对比视图 · 现状 A vs 提案 B</h2>
      <span class="lock">对比时只改被比较的那一项，其余参数锁定</span>
      <div class="seg" style="margin-left:auto"><span class="lb">楼层</span>
        ${["1F", "2F"].map(f => `<button class="sg ${S.floor === f ? "on" : ""}" data-act="floor" data-v="${f}">${f}</button>`).join("")}
      </div></div>
    <div class="cmp-maps">${maps}</div>
    <div class="cmp-metrics">
      <div class="mc"><h3>冲突指数 <em>Σ(点×权重) ÷ 时长</em></h3>
        <div class="num">${iA.toFixed(2)} <small>→</small> ${iB.toFixed(2)}</div>
        <div class="d">${sign(dI, true)} <span style="color:#8A9AA5;font-weight:400">相对 A</span></div>
        <div class="foot">权重 高 ${getParam("wHigh")} / 中 ${getParam("wMid")} / 低 ${getParam("wLow")} · 双层合计 · 模拟</div></div>
      <div class="mc"><h3>通行代价 <em>3 组固定 OD · 秒</em></h3>
        <div class="bars">${bars}</div>
        <div class="foot">OD 对固定，不随用户改动 · 灰=A / 蓝=B</div></div>
      <div class="mc"><h3>峰值密度 <em>最窄通道 · 人/m²</em></h3>
        <div class="num"><span style="color:${pA > 1.5 ? C.high : "inherit"}">${pA}</span>
          <small>→</small> <span style="color:${pB > 1.5 ? C.high : "inherit"}">${pB}</span></div>
        <div class="d">${sign(dP, true)} <span style="color:#8A9AA5;font-weight:400">&gt; 1.5 人/m² 标红</span></div>
        <div class="foot">按 §8.2 假设人流推算 · 非实测</div></div>
    </div>
    <div class="concl"><b>结论</b><span>${concl}</span></div>
  </div>`;

  ["A", "B"].forEach(v => {
    const box = document.querySelector(`.cmp-mapbox[data-v="${v}"]`);
    box.innerHTML = planSVG(S.floor, v, {
      layers: Object.assign({}, S.layers, { proposal: true }), kinds: S.kinds,
      slot: S.slot, heatK: sl.k, detail: false, id: "plan-" + v
    });
    const svg = box.querySelector("svg");
    positionRobots(svg, S.floor, v, S.slot, S.t);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   参数抽屉
   ══════════════════════════════════════════════════════════════════════ */
function renderDrawer() {
  if (!S.drawer) { const d = $("drawer"); if (d) d.remove(); return; }
  let d = $("drawer");
  if (!d) { d = document.createElement("div"); d.id = "drawer"; d.className = "drawer"; document.body.appendChild(d); }
  const rows = PARAMS.map(p => `<tr>
      <td>${esc(p.label)}</td>
      <td class="n"><input type="number" step="any" value="${p.value}" data-pk="${p.key}"></td>
      <td class="n" style="color:#8A9AA5">${esc(p.unit)}</td>
      <td><span class="src s-${esc(p.source)}">${esc(p.source)}</span></td></tr>`).join("");
  d.innerHTML = `<h3>参数抽屉 <span class="tag" style="font-size:11px;color:#8A9AA5;font-weight:400">PRD §8.2</span>
      <button class="btn" style="margin-left:auto" data-act="drawer">关闭</button></h3>
    <div class="rd">全部数值均为假设值 / 文献值，改动只在本沙盘内生效，不会下发到任何真实机器人。</div>
    <div class="dbody"><table><thead><tr><th>参数</th><th style="text-align:right">值</th><th></th><th>来源</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   渲染总入口
   ══════════════════════════════════════════════════════════════════════ */
function ensureRails() {
  if (!$("left")) { const a = document.createElement("aside"); a.id = "left"; a.className = "left hidden"; document.body.appendChild(a); }
  if (!$("right")) { const a = document.createElement("aside"); a.id = "right"; a.className = "right hidden"; document.body.appendChild(a); }
}

function render() {
  document.body.classList.toggle("editing", S.edit);
  document.body.classList.toggle("proj", S.proj);
  document.body.classList.toggle("ro", S.readonly);
  renderTop();
  renderDrawer();
  if (S.view === "browse") {
    $("body").innerHTML = `<div class="mid">
      <aside class="left ${S.leftOpen ? "" : "hidden"}" id="left"></aside>
      <div class="map" id="map"><div class="mapscroll" id="mapscroll"><div class="mapbox" id="mapbox"></div></div><div id="ovl"></div></div>
      <aside class="right ${S.rightOpen ? "" : "hidden"}" id="right"></aside>
    </div>`;
    renderLeft(); renderMap(); renderRight(); renderStrip();
  } else {
    $("strip").innerHTML = "";
    if (S.view === "timeline") renderTimeline(); else renderCompare();
    ensureRails(); renderLeft();
  }
  fixSvgImages();
}

/* Safari 兼容：innerHTML 插入的 SVG <image> 属性命名空间可能不对，用 DOM API 显式补写 */
function fixSvgImages() {
  const XLINK = "http://www.w3.org/1999/xlink";
  document.querySelectorAll("svg.plansvg image").forEach(im => {
    const raw = im.getAttribute("href") || im.getAttribute("xlink:href") ||
      im.getAttributeNS(XLINK, "href");
    if (!raw) return;
    let abs = raw;
    try { abs = new URL(raw, document.baseURI).href; } catch (e) {}
    im.setAttribute("href", abs);
    im.setAttributeNS(XLINK, "xlink:href", abs);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   交互
   ══════════════════════════════════════════════════════════════════════ */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const a = t.dataset.act, v = t.dataset.v;

  if (a === "floor") { S.floor = v; S.sel = null; }
  else if (a === "slot") { S.slot = v; S.t = 0.35; S.sel = null; }
  else if (a === "variant") { S.variant = v; S.sel = null; }
  else if (a === "view") { S.view = v; }
  else if (a === "left") { S.leftOpen = !S.leftOpen; }
  else if (a === "right") { S.rightOpen = !S.rightOpen; }
  else if (a === "kind") { S.kinds[v] = !S.kinds[v]; }
  else if (a === "layer") { S.layers[v] = !S.layers[v]; }
  else if (a === "basemap") { S.basemap = v; }
  else if (a === "edit") { S.edit = !S.edit; toast(S.edit ? "编辑模式已开启：可直接拖动地图上的对象" : "编辑模式已关闭，改动已保存在本地"); if (!S.edit) saveStore(); }
  else if (a === "drawer") { S.drawer = !S.drawer; S.more = false; }
  else if (a === "more") { S.more = !S.more; }
  else if (a === "help") { S.more = false; S.drawer = false; showHelp(); return; }
  else if (a === "intro") { S.more = false; render(); showIntro(); return; }
  else if (a === "proj") { S.proj = !S.proj; }
  else if (a === "clear") { S.sel = null; }
  else if (a === "zoom") {
    if (v === "in") S.zoom = Math.min(2.5, +(S.zoom + 0.25).toFixed(2));
    else if (v === "out") S.zoom = Math.max(1, +(S.zoom - 0.25).toFixed(2));
    else S.zoom = 1;
  }
  else if (a === "play") { playing = !playing; lastTs = 0; }
  else if (a === "rate") { S.rate = parseFloat(v); }
  else if (a === "tzero") { S.t = 0; }
  else if (a === "step") {
    const i = SLOTS.findIndex(s => s.id === S.slot);
    const j = Math.max(0, Math.min(SLOTS.length - 1, i + parseInt(v)));
    S.slot = SLOTS[j].id; S.t = 0; S.sel = null;
  }
  else if (a === "pick-conflict") { S.sel = { type: "conflict", n: v }; }
  else if (a === "export") { exportJSON(); return; }
  else if (a === "import") { $("file").click(); return; }
  else if (a === "reset") { if (confirm("恢复默认数据？本地所有编辑将丢失。")) resetStore(); return; }
  else if (a === "set-state") { if (S.sel && S.sel.type === "robot") { const r = findRobot(S.sel.id); if (r) { r.state = v; saveStore(); } } }
  else if (a === "del-robot" || a === "del-conflict" || a === "del-dock") { editDelete(a, v); S.sel = null; }
  else if (a === "add-robot") { editAddRobot(); }
  else if (a === "add-conflict") { editAddConflict(); }
  else if (a === "add-dock") { editAddDock(); }
  render();
});

/* 点空白关闭「更多」菜单 */
document.addEventListener("click", e => {
  if (S.more && !(e.target.closest && e.target.closest(".morewrap"))) { S.more = false; render(); }
});

/* 参数输入 */
document.addEventListener("input", e => {
  const pk = e.target.dataset && e.target.dataset.pk;
  if (pk) {
    const p = PARAMS.find(x => x.key === pk);
    if (p) { p.value = parseFloat(e.target.value); if (!isNaN(p.value)) { applyBinds(); saveStore(); } }
    return;
  }
  const fk = e.target.dataset && e.target.dataset.fk;
  if (fk) editFieldInput(e.target);
});

/* 地图点击：选中对象 / 空白 → 最近 POV */
document.addEventListener("click", e => {
  const svg = e.target.closest("svg.plansvg");
  if (!svg || S.view !== "browse" || e.target.closest("[data-act]")) return;
  const obj = e.target.closest(".obj");
  if (obj) {
    const o = obj.dataset.obj;
    if (o === "robot") S.sel = { type: "robot", id: obj.dataset.id };
    else if (o === "conflict") S.sel = { type: "conflict", n: obj.dataset.n };
    else if (o === "door") S.sel = { type: "door", id: obj.dataset.id };
    else if (o === "dock") S.sel = { type: "dock", i: parseInt(obj.dataset.i) };
    else return;
  } else {
    const pt = svgPoint(svg, e.clientX, e.clientY);
    const p = nearestPov(S.floor, pt);
    S.sel = p ? { type: "pov", id: p.id } : null;
  }
  render();
});

function svgPoint(svg, cx, cy) {
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const s = Math.min(r.width / vb.width, r.height / vb.height);
  const ox = r.left + (r.width - vb.width * s) / 2, oy = r.top + (r.height - vb.height * s) / 2;
  return { x: (cx - ox) / s, y: (cy - oy) / s };
}

/* 键盘（PRD §5：1/2 切层、空格播放、方向键步进） */
document.addEventListener("keydown", e => {
  if (/input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === "1") { S.floor = "1F"; S.sel = null; render(); }
  else if (e.key === "2") { S.floor = "2F"; S.sel = null; render(); }
  else if (e.key === " ") { e.preventDefault(); playing = !playing; render(); }
  else if (e.key === "ArrowRight") { S.t = Math.min(1, S.t + 0.08); tick(true); }
  else if (e.key === "ArrowLeft") { S.t = Math.max(0, S.t - 0.08); tick(true); }
  else if (e.key === "Escape") { S.sel = null; render(); }
});

/* ══════════════════════════════════════════════════════════════════════
   播放循环
   ══════════════════════════════════════════════════════════════════════ */
function tick(light) {
  if (S.view === "browse") {
    const svg = $("mapbox") && $("mapbox").querySelector("svg");
    positionRobots(svg, S.floor, S.variant, S.slot, S.t);
    updatePlayhead();
  } else if (S.view === "compare") {
    ["A", "B"].forEach(v => {
      const box = document.querySelector(`.cmp-mapbox[data-v="${v}"]`);
      positionRobots(box && box.querySelector("svg"), S.floor, v, S.slot, S.t);
    });
  }
  const c = $("clock"); if (c) c.textContent = fmtClock();
}

let rafSeen = 0;

function step(dt) {
  const dMin = dt * S.rate / Math.max(0.1, getParam("playBase"));   // playBase = 秒 / 分钟
  const sl = slot(S.slot);
  S.t += dMin / sl.dur;
  while (S.t >= 1) {
    const i = SLOTS.findIndex(x => x.id === S.slot);
    S.slot = (i >= SLOTS.length - 1) ? SLOTS[0].id : SLOTS[i + 1].id;
    S.sel = null; S.t -= 1; render();
  }
  tick();
}

function loop(ts) {
  requestAnimationFrame(loop);
  rafSeen = performance.now();
  if (!playing) { lastTs = 0; return; }
  if (!lastTs) { lastTs = ts; return; }
  const dt = Math.min(0.06, (ts - lastTs) / 1000); lastTs = ts;
  step(dt);
}

/* 兜底：无合成器 / 后台标签页里 rAF 可能停摆，用定时器保持时间推进 */
setInterval(() => {
  if (!playing) return;
  if (performance.now() - rafSeen > 300) { lastTs = 0; step(0.05); }
}, 50);

/* ══════════════════════════════════════════════════════════════════════
   使用说明
   ══════════════════════════════════════════════════════════════════════ */
function showHelp() {
  const old = document.getElementById("help"); if (old) old.remove();
  const box = document.createElement("div");
  box.id = "help"; box.className = "help";
  box.innerHTML = `<div class="helpbox">
    <h3>使用说明 / 数据来源
      <button class="btn" style="margin-left:auto" id="helpclose">关闭</button></h3>
    <div class="helpbody">
      <h4>三步闭环（PRD §3.1）</h4>
      <ol>
        <li><b>选时段</b>：点顶栏 T1–T8 胶囊，或拖底部时间轴游标；空格播放，← → 步进。</li>
        <li><b>看冲突</b>：点地图上的 ①②③ 冲突点 → 右栏出「类型 / 严重度 / 持续 / 原因 / 3 条建议」；
          点机器人看完整路线与任务链；点门看通行判定；点空白看最近 POV 视点。</li>
        <li><b>改方案</b>：顶栏切 A / B，或点「对比」看双地图 + 3 个指标 + Δ。</li>
      </ol>
      <h4>怎么改数据（这就是「可以编辑」的部分）</h4>
      <ul>
        <li><b>页面上改</b>：点「编辑」→ 直接拖动机器人 / 冲突点 / 候停点 / 分区标签；
          点对象后在右栏改属性（编号、类型、出现时段、严重度、原因、建议、路线 d、门净宽…），
          还能增删机器人 / 冲突点 / 停靠点。改动自动存 localStorage。</li>
        <li><b>改源文件</b>：所有数据在 <code>js/data.js</code>（唯一数据源），改完刷新即可，无需构建。</li>
        <li><b>带走</b>：⋯ → 导出 JSON；下次用「导入 JSON」回填，或交给别人复现。</li>
        <li><b>还原</b>：⋯ → 恢复默认数据。</li>
      </ul>
      <h4>数据来源（PRD §8.1 / §8.2）</h4>
      <ul>
        <li>底图：<code>Y1 to Y3 Floor Plan 20260821.pptx</code> · Building 2 · 1F / 2F CAD 导出。</li>
        <li>时段：沿用既有时间线图的 8 个名称，起止时间为假设值，待校方作息校正。</li>
        <li>门：CAD 门位可辨、净宽不可辨 → 全部门标「待确认」，通行判定待实测门表。</li>
        <li>人数 / 速度 / 尺寸 / 时长：见「参数」抽屉，每个数值带来源标签（假设 / 文献 / 设计 / 待校准）。</li>
        <li>比例与指北：CAD 图幅未标定 → 待校准；所有以米为单位的校验都按参数
          <code>pxPerM</code>（默认 20）换算。</li>
        <li>V1 是<b>离线情景模拟器</b>：不接真实机器人、不实时定位、不下发控制。</li>
      </ul>
      <h4>键盘</h4>
      <p><code>1</code>/<code>2</code> 切楼层 · <code>空格</code> 播放/暂停 · <code>←</code>/<code>→</code> 步进 · <code>Esc</code> 取消选择</p>
    </div></div>`;
  document.body.appendChild(box);
  box.addEventListener("click", e => { if (e.target === box || e.target.id === "helpclose") box.remove(); });
}

/* ══════════════════════════════════════════════════════════════════════
   新手引导（首次打开自动一次；学生第一次用也能马上上手）
   ══════════════════════════════════════════════════════════════════════ */
function showIntro() {
  const old = document.getElementById("intro"); if (old) old.remove();
  const box = document.createElement("div");
  box.id = "intro"; box.className = "intro";
  box.innerHTML = `<div class="introbox">
    <div class="ih">
      <h3>30 秒上手：这是一台「人机交通模拟器」</h3>
      <p>2 号楼 1F / 2F 的一天。图上所有位置与人数都是<b>模拟值</b>，不是真实监控数据。</p>
    </div>
    <div class="steps">
      <div class="step"><div class="n">1</div><h4>选一个时间</h4>
        <ol><li>点顶栏 <b>T1–T8</b> 胶囊（<b>T5 午餐</b>最挤，建议先看它）</li>
        <li>或点底部 <b>播放</b>，看一整天怎么变化</li>
        <li>键盘 <kbd>空格</kbd> 播放 / <kbd>←</kbd><kbd>→</kbd> 步进 / <kbd>1</kbd><kbd>2</kbd> 换楼层</li></ol></div>
      <div class="step"><div class="n">2</div><h4>找一个冲突点</h4>
        <ol><li>图上的 <b>① ② ③</b> 就是人机冲突点，颜色 红=高 / 橙=中 / 灰=低</li>
        <li>点它 → 右栏出现「为什么 + 3 条怎么改」</li>
        <li>点机器人看它走哪儿；点门看它过不过得去；点空白处看现场视角</li></ol></div>
      <div class="step"><div class="n">3</div><h4>比一比，给结论</h4>
        <ol><li>顶栏 <b>现状 A / 提案 B</b> 切着看</li>
        <li>点 <b>对比</b>：左右两张图 + 3 个数字 + Δ</li>
        <li>记住一句：加了中庭那部机器人梯，2 楼终于能上去，但廊桥口会新出现一处高风险</li></ol></div>
    </div>
    <div class="if">
      <label><input type="checkbox" id="introskip" checked> 下次打开不再显示</label>
      <button class="btn" data-act="help">看完整说明 / 数据来源</button>
      <button class="btn primary" style="margin-left:auto" id="introgo">开始探索 →</button>
    </div>
  </div>`;
  document.body.appendChild(box);
  const close = () => {
    if (document.getElementById("introskip").checked) {
      try { localStorage.setItem("b2-sim-intro", "1"); } catch (e) {}
    }
    box.remove();
  };
  box.addEventListener("click", e => { if (e.target === box || e.target.id === "introgo") close(); });
}

/* ══════════════════════════════════════════════════════════════════════
   导入 / 导出
   ══════════════════════════════════════════════════════════════════════ */
function exportJSON() {
  const p = {}; PARAMS.forEach(x => p[x.key] = x.value);
  const blob = new Blob([JSON.stringify({ v: 1, params: p, floors: FLOORS }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "b2-simulator-data.json";
  a.click();
  toast("已导出 b2-simulator-data.json");
}
function importJSON(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const j = JSON.parse(rd.result);
      if (j.params) PARAMS.forEach(x => { if (j.params[x.key] != null) x.value = j.params[x.key]; });
      if (j.floors) Object.keys(FLOORS).forEach(f => { if (j.floors[f]) FLOORS[f] = j.floors[f]; });
      applyBinds(); saveStore(); render(); toast("已导入数据");
    } catch (e) { toast("导入失败：不是合法的 JSON"); }
  };
  rd.readAsText(file);
}

/* ══════════════════════════════════════════════════════════════════════
   启动
   ══════════════════════════════════════════════════════════════════════ */
function applyHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!h) return;
  h.split("&").forEach(p => {
    const i = p.indexOf("="); if (i < 0) return;
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (k === "view" && ["browse", "timeline", "compare"].indexOf(v) >= 0) S.view = v;
    if (k === "floor" && FLOORS[v]) S.floor = v;
    if (k === "slot" && SLOTS.some(x => x.id === v)) S.slot = v;
    if (k === "variant" && (v === "A" || v === "B")) S.variant = v;
    if (k === "edit") S.edit = v === "1";
    if (k === "proj") S.proj = v === "1";
    if (k === "drawer") S.drawer = v === "1";
    if (k === "ro" || k === "readonly") S.readonly = v === "1";
    if (k === "play") S.autoplay = v === "1";
    if (k === "z") { const z = parseFloat(v); if (z >= 1 && z <= 2.5) S.zoom = z; }
    if (k === "basemap" && (v === "simple" || v === "cad")) S.basemap = v;
    if (k === "sel" && v) {
      const [ty, val] = v.split(":");
      if (ty === "conflict") S.sel = { type: "conflict", n: val };
      if (ty === "robot") S.sel = { type: "robot", id: val };
      if (ty === "door") S.sel = { type: "door", id: val };
      if (ty === "pov") S.sel = { type: "pov", id: val };
      if (ty === "dock") S.sel = { type: "dock", i: parseInt(val) };
    }
  });
}
window.addEventListener("hashchange", () => { applyHash(); render(); });

function boot() {
  applyHash();
  const had = S.readonly ? false : loadStore();
  applyBinds();
  render();
  requestAnimationFrame(loop);
  const f = $("file");
  if (f) f.addEventListener("change", () => { if (f.files[0]) importJSON(f.files[0]); f.value = ""; });
  window.addEventListener("resize", () => { if (S.view === "browse") updatePlayhead(); });
  if (had) toast("已载入这台电脑上编辑过的数据（⋯ → 恢复默认 可还原）", 2600);
  if (S.autoplay) { playing = true; lastTs = 0; toast("已按 ?play=1 自动开始播放"); }
  /* 第一次来的人：给 3 步引导；?ro=1 课堂只读模式不弹 */
  let seen = false;
  try { seen = !!localStorage.getItem("b2-sim-intro"); } catch (e) { seen = true; }
  if (!S.readonly && (location.hash.indexOf("intro=1") >= 0 || !seen)) {
    setTimeout(showIntro, 500);
  }
}
document.addEventListener("DOMContentLoaded", boot);
