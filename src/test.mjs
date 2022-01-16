import { makeTxOp, makeTx } from "./core.mjs";

console.log("Hi");

let gen = makeTx((output) => {
  let running = true;
  output.onClose = () => {
    console.log("A closed");
    running = false;
  };

  [0, 1, 2, 3, 4].every((x) => {
    console.log(`A${x}`);
    output.next(x);
    return running;
  }) && output.complete();
});

gen = makeTxOp((output) => (iter, index) => {
  output.onClose = () => {
    console.log("B closed");
  };

  console.log("B", iter);
  output.iter(iter);
  if (index === 2) {
    // console.log("SEND COMPLETE");
    // output.complete();
    // console.log("COMPLETE COMPLETE");
    throw new Error("FAIL");
  }
})(gen);

gen = makeTxOp((output) => (iter) => {
  output.onClose = () => {
    console.log("C closed");
  };
  console.log("C", iter);
})(gen);

gen.open();
