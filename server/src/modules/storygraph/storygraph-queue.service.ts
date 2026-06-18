import { Injectable, Logger } from '@nestjs/common';

import { STORYGRAPH_MIN_INTERVAL_MS } from './storygraph.constants';

@Injectable()
export class StorygraphQueueService {
  private readonly logger = new Logger(StorygraphQueueService.name);
  private readonly lastRequestAt = new Map<number, number>();

  async throttle(userId: number): Promise<void> {
    const last = this.lastRequestAt.get(userId);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      if (elapsed < STORYGRAPH_MIN_INTERVAL_MS) {
        const wait = STORYGRAPH_MIN_INTERVAL_MS - elapsed;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    this.lastRequestAt.set(userId, Date.now());
  }

  resetUser(userId: number): void {
    this.lastRequestAt.delete(userId);
  }
}
