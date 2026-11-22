import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { createDemo } from './demo.js';
import { preset, projectType, readProject, surroundingFrames } from './project.js';
import { exportVrma, rotation } from './vrma.js';

const frames = [preset('stand'), preset('guard', .65), preset('stand', 1.2)];
const serialize = input => JSON.stringify({ format: projectType, version: 1, model: 'VRM Test', frames: input });

test('an editable JSON file round trips exact poses and finds surrounding frames', () => {
  const restored = readProject(serialize(frames));
  assert.deepEqual(restored.frames, frames);
  const [a, b, t] = surroundingFrames(restored.frames, .325);
  assert.equal(a.time, 0);
  assert.equal(b.time, .65);
  assert.equal(t, .5);
  assert.equal(surroundingFrames(restored.frames, 5)[0].time, 1.2);
});

test('project imports validate the first key, order, hip height and joint rotations', () => {
  assert.throws(() => readProject(serialize([preset('t', .4)])));
  assert.throws(() => readProject(serialize([preset('t'), preset('t')])));
  assert.throws(() => readProject(serialize([{ ...preset('t'), hip: 2 }])));
  assert.throws(() => readProject(serialize([{ ...preset('t'), angles: { hips: [400, 0, 0] } }])));
});

test('VRMA export contains playable humanoid tracks in the official format', async () => {
  globalThis.FileReader ??= class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(result => {
        this.result = result;
        this.onloadend();
      });
    }
  };
  const rig = createDemo();
  rig.rest = new Map(Object.entries(rig.bones).map(([name, bone]) => [name, bone.position]));
  rig.hipHeight = rig.rest.get('hips').y;
  const loader = new GLTFLoader().register(parser => new VRMAnimationLoaderPlugin(parser));

  const binary = await exportVrma(rig, frames);
  const gltf = await loader.parseAsync(binary, '');
  assert.equal(gltf.parser.json.meshes, undefined);
  assert.equal(gltf.parser.json.extensions.VRMC_vrm_animation.specVersion, '1.0');
  const [animation] = gltf.userData.vrmAnimations;
  assert.ok(Math.abs(animation.duration - 1.2) < .001);
  const track = animation.humanoidTracks.rotation.get('rightLowerArm');
  const expected = rotation(frames[1].angles.rightLowerArm).toArray();
  assert.ok(track.values.slice(4, 8).every((value, index) => Math.abs(value - expected[index]) < .0001));
  assert.equal(animation.humanoidTracks.translation.get('hips').times.length, 3);

  const pose = await loader.parseAsync(await exportVrma(rig, [frames[0]]), '');
  assert.ok(pose.userData.vrmAnimations[0].duration > 0);
  assert.equal(pose.userData.vrmAnimations[0].humanoidTracks.rotation.get('leftUpperArm').times.length, 2);
});
