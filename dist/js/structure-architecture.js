import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/addons/geometries/RoundedBoxGeometry.js';

export function steelGeometry() {
  const shape = new THREE.Shape();
  const outline = [
    [-0.7, -0.7],
    [0.7, -0.7],
    [0.7, -0.49],
    [0.12, -0.49],
    [0.12, 0.49],
    [0.7, 0.49],
    [0.7, 0.7],
    [-0.7, 0.7],
    [-0.7, 0.49],
    [-0.12, 0.49],
    [-0.12, -0.49],
    [-0.7, -0.49],
  ];
  outline.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.98,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.01,
    bevelThickness: 0.01,
  });
  geometry.translate(0, 0, -0.49);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function columnGeometry() {
  const profile = [
    [0, -0.5],
    [0.94, -0.5],
    [0.94, -0.465],
    [0.82, -0.45],
    [0.82, -0.415],
    [0.72, -0.4],
    [0.69, 0.37],
    [0.75, 0.4],
    [0.75, 0.425],
    [0.92, 0.455],
    [0.94, 0.465],
    [0.94, 0.5],
    [0, 0.5],
  ];
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    24,
  );
}

export function timberGeometry() {
  return new RoundedBoxGeometry(1.38, 1, 1.38, 1, 0.035);
}

export const surfaceNoise = `
float buildHash(vec3 p) { p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float buildNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(buildHash(i), buildHash(i + vec3(1,0,0)), f.x), mix(buildHash(i + vec3(0,1,0)), buildHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(buildHash(i + vec3(0,0,1)), buildHash(i + vec3(1,0,1)), f.x), mix(buildHash(i + vec3(0,1,1)), buildHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

function aggregateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(256, 256);
  let seed = 42;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 80 + (seed >>> 24) * 0.55;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 8);
  texture.anisotropy = 4;
  return texture;
}

export function architecturalMaterials() {
  const grain = aggregateTexture();
  const make = (stone) => {
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      metalness: 0,
      roughness: stone ? 0.92 : 0.84,
      bumpMap: grain,
      bumpScale: stone ? 0.005 : 0.002,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vBuildLocal;\nvarying vec3 vBuildNormal;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBuildLocal = position;
        vBuildNormal = normal;
        #ifdef USE_INSTANCING
          vBuildLocal *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
      `,
      );
      shader.fragmentShader =
        'varying vec3 vBuildLocal;\nvarying vec3 vBuildNormal;\n' +
        surfaceNoise +
        '\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float broad = buildNoise(vBuildLocal * vec3(21., 2.4, 21.));
        float fine = buildNoise(vBuildLocal * 95.);
        float filtering = 1. - smoothstep(.005, .03, length(fwidth(vBuildLocal)));
        diffuseColor.rgb *= .84 + broad * .21 + (fine - .5) * .18 * filtering;
        ${
          stone
            ? `
          float strata = buildNoise(vBuildLocal * vec3(7., 32., 7.));
          float pores = smoothstep(.72, .88, fine) * filtering;
          float course = abs(fract(vBuildLocal.y * 1.3 + .37) - .5);
          float joint = 1. - smoothstep(.001, .004 + fwidth(course), course);
          diffuseColor.rgb *= .94 + strata * .1 - pores * .2 - joint * .12;
        `
            : `
          vec3 p = vBuildLocal;
          float warp = buildNoise(p * vec3(9., 1.3, 9.));
          float rings = length(p.xz + vec2(.035, .018)) * 170. + warp * 5.;
          float grainLine = .5 + .5 * sin(rings);
          float grainFilter = 1. - smoothstep(.5, 3., fwidth(rings));
          float fibers = buildNoise(p * vec3(180., 3., 180.));
          float endFace = smoothstep(.7, .95, abs(vBuildNormal.y));
          diffuseColor.rgb *= .8 + grainLine * .25 * grainFilter + fibers * .17;
          diffuseColor.rgb *= 1. - endFace * .15;
        `
        }
      `,
      );
    };
    material.customProgramCacheKey = () => `architecture-${stone ? 'limestone' : 'timber'}-2`;
    return material;
  };
  return { stone: make(true), timber: make(false) };
}
