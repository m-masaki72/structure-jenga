import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/controls/OrbitControls.js';
import { StructureCollapse } from './structure-collapse.js';
import { CollapseEffects, collisionStrength } from './structure-effects.js';
import { architecturalMaterials, timberGeometry, columnGeometry } from './structure-architecture.js';
import { MemberAffordance } from './structure-affordance.js';
import { memberProfile } from './structure-profile.js';
import { makeLandscape } from './structure-landscape.js';

const Y = new THREE.Vector3(0, 1, 0);
const point = (p) => new THREE.Vector3(...p);
const ease = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export class StructureView {
  constructor(host, onSelect, onImpact = () => {}) {
    this.host = host;
    this.onSelect = onSelect;
    this.onImpact = onImpact;
    this.meshes = new Map();
    this.selected = null;
    this.candidates = [];
    this.hovered = null;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.setClearColor('#cbd8d9');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#cbd8d9', 45, 190);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.26;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.ray = new THREE.Raycaster();
    this.beamGeometry = timberGeometry();
    this.columnGeometry = columnGeometry();
    this.showMembers = false;
    this.interactive = false;
    this.affordance = new MemberAffordance(this.scene);
    this.nodeGeometry = new THREE.BoxGeometry(0.105, 0.105, 0.105);
    const surfaces = architecturalMaterials();
    this.batchMaterial = surfaces.timber;
    this.columnMaterial = surfaces.stone;
    this.plateGeometry = new THREE.BoxGeometry(1.4, 0.055, 1.4);
    this.pegGeometry = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 8);
    this.pegGeometry.rotateX(Math.PI / 2);
    this.detailTransform = new THREE.Object3D();
    this.detailOffset = new THREE.Vector3();
    this.instanceTransform = new THREE.Object3D();
    this.hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    this.highlightColor = new THREE.Color();
    this.familyColors = new Map(
      Object.entries({
        'ruling-a': '#8d603c',
        'ruling-b': '#9a6e48',
        hoop: '#a4794b',
        brace: '#895b37',
        'meridian-a': '#91623d',
        'meridian-b': '#9c704a',
        crown: '#a67b4d',
        lattice: '#92643e',
      }).map(([key, color]) => [key, new THREE.Color(color)]),
    );
    this.materials = {
      beam: new THREE.MeshStandardMaterial({ color: '#92643e', roughness: 0.84 }),
      column: new THREE.MeshStandardMaterial({ color: '#dfcdaa', roughness: 0.88 }),
      joint: new THREE.MeshStandardMaterial({ color: '#63462c', roughness: 0.91 }),
      selected: new THREE.MeshStandardMaterial({
        color: '#df794f',
        emissive: '#813515',
        emissiveIntensity: 0.22,
        metalness: 0.35,
        roughness: 0.3,
      }),
      hover: new THREE.MeshStandardMaterial({
        color: '#b2cdb0',
        metalness: 0.45,
        roughness: 0.28,
      }),
      anchor: new THREE.MeshStandardMaterial({
        color: '#a99a7b',
        metalness: 0,
        roughness: 0.83,
      }),
      ghost: new THREE.MeshBasicMaterial({
        color: '#72877e',
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
      }),
    };
    this.addStudio();
    this.effects = new CollapseEffects(this.scene, this.reducedMotion);
    this.collapseCaption = host.parentElement.querySelector('#collapse-caption');
    this.collapseVignette = host.parentElement.querySelector('#collapse-vignette');
    this.assembly = new THREE.Group();
    this.scene.add(this.assembly);
    this.pulse = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.006, 6, 48),
      new THREE.MeshBasicMaterial({ color: '#d9784f', transparent: true, depthTest: false }),
    );
    this.pulse.visible = false;
    this.scene.add(this.pulse);
    this.bind();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }
  addStudio() {
    this.landscape = makeLandscape(this.scene, this.renderer, this.reducedMotion);
    this.environment = this.landscape.environment;
    this.plinth = this.landscape.plinth;
  }
  updateConnections(id, mesh, visible) {
    const radius = mesh.scale.x;
    const transform = this.detailTransform;
    transform.quaternion.copy(mesh.quaternion);
    transform.scale.setScalar(radius);
    for (let end = 0; end < 2; end++) {
      const sign = end ? 1 : -1;
      const y = sign * (mesh.scale.y * 0.5 - radius * 0.04);
      const column = mesh.userData.profile.column;
      const put = (batch, index, x, offsetY, z, show) => {
        if (!visible || !show) return batch.setMatrixAt(index, this.hiddenMatrix);
        this.detailOffset.set(x * radius, offsetY, z * radius).applyQuaternion(mesh.quaternion);
        transform.position.copy(mesh.position).add(this.detailOffset);
        transform.updateMatrix();
        batch.setMatrixAt(index, transform.matrix);
      };
      put(this.plateBatch, id * 2 + end, 0, y, 0, column);
      for (let peg = 0; peg < 2; peg++) {
        put(this.pegBatch, id * 4 + end * 2 + peg, 0, y - sign * radius * 0.65, peg ? 0.7 : -0.7, !column);
      }
    }
  }
  load(structure, analysis) {
    this.failure?.physics.dispose();
    for (const batch of [
      this.beamBatch,
      this.columnBatch,
      this.ghostBatch,
      this.ghostColumnBatch,
      this.jointBatch,
      this.plateBatch,
      this.pegBatch,
    ])
      batch?.dispose();
    for (const child of this.assembly.children) if (child.userData.ownedGeometry) child.geometry.dispose();
    this.assembly.clear();
    this.meshes.clear();
    this.structure = structure;
    this.effects.reset();
    this.collapseCaption.hidden = true;
    this.collapseVignette.style.opacity = '0';
    this.affordance.load(structure.members.length);
    this.nodeMembers = structure.nodes.map((_, i) =>
      structure.members.filter((m) => m.a === i || m.b === i).map((m) => m.id),
    );
    this.analysis = analysis;
    this.positions = structure.nodes.map((node) => point(node.p));
    this.joints = [];
    this.selected = this.hovered = null;
    this.candidates = [];
    this.failure = null;
    this.liveAnalysis = false;
    this.extractions = [];
    this.removed = new Set();
    this.showOriginal = false;
    this.pulse.visible = false;
    this.beamBatch = new THREE.InstancedMesh(this.beamGeometry, this.batchMaterial, structure.members.length);
    this.columnBatch = new THREE.InstancedMesh(
      this.columnGeometry,
      this.columnMaterial,
      structure.members.length,
    );
    this.ghostBatch = new THREE.InstancedMesh(
      this.beamGeometry,
      this.materials.ghost,
      structure.members.length,
    );
    this.jointBatch = new THREE.InstancedMesh(
      this.nodeGeometry,
      this.materials.joint,
      structure.nodes.length,
    );
    this.ghostColumnBatch = new THREE.InstancedMesh(
      this.columnGeometry,
      this.materials.ghost,
      structure.members.length,
    );
    this.plateBatch = new THREE.InstancedMesh(
      this.plateGeometry,
      this.materials.column,
      structure.members.length * 2,
    );
    this.pegBatch = new THREE.InstancedMesh(
      this.pegGeometry,
      this.materials.joint,
      structure.members.length * 4,
    );
    for (const batch of [
      this.beamBatch,
      this.columnBatch,
      this.ghostBatch,
      this.ghostColumnBatch,
      this.jointBatch,
      this.plateBatch,
      this.pegBatch,
    ]) {
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.frustumCulled = false;
      this.assembly.add(batch);
    }
    for (const batch of [this.beamBatch, this.columnBatch, this.jointBatch, this.plateBatch])
      batch.castShadow = batch.receiveShadow = true;
    for (const member of structure.members) {
      const profile = memberProfile(member, structure.nodes);
      const mesh = new THREE.Mesh(
        profile.column ? this.columnGeometry : this.beamGeometry,
        profile.column ? this.materials.column : this.materials.beam,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.member = member;
      mesh.userData.profile = profile;
      mesh.userData.restDirection = point(structure.nodes[member.b].p)
        .sub(point(structure.nodes[member.a].p))
        .normalize();
      mesh.userData.restRotation = new THREE.Quaternion().setFromUnitVectors(Y, mesh.userData.restDirection);
      this.meshes.set(member.id, mesh);
      this.beamBatch.setMatrixAt(member.id, this.hiddenMatrix);
      this.beamBatch.setColorAt(member.id, this.familyColors.get(member.family) ?? this.materials.beam.color);
      this.columnBatch.setMatrixAt(member.id, this.hiddenMatrix);
      this.columnBatch.setColorAt(member.id, this.materials.column.color);
      this.ghostBatch.setMatrixAt(member.id, this.hiddenMatrix);
      this.ghostColumnBatch.setMatrixAt(member.id, this.hiddenMatrix);
    }
    structure.nodes.forEach((node) => {
      if (node.fixed && node.anchor !== false) {
        const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.46), this.materials.anchor);
        anchor.userData.ownedGeometry = true;
        anchor.position.set(node.p[0], 0.055, node.p[2]);
        anchor.castShadow = true;
        this.assembly.add(anchor);
        if (node.p[1] > 0.2) {
          const pedestal = new THREE.Mesh(
            new THREE.BoxGeometry(0.28, node.p[1], 0.28),
            this.materials.anchor,
          );
          pedestal.userData.ownedGeometry = true;
          pedestal.position.set(node.p[0], node.p[1] / 2, node.p[2]);
          pedestal.castShadow = true;
          this.assembly.add(pedestal);
        }
      }
    });
    this.setAnalysis(analysis, true);
    this.home();
  }
  setAnalysis(analysis, immediate = false) {
    this.analysis = analysis;
    this.from = this.positions.map((p) => p.clone());
    this.to = this.structure.nodes.map((node, i) =>
      point(node.p).add(point(analysis.displacement[i]).multiplyScalar(3)),
    );
    this.transition = immediate ? -100 : performance.now() / 1000;
    if (immediate) this.positions = this.to.map((p) => p.clone());
  }
  followAnalysis(analysis, sway) {
    this.analysis = analysis;
    this.liveAnalysis = true;
    this.to = this.structure.nodes.map((node, i) => {
      const target = point(node.p).add(
        point(analysis.displacement[i]).multiplyScalar(this.reducedMotion ? 1 : 3),
      );
      if (!node.fixed && !this.reducedMotion) {
        target.x += sway[0] * Math.max(0, node.p[1]) * 0.35;
        target.z += sway[1] * Math.max(0, node.p[1]) * 0.35;
      }
      return target;
    });
  }
  home() {
    if (!this.structure) return;
    const points = this.structure.nodes.map((n) => point(n.p));
    const box = new THREE.Box3().setFromPoints(points);
    const center = box.getCenter(new THREE.Vector3());
    center.y = Math.max(1, center.y - 0.12);
    const vertical = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const azimuth = this.structure.id === 'spire' ? 0.42 : 0.27;
    const direction = new THREE.Vector3();
    let distance = 8;
    for (let i = 0; i < 4; i++) {
      direction
        .set(
          Math.sin(azimuth),
          THREE.MathUtils.clamp((0.46 - center.y) / distance, -0.24, -0.025),
          Math.cos(azimuth),
        )
        .normalize();
      const right = new THREE.Vector3().crossVectors(Y, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right);
      distance =
        Math.max(
          3.8,
          ...points.map((p) => {
            const offset = p.clone().sub(center);
            return (
              Math.max(
                Math.abs(offset.dot(right)) / (vertical * this.camera.aspect * 0.8),
                Math.abs(offset.dot(up)) / (vertical * 0.7),
              ) + offset.dot(direction)
            );
          }),
        ) + 0.5;
    }
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.far = Math.max(1200, distance * 4);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = distance * 0.58;
    this.controls.maxDistance = distance * 1.7;
    this.controls.update();
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.home();
  }
  rotate(amount) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(Y, amount);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(
      THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance),
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  hit(clientX, clientY) {
    return this.candidatesAt(clientX, clientY)[0] ?? null;
  }
  candidatesAt(clientX, clientY, padding = 0) {
    const r = this.host.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return [];
    const meshes = [...this.meshes.values()].filter((mesh) => !this.removed.has(mesh.userData.member.id));
    const cast = (x, y) => {
      this.ray.setFromCamera(
        new THREE.Vector2(((x - r.x) / r.width) * 2 - 1, (-(y - r.y) / r.height) * 2 + 1),
        this.camera,
      );
      return this.ray.intersectObjects(meshes, false);
    };
    for (const mesh of meshes) {
      mesh.scale.x *= 1.15;
      mesh.scale.z *= 1.15;
      mesh.updateMatrixWorld();
    }
    try {
      const direct = [...new Set(cast(clientX, clientY).map((hit) => hit.object.userData.member.id))];
      if (!padding) return direct.slice(0, 8);
      const nearby = [];
      for (const mesh of meshes) {
        const member = mesh.userData.member;
        if (direct.includes(member.id)) continue;
        const a = this.positions[member.a].clone().project(this.camera);
        const b = this.positions[member.b].clone().project(this.camera);
        if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
        a.set(r.x + ((a.x + 1) * r.width) / 2, r.y + ((1 - a.y) * r.height) / 2, 0);
        b.set(r.x + ((b.x + 1) * r.width) / 2, r.y + ((1 - b.y) * r.height) / 2, 0);
        const segment = b.sub(a);
        const t = THREE.MathUtils.clamp(
          ((clientX - a.x) * segment.x + (clientY - a.y) * segment.y) / Math.max(0.001, segment.lengthSq()),
          0,
          1,
        );
        const closest = a.addScaledVector(segment, t);
        const depth = -this.positions[member.a]
          .clone()
          .lerp(this.positions[member.b], t)
          .applyMatrix4(this.camera.matrixWorldInverse).z;
        const radius =
          (mesh.scale.x * r.height) /
          (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.max(0.1, depth));
        const distance = Math.max(0, Math.hypot(clientX - closest.x, clientY - closest.y) - radius);
        if (
          distance <= padding &&
          closest.x >= r.left &&
          closest.x <= r.right &&
          closest.y >= r.top &&
          closest.y <= r.bottom
        )
          nearby.push({ id: member.id, distance, depth, point: closest });
      }
      nearby.sort((a, b) => a.distance - b.distance || a.depth - b.depth || a.id - b.id);
      const candidates = direct.slice(0, 8);
      for (const item of nearby) {
        if (candidates.length >= 8) break;
        if (cast(item.point.x, item.point.y)[0]?.object.userData.member.id === item.id)
          candidates.push(item.id);
      }
      return candidates;
    } finally {
      for (const mesh of meshes) {
        mesh.scale.x /= 1.15;
        mesh.scale.z /= 1.15;
        mesh.updateMatrixWorld();
      }
    }
  }
  bind() {
    const canvas = this.renderer.domElement;
    const pointers = new Set();
    canvas.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      if (pointers.size > 1 && this.down) this.down.moved = true;
      if (e.button === 0 && pointers.size === 1)
        this.down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7)
        this.down.moved = true;
      if (e.pointerType !== 'touch' && !e.buttons) {
        this.hovered = this.interactive ? this.hit(e.clientX, e.clientY) : null;
        canvas.style.cursor = this.hovered === null ? 'grab' : 'pointer';
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      pointers.delete(e.pointerId);
      if (this.down?.id !== e.pointerId) return;
      if (!this.down.moved && this.interactive) {
        const candidates = this.candidatesAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 14 : 0);
        if (candidates.length) this.onSelect(candidates[0], candidates);
      }
      this.down = null;
    });
    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      this.down = null;
    });
    canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
    });
  }
  select(id, candidates = []) {
    this.selected = id;
    this.candidates =
      id === null
        ? []
        : [...new Set(candidates.includes(id) ? candidates : [id, ...candidates])].filter(
            (candidate) => this.meshes.has(candidate) && !this.removed.has(candidate),
          );
  }
  cycleCandidate() {
    if (!this.interactive || this.candidates.length < 2) return;
    const index = this.candidates.indexOf(this.selected);
    this.onSelect(this.candidates[(index + 1) % this.candidates.length], this.candidates);
  }
  ping(id) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    this.pulse.position.copy(mesh.position);
    this.pulse.quaternion.copy(this.camera.quaternion);
    this.pulse.visible = true;
    this.pulseStart = performance.now() / 1000;
  }
  extract(id, result, collapsed = !result.stable) {
    const mesh = this.meshes.get(id);
    this.removed.add(id);
    this.selected = this.hovered = null;
    this.candidates = [];
    this.extractions.push({
      mesh,
      time: performance.now() / 1000,
      from: mesh.position.clone(),
    });
    if (collapsed) this.collapse(result);
    else this.setAnalysis(result);
  }
  collapse(result, rotations = new Map([...this.meshes].map(([id, mesh]) => [id, mesh.quaternion.clone()]))) {
    this.failure?.physics.dispose();
    this.effects.reset();
    const from = this.positions.map((p) => p.clone());
    this.failure = {
      result,
      from,
      rotations,
      physics: new StructureCollapse(this.structure, this.removed, from, result, rotations),
      lastFrame: performance.now() / 1000,
      cameraStart: this.camera.position.clone(),
      cameraFocus: this.controls.target.clone(),
      initialHeight: from.reduce((sum, p) => sum + p.y, 0) / from.length,
      shock: 0,
      quake: 0,
      drop: 0,
      dropVelocity: 0,
      lastThump: -Infinity,
      peakOffset: 0,
      age: 0,
      peakShock: 0,
      impacts: 0,
    };
  }
  replay() {
    if (!this.failure) return;
    const { result, from, rotations, cameraStart, cameraFocus } = this.failure;
    this.camera.position.copy(cameraStart);
    this.controls.target.copy(cameraFocus);
    this.controls.update();
    this.positions = from.map((p) => p.clone());
    this.collapse(result, rotations);
  }
  collapseStats() {
    if (!this.failure) return null;
    const f = this.failure;
    const indices = this.structure.nodes.flatMap((node, i) => (node.fixed ? [] : [i]));
    return {
      ...f.physics.stats,
      impacts: f.impacts,
      meanHeight: indices.reduce((sum, i) => sum + this.positions[i].y, 0) / indices.length,
      initialHeight: indices.reduce((sum, i) => sum + f.from[i].y, 0) / indices.length,
      members: f.physics.members.size,
      effects: this.effects.stats,
      peakShock: f.peakShock,
      quake: f.quake,
      peakOffset: f.peakOffset,
    };
  }
  frame(time) {
    if (!this.structure) return;
    const frameDelta = Math.min(0.05, Math.max(0, time - (this.lastFrame ?? time)));
    this.lastFrame = time;
    let falling;
    if (this.failure) {
      const f = this.failure,
        dt = Math.min(0.05, Math.max(0, time - f.lastFrame));
      f.lastFrame = time;
      f.age += dt;
      for (let i = 0; i < (this.reducedMotion ? 4 : 1); i++)
        f.physics.step(dt * (this.reducedMotion ? 1 : 0.82));
      const state = f.physics.snapshot();
      falling = new Map(state.members.map((member) => [member.id, member]));
      state.nodes.forEach((p, i) => this.positions[i].fromArray(p));
      // Keep the falling mass in frame instead of leaving it below the original tower's focus.
      const height = this.positions.reduce((sum, p) => sum + p.y, 0) / this.positions.length;
      const focusY = Math.max(0.45, f.cameraFocus.y - Math.max(0, f.initialHeight - height) * 0.95);
      const shiftY = (focusY - this.controls.target.y) * (1 - Math.exp(-dt * 2.8));
      this.controls.target.y += shiftY;
      this.camera.position.y += shiftY;
      f.shock *= Math.exp(-dt * 12);
      f.quake *= Math.exp(-dt * 1.4);
      f.dropVelocity += (-f.drop * 70 - f.dropVelocity * 14) * dt;
      f.drop = Math.max(-1, Math.min(0.4, f.drop + f.dropVelocity * dt));
      for (const impact of state.impacts) {
        f.impacts++;
        this.onImpact({ ...impact, pan: point(impact.point).project(this.camera).x });
        this.effects.impact(impact);
        if (!this.reducedMotion) {
          const strength = collisionStrength(impact);
          f.shock = Math.max(f.shock, strength * (impact.floor ? 1 : 0.4));
          if (impact.floor) {
            f.quake = Math.min(1, Math.max(f.quake, strength) + strength * 0.1);
            if (f.age - f.lastThump > 0.26 && strength > 0.15) {
              f.dropVelocity = Math.max(-14, f.dropVelocity - strength * 12);
              f.lastThump = f.age;
            }
          }
        }
      }
      f.peakShock = Math.max(f.peakShock, f.shock);
      const caption = f.age < 0.95 ? 'あっ。' : 'やっちゃった。';
      if (this.collapseCaption.textContent !== caption) this.collapseCaption.textContent = caption;
      this.collapseCaption.hidden = f.age > 4.4;
      this.collapseCaption.style.opacity = String(Math.min(1, f.age * 8, Math.max(0, (4.4 - f.age) * 2)));
      this.collapseVignette.style.opacity = String(
        this.reducedMotion ? 0 : Math.min(0.55, f.shock * 0.35 + f.quake * 0.18),
      );
    } else {
      if (this.liveAnalysis) {
        this.positions.forEach((p, i) => p.lerp(this.to[i], 1 - Math.exp(-frameDelta * 12)));
      } else {
        const t = this.reducedMotion ? 1 : ease((time - this.transition) / 0.7);
        this.positions.forEach((p, i) => p.lerpVectors(this.from[i], this.to[i], t));
      }
    }
    this.positions.forEach((p, i) => {
      if (
        this.structure.nodes[i].anchor === false &&
        this.nodeMembers[i].every((id) => this.removed.has(id))
      ) {
        this.jointBatch.setMatrixAt(i, this.hiddenMatrix);
        return;
      }
      this.instanceTransform.position.copy(p);
      this.instanceTransform.updateMatrix();
      this.jointBatch.setMatrixAt(i, this.instanceTransform.matrix);
    });
    this.jointBatch.instanceMatrix.needsUpdate = true;
    for (const [id, mesh] of this.meshes) {
      if (this.removed.has(id)) continue;
      const member = mesh.userData.member;
      const radius = mesh.userData.profile.radius;
      const body = falling?.get(id);
      if (body) {
        mesh.position.fromArray(body.position);
        mesh.quaternion.fromArray(body.quaternion);
        mesh.scale.set(radius, body.length, radius);
      } else {
        const a = this.positions[member.a],
          b = this.positions[member.b];
        const direction = b.clone().sub(a);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.scale.set(radius, direction.length(), radius);
        mesh.quaternion
          .setFromUnitVectors(mesh.userData.restDirection, direction.normalize())
          .multiply(mesh.userData.restRotation);
      }
      mesh.material =
        id === this.selected
          ? this.materials.selected
          : id === this.hovered
            ? this.materials.hover
            : mesh.userData.profile.column
              ? this.materials.column
              : this.materials.beam;
    }
    for (const extraction of this.extractions) {
      const t = (time - extraction.time) / 0.65;
      const mesh = extraction.mesh;
      mesh.visible = t < 1 || this.showOriginal;
      if (this.showOriginal && t >= 1) {
        const m = mesh.userData.member,
          a = point(this.structure.nodes[m.a].p),
          b = point(this.structure.nodes[m.b].p);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.scale.set(
          mesh.userData.profile.radius * 0.6,
          a.distanceTo(b),
          mesh.userData.profile.radius * 0.6,
        );
        mesh.quaternion.copy(mesh.userData.restRotation);
        mesh.material = this.materials.ghost;
      } else if (t < 1) {
        mesh.material = this.materials.selected;
        mesh.position.copy(extraction.from).add(new THREE.Vector3(1.5 * ease(t), t * 0.5, ease(t) * 1.2));
        const scale = Math.max(0.001, 1 - t ** 3);
        mesh.scale.x = mesh.scale.z = mesh.userData.profile.radius * scale;
      }
    }
    for (const [id, mesh] of this.meshes) {
      mesh.updateMatrix();
      const ghost = mesh.visible && mesh.material === this.materials.ghost;
      const column = mesh.userData.profile.column;
      this.beamBatch.setMatrixAt(id, mesh.visible && !ghost && !column ? mesh.matrix : this.hiddenMatrix);
      this.columnBatch.setMatrixAt(id, mesh.visible && !ghost && column ? mesh.matrix : this.hiddenMatrix);
      this.ghostBatch.setMatrixAt(id, ghost && !column ? mesh.matrix : this.hiddenMatrix);
      this.ghostColumnBatch.setMatrixAt(id, ghost && column ? mesh.matrix : this.hiddenMatrix);
      const baseColor = column
        ? this.materials.column.color
        : (this.familyColors.get(mesh.userData.member.family) ?? this.materials.beam.color);
      const color = this.highlightColor.copy(baseColor);
      if (mesh.material === this.materials.selected) color.lerp(this.materials.selected.color, 0.24);
      else if (mesh.material === this.materials.hover && this.interactive)
        color.lerp(this.materials.hover.color, 0.28);
      this.beamBatch.setColorAt(id, color);
      this.columnBatch.setColorAt(id, color);
      this.updateConnections(id, mesh, mesh.visible && !ghost);
    }
    for (const batch of [
      this.beamBatch,
      this.columnBatch,
      this.ghostBatch,
      this.ghostColumnBatch,
      this.plateBatch,
      this.pegBatch,
    ])
      batch.instanceMatrix.needsUpdate = true;
    this.beamBatch.instanceColor.needsUpdate = this.columnBatch.instanceColor.needsUpdate = true;
    this.ghostBatch.visible = this.ghostColumnBatch.visible = this.showOriginal && this.removed.size > 0;
    if (this.pulse.visible) {
      const t = time - this.pulseStart;
      this.pulse.visible = t < 0.75;
      this.pulse.scale.setScalar(1 + t * 3);
      this.pulse.material.opacity = Math.max(0, 1 - t / 0.75);
      this.pulse.quaternion.copy(this.camera.quaternion);
    }
    this.affordance.update(
      this.meshes,
      this.removed,
      this.selected,
      this.hovered,
      this.showMembers,
      this.interactive && !this.failure,
    );
    this.controls.update();
    this.camera.position.y = Math.max(0.28, this.camera.position.y);
    const viewDistance = this.camera.position.distanceTo(this.controls.target);
    this.scene.fog.near = viewDistance + 35;
    this.scene.fog.far = viewDistance + 170;
    this.landscape.update(time);
    this.effects.update(frameDelta, this.camera);
    const cameraPosition = this.camera.position.clone();
    const cameraQuaternion = this.camera.quaternion.clone();
    if (this.failure && !this.reducedMotion) {
      const f = this.failure;
      const amount = Math.min(0.22, viewDistance * 0.017);
      this.camera.translateX((Math.sin(f.age * 17) + Math.sin(f.age * 27) * 0.25) * f.quake * amount * 0.7);
      this.camera.translateY(
        (f.drop + Math.sin(f.age * 22) * f.quake * 0.25 + Math.sin(f.age * 61) * f.shock * 0.08) * amount,
      );
      this.camera.rotateZ(Math.sin(f.age * 11) * f.quake * 0.007);
      this.camera.rotateX(-f.drop * 0.006);
      this.camera.position.y = Math.max(0.12, this.camera.position.y);
      f.peakOffset = Math.max(f.peakOffset, this.camera.position.distanceTo(cameraPosition));
    }
    this.renderer.render(this.scene, this.camera);
    this.camera.position.copy(cameraPosition);
    this.camera.quaternion.copy(cameraQuaternion);
    this.camera.updateMatrixWorld();
  }
  targets() {
    this.scene.updateMatrixWorld(true);
    return [...this.meshes]
      .filter(([id]) => !this.removed.has(id))
      .map(([id, mesh]) => {
        const p = mesh.position.clone().project(this.camera);
        return {
          id,
          x: ((p.x + 1) * this.host.clientWidth) / 2,
          y: ((1 - p.y) * this.host.clientHeight) / 2,
        };
      });
  }
}
