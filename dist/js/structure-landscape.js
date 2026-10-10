import * as THREE from 'three';
import { Sky } from '../vendor/addons/objects/Sky.js';
import { stoneFinish } from './structure-stone.js';
import { surfaceNoise } from './structure-architecture.js';
import { FOUNDATION } from './structure-profile.js';

// タッチ端末は GPU が弱いことが多いので、草と影を軽くする
const LITE = matchMedia('(pointer: coarse)').matches;

function randomSource() {
  let seed = 104729;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function makeLandscape(scene, renderer, reducedMotion) {
  const sky = new Sky();
  sky.scale.setScalar(800);
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'vec4( retColor, 1.0 )',
    'vec4( retColor * 0.36, 1.0 )',
  );
  const sunDirection = new THREE.Vector3(-0.36, 0.17, -0.91).normalize();
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 2.3;
  uniforms.rayleigh.value = 2.8;
  uniforms.mieCoefficient.value = 0.004;
  uniforms.mieDirectionalG.value = 0.78;
  uniforms.sunPosition.value.copy(sunDirection);
  scene.add(sky);
  const environmentScene = new THREE.Scene();
  environmentScene.add(sky.clone());
  // PMREM は描画結果なので、WebGL コンテキストが復帰したら作り直す
  let environment;
  const bakeEnvironment = () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment?.dispose();
    environment = pmrem.fromScene(environmentScene, 0.02, 0.1, 1000);
    scene.environment = environment.texture;
    pmrem.dispose();
  };
  bakeEnvironment();
  scene.environmentIntensity = 0.5;

  scene.add(new THREE.HemisphereLight('#dceafb', '#666144', 1.35));
  const skyFill = new THREE.DirectionalLight('#dce8ef', 0.85);
  skyFill.position.set(5, 8, 12);
  scene.add(skyFill);
  const sun = new THREE.DirectionalLight('#ffe6bd', 3.5);
  sun.target.position.set(0, 1.5, 0);
  sun.position.copy(sunDirection).multiplyScalar(42).add(sun.target.position);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(LITE ? 1024 : 2048);
  Object.assign(sun.shadow.camera, {
    left: -11,
    right: 11,
    top: 11,
    bottom: -11,
    near: 0.1,
    far: 85,
  });
  sun.shadow.normalBias = 0.018;
  sun.shadow.bias = -0.00012;
  scene.add(sun, sun.target);

  const earth = new THREE.MeshStandardMaterial({ color: '#727250', roughness: 1 });
  earth.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vGround;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.)).xyz;',
    );
    shader.fragmentShader = 'varying vec3 vGround;\n' + surfaceNoise + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float soilVariation = buildNoise(vGround * .27) * .7 + buildNoise(vGround * 1.7) * .3;
      diffuseColor.rgb *= .72 + soilVariation * .55;
      float path = 1. - smoothstep(.35, 1.4, abs(vGround.x - sin(vGround.z * .09) * 1.4));
      path *= smoothstep(4., 8., vGround.z);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.27, .23, .155), path * .5);
      float grain = buildNoise(vGround * 37.);
      diffuseColor.rgb *= 1. + (grain - .5) * .18 * (1. - smoothstep(.02, .12, length(fwidth(vGround))));
    `,
    );
  };
  earth.customProgramCacheKey = () => 'structure-field-1';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), earth);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.28;
  ground.receiveShadow = true;
  scene.add(ground);

  const concrete = new THREE.MeshStandardMaterial({ color: '#c1b18e', roughness: 0.94 });
  stoneFinish(concrete, true);
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(FOUNDATION.halfSize * 2, FOUNDATION.halfHeight * 2, FOUNDATION.halfSize * 2),
    concrete,
  );
  plinth.position.y = FOUNDATION.centerY;
  plinth.castShadow = plinth.receiveShadow = true;
  scene.add(plinth);

  const rand = randomSource();
  const blade = new THREE.BufferGeometry();
  const positions = [],
    uvs = [],
    indices = [];
  for (let leaf = 0; leaf < 3; leaf++) {
    const angle = (leaf * Math.PI) / 3;
    for (const [x, y, z] of [
      [-0.04, 0, 0],
      [0.04, 0, 0],
      [-0.02, 0.6, 0.04],
      [0.02, 0.6, 0.04],
      [0, 1, 0.14],
    ]) {
      positions.push(
        x * Math.cos(angle) - z * Math.sin(angle),
        y * (1 - leaf * 0.12),
        x * Math.sin(angle) + z * Math.cos(angle),
      );
    }
    uvs.push(0, 0, 1, 0, 0, 0.6, 1, 0.6, 0.5, 1);
    indices.push(...[0, 1, 2, 1, 3, 2, 2, 3, 4].map((index) => index + leaf * 5));
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  blade.setIndex(indices);
  blade.computeVertexNormals();
  const wind = { value: 0 };
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.94,
    side: THREE.DoubleSide,
  });
  grassMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.fieldTime = wind;
    shader.vertexShader = 'uniform float fieldTime;\nvarying float vBladeHeight;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vBladeHeight = position.y;
      float phase = instanceMatrix[3].x * .43 + instanceMatrix[3].z * .37;
      transformed.x += sin(fieldTime * 1.3 + phase) * position.y * position.y * .16;
    `,
    );
    shader.fragmentShader = 'varying float vBladeHeight;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb *= mix(.55, 1.14, vBladeHeight);',
    );
  };
  grassMaterial.customProgramCacheKey = () => 'structure-grass-1';
  const blades = LITE ? 7000 : 16000;
  const grass = new THREE.InstancedMesh(blade, grassMaterial, blades);
  const transform = new THREE.Object3D();
  const grassColor = new THREE.Color();
  // 台座と小道に掛かる草は置かずに詰める。並びはばらばらなので、count を減らしても一様に間引ける
  let planted = 0;
  for (let i = 0; i < blades; i++) {
    const radius = 4.4 + Math.pow(rand(), 2) * 32;
    const angle = rand() * Math.PI * 2;
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius;
    const inFoundation = Math.abs(x) < 4.65 && Math.abs(z) < 4.65;
    const inPath = z > 5 && Math.abs(x - Math.sin(z * 0.09) * 1.4) < 0.7;
    transform.position.set(x, -0.28, z);
    transform.rotation.set(0, rand() * Math.PI * 2, (rand() - 0.5) * 0.22);
    const size = inFoundation || inPath ? 0 : 0.035 + rand() * 0.075;
    transform.scale.set(size * (1.2 + rand()), size, size);
    transform.updateMatrix();
    grassColor.setHSL(0.17 + rand() * 0.055, 0.2 + rand() * 0.15, 0.26 + rand() * 0.12);
    if (!size) continue;
    grass.setMatrixAt(planted, transform.matrix);
    grass.setColorAt(planted++, grassColor);
  }
  grass.count = planted;
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  scene.add(grass);

  const hills = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 24, 12),
    new THREE.MeshStandardMaterial({ color: '#889583', roughness: 1 }),
    24,
  );
  for (let i = 0; i < hills.count; i++) {
    const angle = (i / hills.count) * Math.PI * 2;
    const distance = 135 + rand() * 70;
    const height = 3 + rand() * 5;
    transform.position.set(Math.sin(angle) * distance, -height * 0.55, Math.cos(angle) * distance);
    transform.rotation.set(0, rand() * Math.PI, 0);
    transform.scale.set(20 + rand() * 30, height, 16 + rand() * 22);
    transform.updateMatrix();
    hills.setMatrixAt(i, transform.matrix);
  }
  scene.add(hills);
  addScaleReferences(scene, concrete);
  return {
    plinth,
    get environment() {
      return environment;
    },
    grass,
    grassTotal: planted,
    sun,
    restore: bakeEnvironment,
    update(time) {
      wind.value = reducedMotion ? 0 : time;
    },
  };
}

function addScaleReferences(scene, stone) {
  const transform = new THREE.Object3D();
  const leaves = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshStandardMaterial({ color: '#394c2e', roughness: 1 }),
    20,
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.025, 0.04, 1, 6),
    new THREE.MeshStandardMaterial({ color: '#65513a', roughness: 1 }),
    10,
  );
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * 7.2,
      z = -4 - Math.floor(i / 2) * 4.2;
    const height = 0.95 + (i % 3) * 0.13;
    transform.position.set(x, -0.06, z);
    transform.rotation.set(0, i, 0);
    transform.scale.set(1, 0.45, 1);
    transform.updateMatrix();
    trunks.setMatrixAt(i, transform.matrix);
    for (let crown = 0; crown < 2; crown++) {
      transform.position.set(x, 0.2 + crown * height * 0.36, z);
      transform.scale.set(0.22 - crown * 0.055, height * 0.47, 0.2 - crown * 0.05);
      transform.updateMatrix();
      leaves.setMatrixAt(i * 2 + crown, transform.matrix);
    }
  }
  const people = [
    [-3.45, 3.7, 0.2],
    [-3.2, 3.5, -0.4],
    [3.65, -3.35, 0.9],
  ];
  const silhouette = new THREE.MeshStandardMaterial({ color: '#655548', roughness: 1 });
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.017, 10, 8), silhouette, people.length);
  const bodies = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.8, 1, 1, 8),
    silhouette,
    people.length * 5,
  );
  people.forEach(([x, z, angle], i) => {
    transform.position.set(x, 0.218, z);
    transform.rotation.set(0, angle, 0);
    transform.scale.setScalar(1);
    transform.updateMatrix();
    heads.setMatrixAt(i, transform.matrix);
    for (const [part, [ox, y, radius, length, lean]] of [
      [0, 0.158, 0.023, 0.085, 0],
      [-0.014, 0.06, 0.009, 0.12, -0.06],
      [0.014, 0.06, 0.009, 0.12, 0.06],
      [-0.035, 0.143, 0.007, 0.087, -0.15],
      [0.035, 0.143, 0.007, 0.087, 0.15],
    ].entries()) {
      transform.position.set(x + ox * Math.cos(angle), y - 0.01, z + ox * Math.sin(angle));
      transform.rotation.set(0, angle, lean);
      transform.scale.set(radius, length, radius);
      transform.updateMatrix();
      bodies.setMatrixAt(i * 5 + part, transform.matrix);
    }
  });
  for (const object of [leaves, trunks, heads, bodies]) {
    object.castShadow = object.receiveShadow = true;
    scene.add(object);
  }
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.2), stone);
    step.position.set(0, -0.04 - i * 0.075, 4.58 + i * 0.19);
    step.castShadow = step.receiveShadow = true;
    scene.add(step);
  }
}
