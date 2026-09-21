"""One-shot, exact-match migration for the owner-assigned Mycelium pass.
Only edits the named visual files. Removed after the verified source commit.
"""
from pathlib import Path

root = Path('components/worlds/mycelium')
p = root / 'Scene.tsx'
s = p.read_text()
if 'cinemaProfile' not in s:
    def replace(old, new, count=1):
        global s
        if s.count(old) < count:
            raise SystemExit('Scene changed: refusing an ambiguous visual patch: ' + old[:70])
        s = s.replace(old, new, count)
    replace('import { GradeShader } from "./GradeShader";', 'import { GradeShader } from "./GradeShader";\nimport { cinemaProfile, advanceSceneTime, shouldRenderFrame } from "./cinema-profile";')
    replace('  const width = 150;', '  const width = 150;')
    replace('  uniforms: { uTime: { value: number } },\n): THREE.Mesh {', '  uniforms: { uTime: { value: number } },\n  segments = 180,\n): THREE.Mesh {')
    replace('new THREE.PlaneGeometry(width, depth, 300, 380)', 'new THREE.PlaneGeometry(width, depth, segments, Math.round(segments * 1.25))')
    replace('    if (!container) return;\n\n    const nodes', '''    if (!container) return;
    const query = new URLSearchParams(window.location.search);
    const capture = query.get("capture") === "scene";
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let profile = cinemaProfile(container.clientWidth, window.devicePixelRatio, motion.matches, query.get("look") ?? "midnight");
    playingRef.current = profile.autoplay && !capture;
    autoCamRef.current = profile.autoplay && !capture;
    setPlaying(playingRef.current);
    setAutoCam(autoCamRef.current);

    const nodes''')
    replace('      56,\n      container.clientWidth', '      profile.fov,\n      container.clientWidth')
    replace('new THREE.Vector3(0.4, -0.45, 14.5)', 'new THREE.Vector3(streamCenter(18), WATER_LEVEL + 3.4, 18)')
    replace('new THREE.Vector3(streamCenter(-26), 3.4, -28)', 'new THREE.Vector3(streamCenter(-34), 1.5, -34)')
    replace('Math.min(window.devicePixelRatio, 2)', 'profile.pixelRatio')
    replace('      0.4,\n      0.45,\n      0.88,', '      0.25,\n      0.5,\n      1.15,')
    replace('    const grade = new ShaderPass(GradeShader);', '''    const grade = new ShaderPass(GradeShader);
    grade.uniforms.uExposure.value = profile.exposure;
    grade.uniforms.uGrain.value = capture ? 0 : 0.006;
    grade.uniforms.uAberration.value = 0.0005;''')
    replace('buildTerrain(soil, soilBump, uniforms)', 'buildTerrain(soil, soilBump, uniforms, profile.terrainSegments)')
    replace('Math.min(1024, Math.max(512, Math.round(container.clientWidth)))', 'profile.reflectionSize')
    replace('Math.min(publicItems.length, 260)', 'Math.min(publicItems.length, profile.colonyLimit)')
    replace('Math.min(privateCount, 320)', 'Math.min(privateCount, profile.colonyLimit)')
    replace('buildSpores(520, 0xabcdef)', 'buildSpores(profile.sporeCount, 0xabcdef)')
    replace('for (const [x, z, power] of colonySpots)', 'for (const [x, z, power] of colonySpots.filter((_, i) => container.clientWidth >= 768 || i % 2 === 0))')
    replace('    const colonyBase = colonyLights.map((l) => l.intensity);', '''    const colonyBase = colonyLights.map((l) => l.intensity);

    // Light has hierarchy: a quiet cool ecosystem around a localized amber heart.
    scene.traverse((object) => {
      if (object instanceof THREE.PointLight) {
        object.intensity *= object.color.r > object.color.g ? profile.warmLightScale : profile.coolLightScale;
      }
    });
    const onMotionChange = () => {
      if (motion.matches) {
        playingRef.current = false;
        autoCamRef.current = false;
        setPlaying(false);
        setAutoCam(false);
      }
    };
    motion.addEventListener("change", onMotionChange);''')
    replace('      camera.aspect = w / h;', '''      if (w < 1 || h < 1) return;
      profile = cinemaProfile(w, window.devicePixelRatio, motion.matches, query.get("look") ?? "midnight");
      camera.fov = profile.fov;
      renderer.setPixelRatio(profile.pixelRatio);
      composer.setPixelRatio(profile.pixelRatio);
      camera.aspect = w / h;''')
    replace('    let flowTime = 0;', '    let flowTime = 0;\n    let previousFrame = -Infinity;')
    replace('''      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      uniforms.uTime.value = t;
      grade.uniforms.uTime.value = t;
      if (playingRef.current) flowTime += dt;''', '''      const now = performance.now();
      if (!shouldRenderFrame(now, previousFrame, profile.fps, document.hidden)) return;
      previousFrame = now;
      const dt = Math.min(clock.getDelta(), 0.05);
      flowTime = advanceSceneTime(flowTime, dt, playingRef.current && !capture);
      const t = capture ? 6 : flowTime;
      uniforms.uTime.value = t;
      grade.uniforms.uTime.value = t;''')
    replace('      if (playingRef.current) {', '      if (playingRef.current && !capture) {')
    replace('heroBase[i] * (0.85', 'heroBase[i] * profile.coolLightScale * (0.85')
    replace('warmCore.intensity = 520 *', 'warmCore.intensity = 520 * profile.warmLightScale *')
    replace('colonyBase[i] * (0.78', 'colonyBase[i] * profile.coolLightScale * (0.78')
    replace('      if (autoCamRef.current) {', '      if (autoCamRef.current && playingRef.current && !capture) {')
    replace('camHome.x + Math.sin(t * 0.075) * 1.5', 'camHome.x + Math.sin(t * 0.075) * 0.45')
    replace('camHome.z - (1 - Math.cos(t * 0.038)) * 3.6', 'camHome.z - (1 - Math.cos(t * 0.038)) * 1.2')
    replace('''      composer.render();

      fpsFrames++;
      const now = performance.now();''', '''      composer.render();
      renderer.domElement.dataset.sceneReady = "true";
      renderer.domElement.dataset.sceneTime = t.toFixed(4);
      renderer.domElement.dataset.look = profile.look;
      renderer.domElement.dataset.pixelRatio = String(profile.pixelRatio);

      fpsFrames++;''')
    replace('if (now - lastFps > 500)', 'if (now - lastFps > 2000)')
    replace('      cancelAnimationFrame(raf);', '      cancelAnimationFrame(raf);\n      motion.removeEventListener("change", onMotionChange);')
    replace('absolute inset-x-0 bottom-0 z-20 flex flex-wrap', 'absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] sm:bottom-0 z-20 flex flex-wrap')
    replace('rounded-full bg-black/50 px-4 py-2 text-xs', 'min-h-11 rounded-full bg-black/50 px-4 py-2 text-xs', 2)
    replace('Pause flow', 'Pause dream')
    replace('Resume flow', 'Resume dream')
    p.write_text(s)

p = root / 'terrain.ts'
s = p.read_text()
s = s.replace('CHANNEL_HALF_WIDTH = 2.1', 'CHANNEL_HALF_WIDTH = 3.2')
s = s.replace('1.25) * 3.6', '1.25) * 2.8')
s = s.replace('smoothstep(2.2, 11, dc), 1.1) * 6.4', 'smoothstep(3.2, 12, dc), 1.1) * 3.4')
p.write_text(s)

p = root / 'props.ts'
s = p.read_text()
old = 'group.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI, (Math.random() - 0.5) * 0.22);'
new = 'const rng = makeRng((Math.round(x * 1000) ^ Math.round(z * 7919)) >>> 0);\n  group.rotation.set((rng() - 0.5) * 0.2, rng() * Math.PI, (rng() - 0.5) * 0.22);'
s = s.replace(old, new)
p.write_text(s)
print('Mycelium source patch complete; privacy and ingestion files untouched.')
