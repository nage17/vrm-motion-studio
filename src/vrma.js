import { AnimationClip, Euler, Object3D, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack, MathUtils } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export function rotation(values = [0, 0, 0], target = new Quaternion()) {
  return target.setFromEuler(new Euler(...values.map(MathUtils.degToRad), 'XYZ'));
}

// The export contains the normalized T-pose hierarchy and animation channels only.
export async function exportVrma(rig, frames) {
  const root = new Object3D();
  const copies = new Map();
  const names = new Map(Object.entries(rig.bones).map(([name, node]) => [node, name]));
  for (const [name, bone] of Object.entries(rig.bones)) {
    const node = new Object3D();
    node.name = name;
    node.position.copy(rig.rest.get(name));
    if (rig.flip) node.position.set(-node.position.x, node.position.y, -node.position.z);
    copies.set(name, node);
  }
  for (const [name, bone] of Object.entries(rig.bones)) {
    const parent = copies.get(names.get(bone.parent)) ?? root;
    parent.add(copies.get(name));
  }

  const keys = frames.length === 1 ? [frames[0], { ...frames[0], time: .1 }] : frames;
  const times = keys.map(frame => frame.time);
  const tracks = [];
  for (const name of copies.keys()) {
    if (name === 'leftEye' || name === 'rightEye') continue;
    const values = keys.flatMap(frame => rotation(frame.angles[name]).toArray());
    tracks.push(new QuaternionKeyframeTrack(name + '.quaternion', times, values));
  }
  const hips = copies.get('hips').position;
  const translations = keys.flatMap(frame => [hips.x, hips.y + frame.hip * rig.hipHeight, hips.z]);
  tracks.push(new VectorKeyframeTrack('hips.position', times, translations));

  const exporter = new GLTFExporter().register(writer => ({
    afterParse() {
      const humanBones = Object.fromEntries([...copies].map(([name, node]) => [name, { node: writer.nodeMap.get(node) }]));
      writer.json.extensions ??= {};
      writer.json.extensions.VRMC_vrm_animation = { specVersion: '1.0', humanoid: { humanBones } };
      writer.extensionsUsed.VRMC_vrm_animation = true;
    },
  }));
  return exporter.parseAsync(root, { binary: true, animations: [new AnimationClip('Motion', -1, tracks)] });
}
