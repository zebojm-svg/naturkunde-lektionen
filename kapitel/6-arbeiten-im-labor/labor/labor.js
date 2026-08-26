(() => {
  const canvas = document.getElementById("lab");
  const ctx = canvas.getContext("2d");
  const observeEl = document.getElementById("observe");
  const SUBSTANCES = window.SUBSTANCES;
  const TOOLS = window.TOOLS;

  const MAX = 320;
  const ROOM = 22;

  const state = {
    particles: [],
    bonds: [],
    nextId: 1,
    selected: "A",
    tool: "pointer",
    pointer: { x: 0, y: 0, down: false },
    magnetGrab: [],
    stir: null,
    filter: null,
    decant: null,
    distill: false,
    funnel: [],
    sayUntil: 0,
    sayText: "",
    t: 0,
    W: 800,
    H: 500,
  };

  const vessels = {
    A: makeVessel("A", "Becherglas A"),
    B: makeVessel("B", "Becherglas B"),
  };

  function makeVessel(id, label) {
    return {
      id,
      label,
      x: 0,
      y: 0,
      w: 156,
      h: 214,
      temp: ROOM,
      heating: false,
      thermo: false,
      tilt: 0,
    };
  }

  function inner(v) {
    const tilt = v.tilt || 0;
    return {
      left: v.x + 14 + tilt * 18,
      right: v.x + v.w - 14 + tilt * 8,
      top: v.y + 28,
      bottom: v.y + v.h - 10,
    };
  }

  function layout() {
    const W = state.W;
    const H = state.H;
    const w = Math.min(168, W * 0.28);
    const h = Math.min(230, H * 0.62);
    const y = H * 0.22;
    vessels.A.x = W * 0.14;
    vessels.A.y = y;
    vessels.A.w = w;
    vessels.A.h = h;
    vessels.B.x = W * 0.55;
    vessels.B.y = y;
    vessels.B.w = w;
    vessels.B.h = h;
  }

  function specOf(p) {
    return SUBSTANCES[p.type];
  }

  function inVessel(v, x, y) {
    const b = inner(v);
    return x >= b.left - 8 && x <= b.right + 8 && y >= v.y - 20 && y <= b.bottom + 12;
  }

  function vesselAt(x, y) {
    if (inVessel(vessels.A, x, y)) return "A";
    if (inVessel(vessels.B, x, y)) return "B";
    return null;
  }

  function particlesIn(id) {
    return state.particles.filter((p) => p.vessel === id);
  }

  function liquidTop(id) {
    const v = vessels[id];
    if (!v) return 0;
    const b = inner(v);
    const liquids = particlesIn(id).filter((p) => p.phase === "liquid" || p.phase === "dissolved");
    const area = Math.max(1, (b.right - b.left) * 0.55);
    const fill = liquids.reduce((s, p) => s + p.r * p.r, 0) / area;
    const h = Math.min(b.bottom - b.top - 8, 18 + fill * 140);
    return b.bottom - h;
  }

  function say(text, sec) {
    state.sayText = text;
    state.sayUntil = state.t + (sec || 3.2);
    observeEl.textContent = text;
  }

  function spawnParticle(type, vessel, x, y, extras) {
    if (state.particles.length >= MAX) {
      say("Das Glas ist voll — zuerst etwas entfernen oder filtrieren.", 2.5);
      return null;
    }
    const spec = SUBSTANCES[type];
    const p = {
      id: state.nextId++,
      type,
      vessel,
      x,
      y,
      vx: (Math.random() - 0.5) * 20,
      vy: Math.random() * 8,
      r: spec.r * (0.88 + Math.random() * 0.24),
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 1.2,
      phase: spec.phase,
      seed: Math.random() * 1000,
      dissolve: 0,
      adsorbedTo: null,
      offX: 0,
      offY: 0,
      ...extras,
    };
    state.particles.push(p);
    return p;
  }

  function bond(a, b, k) {
    const rest = Math.hypot(a.x - b.x, a.y - b.y);
    state.bonds.push({ a: a.id, b: b.id, rest: Math.max(rest, a.r + b.r), k: k || 48 });
  }

  function addSubstance(type, vesselId, amountScale) {
    const spec = SUBSTANCES[type];
    const v = vessels[vesselId];
    const b = inner(v);
    const n = Math.round(spec.count * (amountScale || 1));
    const clusterN = spec.cluster || 1;
    let made = 0;
    while (made < n) {
      const take = Math.min(clusterN, n - made);
      const cx = b.left + 16 + Math.random() * (b.right - b.left - 32);
      const liquidish = spec.phase === "liquid" || spec.phase === "dissolved";
      const cy = liquidish
        ? b.top + (b.bottom - b.top) * 0.42 + Math.random() * (b.bottom - b.top) * 0.42
        : b.top + 24 + Math.random() * 70;
      const group = [];
      for (let i = 0; i < take; i++) {
        let px = cx;
        let py = cy;
        if (spec.id === "salt" && take >= 4) {
          const col = i % 3;
          const row = Math.floor(i / 3);
          px = cx + (col - 1) * spec.r * 1.85;
          py = cy + row * spec.r * 1.85;
        } else if (take > 1) {
          const ang = (i / take) * Math.PI * 2 - Math.PI / 2;
          const rad = spec.r * 1.2;
          px = cx + Math.cos(ang) * rad;
          py = cy + Math.sin(ang) * rad;
        }
        const p = spawnParticle(type, vesselId, px, py);
        if (!p) return;
        if (spec.shape === "crystal") p.rot = 0;
        group.push(p);
      }
      if (take > 1) {
        for (let i = 0; i < group.length; i++) {
          bond(group[i], group[(i + 1) % group.length], spec.id === "sugar" ? 70 : 55);
          if (take > 3 && i + 2 < group.length) bond(group[i], group[i + 2], 36);
        }
      }
      made += take;
    }
    say(`${spec.name} ins ${v.label} gegeben.`, 1.6);
  }

  function findP(id) {
    return state.particles.find((p) => p.id === id);
  }

  function breakBondsOf(id) {
    state.bonds = state.bonds.filter((b) => b.a !== id && b.b !== id);
  }

  function solventPresent(p) {
    const spec = specOf(p);
    if (!spec.solubleIn.length) return false;
    return particlesIn(p.vessel).some(
      (q) => spec.solubleIn.includes(q.type) && (q.phase === "liquid" || q.phase === "dissolved")
    );
  }

  function updateDissolve(p, dt, v) {
    const spec = specOf(p);
    if (p.phase === "dissolved") return;
    if (!spec.solubleIn.length) return;
    if (!solventPresent(p)) return;
    const stir = state.stir && state.stir.vessel === p.vessel ? 2.6 : 1;
    const heat = 0.7 + (v.temp - ROOM) / 90;
    p.dissolve += dt * 0.55 * stir * heat;
    if (p.dissolve > 1) {
      p.phase = "dissolved";
      p.r = Math.max(2.4, spec.r * 0.55);
      breakBondsOf(p.id);
      if (spec.id === "sugar") say("Zuckerklümpchen zerfallen — der Zucker löst sich im Wasser.", 3);
      if (spec.id === "salt") say("Salzkristalle zerfallen — das Salz löst sich im Wasser.", 3);
    }
  }

  function updateMelt(p, v) {
    const spec = specOf(p);
    if (spec.melt > 0 && spec.melt < 400) {
      if (v.temp >= spec.melt && p.phase === "solid") {
        p.phase = "liquid";
        breakBondsOf(p.id);
        if (spec.id === "wax") say("Wachs schmilzt und schwimmt als Tropfen oben.", 3);
      } else if (v.temp < spec.melt - 4 && p.type === "wax" && p.phase === "liquid") {
        p.phase = "solid";
      }
    }
  }

  function boilingKind(id) {
    const list = particlesIn(id);
    const nAlc = list.filter((p) => p.type === "alcohol" && p.phase === "liquid").length;
    const nWat = list.filter((p) => p.type === "water" && p.phase === "liquid").length;
    if (nAlc > 0) return { type: "alcohol", bp: 78 };
    if (nWat > 0) return { type: "water", bp: 100 };
    return null;
  }

  function boilOff(id, type, dt) {
    const v = vessels[id];
    v.boilAcc = (v.boilAcc || 0) + dt * 2.2;
    const cand = particlesIn(id).filter((p) => p.type === type && p.phase === "liquid");
    while (v.boilAcc >= 1 && cand.length) {
      v.boilAcc -= 1;
      const p = cand.pop();
      p.phase = "gas";
      p.vy = -40 - Math.random() * 30;
      p.r = specOf(p).r * 1.35;
      if (state.distill) {
        p.vessel = "vapor";
        p.pathT = 0;
      }
    }
    if (type === "alcohol") say("Alkohol siedet — die Temperatur bleibt bei 78 °C stehen.", 2.8);
    if (type === "water") say("Wasser siedet bei 100 °C. Dampf steigt auf.", 2.8);
  }

  function crystallizeIfDry(id) {
    const list = particlesIn(id);
    const liquid = list.filter((p) => p.phase === "liquid").length;
    if (liquid > 3) return;
    list.forEach((p) => {
      if (p.phase === "dissolved" && (p.type === "salt" || p.type === "sugar")) {
        p.phase = "solid";
        p.r = specOf(p).r;
        p.dissolve = 0;
      }
    });
  }

  function updateHeat(dt) {
    Object.values(vessels).forEach((v) => {
      const boil = boilingKind(v.id);
      if (v.heating) {
        if (boil && v.temp >= boil.bp - 0.4) {
          v.temp = boil.bp;
          boilOff(v.id, boil.type, dt);
        } else {
          v.temp = Math.min(130, v.temp + dt * 14);
        }
      } else {
        v.temp += (ROOM - v.temp) * dt * 0.12;
      }
      if (!v.heating && boil && v.temp > boil.bp) v.temp = boil.bp;
      crystallizeIfDry(v.id);
    });
  }

  function distillPath(t) {
    const a = vessels.A;
    const b = vessels.B;
    const x0 = a.x + a.w * 0.55;
    const y0 = a.y + 8;
    const x1 = a.x + a.w * 0.55;
    const y1 = a.y - 52;
    const x2 = b.x + b.w * 0.45;
    const y2 = b.y - 52;
    const x3 = b.x + b.w * 0.45;
    const y3 = b.y + 24;
    const pts = [
      [x0, y0],
      [x1, y1],
      [x2, y2],
      [x3, y3],
    ];
    const seg = Math.min(2.999, t * 3);
    const i = Math.floor(seg);
    const f = seg - i;
    return {
      x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
      y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      condensing: i >= 2,
    };
  }

  function updateVapor(dt) {
    state.particles.forEach((p) => {
      if (p.phase !== "gas") return;
      if (p.vessel === "vapor") {
        p.pathT = (p.pathT || 0) + dt * 0.55;
        const pos = distillPath(Math.min(1, p.pathT));
        p.x = pos.x + (Math.random() - 0.5) * 6;
        p.y = pos.y + (Math.random() - 0.5) * 6;
        if (pos.condensing || p.pathT >= 1) {
          p.phase = "liquid";
          p.vessel = "B";
          p.r = specOf(p).r;
          p.vx = 0;
          p.vy = 20;
          say("Dampf wird im Kühler wieder flüssig — Destillat in Becherglas B.", 3);
        }
        return;
      }
      p.vy -= 80 * dt;
      p.y += p.vy * dt;
      if (p.y < vessels[p.vessel]?.y - 80 || p.y < 8) {
        p.dead = true;
        say("Dampf entweicht. Gelöste Feststoffe bleiben zurück (Eindampfen).", 3);
      }
    });
    state.particles = state.particles.filter((p) => !p.dead);
  }

  function updateAdsorb() {
    const byVessel = {};
    state.particles.forEach((p) => {
      if (!byVessel[p.vessel]) byVessel[p.vessel] = [];
      byVessel[p.vessel].push(p);
    });
    Object.values(byVessel).forEach((list) => {
      const coals = list.filter((p) => specOf(p).adsorbs);
      if (!coals.length) return;
      list.forEach((p) => {
        const spec = specOf(p);
        if (!spec.adsorbedBy.includes("charcoal")) return;
        if (p.adsorbedTo) {
          const host = findP(p.adsorbedTo);
          if (!host) {
            p.adsorbedTo = null;
            return;
          }
          p.x = host.x + p.offX;
          p.y = host.y + p.offY;
          p.vessel = host.vessel;
          p.vx = host.vx;
          p.vy = host.vy;
          return;
        }
        coals.forEach((c) => {
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < c.r + 16) {
            p.adsorbedTo = c.id;
            p.offX = (p.x - c.x) * 0.4;
            p.offY = (p.y - c.y) * 0.4;
            p.phase = "solid";
            say("Tinte bleibt an der Aktivkohle hängen (Adsorbieren).", 3);
          }
        });
      });
    });
  }

  function updateMagnet(dt) {
    if (state.tool !== "magnet") {
      if (state.magnetGrab.length) {
        const v = vesselAt(state.pointer.x, state.pointer.y) || state.selected;
        state.magnetGrab.forEach((id) => {
          const p = findP(id);
          if (p) p.vessel = v;
        });
        state.magnetGrab = [];
      }
      return;
    }
    const mx = state.pointer.x;
    const my = state.pointer.y;
    state.particles.forEach((p) => {
      if (!specOf(p).magnetic) return;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < 130 || state.magnetGrab.includes(p.id)) {
        p.vx += ((mx - p.x) * 14 - p.vx) * dt * 8;
        p.vy += ((my - p.y + 18) * 14 - p.vy) * dt * 8;
        if (d < 22 && !state.magnetGrab.includes(p.id)) {
          state.magnetGrab.push(p.id);
          p.vessel = "magnet";
          say("Eisenpulver klebt am Magnet — Aluminium bleibt liegen.", 3);
        }
      }
    });
    state.magnetGrab.forEach((id, i) => {
      const p = findP(id);
      if (!p) return;
      p.x = mx + Math.cos(i * 1.1) * 8;
      p.y = my + 20 + Math.sin(i * 1.1) * 8;
      p.vx = 0;
      p.vy = 0;
      p.vessel = "magnet";
    });
  }

  function updateStir(dt) {
    if (!state.stir) return;
    state.stir.t -= dt;
    if (state.stir.t <= 0) {
      state.stir = null;
      return;
    }
    const v = vessels[state.stir.vessel];
    const b = inner(v);
    const cx = (b.left + b.right) / 2;
    const cy = (liquidTop(v.id) + b.bottom) / 2;
    particlesIn(v.id).forEach((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      p.vx += -dy * 6 * dt * 18;
      p.vy += dx * 6 * dt * 18;
    });
  }

  function updateFilter(dt) {
    if (!state.filter) return;
    const f = state.filter;
    f.t += dt;
    const from = f.from;
    const to = f.to;
    const funnelX = (vessels.A.x + vessels.A.w + vessels.B.x) / 2;
    const funnelY = vessels.A.y + 8;
    if (!f.started) {
      f.started = true;
      particlesIn(from).forEach((p) => {
        p.vessel = "transit";
        p.pass = canPassFilter(p);
      });
    }
    const moving = state.particles.filter((p) => p.vessel === "transit");
    moving.forEach((p) => {
      p.x += (funnelX - p.x) * dt * 3.2;
      p.y += (funnelY - p.y) * dt * 2.4;
      if (Math.hypot(p.x - funnelX, p.y - funnelY) < 22) {
        if (p.pass) {
          p.vessel = to;
          p.x = vessels[to].x + vessels[to].w * 0.5 + (Math.random() - 0.5) * 30;
          p.y = vessels[to].y + 40;
          p.vy = 40;
        } else {
          p.vessel = "funnel";
          p.x = funnelX + (Math.random() - 0.5) * 18;
          p.y = funnelY + 10 + Math.random() * 24;
        }
      }
    });
    if (f.t > 2.8 || moving.length === 0) {
      state.particles.forEach((p) => {
        if (p.vessel === "transit") p.vessel = p.pass ? to : "funnel";
      });
      state.filter = null;
      const n = state.particles.filter((p) => p.vessel === "funnel").length;
      say(
        n
          ? `Filtrat in ${vessels[to].label}. Rückstand bleibt im Filter.`
          : `Alles ist durch den Filter gelaufen.`,
        3.5
      );
    }
  }

  function canPassFilter(p) {
    if (p.adsorbedTo) return false;
    if (p.phase === "dissolved" || p.phase === "liquid" || p.phase === "gas") return true;
    return !!specOf(p).passesFilter;
  }

  function updateDecant(dt) {
    if (!state.decant) return;
    const d = state.decant;
    d.t += dt;
    const from = vessels[d.from];
    const to = vessels[d.to];
    from.tilt = Math.min(0.9, d.t * 1.4);
    const targetX = to.x + 20;
    const targetY = to.y + 36;
    particlesIn(from.id).forEach((p) => {
      if (!canDecant(p, from.id)) return;
      p.vessel = "transit";
      p.x += (targetX - p.x) * dt * 2.5;
      p.y += (targetY - p.y) * dt * 1.6;
    });
    state.particles.forEach((p) => {
      if (p.vessel !== "transit") return;
      p.x += (targetX - p.x) * dt * 2.5;
      p.y += (targetY - p.y) * dt * 1.6;
      if (p.x > (from.x + from.w + to.x) / 2) {
        p.vessel = to.id;
        p.vy = 30;
      }
    });
    if (d.t > 2.6) {
      state.particles.forEach((p) => {
        if (p.vessel === "transit") p.vessel = to.id;
      });
      from.tilt = 0;
      state.decant = null;
      say("Flüssigkeit (und was schwimmt) wurde abgegossen — Dekantieren.", 3);
    }
  }

  function canDecant(p, fromId) {
    if (p.phase === "liquid" || p.phase === "dissolved" || p.phase === "gas") return true;
    const spec = specOf(p);
    if (spec.density < 0.5) return true;
    if (p.phase === "liquid" && spec.density < 1) return true;
    const top = liquidTop(fromId);
    if (spec.density < 1 && p.y < top + 14) return true;
    return false;
  }

  function applyPhysics(dt) {
    const g = 520;
    state.particles.forEach((p) => {
      if (p.vessel === "magnet" || p.vessel === "vapor" || p.vessel === "transit") return;
      if (p.adsorbedTo) return;
      const spec = specOf(p);
      const v = vessels[p.vessel];
      if (!v) {
        if (p.vessel === "funnel") {
          p.vy += g * 0.15 * dt;
          p.vx *= 0.9;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const fx = (vessels.A.x + vessels.A.w + vessels.B.x) / 2;
          const fy = vessels.A.y + 18;
          p.x += (fx - p.x) * dt * 2;
          p.y = Math.min(fy + 48, Math.max(fy, p.y));
          return;
        }
        return;
      }
      const b = inner(v);
      const ltop = liquidTop(v.id);
      const inLiq = p.y > ltop - 4 && p.phase !== "gas";
      const brown = (v.temp / 26) * (p.phase === "gas" ? 3 : p.phase === "liquid" || p.phase === "dissolved" ? 1.2 : 0.35);
      p.vx += (Math.random() - 0.5) * brown * 90 * dt;
      p.vy += (Math.random() - 0.5) * brown * 70 * dt;

      if (p.phase === "gas") {
        p.vy -= 90 * dt;
      } else {
        const dens = p.phase === "dissolved" ? 1.02 : spec.density;
        if (inLiq) {
          p.vy += g * dt * Math.max(-2.2, Math.min(2.8, dens - 1)) * 0.55;
          p.vy += g * dt * 0.08;
        } else {
          p.vy += g * dt;
        }
      }

      const drag = inLiq ? 5.5 : p.phase === "gas" ? 1.4 : 0.7;
      p.vx *= Math.max(0, 1 - drag * dt);
      p.vy *= Math.max(0, 1 - drag * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;

      if (p.x < b.left + p.r) {
        p.x = b.left + p.r;
        p.vx *= -0.25;
      }
      if (p.x > b.right - p.r) {
        p.x = b.right - p.r;
        p.vx *= -0.25;
      }
      if (p.y > b.bottom - p.r) {
        p.y = b.bottom - p.r;
        p.vy *= -0.18;
        p.vx *= 0.86;
      }
      if (p.y < b.top + p.r && p.phase !== "gas") {
        p.y = b.top + p.r;
        p.vy *= 0.2;
      }

      updateDissolve(p, dt, v);
      updateMelt(p, v);
    });
  }

  function solveBonds(dt) {
    const map = new Map(state.particles.map((p) => [p.id, p]));
    state.bonds = state.bonds.filter((bond) => {
      const a = map.get(bond.a);
      const b = map.get(bond.b);
      if (!a || !b) return false;
      if (a.phase === "dissolved" || b.phase === "dissolved") return false;
      if (a.phase === "liquid" && b.phase === "liquid" && specOf(a).id === "wax") return false;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist > bond.rest * 3.6) return false;
      const diff = dist - bond.rest;
      const f = (diff * bond.k) * dt * 0.08;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x += nx * f;
      a.y += ny * f;
      b.x -= nx * f;
      b.y -= ny * f;
      a.vx += nx * f * 8;
      a.vy += ny * f * 8;
      b.vx -= nx * f * 8;
      b.vy -= ny * f * 8;
      return true;
    });
  }

  function collide() {
    const list = state.particles.filter((p) => p.vessel !== "vapor" && p.phase !== "gas");
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.vessel !== b.vessel) continue;
        if (a.vessel === "transit" || a.vessel === "funnel") continue;
        if (a.adsorbedTo || b.adsorbedTo) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const dist = Math.sqrt(d2);
        const overlap = (min - dist) * 0.46;
        const nx = dx / dist;
        const ny = dy / dist;
        const ma = specOf(a).density;
        const mb = specOf(b).density;
        const s = ma + mb;
        a.x -= nx * overlap * (mb / s);
        a.y -= ny * overlap * (mb / s);
        b.x += nx * overlap * (ma / s);
        b.y += ny * overlap * (ma / s);
        const dv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (dv < 0) {
          a.vx += nx * dv * 0.35;
          a.vy += ny * dv * 0.35;
          b.vx -= nx * dv * 0.35;
          b.vy -= ny * dv * 0.35;
        }
      }
    }
  }

  function autoObserve() {
    if (state.t < state.sayUntil) return;
    const id = state.selected;
    const v = vessels[id];
    const list = particlesIn(id);
    if (!list.length) {
      observeEl.textContent = `${v.label} ist leer. Stoff rechts antippen, um Teilchen einzufüllen.`;
      return;
    }
    const names = {};
    list.forEach((p) => {
      const n = specOf(p).name;
      names[n] = names[n] || { n, solid: 0, liq: 0, dis: 0, gas: 0 };
      if (p.phase === "solid") names[n].solid++;
      else if (p.phase === "dissolved") names[n].dis++;
      else if (p.phase === "gas") names[n].gas++;
      else names[n].liq++;
    });
    const bits = Object.values(names).map((x) => {
      const st = [];
      if (x.solid) st.push("fest");
      if (x.liq) st.push("flüssig");
      if (x.dis) st.push("gelöst");
      if (x.gas) st.push("gasförmig");
      return `${x.n} (${st.join(", ")})`;
    });
    const extra = [];
    if (v.heating) extra.push("Brenner an");
    if (state.distill) extra.push("Destillation aufgebaut");
    if (state.particles.some((p) => p.vessel === "funnel")) extra.push("Rückstand im Filter");
    observeEl.textContent = `${v.label}, ${Math.round(v.temp)} °C: ${bits.join(" · ")}${extra.length ? " — " + extra.join(", ") : ""}`;
  }

  function drawParticle(p) {
    const spec = specOf(p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.phase === "gas") ctx.globalAlpha = 0.32;
    else if (p.phase === "dissolved") ctx.globalAlpha = 0.72;
    else if (p.phase === "liquid" && (p.type === "water" || p.type === "alcohol")) ctx.globalAlpha = 0.78;
    const r = p.r;
    if (spec.shape === "crystal") {
      roundedPoly(r * 1.6, r * 1.6, 4, 1.4, spec.color, spec.stroke);
    } else if (spec.shape === "grain") {
      blob(r, 5, p.seed, spec.color, spec.stroke);
    } else if (spec.shape === "flake") {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.2, r * 0.7, 0, 0, Math.PI * 2);
      fillStroke(spec.color, spec.stroke);
    } else if (spec.shape === "foam") {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      fillStroke(spec.color, spec.stroke);
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = "#ddd";
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.2, r * 0.28, 0, Math.PI * 2);
      ctx.arc(r * 0.25, r * 0.15, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else if (spec.shape === "chunk") {
      blob(r, 6, p.seed, spec.color, spec.stroke);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      fillStroke(spec.color, spec.stroke);
      ctx.globalAlpha *= 0.35;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function fillStroke(fill, stroke) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
  }

  function blob(r, n, seed, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.78 + ((Math.sin(seed + i * 2.1) + 1) / 2) * 0.45);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(fill, stroke);
  }

  function roundedPoly(w, h, n, radius, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * w * 0.55;
      const y = Math.sin(a) * h * 0.55;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(fill, stroke);
  }

  function drawBench() {
    const W = state.W;
    const H = state.H;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#c5d6e0");
    g.addColorStop(0.55, "#d9e4ea");
    g.addColorStop(0.55, "#b08958");
    g.addColorStop(1, "#8c6233");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    for (let y = 12; y < H * 0.55; y += 28) {
      for (let x = 8; x < W; x += 46) {
        ctx.fillRect(x, y, 42, 24);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,.08)";
    ctx.fillRect(0, H * 0.55, W, 10);
  }

  function beakerPath(v) {
    const { x, y, w, h } = v;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 18);
    ctx.lineTo(x + 18, y + h - 8);
    ctx.quadraticCurveTo(x + w / 2, y + h + 4, x + w - 18, y + h - 8);
    ctx.lineTo(x + w - 8, y + 18);
    ctx.closePath();
  }

  function drawLiquidTint(v) {
    const list = particlesIn(v.id);
    if (!list.length) return;
    const waters = list.filter((p) => p.type === "water" && p.phase !== "gas").length;
    const alcs = list.filter((p) => p.type === "alcohol" && p.phase !== "gas").length;
    const inks = list.filter((p) => p.type === "ink").length;
    if (!waters && !alcs && !inks) return;
    const top = liquidTop(v.id);
    const b = inner(v);
    ctx.save();
    beakerPath(v);
    ctx.clip();
    let col = "rgba(61,155,233,0.16)";
    if (alcs && waters) col = "rgba(70,180,190,0.16)";
    else if (alcs) col = "rgba(94,207,179,0.16)";
    if (inks) col = "rgba(91,44,145,0.22)";
    ctx.fillStyle = col;
    ctx.fillRect(b.left - 8, top, b.right - b.left + 16, b.bottom - top + 12);
    ctx.restore();
  }

  function drawBeaker(v) {
    const { x, y, w, h } = v;
    ctx.save();
    if (v.tilt) {
      ctx.translate(x + w, y + h);
      ctx.rotate(-v.tilt * 0.45);
      ctx.translate(-(x + w), -(y + h));
    }
    ctx.fillStyle = "rgba(0,0,0,.12)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h - 2, w * 0.42, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    const glass = ctx.createLinearGradient(x, y, x + w, y);
    glass.addColorStop(0, "rgba(255,255,255,.38)");
    glass.addColorStop(0.2, "rgba(170,205,225,.22)");
    glass.addColorStop(0.85, "rgba(170,205,225,.18)");
    glass.addColorStop(1, "rgba(255,255,255,.4)");
    ctx.fillStyle = glass;
    beakerPath(v);
    ctx.fill();
    ctx.strokeStyle = state.selected === v.id ? "#0e7ab4" : "rgba(40,70,90,.55)";
    ctx.lineWidth = state.selected === v.id ? 3 : 1.5;
    ctx.stroke();

    ctx.strokeStyle = "rgba(40,70,90,.28)";
    ctx.lineWidth = 1;
    const b = inner(v);
    for (let i = 1; i <= 4; i++) {
      const yy = b.bottom - (b.bottom - b.top) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(b.left + 6, yy);
      ctx.lineTo(b.left + 18, yy);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(x + 10, y + 8, w - 20, 10);
    ctx.strokeStyle = "rgba(40,70,90,.4)";
    ctx.strokeRect(x + 10, y + 8, w - 20, 10);

    ctx.fillStyle = state.selected === v.id ? "#0e7ab4" : "#33444c";
    ctx.font = "700 13px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(v.label, x + w / 2, y + h + 22);
    ctx.restore();
  }

  function drawBurner(v) {
    if (!v.heating) return;
    const x = v.x + v.w / 2;
    const y = v.y + v.h + 8;
    ctx.fillStyle = "#3a3f48";
    ctx.fillRect(x - 16, y + 18, 32, 10);
    ctx.fillRect(x - 6, y + 4, 12, 16);
    const t = state.t;
    for (let i = 0; i < 7; i++) {
      const ox = (i - 3) * 4;
      const h = 16 + Math.sin(t * 14 + i) * 6;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = i % 2 ? "#ffd36a" : "#ff7a18";
      ctx.beginPath();
      ctx.moveTo(x + ox - 3, y + 4);
      ctx.quadraticCurveTo(x + ox, y + 4 - h, x + ox + 3, y + 4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawThermo(v) {
    if (!v.thermo) return;
    const x = v.x + v.w - 22;
    const top = v.y + 36;
    const bot = v.y + v.h - 28;
    ctx.strokeStyle = "#8aa0aa";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
    ctx.fillStyle = "#d94c3d";
    ctx.beginPath();
    ctx.arc(x, bot + 6, 6, 0, Math.PI * 2);
    ctx.fill();
    const frac = Math.max(0, Math.min(1, (v.temp - 0) / 120));
    ctx.strokeStyle = "#d94c3d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, bot);
    ctx.lineTo(x, bot - (bot - top) * frac);
    ctx.stroke();
    ctx.fillStyle = "#1a2428";
    ctx.font = "700 14px Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(v.temp)} °C`, x + 10, top + 8);
  }

  function drawFunnel() {
    const residue = state.particles.some((p) => p.vessel === "funnel") || state.filter;
    if (!residue && state.tool !== "filter") return;
    const fx = (vessels.A.x + vessels.A.w + vessels.B.x) / 2;
    const fy = vessels.A.y - 6;
    ctx.fillStyle = "rgba(180,210,225,.45)";
    ctx.strokeStyle = "rgba(40,70,90,.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx - 38, fy);
    ctx.lineTo(fx + 38, fy);
    ctx.lineTo(fx + 8, fy + 48);
    ctx.lineTo(fx + 8, fy + 70);
    ctx.lineTo(fx - 8, fy + 70);
    ctx.lineTo(fx - 8, fy + 48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#b84f0f";
    ctx.font = "700 11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Filter", fx, fy - 6);
  }

  function drawDistill() {
    if (!state.distill && state.tool !== "distill") return;
    const a = vessels.A;
    const b = vessels.B;
    ctx.strokeStyle = "rgba(80,120,150,.7)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x + a.w * 0.55, a.y + 10);
    ctx.lineTo(a.x + a.w * 0.55, a.y - 52);
    ctx.lineTo(b.x + b.w * 0.45, b.y - 52);
    ctx.lineTo(b.x + b.w * 0.45, b.y + 18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(61,155,233,.55)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w * 0.45 - 30, b.y - 40);
    ctx.lineTo(b.x + b.w * 0.45 + 4, b.y + 4);
    ctx.stroke();
    ctx.fillStyle = "#0e7ab4";
    ctx.font = "700 12px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Kühler", b.x + b.w * 0.45 - 48, b.y - 18);
  }

  function drawMagnet() {
    if (state.tool !== "magnet") return;
    const x = state.pointer.x;
    const y = state.pointer.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.4);
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(-10, -28, 20, 22);
    ctx.fillStyle = "#3a5fcd";
    ctx.fillRect(-10, -8, 20, 22);
    ctx.fillStyle = "#ddd";
    ctx.fillRect(-4, -28, 8, 42);
    ctx.restore();
  }

  function drawStir() {
    if (!state.stir) return;
    const v = vessels[state.stir.vessel];
    const b = inner(v);
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.t * 8);
    ctx.strokeStyle = "rgba(180,220,230,.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.lineTo(0, 36);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    drawBench();
    drawDistill();
    drawFunnel();
    drawBeaker(vessels.A);
    drawBeaker(vessels.B);
    drawLiquidTint(vessels.A);
    drawLiquidTint(vessels.B);
    drawStir();
    const inside = [];
    const outside = [];
    state.particles.forEach((p) => {
      if (p.vessel === "A" || p.vessel === "B") inside.push(p);
      else outside.push(p);
    });
    inside.sort((a, b) => a.y - b.y);
    ["A", "B"].forEach((id) => {
      const v = vessels[id];
      ctx.save();
      beakerPath(v);
      ctx.clip();
      inside.filter((p) => p.vessel === id).forEach(drawParticle);
      ctx.restore();
    });
    outside.sort((a, b) => a.y - b.y);
    outside.forEach(drawParticle);
    drawBurner(vessels.A);
    drawBurner(vessels.B);
    drawThermo(vessels.A);
    drawThermo(vessels.B);
    drawMagnet();
    ctx.fillStyle = "rgba(26,36,40,.55)";
    ctx.font = "600 12px Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText(toolTip(), 14, 22);
  }

  function toolTip() {
    switch (state.tool) {
      case "pointer":
        return "Becherglas antippen = auswählen. Stoff rechts = einfüllen.";
      case "stir":
        return "Rühren: Becherglas antippen.";
      case "heat":
        return "Brenner: Becherglas antippen (an/aus).";
      case "thermo":
        return "Thermometer: ins Becherglas stellen / herausnehmen.";
      case "filter":
        return "Filtrieren: zuerst Gemisch, dann Auffangglas antippen.";
      case "distill":
        return "Destillieren: Apparatur an/aus. Dann Brenner unter A.";
      case "magnet":
        return "Magnet über das Glas ziehen, dann über dem Zielglas loslassen.";
      case "decant":
        return "Dekantieren: zuerst volles Glas, dann Auffangglas.";
      case "empty":
        return "Leeren: Becherglas antippen (Teilchen weg).";
      default:
        return "";
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    state.t += dt;
    updateHeat(dt);
    updateStir(dt);
    updateFilter(dt);
    updateDecant(dt);
    updateVapor(dt);
    applyPhysics(dt);
    solveBonds(dt);
    collide();
    updateAdsorb();
    updateMagnet(dt);
    autoObserve();
    render();
    requestAnimationFrame(loop);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.W = rect.width;
    state.H = rect.height;
    layout();
  }

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] || e.changedTouches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  let filterPick = null;
  let decantPick = null;

  function onDown(e) {
    const pos = pointerPos(e);
    state.pointer.x = pos.x;
    state.pointer.y = pos.y;
    state.pointer.down = true;
    const hit = vesselAt(pos.x, pos.y);
    const funnelHit = (() => {
      const fx = (vessels.A.x + vessels.A.w + vessels.B.x) / 2;
      const fy = vessels.A.y + 20;
      return Math.hypot(pos.x - fx, pos.y - fy) < 42;
    })();

    if (state.tool === "magnet" && hit && state.magnetGrab.length) {
      state.magnetGrab.forEach((id) => {
        const p = findP(id);
        if (p) {
          p.vessel = hit;
          p.x = vessels[hit].x + vessels[hit].w / 2;
          p.y = vessels[hit].y + 40;
        }
      });
      state.magnetGrab = [];
      say("Eisenpulver im Zielglas abgelegt.", 2.4);
      return;
    }

    if (funnelHit && state.particles.some((p) => p.vessel === "funnel")) {
      const dest = state.selected;
      state.particles.forEach((p) => {
        if (p.vessel === "funnel") {
          p.vessel = dest;
          p.x = vessels[dest].x + vessels[dest].w * 0.5;
          p.y = vessels[dest].y + 36;
        }
      });
      say(`Rückstand nach ${vessels[dest].label} gegeben.`, 2.4);
      return;
    }

    if (!hit) return;

    if (state.tool === "pointer") {
      state.selected = hit;
      return;
    }
    if (state.tool === "stir") {
      state.selected = hit;
      state.stir = { vessel: hit, t: 2.4 };
      say("Rühren mischt und beschleunigt das Lösen.", 2.2);
      return;
    }
    if (state.tool === "heat") {
      vessels[hit].heating = !vessels[hit].heating;
      state.selected = hit;
      say(vessels[hit].heating ? "Brenner an — Teilchen werden schneller." : "Brenner aus.", 2.2);
      return;
    }
    if (state.tool === "thermo") {
      vessels[hit].thermo = !vessels[hit].thermo;
      state.selected = hit;
      return;
    }
    if (state.tool === "empty") {
      state.particles = state.particles.filter((p) => p.vessel !== hit);
      state.bonds = state.bonds.filter((b) => findP(b.a) && findP(b.b));
      say(`${vessels[hit].label} geleert.`, 1.8);
      return;
    }
    if (state.tool === "distill") {
      state.selected = hit;
      if (!state.distill) {
        state.distill = true;
        vessels.A.thermo = true;
        say("Destillation aufgebaut. Jetzt Brenner unter Becherglas A.", 3);
      }
      return;
    }
    if (state.tool === "filter") {
      if (!filterPick) {
        filterPick = hit;
        say("Jetzt das Auffangglas antippen.", 2);
      } else {
        if (filterPick === hit) {
          filterPick = null;
          return;
        }
        state.filter = { from: filterPick, to: hit, t: 0 };
        filterPick = null;
        say("Gemisch läuft durch den Filter …", 2);
      }
      return;
    }
    if (state.tool === "decant") {
      if (!decantPick) {
        decantPick = hit;
        say("Jetzt das Auffangglas antippen.", 2);
      } else {
        state.decant = { from: decantPick, to: hit, t: 0 };
        decantPick = null;
      }
    }
  }

  function onMove(e) {
    const pos = pointerPos(e);
    state.pointer.x = pos.x;
    state.pointer.y = pos.y;
  }

  function onUp() {
    state.pointer.down = false;
  }

  function resetAll() {
    state.particles = [];
    state.bonds = [];
    state.magnetGrab = [];
    state.stir = null;
    state.filter = null;
    state.decant = null;
    state.distill = false;
    filterPick = null;
    decantPick = null;
    Object.values(vessels).forEach((v) => {
      v.temp = ROOM;
      v.heating = false;
      v.thermo = false;
      v.tilt = 0;
    });
    state.selected = "A";
    state.tool = "pointer";
    syncToolButtons();
    say("Labor geleert. Stoff wählen und ins Glas geben.", 3);
  }

  function startScenario(key) {
    resetAll();
    document.getElementById("intro").classList.add("hidden");
    if (key === "free") return;
    if (key === "salt") {
      addSubstance("sand", "A");
      addSubstance("salt", "A");
      addSubstance("water", "A");
      say("Steinsalz-Gemisch. Rühren, filtrieren, dann Filtrat erhitzen (eindampfen).", 5);
    } else if (key === "float") {
      addSubstance("sand", "A");
      addSubstance("styrofoam", "A");
      addSubstance("water", "A");
      say("Styropor schwimmt, Sand sinkt. Dekantieren trennt die Flüssigkeit.", 4.5);
    } else if (key === "magnet") {
      addSubstance("iron", "A");
      addSubstance("alu", "A");
      addSubstance("sand", "A");
      setTool("magnet");
      say("Zieh den Magnet über das Glas: nur Eisen folgt.", 4);
    } else if (key === "distill") {
      addSubstance("water", "A");
      addSubstance("alcohol", "A");
      state.distill = true;
      vessels.A.thermo = true;
      setTool("heat");
      say("Brenner an: zuerst bleibt die Temperatur bei 78 °C (Alkohol), später 100 °C (Wasser).", 5.5);
    } else if (key === "adsorb") {
      addSubstance("water", "A");
      addSubstance("ink", "A");
      addSubstance("charcoal", "A");
      say("Aktivkohle bindet Tinte. Danach filtrieren — das Filtrat wird heller.", 5);
    }
  }

  function setTool(id) {
    state.tool = id;
    filterPick = null;
    decantPick = null;
    syncToolButtons();
  }

  function syncToolButtons() {
    document.querySelectorAll(".tool").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === state.tool);
    });
  }

  function buildUI() {
    const tools = document.getElementById("tools");
    tools.innerHTML = `<div class="col-title">Werkzeuge</div>`;
    TOOLS.forEach((t) => {
      const b = document.createElement("button");
      b.className = "tool" + (t.id === "pointer" ? " active" : "");
      b.dataset.tool = t.id;
      b.type = "button";
      b.innerHTML = `<span class="ico">${t.icon}</span>${t.name}`;
      b.addEventListener("click", () => {
        if (t.id === "distill") {
          state.distill = !state.distill;
          vessels.A.thermo = state.distill || vessels.A.thermo;
          say(state.distill ? "Destillation aufgebaut. Becherglas A erhitzen." : "Apparatur abgebaut.", 3);
        }
        setTool(t.id);
      });
      tools.appendChild(b);
    });

    const shelf = document.getElementById("shelf");
    shelf.innerHTML = `<div class="col-title">Stoffe</div>`;
    Object.values(SUBSTANCES).forEach((s) => {
      const b = document.createElement("button");
      b.className = "jar" + (s.extra ? " extra" : "");
      b.type = "button";
      b.title = s.hint;
      b.innerHTML = `<span class="swatch" style="background:${s.color};border-color:${s.stroke}"></span><span><span class="nm">${s.name}</span><span class="sub">${s.short}</span></span>`;
      b.addEventListener("click", () => {
        addSubstance(s.id, state.selected);
        observeEl.textContent = s.hint;
      });
      shelf.appendChild(b);
    });

    const bar = document.getElementById("examples");
    const chips = [
      ["free", "Frei"],
      ["salt", "Steinsalz"],
      ["float", "Schwimmen"],
      ["magnet", "Magnet"],
      ["distill", "Destillieren"],
      ["adsorb", "Adsorbieren"],
    ];
    chips.forEach(([k, n]) => {
      const c = document.createElement("button");
      c.className = "chip";
      c.type = "button";
      c.textContent = n;
      c.addEventListener("click", () => startScenario(k));
      bar.appendChild(c);
    });

    document.getElementById("btnReset").addEventListener("click", resetAll);
    document.getElementById("btnHelp").addEventListener("click", () => {
      document.getElementById("intro").classList.remove("hidden");
    });
    document.getElementById("intro").addEventListener("click", (e) => {
      const start = e.target.closest("[data-start]");
      if (start) startScenario(start.dataset.start);
      else if (e.target.id === "intro") document.getElementById("intro").classList.add("hidden");
    });
  }

  window.addEventListener("resize", resize);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  buildUI();
  resize();
  const start = new URLSearchParams(location.search).get("start");
  if (start) startScenario(start);
  requestAnimationFrame(loop);
})();
