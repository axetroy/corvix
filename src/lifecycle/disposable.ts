export interface Disposable {
  dispose(): void | Promise<void>;
}

export type DisposeCallback = () => void | Promise<void>;
export type DisposableResource = Disposable | DisposeCallback;

export class DisposableCollection implements Disposable {
  readonly #callbacks: DisposeCallback[] = [];
  #disposePromise: Promise<void> | undefined;

  get isDisposed(): boolean {
    return this.#disposePromise !== undefined;
  }

  add<T extends DisposableResource>(resource: T): T {
    if (this.isDisposed) {
      throw new Error('Cannot add a resource after disposal has started');
    }

    this.#callbacks.push(
      typeof resource === 'function' ? resource : () => resource.dispose(),
    );
    return resource;
  }

  addCallback(callback: DisposeCallback): Disposable {
    const disposable = { dispose: callback };
    this.add(disposable);
    return disposable;
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) {
      return this.#disposePromise;
    }

    const callbacks = this.#callbacks.splice(0).reverse();
    this.#disposePromise = Promise.resolve().then(async () => {
      const errors: unknown[] = [];

      for (const callback of callbacks) {
        try {
          await callback();
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, 'One or more resources failed to dispose');
      }
    });

    return this.#disposePromise;
  }
}
