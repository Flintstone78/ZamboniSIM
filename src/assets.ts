import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Generated assets (textures, GLB models) live under /assets and are loaded
 * on top of the procedural look: every consumer starts with its procedural
 * material/mesh and upgrades when the asset arrives. A missing file therefore
 * degrades gracefully instead of rendering black.
 */
export function loadTextureInto(
  url: string,
  apply: (texture: THREE.Texture) => void,
): void {
  new THREE.TextureLoader().load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      apply(tex);
    },
    undefined,
    () => {
      /* asset missing – keep the procedural look */
    },
  );
}

export function loadModelInto(
  url: string,
  apply: (model: THREE.Group) => void,
): void {
  new GLTFLoader().load(
    url,
    (gltf) => apply(gltf.scene),
    undefined,
    () => {
      /* asset missing – keep the procedural model */
    },
  );
}
