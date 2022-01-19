import { makeTxOp, makeTx, pipe } from "./core.mjs";
import { defer, mergeAll, of, timer } from "./operators.mjs";
import { test } from "./test_utils.mjs";
import { delay } from "https://deno.land/std@0.121.0/async/delay.ts";

test("of", (got, expect) => {
  got(0);
  of(1, 2, 3).open(got);
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
  x.open(got);
  got(6);
  expect(7);
});

test("mergeAll", async (got, expect) => {
  // test synchronous
  pipe(of(of(0, 1), of(2, 3)), mergeAll()).open(got);
  got(4);
  expect(5);
});

test("timer", async (got, expect) => {
  // check basics
  got(0);
  const x = timer(100, 3);
  await delay(200);
  got(1);
  x.open(got);
  got(2);
  await delay(200);
  got(4);
  expect(5);

  // check that it unsubscribes correctly
  got(0);
  const y = timer(100, "failed to unsubscribe");
  await delay(200);
  got(1);
  const sub = y.open(got);
  got(2);
  await delay(50);
  sub.close();
  got(3);
  await delay(200);
  expect(4);
});
