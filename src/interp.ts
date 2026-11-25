import * as THREE from 'three';

interface Track {
  prevP: THREE.Vector3;
  curP: THREE.Vector3;
  prevQ: THREE.Quaternion;
  curQ: THREE.Quaternion;
  /** The transform last written by present(), to spot outside edits. */
  shownP: THREE.Vector3;
  shownQ: THREE.Quaternion;
  stamp: number;
}

// A jump larger than this in one simulation step is a teleport (respawn,
// reset), not motion – snap instead of streaking across the rink.
const TELEPORT_SQ = 2.5 * 2.5;

/**
 * Smooths objects that the fixed-rate simulation moves in discrete steps
 * (pucks, skaters, power-ups, parking cars). After each step it records the
 * transform of every child of the watched groups; each rendered frame poses
 * them part-way between the last two steps. Before the next step the true
 * simulated transforms are put back, so systems that keep state in their
 * meshes never read an interpolated value. If anything outside the
 * simulation moved an object in between (a level reset, say), that edit
 * wins and the object simply snaps.
 */
export class TransformInterpolator {
  private groups: THREE.Object3D[] = [];
  private tracks = new Map<THREE.Object3D, Track>();
  private stamp = 0;
  private presented = false;

  /** Interpolate the direct children of these groups. */
  watch(...groups: THREE.Object3D[]): void {
    this.groups = groups;
    this.clear();
  }

  clear(): void {
    this.tracks.clear();
    this.presented = false;
  }

  /** Call before the first simulation step of a frame. */
  restore(): void {
    if (!this.presented) return;
    for (const [o, t] of this.tracks) {
      if (o.position.equals(t.shownP) && o.quaternion.equals(t.shownQ)) {
        o.position.copy(t.curP);
        o.quaternion.copy(t.curQ);
      } else {
        // Moved outside the simulation – accept the new transform as truth
        t.curP.copy(o.position);
        t.prevP.copy(o.position);
        t.curQ.copy(o.quaternion);
        t.prevQ.copy(o.quaternion);
      }
    }
    this.presented = false;
  }

  /** Call after each simulation step. */
  afterStep(): void {
    this.stamp++;
    for (const g of this.groups) {
      for (const o of g.children) {
        let t = this.tracks.get(o);
        if (!t) {
          t = {
            prevP: o.position.clone(),
            curP: o.position.clone(),
            prevQ: o.quaternion.clone(),
            curQ: o.quaternion.clone(),
            shownP: o.position.clone(),
            shownQ: o.quaternion.clone(),
            stamp: 0,
          };
          this.tracks.set(o, t);
        } else {
          t.prevP.copy(t.curP);
          t.prevQ.copy(t.curQ);
          t.curP.copy(o.position);
          t.curQ.copy(o.quaternion);
          if (t.prevP.distanceToSquared(t.curP) > TELEPORT_SQ) {
            t.prevP.copy(t.curP);
            t.prevQ.copy(t.curQ);
          }
        }
        t.stamp = this.stamp;
      }
    }
    for (const [o, t] of this.tracks) if (t.stamp !== this.stamp) this.tracks.delete(o);
  }

  /** Pose everything `alpha` (0..1) of the way through the last step. */
  present(alpha: number): void {
    for (const [o, t] of this.tracks) {
      o.position.lerpVectors(t.prevP, t.curP, alpha);
      o.quaternion.slerpQuaternions(t.prevQ, t.curQ, alpha);
      t.shownP.copy(o.position);
      t.shownQ.copy(o.quaternion);
    }
    this.presented = true;
  }
}
