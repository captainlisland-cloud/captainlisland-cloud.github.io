/* ============================================================================
 * map.js —— 平面图 SVG 渲染器
 * 底图 = CAD 导出 PNG；叠加层 = 人流 / 路线 / 机器人 / 冲突 / 候停点 / 门 / 提案
 * 所有可点击对象都带 data-obj，事件在 app.js 里统一委托处理。
 * ========================================================================== */

function haloText(x, y, s, size, opt) {
  opt = opt || {};
  const fill = opt.fill || "#33454F", w = opt.weight || 600, anchor = opt.anchor || "middle";
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${w}" fill="${fill}"
    style="paint-order:stroke;stroke:#FFFFFF;stroke-width:5px;stroke-linejoin:round">${s}</text>`;
}

function arrowHead(x, y, deg, col, scale) {
  scale = scale || 1;
  return `<path d="M -9,-6 L 9,0 L -9,6 Z" transform="translate(${x},${y}) rotate(${deg}) scale(${scale})" fill="${col}" opacity="0.75"/>`;
}

function svgDefs() {
  return `<defs>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <pattern id="voidhatch" width="12" height="12" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="#EEF1F3"/>
      <line x1="0" y1="0" x2="0" y2="12" stroke="#B9C4CC" stroke-width="4"/>
    </pattern>
    <pattern id="tbcstripe" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="10" height="10" fill="#FFFFFF"/>
      <line x1="0" y1="0" x2="0" y2="10" stroke="#B9C4CC" stroke-width="3"/>
    </pattern>
  </defs>`;
}

/* 机器人本体（不含位移，位移由 app.js 逐帧写入 transform） */
function robotBody(rob) {
  const K = ROBOT_KIND[rob.kind];
  return `<g class="obj rbody" data-obj="robot" data-id="${rob.id}" data-kind="${rob.kind}" style="cursor:pointer">
    <circle cx="0" cy="0" r="42" fill="transparent"/>
    <g class="rot">
      <circle cx="0" cy="0" r="17" fill="#FFFFFF" stroke="${K.col}" stroke-width="4.5"/>
      <circle cx="0" cy="0" r="7" fill="${K.col}"/>
      <path d="M 0,0 L 24,0" stroke="${K.col}" stroke-width="4" stroke-linecap="round"/>
    </g>
    ${haloText(0, -25, rob.id, 16)}
  </g>`;
}

/* ── 主渲染 ─────────────────────────────────────────────────────────── */
function planSVG(floorId, variant, opt) {
  opt = opt || {};
  const F = FLOORS[floorId];
  const L = opt.layers || {};
  const detail = opt.detail !== false;
  const edit = !!opt.edit;
  const svgId = opt.id || "plan";
  const o = [];

  o.push(`<svg id="${svgId}" class="plansvg" viewBox="0 0 ${F.w} ${F.h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
    xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`);
  o.push(svgDefs());
  o.push(`<rect width="${F.w}" height="${F.h}" fill="#FFFFFF"/>`);
  /* 绝对 URL + href/xlink:href 双写：Safari 对动态插入 SVG 的相对 xlink:href 会失效 */
  const imgSrc = (S.basemap === "simple" && F.imgSimple) ? F.imgSimple : F.img;
  const imgHref = new URL(imgSrc, document.baseURI).href;
  o.push(`<image href="${imgHref}" xlink:href="${imgHref}" x="0" y="0" width="${F.w}" height="${F.h}" preserveAspectRatio="xMidYMid meet"/>`);
  o.push(`<rect width="${F.w}" height="${F.h}" fill="#FFFFFF" opacity="0.14" style="mix-blend-mode:screen"/>`);
  if (!detail) o.push('<g opacity="0.93">');

  /* 2F 中庭挑空：不可通行，灰色斜纹 */
  if (F.void) {
    const v = F.void;
    if (v.rx) {
      o.push(`<ellipse cx="${v.cx}" cy="${v.cy}" rx="${v.rx}" ry="${v.ry}" transform="rotate(${v.rot || 0} ${v.cx} ${v.cy})"
        fill="url(#voidhatch)" stroke="${C.tbc}" stroke-width="3" stroke-dasharray="11 7"/>`);
      if (detail) o.push(haloText(v.cx + 4, v.cy - v.ry - 16, v.label, 20, { fill: "#7C8B96" }));
    } else {
      o.push(`<rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="url(#voidhatch)"
        stroke="${C.tbc}" stroke-width="3" stroke-dasharray="10 6"/>`);
      if (detail) o.push(haloText(v.x + v.w / 2, v.y - 12, v.label, 20, { fill: "#7C8B96" }));
    }
  }

  /* 人流层 */
  if (L.flow) {
    const k = opt.heatK == null ? 1 : opt.heatK;
    o.push('<g filter="url(#soft)">');
    F.heat.forEach(h => {
      const kk = Math.max(0.08, Math.min(1, h.k * k));
      const hot = h.k * k > 0.72;
      o.push(`<ellipse cx="${h.x}" cy="${h.y}" rx="${h.rx}" ry="${h.ry}"
        fill="${hot ? C.high : C.flow}" opacity="${(0.08 + 0.20 * kk).toFixed(3)}"/>`);
    });
    o.push("</g>");
    F.arrows.forEach(a => o.push(arrowHead(a.x, a.y, a.d, C.flow, 1)));
  }

  /* 研究层：候停点 + 路线 */
  if (L.research) {
    if (L.docks) {
      F.docks.forEach((dk, i) => {
        o.push(`<g class="obj" data-obj="dock" data-i="${i}" style="cursor:pointer">
          <rect x="${dk.x - 26}" y="${dk.y - 26}" width="52" height="52" fill="transparent"/>
          <rect x="${dk.x - 13}" y="${dk.y - 13}" width="26" height="26" fill="#FFFFFF" opacity="0.9"
            stroke="${C.low}" stroke-width="3" stroke-dasharray="5 4"/>
          <text x="${dk.x}" y="${dk.y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#6B7C8A">W</text>
        </g>`);
      });
    }
    (F.robots[variant] || []).forEach(rob => {
      if (!opt.kinds[rob.kind]) return;
      if (rob.slots.indexOf(opt.slot) < 0) return;
      const K = ROBOT_KIND[rob.kind];
      const da = K.dash ? ` stroke-dasharray="${K.dash}"` : "";
      o.push(`<path id="rp-${floorId}-${variant}-${rob.id}" class="route" data-id="${rob.id}" d="${rob.d}" fill="none"
        stroke="${K.col}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"${da} opacity="0.9"/>`);
    });
  }

  /* 提案层（仅 B） */
  if (L.proposal && variant === "B") {
    (F.proposal || []).forEach(p => {
      if (p.kind === "lift") {
        o.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#FFFFFF" opacity="0.9"
          stroke="${C.sec}" stroke-width="4" stroke-dasharray="11 7"/>`);
        o.push(`<path d="M ${p.x + 6},${p.y + 6} L ${p.x + p.w - 6},${p.y + p.h - 6}
          M ${p.x + p.w - 6},${p.y + 6} L ${p.x + 6},${p.y + p.h - 6}"
          stroke="${C.sec}" stroke-width="3" stroke-dasharray="8 5"/>`);
      } else if (p.kind === "bridge") {
        o.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#FFFFFF" opacity="0.9"
          stroke="${C.sec}" stroke-width="4" stroke-dasharray="11 7"/>`);
      } else if (p.kind === "note") {
        o.push(haloText(p.x, p.y, p.text, p.text.indexOf("PROPOSED") === 0 ? 16 : 19,
          { fill: p.text.indexOf("PROPOSED") === 0 ? "#7B6BA8" : "#5B4A82", weight: p.text.indexOf("PROPOSED") === 0 ? 500 : 600 }));
      }
    });
  }

  /* 门（建筑层）：全部「待确认」，虚线 + ? 徽标 */
  if (L.doors && detail) {
    F.doors.forEach(dr => {
      const blocked = doorBlocked(dr);
      o.push(`<g class="obj" data-obj="door" data-id="${dr.id}" style="cursor:pointer">
        <circle cx="${dr.x}" cy="${dr.y}" r="38" fill="transparent"/>
        <circle cx="${dr.x}" cy="${dr.y}" r="19" fill="#FFFFFF" opacity="0.75"/>
        <circle cx="${dr.x}" cy="${dr.y}" r="17" fill="url(#tbcstripe)" stroke="${C.tbc}" stroke-width="3" stroke-dasharray="6 4"/>
        <text x="${dr.x}" y="${dr.y + 7}" text-anchor="middle" font-size="17" font-weight="700" fill="#3E5261">?</text>
        ${blocked ? `<path d="M ${dr.x - 11},${dr.y - 11} L ${dr.x + 11},${dr.y + 11} M ${dr.x + 11},${dr.y - 11} L ${dr.x - 11},${dr.y + 11}" stroke="${C.high}" stroke-width="3.5"/>` : ""}
      </g>`);
    });
  }

  /* 活动层：机器人本体 + 冲突点 */
  if (L.research) {
    (F.robots[variant] || []).forEach(rob => {
      if (!opt.kinds[rob.kind]) return;
      if (rob.slots.indexOf(opt.slot) < 0) return;
      o.push(robotBody(rob));
    });
  }
  if (L.conflicts) {
    (F.conflicts[variant] || []).forEach(cf => {
      if (cf.slots.indexOf(opt.slot) < 0) return;
      const S = SEV[cf.sev], r = S.r;
      o.push(`<g class="obj" data-obj="conflict" data-n="${cf.n}" data-sev="${cf.sev}" style="cursor:pointer">
        <circle cx="${cf.x}" cy="${cf.y}" r="46" fill="transparent"/>`);
      if (cf.sev === "high") o.push(`<circle cx="${cf.x}" cy="${cf.y}" r="${r + 16}" fill="${S.col}" opacity="0.15">
        <animate attributeName="r" values="${r + 8};${r + 22};${r + 8}" dur="1.8s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.22;0.06;0.22" dur="1.8s" repeatCount="indefinite"/></circle>`);
      if (cf.sev === "low") {
        o.push(`<circle cx="${cf.x}" cy="${cf.y}" r="${r}" fill="#FFFFFF" stroke="${S.col}" stroke-width="4"/>`);
      } else {
        o.push(`<circle cx="${cf.x}" cy="${cf.y}" r="${r}" fill="${S.col}" opacity="0.95"/>`);
        o.push(`<path d="M ${cf.x},${cf.y - r - 10} l -9,15 h 18 z" fill="${S.col}"/>`);
        o.push(`<text x="${cf.x}" y="${cf.y + r + 26}" text-anchor="middle" font-size="19" font-weight="700"
          fill="${S.col}" style="paint-order:stroke;stroke:#FFFFFF;stroke-width:5px;stroke-linejoin:round">${cf.n} ${S.name}</text>`);
      }
      o.push("</g>");
    });
  }

  /* 分区标注 */
  if (L.zones && detail) {
    F.zones.forEach((z, i) => o.push(`<text class="obj" data-obj="zone" data-i="${i}" x="${z.x}" y="${z.y}"
      text-anchor="middle" font-size="21" font-weight="600" fill="#20323D"
      style="paint-order:stroke;stroke:#FFFFFF;stroke-width:5px;stroke-linejoin:round">${z.name}</text>`));
  }

  if (!detail) o.push("</g>");

  /* 主出入口（1F） */
  if (F.entrance) {
    o.push(`<path d="M -16,-10 L 16,0 L -16,10 Z M -7,-10 L -7,10"
      transform="translate(${F.entrance.x},${F.entrance.y}) rotate(${F.entrance.rot})" fill="${C.entrance}"/>`);
    o.push(haloText(F.entrance.x - 36, F.entrance.y - 64, F.entrance.label, 20, { fill: "#1D5C7A" }));
  }

  if (edit) o.push(editHandles(floorId));
  o.push("</svg>");
  return o.join("");
}

/* 编辑模式：候选停靠位（吸附点） */
function editHandles(floorId) {
  const F = FLOORS[floorId], o = [];
  F.dockSlots.forEach((s, i) => {
    o.push(`<circle class="dockslot" data-i="${i}" cx="${s.x}" cy="${s.y}" r="22" fill="none"
      stroke="#2C7A9E" stroke-width="2" stroke-dasharray="4 4" opacity="0.55"/>`);
  });
  return o.join("");
}

/* ── POV 预渲染示意（无真实渲染素材时的占位：几何示意，非现场照片） ────── */
function povSVG(pov, w) {
  w = w || 262;
  const h = Math.round(w * 0.5625);
  const tones = [["#EFF3F5", "#E4EAEE", "#DCE3E8"], ["#F1F4F6", "#E6EBEE", "#DAE1E6"],
                 ["#EDF2F4", "#E2E8EC", "#D8DFE4"], ["#F0F4F6", "#E5EAEE", "#D9E0E5"],
                 ["#EEF3F5", "#E3E9ED", "#D9E0E5"], ["#F2F5F7", "#E7ECEF", "#DBE2E7"]];
  const t = tones[pov.tone % tones.length];
  const robotCol = [C.entrance, C.sec, C.guide, C.entrance, C.clean, C.entrance][pov.tone % 6];
  return `<svg viewBox="0 0 320 180" width="${w}" height="${h}">
    <rect width="320" height="180" fill="${t[0]}"/>
    <path d="M0,0 L112,56 L112,144 L0,180 Z" fill="${t[1]}"/>
    <path d="M320,0 L208,56 L208,144 L320,180 Z" fill="${t[2]}"/>
    <path d="M0,0 L320,0 L208,56 L112,56 Z" fill="#F3F6F8"/>
    <path d="M0,180 L320,180 L208,144 L112,144 Z" fill="#D6DDE2"/>
    <rect x="112" y="56" width="96" height="88" fill="#EAEFF2"/>
    <rect x="146" y="68" width="24" height="76" fill="#F7F9FA" stroke="#C9D3DA" stroke-width="1.5"/>
    <rect x="174" y="68" width="24" height="76" fill="#F7F9FA" stroke="#C9D3DA" stroke-width="1.5"/>
    <path d="M112,144 L112,56 M208,144 L208,56" stroke="#C9D3DA" stroke-width="1.2"/>
    <g fill="#8FA0AC">
      <circle cx="120" cy="116" r="7"/><path d="M113,180 q7,-34 14,0 z"/>
      <circle cx="154" cy="108" r="6"/><path d="M148,180 q6,-40 12,0 z"/>
      <circle cx="234" cy="132" r="9"/><path d="M225,180 q9,-30 18,0 z"/>
    </g>
    <g><rect x="196" y="126" width="32" height="22" rx="5" fill="${robotCol}"/>
      <circle cx="212" cy="137" r="4.5" fill="#fff"/>
      <rect x="209" y="116" width="6" height="10" rx="2" fill="${robotCol}"/></g>
    <g fill="#B9C4CC" opacity="0.85"><rect x="28" y="84" width="36" height="4" rx="2"/>
      <rect x="256" y="84" width="36" height="4" rx="2"/></g>
    <rect x="0" y="0" width="320" height="180" fill="none" stroke="#C9D3DA" stroke-width="2"/>
    <text x="130" y="172" font-size="10" fill="#7C8B96" text-anchor="middle">预渲染示意 · 非现场照片</text>
    <text x="10" y="18" font-size="11" font-weight="600" fill="#33454F"
      style="paint-order:stroke;stroke:#fff;stroke-width:4px">${pov.id} ${pov.name}</text>
  </svg>`;
}

/* 门通行判定（PRD §7.2 规则 S2 + 常闭门） */
function doorBlocked(dr) {
  if (dr.type === "禁行") return true;
  if (dr.closed) return true;
  const cl = getParam("clearance") * 2;   // 双侧安全余量
  return Object.keys(ROBOT_KIND).some(k => (dr.w - cl) < ROBOT_KIND[k].width);
}

/* 某扇门对每类机器人的可通行表 */
function doorTable(dr) {
  const cl = getParam("clearance") * 2;
  return Object.keys(ROBOT_KIND).map(k => {
    const K = ROBOT_KIND[k];
    let ok = true, why = "";
    if (dr.type === "禁行") { ok = false; why = "禁止通行区域"; }
    else if (dr.closed) { ok = false; why = "常闭门（未标注可联动开启）"; }
    else if ((dr.w - cl) < K.width) { ok = false; why = `净宽 ${dr.w}m − 双侧余量 ${cl.toFixed(2)}m = ${(dr.w - cl).toFixed(2)}m < 机宽 ${K.width}m`; }
    return { kind: k, name: K.name, glyph: K.glyph, ok: ok, why: why || `余量 ${(dr.w - cl - K.width).toFixed(2)}m ≥ 0` };
  });
}
