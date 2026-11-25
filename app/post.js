// ============================================================
// Drawing one scene, with or without the high quality path:
// ambient occlusion (GTAO) on a multisampled scene pass.
// The plain path is renderer.render(), which keeps phones fast.
// ============================================================
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, vec4, mix, float, screenUV, smoothstep, step } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

// radius: how far corners darken, in scene units (metres here); strength: 0 = no darkening, 1 = full
export function createView(renderer, scene, camera, { radius = 0.02, strength = 0.8 } = {}) {
  let post = null, on = false;
  function build() {
    post = new THREE.PostProcessing(renderer);
    // MSAA inside the pass smooths edges without a second full screen pass (WebGL 2 keeps it off)
    const scenePass = pass(scene, camera, { samples: renderer.backend.isWebGPUBackend ? 4 : 0 });
    scenePass.setMRT(mrt({ output, normal: normalView }));
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const aoPass = ao(depth, scenePass.getTextureNode('normal'), camera);
    aoPass.radius.value = radius;
    // GTAO samples past the screen border and turns noisy there, and the empty background
    // has nothing to occlude: fade it out over the outer 1.5 % and skip the far plane
    const e = 0.015, u = screenUV;
    const edge = smoothstep(0, e, u.x).mul(smoothstep(0, e, u.x.oneMinus())).mul(smoothstep(0, e, u.y)).mul(smoothstep(0, e, u.y.oneMinus()));
    const amount = float(strength).mul(edge).mul(step(depth.x, 0.99999));
    post.outputNode = vec4(color.rgb.mul(mix(float(1), aoPass.getTextureNode().r, amount)), color.a);
  }
  return {
    get on() { return on; },
    set(v) { on = v; if (on && !post) build(); },
    render() { if (on) post.render(); else renderer.render(scene, camera); },
  };
}
