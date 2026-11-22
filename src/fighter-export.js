import { Object3D } from 'three';
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js';
import roster from './fighter-rigs.json' with { type: 'json' };
import { projectType } from './project.js';
import { exportVrma } from './vrma.js';
import { applyHandShape } from './gestures.js';

export const fighterCount = roster.length;

function makeRig({ flip, joints }) {
  const bones = {}, rest = new Map();
  for (const [name, [, x, y, z]] of Object.entries(joints)) {
    const node = new Object3D();
    node.position.set(x, y, z);
    bones[name] = node;
    rest.set(name, node.position);
  }
  for (const [name, [parent]] of Object.entries(joints)) {
    if (parent) bones[parent].add(bones[name]);
  }
  return { bones, rest, flip, hipHeight: Math.max(.001, bones.hips.position.y) };
}

export async function exportFighters(frames, model) {
  const files = {
    'pose.motion.json': strToU8(JSON.stringify({ format: projectType, version: 1, model, frames }, null, 2)),
  };
  for (const fighter of roster) {
    const rig = makeRig(fighter);
    const fitted = frames.map(frame => {
      if (!frame.pairedHands) return frame;
      const angles = { ...frame.angles };
      applyHandShape(angles, 'both', frame.pairedHands, rig);
      return { ...frame, angles };
    });
    files[fighter.id + '.vrma'] = new Uint8Array(await exportVrma(rig, fitted));
  }
  return zipSync(files, { level: 6 });
}
