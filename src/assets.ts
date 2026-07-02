import * as THREE from 'three';

/**
 * Generated assets (textures, GLB models) live under /assets and are loaded
 * on top of the procedural look: every consumer starts with its procedural
 * material/mesh and upgrades when the asset arrives. A missing file therefore
 * degrades gracefully instead of rendering black.
 */
/** Resolve an absolute asset path against Vite's base (GitHub Pages serves
 * the game from a subdirectory). */
const assetUrl = (path: string): string =>
  import.meta.env.BASE_URL + path.replace(/^\//, '');

// One decode per asset per session: repeated loads (every level rebuilds the
// arena) reuse the same texture instead of re-fetching and re-uploading.
const textureCache = new Map<string, THREE.Texture>();

export function loadTextureInto(
  url: string,
  apply: (texture: THREE.Texture) => void,
): void {
  const resolved = assetUrl(url);
  const cached = textureCache.get(resolved);
  if (cached) {
    apply(cached);
    return;
  }
  new THREE.TextureLoader().load(
    resolved,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      textureCache.set(resolved, tex);
      apply(tex);
    },
    undefined,
    () => {
      /* asset missing – keep the procedural look */
    },
  );
}

/**
 * Free the GPU resources of a scene subtree that is being swapped out (the
 * per-level rink/arena/gate). Lights get their shadow maps back, meshes their
 * geometries, materials and texture maps. `keep` protects textures that are
 * shared across levels (e.g. the live ice roughness map); cached assets may be
 * disposed freely – three re-uploads them on next use.
 */
export function disposeObject(root: THREE.Object3D, keep: THREE.Texture[] = []): void {
  const keepSet = new Set(keep);
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) {
      (o as THREE.Light).dispose();
      return;
    }
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      for (const t of [
        sm.map, sm.emissiveMap, sm.roughnessMap, sm.metalnessMap,
        sm.normalMap, sm.aoMap, sm.alphaMap, sm.bumpMap,
      ]) {
        if (t && !keepSet.has(t)) t.dispose();
      }
      m.dispose();
    }
  });
}

export function loadModelInto(
  url: string,
  apply: (model: THREE.Group) => void,
): void {
  // The GLTF loader is code-split out of the main bundle – models upgrade the
  // procedural look asynchronously anyway, so the extra tick is invisible.
  void import('three/addons/loaders/GLTFLoader.js').then(
    ({ GLTFLoader }) => {
      new GLTFLoader().load(
        assetUrl(url),
        (gltf) => apply(gltf.scene),
        undefined,
        () => {
          /* asset missing – keep the procedural model */
        },
      );
    },
    () => {
      /* chunk failed to load (offline?) – keep the procedural model */
    },
  );
}
