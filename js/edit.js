/* ============================================================================
 * edit.js —— 编辑模式：拖动地图对象 / 改属性 / 增删 / 候选位吸附与合法性校验
 * 所有改动写进 localStorage，可用顶栏「导出 JSON」拿走，或「恢复默认」还原。
 * ========================================================================== */

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
                 "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
let EDIT_CTX = null;

function findRobot(id) {
  return (FLOORS[S.floor].robots[S.variant] || []).find(r => r.id === id);
}
function findConflict(n) {
  return (FLOORS[S.floor].conflicts[S.variant] || []).find(c => c.n === n);
}
function nextConflictNo() {
  const used = (FLOORS[S.floor].conflicts[S.variant] || []).map(c => c.n);
  return CIRCLED.find(c => used.indexOf(c) < 0) || "·";
}

/* ── 停靠位合法性校验（PRD §4.3 的四条约束） ─────────────────────────── */
function checkDock(floorId, x, y, exclude) {
  const F = FLOORS[floorId], m = getParam("pxPerM");
  if (x < 0 || y < 0 || x > F.w || y > F.h) return { ok: false, msg: "✕ 不在楼板范围内" };
  let nd = Infinity, ndid = "";
  F.doors.forEach(d => { const t = Math.hypot(d.x - x, d.y - y); if (t < nd) { nd = t; ndid = d.id; } });
  if (nd < 1.5 * m) return { ok: false, msg: `✕ 距门 ${ndid} 不足 1.5m（实测 ${(nd / m).toFixed(2)}m）` };
  let nc = Infinity;
  (F.chargers || []).forEach(c => { nc = Math.min(nc, Math.hypot(c.x - x, c.y - y)); });
  if (nc !== Infinity && nc > 30 * m) return { ok: false, msg: `✕ 离充电桩超过 30m（${(nc / m).toFixed(0)}m）` };
  let nh = Infinity;
  F.heat.forEach(h => { nh = Math.min(nh, Math.hypot(h.x - x, h.y - y)); });
  if (nh < 1.2 * m) return { ok: false, msg: `✕ 可能挡住 1.2m 主通道（距主流线 ${(nh / m).toFixed(2)}m）` };
  F.docks.forEach((d, i) => {
    if (i === exclude) return;
    if (Math.hypot(d.x - x, d.y - y) < 3 * m) { nh = -1; }
  });
  if (nh === -1) return { ok: false, msg: "✕ 与既有停靠点间距不足 3m" };
  return { ok: true, msg: `✓ 合法：距最近门 ${(nd / m).toFixed(1)}m、距充电桩 ${nc === Infinity ? "—" : (nc / m).toFixed(0) + "m"}（比例 ${m}px/m 待校准）` };
}

/* ── 地图右上角编辑条 ───────────────────────────────────────────────── */
function editBar() {
  return `<div class="editbar">
    <div class="row">
      <button class="btn" data-act="add-robot">+ 机器人</button>
      <button class="btn" data-act="add-conflict">+ 冲突点</button>
      <button class="btn" data-act="add-dock">+ 停靠点</button>
    </div>
    <div class="row"><button class="btn on" data-act="edit">编辑中 · 点此退出并保存</button></div>
  </div>`;
}

/* ── 属性表单 ───────────────────────────────────────────────────────── */
function slotChips(list) {
  return `<div class="chips">${SLOTS.map(s =>
    `<button class="chip2 ${list.indexOf(s.id) >= 0 ? "on" : ""}" data-act="slot-toggle" data-v="${s.id}">${s.id} ${s.name}</button>`).join("")}</div>`;
}

function robotForm(rob) {
  EDIT_CTX = { obj: rob, t: "robot" };
  const kinds = Object.keys(ROBOT_KIND).map(k =>
    `<option value="${k}" ${rob.kind === k ? "selected" : ""}>${ROBOT_KIND[k].name} ${ROBOT_KIND[k].en}</option>`).join("");
  return `<div style="margin-top:8px;border-top:1px dashed #EDF1F3;padding-top:8px">
    <div class="fld"><label>编号</label><input type="text" data-fk="id" value="${esc(rob.id)}"></div>
    <div class="fld"><label>类型</label><select data-fk="kind">${kinds}</select></div>
    <div class="fld"><label>状态</label><input type="text" data-fk="state" value="${esc(rob.state)}"></div>
    <div class="fld"><label>任务链</label><input type="text" data-fk="chain" value="${esc((rob.chain || []).join(" → "))}"></div>
    <div class="fld"><label>路线 d</label><textarea data-fk="d">${esc(rob.d)}</textarea></div>
    <div style="font-size:11px;color:#8A9AA5;padding:2px 0">在场时段（点击切换）</div>
    ${slotChips(rob.slots)}
    <button class="act" style="border-color:#D64545;color:#D64545;margin-top:8px"
      data-act="del-robot" data-v="${rob.id}">删除这台机器人</button></div>`;
}

function conflictForm(cf) {
  EDIT_CTX = { obj: cf, t: "conflict" };
  const types = Object.keys(CONFLICT_TYPE).map(k =>
    `<option value="${k}" ${cf.type === k ? "selected" : ""}>${k} ${CONFLICT_TYPE[k].name}</option>`).join("");
  const sevs = Object.keys(SEV).map(k =>
    `<option value="${k}" ${cf.sev === k ? "selected" : ""}>${SEV[k].name}</option>`).join("");
  return `<div style="margin-top:8px;border-top:1px dashed #EDF1F3;padding-top:8px">
    <div class="fld"><label>类型</label><select data-fk="type">${types}</select></div>
    <div class="fld"><label>严重度</label><select data-fk="sev">${sevs}</select></div>
    <div class="fld"><label>位置名</label><input type="text" data-fk="where" value="${esc(cf.where)}"></div>
    <div class="fld"><label>持续 s</label><input type="number" data-fk="dur" value="${cf.dur}"></div>
    <div class="fld"><label>坐标 x/y</label><input type="number" data-fk="x" value="${cf.x}">
      <input type="number" data-fk="y" value="${cf.y}"></div>
    <div class="fld"><label>原因</label><textarea data-fk="why">${esc(cf.why)}</textarea></div>
    <div class="fld"><label>建议 3 条</label><textarea data-fk="fix">${esc((cf.fix || []).join(" / "))}</textarea></div>
    <div style="font-size:11px;color:#8A9AA5;padding:2px 0">出现时段（点击切换）</div>
    ${slotChips(cf.slots)}
    <button class="act" style="border-color:#D64545;color:#D64545;margin-top:8px"
      data-act="del-conflict" data-v="${cf.n}">删除这个冲突点</button></div>`;
}

function doorForm(dr) {
  EDIT_CTX = { obj: dr, t: "door" };
  const types = ["平开", "推拉", "防火常闭", "自动门", "禁行"].map(t =>
    `<option value="${t}" ${dr.type === t ? "selected" : ""}>${t}</option>`).join("");
  return `<div style="margin-top:8px;border-top:1px dashed #EDF1F3;padding-top:8px">
    <div class="fld"><label>净宽 m</label><input type="number" step="0.05" data-fk="w" value="${dr.w}"></div>
    <div class="fld"><label>类型</label><select data-fk="type">${types}</select></div>
    <div class="fld"><label>常闭</label><select data-fk="closed">
      <option value="0" ${!dr.closed ? "selected" : ""}>否</option>
      <option value="1" ${dr.closed ? "selected" : ""}>是</option></select></div>
    <div class="fld"><label>来源</label><input type="text" data-fk="conf" value="${esc(dr.conf)}"></div>
    <div style="font-size:11px;color:#8A9AA5;padding:4px 0">实测后请把来源改成「实测」，界面上的「待确认」会自动消失。</div></div>`;
}

function dockForm(dk, i) {
  EDIT_CTX = { obj: dk, t: "dock" };
  return `<div style="margin-top:8px;border-top:1px dashed #EDF1F3;padding-top:8px">
    <div class="fld"><label>名称</label><input type="text" data-fk="name" value="${esc(dk.name || "")}"></div>
    <div class="fld"><label>坐标 x/y</label><input type="number" data-fk="x" value="${dk.x}">
      <input type="number" data-fk="y" value="${dk.y}"></div>
    <button class="act" style="border-color:#D64545;color:#D64545;margin-top:8px"
      data-act="del-dock" data-v="${i}">删除这个停靠点</button></div>`;
}

/* ── 字段写入 ───────────────────────────────────────────────────────── */
function editFieldInput(el) {
  const ctx = EDIT_CTX; if (!ctx) return;
  const k = el.dataset.fk, o = ctx.obj;
  let v = el.value;
  if (k === "x" || k === "y" || k === "dur") v = parseFloat(v);
  if (k === "w") v = parseFloat(v);
  if (k === "closed") v = v === "1";
  if (k === "chain") v = v.split("→").map(s => s.trim()).filter(Boolean);
  if (k === "fix") v = v.split("/").map(s => s.trim()).filter(Boolean);
  o[k] = v;
  saveStore();
  if (k === "id" || k === "d" || k === "kind") renderMap();
}

/* ── 增删 ───────────────────────────────────────────────────────────── */
function editAddRobot() {
  const F = FLOORS[S.floor];
  const n = (F.robots[S.variant] || []).length + 1;
  const cx = Math.round(F.w / 2), cy = Math.round(F.h / 2);
  F.robots[S.variant] = F.robots[S.variant] || [];
  F.robots[S.variant].push({
    id: "R" + n, kind: "delivery", d: `M ${cx - 80},${cy} L ${cx + 80},${cy}`,
    slots: [S.slot], state: "待机", chain: ["取货点", "目的房间", "返程"], off: { x: 0, y: 0 }
  });
  saveStore(); toast("已新增机器人，可直接拖动，并在右栏改路线");
}
function editAddConflict() {
  const F = FLOORS[S.floor];
  F.conflicts[S.variant] = F.conflicts[S.variant] || [];
  F.conflicts[S.variant].push({
    n: nextConflictNo(), type: "C2", x: Math.round(F.w / 2), y: Math.round(F.h / 2),
    sev: "mid", slots: [S.slot], dur: 5, where: "新冲突点", why: "待填写原因（请在右栏补充）",
    fix: ["错峰通行", "设候停点", "机器人限速"]
  });
  saveStore(); toast("已新增冲突点，可直接拖动");
}
function editAddDock() {
  const F = FLOORS[S.floor];
  F.docks.push({ x: Math.round(F.w / 2), y: Math.round(F.h / 2), name: "W" + (F.docks.length + 1) });
  saveStore(); toast("已新增停靠点，会自动吸附到候选位（虚线圆）");
}
function editDelete(a, v) {
  const F = FLOORS[S.floor];
  if (a === "del-robot") F.robots[S.variant] = (F.robots[S.variant] || []).filter(r => r.id !== v);
  if (a === "del-conflict") F.conflicts[S.variant] = (F.conflicts[S.variant] || []).filter(c => c.n !== v);
  if (a === "del-dock") F.docks.splice(parseInt(v), 1);
  saveStore(); toast("已删除");
}

/* 时段 chip 切换（capture 阶段，先于 app.js 的冒泡处理） */
document.addEventListener("click", e => {
  const t = e.target.closest('[data-act="slot-toggle"]');
  if (!t || !EDIT_CTX) return;
  e.stopPropagation();
  const id = t.dataset.v, o = EDIT_CTX.obj;
  const i = o.slots.indexOf(id);
  if (i >= 0) o.slots.splice(i, 1); else o.slots.push(id);
  o.slots.sort((a, b) => SLOTS.findIndex(s => s.id === a) - SLOTS.findIndex(s => s.id === b));
  saveStore(); render();
}, true);

/* ── 拖动 ───────────────────────────────────────────────────────────── */
let drag = null;
document.addEventListener("pointerdown", e => {
  if (!S.edit || S.readonly) return;
  const svg = e.target.closest("#plan"); if (!svg) return;
  const obj = e.target.closest(".obj"); if (!obj) return;
  const o = obj.dataset.obj;
  if (["robot", "conflict", "dock", "zone"].indexOf(o) < 0) return;
  const p = svgPoint(svg, e.clientX, e.clientY);
  drag = { svg: svg, type: o, obj: obj, p0: p, moved: false,
           idx: obj.dataset.i != null ? parseInt(obj.dataset.i) : null,
           id: obj.dataset.id || obj.dataset.n || null };
  if (o === "robot") {
    const r = findRobot(drag.id);
    drag.off0 = r && r.off ? { x: r.off.x, y: r.off.y } : { x: 0, y: 0 };
  }
  e.preventDefault();
  obj.classList.add("dragging");
});

document.addEventListener("pointermove", e => {
  if (!drag) return;
  const p = svgPoint(drag.svg, e.clientX, e.clientY);
  drag.moved = true;
  const F = FLOORS[S.floor];
  if (drag.type === "robot") {
    const r = findRobot(drag.id); if (!r) return;
    r.off = { x: Math.round(drag.off0.x + p.x - drag.p0.x), y: Math.round(drag.off0.y + p.y - drag.p0.y) };
    positionRobots(drag.svg, S.floor, S.variant, S.slot, S.t);
  } else if (drag.type === "conflict") {
    const c = findConflict(drag.id); if (!c) return;
    c.x = Math.round(p.x); c.y = Math.round(p.y);
    drag.obj.setAttribute("transform", null);
    drag.obj.querySelectorAll("circle").forEach((c2, i) => {
      if (i === 0) { c2.setAttribute("cx", c.x); c2.setAttribute("cy", c.y); }
    });
    drag.obj.querySelectorAll("circle").forEach(c2 => { if (!c2.querySelector("animate")) { c2.setAttribute("cx", c.x); c2.setAttribute("cy", c.y); } });
    const tri = drag.obj.querySelector("path"); if (tri) {
      const dy = c.sev === "low" ? 0 : SEV[c.sev].r + 10;
      tri.setAttribute("d", `M ${c.x},${c.y - dy} l -9,15 h 18 z`);
    }
    const tx = drag.obj.querySelector("text"); if (tx) { tx.setAttribute("x", c.x); tx.setAttribute("y", c.y + SEV[c.sev].r + 26); }
  } else if (drag.type === "dock") {
    const d = F.docks[drag.idx]; if (!d) return;
    d.x = Math.round(p.x); d.y = Math.round(p.y);
    drag.obj.querySelector("rect").setAttribute("x", d.x - 13);
    drag.obj.querySelector("rect").setAttribute("y", d.y - 13);
    drag.obj.querySelector("text").setAttribute("x", d.x);
    drag.obj.querySelector("text").setAttribute("y", d.y + 5);
  } else if (drag.type === "zone") {
    const z = F.zones[drag.idx]; if (!z) return;
    z.x = Math.round(p.x); z.y = Math.round(p.y);
    drag.obj.setAttribute("x", z.x); drag.obj.setAttribute("y", z.y);
  }
});

document.addEventListener("pointerup", e => {
  if (!drag) return;
  const d = drag; drag = null;
  d.obj.classList.remove("dragging");
  if (!d.moved) return;
  const F = FLOORS[S.floor];
  if (d.type === "dock") {
    /* 吸附到候选位（PRD §4.3：8 个候选位，不做自由拖拽） */
    const dk = F.docks[d.idx]; if (!dk) return;
    let best = null, bd = 44;
    F.dockSlots.forEach(s => { const t = Math.hypot(s.x - dk.x, s.y - dk.y); if (t < bd) { bd = t; best = s; } });
    if (best) { dk.x = best.x; dk.y = best.y; }
    const chk = checkDock(S.floor, dk.x, dk.y, d.idx);
    toast((chk.ok ? "" : "⚠ ") + chk.msg, 2600);
  }
  if (d.type === "conflict") {
    const c = findConflict(d.id); if (!c) return;
    const m = getParam("pxPerM");
    if (c.x < 0) c.x = 0; if (c.y < 0) c.y = 0;
    if (c.x > F.w) c.x = F.w; if (c.y > F.h) c.y = F.h;
  }
  saveStore();
  render();
});
