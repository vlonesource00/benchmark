import * as THREE from 'three';

const MAX_CANDIDATES = 36;
const MAX_POINTS_PER_TRAJ = 32;
const MAX_CORRIDOR_POINTS = 32;
const MAX_PRED_OPPONENTS = 6;

/**
 * High-Fidelity 3D Visual AI Introspection System for Benchmark Sandbox.
 * Renders real-time controller decision geometry on the track:
 * 1. Selected Trajectory Ribbon (0.65m wide, mode-colored, elevated)
 * 2. Previous Active Trajectory Ghost (fading lilac ribbon + divergence point)
 * 3. Candidate Lattice (24-32 paths color-coded by rejection reason + conflict markers)
 * 4. Tactical Corridor (translucent [dMin, dMax] envelope)
 * 5. Opponent Predictions (0.5s, 1.0s, 2.0s, 3.0s wireframe 3D boxes + trails)
 * 6. Target Vehicle Highlight (ground ring + laser tracking line)
 * 7. Lookahead Aim Point & Markers (tracking sphere, axle line, braking bar, commitment glyphs)
 */
export class VisualAIDebugger {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} track
   */
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.enabled = true;

    this.layers = {
      1: true, // Selected Trajectory Ribbon
      2: true, // Previous Trajectory Ghost
      3: true, // Candidate Lattice
      4: true, // Tactical Corridor
      5: true, // Opponent Predictions
      6: true, // Target Vehicle Highlight
      7: true  // Lookahead & Markers
    };

    this.root = new THREE.Group();
    this.root.name = 'VisualAIDebuggerRoot';
    this.scene.add(this.root);

    this._initLayer1();
    this._initLayer2();
    this._initLayer3();
    this._initLayer4();
    this._initLayer5();
    this._initLayer6();
    this._initLayer7();
    this._initRoadLimits();
  }

  toggleMaster() {
    this.enabled = !this.enabled;
    this.root.visible = this.enabled;
    return this.enabled;
  }

  setMaster(enabled) {
    this.enabled = Boolean(enabled);
    this.root.visible = this.enabled;
    return this.enabled;
  }

  toggleLayer(layerNum) {
    if (this.layers[layerNum] !== undefined) {
      this.layers[layerNum] = !this.layers[layerNum];
      this._applyLayerVisibility();
      return this.layers[layerNum];
    }
    return false;
  }

  setLayer(layerNum, visible) {
    if (this.layers[layerNum] !== undefined) {
      this.layers[layerNum] = Boolean(visible);
      this._applyLayerVisibility();
    }
  }

  _applyLayerVisibility() {
    if (this.layer1Group) this.layer1Group.visible = this.enabled && this.layers[1];
    if (this.layer2Group) this.layer2Group.visible = this.enabled && this.layers[2];
    if (this.layer3Group) this.layer3Group.visible = this.enabled && this.layers[3];
    if (this.layer4Group) this.layer4Group.visible = this.enabled && this.layers[4];
    if (this.layer5Group) this.layer5Group.visible = this.enabled && this.layers[5];
    if (this.layer6Group) this.layer6Group.visible = this.enabled && this.layers[6];
    if (this.layer7Group) this.layer7Group.visible = this.enabled && this.layers[7];
  }

  // --- Layer 1: Selected Trajectory Ribbon ---
  _initLayer1() {
    this.layer1Group = new THREE.Group();
    this.root.add(this.layer1Group);

    // Dynamic ribbon mesh (triangle strip)
    const maxVerts = MAX_POINTS_PER_TRAJ * 2;
    const maxIndices = (MAX_POINTS_PER_TRAJ - 1) * 6;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(maxVerts * 3);
    const indices = new Uint16Array(maxIndices);

    let idx = 0;
    for (let i = 0; i < MAX_POINTS_PER_TRAJ - 1; i++) {
      const v0 = i * 2;
      const v1 = i * 2 + 1;
      const v2 = (i + 1) * 2;
      const v3 = (i + 1) * 2 + 1;
      indices[idx++] = v0; indices[idx++] = v1; indices[idx++] = v2;
      indices[idx++] = v1; indices[idx++] = v3; indices[idx++] = v2;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.setDrawRange(0, 0);

    this.selectedRibbonMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    });
    this.selectedRibbonMesh = new THREE.Mesh(geom, this.selectedRibbonMat);
    this.selectedRibbonMesh.renderOrder = 20;
    this.layer1Group.add(this.selectedRibbonMesh);

    // Glowing center spine line
    const spineGeom = new THREE.BufferGeometry();
    spineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS_PER_TRAJ * 3), 3));
    spineGeom.setDrawRange(0, 0);
    this.selectedSpineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
      transparent: true,
      opacity: 0.95
    });
    this.selectedSpineLine = new THREE.Line(spineGeom, this.selectedSpineMat);
    this.selectedSpineLine.renderOrder = 21;
    this.layer1Group.add(this.selectedSpineLine);
  }

  // --- Layer 2: Previous Trajectory Ghost ---
  _initLayer2() {
    this.layer2Group = new THREE.Group();
    this.root.add(this.layer2Group);

    const maxVerts = MAX_POINTS_PER_TRAJ * 2;
    const maxIndices = (MAX_POINTS_PER_TRAJ - 1) * 6;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(maxVerts * 3);
    const indices = new Uint16Array(maxIndices);

    let idx = 0;
    for (let i = 0; i < MAX_POINTS_PER_TRAJ - 1; i++) {
      const v0 = i * 2;
      const v1 = i * 2 + 1;
      const v2 = (i + 1) * 2;
      const v3 = (i + 1) * 2 + 1;
      indices[idx++] = v0; indices[idx++] = v1; indices[idx++] = v2;
      indices[idx++] = v1; indices[idx++] = v3; indices[idx++] = v2;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.setDrawRange(0, 0);

    this.ghostRibbonMat = new THREE.MeshBasicMaterial({
      color: 0xd8b4fe,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    this.ghostRibbonMesh = new THREE.Mesh(geom, this.ghostRibbonMat);
    this.ghostRibbonMesh.renderOrder = 18;
    this.layer2Group.add(this.ghostRibbonMesh);

    // Divergence point ring marker
    const ringGeom = new THREE.RingGeometry(0.25, 0.45, 16);
    ringGeom.rotateX(-Math.PI / 2);
    this.divergenceRingMat = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    this.divergenceRing = new THREE.Mesh(ringGeom, this.divergenceRingMat);
    this.divergenceRing.renderOrder = 22;
    this.divergenceRing.visible = false;
    this.layer2Group.add(this.divergenceRing);
  }

  // --- Layer 3: Candidate Lattice ---
  _initLayer3() {
    this.layer3Group = new THREE.Group();
    this.root.add(this.layer3Group);

    this.candidateLines = [];
    for (let i = 0; i < MAX_CANDIDATES; i++) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS_PER_TRAJ * 3), 3));
      geom.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      const line = new THREE.Line(geom, mat);
      line.renderOrder = 19;
      line.visible = false;
      this.layer3Group.add(line);
      this.candidateLines.push(line);
    }

    // Pool of collision conflict marker spheres and needle lines
    this.conflictMarkers = [];
    const sphereGeom = new THREE.SphereGeometry(0.35, 12, 10);
    const needleGeom = new THREE.BufferGeometry();
    needleGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1.8, 0]), 3));

    for (let i = 0; i < 12; i++) {
      const group = new THREE.Group();
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff1111 });
      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      sphere.position.y = 1.8;
      const needleMat = new THREE.LineBasicMaterial({ color: 0xff3333, linewidth: 2 });
      const needle = new THREE.Line(needleGeom, needleMat);

      group.add(sphere);
      group.add(needle);
      group.visible = false;
      this.layer3Group.add(group);
      this.conflictMarkers.push(group);
    }
  }

  // --- Layer 4: Tactical Corridor ---
  _initLayer4() {
    this.layer4Group = new THREE.Group();
    this.root.add(this.layer4Group);

    const maxVerts = MAX_CORRIDOR_POINTS * 2;
    const maxIndices = (MAX_CORRIDOR_POINTS - 1) * 6;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(maxVerts * 3);
    const indices = new Uint16Array(maxIndices);

    let idx = 0;
    for (let i = 0; i < MAX_CORRIDOR_POINTS - 1; i++) {
      const v0 = i * 2;
      const v1 = i * 2 + 1;
      const v2 = (i + 1) * 2;
      const v3 = (i + 1) * 2 + 1;
      indices[idx++] = v0; indices[idx++] = v1; indices[idx++] = v2;
      indices[idx++] = v1; indices[idx++] = v3; indices[idx++] = v2;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.setDrawRange(0, 0);

    this.corridorMat = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    this.corridorMesh = new THREE.Mesh(geom, this.corridorMat);
    this.corridorMesh.renderOrder = 15;
    this.layer4Group.add(this.corridorMesh);

    // Left and right boundary lines
    const leftGeom = new THREE.BufferGeometry();
    leftGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CORRIDOR_POINTS * 3), 3));
    leftGeom.setDrawRange(0, 0);
    this.corridorLeftLine = new THREE.Line(leftGeom, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7 }));
    this.corridorLeftLine.renderOrder = 16;
    this.layer4Group.add(this.corridorLeftLine);

    const rightGeom = new THREE.BufferGeometry();
    rightGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CORRIDOR_POINTS * 3), 3));
    rightGeom.setDrawRange(0, 0);
    this.corridorRightLine = new THREE.Line(rightGeom, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7 }));
    this.corridorRightLine.renderOrder = 16;
    this.layer4Group.add(this.corridorRightLine);
  }

  // --- Layer 5: Opponent Predictions ---
  _initLayer5() {
    this.layer5Group = new THREE.Group();
    this.root.add(this.layer5Group);

    this.opponentVisuals = [];
    const boxGeom = new THREE.BoxGeometry(2.05, 1.15, 4.65);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);

    const colors = [0xff2244, 0xff8800, 0xffdd00, 0x00d2ff]; // 0.5s, 1.0s, 2.0s, 3.0s

    for (let i = 0; i < MAX_PRED_OPPONENTS; i++) {
      const trailGeom = new THREE.BufferGeometry();
      trailGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(32 * 3), 3));
      trailGeom.setDrawRange(0, 0);
      const trailLine = new THREE.Line(trailGeom, new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.65 }));
      trailLine.renderOrder = 17;
      this.layer5Group.add(trailLine);

      const boxes = [];
      for (let b = 0; b < 4; b++) {
        const boxMat = new THREE.LineBasicMaterial({ color: colors[b], transparent: true, opacity: 0.85 });
        const wireBox = new THREE.LineSegments(boxEdges, boxMat);
        wireBox.renderOrder = 24;
        wireBox.visible = false;
        this.layer5Group.add(wireBox);
        boxes.push(wireBox);
      }

      this.opponentVisuals.push({ trailLine, boxes });
    }
  }

  // --- Layer 6: Target Vehicle Highlight ---
  _initLayer6() {
    this.layer6Group = new THREE.Group();
    this.root.add(this.layer6Group);

    // Ground ring under target vehicle
    const ringGeom = new THREE.RingGeometry(1.8, 2.3, 32);
    ringGeom.rotateX(-Math.PI / 2);
    this.targetRingMat = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    this.targetRingMesh = new THREE.Mesh(ringGeom, this.targetRingMat);
    this.targetRingMesh.renderOrder = 23;
    this.targetRingMesh.visible = false;
    this.layer6Group.add(this.targetRingMesh);

    // Laser tracking line between ego front and target rear
    const laserGeom = new THREE.BufferGeometry();
    laserGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0]), 3));
    this.laserMat = new THREE.LineBasicMaterial({
      color: 0xff2222,
      linewidth: 2,
      transparent: true,
      opacity: 0.95
    });
    this.laserLine = new THREE.Line(laserGeom, this.laserMat);
    this.laserLine.renderOrder = 25;
    this.laserLine.visible = false;
    this.layer6Group.add(this.laserLine);
  }

  // --- Layer 7: Lookahead Aim & Markers ---
  _initLayer7() {
    this.layer7Group = new THREE.Group();
    this.root.add(this.layer7Group);

    // Bright tracking aim point sphere
    const sphereGeom = new THREE.SphereGeometry(0.28, 14, 12);
    this.trackingSphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    this.trackingSphere = new THREE.Mesh(sphereGeom, this.trackingSphereMat);
    this.trackingSphere.renderOrder = 26;
    this.trackingSphere.visible = false;
    this.layer7Group.add(this.trackingSphere);

    // Axle connector line to tracking aim point
    const axleGeom = new THREE.BufferGeometry();
    axleGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0]), 3));
    this.axleLineMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.75 });
    this.axleLine = new THREE.Line(axleGeom, this.axleLineMat);
    this.axleLine.renderOrder = 25;
    this.axleLine.visible = false;
    this.layer7Group.add(this.axleLine);

    // Transverse Braking Bar
    const brakeGeom = new THREE.PlaneGeometry(4.2, 0.45);
    brakeGeom.rotateX(-Math.PI / 2);
    this.brakingBarMat = new THREE.MeshBasicMaterial({
      color: 0xff1111,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    this.brakingBar = new THREE.Mesh(brakeGeom, this.brakingBarMat);
    this.brakingBar.renderOrder = 22;
    this.brakingBar.visible = false;
    this.layer7Group.add(this.brakingBar);

    // Commitment Glyph (Chevron, Diamond, or X)
    const glyphGeom = new THREE.BufferGeometry();
    const chevronPts = new Float32Array([
      -1.2, 0, -0.6,   0.0, 0, 0.8,
       0.0, 0,  0.8,   1.2, 0, -0.6
    ]);
    glyphGeom.setAttribute('position', new THREE.BufferAttribute(chevronPts, 3));
    this.commitmentGlyphMat = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 });
    this.commitmentGlyph = new THREE.LineSegments(glyphGeom, this.commitmentGlyphMat);
    this.commitmentGlyph.renderOrder = 23;
    this.commitmentGlyph.visible = false;
    this.layer7Group.add(this.commitmentGlyph);
  }

  // --- Road & Planner Limits ---
  _initRoadLimits() {
    this.roadLimitsGroup = new THREE.Group();
    this.root.add(this.roadLimitsGroup);

    const makeLine = (color, opacity = 0.5) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      geom.setDrawRange(0, 0);
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      line.renderOrder = 14;
      this.roadLimitsGroup.add(line);
      return line;
    };

    this.lineAsphaltL = makeLine(0xffffff, 0.45);
    this.lineAsphaltR = makeLine(0xffffff, 0.45);
    this.linePlannerL = makeLine(0x00e5ff, 0.65);
    this.linePlannerR = makeLine(0x00e5ff, 0.65);
  }

  /**
   * Main per-frame visual update routine.
   * @param {Object|null} debugData - Canonical debug bundle from getDebugVisuals()
   * @param {boolean} [isSelected=true] - Whether the subject car is currently selected
   */
  update(debugData, isSelected = true) {
    if (!this.enabled || !debugData || !isSelected) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this._applyLayerVisibility();

    // 1. Update Selected Trajectory Ribbon
    if (this.layers[1] && debugData.selectedTrajectory) {
      const traj = debugData.selectedTrajectory;
      const pts = traj.points || [];
      const N = Math.min(pts.length, MAX_POINTS_PER_TRAJ);

      if (N >= 2) {
        const geom = this.selectedRibbonMesh.geometry;
        const posAttr = geom.getAttribute('position');
        const spineGeom = this.selectedSpineLine.geometry;
        const spinePos = spineGeom.getAttribute('position');

        const halfW = (traj.ribbonWidth || 0.65) * 0.5;
        const lift = traj.lift || 0.06;

        for (let i = 0; i < N; i++) {
          const p = pts[i];
          const next = i < N - 1 ? pts[i + 1] : pts[i];
          const prev = i > 0 ? pts[i - 1] : pts[i];

          const dx = next.x - prev.x;
          const dz = next.z - prev.z;
          const len = Math.hypot(dx, dz) || 1;
          const nx = (-dz / len) * halfW;
          const nz = (dx / len) * halfW;

          const yBase = (p.y ?? 0) + lift;

          posAttr.setXYZ(i * 2, p.x + nx, yBase, p.z + nz);
          posAttr.setXYZ(i * 2 + 1, p.x - nx, yBase, p.z - nz);
          spinePos.setXYZ(i, p.x, yBase + 0.015, p.z);
        }

        posAttr.needsUpdate = true;
        spinePos.needsUpdate = true;

        geom.setDrawRange(0, (N - 1) * 6);
        spineGeom.setDrawRange(0, N);

        if (traj.color) {
          this.selectedRibbonMat.color.set(traj.color);
        }
        this.selectedRibbonMesh.visible = true;
        this.selectedSpineLine.visible = true;
      } else {
        this.selectedRibbonMesh.visible = false;
        this.selectedSpineLine.visible = false;
      }
    } else {
      this.selectedRibbonMesh.visible = false;
      this.selectedSpineLine.visible = false;
    }

    // 2. Update Previous Trajectory Ghost
    if (this.layers[2] && debugData.previousTrajectory) {
      const ghost = debugData.previousTrajectory;
      const pts = ghost.points || [];
      const N = Math.min(pts.length, MAX_POINTS_PER_TRAJ);

      if (N >= 2 && (ghost.opacity ?? 0) > 0.02) {
        const geom = this.ghostRibbonMesh.geometry;
        const posAttr = geom.getAttribute('position');
        const halfW = 0.55 * 0.5;
        const lift = 0.045;

        for (let i = 0; i < N; i++) {
          const p = pts[i];
          const next = i < N - 1 ? pts[i + 1] : pts[i];
          const prev = i > 0 ? pts[i - 1] : pts[i];

          const dx = next.x - prev.x;
          const dz = next.z - prev.z;
          const len = Math.hypot(dx, dz) || 1;
          const nx = (-dz / len) * halfW;
          const nz = (dx / len) * halfW;

          const yBase = (p.y ?? 0) + lift;
          posAttr.setXYZ(i * 2, p.x + nx, yBase, p.z + nz);
          posAttr.setXYZ(i * 2 + 1, p.x - nx, yBase, p.z - nz);
        }

        posAttr.needsUpdate = true;
        geom.setDrawRange(0, (N - 1) * 6);
        this.ghostRibbonMat.opacity = Math.min(0.65, ghost.opacity * 0.65);
        this.ghostRibbonMesh.visible = true;

        if (ghost.divergencePoint) {
          this.divergenceRing.position.set(ghost.divergencePoint.x, (ghost.divergencePoint.y ?? 0) + 0.07, ghost.divergencePoint.z);
          this.divergenceRingMat.opacity = ghost.opacity;
          this.divergenceRing.visible = true;
        } else {
          this.divergenceRing.visible = false;
        }
      } else {
        this.ghostRibbonMesh.visible = false;
        this.divergenceRing.visible = false;
      }
    } else {
      this.ghostRibbonMesh.visible = false;
      this.divergenceRing.visible = false;
    }

    // 3. Update Candidate Lattice
    if (this.layers[3] && Array.isArray(debugData.candidates)) {
      const candidates = debugData.candidates;
      let conflictIdx = 0;

      for (let c = 0; c < this.candidateLines.length; c++) {
        const line = this.candidateLines[c];
        if (c < candidates.length) {
          const cand = candidates[c];
          const pts = cand.points || [];
          const N = Math.min(pts.length, MAX_POINTS_PER_TRAJ);

          if (N >= 2) {
            const posAttr = line.geometry.getAttribute('position');
            for (let i = 0; i < N; i++) {
              posAttr.setXYZ(i, pts[i].x, (pts[i].y ?? 0) + 0.03, pts[i].z);
            }
            posAttr.needsUpdate = true;
            line.geometry.setDrawRange(0, N);

            if (cand.color) line.material.color.set(cand.color);
            line.material.opacity = cand.selected ? 0.9 : (cand.rejectionReason === 'VIABLE_ALTERNATIVE' ? 0.75 : 0.45);
            line.visible = true;

            if (cand.conflictPoint && conflictIdx < this.conflictMarkers.length) {
              const marker = this.conflictMarkers[conflictIdx];
              marker.position.set(cand.conflictPoint.x, cand.conflictPoint.y ?? 0, cand.conflictPoint.z);
              marker.visible = true;
              conflictIdx++;
            }
          } else {
            line.visible = false;
          }
        } else {
          line.visible = false;
        }
      }

      for (let k = conflictIdx; k < this.conflictMarkers.length; k++) {
        this.conflictMarkers[k].visible = false;
      }
    } else {
      for (const line of this.candidateLines) line.visible = false;
      for (const marker of this.conflictMarkers) marker.visible = false;
    }

    // 4. Update Tactical Corridor
    if (this.layers[4] && debugData.tacticalCorridor) {
      const corr = debugData.tacticalCorridor;
      const left = corr.leftBoundary || [];
      const right = corr.rightBoundary || [];
      const N = Math.min(left.length, right.length, MAX_CORRIDOR_POINTS);

      if (N >= 2) {
        const geom = this.corridorMesh.geometry;
        const posAttr = geom.getAttribute('position');
        const leftPos = this.corridorLeftLine.geometry.getAttribute('position');
        const rightPos = this.corridorRightLine.geometry.getAttribute('position');

        for (let i = 0; i < N; i++) {
          posAttr.setXYZ(i * 2, left[i].x, (left[i].y ?? 0) + 0.02, left[i].z);
          posAttr.setXYZ(i * 2 + 1, right[i].x, (right[i].y ?? 0) + 0.02, right[i].z);

          leftPos.setXYZ(i, left[i].x, (left[i].y ?? 0) + 0.03, left[i].z);
          rightPos.setXYZ(i, right[i].x, (right[i].y ?? 0) + 0.03, right[i].z);
        }

        posAttr.needsUpdate = true;
        leftPos.needsUpdate = true;
        rightPos.needsUpdate = true;

        geom.setDrawRange(0, (N - 1) * 6);
        this.corridorLeftLine.geometry.setDrawRange(0, N);
        this.corridorRightLine.geometry.setDrawRange(0, N);

        if (corr.color) {
          this.corridorMat.color.set(corr.color);
          this.corridorLeftLine.material.color.set(corr.color);
          this.corridorRightLine.material.color.set(corr.color);
        }
        this.corridorMesh.visible = true;
        this.corridorLeftLine.visible = true;
        this.corridorRightLine.visible = true;
      } else {
        this.corridorMesh.visible = false;
        this.corridorLeftLine.visible = false;
        this.corridorRightLine.visible = false;
      }
    } else {
      this.corridorMesh.visible = false;
      this.corridorLeftLine.visible = false;
      this.corridorRightLine.visible = false;
    }

    // 5. Update Opponent Predictions
    if (this.layers[5] && Array.isArray(debugData.opponentPredictions)) {
      const preds = debugData.opponentPredictions;

      for (let o = 0; o < this.opponentVisuals.length; o++) {
        const vis = this.opponentVisuals[o];
        if (o < preds.length) {
          const opp = preds[o];
          const trail = opp.trail || [];
          const N = Math.min(trail.length, 32);

          if (N >= 2) {
            const posAttr = vis.trailLine.geometry.getAttribute('position');
            for (let i = 0; i < N; i++) {
              posAttr.setXYZ(i, trail[i].x, (trail[i].y ?? 0) + 0.04, trail[i].z);
            }
            posAttr.needsUpdate = true;
            vis.trailLine.geometry.setDrawRange(0, N);
            vis.trailLine.visible = true;
          } else {
            vis.trailLine.visible = false;
          }

          const boxes = opp.boxes || [];
          for (let b = 0; b < vis.boxes.length; b++) {
            const wireBox = vis.boxes[b];
            if (b < boxes.length) {
              const box = boxes[b];
              wireBox.position.set(box.x, box.y, box.z);
              wireBox.rotation.set(0, box.yaw ?? 0, 0);
              wireBox.visible = true;
            } else {
              wireBox.visible = false;
            }
          }
        } else {
          vis.trailLine.visible = false;
          for (const wb of vis.boxes) wb.visible = false;
        }
      }
    } else {
      for (const vis of this.opponentVisuals) {
        vis.trailLine.visible = false;
        for (const wb of vis.boxes) wb.visible = false;
      }
    }

    // 6. Update Target Vehicle Highlight
    if (this.layers[6] && debugData.targetVehicle) {
      const tgt = debugData.targetVehicle;
      if (tgt.position) {
        this.targetRingMesh.position.set(tgt.position.x, (tgt.position.y ?? 0) + 0.05, tgt.position.z);
        this.targetRingMesh.visible = true;

        if (tgt.egoFront && tgt.targetRear) {
          const laserPos = this.laserLine.geometry.getAttribute('position');
          laserPos.setXYZ(0, tgt.egoFront.x, tgt.egoFront.y, tgt.egoFront.z);
          laserPos.setXYZ(1, tgt.targetRear.x, tgt.targetRear.y, tgt.targetRear.z);
          laserPos.needsUpdate = true;
          this.laserLine.visible = true;
        } else {
          this.laserLine.visible = false;
        }
      } else {
        this.targetRingMesh.visible = false;
        this.laserLine.visible = false;
      }
    } else {
      this.targetRingMesh.visible = false;
      this.laserLine.visible = false;
    }

    // 7. Update Lookahead Aim & Markers
    if (this.layers[7]) {
      if (debugData.trackingPoint) {
        const tp = debugData.trackingPoint;
        this.trackingSphere.position.set(tp.x, (tp.y ?? 0) + 0.35, tp.z);
        this.trackingSphere.visible = true;

        if (debugData.frontAxle) {
          const ax = debugData.frontAxle;
          const pos = this.axleLine.geometry.getAttribute('position');
          pos.setXYZ(0, ax.x, ax.y, ax.z);
          pos.setXYZ(1, tp.x, (tp.y ?? 0) + 0.35, tp.z);
          pos.needsUpdate = true;
          this.axleLine.visible = true;
        } else {
          this.axleLine.visible = false;
        }
      } else {
        this.trackingSphere.visible = false;
        this.axleLine.visible = false;
      }

      if (debugData.markers?.braking?.active) {
        const brk = debugData.markers.braking;
        this.brakingBar.position.set(brk.x, brk.y, brk.z);
        this.brakingBar.rotation.set(0, brk.yaw ?? 0, 0);
        this.brakingBar.visible = true;
      } else {
        this.brakingBar.visible = false;
      }

      if (debugData.markers?.commitment?.type && debugData.markers.commitment.type !== 'NONE') {
        const com = debugData.markers.commitment;
        this.commitmentGlyph.position.set(com.x, com.y, com.z);
        this.commitmentGlyph.rotation.set(0, com.yaw ?? 0, 0);
        if (com.type === 'DIVE') this.commitmentGlyphMat.color.set(0xff2222);
        else if (com.type === 'SWITCHBACK') this.commitmentGlyphMat.color.set(0xd020d0);
        else this.commitmentGlyphMat.color.set(0xff8800);
        this.commitmentGlyph.visible = true;
      } else {
        this.commitmentGlyph.visible = false;
      }
    } else {
      this.trackingSphere.visible = false;
      this.axleLine.visible = false;
      this.brakingBar.visible = false;
      this.commitmentGlyph.visible = false;
    }

    // 8. Update Track and Road Limits ahead
    if (debugData.roadLimits) {
      const rl = debugData.roadLimits;
      const updateLine = (line, pts) => {
        if (Array.isArray(pts) && pts.length >= 2) {
          const N = Math.min(pts.length, 24);
          const pos = line.geometry.getAttribute('position');
          for (let i = 0; i < N; i++) {
            pos.setXYZ(i, pts[i].x, (pts[i].y ?? 0) + 0.03, pts[i].z);
          }
          pos.needsUpdate = true;
          line.geometry.setDrawRange(0, N);
          line.visible = true;
        } else {
          line.visible = false;
        }
      };

      updateLine(this.lineAsphaltL, rl.asphaltLeft);
      updateLine(this.lineAsphaltR, rl.asphaltRight);
      updateLine(this.linePlannerL, rl.plannerLeft);
      updateLine(this.linePlannerR, rl.plannerRight);
    }
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
