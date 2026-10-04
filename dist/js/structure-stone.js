export function stoneFinish(material, tiles = false) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = 'varying vec3 vStonePosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvStonePosition = (modelMatrix * vec4(position, 1.0)).xyz;',
    );
    shader.fragmentShader = 'varying vec3 vStonePosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec2 stone = vStonePosition.xz;
      float grain = sin(stone.x * 57.0 + sin(stone.y * 39.0)) * sin(stone.y * 63.0);
      float grainFilter = 1.0 - smoothstep(0.01, 0.065, length(fwidth(stone)));
      float vein = sin(stone.x * 3.1 + stone.y * 1.7 + sin(stone.y * 2.2));
      diffuseColor.rgb *= 0.96 + 0.018 * vein + 0.024 * grain * grainFilter;
      ${
        tiles
          ? `vec2 cell = stone / vec2(3.6, 1.8);
      vec2 edge = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(0.0001));
      float seam = 1.0 - smoothstep(0.5, 1.7, min(edge.x, edge.y));
      float shade = fract(sin(dot(floor(cell), vec2(12.9898, 78.233))) * 43758.5453);
      diffuseColor.rgb *= mix(0.94, 1.0, shade) * (1.0 - seam * 0.2);`
          : ''
      }
    `,
    );
  };
  material.customProgramCacheKey = () => `stone-finish-${tiles}-v2`;
}
