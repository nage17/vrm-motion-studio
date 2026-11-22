import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { createDemo } from './demo.js';
import { preset, projectType, readProject, surroundingFrames } from './project.js';
import { exportVrma, rotation } from './vrma.js';
import { applyHandShape, handShapes } from './gestures.js';
import { exportFighters, fighterCount } from './fighter-export.js';
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js';
import { Vector3 } from 'three';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onloadend();
    });
  }
};

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

test('hand presets are independent and paired gestures pose both arms', () => {
  const frame = preset('stand');
  for (const name of Object.keys(handShapes).filter(shape => !['heart', 'circle'].includes(shape))) {
    applyHandShape(frame.angles, 'left', name);
    assert.ok(frame.angles.leftIndexProximal);
    assert.equal(frame.angles.rightIndexProximal, undefined);
  }
  for (const shape of ['heart', 'circle']) {
    applyHandShape(frame.angles, 'both', shape);
    assert.equal(frame.angles.leftUpperArm[1], -frame.angles.rightUpperArm[1]);
    assert.ok(frame.angles.rightIndexProximal);
  }
  assert.deepEqual(readProject(serialize([frame])).frames, [frame]);
});

test('the money gesture turns the palm up and keeps the thumb tip nearly straight', () => {
  for (const side of ['left', 'right']) {
    const angles = {};
    applyHandShape(angles, side, 'money');
    const palm = rotation(angles[side + 'LowerArm']).multiply(rotation(angles[side + 'Hand']));
    assert.ok(new Vector3(0, -1, 0).applyQuaternion(palm).y > .99);
    assert.ok(angles[side + 'ThumbDistal'].every(angle => Math.abs(angle) < 6));
    assert.equal(angles[(side === 'left' ? 'right' : 'left') + 'Hand'], undefined);
    const before = structuredClone(angles);
    applyHandShape(angles, side, 'money');
    assert.deepEqual(angles, before);
  }
  const frame = preset('guard');
  const direction = new Vector3(1, 0, 0);
  const before = direction.clone().applyQuaternion(rotation(frame.angles.leftLowerArm));
  applyHandShape(frame.angles, 'left', 'money');
  assert.ok(direction.applyQuaternion(rotation(frame.angles.leftLowerArm)).distanceTo(before) < .003);
});

test('the ZIP has one playable VRMA per fighter, and preserves finger and expression keyframes', async () => {
  const a = preset('stand'), b = preset('stand', .5);
  a.expression = { name: 'blinkRight', weight: .42 };
  b.expression = { name: 'aa', weight: .68 };
  applyHandShape(a.angles, 'left', 'peace');
  applyHandShape(b.angles, 'right', 'fist');
  const files = unzipSync(await exportFighters([a, b], 'VRM Test'));
  assert.deepEqual(readProject(strFromU8(files['pose.motion.json'])).frames, [a, b]);
  const vrmas = Object.entries(files).filter(([name]) => name.endsWith('.vrma'));
  assert.equal(vrmas.length, fighterCount);
  const loader = new GLTFLoader().register(parser => new VRMAnimationLoaderPlugin(parser));
  const layouts = new Set();
  for (const [name, bytes] of vrmas) {
    const gltf = await loader.parseAsync(bytes.buffer, '');
    const [animation] = gltf.userData.vrmAnimations;
    assert.ok(animation.humanoidTracks.rotation.has('leftIndexProximal'), name);
    assert.ok(animation.humanoidTracks.rotation.has('rightLittleDistal'), name);
    const values = animation.expressionTracks.preset.get('blinkRight').values;
    assert.ok(Math.abs(values[0] - .42) < .0001);
    assert.equal(values[1], 0);
    assert.ok(Math.abs(animation.expressionTracks.preset.get('aa').values[1] - .68) < .0001);
    layouts.add(animation.humanoidTracks.translation.get('hips').values[1]);
  }
  assert.ok(layouts.size > 1, 'fighter rest poses are not interchangeable copies');
});

test('paired gestures refit to each fighter in a batch without changing the editable frames', async () => {
  const frames = [
    { ...preset('stand'), pairedHands: 'heart' },
    { ...preset('stand', .7), pairedHands: 'circle' },
  ];
  const files = unzipSync(await exportFighters(frames, ''));
  assert.deepEqual(readProject(strFromU8(files['pose.motion.json'])).frames, frames);
  const loader = new GLTFLoader().register(parser => new VRMAnimationLoaderPlugin(parser));
  const layouts = new Set();
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.endsWith('.vrma')) continue;
    const gltf = await loader.parseAsync(bytes.buffer, '');
    const tracks = gltf.userData.vrmAnimations[0].humanoidTracks.rotation;
    const arm = tracks.get('leftUpperArm').values;
    assert.ok(arm.every(Number.isFinite));
    assert.notDeepEqual(arm.slice(0, 4), arm.slice(4, 8));
    layouts.add(arm.join(','));
  }
  assert.ok(layouts.size > 1);
});
