import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { FOG_COLOR, FOG_DENSITY } from "./materials";

/**
 * Mirror-still stream with rippled, distance-attenuated reflections. The
 * reflection is dimmed and tinted so the water reads as black water carrying
 * the glow of the cavern rather than a chrome mirror.
 */
export function createStream(
  width: number,
  length: number,
  dudv: THREE.Texture,
  uniforms: { uTime: { value: number } },
  renderTargetSize = 1024,
): Reflector {
  const geometry = new THREE.PlaneGeometry(width, length, 1, 1);
  const water = new Reflector(geometry, {
    clipBias: 0.0035,
    textureWidth: renderTargetSize,
    textureHeight: renderTargetSize,
    color: 0x030a0b,
  });

  const material = water.material as THREE.ShaderMaterial;
  material.uniforms.tDudv = { value: dudv };
  material.uniforms.uTime = uniforms.uTime;
  material.uniforms.uFogColor = { value: new THREE.Color(FOG_COLOR) };
  material.uniforms.uFogDensity = { value: FOG_DENSITY };
  material.uniforms.uDeep = { value: new THREE.Color(0x010605) };

  material.vertexShader = /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vLocal;
    varying vec3 vWorld;
    varying float vFogDepth;
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vLocal = position.xy;
      vec4 world = modelMatrix * vec4( position, 1.0 );
      vWorld = world.xyz;
      vec4 mv = viewMatrix * world;
      vFogDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `;

  material.fragmentShader = /* glsl */ `
    uniform vec3 color;
    uniform vec3 uDeep;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uTime;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDudv;
    varying vec4 vUv;
    varying vec2 vLocal;
    varying vec3 vWorld;
    varying float vFogDepth;

    void main() {
      // Two ripple layers drifting downstream at different rates.
      vec2 uvA = vLocal * vec2( 0.09, 0.045 ) + vec2( 0.0, uTime * 0.016 );
      vec2 uvB = vLocal * vec2( 0.17, 0.085 ) * 1.7 - vec2( uTime * 0.011, uTime * 0.026 );
      vec2 dA = texture2D( tDudv, uvA ).rg * 2.0 - 1.0;
      vec2 dB = texture2D( tDudv, uvB ).rg * 2.0 - 1.0;
      vec2 ripple = ( dA * 0.7 + dB * 0.45 ) * 0.024;

      vec4 base = texture2DProj( tDiffuse, vUv + vec4( ripple, 0.0, 0.0 ) );

      // Reflections stay crisp far away and break up in the near shallows.
      float shallow = smoothstep( 34.0, 4.0, vFogDepth );
      vec3 reflected = base.rgb * mix( 0.9, 0.45, shallow );

      // Streak the brightest reflected light vertically, as still water does.
      // Thresholded high so only actual light sources smear, which is what
      // gives the channel its long specular tails instead of a milky sheen.
      vec4 smear = texture2DProj( tDiffuse, vUv + vec4( ripple * 2.4, 0.0, 0.0 ) );
      float lum = dot( smear.rgb, vec3( 0.299, 0.587, 0.114 ) );
      reflected += smear.rgb * smoothstep( 0.55, 1.4, lum ) * 0.8;

      vec3 tinted = mix( uDeep, reflected * vec3( 0.8, 1.02, 1.0 ), 0.95 ) + color * 0.12;

      // Glancing angles reflect more; steep angles show the dark bed. A near
      // zero base term keeps the water black wherever it isn't mirroring a light.
      vec3 viewDir = normalize( cameraPosition - vWorld );
      float fres = pow( 1.0 - clamp( viewDir.y, 0.0, 1.0 ), 2.6 );
      vec3 col = mix( uDeep, tinted, clamp( 0.06 + fres * 1.15, 0.0, 1.0 ) );

      float fogFactor = 1.0 - exp( - uFogDensity * uFogDensity * vFogDepth * vFogDepth );
      col = mix( col, uFogColor, clamp( fogFactor, 0.0, 1.0 ) );

      // Left in linear space on purpose: OutputPass does tone mapping and
      // color-space conversion for the whole frame.
      gl_FragColor = vec4( col, 1.0 );
    }
  `;
  material.needsUpdate = true;

  return water;
}
