import * as THREE from 'three';

const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 1, 2));
const edges = edgeGeometry.getAttribute('position');
const point = new THREE.Vector3();

export class MemberAffordance {
  constructor(scene) {
    this.scene = scene;
    this.focus = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({ color: '#ffce7f', depthTest: false, toneMapped: false }),
    );
    this.focus.renderOrder = 5;
    this.focus.visible = false;
    scene.add(this.focus);
  }
  load(count) {
    if (this.all) {
      this.scene.remove(this.all);
      this.all.geometry.dispose();
      this.all.material.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(count * edges.count * 3), 3),
    );
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    geometry.setDrawRange(0, 0);
    this.all = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: '#fff2ce',
        transparent: true,
        opacity: 0.8,
        toneMapped: false,
      }),
    );
    this.all.frustumCulled = false;
    this.all.visible = this.focus.visible = false;
    this.scene.add(this.all);
  }
  update(meshes, removed, selected, hovered, showAll, enabled) {
    const active = enabled ? (selected ?? hovered) : null;
    const mesh = meshes.get(active);
    this.focus.visible = Boolean(mesh && !removed.has(active));
    if (this.focus.visible) {
      this.focus.position.copy(mesh.position);
      this.focus.quaternion.copy(mesh.quaternion);
      this.focus.scale.copy(mesh.scale);
      const width = mesh.userData.profile.column ? 0.99 : 0.76;
      this.focus.scale.x *= width;
      this.focus.scale.z *= width;
      this.focus.scale.y *= 1.006;
      this.focus.material.color.set(selected === null ? '#fff9e8' : '#ffbd5b');
    }
    this.all.visible = showAll && enabled;
    if (!this.all.visible) return;
    const position = this.all.geometry.attributes.position;
    let offset = 0;
    for (const [id, member] of meshes) {
      if (removed.has(id)) continue;
      const width = member.userData.profile.column ? 0.99 : 0.76;
      for (let i = 0; i < edges.count; i++) {
        point.fromBufferAttribute(edges, i);
        point.x *= width;
        point.z *= width;
        point.y *= 1.006;
        point.applyMatrix4(member.matrix);
        position.setXYZ(offset++, point.x, point.y, point.z);
      }
    }
    this.all.geometry.setDrawRange(0, offset);
    position.needsUpdate = true;
  }
}
