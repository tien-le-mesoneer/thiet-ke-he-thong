import { getDb, counters } from "../../db.js";
import { config } from "../../config.js";

// Ranged allocation: each refill claims a block of ID_BLOCK_SIZE ids with a single
// atomic $inc, then hands them out from memory. This removes per-request counter
// contention. Trigger point: a single atomic $inc per write is fine below ~thousands
// of write QPS; blocks matter only above that.
export function makeAllocator(counterId = "url") {
  let next = 0;   // next id to hand out
  let max = -1;   // last id in the current block
  let refilling: Promise<void> | null = null;

  async function refill(): Promise<void> {
    const db = await getDb();
    const res = await counters(db).findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: config.idBlockSize } },
      { upsert: true, returnDocument: "after" },
    );
    const top = res!.seq;                     // e.g. 1000
    next = top - config.idBlockSize + 1;      // 1
    max = top;                                // 1000
  }

  return {
    async nextId(): Promise<number> {
      while (next > max) {
        if (!refilling) refilling = refill().finally(() => { refilling = null; });
        await refilling;
      }
      return next++;
    },
  };
}
