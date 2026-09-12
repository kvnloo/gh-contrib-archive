/**
 * Final cinematic grade and tone map.
 *
 * This pass owns tone mapping for the whole chain. The scene is rendered with
 * `NoToneMapping` so bloom operates on true linear HDR, then this pass applies
 * exposure, halation, an ACES curve and the film grade. `OutputPass` afterwards
 * only converts to sRGB — letting the renderer *and* `OutputPass` both tone map
 * double-applies the curve, which is what flattens highlights into a uniform
 * pale wash.
 */
export const GradeShader = {
  name: "MyceliumGradeShader",
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uExposure: { value: 1.05 },
    uVignette: { value: 0.95 },
    uGrain: { value: 0.028 },
    uAberration: { value: 0.0014 },
    uBlackPoint: { value: 0.012 },
    uHalation: { value: 0.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uExposure;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uBlackPoint;
    uniform float uHalation;
    varying vec2 vUv;

    // Narkowicz ACES fit: enough of the shoulder to keep bioluminescent cores
    // from clipping to flat white while holding a deep toe.
    vec3 aces( vec3 x ) {
      const float a = 2.51;
      const float b = 0.03;
      const float c = 2.43;
      const float d = 0.59;
      const float e = 0.14;
      return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot( c, c );

      // Lateral chromatic aberration, strongest at the frame edges.
      vec2 off = c * uAberration * ( 0.35 + r2 * 3.0 );
      vec3 col;
      col.r = texture2D( tDiffuse, vUv + off ).r;
      col.g = texture2D( tDiffuse, vUv ).g;
      col.b = texture2D( tDiffuse, vUv - off ).b;

      // Halation in linear HDR: only genuinely over-range pixels bleed, so the
      // fungi get a soft organic fringe and the dark rock stays clean.
      vec3 halo = vec3( 0.0 );
      for ( int i = 0; i < 6; i++ ) {
        float a = float( i ) * 1.0472;
        vec2 d = vec2( cos( a ), sin( a ) ) * 0.007;
        halo += texture2D( tDiffuse, vUv + d ).rgb;
      }
      halo /= 6.0;
      float haloLum = dot( halo, vec3( 0.299, 0.587, 0.114 ) );
      col += halo * vec3( 0.55, 1.0, 0.94 ) * smoothstep( 0.9, 3.0, haloLum ) * uHalation;

      col = aces( col * uExposure );

      // Crush the toe to a true black point. A cavern lit only by fungi is
      // mostly black; lifting its shadows is what turns it into teal soup.
      col = max( col - uBlackPoint, 0.0 ) / ( 1.0 - uBlackPoint );

      float lum = dot( col, vec3( 0.299, 0.587, 0.114 ) );

      // A trace of teal in the near-blacks only, applied after the black point
      // so it tints the shadows without raising them.
      col += vec3( 0.003, 0.011, 0.012 ) * ( 1.0 - smoothstep( 0.0, 0.18, lum ) );

      // Keep the mids close to neutral: pushing saturation on a scene that is
      // almost entirely one hue is what collapses the frame into teal soup.
      col = mix( vec3( lum ), col, 1.05 - smoothstep( 0.6, 1.0, lum ) * 0.45 );
      // Warm the shadows (wet earth) and cool only the upper mids, so the banks
      // keep their brown and the fungi keep their mint.
      col *= mix( vec3( 1.1, 0.98, 0.9 ), vec3( 0.94, 1.0, 0.99 ), smoothstep( 0.06, 0.45, lum ) );

      // Contrast S-curve weighted toward the shadows.
      col = pow( clamp( col, 0.0, 1.0 ), vec3( 1.1 ) ) * 1.1;

      float vig = 1.0 - uVignette * r2 * ( 0.85 + 0.4 * r2 );
      col *= clamp( vig, 0.0, 1.0 );

      float grain = fract( sin( dot( vUv * vec2( 1024.0, 768.0 ) + uTime * 37.0, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      col += ( grain - 0.5 ) * uGrain * ( 1.25 - lum );

      // Left in display-linear space: OutputPass performs the sRGB encode.
      gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
    }
  `,
};
