(function(){
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  // Distanzbasiertes Timing statt fester Schrittdauer: O ("Angriff") legt
  // SPEED_O px/ms zurück, X ("Verteidigung") ist standardmäßig 15% langsamer
  // (SPEED_X_FACTOR) — realistischer als ein 10px-Schritt und ein 300px-
  // Full-Court-Sprint gleich lang animieren zu lassen. Passwürfe sind davon
  // unabhängig immer gleich schnell (PASS_DURATION).
  var SPEED_O = 0.30; // px/ms
  var SPEED_X_FACTOR = 0.85;
  var MIN_MOVE_DURATION = 400; // auch reine Marker-Schritte (nur beat/help/block/switch) bleiben so kurz lesbar
  var MAX_MOVE_DURATION = 2200;
  var PASS_DURATION = 350;

  function moveDuration(team, from, to){
    var dist = Math.hypot(to.x-from.x, to.y-from.y);
    var speed = SPEED_O * (team === "X" ? SPEED_X_FACTOR : 1);
    return Math.min(MAX_MOVE_DURATION, Math.max(MIN_MOVE_DURATION, dist/speed));
  }

  function el(tag, attrs){
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function easeInOut(t){ return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }

  function courtMarkup(type){
    var g = el("g", {});
    if (type === "full"){
      g.appendChild(el("rect", {x:8,y:8,width:284,height:604,fill:"none",stroke:"var(--line)","stroke-width":2}));
      g.appendChild(el("line", {x1:8,y1:310,x2:292,y2:310,stroke:"var(--line)","stroke-width":2}));
      g.appendChild(el("circle", {cx:150,cy:310,r:40,fill:"none",stroke:"var(--line)","stroke-width":2}));
      // Brett 4ft / Ring 5.25ft von der Grundlinie (Maßstab: Zone = 19ft = 120px)
      [{by:612, fy:492, dir:1},{by:8, fy:8, dir:-1}].forEach(function(end){
        var basketY = end.dir===1 ? 579 : 41;
        var bbY = end.dir===1 ? 587 : 33;
        var ftY = end.dir===1 ? 492 : 128;
        var ftSweep = end.dir===1 ? 1 : 0;
        g.appendChild(el("rect", {x:95,y:end.fy,width:110,height:120,fill:"none",stroke:"var(--line)","stroke-width":2}));
        g.appendChild(el("path", {d:"M105,"+ftY+" A45,45 0 0 "+ftSweep+" 195,"+ftY, fill:"none",stroke:"var(--line)","stroke-width":2}));
        var sweep = end.dir===1 ? 1 : 0;
        var midY = end.dir===1 ? 535 : 85;
        g.appendChild(el("path", {d:"M28,"+end.by+" L28,"+midY+" A122,122 0 0 "+sweep+" 272,"+midY+" L272,"+end.by, fill:"none",stroke:"var(--line)","stroke-width":2}));
        g.appendChild(el("path", {d:"M125,"+basketY+" A25,25 0 0 "+ftSweep+" 175,"+basketY, fill:"none",stroke:"var(--line)","stroke-width":2}));
        g.appendChild(el("line", {x1:132,y1:bbY,x2:168,y2:bbY,stroke:"var(--text-mute)","stroke-width":3}));
        g.appendChild(el("circle", {cx:150,cy:basketY,r:5,fill:"none",stroke:"var(--accent)","stroke-width":2}));
      });
    } else {
      // Brett 4ft / Ring 5.25ft von der Grundlinie (Maßstab: Zone = 19ft = 120px)
      g.appendChild(el("rect", {x:8,y:8,width:284,height:324,fill:"none",stroke:"var(--line)","stroke-width":2}));
      g.appendChild(el("rect", {x:95,y:212,width:110,height:120,fill:"none",stroke:"var(--line)","stroke-width":2}));
      g.appendChild(el("path", {d:"M105,212 A45,45 0 0 1 195,212", fill:"none",stroke:"var(--line)","stroke-width":2}));
      g.appendChild(el("path", {d:"M28,332 L28,255 A122,122 0 0 1 272,255 L272,332", fill:"none",stroke:"var(--line)","stroke-width":2}));
      g.appendChild(el("path", {d:"M125,299 A25,25 0 0 1 175,299", fill:"none",stroke:"var(--line)","stroke-width":2}));
      g.appendChild(el("line", {x1:132,y1:307,x2:168,y2:307,stroke:"var(--text-mute)","stroke-width":3}));
      g.appendChild(el("circle", {cx:150,cy:299,r:5,fill:"none",stroke:"var(--accent)","stroke-width":2}));
    }
    return g;
  }

  // Punkt auf quadratischer Bezier-Kurve (für geschwungene Laufwege/Drives)
  function qpoint(a, c, b, t){
    var mt = 1 - t;
    return { x: mt*mt*a.x + 2*mt*t*c.x + t*t*b.x,
             y: mt*mt*a.y + 2*mt*t*c.y + t*t*b.y };
  }

  function samplePts(from, to, via, n){
    n = n || 24;
    var pts = [];
    for (var i = 0; i <= n; i++){
      var t = i / n;
      pts.push(via ? qpoint(from, via, to, t)
                   : { x: from.x + (to.x-from.x)*t, y: from.y + (to.y-from.y)*t });
    }
    return pts;
  }

  // Wellenlinie (Dribbling-Notation) entlang gerader oder gebogener Bahn
  function wavyPathD(from, to, via){
    var pts = samplePts(from, to, via, 24);
    var d = "M" + pts[0].x.toFixed(1) + "," + pts[0].y.toFixed(1);
    for (var i = 1; i < pts.length; i++){
      var prev = pts[i-1], cur = pts[i];
      var dx = cur.x - prev.x, dy = cur.y - prev.y;
      var len = Math.sqrt(dx*dx + dy*dy) || 1;
      var px = -dy/len, py = dx/len;
      var off = (i >= pts.length - 2) ? 0 : Math.sin(i * 1.35) * 4.5;
      d += " L" + (cur.x + px*off).toFixed(1) + "," + (cur.y + py*off).toFixed(1);
    }
    return d;
  }

  function curvePathD(from, to, via){
    if (via) return "M" + from.x + "," + from.y + " Q" + via.x + "," + via.y + " " + to.x + "," + to.y;
    return "M" + from.x + "," + from.y + " L" + to.x + "," + to.y;
  }

  // Verteidiger-Engine: Standardposition ist die direkte Linie zwischen dem
  // eigenen Gegenspieler und dem Korb (Helpside-Grundprinzip), sofern kein
  // expliziter move/screen/beat-Eintrag im Schritt vorliegt.
  // Helpside-Prinzip: je weiter der Ball vom Gegenspieler entfernt ist, desto
  // weiter darf der Verteidiger auf dieser Achse zum Korb absacken (Helfer-
  // Position) — aber gedeckelt, damit er nicht zu nah an den Korb rutscht.
  var GUARD_DIST_MIN = 16;
  var GUARD_DIST_MAX = 46;
  var GUARD_BALL_REF = 220; // px Balldistanz, ab der die maximale Helpside-Distanz erreicht ist

  function basketFor(pos, isFull){
    if (!isFull) return {x:150, y:299};
    return pos.y < 310 ? {x:150, y:41} : {x:150, y:579};
  }

  function guardHomePos(attacker, basket, ballPos){
    var dx = basket.x - attacker.x, dy = basket.y - attacker.y;
    var len = Math.sqrt(dx*dx + dy*dy) || 1;
    var sag = GUARD_DIST_MIN;
    if (ballPos){
      var bd = Math.hypot(attacker.x-ballPos.x, attacker.y-ballPos.y);
      var t = Math.max(0, Math.min(1, bd/GUARD_BALL_REF));
      sag = GUARD_DIST_MIN + (GUARD_DIST_MAX-GUARD_DIST_MIN)*t;
    }
    sag = Math.min(sag, len*0.6); // nicht zu nah am Korb / nicht über den Korb hinausschießen
    sag = Math.max(sag, 10); // trotzdem nie direkt auf dem Gegenspieler stehen (auch dicht am Ring)
    return { x: attacker.x + (dx/len)*sag, y: attacker.y + (dy/len)*sag };
  }

  // Recovering-Modus (nach "beat"): Verteidiger hängt seitlich/leicht
  // dahinter, statt sofort wieder korrekt auf der Korblinie zu stehen.
  function guardRecoverPos(attacker, basket){
    var dx = attacker.x - basket.x, dy = attacker.y - basket.y;
    var len = Math.sqrt(dx*dx + dy*dy) || 1;
    var ux = dx/len, uy = dy/len;
    var px = -uy, py = ux;
    var side = attacker.x >= 150 ? 1 : -1;
    return { x: attacker.x + ux*8 + px*14*side, y: attacker.y + uy*8 + py*14*side };
  }

  // Verhindert, dass ein automatisch positionierter Verteidiger geradewegs
  // durch einen anderen Spieler "hindurchläuft" (z.B. beim Switch quer durchs
  // Feld). Liegt ein anderer Spieler zu nah an der direkten Strecke, bekommt
  // die Bewegung einen Bogen, der um ihn herumführt.
  function avoidPath(from, to, obstacles){
    var dx = to.x-from.x, dy = to.y-from.y, len = Math.sqrt(dx*dx+dy*dy) || 1;
    var ux = dx/len, uy = dy/len, nx = -uy, ny = ux;
    var worstD = 22, side = 0;
    obstacles.forEach(function(p){
      var t = ((p.x-from.x)*ux + (p.y-from.y)*uy) / len;
      if (t < 0.12 || t > 0.88) return; // Hindernis liegt nicht wirklich auf dem Weg
      var qx = from.x + ux*len*t, qy = from.y + uy*len*t;
      var d = Math.hypot(p.x-qx, p.y-qy);
      if (d < worstD){ worstD = d; side = ((p.x-from.x)*nx + (p.y-from.y)*ny) >= 0 ? 1 : -1; }
    });
    if (!side) return null;
    var midx = from.x + dx*0.5, midy = from.y + dy*0.5;
    var bow = 32;
    return { x: midx - nx*bow*side, y: midy - ny*bow*side };
  }

  // Zustandslose Simulation: liefert Positionen/Ballträger/Guard-Zuordnung/
  // Highlights nach Ausführung von steps[0..uptoIndex). Spiegelt exakt die
  // Schritt-für-Schritt-Logik von scripts/build.py's diagram_svg() (dort die
  // "einzige Quelle der Wahrheit" für den No-JS-Fallback), nur wiederholt für
  // beliebige Zwischenstände statt einmal bis zum Ende — Grundlage für die
  // Live-Vorschau im Editor, ohne die animierte PlayDiagram-Klasse anzufassen.
  function computeStepState(diagram, steps, uptoIndex){
    var startPos = {}, team = {};
    (diagram.players||[]).forEach(function(p){
      startPos[p.id] = {x:p.x, y:p.y};
      team[p.id] = p.team;
    });
    var pos = {};
    Object.keys(startPos).forEach(function(id){ pos[id] = {x:startPos[id].x, y:startPos[id].y}; });
    var ballHolder = diagram.ball || null;
    var guardEngine = !!diagram.guardEngine;
    var guardMap = {}, manualIds = {};
    (diagram.players||[]).forEach(function(p){
      if (p.team === "X") guardMap[p.id] = "O" + p.id.slice(1);
      if (p.manual) manualIds[p.id] = true;
    });
    var recovering = {};
    var highlight = {};
    var isFull = diagram.court === "full";
    var ballHolderBeforeStep = ballHolder;
    var autoTrails = []; // {id, from, to, via} je automatisch bewegtem Verteidiger im letzten Schritt

    var n = Math.max(0, Math.min(uptoIndex, (steps||[]).length));
    for (var i = 0; i < n; i++){
      var step = steps[i];
      ballHolderBeforeStep = ballHolder;
      var explicitThisStep = {};
      var beatenThisStep = {};
      autoTrails = [];
      var newHighlight = {};
      Object.keys(highlight).forEach(function(k){ if (highlight[k] === "help") newHighlight[k] = "help"; });

      (step.actions||[]).forEach(function(action){
        var t = action.type;
        if (t === "switch"){
          var a = action.players[0], b = action.players[1];
          var tmp = guardMap[a]; guardMap[a] = guardMap[b]; guardMap[b] = tmp;
          newHighlight[a] = "switch"; newHighlight[b] = "switch";
          return;
        }
        if (t === "beat"){
          beatenThisStep[action.id] = true;
          newHighlight[action.id] = "beat";
          return;
        }
        if (t === "help"){
          newHighlight[action.id] = "help";
          if (action.target) guardMap[action.id] = action.target;
          return;
        }
        if (t === "block"){
          newHighlight[action.id] = "block";
          explicitThisStep[action.id] = true; // Blocker bleibt diesen Schritt eingefroren
          return;
        }
        if (t === "pass"){
          ballHolder = action.to;
          return;
        }
        // move / cut / dribble / screen
        pos[action.id] = {x: action.to.x, y: action.to.y};
        explicitThisStep[action.id] = true;
      });

      Object.keys(explicitThisStep).forEach(function(id){ delete recovering[id]; });
      Object.keys(beatenThisStep).forEach(function(id){ recovering[id] = true; });
      highlight = newHighlight;

      if (guardEngine){
        var ballPos = pos[ballHolderBeforeStep];
        Object.keys(guardMap).forEach(function(xid){
          if (manualIds[xid] || beatenThisStep[xid] || explicitThisStep[xid]) return;
          var oid = guardMap[xid];
          var attacker = pos[oid] || startPos[oid];
          var basket = basketFor(attacker, isFull);
          var dest = recovering[xid] ? guardRecoverPos(attacker, basket) : guardHomePos(attacker, basket, ballPos);
          var from = {x: pos[xid].x, y: pos[xid].y};
          var obstacles = Object.keys(pos).filter(function(id){ return id !== xid; }).map(function(id){ return pos[id]; });
          var via = avoidPath(from, dest, obstacles);
          pos[xid] = dest;
          if (Math.hypot(dest.x-from.x, dest.y-from.y) > 6){
            autoTrails.push({ id: xid, from: from, to: dest, via: via });
          }
        });
      }
    }
    return { pos: pos, team: team, ballHolder: ballHolder, guardMap: guardMap, highlight: highlight, recovering: recovering, autoTrails: autoTrails };
  }

  function PlayDiagram(container){
    var script = container.querySelector('script[type="application/json"]');
    var data = JSON.parse(script.textContent);
    // Statisches Fallback-SVG entfernen — die interaktive Version übernimmt
    var staticFallback = container.querySelector('.pd-static');
    if (staticFallback && staticFallback.parentNode) staticFallback.parentNode.removeChild(staticFallback);
    this.data = data;
    this.container = container;
    this.pos = {};
    this.team = {};
    this.label = {};
    (data.players||[]).forEach(function(p){
      this.pos[p.id] = {x:p.x, y:p.y};
      this.team[p.id] = p.team;
      this.label[p.id] = p.label;
    }, this);
    this.ballHolder = data.ball || null;
    this.guardEngine = !!data.guardEngine;
    this.guardMap = {};
    this.manualIds = {};
    (data.players||[]).forEach(function(p){
      if (p.team === "X") this.guardMap[p.id] = "O" + p.id.slice(1);
      if (p.manual) this.manualIds[p.id] = true;
    }, this);
    this.recovering = {};
    this.highlight = {};
    this.prefixSteps = data.steps || [];
    this.steps = this.prefixSteps.slice();
    this.branch = data.branch || null;
    this.branchChoice = null;
    this.history = [this.snapshot()];
    this.stepIndex = 0;
    this.busy = false;
    this.buildDOM();
    this.renderStatic();
  }

  PlayDiagram.prototype.snapshot = function(){
    return {
      pos: JSON.parse(JSON.stringify(this.pos)),
      ball: this.ballHolder,
      guardMap: JSON.parse(JSON.stringify(this.guardMap)),
      recovering: JSON.parse(JSON.stringify(this.recovering)),
      highlight: JSON.parse(JSON.stringify(this.highlight))
    };
  };

  PlayDiagram.prototype.buildDOM = function(){
    var isFull = this.data.court === "full";
    var vb = isFull ? "0 0 300 620" : "0 0 300 340";
    var svg = el("svg", {viewBox: vb});
    var defs = el("defs", {});
    ["accent","navy","mute"].forEach(function(name){
      var color = name === "accent" ? "var(--accent)" : (name === "navy" ? "var(--text)" : "var(--text-mute)");
      var marker = el("marker", {id:"arrow-"+name, viewBox:"0 0 10 10", refX:"8", refY:"5", markerWidth:"6", markerHeight:"6", orient:"auto-start-reverse"});
      marker.appendChild(el("path", {d:"M0,0 L10,5 L0,10 z", fill:color}));
      defs.appendChild(marker);
    });
    svg.appendChild(defs);
    svg.appendChild(courtMarkup(this.data.court));
    this.trailLayer = el("g", {});
    svg.appendChild(this.trailLayer);
    this.playerLayer = el("g", {});
    svg.appendChild(this.playerLayer);
    this.ballEl = el("circle", {r:4.5, fill:"#C97A2E", stroke:"#7A4A1A", "stroke-width":1});
    svg.appendChild(this.ballEl);
    this.container.appendChild(svg);
    this.svg = svg;

    var caption = document.createElement("div");
    caption.className = "pd-caption";
    caption.textContent = "Ausgangsposition — \"Weiter\" antippen.";
    this.container.appendChild(caption);
    this.captionEl = caption;

    var controls = document.createElement("div");
    controls.className = "pd-controls";
    var back = document.createElement("button");
    back.type = "button"; back.className = "pd-btn"; back.textContent = "← Zurück";
    var stepLabel = document.createElement("div");
    stepLabel.className = "pd-step-label";
    var fwd = document.createElement("button");
    fwd.type = "button"; fwd.className = "pd-btn"; fwd.textContent = "Weiter →";
    controls.appendChild(back); controls.appendChild(stepLabel); controls.appendChild(fwd);
    this.container.appendChild(controls);
    this.backBtn = back; this.fwdBtn = fwd; this.stepLabelEl = stepLabel;

    var branchBox = document.createElement("div");
    branchBox.className = "pd-branch-box";
    this.container.appendChild(branchBox);
    this.branchBox = branchBox;

    var self = this;
    back.addEventListener("click", function(){ self.goBack(); });
    fwd.addEventListener("click", function(){ self.goForward(); });
    this.updateControls();
  };

  PlayDiagram.prototype.chooseBranch = function(i){
    if (this.busy || !this.branch || this.branchChoice !== null) return;
    this.branchChoice = i;
    this.steps = this.prefixSteps.concat(this.branch.options[i].steps);
    this.updateControls();
    this.goForward();
  };

  PlayDiagram.prototype.updateControls = function(){
    var self = this;
    var atBranch = this.branch && this.branchChoice === null && this.stepIndex === this.prefixSteps.length;
    this.backBtn.disabled = this.stepIndex === 0 || this.busy;
    if (atBranch){
      this.fwdBtn.style.display = "none";
      this.branchBox.classList.add("active");
      this.branchBox.innerHTML = "";
      this.branch.options.forEach(function(opt, i){
        var b = document.createElement("button");
        b.type = "button"; b.className = "pd-btn pd-btn-branch"; b.textContent = opt.label;
        b.disabled = self.busy;
        b.addEventListener("click", function(){ self.chooseBranch(i); });
        self.branchBox.appendChild(b);
      });
      this.stepLabelEl.textContent = "Optionen";
      this.captionEl.textContent = this.branch.prompt;
    } else {
      var total = this.steps.length;
      this.fwdBtn.style.display = "";
      this.branchBox.classList.remove("active");
      this.branchBox.innerHTML = "";
      this.fwdBtn.disabled = this.stepIndex >= total || this.busy;
      this.stepLabelEl.textContent = "Schritt " + this.stepIndex + "/" + total;
    }
  };

  PlayDiagram.prototype.renderStatic = function(){
    this.playerLayer.innerHTML = "";
    var self = this;
    var total = this.steps.length;
    var isFinish = this.stepIndex >= total && total > 0;
    Object.keys(this.pos).forEach(function(id){
      var p = self.pos[id];
      var isO = self.team[id] === "O";
      var isFinisher = isFinish && isO && id === self.ballHolder;
      var g = el("g", {"data-id": id});
      if (isFinisher){
        g.appendChild(el("circle", {cx:p.x, cy:p.y, r:15.5, fill:"none", stroke:"var(--accent)", "stroke-width":2.5, "class":"pd-finisher-ring"}));
      }
      if (isO){
        g.appendChild(el("circle", {cx:p.x, cy:p.y, r:11, fill: isFinisher ? "var(--accent-light)" : "#fff", stroke: isFinisher ? "var(--accent)" : "var(--navy)", "stroke-width":2.2, "class":"pd-shape"}));
      } else {
        var hl = self.highlight[id];
        if (hl === "help"){
          g.appendChild(el("circle", {cx:p.x, cy:p.y, r:14, fill:"none", stroke:"#F2C94C", "stroke-width":2.5, "class":"pd-help-ring"}));
        } else if (hl === "block"){
          g.appendChild(el("circle", {cx:p.x, cy:p.y, r:14, fill:"none", stroke:"#2F80ED", "stroke-width":2.5, "class":"pd-block-ring"}));
        }
        var xStroke = (hl === "beat" || hl === "switch") ? "#e03e2d" : "var(--text-mute)";
        var xStrokeW = (hl === "beat" || hl === "switch") ? 3 : 2;
        g.appendChild(el("rect", {x:p.x-9, y:p.y-9, width:18, height:18, fill:"var(--cream)", stroke:xStroke, "stroke-width":xStrokeW, transform:"rotate(45 "+p.x+" "+p.y+")", "class":"pd-shape"}));
      }
      var t = el("text", {x:p.x, y:p.y+3.5, "text-anchor":"middle", "font-size": isO ? 10.5 : 8.5, "font-weight":700, fill: isO ? "var(--navy)" : "var(--text-mute)", "class":"pd-label"});
      t.textContent = self.label[id];
      g.appendChild(t);
      self.playerLayer.appendChild(g);
    });
    this.updateBall(isFinish);
  };

  PlayDiagram.prototype.updateBall = function(isFinish){
    if (!this.ballHolder || !this.pos[this.ballHolder]){ this.ballEl.setAttribute("opacity","0"); return; }
    var p = this.pos[this.ballHolder];
    this.ballEl.setAttribute("opacity","1");
    this.ballEl.setAttribute("r", isFinish ? 6 : 4.5);
    this.ballEl.setAttribute("fill", isFinish ? "var(--accent)" : "#C97A2E");
    this.ballEl.setAttribute("cx", p.x + 9);
    this.ballEl.setAttribute("cy", p.y + 9);
  };

  PlayDiagram.prototype.drawTrail = function(action){
    var g = el("g", {});
    var from, to;
    if (action.type === "switch" || action.type === "beat" || action.type === "help" || action.type === "block"){
      return g; // keine Laufweg-Linie — nur Markierung, siehe renderStatic
    }
    if (action.type === "pass"){
      // Standard-Notation: Pass = gestrichelte Linie (Pässe fliegen gerade)
      from = this.pos[action.from]; to = this.pos[action.to];
      g.appendChild(el("line", {x1:from.x,y1:from.y,x2:to.x,y2:to.y, stroke:"var(--accent)", "stroke-width":2, "stroke-dasharray":"5,4", "marker-end":"url(#arrow-accent)"}));
    } else {
      from = this.pos[action.id]; to = action.to;
      var via = action.via || null;
      if (action.type === "dribble"){
        // Standard-Notation: Dribbling = wellenförmige Linie, optional geschwungen (via)
        g.appendChild(el("path", {d: wavyPathD(from, to, via), fill:"none", stroke:"var(--text)", "stroke-width":2, "marker-end":"url(#arrow-navy)"}));
      } else if (action.type === "screen"){
        // Standard-Notation: Screen = durchgezogene Linie mit T-Balken am Ende
        g.appendChild(el("line", {x1:from.x,y1:from.y,x2:to.x,y2:to.y, stroke:"var(--accent)", "stroke-width":2.5}));
        var dx = to.x-from.x, dy = to.y-from.y, len = Math.sqrt(dx*dx+dy*dy)||1;
        var px = -dy/len, py = dx/len;
        g.appendChild(el("line", {x1:to.x+px*9,y1:to.y+py*9,x2:to.x-px*9,y2:to.y-py*9, stroke:"var(--accent)", "stroke-width":2.5}));
      } else {
        // Standard-Notation: Cut/Laufweg = durchgezogene Linie mit Pfeil, optional geschwungen (via)
        g.appendChild(el("path", {d: curvePathD(from, to, via), fill:"none", stroke:"var(--text)", "stroke-width":1.8, "marker-end":"url(#arrow-navy)"}));
      }
    }
    return g;
  };

  PlayDiagram.prototype.goForward = function(){
    var total = this.steps.length;
    if (this.busy || this.stepIndex >= total) return;
    if (this.branch && this.branchChoice === null && this.stepIndex === this.prefixSteps.length) return;
    this.busy = true; this.updateControls();
    var step = this.steps[this.stepIndex];
    var self = this;
    var stepGroup = el("g", {});
    step.actions.forEach(function(a){ stepGroup.appendChild(self.drawTrail(a)); });
    this.trailLayer.appendChild(stepGroup);

    var moveTypes = {move:1, cut:1, dribble:1, screen:1};
    var moves = step.actions.filter(function(a){ return moveTypes[a.type]; }).map(function(a){
      var from = {x:self.pos[a.id].x, y:self.pos[a.id].y};
      return { id: a.id, from: from, to: a.to, via: a.via || null, duration: moveDuration(self.team[a.id], from, a.to) };
    });
    var passes = step.actions.filter(function(a){ return a.type === "pass"; });

    // Verteidiger-Engine: Switch (Zuordnung tauschen + rot markieren),
    // Beat (einfrieren + rot markieren, wird ab jetzt "recovering"), Help
    // (Leucht-Highlight) und Block (einfrieren + blau markieren) auswerten,
    // bevor Auto-Positionen berechnet werden.
    var newHighlight = {};
    // Help-Markierung bleibt bis zum Ende des Spielzugs sichtbar
    Object.keys(this.highlight).forEach(function(k){
      if (self.highlight[k] === "help") newHighlight[k] = "help";
    });
    var beatenIds = {};
    var blockedIds = {};
    step.actions.forEach(function(a){
      if (a.type === "switch"){
        var pa = a.players[0], pb = a.players[1];
        var tmp = self.guardMap[pa];
        self.guardMap[pa] = self.guardMap[pb];
        self.guardMap[pb] = tmp;
        newHighlight[pa] = "switch"; newHighlight[pb] = "switch";
      } else if (a.type === "beat"){
        beatenIds[a.id] = true;
        newHighlight[a.id] = "beat";
      } else if (a.type === "help"){
        newHighlight[a.id] = "help";
        // Helfer übernimmt das Ziel als neuer primärer Verteidiger —
        // die Engine setzt ihn damit automatisch auf die Drive-Lane (Intercept).
        if (a.target) self.guardMap[a.id] = a.target;
      } else if (a.type === "block"){
        blockedIds[a.id] = true;
        newHighlight[a.id] = "block";
      }
    });
    // Explizite move-Aktionen beenden den Recovering-Zustand (Autor übernimmt wieder die Kontrolle).
    moves.forEach(function(m){
      if (self.team[m.id] === "X") delete self.recovering[m.id];
    });
    if (this.guardEngine){
      var movesTo = {};
      moves.forEach(function(m){ movesTo[m.id] = m.to; });
      var isFull = this.data.court === "full";
      // Bewusst die Ball-Position VOR einem eventuellen Pass in diesem Schritt
      // verwenden — sonst "weiß" ein bisher unbeteiligter Verteidiger schon,
      // dass der Ball gerade seinen Mann erreicht, und snapped im selben
      // Moment eng zu ihm (Teleport-Effekt bei offenen Abschlüssen).
      var ballPos = self.ballHolder ? self.pos[self.ballHolder] : null;
      Object.keys(this.guardMap).forEach(function(xid){
        if (self.manualIds[xid]) return; // Engine für diesen Spieler deaktiviert
        if (beatenIds[xid]) return; // bleibt eingefroren, wird geschlagen
        if (blockedIds[xid]) return; // bleibt eingefroren, blockt gerade
        if (movesTo[xid]) return; // hat schon eine explizite Aktion
        var oid = self.guardMap[xid];
        var attacker = movesTo[oid] || self.pos[oid];
        var basket = basketFor(attacker, isFull);
        var dest = self.recovering[xid] ? guardRecoverPos(attacker, basket) : guardHomePos(attacker, basket, ballPos);
        var from = {x:self.pos[xid].x, y:self.pos[xid].y};
        // Der eigene Gegenspieler zählt jetzt auch als Hindernis (avoidPath
        // ignoriert ohnehin Hindernisse nahe am Ziel, das bricht also nicht
        // die normale "Verteidiger landet nah am Angreifer"-Situation).
        var obstacles = Object.keys(self.pos).filter(function(id){ return id !== xid; }).map(function(id){ return self.pos[id]; });
        var via = avoidPath(from, dest, obstacles);
        moves.push({ id: xid, from: from, to: dest, via: via, duration: moveDuration("X", from, dest) });
        // Auch automatische Verteidiger-Rotationen sichtbar machen (dezent,
        // damit klar ist WIE der Verteidiger dorthin kam — kein Teleport).
        if (Math.hypot(dest.x-from.x, dest.y-from.y) > 6){
          stepGroup.appendChild(el("path", {d: curvePathD(from, dest, via), fill:"none", stroke:"var(--text-mute)", "stroke-width":1.3, "stroke-dasharray":"2,3", "marker-end":"url(#arrow-mute)"}));
        }
      });
    }
    Object.keys(beatenIds).forEach(function(xid){ self.recovering[xid] = true; });

    var start = null;
    function frame(ts){
      if (start === null) start = ts;
      var elapsed = ts - start;
      // Auch ein Schritt ganz ohne Bewegung (nur beat/help/block/switch-Marker)
      // bleibt so mindestens MIN_MOVE_DURATION lang sichtbar, statt sofort weiterzuspringen.
      var allDone = elapsed >= MIN_MOVE_DURATION;
      moves.forEach(function(m){
        // Jeder Spieler kommt nach seiner eigenen (distanz-/teamabhängigen)
        // Dauer an — der Schritt gilt erst als fertig, wenn der langsamste/
        // am weitesten laufende Spieler angekommen ist.
        var t = Math.min(1, elapsed/m.duration);
        if (t < 1) allDone = false;
        var e = easeInOut(t);
        // Spieler folgt der Kurve, wenn ein via-Kontrollpunkt gesetzt ist
        self.pos[m.id] = m.via
          ? qpoint(m.from, m.via, m.to, e)
          : { x: m.from.x + (m.to.x-m.from.x)*e, y: m.from.y + (m.to.y-m.from.y)*e };
      });
      passes.forEach(function(p){
        var t = Math.min(1, elapsed/PASS_DURATION);
        if (t < 1) allDone = false;
        if (self.ballHolder === p.from){
          var e = easeInOut(t);
          var fp = self.pos[p.from], tp = self.pos[p.to];
          var bx = fp.x + (tp.x-fp.x)*e, by = fp.y + (tp.y-fp.y)*e;
          self.ballEl.setAttribute("opacity","1");
          self.ballEl.setAttribute("cx", bx+9); self.ballEl.setAttribute("cy", by+9);
        }
      });
      self.renderPositionsOnly();
      if (!allDone){
        requestAnimationFrame(frame);
      } else {
        moves.forEach(function(m){ self.pos[m.id] = {x:m.to.x, y:m.to.y}; });
        passes.forEach(function(p){ self.ballHolder = p.to; });
        self.highlight = newHighlight;
        self.stepIndex++;
        self.renderStatic();
        self.history.push(self.snapshot());
        self.captionEl.textContent = step.caption;
        self.busy = false;
        self.updateControls();
      }
    }
    requestAnimationFrame(frame);
  };

  PlayDiagram.prototype.renderPositionsOnly = function(){
    var self = this;
    Object.keys(this.pos).forEach(function(id){
      var g = self.playerLayer.querySelector('[data-id="'+id+'"]');
      if (!g) return;
      var p = self.pos[id];
      var shape = g.querySelector(".pd-shape"), text = g.querySelector(".pd-label");
      if (!shape || !text) return;
      if (shape.tagName === "circle"){ shape.setAttribute("cx",p.x); shape.setAttribute("cy",p.y); }
      else { shape.setAttribute("x",p.x-9); shape.setAttribute("y",p.y-9); shape.setAttribute("transform","rotate(45 "+p.x+" "+p.y+")"); }
      text.setAttribute("x", p.x); text.setAttribute("y", p.y+3.5);
      var ring = g.querySelector(".pd-finisher-ring") || g.querySelector(".pd-help-ring") || g.querySelector(".pd-block-ring");
      if (ring){ ring.setAttribute("cx",p.x); ring.setAttribute("cy",p.y); }
    });
    this.updateBall();
  };

  PlayDiagram.prototype.goBack = function(){
    if (this.busy || this.stepIndex === 0) return;
    this.stepIndex--;
    var snap = this.history[this.stepIndex];
    this.pos = JSON.parse(JSON.stringify(snap.pos));
    this.ballHolder = snap.ball;
    this.guardMap = JSON.parse(JSON.stringify(snap.guardMap));
    this.recovering = JSON.parse(JSON.stringify(snap.recovering));
    this.highlight = JSON.parse(JSON.stringify(snap.highlight));
    // Zurück am Fork: gewählte Option verwerfen, Optionsauswahl erneut anzeigen
    if (this.branch && this.branchChoice !== null && this.stepIndex === this.prefixSteps.length){
      this.branchChoice = null;
      this.steps = this.prefixSteps.slice();
      this.history.length = this.stepIndex + 1;
    }
    var toRemove = this.trailLayer.children[this.trailLayer.children.length-1];
    if (toRemove) this.trailLayer.removeChild(toRemove);
    this.renderStatic();
    if (this.branch && this.branchChoice === null && this.stepIndex === this.prefixSteps.length){
      // caption wird von updateControls() auf branch.prompt gesetzt
    } else {
      this.captionEl.textContent = this.stepIndex === 0 ? "Ausgangsposition — \"Weiter\" antippen." : this.steps[this.stepIndex-1].caption;
    }
    this.updateControls();
  };

  document.addEventListener("DOMContentLoaded", function(){
    document.querySelectorAll(".play-diagram").forEach(function(container){
      new PlayDiagram(container);
    });
  });

  // Öffentliche API — wird vom Playbook-Viewer (oben) und vom Play-Editor
  // (editor/editor.js) gemeinsam genutzt, damit Court-Geometrie, Guard-Engine
  // und Aktions-Notation an genau einer Stelle gepflegt werden.
  window.DiagramEngine = {
    courtMarkup: courtMarkup,
    qpoint: qpoint,
    wavyPathD: wavyPathD,
    curvePathD: curvePathD,
    basketFor: basketFor,
    guardHomePos: guardHomePos,
    guardRecoverPos: guardRecoverPos,
    avoidPath: avoidPath,
    computeStepState: computeStepState,
    PlayDiagram: PlayDiagram,
    el: el
  };
})();
