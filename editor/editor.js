(function(){
  "use strict";

  var SECTION_NAMES = {
    read_react: "Offensive Automatics",
    offense_8sec: "8-Sekunden-Offense",
    pick_and_roll: "Pick and Roll",
    defense_221: "2-2-1 Press",
    drills: "Drills"
  };

  var ACTION_SPECS = {
    move:    { clicks:["player","point"],  build:function(c){ return {type:"move",    id:c[0], to:c[1]}; } },
    dribble: { clicks:["player","point"],  build:function(c){ return {type:"dribble", id:c[0], to:c[1]}; } },
    screen:  { clicks:["player","point"],  build:function(c){ return {type:"screen",  id:c[0], to:c[1]}; } },
    pass:    { clicks:["player","player"], build:function(c){ return {type:"pass",    from:c[0], to:c[1]}; } },
    switch:  { clicks:["player","player"], build:function(c){ return {type:"switch",  players:[c[0], c[1]]}; } },
    help:    { clicks:["player","player"], build:function(c){ return {type:"help",    id:c[0], target:c[1]}; } },
    beat:    { clicks:["player"],          build:function(c){ return {type:"beat",    id:c[0]}; } },
    block:   { clicks:["player","player"], build:function(c){ return {type:"block",   id:c[0], target:c[1]}; } },
    ball:    { clicks:["player"],          build:null }
  };
  var TOOL_NAMES = {move:"Move/Cut", dribble:"Dribble", screen:"Screen", pass:"Pass", switch:"Switch",
    help:"Help", beat:"Beat", block:"Block", ball:"Ball setzen", _via:"Kurvenpunkt"};

  var state = {
    root: null,
    diagrams: [],
    containers: [],
    currentEntry: null,
    current: null,     // { diagram }
    listCtx: {kind:"main"},
    stepIndex: 0
  };
  var armed = null;     // { type, clicks:[...], collected:[...], targetAction? }
  var dragging = null;
  var fileHandle = null;

  // ---- Undo/Redo (snapshot-based over state.root) --------------------------
  var undoStack = [], redoStack = [];
  var MAX_HISTORY = 60;

  function snapshot(){
    if (!state.root) return;
    undoStack.push(JSON.stringify(state.root));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }

  function restoreFrom(json){
    var trail = state.currentEntry ? state.currentEntry.trail : null;
    var listCtx = state.listCtx, stepIndex = state.stepIndex;
    state.root = JSON.parse(json);
    rebuildIndex();
    state.currentEntry = null; state.current = null; state.listCtx = {kind:"main"}; state.stepIndex = 0;
    if (trail){
      var trailKey = trail.join(".");
      var entry = state.diagrams.filter(function(e){ return e.trail.join(".") === trailKey; })[0];
      if (entry){
        state.currentEntry = entry;
        state.current = { diagram: entry.diagram };
        state.listCtx = (listCtx.kind === "option" && !entry.diagram.branch) ? {kind:"main"} : listCtx;
        state.stepIndex = stepIndex;
      }
    }
    disarm();
    renderAll();
  }

  function undo(){
    if (undoStack.length === 0) return;
    var snap = undoStack.pop();
    redoStack.push(JSON.stringify(state.root));
    restoreFrom(snap);
    updateHistoryButtons();
  }
  function redo(){
    if (redoStack.length === 0) return;
    var snap = redoStack.pop();
    undoStack.push(JSON.stringify(state.root));
    restoreFrom(snap);
    updateHistoryButtons();
  }
  function updateHistoryButtons(){
    btnUndo.disabled = undoStack.length === 0;
    btnRedo.disabled = redoStack.length === 0;
  }

  // Nimmt genau einen Undo-Schnappschuss, wenn ein Textfeld/Textarea zum
  // ersten Mal seit dem letzten Verlassen fokussiert wird — so wird nicht
  // pro Tastendruck ein Undo-Schritt erzeugt, sondern einer pro Bearbeitung.
  function snapshotOnFocus(el){
    el.addEventListener("focus", function(){ snapshot(); });
  }

  // ---- DOM refs -----------------------------------------------------------
  var $ = function(id){ return document.getElementById(id); };
  var fileStatus, btnOpen, btnSave, btnUndo, btnRedo, apiWarning, treeBody, containerSelect,
      btnAddDiagram, btnDuplicate, toolHint, btnCancelAction, courtSvg, stepsBar, btnAddStep,
      btnAddBranch, branchBar, captionInput, actionsList, propsBody;

  // ---- Tree building --------------------------------------------------------
  function walkDiagrams(node, trail, root, out){
    if (Array.isArray(node)){
      node.forEach(function(item, i){ walkDiagrams(item, trail.concat(i), root, out); });
      return;
    }
    if (node && typeof node === "object"){
      if (Array.isArray(node.players) && Array.isArray(node.steps)){
        var top = trail[0];
        var subgroup = null;
        if (top === "read_react" && typeof trail[1] === "number"){
          var cat = root.read_react[trail[1]];
          subgroup = cat && cat.title;
        }
        out.push({
          trail: trail.slice(), diagram: node,
          group: SECTION_NAMES[top] || top, subgroup: subgroup,
          label: node.label || trail.slice(1).join(".")
        });
        return;
      }
      Object.keys(node).forEach(function(k){ walkDiagrams(node[k], trail.concat(k), root, out); });
    }
  }

  function walkContainers(node, trail, out){
    if (Array.isArray(node)){
      if (node.length > 0 && node.every(function(it){ return it && typeof it === "object" && Array.isArray(it.players); })){
        out.push({ trail: trail.slice() });
      }
      node.forEach(function(item, i){ walkContainers(item, trail.concat(i), out); });
      return;
    }
    if (node && typeof node === "object"){
      Object.keys(node).forEach(function(k){ walkContainers(node[k], trail.concat(k), out); });
    }
  }

  function resolvePath(root, trail){
    var node = root;
    for (var i=0; i<trail.length; i++) node = node[trail[i]];
    return node;
  }

  function rebuildIndex(){
    state.diagrams = [];
    if (state.root) walkDiagrams(state.root, [], state.root, state.diagrams);
    state.containers = [];
    if (state.root) walkContainers(state.root, [], state.containers);
  }

  function defaultDiagram(){
    return {
      label: "Neuer Play", court: "half", guardEngine: true, ball: "O1",
      players: [
        {id:"O1",team:"O",label:"1",x:150,y:115}, {id:"O2",team:"O",label:"2",x:260,y:155},
        {id:"O3",team:"O",label:"3",x:40,y:155},  {id:"O4",team:"O",label:"4",x:270,y:300},
        {id:"O5",team:"O",label:"5",x:95,y:290},
        {id:"X1",team:"X",label:"X1",x:150,y:135}, {id:"X2",team:"X",label:"X2",x:248,y:171},
        {id:"X3",team:"X",label:"X3",x:52,y:171},  {id:"X4",team:"X",label:"X4",x:258,y:307},
        {id:"X5",team:"X",label:"X5",x:115,y:296}
      ],
      steps: []
    };
  }

  // ---- Step-list helpers ------------------------------------------------
  function stepsArrayFor(diagram, listCtx){
    if (listCtx.kind === "option") return diagram.branch.options[listCtx.index].steps;
    return diagram.steps;
  }
  function prefixLengthFor(diagram, listCtx){
    return listCtx.kind === "option" ? diagram.steps.length : 0;
  }
  function flatStepsFor(diagram, listCtx){
    if (listCtx.kind === "option") return diagram.steps.concat(diagram.branch.options[listCtx.index].steps);
    return diagram.steps;
  }
  function previewState(){
    var d = state.current.diagram;
    var flat = flatStepsFor(d, state.listCtx);
    var upto = prefixLengthFor(d, state.listCtx) + state.stepIndex;
    return DiagramEngine.computeStepState(d, flat, upto);
  }
  // Positionen aller Spieler unmittelbar VOR dem aktuell gewählten Schritt —
  // Grundlage sowohl für die Trail-Vorschau als auch für die
  // Kollisions-Prüfung neuer Aktionen (setzt state.stepIndex >= 1 voraus).
  function priorStepPos(){
    var d = state.current.diagram;
    var priorUpto = prefixLengthFor(d, state.listCtx) + (state.stepIndex - 1);
    return DiagramEngine.computeStepState(d, flatStepsFor(d, state.listCtx), priorUpto).pos;
  }

  // ---- Rendering: tree ----------------------------------------------------
  function renderTree(){
    treeBody.innerHTML = "";
    if (!state.root){ treeBody.innerHTML = '<p class="ed-hint">Erst eine Datei öffnen.</p>'; return; }
    var byGroup = {};
    state.diagrams.forEach(function(entry){
      byGroup[entry.group] = byGroup[entry.group] || {};
      var sub = entry.subgroup || "__";
      byGroup[entry.group][sub] = byGroup[entry.group][sub] || [];
      byGroup[entry.group][sub].push(entry);
    });
    Object.keys(byGroup).forEach(function(g){
      var gDiv = document.createElement("div"); gDiv.className = "ed-tree-group";
      var gt = document.createElement("div"); gt.className = "ed-tree-group-title"; gt.textContent = g;
      gDiv.appendChild(gt);
      var subs = byGroup[g];
      Object.keys(subs).forEach(function(sk){
        if (sk !== "__"){
          var st = document.createElement("div");
          st.style.fontSize = "11px"; st.style.color = "var(--text-mute)"; st.style.margin = "4px 0 2px 4px";
          st.textContent = sk;
          gDiv.appendChild(st);
        }
        subs[sk].forEach(function(entry){
          var b = document.createElement("button");
          b.type = "button"; b.className = "ed-tree-item" + (state.currentEntry === entry ? " active" : "");
          b.textContent = entry.label;
          b.addEventListener("click", function(){ loadEntry(entry); });
          gDiv.appendChild(b);
        });
      });
      treeBody.appendChild(gDiv);
    });
    containerSelect.innerHTML = "";
    state.containers.forEach(function(c, i){
      var o = document.createElement("option"); o.value = i; o.textContent = c.trail.join(".");
      containerSelect.appendChild(o);
    });
  }

  function loadEntry(entry){
    state.currentEntry = entry;
    state.current = { diagram: entry.diagram };
    state.listCtx = {kind:"main"};
    state.stepIndex = 0;
    disarm();
    renderAll();
  }

  // ---- Rendering: properties panel ---------------------------------------
  function fieldWrap(labelText){
    var w = document.createElement("div"); w.className = "ed-field";
    var l = document.createElement("label"); l.textContent = labelText;
    w.appendChild(l);
    return w;
  }

  function addPlayer(team){
    snapshot();
    var d = state.current.diagram;
    var nums = d.players.filter(function(p){ return p.team === team; })
      .map(function(p){ return parseInt(p.id.slice(1), 10) || 0; });
    var n = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    var id = team + n;
    d.players.push({id:id, team:team, label: team === "O" ? String(n) : id, x:150, y:170});
    renderAll();
  }
  function removePlayer(id){
    snapshot();
    var d = state.current.diagram;
    d.players = d.players.filter(function(p){ return p.id !== id; });
    if (d.ball === id) d.ball = null;
    renderAll();
  }

  // Auf Wunsch die Start-Aufstellung der Verteidiger an die (frisch verschobene)
  // Angreifer-Aufstellung anpassen — die Guard-Engine selbst rechnet nur ab
  // Schritt 1, die Start-Positionen bleiben sonst immer vollständig manuell
  // (genau wie im bestehenden Datenmodell/build.py).
  function recalcStartGuardPositions(){
    snapshot();
    var d = state.current.diagram;
    var isFull = d.court === "full";
    var posByOId = {};
    d.players.forEach(function(p){ if (p.team === "O") posByOId[p.id] = {x:p.x, y:p.y}; });
    var ballPos = d.ball ? posByOId[d.ball] : null;
    d.players.forEach(function(p){
      if (p.team !== "X" || p.manual) return;
      var attacker = posByOId["O" + p.id.slice(1)];
      if (!attacker) return;
      var basket = DiagramEngine.basketFor(attacker, isFull);
      var dest = DiagramEngine.guardHomePos(attacker, basket, ballPos);
      p.x = Math.round(dest.x); p.y = Math.round(dest.y);
    });
    renderAll();
  }

  function renderProps(){
    propsBody.innerHTML = "";
    var d = state.current && state.current.diagram;
    if (!d){ propsBody.innerHTML = '<p class="ed-hint">Erst ein Diagramm auswählen.</p>'; return; }

    var labelField = fieldWrap("Label");
    var labelInput = document.createElement("input"); labelInput.type = "text"; labelInput.value = d.label || "";
    snapshotOnFocus(labelInput);
    labelInput.addEventListener("input", function(){ d.label = labelInput.value; renderTree(); });
    labelField.appendChild(labelInput);
    propsBody.appendChild(labelField);

    var courtField = fieldWrap("Feld");
    var courtSelect = document.createElement("select");
    ["half","full"].forEach(function(v){
      var o = document.createElement("option"); o.value = v; o.textContent = v === "half" ? "Halbfeld" : "Vollfeld";
      if (d.court === v || (!d.court && v === "half")) o.selected = true;
      courtSelect.appendChild(o);
    });
    courtSelect.addEventListener("change", function(){ snapshot(); d.court = courtSelect.value; renderCanvas(); });
    courtField.appendChild(courtSelect);
    propsBody.appendChild(courtField);

    var geRow = document.createElement("div"); geRow.className = "ed-checkrow";
    var geCb = document.createElement("input"); geCb.type = "checkbox"; geCb.checked = !!d.guardEngine;
    geCb.addEventListener("change", function(){ snapshot(); d.guardEngine = geCb.checked; renderAll(); });
    var geLabel = document.createElement("label"); geLabel.textContent = "Guard-Engine (Verteidiger folgen automatisch)";
    geRow.appendChild(geCb); geRow.appendChild(geLabel);
    propsBody.appendChild(geRow);

    if (d.guardEngine){
      var recalcRow = document.createElement("div"); recalcRow.style.marginBottom = "12px";
      var recalcBtn = document.createElement("button");
      recalcBtn.type = "button"; recalcBtn.className = "ed-btn ed-btn-small";
      recalcBtn.textContent = "Start-Positionen neu berechnen";
      recalcBtn.title = "Setzt alle nicht-manuellen Verteidiger auf ihre Guard-Engine-Position relativ zur aktuellen Start-Aufstellung der Angreifer.";
      recalcBtn.addEventListener("click", recalcStartGuardPositions);
      recalcRow.appendChild(recalcBtn);
      propsBody.appendChild(recalcRow);
    }

    var ballField = fieldWrap("Ballträger");
    var ballSpan = document.createElement("div"); ballSpan.textContent = d.ball || "—";
    ballField.appendChild(ballSpan);
    propsBody.appendChild(ballField);

    var rosterHead = fieldWrap("Spieler");
    propsBody.appendChild(rosterHead);
    (d.players || []).forEach(function(p){
      var row = document.createElement("div"); row.className = "ed-roster-item";
      var teamTag = document.createElement("span"); teamTag.className = p.team === "O" ? "team-o" : "team-x"; teamTag.textContent = p.id;
      row.appendChild(teamTag);
      var labelInput2 = document.createElement("input"); labelInput2.type = "text"; labelInput2.value = p.label;
      snapshotOnFocus(labelInput2);
      labelInput2.addEventListener("input", function(){ p.label = labelInput2.value; renderCanvas(); });
      row.appendChild(labelInput2);
      if (p.team === "X" && d.guardEngine){
        var manualCb = document.createElement("input"); manualCb.type = "checkbox";
        manualCb.title = "Manuell (Guard-Engine ignoriert diesen Spieler)"; manualCb.checked = !!p.manual;
        manualCb.addEventListener("change", function(){
          snapshot();
          if (manualCb.checked) p.manual = true; else delete p.manual;
          renderCanvas();
        });
        row.appendChild(manualCb);
      }
      var rm = document.createElement("button"); rm.type = "button"; rm.textContent = "✕";
      rm.addEventListener("click", function(){ removePlayer(p.id); });
      row.appendChild(rm);
      propsBody.appendChild(row);
    });
    var addRow = document.createElement("div"); addRow.style.display = "flex"; addRow.style.gap = "6px"; addRow.style.marginTop = "6px";
    var addO = document.createElement("button"); addO.type = "button"; addO.className = "ed-btn ed-btn-small"; addO.textContent = "+ O";
    addO.addEventListener("click", function(){ addPlayer("O"); });
    var addX = document.createElement("button"); addX.type = "button"; addX.className = "ed-btn ed-btn-small"; addX.textContent = "+ X";
    addX.addEventListener("click", function(){ addPlayer("X"); });
    addRow.appendChild(addO); addRow.appendChild(addX);
    propsBody.appendChild(addRow);
  }

  // ---- Rendering: step timeline + branch ----------------------------------
  function mkChip(text, active, onClick, extraClass){
    var b = document.createElement("button"); b.type = "button";
    b.className = "ed-step-chip" + (active ? " active" : "") + (extraClass ? " " + extraClass : "");
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderStepsBar(){
    stepsBar.innerHTML = "";
    var d = state.current && state.current.diagram;
    if (!d) return;
    var arr = stepsArrayFor(d, state.listCtx);
    if (state.listCtx.kind === "option"){
      stepsBar.appendChild(mkChip("← Haupt-Sequenz", false, function(){
        state.listCtx = {kind:"main"}; state.stepIndex = d.steps.length; renderAll();
      }, "option"));
    }
    stepsBar.appendChild(mkChip("Start", state.stepIndex === 0, function(){ state.stepIndex = 0; renderAll(); }));
    arr.forEach(function(st, i){
      stepsBar.appendChild(mkChip(String(i+1), state.stepIndex === i+1, function(){ state.stepIndex = i+1; renderAll(); }));
    });
    if (state.listCtx.kind === "main" && d.branch){
      stepsBar.appendChild(mkChip("Branch ▸", false, function(){
        state.listCtx = {kind:"option", index:0}; state.stepIndex = 0; renderAll();
      }, "option"));
    }
  }

  function renderBranchBar(){
    var d = state.current && state.current.diagram;
    if (!d || !d.branch){ branchBar.hidden = true; return; }
    branchBar.hidden = false;
    branchBar.innerHTML = "";
    var promptInput = document.createElement("input"); promptInput.type = "text";
    promptInput.value = d.branch.prompt || ""; promptInput.placeholder = "Branch-Frage…";
    snapshotOnFocus(promptInput);
    promptInput.addEventListener("input", function(){ d.branch.prompt = promptInput.value; });
    branchBar.appendChild(promptInput);
    var optsWrap = document.createElement("div"); optsWrap.className = "ed-branch-options";
    d.branch.options.forEach(function(opt, i){
      var b = mkChip(opt.label || ("Option " + (i+1)),
        state.listCtx.kind === "option" && state.listCtx.index === i,
        function(){ state.listCtx = {kind:"option", index:i}; state.stepIndex = 0; renderAll(); },
        "option");
      b.title = "Doppelklick zum Umbenennen";
      b.addEventListener("dblclick", function(){
        var nl = window.prompt("Label für diese Option", opt.label || "");
        if (nl !== null){ snapshot(); opt.label = nl; renderAll(); }
      });
      optsWrap.appendChild(b);
    });
    var addOpt = document.createElement("button"); addOpt.type = "button"; addOpt.className = "ed-btn ed-btn-small";
    addOpt.style.marginLeft = "6px"; addOpt.textContent = "+ Option";
    addOpt.addEventListener("click", function(){
      snapshot();
      d.branch.options.push({label:"Option " + String.fromCharCode(65 + d.branch.options.length), steps:[]});
      renderAll();
    });
    optsWrap.appendChild(addOpt);
    branchBar.appendChild(optsWrap);
  }

  function renderCaption(){
    var d = state.current && state.current.diagram;
    if (!d){ captionInput.value = ""; captionInput.disabled = true; return; }
    if (state.stepIndex === 0){
      captionInput.value = ""; captionInput.placeholder = "Startaufstellung (keine Beschreibung nötig)"; captionInput.disabled = true;
      return;
    }
    var arr = stepsArrayFor(d, state.listCtx);
    captionInput.disabled = false;
    captionInput.value = (arr[state.stepIndex-1] && arr[state.stepIndex-1].caption) || "";
  }

  function describeAction(a){
    switch (a.type){
      case "move":    return "Move " + a.id + " → (" + a.to.x + "," + a.to.y + ")";
      case "dribble": return "Dribble " + a.id + " → (" + a.to.x + "," + a.to.y + ")";
      case "screen":  return "Screen " + a.id + " → (" + a.to.x + "," + a.to.y + ")";
      case "pass":    return "Pass " + a.from + " → " + a.to;
      case "switch":  return "Switch " + a.players[0] + " ↔ " + a.players[1];
      case "help":    return "Help " + a.id + " → " + a.target;
      case "beat":    return "Beat " + a.id;
      case "block":   return "Block " + a.id + " (auf " + a.target + ")";
      default: return a.type;
    }
  }

  function renderActionsList(){
    actionsList.innerHTML = "";
    var d = state.current && state.current.diagram;
    if (!d || state.stepIndex === 0) return;
    var arr = stepsArrayFor(d, state.listCtx);
    var step = arr[state.stepIndex-1];
    if (!step) return;
    step.actions.forEach(function(action, i){
      var chip = document.createElement("div"); chip.className = "ed-action-chip";
      var left = document.createElement("span"); left.textContent = describeAction(action);
      chip.appendChild(left);
      var right = document.createElement("span");
      if (["move","dribble","screen"].indexOf(action.type) !== -1){
        var viaBtn = document.createElement("button"); viaBtn.type = "button"; viaBtn.className = "via-btn";
        viaBtn.textContent = action.via ? "Kurve ✓" : "+ Kurve";
        viaBtn.addEventListener("click", function(){ arm({type:"_via", clicks:["point"], targetAction:action}); });
        right.appendChild(viaBtn);
      }
      var del = document.createElement("button"); del.type = "button"; del.textContent = "✕";
      del.addEventListener("click", function(){ snapshot(); step.actions.splice(i, 1); renderAll(); });
      right.appendChild(del);
      chip.appendChild(right);
      actionsList.appendChild(chip);
    });
  }

  // ---- Rendering: court canvas --------------------------------------------
  function drawTrail(action, pos){
    var g = DiagramEngine.el("g", {});
    if (["switch","beat","help","block"].indexOf(action.type) !== -1) return g;
    if (action.type === "pass"){
      var f = pos[action.from], t = pos[action.to];
      if (f && t) g.appendChild(DiagramEngine.el("line", {x1:f.x,y1:f.y,x2:t.x,y2:t.y, stroke:"var(--accent)", "stroke-width":2, "stroke-dasharray":"5,4"}));
      return g;
    }
    var from = pos[action.id];
    if (!from) return g;
    var to = action.to, via = action.via || null;
    if (action.type === "dribble"){
      g.appendChild(DiagramEngine.el("path", {d: DiagramEngine.wavyPathD(from, to, via), fill:"none", stroke:"var(--text)", "stroke-width":2}));
    } else if (action.type === "screen"){
      g.appendChild(DiagramEngine.el("line", {x1:from.x,y1:from.y,x2:to.x,y2:to.y, stroke:"var(--accent)", "stroke-width":2.5}));
    } else {
      g.appendChild(DiagramEngine.el("path", {d: DiagramEngine.curvePathD(from, to, via), fill:"none", stroke:"var(--text)", "stroke-width":1.8}));
    }
    return g;
  }

  function attachTokenDrag(g, id){
    g.addEventListener("pointerdown", function(evt){
      if (armed) return;
      if (state.stepIndex !== 0) return;
      snapshot();
      dragging = id;
      try { g.setPointerCapture(evt.pointerId); } catch(e){}
    });
  }

  function svgPoint(svg, evt){
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    var ctm = svg.getScreenCTM();
    if (!ctm) return {x:0, y:0};
    var p = pt.matrixTransform(ctm.inverse());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  function renderCanvas(){
    courtSvg.innerHTML = "";
    var d = state.current && state.current.diagram;
    if (!d){ courtSvg.setAttribute("viewBox", "0 0 300 340"); return; }
    var isFull = d.court === "full";
    courtSvg.setAttribute("viewBox", isFull ? "0 0 300 620" : "0 0 300 340");
    courtSvg.appendChild(DiagramEngine.courtMarkup(d.court));

    var trailLayer = DiagramEngine.el("g", {});
    courtSvg.appendChild(trailLayer);
    var ps = previewState();
    if (state.stepIndex > 0){
      var arr = stepsArrayFor(d, state.listCtx);
      var step = arr[state.stepIndex-1];
      var priorPos = priorStepPos();
      if (step) step.actions.forEach(function(a){ trailLayer.appendChild(drawTrail(a, priorPos)); });
    }
    // Automatische Guard-Engine-Bewegungen dieses Schritts als gestrichelte
    // Linie zeigen — Parität mit den gestrichelten Auto-Rotationslinien, die
    // der echte Viewer schon zeichnet (inkl. Ausweich-Bogen um Hindernisse).
    (ps.autoTrails || []).forEach(function(m){
      trailLayer.appendChild(DiagramEngine.el("path", {
        d: DiagramEngine.curvePathD(m.from, m.to, m.via), fill:"none",
        stroke:"var(--text-mute)", "stroke-width":1.3, "stroke-dasharray":"2,3"
      }));
    });

    var tokenLayer = DiagramEngine.el("g", {});
    courtSvg.appendChild(tokenLayer);
    (d.players || []).forEach(function(p){
      var pos = ps.pos[p.id] || {x:p.x, y:p.y};
      var g = DiagramEngine.el("g", {"data-id":p.id, "class":"ed-token"});
      var isO = p.team === "O";
      var hl = ps.highlight[p.id];
      if (isO){
        g.appendChild(DiagramEngine.el("circle", {cx:pos.x, cy:pos.y, r:11, fill:"#fff", stroke:"var(--navy)", "stroke-width":2.2, "class":"pd-shape"}));
      } else {
        if (hl === "help") g.appendChild(DiagramEngine.el("circle", {cx:pos.x, cy:pos.y, r:14, fill:"none", stroke:"#F2C94C", "stroke-width":2.5}));
        if (hl === "block") g.appendChild(DiagramEngine.el("circle", {cx:pos.x, cy:pos.y, r:14, fill:"none", stroke:"#2F80ED", "stroke-width":2.5}));
        var xStroke = (hl === "beat" || hl === "switch") ? "#e03e2d" : "var(--text-mute)";
        g.appendChild(DiagramEngine.el("rect", {x:pos.x-9, y:pos.y-9, width:18, height:18, fill:"var(--cream)", stroke:xStroke,
          "stroke-width": (hl === "beat" || hl === "switch") ? 3 : 2, transform:"rotate(45 " + pos.x + " " + pos.y + ")", "class":"pd-shape"}));
      }
      var t = DiagramEngine.el("text", {x:pos.x, y:pos.y+3.5, "text-anchor":"middle", "font-size": isO ? 10.5 : 8.5, "font-weight":700, fill: isO ? "var(--navy)" : "var(--text-mute)"});
      t.textContent = p.label + (p.manual ? " •" : "");
      g.appendChild(t);
      attachTokenDrag(g, p.id);
      tokenLayer.appendChild(g);
    });

    if (ps.ballHolder && ps.pos[ps.ballHolder]){
      var bp = ps.pos[ps.ballHolder];
      courtSvg.appendChild(DiagramEngine.el("circle", {cx:bp.x+9, cy:bp.y+9, r:4.5, fill:"#C97A2E", stroke:"#7A4A1A", "stroke-width":1}));
    }
  }

  // ---- Action arming / click workflow --------------------------------------
  function arm(spec){
    armed = { type: spec.type, clicks: spec.clicks.slice(), collected: [], targetAction: spec.targetAction || null };
    updateToolbarUI(); updateHint();
  }
  function disarm(){ armed = null; updateToolbarUI(); updateHint(); }
  function updateToolbarUI(){
    document.querySelectorAll(".ed-tool").forEach(function(btn){
      btn.classList.toggle("armed", !!(armed && armed.type === btn.dataset.action));
    });
  }
  function updateHint(){
    btnCancelAction.disabled = !armed;
    if (!state.current){ toolHint.textContent = "Kein Diagramm geladen."; return; }
    if (!armed){ toolHint.textContent = "Aktion wählen, dann Spieler/Feld anklicken."; return; }
    var need = armed.clicks[armed.collected.length];
    toolHint.textContent = (TOOL_NAMES[armed.type] || armed.type) + ": " +
      (need === "player" ? "Spieler anklicken" : "Zielpunkt auf dem Feld anklicken") +
      " (" + (armed.collected.length + 1) + "/" + armed.clicks.length + ")";
  }

  function finishArmed(){
    var d = state.current.diagram;
    if (state.listCtx.kind === "option" && !d.branch){ disarm(); return; }
    snapshot();
    if (armed.type === "_via"){
      armed.targetAction.via = armed.collected[0];
      disarm(); renderAll(); return;
    }
    if (armed.type === "ball"){
      d.ball = armed.collected[0];
      disarm(); renderAll(); return;
    }
    var arr = stepsArrayFor(d, state.listCtx);
    if (state.stepIndex === 0){
      if (arr.length === 0) arr.push({caption:"", actions:[]});
      state.stepIndex = 1;
    }
    var step = arr[state.stepIndex-1];
    var built = ACTION_SPECS[armed.type].build(armed.collected);
    if (["move","dribble","screen"].indexOf(armed.type) !== -1){
      var priorPos = priorStepPos();
      var from = priorPos[built.id];
      if (from){
        var obstacles = Object.keys(priorPos).filter(function(id){ return id !== built.id; }).map(function(id){ return priorPos[id]; });
        var bow = DiagramEngine.avoidPath(from, built.to, obstacles);
        if (bow && window.confirm("Der direkte Weg verläuft nah an einem anderen Spieler vorbei — Laufweg automatisch drum herum biegen?")){
          built.via = bow;
        }
      }
    }
    step.actions.push(built);
    disarm();
    renderAll();
  }

  // ---- Wiring ---------------------------------------------------------------
  function init(){
    fileStatus = $("fileStatus"); btnOpen = $("btnOpen"); btnSave = $("btnSave"); apiWarning = $("apiWarning");
    btnUndo = $("btnUndo"); btnRedo = $("btnRedo"); btnCancelAction = $("btnCancelAction");
    treeBody = $("treeBody"); containerSelect = $("containerSelect"); btnAddDiagram = $("btnAddDiagram"); btnDuplicate = $("btnDuplicate");
    toolHint = $("toolHint"); courtSvg = $("courtSvg"); stepsBar = $("stepsBar"); btnAddStep = $("btnAddStep"); btnAddBranch = $("btnAddBranch");
    branchBar = $("branchBar"); captionInput = $("captionInput"); actionsList = $("actionsList"); propsBody = $("propsBody");

    btnUndo.addEventListener("click", undo);
    btnRedo.addEventListener("click", redo);
    btnCancelAction.addEventListener("click", function(){ disarm(); });
    snapshotOnFocus(captionInput); // persistiert über Renders, daher hier einmalig verdrahtet

    var supportsFS = "showOpenFilePicker" in window;
    if (!supportsFS){ apiWarning.hidden = false; btnOpen.disabled = true; }

    btnOpen.addEventListener("click", async function(){
      try{
        var handles = await window.showOpenFilePicker({ types:[{description:"Playbook JSON", accept:{"application/json":[".json"]}}] });
        fileHandle = handles[0];
        var file = await fileHandle.getFile();
        state.root = JSON.parse(await file.text());
        state.currentEntry = null; state.current = null; state.listCtx = {kind:"main"}; state.stepIndex = 0;
        undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
        rebuildIndex();
        fileStatus.textContent = file.name;
        btnSave.disabled = false;
        renderAll();
      } catch(e){
        if (e.name !== "AbortError") alert("Öffnen fehlgeschlagen: " + e.message);
      }
    });

    btnSave.addEventListener("click", async function(){
      if (!fileHandle || !state.root) return;
      try{
        var writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(state.root, null, 2) + "\n");
        await writable.close();
        fileStatus.textContent = fileHandle.name + " — gespeichert ✓";
      } catch(e){
        alert("Speichern fehlgeschlagen: " + e.message);
      }
    });

    btnAddDiagram.addEventListener("click", function(){
      var idx = parseInt(containerSelect.value, 10);
      var c = state.containers[idx];
      if (!c) return;
      snapshot();
      var arr = resolvePath(state.root, c.trail);
      var nd = defaultDiagram();
      arr.push(nd);
      rebuildIndex();
      var entry = state.diagrams.filter(function(e){ return e.diagram === nd; })[0];
      if (entry) loadEntry(entry); else renderAll();
    });

    btnDuplicate.addEventListener("click", function(){
      if (!state.currentEntry) return;
      snapshot();
      var parentArr = resolvePath(state.root, state.currentEntry.trail.slice(0, -1));
      var clone = JSON.parse(JSON.stringify(state.currentEntry.diagram));
      clone.label = (clone.label || "Play") + " (Kopie)";
      parentArr.push(clone);
      rebuildIndex();
      var entry = state.diagrams.filter(function(e){ return e.diagram === clone; })[0];
      if (entry) loadEntry(entry); else renderAll();
    });

    btnAddStep.addEventListener("click", function(){
      if (!state.current) return;
      var d = state.current.diagram;
      if (state.listCtx.kind === "option" && !d.branch) return;
      snapshot();
      var arr = stepsArrayFor(d, state.listCtx);
      arr.push({caption:"", actions:[]});
      state.stepIndex = arr.length;
      renderAll();
    });

    btnAddBranch.addEventListener("click", function(){
      if (!state.current) return;
      var d = state.current.diagram;
      if (d.branch || state.listCtx.kind !== "main") return;
      var p = window.prompt('Branch-Frage (z.B. "Kommt Hilfe oder nicht?")', "");
      if (p === null) return;
      snapshot();
      d.branch = { prompt: p, options: [ {label:"Option A", steps:[]}, {label:"Option B", steps:[]} ] };
      state.listCtx = {kind:"option", index:0};
      state.stepIndex = 0;
      renderAll();
    });

    captionInput.addEventListener("input", function(){
      if (!state.current || state.stepIndex === 0) return;
      var arr = stepsArrayFor(state.current.diagram, state.listCtx);
      if (arr[state.stepIndex-1]) arr[state.stepIndex-1].caption = captionInput.value;
    });

    document.querySelectorAll(".ed-tool").forEach(function(btn){
      btn.addEventListener("click", function(){
        if (!state.current) return;
        var type = btn.dataset.action;
        if (armed && armed.type === type){ disarm(); return; }
        arm({type:type, clicks: ACTION_SPECS[type].clicks});
      });
    });

    courtSvg.addEventListener("click", function(evt){
      if (!state.current || !armed) return;
      var need = armed.clicks[armed.collected.length];
      if (need === "player"){
        var tokenEl = evt.target.closest("[data-id]");
        if (!tokenEl) return;
        armed.collected.push(tokenEl.getAttribute("data-id"));
      } else if (need === "point"){
        armed.collected.push(svgPoint(courtSvg, evt));
      }
      if (armed.collected.length === armed.clicks.length) finishArmed(); else updateHint();
    });

    courtSvg.addEventListener("pointermove", function(evt){
      if (!dragging || !state.current) return;
      var pt = svgPoint(courtSvg, evt);
      var p = state.current.diagram.players.find(function(pp){ return pp.id === dragging; });
      if (p){ p.x = pt.x; p.y = pt.y; renderCanvas(); }
    });
    courtSvg.addEventListener("pointerup", function(){ if (dragging){ dragging = null; renderAll(); } });
    courtSvg.addEventListener("pointerleave", function(){ if (dragging){ dragging = null; renderAll(); } });

    document.addEventListener("keydown", function(e){
      if (e.key === "Escape" && armed){ disarm(); return; }
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if (typing) return; // native Undo im Textfeld hat Vorrang
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      var key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey){ e.preventDefault(); undo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)){ e.preventDefault(); redo(); }
    });

    renderAll();
  }

  function renderAll(){
    renderTree();
    renderProps();
    renderStepsBar();
    renderBranchBar();
    renderCaption();
    renderActionsList();
    renderCanvas();
    updateHint();
    var has = !!state.current;
    btnAddStep.disabled = !has;
    btnAddBranch.disabled = !has || (has && state.current.diagram.branch) || state.listCtx.kind !== "main";
    btnDuplicate.disabled = !state.currentEntry;
    btnAddDiagram.disabled = !state.root || state.containers.length === 0;
    btnCancelAction.disabled = !armed;
    updateHistoryButtons();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
