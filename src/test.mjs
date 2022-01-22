import { makeTxOp, makeTx, pipe, SyncSubject } from "./core.mjs";
import {
  concat,
  from,
  defer,
  filter,
  map,
  mergeAll,
  of,
  resolvePromises,
  timer,
} from "./operators.mjs";
import { test } from "./test_utils.mjs";
import { delay } from "https://deno.land/std@0.121.0/async/delay.ts";

const TICK = 30;
const TWO_TICKS = 2 * TICK;

test("of", (got, expect) => {
  got(0);
  of(1, 2, 3).subscribe(got);
  got(4);

  expect(5);
});

test("defer", (got, expect) => {
  got(0);
  const x = defer(() => {
    got(2);
    return of(3, 4, 5);
  });
  got(1);
  x.subscribe(got);
  got(6);
  expect(7);
});

test("resolvePromises", async (got, expect) => {
  from([1, delay(TICK).then(() => 2), Promise.resolve(3), 4])
    .pipe(resolvePromises())
    .subscribe(got.endsWith(5));
  got(0);

  await delay(TWO_TICKS);

  expect(6);
});

test("mergeAll", async (got, expect) => {
  // test synchronous
  pipe(of(of(0, 1), of(2, 3)), mergeAll()).subscribe(got);
  got(4);
  expect(5);
});

test("concat", async (got, expect) => {
  got(0);
  concat().subscribe({
    next: () => got("gave a value"),
    complete: () => got(1),
    error: () => got(-1),
  });
  got(2);
  expect(3);

  concat(from([0, 1, 2]), from([3, 4])).subscribe(got.endsWith(5));
  expect(6);

  concat(
    from([0, 1]),
    from([2, 3]),
    from([5, 6]).pipe(resolvePromises()) // asynchronously completes
  ).subscribe(got.endsWith(7));
  got(4);
  await delay(0);
  expect(8);
});

test("map", async (got, expect) => {
  pipe(
    from([0, 2]),
    map((num, index) => {
      got(num === 2 * index);
      return 1 + num;
    })
  ).subscribe(got.endsWith(4));

  expect(5);
});

test("filter", async (got, expect) => {
  pipe(
    from([-1, 0, 10, -2, 0, 1]),
    filter((num, index) => {
      return index & 1 && num >= 0;
    })
  ).subscribe(got.endsWith(2));

  expect(3);
});

test("SyncSubject", async (got, expect) => {
  // basic test
  let subject = new SyncSubject();
  subject.subscribe(got.endsWith(1));
  subject.next(0);
  subject.complete();

  expect(2);

  // test unsubscribing in the middle
  subject = new SyncSubject();
  subject.subscribe((arg) => got(arg));
  let unsub = subject.subscribe((arg) => {
    got(arg + 1);
    arg === 3 && unsub.unsubscribe();
  });
  subject.subscribe((arg) => got(arg === 6 ? 7 : arg + 2));
  subject.next(0);
  subject.next(3);
  subject.next(6);
  expect(8);

  // test subscribing in the middle
  subject = new SyncSubject();
  subject.subscribe((arg) => {
    if (arg < 0) {
      subject.subscribe((arg) => got(arg + 1));
    } else {
      got(arg);
    }
  });
  subject.next(0);
  subject.next(1);
  subject.next(-1);
  subject.next(2);
  subject.next(4);
  expect(6);
});

test("timer", async (got, expect) => {
  // check basics
  got(0);
  const x = timer(TICK, 3);
  await delay(TWO_TICKS);
  got(1);
  x.subscribe(got);
  got(2);
  await delay(TWO_TICKS);
  got(4);
  expect(5);

  // check that it unsubscribes correctly
  got(0);
  const y = timer(TICK, "failed to unsubscribe");
  await delay(TWO_TICKS);
  got(1);
  const sub = y.subscribe(got);
  got(2);
  await delay(0);
  sub.unsubscribe();
  got(3);
  await delay(TWO_TICKS);
  expect(4);
});
