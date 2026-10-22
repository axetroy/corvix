import { describe, expect, it } from 'vitest';
import { DisposableCollection } from '../../src/lifecycle/disposable.js';

describe('DisposableCollection', () => {
  it('disposes resources in reverse registration order', async () => {
    const calls: number[] = [];
    const collection = new DisposableCollection();

    collection.add(() => { calls.push(1); });
    collection.add({ dispose: () => { calls.push(2); } });
    collection.addCallback(() => { calls.push(3); });

    await collection.dispose();

    expect(calls).toEqual([3, 2, 1]);
    expect(collection.isDisposed).toBe(true);
  });

  it('continues cleanup, aggregates failures, and is idempotent', async () => {
    const calls: string[] = [];
    const collection = new DisposableCollection();
    collection.add(() => { calls.push('first'); });
    collection.add(() => {
      calls.push('failure');
      throw new Error('cleanup failed');
    });
    collection.add(() => { calls.push('last'); });

    const disposal = collection.dispose();
    expect(collection.dispose()).toBe(disposal);
    await expect(disposal).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'cleanup failed' })],
    });
    expect(calls).toEqual(['last', 'failure', 'first']);
  });

  it('rejects resources registered after disposal starts', async () => {
    const collection = new DisposableCollection();
    const disposal = collection.dispose();

    expect(() => collection.add(() => {})).toThrow(/after disposal has started/);
    await disposal;
  });
});
