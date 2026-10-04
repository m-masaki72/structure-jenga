import * as THREE from 'three';
import { FOUNDATION } from './structure-profile.js';

const DUST_LIMIT = 96;
const CHIP_LIMIT = 128;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function collisionStrength({ speed, mass }) {
  return clamp((Math.sqrt(Math.max(0, mass)) * Math.max(0, speed)) / 9, 0, 1);
}

function dustTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = (x - 63.5) / 64,
        dy = (y - 63.5) / 64;
      const r = Math.hypot(dx, dy);
      const cloud = 0.76 + Math.sin(x * 0.23 + Math.sin(y * 0.13) * 2) * 0.12 + Math.cos(y * 0.31) * 0.09;
      const i = (y * 128 + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      pixels.data[i + 3] = Math.round(Math.max(0, 1 - r * r) ** 2 * cloud * 255);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

export class CollapseEffects {
  constructor(scene, reducedMotion) {
    this.reducedMotion = reducedMotion;
    this.transform = new THREE.Object3D();
    this.color = new THREE.Color();
    this.dustParticles = Array.from({ length: DUST_LIMIT }, () => this.particle());
    this.chipParticles = Array.from({ length: CHIP_LIMIT }, () => this.particle());
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(DUST_LIMIT), 1);
    geometry.setAttribute('particleOpacity', this.opacity);
    const material = new THREE.MeshBasicMaterial({
      map: dustTexture(),
      color: '#d6c4a1',
      transparent: true,
      depthWrite: false,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute float particleOpacity;\nvarying float vParticleOpacity;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvParticleOpacity = particleOpacity;',
      );
      shader.fragmentShader = 'varying float vParticleOpacity;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        'diffuseColor.a *= vParticleOpacity;\n#include <alphatest_fragment>',
      );
    };
    material.customProgramCacheKey = () => 'structure-impact-dust-1';
    this.dust = new THREE.InstancedMesh(geometry, material, DUST_LIMIT);
    this.chips = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.98 }),
      CHIP_LIMIT,
    );
    for (const mesh of [this.dust, this.chips]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    this.chips.castShadow = true;
    this.chips.receiveShadow = true;
    this.dust.renderOrder = 2;
    this.reset();
  }
  particle() {
    return {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      age: 0,
      life: 0,
      spin: 0,
      angle: 0,
    };
  }
  reset() {
    for (const pool of [this.dustParticles, this.chipParticles]) for (const p of pool) p.life = 0;
    this.dust.visible = this.chips.visible = false;
    this.dustCursor = this.chipCursor = this.bursts = this.emittedChips = 0;
    this.active = false;
    this.activeDust = this.activeChips = 0;
    this.time = 0;
    this.lastBurst = -Infinity;
  }
  impact(event) {
    const strength = collisionStrength(event);
    if (strength < 0.035 || this.time - this.lastBurst < (this.reducedMotion ? 0.22 : 0.065)) return;
    this.lastBurst = this.time;
    this.bursts++;
    this.active = true;
    const stone = event.material === 'stone';
    const dustCount = this.reducedMotion ? 2 : Math.ceil(4 + strength * (event.floor ? 10 : 5));
    for (let i = 0; i < dustCount; i++) {
      const p = this.dustParticles[this.dustCursor++ % DUST_LIMIT];
      const angle = Math.random() * Math.PI * 2;
      const spread = 0.16 + strength * 0.65;
      p.position.fromArray(event.point);
      p.position.y += 0.06;
      p.position.x += Math.cos(angle) * 0.05;
      p.position.z += Math.sin(angle) * 0.05;
      p.velocity.set(Math.cos(angle) * spread, 0.1 + Math.random() * 0.2, Math.sin(angle) * spread);
      p.size = 0.3 + Math.random() * 0.25 + strength * 0.55;
      p.opacity = (event.floor || stone ? 0.42 : 0.19) * (this.reducedMotion ? 0.6 : 1);
      p.age = 0;
      p.life = 1.6 + Math.random() * 1.5;
      p.angle = angle;
    }
    const chipCount = this.reducedMotion ? 0 : Math.ceil(3 + strength * 8);
    for (let i = 0; i < chipCount; i++) {
      const index = this.chipCursor++ % CHIP_LIMIT;
      const p = this.chipParticles[index];
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.35 + Math.random() * (0.7 + strength * 1.1);
      p.position.fromArray(event.point);
      p.position.y += 0.025;
      p.velocity.set(
        Math.cos(angle) * speed,
        0.45 + Math.random() * (0.5 + strength),
        Math.sin(angle) * speed,
      );
      const size = 0.012 + Math.random() * 0.023 + strength * 0.016;
      p.scale.set(size * (stone ? 1 : 2.8), size * (stone ? 0.65 : 0.28), size * (stone ? 0.85 : 0.4));
      p.age = 0;
      p.life = 2.7 + Math.random() * 2;
      p.spin = (Math.random() - 0.5) * 15;
      p.angle = angle;
      this.color.set(stone ? '#c5b494' : '#7a4e2b').multiplyScalar(0.8 + Math.random() * 0.4);
      this.chips.setColorAt(index, this.color);
      this.emittedChips++;
    }
    if (chipCount) this.chips.instanceColor.needsUpdate = true;
  }
  update(dt, camera) {
    this.time += dt;
    if (!this.active) return;
    let dustCount = 0,
      chipCount = 0;
    for (let i = 0; i < DUST_LIMIT; i++) {
      const p = this.dustParticles[i];
      p.age += dt;
      const live = p.age < p.life;
      if (live) {
        dustCount++;
        p.position.addScaledVector(p.velocity, dt);
        p.velocity.multiplyScalar(Math.exp(-dt * 0.8));
        const t = p.age / p.life;
        this.transform.position.copy(p.position);
        this.transform.quaternion.copy(camera.quaternion);
        this.transform.rotateZ(p.angle);
        this.transform.scale.setScalar(p.size * (1 + t * 2.8));
        this.opacity.setX(i, p.opacity * Math.min(1, p.age * 15) * (1 - t) ** 1.4);
      } else {
        this.transform.scale.setScalar(0);
        this.opacity.setX(i, 0);
      }
      this.transform.updateMatrix();
      this.dust.setMatrixAt(i, this.transform.matrix);
    }
    for (let i = 0; i < CHIP_LIMIT; i++) {
      const p = this.chipParticles[i];
      p.age += dt;
      if (p.age < p.life) {
        chipCount++;
        p.velocity.y -= 9.81 * dt;
        p.position.addScaledVector(p.velocity, dt);
        const floor =
          Math.abs(p.position.x) < FOUNDATION.halfSize && Math.abs(p.position.z) < FOUNDATION.halfSize
            ? -0.01
            : -0.28;
        if (p.position.y < floor + p.scale.y) {
          p.position.y = floor + p.scale.y;
          p.velocity.y = Math.abs(p.velocity.y) * 0.14;
          p.velocity.x *= 0.65;
          p.velocity.z *= 0.65;
          p.spin *= 0.6;
        }
        p.angle += p.spin * dt;
        this.transform.position.copy(p.position);
        this.transform.rotation.set(p.angle, p.angle * 0.7, p.angle * 0.4);
        this.transform.scale.copy(p.scale).multiplyScalar(Math.min(1, (p.life - p.age) * 3));
      } else this.transform.scale.setScalar(0);
      this.transform.updateMatrix();
      this.chips.setMatrixAt(i, this.transform.matrix);
    }
    this.dust.visible = dustCount > 0;
    this.chips.visible = chipCount > 0;
    this.dust.instanceMatrix.needsUpdate =
      this.chips.instanceMatrix.needsUpdate =
      this.opacity.needsUpdate =
        true;
    this.activeDust = dustCount;
    this.activeChips = chipCount;
    this.active = dustCount + chipCount > 0;
  }
  get stats() {
    return {
      bursts: this.bursts,
      emittedChips: this.emittedChips,
      dust: this.activeDust ?? 0,
      chips: this.activeChips ?? 0,
    };
  }
}
