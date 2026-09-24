// lib/three/engine3d.ts — GameEngine wired to the Three.js presentation layer.
//
// The simulation stays 100% the proven 2D gameEngine; only `render()` is
// replaced, delegating to the external 3D world that reads the same public
// entity state each frame. A hidden 2D scratch canvas satisfies the base
// constructor (its ctx is only used by the replaced 2D painter).
import { GameEngine, GameEngineCallbacks } from '../gameEngine';
import { PlayerProfile } from '../types';
import { getRegisteredWorld, ThreeWorld, WorldState } from './world';

export class GameEngine3D extends GameEngine {
  private world: ThreeWorld | null;

  constructor(canvas: HTMLCanvasElement, callbacks: GameEngineCallbacks, profile: PlayerProfile) {
    const scratch = document.createElement('canvas');
    scratch.width = scratch.height = 8;
    super(scratch, callbacks, profile);
    this.world = getRegisteredWorld(canvas);
    this.world?.resetPools();
  }

  render(timeSec: number = performance.now() / 1000) {
    if (this.world) {
      this.world.sync(this as unknown as WorldState, timeSec);
    }
  }
}
