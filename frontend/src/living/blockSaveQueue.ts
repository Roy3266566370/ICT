/** Order full block snapshots so one local save cannot race the previous revision. */
export class BlockSaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private confirmedRevision = 0;

  commit<T extends { revision: number }>(
    revision: number,
    send: (revision: number) => Promise<T>,
    stopOnError: (error: unknown) => boolean = () => true,
  ): Promise<T> {
    const pending = this.tail.then(async () => {
      const updated = await send(Math.max(revision, this.confirmedRevision));
      this.confirmedRevision = updated.revision;
      return updated;
    });
    this.tail = pending.catch(error => {
      if (stopOnError(error)) throw error;
    });
    // The queue retains a conflict for later commits, even with no waiter.
    void this.tail.catch(() => {});
    return pending;
  }
}
