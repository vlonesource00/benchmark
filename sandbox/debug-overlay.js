import * as THREE from 'three';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function nestedPath(debug) {
  const candidates = [
    debug?.planPath,
    debug?.path,
    debug?.trajectoryPlan?.path,
    debug?.trajectoryPlan?.points,
    debug?.trajectory?.path,
    debug?.plans?.[0]?.path,
    debug?.plans?.[0]?.points,
    debug?.candidates?.[0]?.path,
    debug?.candidates?.[0]?.points
  ];
  return candidates.find((path) => Array.isArray(path) && path.length > 1) ?? null;
}

function pointFor(track, point) {
  if (Number.isFinite(point?.x) && Number.isFinite(point?.z)) {
    return new THREE.Vector3(point.x, finite(point.y, 0) + 0.18, point.z);
  }
  const distance = point?.s ?? point?.distance;
  if (!Number.isFinite(distance)) return null;
  const centre = track.atDistance(distance);
  const lateral = finite(point.q ?? point.lateral, 0);
  const placed = track.lateralPoint ? track.lateralPoint(centre, lateral) : centre;
  return new THREE.Vector3(placed.x, finite(placed.y, 0) + 0.18, placed.z);
}

/**
 * Supplements the source projects' native debug renderers. It only consumes the
 * path/debug data their controllers already publish and labels fallback ribbons
 * plainly when a controller has not published a path for the current tick.
 */
export class RouteOverlay {
  constructor(scene, track, entries) {
    this.track = track;
    this.entries = entries;
    this.group = new THREE.Group();
    this.group.name = 'BENCHMARK_NATIVE_ROUTE_OVERLAY';
    this.lines = new Map();
    this.selectedId = entries[0]?.id ?? null;
    scene.add(this.group);
    for (const entry of entries) {
      const material = new THREE.LineBasicMaterial({ color: entry.color, transparent: true, opacity: 0.93, depthTest: false });
      const geometry = new THREE.BufferGeometry();
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 10;
      this.group.add(line);
      this.lines.set(entry.id, line);
    }
  }

  setSelected(id) {
    this.selectedId = id;
  }

  update() {
    for (const entry of this.entries) {
      const line = this.lines.get(entry.id);
      const debug = entry.debug?.();
      line.material.opacity = entry.id === this.selectedId ? 1 : 0.3;
      const nativePath = nestedPath(debug);
      const source = nativePath ?? Array.from({ length: 52 }, (_, index) => ({
        s: entry.vehicle.distance + index * 11,
        q: finite(debug?.targetQ ?? debug?.target?.q, 0)
      }));
      const points = source.map((point) => pointFor(this.track, point)).filter(Boolean);
      if (points.length < 2) {
        line.visible = false;
        entry.routeSource = 'no route published';
        continue;
      }
      line.geometry.setFromPoints(points);
      line.visible = true;
      entry.routeSource = nativePath ? (debug?.routeKind ?? 'native route') : 'native target projection';
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const line of this.lines.values()) {
      line.geometry.dispose();
      line.material.dispose();
    }
  }
}
